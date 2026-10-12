import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * NEW-PEHR-ACTION-FOCUS on the clinical record (the provider counterpart of
 * OCR-A11Y-01). A change rebuilds the form that made it for the record's new
 * version, or removes it once the record reaches a final status, and focus fell
 * to the page; the confirmation was a status node inserted with its text, which
 * screen readers do not reliably announce. Focus now moves to where the work
 * continues once the record is read again, only if it was lost, and the page's
 * status region, mounted throughout, says what was saved. A control whose
 * request is running stays focusable (aria-disabled) and ignores a second press.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), updateEncounter: vi.fn(), updateDiagnosis: vi.fn(), vitalCorrections: vi.fn(), correctVital: vi.fn(),
  noteRevisions: vi.fn(), addNoteRevision: vi.fn(), acceptPrescription: vi.fn(),
}))
const workspace = vi.hoisted(() => ({ lock: null as string | null }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.vital.read', 'ehr.vital.write',
        'ehr.diagnosis.read', 'ehr.diagnosis.write', 'ehr.prescription.read', 'ehr.prescription.write'],
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
    lock: workspace.lock,
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z' }
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
const prescription = { ...base, id: 'rx-1', medicationDisplay: 'Amoxicillin', frequency: 'Three times daily', instructions: 'With food',
  doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', status: 'draft', rowVersion: '1' }
const diagnosis = { ...base, id: 'diagnosis-1', codeSystem: 'ICD-10', code: 'B54', display: 'Malaria', clinicalStatus: 'active',
  verificationStatus: 'provisional', notes: null, rowVersion: '2' }
const vital = { ...base, id: 'vital-1', recordedAt: base.createdAt, pulseBpm: 72, systolicMmhg: null, diastolicMmhg: null,
  currentCorrectionNo: 0, rowVersion: '1' }
const note = { ...base, id: 'note-1', noteType: 'Consultation', title: 'Admission note', status: 'draft', rowVersion: '2' }

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  workspace.lock = null
  records = { prescriptions: [prescription], diagnoses: [diagnosis], vitals: [vital], 'clinical-notes': [note] }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockImplementation(async () => ({ items: [encounter], nextCursor: null }))
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: records[kind] ?? [], nextCursor: null }))
  api.vitalCorrections.mockResolvedValue([])
  api.noteRevisions.mockResolvedValue([{ id: 'revision-1', revisionNo: 1, content: 'Fever.', changeReason: 'Initial', createdAt: base.createdAt }])
})

function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }
function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** The page's status region, which must be there before the step it reports. */
function statusRegion() {
  const region = document.getElementById('clinical-status')
  if (!region) throw new Error('Expected the clinical record\'s status region to stay mounted.')
  expect(region.getAttribute('role')).toBe('status')
  return region
}

async function openTab(name: string, shown: string) {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name }))
  await screen.findByText(shown)
}

/** Activates `button` as a keyboard user would: it has focus when pressed. */
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const focused = () => document.activeElement

/** A record's entry in the list, found by its title. */
function entry(title: string) {
  return screen.getByText(title).closest<HTMLElement>('.staff-list-item')!
}
/** The prescription's own status form; the encounter has one too. */
function prescriptionForm() {
  return within(entry('Amoxicillin')).getByRole('button', { name: 'Update status' }).closest('form')!
}

