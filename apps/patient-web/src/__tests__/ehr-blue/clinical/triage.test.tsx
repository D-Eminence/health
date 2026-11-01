import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { TriageWorkspace, triageStatus } from '../../../ehr-blue/clinical/triage/TriageWorkspace'
import { DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, patientBanner, renderPage } from './harness'

/**
 * Triage & Vitals: the open patient's vitals (today's records of kind "vitals", per encounter) in the design's list,
 * "New triage & vitals" with today's measurements and refusals, and the design's record page, where "Correct these
 * vitals" is today's appended correction with full replacement values and the history lists the encounter's records
 * in the other workspaces. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  vitalCorrections: vi.fn(), correctVital: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const ALL = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.vital.read', 'ehr.vital.write', 'ehr.note.read']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever, headache', rowVersion: 1,
}
const VITAL_ID = 'f0000000-0000-4000-8000-000000000001'
const NEW_ID = 'f1111111-0000-4000-8000-000000000002'
const VITAL = {
  id: VITAL_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T08:05:00.000Z',
  recordedAt: '2026-10-30T08:05:00.000Z', systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 72, temperatureC: '36.6', respiratoryRate: null,
  oxygenSaturationPercent: null, weightKg: null, heightCm: null, source: 'manual', currentCorrectionNo: 0, rowVersion: '1',
}
const CORRECTIONS = [
  { id: 'correction-1', vitalId: VITAL_ID, correctionNo: 1, replacementValues: { systolicMmhg: 122, diastolicMmhg: 82, pulseBpm: 76 }, reason: 'Cuff too small', createdAt: '2026-10-30T08:10:00.000Z' },
  { id: 'correction-2', vitalId: VITAL_ID, correctionNo: 2, replacementValues: { systolicMmhg: 118, diastolicMmhg: 76, pulseBpm: 80 }, reason: 'Repeat reading', createdAt: '2026-10-30T08:20:00.000Z' },
]
const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'
const RECORD = `/${ENCOUNTER_ID}~${VITAL_ID}`
const OBSERVATION_ID = 'c0000000-0000-4000-8000-000000000001'
const LAB_ID = 'b0000000-0000-4000-8000-000000000001'
const PRESCRIPTION_ID = 'd0000000-0000-4000-8000-000000000001'
const OBSERVATION = {
  id: OBSERVATION_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T09:00:00.000Z',
  noteType: 'Nursing observation', title: 'Vitals', status: 'draft', rowVersion: '1',
}
const CONSULTATION_NOTE = { ...OBSERVATION, id: 'c2222222-0000-4000-8000-000000000003', noteType: 'Consultation', title: 'Consultation note' }
const LAB = { id: LAB_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:30:00.000Z', testDisplay: 'Full blood count', status: 'completed' }
const PRESCRIPTION = { id: PRESCRIPTION_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', medicationDisplay: '', status: 'active' }

let vitals: unknown[]
/** The encounter's records in the other workspaces, by record kind; none unless a test gives some. */
let others: Record<string, unknown[]>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  staff.facilityId = undefined
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  vitals = [VITAL]
  others = {}
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'vitals' ? vitals : others[kind] ?? [], nextCursor: null }))
  api.vitalCorrections.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.correctVital.mockResolvedValue({ id: 'correction-9', vitalId: VITAL_ID, correctionNo: 1 })
  api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, _kind: string, body: object) => {
    const saved = { ...VITAL, ...body, id: NEW_ID, encounterId }
    vitals = [saved, ...vitals]
    return saved
  })
})

function open(rest = '') {
  return renderPage(<TriageWorkspace />, 'triage', rest)
}

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

function input(scope: HTMLElement, label: string) {
  return within(scope).getByLabelText(labelled(label)) as HTMLInputElement
}

