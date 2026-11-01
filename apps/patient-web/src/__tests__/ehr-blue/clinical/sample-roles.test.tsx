import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyWorkspace } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { statusWords } from '../../../ehr-blue/clinical/parts/format'
import { NO_ACTIONS } from '../../../ehr-blue/clinical/parts/Notices'
import { DEFAULT_ACTION_PERMISSION, SAMPLE_DEFINITIONS, SAMPLE_WORKSPACE_IDS } from '../../../ehr-blue/clinical/sample/definitions'
import { IDS } from '../../../ehr-blue/clinical/sample/seed'
import { listedRecords, recordName, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { CREATE_REFUSED } from '../../../ehr-blue/clinical/sample/SampleCreate'
import { SampleWorkspace, resetSampleStore } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import type * as RoleView from '../../../ehr-blue/frame/roleView'
import type { DemoRole } from '../../../ehr-blue/frame/roleView'
import { BASE, DEMO_HOSPITAL_ID, FACILITY_ID } from './harness'

/**
 * Audit item 16 (owner decision 2): a sample record page follows the design's role mapping (design/ehr-target
 * src/catalog.ts permissions(role)) for the signed-in person's roles, or the demo role whose Home is being viewed at a
 * demo facility. An action needs its catalogue verb in the workspace's module, a Continue care target "create", Create
 * record "create", and a history row "view" in its workspace's module. The staff roles come in through the mocked
 * useStaff (the harness's doctor unless a test sets others) and the viewed demo role through a mocked useRoleView, the
 * two inputs of the frame's useSampleCan. Every person, patient and record here is fictional; nothing may reach
 * today's API or the network. The emergency board is drawn by the real Emergency workspace, whose live parts import
 * staff/api, so here the mock records every staffApi member reached for (each also throws), not whether the module
 * loads; sample.test.tsx, sample-all.test.tsx and sample-history.test.tsx check that no sample module loads it.
 */

const touched = vi.hoisted(() => ({ api: [] as string[] }))
const staff = vi.hoisted(() => ({
  permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true),
  facilityId: undefined as string | undefined, roles: undefined as string[] | undefined,
}))
/** The demo role whose Home is being viewed (frame/roleView.tsx), or null for the person's own roles. */
const roleView = vi.hoisted(() => ({ viewing: null as DemoRole | null }))

vi.mock('../../../staff/api', () => ({
  staffApi: new Proxy({}, {
    get: (_target, name) => {
      if (name === 'then') return undefined
      touched.api.push(String(name))
      throw new Error(`staffApi.${String(name)} was called by a sample page`)
    },
  }),
  isAllowedPatientLookup: () => false,
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1 }))
vi.mock('../../../ehr-blue/frame/roleView', async importOriginal => ({
  ...await importOriginal<typeof RoleView>(),
  useRoleView: () => ({ viewing: roleView.viewing, view: () => {} }),
}))

const network = vi.fn()

