import { fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_NOTICE } from '../../../ehr-blue/clinical/parts/SampleBanner'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { SAMPLE_CLINICIANS, SAMPLE_DEFINITIONS, SAMPLE_NURSES, SAMPLE_WORKSPACE_IDS, type SampleField } from '../../../ehr-blue/clinical/sample/definitions'
import { ENCOUNTERS, IDS, PATIENTS, type SampleValue } from '../../../ehr-blue/clinical/sample/seed'
import { applySampleAction, createSampleRecord, listedRecords, recordName, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { SampleCreate, SampleDetail, SampleList, SampleWorkspace, resetSampleStore } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { labelled, renderPage } from './harness'

/**
 * Every sample definition (the 14 workspaces and the emergency board): its list, new and record pages render, every
 * field and action of the catalogue appears, and every action changes the record as the catalogue says.
 */

const touched = vi.hoisted(() => ({ api: false }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true) }))

vi.mock('../../../staff/api', () => {
  touched.api = true
  return { staffApi: {}, isAllowedPatientLookup: () => false }
})
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

beforeEach(() => resetSampleStore())

const ALL = [...SAMPLE_WORKSPACE_IDS, 'emergency'] as const

function open(id: string, rest = '') {
  if (id !== 'emergency') return renderPage(<SampleWorkspace id={id} />, id, rest)
  return renderPage(
    <Workspace path="emergency">
      <Routes>
        <Route index element={<SampleList id="emergency" />} />
        <Route path="new" element={<SampleCreate id="emergency" />} />
        <Route path=":recordId" element={<SampleDetail id="emergency" />} />
      </Routes>
    </Workspace>,
    'emergency',
    rest,
  )
}

function actionsCard() {
  return screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
}

