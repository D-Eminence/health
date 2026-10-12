import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

/**
 * Clinical notes as hid-system EHR takes them (ehr/clinical-notes/clinical-notes.controller.ts,
 * ehr/shared/clinical.dto.ts): a draft is created with its type (1-80
 * characters), title (1-240) and content; its status is changed with the loaded
 * version and a reason (a draft is signed, or marked entered in error); and
 * content is changed only by appending a revision, with the loaded version and a
 * reason. A create or revision retried after a failure reuses its key, so EHR
 * records it once.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const draft = { id: 'note-1', patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
  noteType: 'Consultation', title: 'Admission note', status: 'draft', rowVersion: '2' }
const revision = { id: 'revision-1', revisionNo: 1, content: 'Fever for three days.\nNo rash.', changeReason: 'Initial note',
  createdAt: '2026-10-10T08:05:00.000Z' }
const WRITE = ['ehr.encounter.read', 'ehr.note.read', 'ehr.note.write']

let notes: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = WRITE
  notes = [draft]
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async () => ({ items: notes, nextCursor: null }))
  api.createRecord.mockResolvedValue({ ...draft, id: 'note-2' })
  api.updateRecord.mockResolvedValue({ ...draft, status: 'signed', rowVersion: '3' })
  api.noteRevisions.mockResolvedValue([revision])
  api.addNoteRevision.mockResolvedValue({ ...revision, id: 'revision-2', revisionNo: 2 })
})

// A required field's label ends in a marker the reader does not hear.
function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }
function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

async function openNotes() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  await screen.findByText('Admission note')
}

async function draftForm() {
  await openNotes()
  return (await screen.findByRole('button', { name: 'Save draft' })).closest('form')!
}

async function openContent() {
  await openNotes()
  fireEvent.click(screen.getByRole('button', { name: 'Review note content' }))
  await screen.findByText(/Fever for three days/)
}

describe('creating a draft note', () => {
  it('sends the type, title and content as a draft, after rechecking access', async () => {
    const form = await draftForm()
    type(form, 'Note type', 'Consultation')
    type(form, 'Title', 'Follow-up')
    type(form, 'Clinical note', 'Afebrile today.')
    api.lookupPatient.mockClear()
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'clinical-notes',
      { noteType: 'Consultation', title: 'Follow-up', status: 'draft', content: 'Afebrile today.' }, expect.any(String)))
    expect(api.lookupPatient.mock.invocationCallOrder[0]).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
  })

  it('reuses its key when the same draft is retried after a failure', async () => {
    api.createRecord.mockRejectedValueOnce(new Error('Network error'))
    const form = await draftForm()
    type(form, 'Note type', 'Consultation')
    type(form, 'Title', 'Follow-up')
    type(form, 'Clinical note', 'Afebrile today.')
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    expect(await within(form).findByText('Network error')).toBeTruthy()

    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('names each field EHR refused with 400 VALIDATION_FAILED, not just that some were invalid', async () => {
    // As EHR's ValidationPipe answers (hid-system ehr-api main.ts): a field and its class-validator messages.
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', { code: 'VALIDATION_FAILED',
      details: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] },
        { field: 'noteType', messages: ['noteType must be longer than or equal to 1 characters'] }] }))
    const form = await draftForm()
    type(form, 'Note type', 'Consultation')
    type(form, 'Title', 'Follow-up')
    type(form, 'Clinical note', 'Afebrile today.')
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))

    const refusal = await within(form).findByText(/One or more request fields are invalid/)
    expect(refusal.closest('[role="alert"]')?.textContent).toContain('Title must be shorter than or equal to 240 characters')
    expect(refusal.closest('[role="alert"]')?.textContent).toContain('Note type must be longer than or equal to 1 characters')
  })

  it('limits the type and title to what EHR accepts', async () => {
    const form = await draftForm()
    expect((within(form).getByLabelText(labelled('Note type')) as HTMLInputElement).maxLength).toBe(80)
    expect((within(form).getByLabelText(labelled('Title')) as HTMLInputElement).maxLength).toBe(240)
    expect((within(form).getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement).maxLength).toBe(100000)
  })
})

describe('reviewing a note', () => {
  it('shows each revision with its line breaks kept', async () => {
    await openContent()
    expect(screen.getByText(/Fever for three days/).textContent).toBe('Fever for three days.\nNo rash.')
    expect(api.noteRevisions).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'note-1')
  })

  it('signs a draft with the loaded version and a reason', async () => {
    await openContent()
    const form = screen.getByRole('button', { name: 'Update status' }).closest('form')!
    const options = within(within(form).getByLabelText(labelled('New status'))).getAllByRole('option').map(option => (option as HTMLOptionElement).value)
    expect(options).toEqual(['signed', 'entered_in_error'])
    type(form, 'New status', 'signed')
    type(form, 'Reason for change', 'Reviewed with the patient')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Reviewed with the patient', status: 'signed' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
  })

  it('shows a version conflict where the change was made, and changes nothing', async () => {
    api.updateRecord.mockRejectedValueOnce(new HidApiError(412, 'The note changed since it was loaded.', { code: 'VERSION_CONFLICT' }))
    await openContent()
    const form = screen.getByRole('button', { name: 'Update status' }).closest('form')!
    type(form, 'Reason for change', 'Reviewed with the patient')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    expect(await within(form).findByText('The note changed since it was loaded.')).toBeTruthy()
    expect(screen.queryByText('Clinical note status updated.')).toBeNull()
  })

  it('records a revision with the loaded version and a reason, reusing its key on a retry', async () => {
    api.addNoteRevision.mockRejectedValueOnce(new Error('Network error'))
    await openContent()
    const form = screen.getByRole('button', { name: 'Record revision' }).closest('form')!
    type(form, 'Content', 'Fever for three days.\nNo rash. Taking fluids.')
    type(form, 'Reason for revision', 'Added fluid intake')
    fireEvent.click(within(form).getByRole('button', { name: 'Record revision' }))
    expect(await screen.findByText('Network error')).toBeTruthy()

    fireEvent.click(within(form).getByRole('button', { name: 'Record revision' }))
    await waitFor(() => expect(api.addNoteRevision).toHaveBeenCalledTimes(2))
    expect(api.addNoteRevision).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Added fluid intake', content: 'Fever for three days.\nNo rash. Taking fluids.' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
  })

  it('offers no change under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openContent()
    expect(await screen.findByText(/Read-only access/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record revision' })).toBeNull()
  })

  it('offers no change to a role without ehr.note.write', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.note.read']
    await openContent()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record revision' })).toBeNull()
  })
})
