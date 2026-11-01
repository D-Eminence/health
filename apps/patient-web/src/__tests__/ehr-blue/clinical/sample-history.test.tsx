import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { statusWords } from '../../../ehr-blue/clinical/parts/format'
import { SAMPLE_NOTICE } from '../../../ehr-blue/clinical/parts/SampleBanner'
import { SAMPLE_DEFINITIONS, SAMPLE_WORKSPACE_IDS } from '../../../ehr-blue/clinical/sample/definitions'
import { ENCOUNTERS, IDS, PATIENTS, SEED_CONNECTED } from '../../../ehr-blue/clinical/sample/seed'
import { displayItems, listedRecords, matchesSearch, refChoices, sampleLabel, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { SampleWorkspace, resetSampleStore } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { BASE } from './harness'

/**
 * Audit item 17 (owner decision 3): a sample record's "Connected hospital history" lists the design's fictional rows
 * of the live modules (Triage & Vitals, Consultation, Laboratory, Pharmacy, Nursing observations) for Taylor and
 * Jordan, on sample pages only. And owner decision 4: the sample's saved-record labels are written properly. Nothing
 * here may reach today's API or the network.
 */

const touched = vi.hoisted(() => ({ api: false }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true), roles: undefined as string[] | undefined }))

vi.mock('../../../staff/api', () => {
  touched.api = true
  return {
    staffApi: new Proxy({}, { get: (_target, name) => { if (name === 'then') return undefined; throw new Error(`staffApi.${String(name)} was called by a sample page`) } }),
    isAllowedPatientLookup: () => false,
  }
})
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1 }))

const network = vi.fn()

beforeEach(() => {
  resetSampleStore()
  // The harness's doctor, the design's Doctor, who may view every workspace these records are in (audit item 16).
  staff.roles = undefined
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Where a link took the page, with the router state it carried. */
function Landed() {
  const location = useLocation()
  return <p data-testid="landed" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</p>
}

function open(id: string, recordId: string) {
  return render(
    <MemoryRouter initialEntries={[`${BASE}/${id}/${recordId}`]}>
      <Routes>
        <Route path={`${BASE}/${id}/*`} element={<SampleWorkspace id={id} />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
}

function historyCard() {
  return screen.getByRole('heading', { name: 'History' }).closest('section') as HTMLElement
}

/** Each history row as "{link} [{status}]", the status as the badge says it in words (statusWords). */
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

function links() {
  return within(historyCard()).getAllByRole('link').map(link => link.textContent)
}

const TAYLOR_DENTAL = [
  'Appointments · Review of results [checked-in]',
  'Patient visits · b57e94c9 [consulting]',
  'Patient visits · Review of results [waiting]',
  'Triage & Vitals · 329417b6 [completed]',
  'Consultation · fd276688 [signed]',
  'Laboratory · Malaria parasite test [published]',
  'Laboratory · Blood culture [ordered]',
  'Radiology · Abdominal ultrasound [scheduled]',
  'Pharmacy · fe7be2ce [partial]',
  'Inpatient / Wards · Observation (fictional) [admitted]',
  'Nursing observations · 637d9f70 [recorded]',
  'Nursing observations · 76354f18 [recorded]',
  'Nursing tasks · 4-hourly observations [in-progress]',
  'Nursing tasks · Wound dressing check [assigned]',
]

const EHR_BLUE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../ehr-blue')

/** Every source file of the blue EHR (tests aside). */
function sources() {
  return (readdirSync(EHR_BLUE, { recursive: true }) as string[])
    .filter(file => /\.(ts|tsx)$/.test(file) && !file.includes('.test.'))
    .map(file => join(EHR_BLUE, file))
}

/**
 * The addresses the frame's page registries serve (frame, clinical and department pages), read from their source so
 * this file imports no live page: "laboratory" is /provider/laboratory.
 */
function servedPaths() {
  const registries = sources().filter(file => /(^|\/)(pages\.ts|page\.tsx)$/.test(relative(EHR_BLUE, file)))
  const paths = new Set<string>()
  for (const file of registries) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:path: '|(?:live|sample)\(')([a-z-]+)/g)) paths.add(match[1]!)
  }
  return paths
}