function described(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('Triage & Vitals list', () => {
  it('is partial: vitals are live; the design’s priority and observations are a sample', () => {
    expect(triageStatus).toBe('partial')
  })

  it('shows the loading state, then the patient’s vitals in the design’s table, after the access re-check', async () => {
    const page = deferred<{ items: unknown[]; nextCursor: null }>()
    api.encounters.mockReturnValueOnce(page.promise)
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Triage & Vitals' })).toBeTruthy()
    expect(await screen.findByText('Loading records…')).toBeTruthy()
    await act(async () => page.resolve({ items: [ENCOUNTER], nextCursor: null }))

    const table = await screen.findByRole('table', { name: 'Triage & Vitals' })
    // One patient's chart: the second column holds the readings, with their units; the patient is the banner.
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Readings', 'Status', 'Updated', 'Actions'])
    const link = within(table).getByRole('link', { name: 'f0000000' })
    expect(link.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~${VITAL_ID}`)
    expect(within(table).queryByText(PATIENT_NAME)).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(link.closest('tr')!.textContent).toMatch(/BP\s*120\/80\s*mmHg.*Pulse\s*72\s*bpm.*Temperature\s*36\.6\s*°C/)
    expect(within(table).getByText('Final')).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('names the tab after the workspace, and repeats each record’s own id under its link, not its visit’s', async () => {
    document.title = ''
    open()
    const table = await screen.findByRole('table', { name: 'Triage & Vitals' })
    expect(document.title).toBe('Triage & Vitals · Health ID EHR')
    expect(within(table).getAllByText('f0000000').map(element => element.tagName)).toEqual(['A', 'SPAN'])
    expect(within(table).queryByText('e0000000')).toBeNull()
  })

  it('opens the record quick view with the current values, and Escape closes it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view f0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { level: 3, name: 'f0000000' })).toBeTruthy()
    expect(within(drawer).getByText('Fever, headache')).toBeTruthy()
    expect(within(drawer).getByText('120/80')).toBeTruthy()
    expect(within(drawer).getByText('36.6')).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('shows a corrected vital’s current correction, read as today’s rows read it', async () => {
    vitals = [{ ...VITAL, currentCorrectionNo: 2, rowVersion: '3' }]
    api.vitalCorrections.mockResolvedValue(CORRECTIONS)
    open()
    expect(await screen.findByText('Corrected (correction 2)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quick view f0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('118/76')).toBeTruthy()
    expect(within(drawer).queryByText('120/80')).toBeNull()
    expect(api.vitalCorrections).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID)
  })

  it('says when a corrected vital’s correction cannot be read, not passing the first values off as current', async () => {
    vitals = [{ ...VITAL, currentCorrectionNo: 1, rowVersion: '2' }]
    api.vitalCorrections.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view f0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(await within(drawer).findByText(/These vitals were corrected, but the correction could not be loaded/)).toBeTruthy()
  })

  it('searches the rows and says when nothing matches', async () => {
    open()
    await screen.findByRole('table', { name: 'Triage & Vitals' })
    fireEvent.change(screen.getByLabelText('Search Triage & Vitals'), { target: { value: 'nothing like this' } })
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('link', { name: 'f0000000' })).toBeTruthy()
  })

  it('has today’s empty states: no encounters, and encounters with no vitals', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    const view = open()
    expect(await screen.findByText('No encounters are available for this patient and facility.')).toBeTruthy()
    view.unmount()
    api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
    vitals = []
    open()
    expect(await screen.findByText('No vitals for this encounter.')).toBeTruthy()
  })

  it('shows a refused encounter read, and a refused vitals read', async () => {
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const view = open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    view.unmount()
    api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
    api.records.mockRejectedValue(new HidApiError(403, 'This role may not read vitals.', { code: 'FORBIDDEN' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('This role may not read vitals.')
  })

  it('pages through the encounters with today’s cursors, re-checking access each time', async () => {
    const second = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002' }
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) =>
      page.cursor ? { items: [second], nextCursor: null } : { items: [ENCOUNTER], nextCursor: 'cursor-2' })
    open()
    const pages = await screen.findByRole('navigation', { name: 'Record pages' })
    api.lookupPatient.mockClear()
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 2')).toBeTruthy()
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, second.id, 'vitals')
  })

  it('shows the read-only notice and nothing to create when the grant does not allow changes', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    await screen.findByRole('table', { name: 'Triage & Vitals' })
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (403)', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Open the patient again to keep working.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('asks for a patient first when none is open', () => {
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('gives an emergency patient the read-only gate: nothing is read or offered here', () => {
    staff.activePatient = activePatient('emergency')
    open()
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.records).not.toHaveBeenCalled()
  })
})

describe('New triage & vitals', () => {
  async function openNew() {
    open('/new')
    expect(screen.getByRole('heading', { level: 1, name: 'New triage & vitals' })).toBeTruthy()
    const save = await screen.findByRole('button', { name: 'Save record' })
    return save.closest('form')!
  }

  it('shows the open patient, the patient context and the earlier triage', async () => {
    api.reportedHealthProfile.mockResolvedValue({ allergies: 'Penicillin', bloodGroup: null, genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    await openNew()
    // The open patient is the banner (the one-option Patient select is gone).
    expect(screen.queryByLabelText(labelled('Patient'))).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    const context = screen.getByRole('region', { name: 'Allergies and earlier vitals' })
    expect(await within(context).findByText('Recorded allergies: Penicillin (patient-reported: entered by the patient in their Health ID portal, not clinically verified).')).toBeTruthy()
    expect(within(context).getByText(/^Vitals · Final · /)).toBeTruthy()
  })

  it('says "None recorded" only after a read that found no allergies; a refused, unserved or unreadable read shows nothing, as today', async () => {
    const context = () => screen.getByRole('region', { name: 'Allergies and earlier vitals' })
    const settle = async () => {
      await screen.findByRole('button', { name: 'Save record' })
      await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.anything()))
      await act(async () => {})
    }
    for (const refusal of [
      new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }),
      new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }),
      new TypeError('The answer could not be read.'),
    ]) {
      api.reportedHealthProfile.mockClear()
      api.reportedHealthProfile.mockRejectedValue(refusal)
      const view = open('/new')
      await settle()
      expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
      expect(within(context()).queryByText(/^Recorded allergies:/)).toBeNull()
      view.unmount()
    }

    for (const answer of [null, { allergies: null, bloodGroup: 'O+', genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null }]) {
      api.reportedHealthProfile.mockClear()
      api.reportedHealthProfile.mockResolvedValue(answer)
      const view = open('/new')
      await settle()
      expect(within(context()).getByText('Recorded allergies: None recorded. Confirm with the patient.')).toBeTruthy()
      view.unmount()
    }

    api.reportedHealthProfile.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const view = open('/new')
    expect(await within(context()).findByText('Recorded allergies: what the patient entered about their health could not be loaded. Confirm with the patient.')).toBeTruthy()
    view.unmount()

    // A role without note read is not asked, and is told nothing about allergies.
    api.reportedHealthProfile.mockClear()
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    open('/new')
    await screen.findByRole('button', { name: 'Save record' })
    await act(async () => {})
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(within(context()).queryByText(/^Recorded allergies:/)).toBeNull()
  })

  it('records the vitals for the chosen visit after the access re-check, then opens the record', async () => {
    const form = await openNew()
    const visit = input(form, 'Visit') as unknown as HTMLSelectElement
    expect(Array.from(visit.options).map(option => option.textContent)).toEqual(['Select…', expect.stringMatching(/^e0000000 · in progress · /)])
    fireEvent.change(visit, { target: { value: ENCOUNTER_ID } })
    expect(screen.getByText('Presenting complaint: Fever, headache')).toBeTruthy()
    type(form, 'Systolic BP (mmHg)', '120')
    type(form, 'Diastolic BP (mmHg)', '80')
    type(form, 'Temperature (°C)', '37.2')
    // Enter in a field submits the form: the button is its submit button.
    fireEvent.submit(form)

    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals',
      { recordedAt: expect.any(String), source: 'manual', systolicMmhg: 120, diastolicMmhg: 80, temperatureC: 37.2 }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder.at(-2)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(screen.getByRole('heading', { level: 1, name: 'f1111111' })).toBeTruthy()
  })

  it('shows no sample fields at a real facility: everything in the form is saved', async () => {
    const form = await openNew()
    expect(within(form).queryByRole('group', { name: 'Priority and observations (sample)' })).toBeNull()
    expect(within(form).queryByLabelText('Priority')).toBeNull()
    expect(within(form).queryByLabelText('Observations')).toBeNull()
    expect(within(form).queryByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeNull()
  })

  it('keeps the sample priority and observations in the page at a demo facility: marked, and never sent', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    // The page lists only this facility's visits.
    api.encounters.mockResolvedValue({ items: [{ ...ENCOUNTER, facilityId: DEMO_HOSPITAL_ID }], nextCursor: null })
    const form = await openNew()
    const sample = within(form).getByRole('group', { name: 'Priority and observations (sample)' })
    expect(within(sample).getByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeTruthy()
    fireEvent.change(within(sample).getByLabelText('Priority'), { target: { value: 'Urgent' } })
    type(sample, 'Observations', 'Looks unwell')
    fireEvent.change(input(form, 'Visit'), { target: { value: ENCOUNTER_ID } })
    type(form, 'Pulse (bpm)', '90')
    fireEvent.submit(form)
    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(JSON.stringify(api.createRecord.mock.calls[0])).not.toMatch(/Urgent|Looks unwell/)
  })

  it('refuses as today: a visit, at least one measurement, both blood pressure readings, and the ranges', async () => {
    const form = await openNew()
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect(within(form).getByText('Complete this field.')).toBeTruthy()
    expect(document.activeElement).toBe(input(form, 'Visit'))

    fireEvent.change(input(form, 'Visit'), { target: { value: ENCOUNTER_ID } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    const group = within(form).getByRole('group', { name: 'Vital measurements' })
    expect(described(group)).toBe('Enter at least one vital measurement.')
    expect(document.activeElement).toBe(input(form, 'Systolic BP (mmHg)'))
    expect(described(input(form, 'Systolic BP (mmHg)'))).toContain('Enter at least one vital measurement.')

    type(form, 'Systolic BP (mmHg)', '120')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    const diastolic = input(form, 'Diastolic BP (mmHg)')
    expect(diastolic.getAttribute('aria-invalid')).toBe('true')
    expect(described(diastolic)).toContain('Enter both systolic and diastolic blood pressure, or leave both blank.')
    expect(document.activeElement).toBe(diastolic)

    type(form, 'Systolic BP (mmHg)', '20')
    type(form, 'Diastolic BP (mmHg)', '80')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect(described(input(form, 'Systolic BP (mmHg)'))).toContain('Enter a value from 30 to 350.')
    type(form, 'Systolic BP (mmHg)', '120')
    type(form, 'Temperature (°C)', '36.65')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect(described(input(form, 'Temperature (°C)'))).toContain('Enter a value with at most 1 decimal place.')
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  // EHR's VitalMeasurementsDto, as today's form lets it through (staff/routes/__tests__/VitalsLimits.test.tsx:53-62): values
  // EHR accepts, then values it refuses (outside the range, or one decimal place too many).
  const LIMITS: ReadonlyArray<readonly [label: string, accepted: readonly string[], refused: readonly string[]]> = [
    ['Systolic BP (mmHg)', ['30', '120', '350'], ['29', '351', '120.5']],
    ['Diastolic BP (mmHg)', ['10', '80', '250'], ['9', '251', '80.5']],
    ['Pulse (bpm)', ['10', '72', '350'], ['9', '351', '72.5']],
    ['Temperature (°C)', ['20', '36.6', '50'], ['19.9', '50.1', '36.65']],
    ['Respirations / min', ['1', '16', '100'], ['0', '101', '16.5']],
    ['SpO₂ (%)', ['0', '97.25', '100'], ['-0.01', '100.01', '97.255']],
    ['Weight (kg)', ['0.2', '70.125', '700'], ['0.199', '700.001', '70.1255']],
    ['Height (cm)', ['20', '172.55', '300'], ['19.99', '300.01', '172.555']],
  ]

  it('blocker: accepts what EHR accepts for each measurement, and only that, as today', async () => {
    const form = await openNew()
    for (const [label, accepted, refused] of LIMITS) {
      for (const value of accepted) {
        type(form, label, value)
        expect(input(form, label).checkValidity(), `${label} ${value}`).toBe(true)
      }
      for (const value of refused) {
        type(form, label, value)
        expect(input(form, label).checkValidity(), `${label} ${value}`).toBe(false)
      }
    }
  })

  it('blocker: records SpO₂, a newborn’s weight and a height to the decimals EHR keeps', async () => {
    const form = await openNew()
    fireEvent.change(input(form, 'Visit'), { target: { value: ENCOUNTER_ID } })
    type(form, 'SpO₂ (%)', '97.5')
    type(form, 'Weight (kg)', '3.255')
    type(form, 'Height (cm)', '50.25')
    fireEvent.submit(form)
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals',
      { recordedAt: expect.any(String), source: 'manual', heightCm: 50.25, weightKg: 3.255, oxygenSaturationPercent: 97.5 }, expect.any(String))
  })

  it('gap: pages the visits as today’s "Encounter pages", keeping a visit chosen on another page and recording for it', async () => {
    const second = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', chiefComplaint: 'Cough', startedAt: '2026-10-20T08:00:00.000Z' }
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) =>
      page.cursor ? { items: [second], nextCursor: null } : { items: [ENCOUNTER], nextCursor: 'cursor-2' })
    const form = await openNew()
    const visit = input(form, 'Visit') as unknown as HTMLSelectElement
    fireEvent.change(visit, { target: { value: ENCOUNTER_ID } })
    // The landmark has today's pager name (Clinical.tsx:1794), so a screen reader's landmark list says what it pages.
    const pages = screen.getByRole('navigation', { name: 'Encounter pages' })
    expect(screen.queryByRole('navigation', { name: 'Record pages' })).toBeNull()
    api.lookupPatient.mockClear()
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(await within(pages).findByText('Page 2')).toBeTruthy()
    // Each move re-checks access first, as today's encounter read does.
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder.at(-1)!)
    // Page 2's visit is offered; the one chosen stays chosen, and today's sentence says it is on another page.
    expect(Array.from(visit.options).map(option => option.value)).toEqual(['', ENCOUNTER_ID, second.id])
    expect(visit.value).toBe(ENCOUNTER_ID)
    const elsewhere = `The encounter being documented, ambulatory started ${formatWhen(ENCOUNTER.startedAt)}, is on another page.`
    expect(described(visit)).toBe(`Presenting complaint: Fever, headache ${elsewhere}`)
    // Each is a line of its own, as today's sentence is (Clinical.tsx:1795), not run on after the complaint.
    const hint = document.getElementById(visit.getAttribute('aria-describedby')!)!
    expect(within(hint).getByText('Presenting complaint: Fever, headache').className).toBe('block')
    expect(within(hint).getByText(elsewhere).className).toBe('block')
    type(form, 'Pulse (bpm)', '90')
    fireEvent.submit(form)
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![2]).toBe(ENCOUNTER_ID)
  })

  it('gap: records vitals for a visit chosen on a later page of visits', async () => {
    const second = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', chiefComplaint: 'Cough', startedAt: '2026-10-20T08:00:00.000Z' }
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) =>
      page.cursor ? { items: [second], nextCursor: null } : { items: [ENCOUNTER], nextCursor: 'cursor-2' })
    const form = await openNew()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Encounter pages' })).getByRole('button', { name: 'Next page' }))
    const visit = input(form, 'Visit') as unknown as HTMLSelectElement
    await waitFor(() => expect(Array.from(visit.options).map(option => option.value)).toEqual(['', second.id]))
    fireEvent.change(visit, { target: { value: second.id } })
    expect(described(visit)).toContain('Presenting complaint: Cough')
    expect(described(visit)).not.toContain('is on another page')
    type(form, 'Pulse (bpm)', '90')
    fireEvent.submit(form)
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![2]).toBe(second.id)
  })

  it('shows a server refusal at its field and in the form, and a retry reuses the key', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'pulseBpm', messages: ['pulseBpm must not be greater than 350'] }],
    }))
    const form = await openNew()
    fireEvent.change(input(form, 'Visit'), { target: { value: ENCOUNTER_ID } })
    type(form, 'Pulse (bpm)', '90')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    const alert = await within(form).findByRole('alert')
    expect(alert.textContent).toBe('One or more request fields are invalid. Pulse bpm must not be greater than 350.')
    expect(described(input(form, 'Pulse (bpm)'))).toContain('Pulse bpm must not be greater than 350.')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    await screen.findByText('Clinical record saved.')
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('offers no form under a read-only grant, and none for an emergency patient', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    const view = open('/new')
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
    view.unmount()
    staff.activePatient = activePatient('emergency')
    open('/new')
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
  })

  it('says so when the role may not record vitals', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.vital.write')
    open('/new')
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this record.')
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
  })
})

describe('Triage & Vitals record', () => {
  async function openRecord() {
    open(RECORD)
    expect(await screen.findByRole('heading', { level: 1, name: 'f0000000' })).toBeTruthy()
  }

  function saved() {
    return screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section')!
  }

  async function amendForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Correct these vitals' }))
    return screen.getByRole('button', { name: 'Save correction' }).closest('form')!
  }

  it('shows the loading state, then the saved record, after the access re-check', async () => {
    const encounter = deferred<typeof ENCOUNTER>()
    api.encounter.mockReturnValueOnce(encounter.promise)
    open(RECORD)
    expect(await screen.findByText('Loading records…')).toBeTruthy()
    await act(async () => encounter.resolve(ENCOUNTER))
    expect(await screen.findByRole('heading', { level: 1, name: 'f0000000' })).toBeTruthy()
    const card = saved()
    expect(within(card).getByText('e0000000')).toBeTruthy()
    expect(within(card).getByText('Fever, headache')).toBeTruthy()
    expect(within(card).getByText('120/80')).toBeTruthy()
    expect(within(card).getByText('72')).toBeTruthy()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    const history = screen.getByRole('heading', { level: 2, name: 'History' }).closest('section')!
    expect(within(history).getByRole('link', { name: 'Consultation · e0000000' }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
  })

  it('says when the vitals were recorded, as today’s "Recorded" does, and prints stored decimals as the design does (display only)', async () => {
    document.title = ''
    vitals = [{ ...VITAL, recordedAt: '2026-10-30T07:55:00.000Z', oxygenSaturationPercent: '98.00', weightKg: '68.400', temperatureC: '36.60', heightCm: '170' }]
    await openRecord()
    expect(document.title).toBe('Triage & Vitals · Health ID EHR')
    // When EHR saved them, as today's "Recorded" line (staff/routes/Clinical.tsx:1813), in the page's own day-and-time format.
    expect(screen.getByText(`Saved ${formatWhen(VITAL.createdAt)}`)).toBeTruthy()
    expect(screen.queryByText(`Saved ${formatWhen('2026-10-30T07:55:00.000Z')}`)).toBeNull()
    const card = saved()
    expect(within(card).getByText('98')).toBeTruthy()
    expect(within(card).getByText('68.4')).toBeTruthy()
    expect(within(card).getByText('36.6')).toBeTruthy()
    expect(within(card).getByText('170')).toBeTruthy()
    expect(within(card).queryByText('98.00')).toBeNull()
    // The correction form starts from the values as stored.
    const form = await amendForm()
    expect(input(form, 'SpO₂ (%)').value).toBe('98.00')
    expect(input(form, 'Weight (kg)').value).toBe('68.400')
  })

  it('says the record was not found, and shows a refused read', async () => {
    const view = open(`/${ENCOUNTER_ID}~f9999999-0000-4000-8000-000000000009`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    view.unmount()
    api.encounter.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open(RECORD)
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
  })

  it('amends as today’s correction: full replacement values, the version and the reason, after the access re-check', async () => {
    await openRecord()
    const form = await amendForm()
    expect(within(form).getByText('The values below become the current vitals; what was recorded is kept. A measurement left blank is not part of the corrected vitals.')).toBeTruthy()
    expect(input(form, 'Systolic BP (mmHg)').value).toBe('120')
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Repeat reading')
    api.lookupPatient.mockClear()
    vitals = [{ ...VITAL, currentCorrectionNo: 1, rowVersion: '2' }]
    api.vitalCorrections.mockResolvedValue([{ ...CORRECTIONS[0]!, replacementValues: { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 78, temperatureC: 36.6 }, reason: 'Repeat reading' }])
    fireEvent.submit(form)

    expect(await screen.findByText('Vital correction saved.')).toBeTruthy()
    expect(api.correctVital).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID, {
      expectedRowVersion: 1, changeReason: 'Repeat reading', replacementValues: { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 78, temperatureC: 36.6 },
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.correctVital.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true })
    expect(await screen.findByText('Corrected (correction 1)')).toBeTruthy()
    expect(within(saved()).getByText('78')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Available actions')
  })

  it('blocker: corrects one value of vitals stored with more decimals, sending the others unchanged', async () => {
    vitals = [{ ...VITAL, oxygenSaturationPercent: '97.50', weightKg: '3.255', heightCm: '50.25' }]
    await openRecord()
    const form = await amendForm()
    expect(input(form, 'SpO₂ (%)').value).toBe('97.50')
    expect(input(form, 'Weight (kg)').value).toBe('3.255')
    type(form, 'Systolic BP (mmHg)', '124')
    type(form, 'Reason for correction', 'Repeat reading')
    fireEvent.submit(form)
    await waitFor(() => expect(api.correctVital).toHaveBeenCalledTimes(1))
    expect(api.correctVital).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID, {
      expectedRowVersion: 1, changeReason: 'Repeat reading',
      replacementValues: { systolicMmhg: 124, diastolicMmhg: 80, pulseBpm: 72, temperatureC: 36.6, oxygenSaturationPercent: 97.5, weightKg: 3.255, heightCm: 50.25 },
    }, expect.any(String))
  })

  it('gap: opens no correction while the vitals are read again after one, so none goes out with the old version', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Repeat reading')
    const reread = deferred<{ items: unknown[]; nextCursor: null }>()
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { fresh?: boolean }) =>
      page?.fresh ? reread.promise : { items: kind === 'vitals' ? vitals : others[kind] ?? [], nextCursor: null })
    api.vitalCorrections.mockResolvedValue([{ ...CORRECTIONS[0]!, replacementValues: { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 78, temperatureC: 36.6 }, reason: 'Repeat reading' }])
    fireEvent.submit(form)
    expect(await screen.findByText('Vital correction saved.')).toBeTruthy()
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true }))
    // The page says why, in today's words while the records reload (Clinical.tsx:1805).
    expect(within(actions()).getByRole('status').textContent).toBe('Loading records…')

    // Still the version from before the correction: the button says it is unavailable, and a press opens nothing.
    const amend = screen.getByRole('button', { name: 'Correct these vitals' })
    expect(amend.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(amend)
    expect(amend.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Save correction' })).toBeNull()

    await act(async () => reread.resolve({ items: [{ ...VITAL, currentCorrectionNo: 1, rowVersion: '2' }], nextCursor: null }))
    expect(await screen.findByText('Corrected (correction 1)')).toBeTruthy()
    const again = await screen.findByRole('button', { name: 'Correct these vitals' })
    expect(again.getAttribute('aria-disabled')).toBeNull()
    expect(within(actions()).queryByRole('status')).toBeNull()
    fireEvent.click(again)
    expect(input(screen.getByRole('button', { name: 'Save correction' }).closest('form')!, 'Pulse (bpm)').value).toBe('78')
    expect(api.correctVital).toHaveBeenCalledTimes(1)
  })

  it('refuses an unchanged correction and a short reason, as today', async () => {
    await openRecord()
    const form = await amendForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(described(within(form).getByRole('group', { name: 'Corrected vital measurements' }))).toBe('Change at least one value before saving a correction.')
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'ok')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(described(input(form, 'Reason for correction'))).toContain('Give a reason of at least 3 characters.')
    type(form, 'Diastolic BP (mmHg)', '')
    type(form, 'Reason for correction', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(described(input(form, 'Diastolic BP (mmHg)'))).toContain('Enter both systolic and diastolic blood pressure, or leave both blank.')
    expect(api.correctVital).not.toHaveBeenCalled()
  })

  it('shows a refused correction in the form, and a retry reuses its key', async () => {
    api.correctVital.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('EHR is unavailable.')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    await screen.findByText('Vital correction saved.')
    expect(api.correctVital.mock.calls[1]![5]).toBe(api.correctVital.mock.calls[0]![5])
  })

  it('shows the latest correction as current, with what each correction replaced, and amends from it', async () => {
    vitals = [{ ...VITAL, currentCorrectionNo: 2, rowVersion: '3' }]
    api.vitalCorrections.mockResolvedValue(CORRECTIONS)
    await openRecord()
    expect(await screen.findByText('Corrected (correction 2)')).toBeTruthy()
    const card = saved()
    expect(within(card).getByText('118/76')).toBeTruthy()
    expect(within(card).getByText('Repeat reading')).toBeTruthy()
    expect(within(card).queryByText('120/80')).toBeNull()
    const versions = screen.getByRole('heading', { level: 2, name: 'Earlier versions' }).closest('section')!
    expect(within(versions).getByText(/^30 Oct 2026, \d\d:\d\d · final · Cuff too small$/)).toBeTruthy()
    expect(within(versions).getByText('Originally recorded')).toBeTruthy()
    expect(within(versions).getByText('120/80')).toBeTruthy()
    expect(within(versions).getByText('Corrected (correction 1)')).toBeTruthy()
    const form = await amendForm()
    expect(input(form, 'Systolic BP (mmHg)').value).toBe('118')
    expect(input(form, 'Temperature (°C)').value).toBe('')
  })

  it('offers no amendment when the correction cannot be read, or the vitals were entered in error', async () => {
    vitals = [{ ...VITAL, currentCorrectionNo: 1, rowVersion: '2' }]
    api.vitalCorrections.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const view = open(RECORD)
    expect((await screen.findByRole('alert')).textContent).toBe('These vitals were corrected, but the correction could not be loaded, so the values below are as first recorded and may not be current. EHR is unavailable.')
    expect(screen.queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    // Where the design puts it: after the empty action list, as a note.
    const none = screen.getByText('Nothing more to do here.')
    expect(none.className).toBe('hid-ehr-clinical-note')
    expect(none.previousElementSibling?.className).toBe('hid-ehr-clinical-action-list')
    view.unmount()
    vitals = [{ ...VITAL, status: 'entered_in_error' }]
    open(RECORD)
    expect(await screen.findByText('Recorded in error: do not use these values. They can no longer be corrected.')).toBeTruthy()
    expect(screen.getAllByText('Entered in error').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
  })

  it('reads the vitals again after a 412 and says they changed; after VITAL_NOT_AMENDABLE that they were entered in error', async () => {
    api.correctVital.mockRejectedValueOnce(new HidApiError(412, 'Precondition failed', { code: 'ROW_VERSION_MISMATCH' }))
    await openRecord()
    let form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByText('These vitals changed since they were loaded, so the correction was not saved: check them, and correct them again if it is still needed. The list was reloaded.')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true })

    api.correctVital.mockRejectedValueOnce(new HidApiError(409, 'A vital entered in error cannot be changed', { code: 'VITAL_NOT_AMENDABLE' }))
    api.records.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    form = await amendForm()
    type(form, 'Pulse (bpm)', '79')
    type(form, 'Reason for correction', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByText('These vitals were marked entered in error since they were loaded, so the correction was not saved. The list could not be reloaded; refresh it to see the vitals.')).toBeTruthy()
  })

  it('gap: opens no correction while the vitals are read again after a 412, so none goes out with the refused version', async () => {
    api.correctVital.mockRejectedValueOnce(new HidApiError(412, 'Precondition failed', { code: 'ROW_VERSION_MISMATCH' }))
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    // The reason by its role and the button by aria-expanded, so this test holds with either commit's words.
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Repeat reading' } })
    const reread = deferred<{ items: unknown[]; nextCursor: null }>()
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { fresh?: boolean }) =>
      page?.fresh ? reread.promise : { items: kind === 'vitals' ? vitals : others[kind] ?? [], nextCursor: null })
    fireEvent.submit(form)
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true }))

    // Refused and read again: the form, its own submit still running, can be closed...
    const toggle = within(actions()).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // ...but none opens on the version EHR refused: the button says it is unavailable, the page says why, and a press
    // opens nothing.
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(within(actions()).getByRole('status').textContent).toBe('Loading records…')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Corrected vital measurements' })).toBeNull()

    await act(async () => reread.resolve({ items: [{ ...VITAL, rowVersion: '2' }], nextCursor: null }))
    expect(await screen.findByText('These vitals changed since they were loaded, so the correction was not saved: check them, and correct them again if it is still needed. The list was reloaded.')).toBeTruthy()
    expect(toggle.getAttribute('aria-disabled')).toBeNull()
    expect(within(actions()).queryByRole('status')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('group', { name: 'Corrected vital measurements' })).toBeTruthy()
    expect(api.correctVital).toHaveBeenCalledTimes(1)
  })

  it('offers no amendment under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openRecord()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
  })

  it('closes the patient when the re-check before a correction is refused', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Repeat reading')
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'deny' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    const ended = await screen.findByText('Access to this patient ended')
    expect(ended.closest('[role="alert"]')?.textContent).toContain('Open the patient again to keep working.')
    expect(api.correctVital).not.toHaveBeenCalled()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  function actions() {
    return screen.getByRole('heading', { level: 2, name: 'Available actions' }).closest('section')!
  }

  function history() {
    return screen.getByRole('heading', { level: 2, name: 'History' }).closest('section')!
  }

  function historyRows() {
    return within(history()).getAllByRole('listitem').map(row => {
      const link = within(row).queryByRole('link')
      return [link?.textContent ?? row.firstElementChild?.textContent, link?.getAttribute('href') ?? null]
    })
  }

  function labels(scope: HTMLElement) {
    return Array.from(scope.querySelectorAll('dt')).map(term => term.textContent)
  }

  it('audit 11: vitals have no live action beyond today’s "Correct these vitals", so there is no More actions menu', async () => {
    await openRecord()
    await screen.findByRole('button', { name: 'Correct these vitals' })
    expect(within(actions()).getAllByRole('button').map(button => button.textContent)).toEqual(['Correct these vitals'])
    expect(actions().querySelector('[aria-haspopup]')).toBeNull()
    expect(within(actions()).queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('audit 15: the history lists the visit first, then the encounter’s Laboratory, Pharmacy and Nursing observations, each a link; never other vitals', async () => {
    staff.permissions = [...ALL, 'ehr.lab-request.read', 'ehr.prescription.read']
    vitals = [VITAL, { ...VITAL, id: 'f2222222-0000-4000-8000-000000000003', createdAt: '2026-10-30T08:15:00.000Z' }]
    others = {
      // Only nursing observations from the notes; a record of another encounter is never listed here.
      'clinical-notes': [OBSERVATION, CONSULTATION_NOTE, { ...OBSERVATION, id: 'c9999999-0000-4000-8000-000000000009', encounterId: 'e9999999-0000-4000-8000-000000000009' }],
      'lab-requests': [LAB],
      prescriptions: [PRESCRIPTION],
    }
    await openRecord()
    await waitFor(() => expect(within(history()).queryByText('Loading records…')).toBeNull())
    expect(historyRows()).toEqual([
      ['Consultation · e0000000', `/provider/clinical/${ENCOUNTER_ID}`],
      ['Laboratory · Full blood count', `/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB_ID}`],
      // Today's word for an order with no name.
      ['Pharmacy · Prescription', `/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${PRESCRIPTION_ID}`],
      ['Nursing observations · c0000000', `/provider/nursing/${ENCOUNTER_ID}~${OBSERVATION_ID}`],
    ])
    expect(within(history()).getAllByRole('listitem').map(row => row.lastElementChild?.textContent)).toEqual(['In progress', 'Completed', 'Active', 'Draft'])
    expect(within(history()).queryByText(/f2222222|c2222222|c9999999/)).toBeNull()
    // The record's own read is the only vitals read; each other kind is read once, as the encounter page reads it.
    expect(api.records.mock.calls.filter(call => call[3] === 'vitals')).toHaveLength(1)
    for (const kind of ['clinical-notes', 'lab-requests', 'prescriptions']) {
      expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, kind)
    }
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('audit 15: each kind is read only by a role that may read it; a read in progress or refused says so in the history', async () => {
    others = { 'clinical-notes': [OBSERVATION], 'lab-requests': [LAB], prescriptions: [PRESCRIPTION] }
    staff.permissions = ['ehr.vital.read', 'ehr.vital.write']
    let view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'f0000000' })
    await act(async () => {})
    // Without encounter read the visit is named, not linked; without note, lab or prescription read nothing else is read.
    expect(historyRows()).toEqual([['Consultation · e0000000', null]])
    expect(api.records.mock.calls.map(call => call[3])).toEqual(['vitals'])
    view.unmount()

    staff.permissions = [...ALL, 'ehr.lab-request.read', 'ehr.prescription.read']
    const notesRead = deferred<{ items: unknown[]; nextCursor: null }>()
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'clinical-notes') return notesRead.promise
      if (kind === 'prescriptions') throw new HidApiError(403, 'This role may not read prescriptions.', { code: 'FORBIDDEN' })
      return { items: kind === 'vitals' ? vitals : others[kind] ?? [], nextCursor: null }
    })
    view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'f0000000' })
    expect(await within(history()).findByText('Loading records…')).toBeTruthy()
    await act(async () => notesRead.resolve({ items: [OBSERVATION], nextCursor: null }))
    expect(within(history()).queryByText('Loading records…')).toBeNull()
    expect(within(history()).getByRole('alert').textContent).toBe('This role may not read prescriptions.')
    // The other rows still show, and the record itself is unaffected.
    expect(historyRows().map(row => row[0])).toEqual(['Consultation · e0000000', 'Laboratory · Full blood count', 'Nursing observations · c0000000'])
    expect(within(saved()).getByText('120/80')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Correct these vitals' })).toBeTruthy()
    view.unmount()
  })

  it('audit 15: a kind past its first page shows today’s "Record pages" in the history; a later page is reached there, and a failed move says so', async () => {
    let refuseFirst = false
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string; fresh?: boolean }) => {
      if (kind !== 'clinical-notes') return { items: kind === 'vitals' ? vitals : others[kind] ?? [], nextCursor: null }
      // Newer consultation notes fill the first notes page; the observation is on the next.
      if (page?.cursor === 'notes-2') return { items: [OBSERVATION], nextCursor: null }
      if (page && refuseFirst) throw new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
      return { items: [CONSULTATION_NOTE], nextCursor: 'notes-2' }
    })
    await openRecord()
    const pages = await within(history()).findByRole('group', { name: 'Nursing observations' })
    expect(within(pages).getByRole('navigation', { name: 'Record pages' })).toBeTruthy()
    expect(within(pages).getByText('Page 1')).toBeTruthy()
    expect(historyRows()).toEqual([['Consultation · e0000000', `/provider/clinical/${ENCOUNTER_ID}`]])

    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(await within(history()).findByText('Nursing observations · c0000000')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: 'notes-2', fresh: false })
    expect(within(pages).getByText('Page 2')).toBeTruthy()
    expect(historyRows()).toContainEqual(['Nursing observations · c0000000', `/provider/nursing/${ENCOUNTER_ID}~${OBSERVATION_ID}`])

    // A failed move keeps the page shown and says so beside its pager.
    refuseFirst = true
    fireEvent.click(within(pages).getByRole('button', { name: 'Previous page' }))
    const failed = await within(pages).findByRole('alert')
    expect(failed.textContent).toContain('The page could not be loaded.')
    expect(within(history()).getByText('Nursing observations · c0000000')).toBeTruthy()
    expect(within(pages).getByText('Page 2')).toBeTruthy()
    // The record itself is unaffected, and no cursor reaches the address.
    expect(within(saved()).getByText('120/80')).toBeTruthy()
    expect(window.location.href).not.toContain('notes-2')
  })

  it('audit 15: Laboratory and Pharmacy rows link only for a role that may open Consultation (encounter read)', async () => {
    staff.permissions = ['ehr.vital.read', 'ehr.vital.write', 'ehr.lab-request.read', 'ehr.prescription.read']
    others = { 'lab-requests': [LAB], prescriptions: [PRESCRIPTION] }
    open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'f0000000' })
    await waitFor(() => expect(within(history()).queryByText('Loading records…')).toBeNull())
    // Named, not linked: Consultation (where the visit and its orders open) needs encounter read.
    expect(historyRows()).toEqual([
      ['Consultation · e0000000', null],
      ['Laboratory · Full blood count', null],
      ['Pharmacy · Prescription', null],
    ])
    expect(within(history()).queryByRole('link')).toBeNull()
  })

  it('decision 4: the saved record, the versions and the quick view write the measurement labels properly', async () => {
    const all = { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 72, temperatureC: '36.6', oxygenSaturationPercent: '98', respiratoryRate: 16, weightKg: '68.4', heightCm: '170' }
    vitals = [{ ...VITAL, ...all, currentCorrectionNo: 1, rowVersion: '2' }]
    api.vitalCorrections.mockResolvedValue([{ ...CORRECTIONS[0]!, replacementValues: { ...all, pulseBpm: 76 } }])
    const proper = ['BP', 'Pulse', 'Temperature', 'SpO₂', 'Respiratory rate', 'Weight', 'Height']
    const view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'f0000000' })
    expect(await within(saved()).findByText('Cuff too small')).toBeTruthy()
    expect(labels(saved())).toEqual(['Visit', 'Complaint', ...proper, 'Reason', 'Corrected at'])
    const versions = screen.getByRole('heading', { level: 2, name: 'Earlier versions' }).closest('section')!
    expect(labels(versions)).toEqual(['Version', ...proper])
    for (const raw of ['Bp', 'Spo2', 'Respiratory Rate']) expect(screen.queryByText(raw)).toBeNull()
    view.unmount()

    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view f0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    await within(drawer).findByText('76')
    expect(labels(drawer)).toEqual(expect.arrayContaining(proper))
    for (const raw of ['Bp', 'Spo2', 'Respiratory Rate']) expect(within(drawer).queryByText(raw)).toBeNull()
  })

  it('uses real buttons and links: Back to list, the action and its submit', async () => {
    await openRecord()
    const back = screen.getByRole('button', { name: 'Back to list' })
    expect(back.tagName).toBe('BUTTON')
    const amend = await screen.findByRole('button', { name: 'Correct these vitals' })
    expect(amend.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(amend)
    // Today's toggle: "Close correction" while open (staff/routes/Clinical.tsx:792).
    expect(amend.getAttribute('aria-expanded')).toBe('true')
    expect(amend.textContent).toBe('Close correction')
    expect(screen.getByRole('button', { name: 'Save correction' }).getAttribute('type')).toBe('submit')
    fireEvent.click(amend)
    expect(amend.textContent).toBe('Correct these vitals')
    expect(screen.queryByRole('button', { name: 'Save correction' })).toBeNull()
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { level: 1, name: 'Triage & Vitals' })).toBeTruthy()
  })
})