describe('a record status change', () => {
  it('keeps the button focusable while it runs, ignores a second press, then focuses the rebuilt form and says it', async () => {
    await openTab('Prescriptions', 'Amoxicillin')
    const region = statusRegion()
    expect(region.textContent).toBe('')
    const form = prescriptionForm()
    type(form, 'Reason for change', 'Reviewed dose')
    const saving = deferred<unknown>()
    api.updateRecord.mockReturnValueOnce(saving.promise)
    const button = within(form).getByRole('button', { name: 'Update status' })
    await press(button)
    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledTimes(1))
    const running = within(form).getByRole('button', { name: 'Updating…' })
    expect(running.getAttribute('aria-disabled')).toBe('true')
    expect((running as HTMLButtonElement).disabled).toBe(false)
    expect(focused()).toBe(running)
    await act(async () => { fireEvent.click(running) })
    expect(api.updateRecord).toHaveBeenCalledTimes(1)

    records.prescriptions = [{ ...prescription, status: 'active', rowVersion: '2' }]
    await act(async () => { saving.resolve({ ...prescription, status: 'active', rowVersion: '2' }) })
    await waitFor(() => expect(focused()).toBe(document.getElementById('prescription-rx-1-status')))
    expect(form.isConnected).toBe(false)
    expect(region.isConnected).toBe(true)
    expect(region.textContent).toBe('Prescription status updated.')
  })

  it('focuses the record itself once a final status removes the form', async () => {
    records.prescriptions = [{ ...prescription, status: 'active', rowVersion: '3' }]
    await openTab('Prescriptions', 'Amoxicillin')
    const form = prescriptionForm()
    type(form, 'New status', 'completed')
    type(form, 'Reason for change', 'Course finished')
    api.updateRecord.mockResolvedValue({ ...prescription, status: 'completed', rowVersion: '4' })
    records.prescriptions = [{ ...prescription, status: 'completed', rowVersion: '4' }]
    await press(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('record-rx-1-title')))
    expect(within(entry('Amoxicillin')).queryByRole('button', { name: 'Update status' })).toBeNull()
    expect(statusRegion().textContent).toBe('Prescription status updated.')
  })

  it('leaves focus where the user moved it while the change ran', async () => {
    await openTab('Prescriptions', 'Amoxicillin')
    const form = prescriptionForm()
    type(form, 'Reason for change', 'Reviewed dose')
    const saving = deferred<unknown>()
    api.updateRecord.mockReturnValueOnce(saving.promise)
    await press(within(form).getByRole('button', { name: 'Update status' }))
    const elsewhere = screen.getByRole('button', { name: 'Refresh encounters' })
    elsewhere.focus()
    records.prescriptions = [{ ...prescription, status: 'active', rowVersion: '2' }]
    await act(async () => { saving.resolve({}) })
    await waitFor(() => expect(statusRegion().textContent).toBe('Prescription status updated.'))
    expect(focused()).toBe(elsewhere)
  })

  it('waits for the workspace to open before moving focus', async () => {
    await openTab('Prescriptions', 'Amoxicillin')
    const form = prescriptionForm()
    type(form, 'Reason for change', 'Reviewed dose')
    api.updateRecord.mockResolvedValue({})
    records.prescriptions = [{ ...prescription, status: 'active', rowVersion: '2' }]
    workspace.lock = 'checking'
    await press(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(statusRegion().textContent).toBe('Prescription status updated.'))
    expect(focused()).not.toBe(document.getElementById('prescription-rx-1-status'))
  })
})