beforeEach(() => {
  resetSampleStore()
  staff.facilityId = undefined
  staff.roles = undefined
  roleView.viewing = null
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Signed in with these staff roles at the harness's facility (a real one: no demo role is viewed there). */
function signedInAs(...roles: string[]) {
  staff.roles = roles
}

/** Home viewed as a demo role, at Demo Hospital (the person stays the harness's doctor). */
function viewingAs(role: DemoRole) {
  staff.facilityId = DEMO_HOSPITAL_ID
  roleView.viewing = role
}

function Landed() {
  return <p data-testid="landed">{useLocation().pathname}</p>
}

/**
 * A sample workspace at `${BASE}/${id}${rest}`; for `emergency`, the Emergency workspace itself, whose list at a demo
 * facility is the sample board under the page's own heading and Create record (EmergencyWorkspace.tsx), and whose
 * `:recordId` is the board's record.
 */
function open(id: string, rest = '') {
  const page = id === 'emergency' ? <EmergencyWorkspace /> : <SampleWorkspace id={id} />
  return render(
    <MemoryRouter initialEntries={[`${BASE}/${id}${rest}`]}>
      <Routes>
        <Route path={`${BASE}/${id}/*`} element={page} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
}

function actionsCard() {
  return screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
}

/** The record's action buttons (each toggles its form), in order. */
function actionLabels() {
  return Array.from(actionsCard().querySelectorAll('.hid-ehr-clinical-action-list button')).map(button => button.textContent)
}

/** "Continue care"'s buttons: the row right after its sub-heading, if any. */
function continueCare() {
  const heading = within(actionsCard()).getByRole('heading', { level: 3, name: 'Continue care' })
  const row = heading.nextElementSibling as HTMLElement | null
  return row ? within(row).getAllByRole('button').map(button => button.textContent) : []
}

function historyCard() {
  return screen.getByRole('heading', { name: 'History' }).closest('section') as HTMLElement
}

/** Each history row as "{link} [{status}]". */
function historyRows() {
  return Array.from(historyCard().querySelectorAll('li')).map(row => {
    const link = row.querySelector('a')?.textContent ?? ''
    return `${link} [${(row.textContent ?? '').slice(link.length).trim()}]`
  })
}

/** Rows written with the record's status key ("[checked-in]"), as the badge words it ("[Checked in]"). */
function worded(rows: readonly string[]) {
  return rows.map(row => row.replace(/\[([^\]]*)\]$/, (_match, status: string) => `[${statusWords(status)}]`))
}

/** Each action's verb, as design/ehr-target src/catalog.ts gives it (null: none; the design then checks "edit"). */
const DESIGN_VERBS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  appointments: { reschedule: null, checkin: null, cancel: null, noShow: null },
  journey: { assign: null, complete: null, cancel: null },
  radiology: { schedule: 'edit', examine: 'edit', attach: 'edit', report: 'edit', review: 'approve', publish: 'publish', correct: 'edit' },
  inpatient: { admit: 'assign', transfer: 'assign', prepare: 'sign', discharge: 'sign' },
  icu: { admit: 'assign', transfer: 'assign', prepare: 'sign', discharge: 'sign' },
  wards: { clean: 'edit', maintenance: 'edit', release: 'edit' },
  emergency: { assess: 'edit', disposition: 'sign' },
  maternity: { observe: 'edit', delivery: 'sign', followup: 'edit' },
  surgery: { schedule: 'assign', checklist: 'edit', perform: 'sign', recover: 'edit', cancel: 'edit' },
  dental: { assess: 'edit', perform: 'sign', followup: 'edit' },
  referrals: { send: 'create', accept: 'approve', complete: 'edit' },
  bloodbank: { screen: 'approve', reserve: 'assign', issue: 'publish', dispose: 'edit' },
  telemedicine: { wait: 'edit', start: 'edit', end: 'sign' },
  'ward-config': {},
  'nursing-tasks': { start: 'edit', complete: 'edit', cancel: 'assign' },
}

describe('audit 16: sample record pages follow the design’s roles', () => {
  it('audit 16: every action of the 15 sample definitions carries the catalogue’s verb, and none where the catalogue gives none', () => {
    const ids = [...SAMPLE_WORKSPACE_IDS, 'emergency']
    expect(Object.keys(DESIGN_VERBS).sort()).toEqual([...ids].sort())
    for (const id of ids) {
      const verbs = Object.fromEntries(SAMPLE_DEFINITIONS[id]!.actions.map(action => [action.id, action.permission ?? null]))
      expect(verbs).toEqual(DESIGN_VERBS[id])
    }
    // src/workflows.tsx:490 and :538: `a.permission || "edit"`.
    expect(DEFAULT_ACTION_PERMISSION).toBe('edit')
  })

  it('audit 16: a Doctor sees no "Simulate recipient acceptance" on a referral, and today’s sentence in its place (referrals-3-detail.png)', () => {
    signedInAs('doctor')
    open('referrals', `/${IDS.referral}`)
    expect(screen.queryByRole('button', { name: 'Simulate recipient acceptance' })).toBeNull()
    expect(actionLabels()).toEqual([])
    expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
    // The capture is a Doctor's: every connected row still shows.
    expect(historyRows()).toEqual(worded([
      'Appointments · Medication review [booked]',
      'Patient visits · 203099a6 [consulting]',
      'Triage & Vitals · cbcf4b88 [completed]',
      'Consultation · 5f459730 [signed]',
      'Laboratory · Full blood count [processing]',
      'Radiology · Chest X-ray [published]',
      'Pharmacy · 71785d4b [reviewed]',
      'Telemedicine · Remote follow-up [waiting]',
    ]))
  })

  it('audit 16: a Receptionist’s Continue care offers no target it may not create, and the heading still shows (journey-3-detail.png)', () => {
    signedInAs('receptionist')
    const visit = open('journey', `/${IDS.visitTaylor}`)
    // Patient visits' actions have no verb of their own: "edit", which a Receptionist has.
    expect(actionLabels()).toEqual(['Assign / transfer queue', 'Complete visit'])
    expect(continueCare()).toEqual([])
    expect(within(actionsCard()).queryAllByRole('button', { name: /^Create / })).toEqual([])
    visit.unmount()

    // An admission's one sample target, Nursing tasks, is not the Receptionist's to create (rendered directly here: the
    // frame would not open Inpatient / Wards to a Receptionist at all).
    const admission = open('inpatient', `/${IDS.admitTaylor}`)
    expect(continueCare()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Create nursing tasks' })).toBeNull()
    expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
    admission.unmount()

    // A Nurse may create nursing tasks, and transfer a bed ("assign") but not prepare a discharge ("sign").
    signedInAs('nurse')
    open('inpatient', `/${IDS.admitTaylor}`)
    expect(actionLabels()).toEqual(['Transfer bed'])
    expect(continueCare()).toEqual(['Create nursing tasks'])
    fireEvent.click(screen.getByRole('button', { name: 'Create nursing tasks' }))
    expect(screen.getByTestId('landed').textContent).toBe(`${BASE}/nursing-tasks/new`)
  })

  it('audit 16: a Receptionist’s history drops Radiology, Inpatient, Dental and Nursing tasks rows (appointments-3-detail.png, journey-3-detail.png)', () => {
    const doctor = open('appointments', `/${IDS.apptTaylor}`)
    const all = within(historyCard()).getAllByRole('link').map(link => link.textContent)
    for (const row of ['Radiology · Abdominal ultrasound', 'Inpatient / Wards · Observation (fictional)', 'Dental · 503fafd8', 'Nursing tasks · 4-hourly observations']) {
      expect(all).toContain(row)
    }
    doctor.unmount()

    signedInAs('receptionist')
    const appointment = open('appointments', `/${IDS.apptTaylor}`)
    expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
    expect(within(historyCard()).getByText('Only records your role can see are listed.')).toBeTruthy()
    // The live modules' fictional rows (Triage & Vitals, Consultation, Laboratory, Pharmacy, Nursing observations) go too.
    expect(historyRows()).toEqual(worded(['Patient visits · b57e94c9 [consulting]', 'Patient visits · Review of results [waiting]']))
    appointment.unmount()

    open('journey', `/${IDS.visitTaylor}`)
    expect(within(historyCard()).getByText('Only records your role can see are listed.')).toBeTruthy()
    expect(historyRows()).toEqual([])
  })

  it('audit 16: a role that may not create gets the design’s refusal at a sample’s new address, typed directly, and no form', () => {
    const doctor = open('radiology', '/new')
    expect(screen.getByRole('heading', { level: 1, name: 'New radiology' })).toBeTruthy()
    // A patient workspace's form starts at "Patient *"; its fields and "Save record" follow a chosen patient.
    expect(screen.getByRole('combobox', { name: /^Patient/ })).toBeTruthy()
    expect(screen.queryByText(CREATE_REFUSED)).toBeNull()
    doctor.unmount()

    viewingAs('Radiology Reporter')
    const reporter = open('radiology', '/new')
    expect(screen.getByRole('heading', { level: 1, name: 'New radiology' })).toBeTruthy()
    expect(screen.getByText(CREATE_REFUSED)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    reporter.unmount()

    // A role the mapping does not name creates nowhere, the demo facility's Emergency board included.
    signedInAs('org_admin_awaiting_review')
    for (const id of ['appointments', 'journey', 'referrals', 'emergency']) {
      if (id === 'emergency') staff.facilityId = DEMO_HOSPITAL_ID
      const view = open(id, '/new')
      expect(screen.getByText(CREATE_REFUSED)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
      view.unmount()
    }
    expect(touched.api).toEqual([])
  })

  it('audit 16: a Radiology Reporter sees no Create record on Radiology (radiology-1-list.png), and the design’s actions and history on its records', () => {
    const doctor = open('radiology')
    expect(screen.getByRole('button', { name: 'New record' })).toBeTruthy()
    doctor.unmount()

    viewingAs('Radiology Reporter')
    const list = open('radiology')
    expect(screen.getByRole('heading', { level: 1, name: 'Radiology' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull()
    const table = within(screen.getByRole('table', { name: 'Radiology' }))
    for (const name of ['Open Chest X-ray', 'Open Abdominal ultrasound']) expect(table.getByRole('link', { name })).toBeTruthy()
    list.unmount()

    // radiology-3-detail1.png and -detail2.png: one action each, and no other workspace's row.
    const xray = open('radiology', `/${IDS.xray}`)
    expect(actionLabels()).toEqual(['Correct report'])
    expect(historyRows()).toEqual([])
    xray.unmount()
    open('radiology', `/${IDS.ultrasound}`)
    expect(actionLabels()).toEqual(['Record examination'])
    expect(historyRows()).toEqual([])
  })

  it('audit 16: the demo role being viewed decides at a demo facility, and only there', () => {
    // The person is the harness's doctor; Home is viewed as the Medical Director, who may approve a referral.
    viewingAs('Medical Director')
    const director = open('referrals', `/${IDS.referral}`)
    expect(actionLabels()).toEqual(['Simulate recipient acceptance'])
    director.unmount()

    viewingAs('Cashier')
    const cashier = open('journey', `/${IDS.visitTaylor}`)
    expect(actionLabels()).toEqual([])
    expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
    expect(historyRows()).toEqual([])
    cashier.unmount()

    // At a real facility no demo role is viewed: the person's own roles decide (a Doctor may not approve).
    roleView.viewing = 'Medical Director'
    staff.facilityId = FACILITY_ID
    open('referrals', `/${IDS.referral}`)
    expect(actionLabels()).toEqual([])
    expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
  })

  it('audit 16: the Blood Bank’s verbs: a Lab Scientist may dispose of a unit, only a Lab Manager may screen it', () => {
    signedInAs('lab')
    const scientist = open('bloodbank', `/${IDS.bloodQuarantine}`)
    expect(actionLabels()).toEqual(['Dispose unit'])
    scientist.unmount()
    viewingAs('Lab Manager')
    open('bloodbank', `/${IDS.bloodQuarantine}`)
    expect(actionLabels()).toEqual(['Record screening review', 'Dispose unit'])
  })

  it('audit 16: a role the mapping does not name sees no sample action, Continue care target, Create record or history row', () => {
    signedInAs('org_admin_awaiting_review')
    let pages = 0
    for (const id of [...SAMPLE_WORKSPACE_IDS, 'emergency']) {
      const definition = SAMPLE_DEFINITIONS[id]!
      // The emergency board shows only at a demo facility. No demo role is viewed there, so the person's roles decide.
      staff.facilityId = id === 'emergency' ? DEMO_HOSPITAL_ID : undefined
      const list = open(id)
      // The list's heading is drawn (SampleHome's, or the Emergency page's above its board), so a missing Create record
      // is the role gate's doing.
      expect(screen.getByRole('heading', { level: 1, name: id === 'emergency' ? 'Emergency access' : definition.title })).toBeTruthy()
      if (id === 'emergency') {
        expect(screen.queryByRole('link', { name: 'New board entry' })).toBeNull()
        const board = within(screen.getByRole('table', { name: definition.title }))
        for (const record of listedRecords(sampleState(), definition)) expect(board.getByRole('link', { name: `Open ${recordName(record)}` })).toBeTruthy()
      }
      expect(screen.queryByRole('button', { name: 'New record' })).toBeNull()
      list.unmount()
      for (const record of listedRecords(sampleState(), definition)) {
        pages += 1
        const view = open(id, `/${record.id}`)
        expect(actionLabels()).toEqual([])
        expect(within(actionsCard()).getByText(NO_ACTIONS)).toBeTruthy()
        expect(within(actionsCard()).queryAllByRole('button')).toEqual([])
        if (definition.continueCare) expect(continueCare()).toEqual([])
        if (record.patientId) expect(historyRows()).toEqual([])
        view.unmount()
      }
    }
    expect(pages).toBeGreaterThan(25)
    expect(touched.api).toEqual([])
    expect(network).not.toHaveBeenCalled()
  })
})
