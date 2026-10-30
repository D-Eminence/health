import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace, consultStatus } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Consultation, the list and "New consultation": the open patient's encounters (today's paging, the access re-check
 * before each read) in the design's table and quick view, and a new encounter with its draft note and diagnosis.
 * Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Connected orders part</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
}))

const ALL = [
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
  'ehr.document.read', 'ehr.document.write',
]
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 1,
}
const SECOND = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed', chiefComplaint: null }
const NEW_ID = 'e1111111-0000-4000-8000-000000000003'
const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.noteRevisions.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.createEncounter.mockResolvedValue({ ...ENCOUNTER, id: NEW_ID, chiefComplaint: 'Cough' })
  api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, kind: string) => ({ id: `${kind}-1`, patientId: PATIENT_ID, encounterId, createdAt: '2026-10-30T09:00:00.000Z' }))
})

function open(rest = '') {
  return renderPage(<ConsultWorkspace />, 'consult', rest)
}

function where() {
  return screen.queryByTestId('elsewhere')?.textContent ?? null
}

describe('Consultation list', () => {
  it('is partial: encounters, notes, diagnoses and documents are live; some connected orders are sample', () => {
    expect(consultStatus).toBe('partial')
  })

  it('shows the loading state, then the patient’s encounters in the design’s table, after the access re-check', async () => {
    const page = deferred<{ items: unknown[]; nextCursor: null }>()
    api.encounters.mockReturnValueOnce(page.promise)
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeTruthy()
    expect(await screen.findByText('Loading encounters…')).toBeTruthy()
    await act(async () => page.resolve({ items: [ENCOUNTER, SECOND], nextCursor: null }))

    const table = await screen.findByRole('table', { name: 'Encounters' })
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    const link = within(table).getByRole('link', { name: 'e0000000' })
    expect(link.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(within(table).getAllByText(PATIENT_NAME)).toHaveLength(2)
    expect(within(table).getByText('in progress')).toBeTruthy()
    expect(within(table).getByText('completed')).toBeTruthy()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    // Nothing identifying in the address.
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('opens the record quick view, and Escape closes it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view e0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { level: 3, name: 'e0000000' })).toBeTruthy()
    expect(within(drawer).getByText('Outpatient')).toBeTruthy()
    expect(within(drawer).getByText('Fever for two days')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Open full record' })).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('searches the page shown and says when nothing matches', async () => {
    api.encounters.mockResolvedValue({ items: [ENCOUNTER, SECOND], nextCursor: null })
    open()
    await screen.findByRole('table', { name: 'Encounters' })
    fireEvent.change(screen.getByLabelText('Search Consultation'), { target: { value: 'fever' } })
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search Consultation'), { target: { value: 'nothing like this' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(2)
  })

  it('shows today’s empty sentence when the patient has no encounters', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    open()
    expect(await screen.findByText('No encounters are available for this patient and facility.')).toBeTruthy()
  })

  it('shows a refused read as an alert', async () => {
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
  })

  it('pages with the backend cursor, re-checking access each time, and restarts on a cursor EHR no longer accepts', async () => {
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') return { items: [SECOND], nextCursor: null }
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    open()
    const pager = await screen.findByRole('navigation', { name: 'Record pages' })
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    expect((within(pager).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(await within(pager).findByText('Page 2')).toBeTruthy()
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: 'e2222222' }).getAttribute('href')).toBe(`/provider/clinical/${SECOND.id}`)

    // A failed page read is an alert; the page shown stays.
    api.encounters.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The page could not be loaded. EHR is unavailable.')
    expect(within(pager).getByText('Page 2')).toBeTruthy()

    // Refresh re-reads the page shown; a stale cursor starts again from the newest.
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') throw new HidApiError(400, 'The cursor is invalid.', { code: 'INVALID_CURSOR' })
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh encounters' }))
    expect(await screen.findByText('This list changed since it was opened, so it shows the newest entries again.')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Record pages' })).getByText('Page 1')).toBeTruthy()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: true })
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: true })
  })

  it('hides the pager when there is one page', async () => {
    open()
    await screen.findByRole('table', { name: 'Encounters' })
    expect(screen.queryByRole('navigation', { name: 'Record pages' })).toBeNull()
  })

  it('offers "Create record" as a real button only when the grant allows changes', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
  })

  it('shows today’s read-only sentence in the design’s banner, with no "Create record"', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.getByText('Changes are unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('fails closed when write access cannot be confirmed', async () => {
    api.consentStatus.mockRejectedValue(new HidApiError(503, 'Identity is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect(await screen.findByText('Write access could not be confirmed, so changes are unavailable. Refresh the page to try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (403)', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('asks for a patient first when none is open', () => {
    staff.activePatient = null
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeTruthy()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to patient access →' }).getAttribute('href')).toBe('/provider/patients')
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('shows the read-only emergency notice for an emergency patient, and nothing to create', () => {
    staff.activePatient = activePatient('emergency')
    open()
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.consentStatus).not.toHaveBeenCalled()
  })
})

describe('New consultation', () => {
  function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(labelled(label)), { target: { value } })
  }

  async function openNew() {
    open('/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Save record' })
  }

  it('shows the open patient and the patient context, with the allergies the patient reported', async () => {
    api.reportedHealthProfile.mockResolvedValue({ allergies: 'Penicillin', bloodGroup: null, genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    await openNew()
    const patient = screen.getByLabelText(labelled('Patient')) as HTMLSelectElement
    expect(patient.selectedOptions[0]?.textContent).toBe(`${PATIENT_NAME} · ${PATIENT_HID}`)
    const context = screen.getByRole('region', { name: 'Patient context' })
    expect(within(context).getByText(PATIENT_NAME)).toBeTruthy()
    expect(await within(context).findByText(/^Recorded allergies: Penicillin \(patient-reported/)).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(screen.getByText('Notes are saved as drafts. Signing needs its own reviewed action.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
  })

  it('says no allergies are recorded when the patient reported none', async () => {
    await openNew()
    expect(await screen.findByText('Recorded allergies: None recorded. Confirm with the patient.')).toBeTruthy()
  })

  it('checks required fields on submit and moves focus to the first, calling nothing', async () => {
    const save = await openNew()
    expect(save.getAttribute('type')).toBe('submit')
    fireEvent.click(save)
    expect(screen.getAllByText('Complete this field.').length).toBeGreaterThanOrEqual(4)
    expect(document.activeElement).toBe(screen.getByLabelText(labelled('Presenting complaint')))
    expect(screen.getByLabelText(labelled('Presenting complaint')).getAttribute('aria-invalid')).toBe('true')
    expect(api.createEncounter).not.toHaveBeenCalled()
    // A diagnosis needs its code system and code.
    fill('Diagnosis / assessment', 'Malaria')
    fireEvent.click(save)
    expect(screen.getByLabelText(labelled('Diagnosis code system')).getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps today’s field limits', async () => {
    await openNew()
    expect((screen.getByLabelText(labelled('Presenting complaint')) as HTMLInputElement).maxLength).toBe(4000)
    expect((screen.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement).maxLength).toBe(100000)
    expect((screen.getByLabelText(labelled('Diagnosis / assessment')) as HTMLInputElement).maxLength).toBe(500)
    expect((screen.getByLabelText(labelled('Diagnosis code system')) as HTMLInputElement).maxLength).toBe(255)
    expect((screen.getByLabelText(labelled('Diagnosis code')) as HTMLInputElement).maxLength).toBe(100)
  })

  it('starts the encounter, writes its draft note and diagnosis, each after the access re-check, then opens it', async () => {
    const save = await openNew()
    fireEvent.change(screen.getByLabelText(labelled('Encounter type')), { target: { value: 'virtual' } })
    fill('Presenting complaint', 'Cough')
    fill('History', 'Three days of cough.')
    fill('Examination', 'Chest clear.')
    fill('Diagnosis / assessment', 'Upper respiratory infection')
    fill('Diagnosis code system', 'ICD-10')
    fill('Diagnosis code', 'J06.9')
    fill('Clinical note', 'Fluids and rest.')
    fill('Follow-up', 'Review in a week')
    // Enter in a field submits the form: the button is its submit button.
    fireEvent.submit(save.closest('form')!)

    expect(await screen.findByText('Encounter created by the backend.')).toBeTruthy()
    expect(where()).toBeNull()
    expect(api.createEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID,
      { encounterType: 'virtual', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' }, expect.any(String))
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, NEW_ID, 'clinical-notes', {
      noteType: 'Consultation', title: 'Consultation note', status: 'draft',
      content: 'History\nThree days of cough.\n\nExamination\nChest clear.\n\nClinical note\nFluids and rest.\n\nFollow-up\nReview in a week',
    }, expect.any(String))
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, NEW_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'J06.9', display: 'Upper respiratory infection', clinicalStatus: 'active', verificationStatus: 'unconfirmed',
    }, expect.any(String))
    const checks = api.lookupPatient.mock.invocationCallOrder
    expect(checks.some(order => order < api.createEncounter.mock.invocationCallOrder[0]!)).toBe(true)
    expect(checks.filter(order => order > api.createEncounter.mock.invocationCallOrder[0]! && order < api.createRecord.mock.invocationCallOrder[0]!)).toHaveLength(1)
    // The new encounter's page.
    expect(screen.getByRole('heading', { level: 1, name: 'e1111111' })).toBeTruthy()
  })

  it('shows a refused note at its field, keeps the encounter started and reuses its keys on retry', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'content', messages: ['content must be shorter than or equal to 100000 characters'] }],
    }))
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    fireEvent.click(save)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('One or more request fields are invalid. Content must be shorter than or equal to 100000 characters.')
    expect(screen.getByLabelText(labelled('Clinical note')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/^Encounter created by the backend\. Outpatient · Cough\. Saving again adds the rest/)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Presenting complaint'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'e1111111' })).toBeTruthy()
    expect(api.createEncounter).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(2)
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('shows a refused encounter at its field with today’s sentences', async () => {
    api.createEncounter.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'chiefComplaint', messages: ['chiefComplaint should not be empty'] }],
    }))
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toBe('One or more request fields are invalid. Chief complaint should not be empty.')
    expect(screen.getByLabelText(labelled('Presenting complaint')).getAttribute('aria-invalid')).toBe('true')
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('shows the read-only notice and no form under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open('/new')
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
  })

  it('shows the emergency notice, not the form, for an emergency patient', () => {
    staff.activePatient = activePatient('emergency')
    open('/new')
    expect(screen.getByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
  })

  it('ends access when the re-check before saving is refused', async () => {
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    api.lookupPatient.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.createEncounter).not.toHaveBeenCalled()
  })
})