describe('other changes that rebuild or remove their form', () => {
  it('a diagnosis marked entered in error: focus moves to the diagnosis', async () => {
    await openTab('Diagnoses', 'Malaria')
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    type(form, 'Verification', 'entered_in_error')
    type(form, 'Reason for change', 'Wrong patient')
    api.updateDiagnosis.mockResolvedValue({})
    records.diagnoses = [{ ...diagnosis, verificationStatus: 'entered_in_error', rowVersion: '3' }]
    await press(within(form).getByRole('button', { name: 'Update diagnosis' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('record-diagnosis-1-title')))
    expect(statusRegion().textContent).toBe('Diagnosis updated.')
  })

  it('a diagnosis change: focus moves to the rebuilt form', async () => {
    await openTab('Diagnoses', 'Malaria')
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    type(form, 'Verification', 'confirmed')
    type(form, 'Reason for change', 'Blood film')
    api.updateDiagnosis.mockResolvedValue({})
    records.diagnoses = [{ ...diagnosis, verificationStatus: 'confirmed', rowVersion: '3' }]
    await press(within(form).getByRole('button', { name: 'Update diagnosis' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('diagnosis-diagnosis-1-clinical')))
  })

  it('a vital correction: focus moves to the rebuilt vitals', async () => {
    await openTab('Vitals', '72 bpm')
    fireEvent.click(screen.getByRole('button', { name: 'Correct these vitals' }))
    const form = screen.getByRole('button', { name: 'Save correction' }).closest('form')!
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Misread')
    api.correctVital.mockResolvedValue({ id: 'correction-1', vitalId: 'vital-1', correctionNo: 1 })
    api.vitalCorrections.mockResolvedValue([{ id: 'correction-1', vitalId: 'vital-1', correctionNo: 1, replacementValues: { pulseBpm: 78 },
      reason: 'Misread', createdAt: base.createdAt }])
    records.vitals = [{ ...vital, currentCorrectionNo: 1, rowVersion: '2' }]
    await press(within(form).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('record-vital-1-title')))
    expect(statusRegion().textContent).toBe('Vital correction saved.')
  })

  it('an encounter status change: focus moves to the rebuilt form, or to the documentation once completed', async () => {
    await openTab('Notes', 'Admission note')
    const form = screen.getByText('Encounter status').closest('form')!
    type(form, 'New status', 'completed')
    type(form, 'Reason for change', 'Discharged')
    api.updateEncounter.mockResolvedValue({ ...encounter, status: 'completed', rowVersion: 2 })
    api.encounters.mockImplementation(async () => ({ items: [{ ...encounter, status: 'completed', rowVersion: 2 }], nextCursor: null }))
    await press(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 2, name: 'Care documentation' })))
    expect(statusRegion().textContent).toBe('Encounter status updated.')
  })

  it('a note revision: the form stays while the note is read again, keeping focus, and the note says it', async () => {
    await openTab('Notes', 'Admission note')
    fireEvent.click(screen.getByRole('button', { name: 'Review note content' }))
    const form = (await screen.findByRole('button', { name: 'Record revision' })).closest('form')!
    const noteStatus = document.getElementById('note-note-1-status-region')
    expect(noteStatus?.getAttribute('role')).toBe('status')
    type(form, 'Content', 'Fever settled.')
    type(form, 'Reason for revision', 'Follow-up')
    api.addNoteRevision.mockResolvedValue({ id: 'revision-2', revisionNo: 2 })
    const reading = deferred<unknown[]>()
    api.noteRevisions.mockReturnValueOnce(reading.promise)
    const button = within(form).getByRole('button', { name: 'Record revision' })
    await press(button)
    // Said once, and kept while the revisions are read again.
    await waitFor(() => expect(noteStatus?.textContent).toBe('A new note revision was recorded.'))
    await waitFor(() => expect(api.noteRevisions).toHaveBeenCalledTimes(2))
    expect(noteStatus?.textContent).toBe('A new note revision was recorded.')
    expect(form.isConnected).toBe(true)
    expect(focused()).toBe(button)
    await act(async () => { reading.resolve([{ id: 'revision-2', revisionNo: 2, content: 'Fever settled.', changeReason: 'Follow-up', createdAt: base.createdAt }]) })
    expect(await screen.findByText('Fever settled.')).toBeTruthy()
    expect(noteStatus?.textContent).toBe('A new note revision was recorded.')
    expect(noteStatus?.isConnected).toBe(true)
    expect(focused()).toBe(button)
  })
})

describe('a record created', () => {
  it('keeps focus on the form’s button, unavailable while it saves, and says it was saved', async () => {
    await openTab('Diagnoses', 'Malaria')
    const form = screen.getByRole('button', { name: 'Save record' }).closest('form')!
    type(form, 'Code system', 'ICD-10')
    type(form, 'Code', 'A01')
    type(form, 'Display', 'Typhoid')
    const saving = deferred<unknown>()
    api.createRecord.mockReturnValueOnce(saving.promise)
    const button = within(form).getByRole('button', { name: 'Save record' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(focused()).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.createRecord).toHaveBeenCalledTimes(1)
    await act(async () => { saving.resolve({ id: 'diagnosis-2' }) })
    await waitFor(() => expect(statusRegion().textContent).toBe('Clinical record saved by the backend.'))
    expect(focused()).toBe(button)
    expect(button.getAttribute('aria-disabled')).toBeNull()
  })
})