describe.each(ALL)('%s', id => {
  const definition = SAMPLE_DEFINITIONS[id]!

  it('renders its list with the sample notice and every listed record', () => {
    open(id)
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(screen.getByRole('searchbox', { name: `Search ${definition.title}` })).toBeTruthy()
    const records = listedRecords(sampleState(), definition)
    expect(records.length).toBeGreaterThan(0)
    const table = screen.getByRole('table', { name: definition.title })
    for (const record of records) expect(within(table).getByRole('link', { name: `Open ${recordName(record)}` })).toBeTruthy()
  })

  it('renders its new page with every catalogue field', () => {
    open(id, '/new')
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`New ${definition.title.toLowerCase()}`)
    if (definition.patient) {
      const patient = screen.getByLabelText(labelled('Patient')) as HTMLSelectElement
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      fireEvent.change(patient, { target: { value: PATIENTS.taylor } })
    }
    for (const field of definition.fields) expect(screen.getByLabelText(labelled(field.label))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('renders its first record with saved values, its actions (each opening its form), history and versions', () => {
    const record = listedRecords(sampleState(), definition)[0]!
    open(id, `/${record.id}`)
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(recordName(record))
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
    expect(Boolean(screen.queryByRole('heading', { name: 'History' }))).toBe(Boolean(record.patientId))
    expect(Boolean(screen.queryByRole('heading', { name: 'Earlier versions' }))).toBe(record.versions.length > 0)
    const available = definition.actions.filter(action => action.from.includes(record.status))
    if (available.length === 0) expect(within(actionsCard()).getByText('Nothing more to do here.')).toBeTruthy()
    for (const action of available) {
      fireEvent.click(within(actionsCard()).getByRole('button', { name: action.label, expanded: false }))
      const submit = within(actionsCard()).getAllByRole('button', { name: action.label }).find(button => button.getAttribute('type') === 'submit')
      expect(submit).toBeTruthy()
      for (const field of action.fields ?? []) expect(within(actionsCard()).getByLabelText(labelled(field.label))).toBeTruthy()
    }
    expect(Boolean(screen.queryByRole('heading', { name: 'Continue care' }))).toBe(Boolean(definition.continueCare))
  })
})

/** A valid fictional value for a field, the way a person would fill it in. */
function valueFor(field: SampleField): SampleValue {
  if (field.ref === 'bed') {
    const bed = createSampleRecord('wards', undefined, { name: 'Fresh bed', ward: IDS.wardExample })
    if (!('id' in bed)) throw new Error(bed.error)
    return bed.id
  }
  if (field.ref === 'ward') return IDS.wardExample
  if (field.ref === 'admission') return IDS.admitTaylor
  if (field.ref === 'encounter') return ENCOUNTERS.taylor
  if (field.ref === 'patient') return PATIENTS.taylor
  if (field.options) return field.options[0]!
  if (field.key === 'clinician') return SAMPLE_CLINICIANS[0].value
  if (field.key === 'assignedTo') return SAMPLE_NURSES[0].value
  if (field.key === 'department') return 'Cardiology'
  if (field.type === 'datetime-local') return field.key === 'starts' && field.label === 'New time' ? '2026-12-02T10:00' : '2026-12-01T10:00'
  if (field.type === 'date') return '2031-01-01'
  return `Fictional ${field.label.toLowerCase()}`
}

function values(fields: readonly SampleField[]) {
  return Object.fromEntries(fields.map(field => [field.key, valueFor(field)]))
}

const TERMINAL = ['cancel', 'noShow', 'dispose']

describe('every action of every definition', () => {
  it.each(ALL)('%s: walks the catalogue’s lifecycle, keeping a version per step', id => {
    const definition = SAMPLE_DEFINITIONS[id]!
    const created = createSampleRecord(id, definition.patient ? PATIENTS.taylor : undefined, values(definition.fields))
    if (!('id' in created)) throw new Error(created.error)
    const find = () => sampleState().records.find(record => record.id === created.id)!
    expect(find().status).toBe(definition.initial)
    // Each action once, whenever the record's status allows it (beds reach "cleaning" only through a discharge).
    const pending = definition.actions.filter(item => !TERMINAL.includes(item.id))
    let steps = 0
    for (let progressed = true; progressed;) {
      progressed = false
      for (const action of [...pending]) {
        if (!action.from.includes(find().status)) continue
        expect(applySampleAction(id, created.id, action.id, values(action.fields ?? []))).toEqual({ id: created.id })
        expect(find().status).toBe(action.to)
        steps += 1
        expect(find().versions).toHaveLength(steps)
        pending.splice(pending.indexOf(action), 1)
        progressed = true
      }
    }
    expect(pending.map(action => action.id)).toEqual(id === 'wards' ? ['clean'] : [])
  })

  it.each(ALL.flatMap(id => SAMPLE_DEFINITIONS[id]!.actions.filter(action => TERMINAL.includes(action.id) && action.from.includes(SAMPLE_DEFINITIONS[id]!.initial)).map(action => [id, action.id] as const)))('%s: %s ends the record', (id, actionId) => {
    const definition = SAMPLE_DEFINITIONS[id]!
    const action = definition.actions.find(item => item.id === actionId)!
    const created = createSampleRecord(id, definition.patient ? PATIENTS.taylor : undefined, values(definition.fields))
    if (!('id' in created)) throw new Error(created.error)
    expect(applySampleAction(id, created.id, action.id, values(action.fields ?? []))).toEqual({ id: created.id })
    const record = sampleState().records.find(item => item.id === created.id)!
    expect(record.status).toBe(action.to)
    expect(definition.actions.filter(item => item.from.includes(record.status))).toHaveLength(0)
    expect(applySampleAction(id, created.id, action.id, values(action.fields ?? []))).toEqual({ error: 'This action is no longer available for the current record state.' })
  })

  it('moves beds as patients are admitted, transferred and discharged', () => {
    const first = createSampleRecord('wards', undefined, { name: 'Bed A', ward: IDS.wardExample })
    const second = createSampleRecord('wards', undefined, { name: 'Bed B', ward: IDS.wardExample })
    if (!('id' in first) || !('id' in second)) throw new Error('beds')
    const bed = (bedId: string) => sampleState().records.find(record => record.id === bedId)!
    expect(applySampleAction('inpatient', IDS.admitSam, 'admit', { bed: first.id })).toEqual({ id: IDS.admitSam })
    expect(bed(first.id).status).toBe('occupied')
    expect(bed(first.id).data.admission).toBe(IDS.admitSam)
    expect(applySampleAction('inpatient', IDS.admitSam, 'transfer', { bed: second.id, handover: 'Fictional' })).toEqual({ id: IDS.admitSam })
    expect(bed(first.id).status).toBe('cleaning')
    expect(bed(first.id).data.admission).toBeUndefined()
    expect(bed(second.id).status).toBe('occupied')
    applySampleAction('inpatient', IDS.admitSam, 'prepare', { followup: 'Fictional' })
    applySampleAction('inpatient', IDS.admitSam, 'discharge', { summary: 'Fictional' })
    expect(bed(second.id).status).toBe('cleaning')
    expect(applySampleAction('wards', first.id, 'clean', { cleaning: 'Done' })).toEqual({ id: first.id })
    expect(bed(first.id).status).toBe('available')
  })

  it('refuses expired blood and a linked record of another patient', () => {
    const unit = createSampleRecord('bloodbank', undefined, { donor: 'Fictional', group: 'B+', expiry: '2020-01-01' })
    if (!('id' in unit)) throw new Error(unit.error)
    applySampleAction('bloodbank', unit.id, 'screen', { screening: 'Fictional' })
    expect(applySampleAction('bloodbank', unit.id, 'reserve', { patient: PATIENTS.taylor, review: 'Fictional' })).toEqual({ error: 'Blood unit expired. Dispose it.' })
    expect(applySampleAction('inpatient', IDS.admitSam, 'admit', { bed: IDS.bed1 })).toEqual({ error: 'Bed is occupied, awaiting cleaning or in maintenance.' })
    expect(applySampleAction('bloodbank', IDS.bloodScreened, 'reserve', { patient: PATIENTS.sam, review: 'Fictional' })).toEqual({ id: IDS.bloodScreened })
    expect(applySampleAction('inpatient', IDS.admitTaylor, 'transfer', { bed: IDS.admitSam, handover: 'x' })).toEqual({ error: 'Linked action record belongs to another patient.' })
  })

  it('never imports today’s API', () => {
    expect(touched.api).toBe(false)
  })
})