describe('audit 17: the design’s connected history rows from the live modules, on sample pages only', () => {
  it('audit 17: Taylor’s dental record lists the design’s connected history in its module order (dental-3-detail.png)', () => {
    open('dental', IDS.dental)
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(historyRows()).toEqual(worded(TAYLOR_DENTAL))
  })

  for (const { id, recordId, last } of [
    { id: 'referrals', recordId: IDS.referral, last: 'Telemedicine · Remote follow-up [waiting]' },
    { id: 'telemedicine', recordId: IDS.telemedicine, last: 'Referral Network · Specialist review [sent]' },
  ]) it(`audit 17: Jordan’s ${id} record lists Triage & Vitals, Consultation, Laboratory and Pharmacy (${id}-3-detail.png)`, () => {
    open(id, recordId)
    expect(historyRows()).toEqual(worded([
      'Appointments · Medication review [booked]',
      'Patient visits · 203099a6 [consulting]',
      'Triage & Vitals · cbcf4b88 [completed]',
      'Consultation · 5f459730 [signed]',
      'Laboratory · Full blood count [processing]',
      'Radiology · Chest X-ray [published]',
      'Pharmacy · 71785d4b [reviewed]',
      last,
    ]))
  })

  it('audit 17: Sam’s procedure lists the design’s rows, his draft Triage & Vitals and Consultation among them (surgery-3-detail.png)', () => {
    open('surgery', IDS.surgery)
    expect(historyRows()).toEqual(worded([
      'Appointments · Patient requested another day [cancelled]',
      'Patient visits · 11e3fd1b [waiting]',
      'Triage & Vitals · 8f2c2b76 [draft]',
      'Consultation · 4fe5735c [draft]',
      'Inpatient / Wards · Awaiting bed (fictional) [requested]',
    ]))
  })

  it('audit 17: Taylor’s nursing task lists the design’s rows in its order (nursing-tasks-3-detail.png)', () => {
    // The design's capture is a nurse's, who views fewer workspaces (audit item 16): exactly its rows, in its order.
    staff.roles = ['nurse']
    open('nursing-tasks', IDS.taskObs)
    expect(historyRows()).toEqual(worded([
      'Appointments · Review of results [checked-in]',
      'Patient visits · b57e94c9 [consulting]',
      'Patient visits · Review of results [waiting]',
      'Triage & Vitals · 329417b6 [completed]',
      'Inpatient / Wards · Observation (fictional) [admitted]',
      'Nursing observations · 637d9f70 [recorded]',
      'Nursing observations · 76354f18 [recorded]',
    ]))
    expect(within(screen.getByRole('heading', { name: 'Available actions' }).closest('section')!).getAllByRole('button').map(button => button.textContent)).toEqual(['Complete task'])
  })

  it('audit 17: a connected row opens its workspace’s list, an address the frame serves, carrying no id, state or call', () => {
    const served = servedPaths()
    expect(served.has('appointments')).toBe(true)
    expect([...new Set(SEED_CONNECTED.map(row => row.workspace))].sort()).toEqual(['clinical', 'laboratory', 'nursing', 'pharmacy', 'triage'])
    for (const row of SEED_CONNECTED) expect(served.has(row.workspace)).toBe(true)

    const view = open('dental', IDS.dental)
    const card = historyCard()
    expect(within(card).getByRole('link', { name: 'Triage & Vitals · 329417b6' }).getAttribute('href')).toBe(`${BASE}/triage`)
    expect(within(card).getByRole('link', { name: 'Consultation · fd276688' }).getAttribute('href')).toBe(`${BASE}/clinical`)
    expect(within(card).getByRole('link', { name: 'Laboratory · Malaria parasite test' }).getAttribute('href')).toBe(`${BASE}/laboratory`)
    expect(within(card).getByRole('link', { name: 'Laboratory · Blood culture' }).getAttribute('href')).toBe(`${BASE}/laboratory`)
    expect(within(card).getByRole('link', { name: 'Pharmacy · fe7be2ce' }).getAttribute('href')).toBe(`${BASE}/pharmacy`)
    expect(within(card).getByRole('link', { name: 'Nursing observations · 637d9f70' }).getAttribute('href')).toBe(`${BASE}/nursing`)
    // A sample record's own row still opens that record.
    expect(within(card).getByRole('link', { name: 'Radiology · Abdominal ultrasound' }).getAttribute('href')).toBe(`${BASE}/radiology/${IDS.ultrasound}`)

    fireEvent.click(within(card).getByRole('link', { name: 'Laboratory · Malaria parasite test' }))
    const landed = screen.getByTestId('landed')
    expect(landed.textContent).toBe(`${BASE}/laboratory`)
    expect(landed.getAttribute('data-state')).toBe('null')
    view.unmount()
    expect(touched.api).toBe(false)
    expect(network).not.toHaveBeenCalled()
  })

  it('audit 17: the rows are history only: never a sample record, list row, record picker choice or search match', () => {
    const state = sampleState()
    const ids = SEED_CONNECTED.map(row => row.id)
    // Consultation's rows name the sample's own fictional encounters (fd276688, 5f459730, 4fe5735c), which a radiology order picks.
    expect(SEED_CONNECTED.filter(row => row.workspace === 'clinical').map(row => row.name)).toEqual([ENCOUNTERS.taylor.slice(0, 8), ENCOUNTERS.jordan.slice(0, 8), ENCOUNTERS.sam.slice(0, 8)])
    const names = SEED_CONNECTED.filter(row => row.workspace !== 'clinical').map(row => row.name)
    expect(state.records.filter(record => ids.includes(record.id))).toEqual([])
    for (const id of [...SAMPLE_WORKSPACE_IDS, 'emergency']) {
      for (const record of listedRecords(state, SAMPLE_DEFINITIONS[id]!)) {
        for (const name of names) expect(matchesSearch(state, record, name)).toBe(false)
      }
    }
    for (const kind of ['bed', 'ward', 'admission', 'encounter', 'patient'] as const) {
      for (const patientId of [PATIENTS.taylor, PATIENTS.jordan, PATIENTS.sam]) {
        for (const choice of refChoices(state, kind, patientId)) {
          expect(ids).not.toContain(choice.value)
          for (const name of names) expect(choice.label).not.toContain(name)
        }
      }
    }
  })

  it('audit 17: a visit lists only the rows started from it; the patient the design gives none (Riley) gets none', () => {
    const visit = open('journey', IDS.visitTaylor)
    expect(links()).toEqual([
      'Triage & Vitals · 329417b6', 'Consultation · fd276688', 'Laboratory · Malaria parasite test', 'Laboratory · Blood culture',
      'Radiology · Abdominal ultrasound', 'Pharmacy · fe7be2ce',
    ])
    visit.unmount()
    const jordan = open('journey', IDS.visitJordan)
    expect(within(historyCard()).queryAllByRole('link')).toHaveLength(0)
    jordan.unmount()
    for (const [id, recordId] of [['maternity', IDS.maternity], ['icu', IDS.icuRiley]] as const) {
      const view = open(id, recordId)
      const shown = within(historyCard()).queryAllByRole('link').map(link => link.textContent ?? '')
      expect(shown.filter(label => /^(Triage & Vitals|Consultation|Laboratory|Pharmacy|Nursing observations) · /.test(label))).toEqual([])
      view.unmount()
    }
  })

  it('audit 17: only the sample engine reads the rows: no page outside clinical/sample mentions them', () => {
    const files = sources()
    expect(files.length).toBeGreaterThan(50)
    const readers = files.filter(file => /SEED_CONNECTED|historyFor/.test(readFileSync(file, 'utf8')))
    const named = readers.map(file => relative(EHR_BLUE, file))
    expect(named).toEqual(expect.arrayContaining(['clinical/sample/SampleDetail.tsx', 'clinical/sample/seed.ts', 'clinical/sample/store.ts']))
    expect(named.filter(file => !file.startsWith('clinical/sample/'))).toEqual([])
  })
})

