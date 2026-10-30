import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NursingWorkspace, nursingStatus } from '../../../ehr-blue/clinical/nursing/NursingWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Nursing observations: today's clinical notes of type "Nursing observation" (the design's category as the title,
 * details and units as the content) on the open patient's encounters, in the design's list, create page and record
 * page, where "Amend observation" is today's note revision. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const ALL = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.note.read', 'ehr.note.write']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'inpatient', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Observation', rowVersion: 1,
}
const NOTE_ID = 'c0000000-0000-4000-8000-000000000001'
const NEW_ID = 'c1111111-0000-4000-8000-000000000002'
const NOTE = {
  id: NOTE_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T09:00:00.000Z',
  noteType: 'Nursing observation', title: 'Vitals', status: 'draft', rowVersion: '2',
}
const CONSULTATION = { ...NOTE, id: 'c2222222-0000-4000-8000-000000000003', noteType: 'Consultation', title: 'Consultation note' }
const FIRST = { id: 'revision-1', revisionNo: 1, content: 'Fictional vitals observation\n\nUnits / dose: demo', changeReason: 'Initial draft', createdAt: '2026-10-30T09:00:00.000Z' }
const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'
const RECORD = `/${ENCOUNTER_ID}~${NOTE_ID}`

let notes: unknown[]
let revisions: unknown[]

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
  notes = [NOTE, CONSULTATION]
  revisions = [FIRST]
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockImplementation(async () => ({ items: notes, nextCursor: null }))
  api.noteRevisions.mockImplementation(async () => revisions)
  api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, _kind: string, body: { content: string }) => {
    const saved = { ...NOTE, ...body, id: NEW_ID, encounterId }
    notes = [saved, ...notes]
    revisions = [{ ...FIRST, content: body.content }]
    return saved
  })
  api.addNoteRevision.mockImplementation(async (_f: string, _p: string, _e: string, _n: string, input: { content: string; changeReason: string }) => {
    const revision = { id: 'revision-2', revisionNo: 2, content: input.content, changeReason: input.changeReason, createdAt: '2026-10-30T10:00:00.000Z' }
    revisions = [...revisions, revision]
    notes = [{ ...NOTE, rowVersion: '3' }]
    return revision
  })
})

function open(rest = '') {
  return renderPage(<NursingWorkspace />, 'nursing', rest)
}

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

function control(scope: HTMLElement, label: string) {
  return within(scope).getByLabelText(labelled(label)) as HTMLInputElement
}

