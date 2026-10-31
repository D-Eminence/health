import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriageWorkspace, triageStatus } from '../../../ehr-blue/clinical/triage/TriageWorkspace'
import { DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Triage & Vitals: the open patient's vitals (today's records of kind "vitals", per encounter) in the design's list,
 * "New triage & vitals" with today's measurements and refusals, and the design's record page, where "Amend
 * observation" is today's appended correction with full replacement values. Everything is fictional.
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
const READ_ONLY = 'You can view this, but not change it. To add or change records, ask the patient to approve access that includes changes.'
const RECORD = `/${ENCOUNTER_ID}~${VITAL_ID}`

let vitals: unknown[]

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
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockImplementation(async () => ({ items: vitals, nextCursor: null }))
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
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    const link = within(table).getByRole('link', { name: 'f0000000' })
    expect(link.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~${VITAL_ID}`)
    expect(within(table).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(table).getByText('final')).toBeTruthy()
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
    expect(document.title).toBe('Vitals · Health ID EHR')
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
    expect(await screen.findByText('No consultations for this patient here yet.')).toBeTruthy()
    view.unmount()
    api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
    vitals = []
    open()
    expect(await screen.findByText('Create the first record when you have the appropriate permission.')).toBeTruthy()
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
    expect(ended.textContent).toContain('Your access to this patient has ended. Open the patient again to keep working.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('asks for a patient first when none is open', () => {
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to patient access →' }).getAttribute('href')).toBe('/provider/patients')
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
    expect((screen.getByLabelText(labelled('Patient')) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe(`${PATIENT_NAME} · ${PATIENT_HID}`)
    const context = screen.getByRole('region', { name: 'Patient context' })
    expect(await within(context).findByText(/Recorded allergies: Penicillin/)).toBeTruthy()
    expect(within(context).getByText(/^Triage · final · /)).toBeTruthy()
  })

  it('says "None recorded" only after a read that found no allergies; a refused, unserved or unreadable read shows nothing, as today', async () => {
    const context = () => screen.getByRole('region', { name: 'Patient context' })
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
      expect(within(context()).getByText(PATIENT_NAME)).toBeTruthy()
      expect(within(context()).queryByText(/Recorded allergies/)).toBeNull()
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
    expect(within(context()).queryByText(/Recorded allergies/)).toBeNull()
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

    expect(await screen.findByText('Saved.')).toBeTruthy()
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
    await screen.findByText('Saved.')
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
    expect(await screen.findByText('You do not have permission to create this record.')).toBeTruthy()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Amend observation' }))
    return screen.getAllByRole('button', { name: 'Amend observation' }).at(-1)!.closest('form')!
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
    expect(screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`)).toBeTruthy()
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    const history = screen.getByRole('heading', { level: 2, name: 'History' }).closest('section')!
    expect(within(history).getByRole('link', { name: 'Consultation · e0000000' }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
  })

  it('says when the vitals were recorded, as the list does, and prints stored decimals as the design does (display only)', async () => {
    document.title = ''
    vitals = [{ ...VITAL, recordedAt: '2026-10-30T07:55:00.000Z', oxygenSaturationPercent: '98.00', weightKg: '68.400', temperatureC: '36.60', heightCm: '170' }]
    await openRecord()
    expect(document.title).toBe('Vitals · Health ID EHR')
    expect(screen.getByText(`Saved ${new Date('2026-10-30T07:55:00.000Z').toLocaleString('en-US')}`)).toBeTruthy()
    expect(screen.queryByText(`Saved ${new Date(VITAL.createdAt).toLocaleString('en-US')}`)).toBeNull()
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
    type(form, 'Reason', 'Repeat reading')
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
    expect(document.activeElement?.textContent).toBe('Actions')
  })

  it('refuses an unchanged correction and a short reason, as today', async () => {
    await openRecord()
    const form = await amendForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(described(within(form).getByRole('group', { name: 'Corrected vital measurements' }))).toBe('Change at least one value before saving a correction.')
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason', 'ok')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(described(input(form, 'Reason'))).toContain('Give a reason of at least 3 characters.')
    type(form, 'Diastolic BP (mmHg)', '')
    type(form, 'Reason', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(described(input(form, 'Diastolic BP (mmHg)'))).toContain('Enter both systolic and diastolic blood pressure, or leave both blank.')
    expect(api.correctVital).not.toHaveBeenCalled()
  })

  it('shows a refused correction in the form, and a retry reuses its key', async () => {
    api.correctVital.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('EHR is unavailable.')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
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
    expect(within(versions).getByText('2026-10-30T08:10:00.000Z · final · Cuff too small')).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
    // Where the design puts it: after the empty action list, as a note.
    const none = screen.getByText('Nothing more to do here.')
    expect(none.className).toBe('hid-ehr-clinical-note')
    expect(none.previousElementSibling?.className).toBe('hid-ehr-clinical-action-list')
    view.unmount()
    vitals = [{ ...VITAL, status: 'entered_in_error' }]
    open(RECORD)
    expect(await screen.findByText('Recorded in error: do not use these values. They can no longer be corrected.')).toBeTruthy()
    expect(screen.getByText('Entered in error')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
  })

  it('reads the vitals again after a 412 and says they changed; after VITAL_NOT_AMENDABLE that they were entered in error', async () => {
    api.correctVital.mockRejectedValueOnce(new HidApiError(412, 'Precondition failed', { code: 'ROW_VERSION_MISMATCH' }))
    await openRecord()
    let form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(await screen.findByText('These vitals changed since they were loaded, so the correction was not saved: check them, and correct them again if it is still needed. The list was reloaded.')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true })

    api.correctVital.mockRejectedValueOnce(new HidApiError(409, 'A vital entered in error cannot be changed', { code: 'VITAL_NOT_AMENDABLE' }))
    api.records.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    form = await amendForm()
    type(form, 'Pulse (bpm)', '79')
    type(form, 'Reason', 'Repeat reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(await screen.findByText('These vitals were marked entered in error since they were loaded, so the correction was not saved. The list could not be reloaded; refresh it to see the vitals.')).toBeTruthy()
  })

  it('offers no amendment under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openRecord()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
  })

  it('closes the patient when the re-check before a correction is refused', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason', 'Repeat reading')
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'deny' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    const ended = await screen.findByText('Access to this patient ended')
    expect(ended.closest('[role="alert"]')?.textContent).toContain('Your access to this patient has ended. Open the patient again to keep working.')
    expect(api.correctVital).not.toHaveBeenCalled()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('uses real buttons and links: Back to list, the action and its submit', async () => {
    await openRecord()
    const back = screen.getByRole('button', { name: 'Back to list' })
    expect(back.tagName).toBe('BUTTON')
    const amend = await screen.findByRole('button', { name: 'Amend observation' })
    expect(amend.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(amend)
    expect(amend.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { name: 'Amend observation' }).at(-1)!.getAttribute('type')).toBe('submit')
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { level: 1, name: 'Triage & Vitals' })).toBeTruthy()
  })
})