describe('audit decision 4: sample labels are written properly', () => {
  const RAW = /\b(Dob|Health Id|Bp|Spo2|Hid|Nin|Mrn|Followup)\b|\b[A-Z][a-z]+ (?!ID\b)[A-Z]/

  it('audit decision 4: every saved-record, quick-view and version label of every seeded record is written properly', () => {
    const state = sampleState()
    const labels = new Set<string>()
    for (const record of state.records) {
      for (const item of displayItems(state, record.data)) labels.add(String(item.label))
      for (const version of record.versions) for (const item of displayItems(state, version.data)) labels.add(String(item.label))
    }
    expect(labels.size).toBeGreaterThan(30)
    for (const label of labels) expect(label).not.toMatch(RAW)
    expect(labels).toContain('Assigned to')
    expect(labels).toContain('Next visit')
    expect(labels).toContain('Published at')
  })

  it('audit decision 4: keys print as words, never raw', () => {
    expect(sampleLabel('assignedTo')).toBe('Assigned to')
    expect(sampleLabel('nextVisit')).toBe('Next visit')
    expect(sampleLabel('publishedAt')).toBe('Published at')
    expect(sampleLabel('followup')).toBe('Follow-up')
    expect(sampleLabel('newbornId')).toBe('Newborn identity')
    expect(sampleLabel('healthId')).toBe('Health ID')
    expect(sampleLabel('complaint')).toBe('Complaint')
  })

  it('audit decision 4: the Saved record prints them (Nursing tasks: "Assigned to")', () => {
    open('nursing-tasks', IDS.taskObs)
    const saved = screen.getByRole('heading', { name: 'Saved record' }).closest('section')!
    expect(Array.from(saved.querySelectorAll('dt')).map(term => term.textContent)).toEqual(['Admission', 'Name', 'Assigned to', 'Due'])
  })

  it('audit decision 4: no field or action label of a sample definition is a raw label', () => {
    for (const definition of Object.values(SAMPLE_DEFINITIONS)) {
      const fields = [...definition.fields, ...definition.actions.flatMap(action => action.fields ?? [])]
      for (const field of fields) expect(field.label).not.toMatch(/\b(Dob|Health Id|Bp|Spo2|Hid|Nin|Mrn|Followup)\b/)
      for (const field of fields) expect(field.label).not.toMatch(/\b[A-Z][a-z]+ (?!ID\b|PDF\b|MB\b)[A-Z]/)
      for (const action of definition.actions) expect(action.label).not.toMatch(/\b(Dob|Health Id|Bp|Spo2|Hid|Nin|Mrn|Followup)\b/)
    }
  })
})