function described(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('Nursing observations list', () => {
  it('is live: every part runs on today’s clinical notes', () => {
    expect(nursingStatus).toBe('live')
  })

  it('shows the loading state, then the patient’s nursing observations only, after the access re-check', async () => {
    const page = deferred<{ items: unknown[]; nextCursor: null }>()
    api.encounters.mockReturnValueOnce(page.promise)
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Nursing observations' })).toBeTruthy()
    expect(await screen.findByText('Loading records…')).toBeTruthy()
    await act(async () => page.resolve({ items: [ENCOUNTER], nextCursor: null }))

    const table = await screen.findByRole('table', { name: 'Nursing observations' })
    const links = within(table).getAllByRole('link', { name: /^c/ })
    expect(links.map(link => link.textContent)).toEqual(['c0000000'])
    expect(links[0]!.getAttribute('href')).toBe(`/ehr/nursing/${ENCOUNTER_ID}~${NOTE_ID}`)
    expect(within(table).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(table).getByText('draft')).toBeTruthy()
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes')
    // A note's content is read only when it is opened, as today.
    expect(api.noteRevisions).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('opens the record quick view, and Escape closes it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view c0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('Vitals')).toBeTruthy()
    expect(within(drawer).getByText('e0000000')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Open full record' }).tagName).toBe('BUTTON')
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('has the empty states and shows refused reads', async () => {
    notes = [CONSULTATION]
    let view = open()
    expect(await screen.findByText('Create the first record when you have the appropriate permission.')).toBeTruthy()
    view.unmount()
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    view = open()
    expect(await screen.findByText('No encounters are available for this patient and facility.')).toBeTruthy()
    view.unmount()
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    view = open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    view.unmount()
    api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
    api.records.mockRejectedValue(new HidApiError(403, 'This role may not read notes.', { code: 'FORBIDDEN' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('This role may not read notes.')
  })

  it('says so, and reads nothing, when the role may not read notes', async () => {
    staff.permissions = ['ehr.vital.read']
    open()
    expect(screen.getByText('Your current facility role does not grant access to encounter records.')).toBeTruthy()
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('shows the read-only notice and nothing to create when the grant does not allow changes', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (404)', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('gives an emergency patient the read-only gate, and asks for a patient when none is open', () => {
    staff.activePatient = activePatient('emergency')
    const view = open()
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.records).not.toHaveBeenCalled()
    view.unmount()
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
  })

  it('opens "New nursing observations" from Create record', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New nursing observations' })).toBeTruthy()
  })
})

describe('New nursing observations', () => {
  async function openNew() {
    open('/new')
    const save = await screen.findByRole('button', { name: 'Save record' })
    return save.closest('form')!
  }

  it('saves the observation as today’s draft clinical note after the access re-check, then opens it', async () => {
    const form = await openNew()
    // Only the encounters are read for the "Visit"; no notes.
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
    expect(api.records).not.toHaveBeenCalled()
    expect((screen.getByLabelText(labelled('Patient')) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe(`${PATIENT_NAME} · ${PATIENT_HID}`)
    const category = control(form, 'Observation category') as unknown as HTMLSelectElement
    expect(Array.from(category.options).map(option => option.textContent)).toEqual(['Select…', 'Vitals', 'Medication administration', 'Handover', 'Care task'])
    type(form, 'Visit', ENCOUNTER_ID)
    type(form, 'Observation category', 'Medication administration')
    type(form, 'Observation / administration details', 'Gave paracetamol by mouth')
    type(form, 'Units / dose if applicable', '500 mg')
    // Enter in a field submits the form: the button is its submit button.
    fireEvent.submit(form)

    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Nursing observation', title: 'Medication administration', status: 'draft', content: 'Gave paracetamol by mouth\n\nUnits / dose: 500 mg',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder.at(-2)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(screen.getByRole('heading', { level: 1, name: 'c1111111' })).toBeTruthy()
    const saved = screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section')!
    expect(await within(saved).findByText('Gave paracetamol by mouth')).toBeTruthy()
    expect(within(saved).getByText('500 mg')).toBeTruthy()
  })

  it('checks the required fields, and shows a server refusal at its field; a retry reuses the key', async () => {
    const form = await openNew()
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect(within(form).getAllByText('Complete this field.')).toHaveLength(3)
    expect(document.activeElement).toBe(control(form, 'Visit'))
    expect(api.createRecord).not.toHaveBeenCalled()

    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] }],
    }))
    type(form, 'Visit', ENCOUNTER_ID)
    type(form, 'Observation category', 'Handover')
    type(form, 'Observation / administration details', 'Settled overnight')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('One or more request fields are invalid. Title must be shorter than or equal to 240 characters.')
    expect(described(control(form, 'Observation category'))).toContain('Title must be shorter than or equal to 240 characters.')
    type(form, 'Observation category', 'Handover')
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    await screen.findByText('Clinical record saved by the backend.')
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('offers no form under a read-only grant, nor without note write permission', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    const view = open('/new')
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
    view.unmount()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    staff.permissions = ['ehr.vital.read', 'ehr.note.read']
    open('/new')
    expect(await screen.findByText('You do not have permission to create this record.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
  })
})

describe('Nursing observation record', () => {
  async function openRecord() {
    open(RECORD)
    expect(await screen.findByRole('heading', { level: 1, name: 'c0000000' })).toBeTruthy()
  }

  function saved() {
    return screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section')!
  }

  async function amendForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Amend observation' }))
    return screen.getAllByRole('button', { name: 'Amend observation' }).at(-1)!.closest('form')!
  }

  it('shows the saved record with the note’s latest revision, read when it is opened', async () => {
    const read = deferred<unknown[]>()
    api.noteRevisions.mockReturnValueOnce(read.promise)
    await openRecord()
    expect(within(saved()).getByText('Loading note revisions…')).toBeTruthy()
    await act(async () => read.resolve([FIRST]))
    const card = saved()
    expect(within(card).getByText('e0000000')).toBeTruthy()
    expect(within(card).getByText('Vitals')).toBeTruthy()
    expect(within(card).getByText('Fictional vitals observation')).toBeTruthy()
    expect(within(card).getByText('demo')).toBeTruthy()
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, NOTE_ID)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`)).toBeTruthy()
  })

  it('says a consultation note is not found here', async () => {
    open(`/${ENCOUNTER_ID}~${CONSULTATION.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
  })

  it('amends as today’s note revision, after the access re-check, and keeps what it replaced', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    api.lookupPatient.mockClear()
    fireEvent.submit(form)

    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, NOTE_ID, {
      expectedRowVersion: 2, changeReason: 'Wrong patient bed', content: 'Corrected vitals observation\n\nUnits / dose: demo',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.addNoteRevision.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { fresh: true })
    expect(await within(saved()).findByText('Corrected vitals observation')).toBeTruthy()
    const versions = screen.getByRole('heading', { level: 2, name: 'Preserved versions & amendments' }).closest('section')!
    expect(within(versions).getByText('2026-10-30T10:00:00.000Z · draft · Wrong patient bed')).toBeTruthy()
    expect(within(versions).getByText('Fictional vitals observation')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Available actions')
  })

  it('refuses as today: revised content and a reason of three characters; a refusal shows in the form and a retry reuses the key', async () => {
    await openRecord()
    const form = await amendForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(within(form).getByText('Enter the revised note content.')).toBeTruthy()
    expect(within(form).getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(document.activeElement).toBe(control(form, 'Corrected record'))

    api.addNoteRevision.mockRejectedValueOnce(new HidApiError(412, 'The note changed since it was loaded.', { code: 'ROW_VERSION_MISMATCH' }))
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('The note changed since it was loaded.')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    await screen.findByText('A new note revision was recorded.')
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('offers no amendment when the content cannot be read, under a read-only grant, or once entered in error', async () => {
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    let view = open(RECORD)
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
    view.unmount()
    api.noteRevisions.mockImplementation(async () => revisions)
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    view = open(RECORD)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
    view.unmount()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    notes = [{ ...NOTE, status: 'entered_in_error' }]
    open(RECORD)
    expect(await screen.findByText('entered in error')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
  })

  it('closes the patient when the re-check before an amendment is refused', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()
  })

  it('gives an emergency patient the read-only gate', () => {
    staff.activePatient = activePatient('emergency')
    open(RECORD)
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(api.encounter).not.toHaveBeenCalled()
  })
})
