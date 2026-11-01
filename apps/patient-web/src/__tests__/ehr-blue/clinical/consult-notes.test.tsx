import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Consultation, one encounter: the Notes card (every clinical note of the encounter, each with today's NotePanel
 * actions) and today's record pages on the Notes, Diagnoses and Documents cards. Everything is fictional ("Patient
 * One", HID-ZDEMAAA2).
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
  EncounterOrders: ({ encounter }: { encounter: { id: string } }) => <p>Connected orders for {encounter.id}</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ALL = [
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
  'ehr.document.read', 'ehr.document.write', 'ehr.vital.read',
]
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
/** The newest note: the consultation note the Saved record shows. */
const NOTE = {
  id: 'note-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:10:00.000Z',
  noteType: 'Consultation', title: 'Consultation note', status: 'draft', rowVersion: 2,
}
/** An older note of the same encounter: today's page never read or offered it. */
const OLDER = {
  id: 'note-0', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-29T16:00:00.000Z',
  noteType: 'Admission', title: 'Admission note', status: 'draft', rowVersion: 5,
}
const OBSERVATION = { ...NOTE, id: 'b1c6ef36-0000-4000-8000-000000000001', noteType: 'Nursing observation', title: 'Vitals', status: 'signed' }
type Revision = { id: string; revisionNo: number; content: string; changeReason: string; createdAt: string }
const FIRST_REVISIONS: Readonly<Record<string, readonly Revision[]>> = {
  'note-1': [{ id: 'rev-1', revisionNo: 1, content: 'History\nCough for three days.', changeReason: 'Initial draft', createdAt: '2026-10-30T08:10:00.000Z' }],
  'note-0': [{ id: 'rev-0', revisionNo: 1, content: 'Admitted with fever (fictional).', changeReason: 'Admission', createdAt: '2026-10-29T16:00:00.000Z' }],
}
/** Each note's revisions, as EHR holds them now. */
let revisions: Record<string, readonly Revision[]>
const DIAGNOSIS = {
  id: 'dx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:20:00.000Z', codeSystem: 'ICD-10', code: 'B54',
  display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'provisional', notes: null, rowVersion: 1,
}
const DOCUMENT = {
  id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z',
}

type Page = { items: unknown[]; nextCursor: string | null }
/** Each record kind's pages, by cursor ('' for the first page). */
let pages: Record<string, Record<string, Page | Error>>

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  revisions = { ...FIRST_REVISIONS }
  pages = {
    'clinical-notes': { '': { items: [NOTE, OBSERVATION, OLDER], nextCursor: null } },
    diagnoses: { '': { items: [DIAGNOSIS], nextCursor: null } },
    vitals: { '': { items: [], nextCursor: null } },
  }
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string }) => {
    const found = pages[kind]?.[page?.cursor ?? ''] ?? { items: [], nextCursor: null }
    if (found instanceof Error) throw found
    return found
  })
  api.noteRevisions.mockImplementation(async (_f: string, _p: string, _e: string, noteId: string) => revisions[noteId] ?? [])
  api.documents.mockResolvedValue({ items: [DOCUMENT], nextCursor: null })
  api.updateRecord.mockResolvedValue({ ...OLDER, status: 'signed', rowVersion: 6 })
  api.addNoteRevision.mockResolvedValue({ id: 'rev-0b', revisionNo: 2, content: 'x', changeReason: 'x', createdAt: '2026-10-30T09:00:00.000Z' })
})

afterEach(() => { vi.restoreAllMocks() })

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
  await screen.findByText('Cough for three days.', { exact: false })
}

function card(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement
}

/** One note's row in the Notes card, by its title. */
function noteRow(title: string) {
  return within(within(card('Clinical notes')).getByText(title).closest('li') as HTMLElement)
}

/** Opens a note's content (today's "Review note content") and waits for its revisions. */
async function review(title: string, content: string) {
  fireEvent.click(noteRow(title).getByRole('button', { name: 'Review note content' }))
  expect(await noteRow(title).findByText(content)).toBeTruthy()
}

function submitIn(row: ReturnType<typeof noteRow>, name: string) {
  return row.getAllByRole('button', { name }).find(button => button.getAttribute('type') === 'submit')!
}

function dialog() {
  return screen.getByRole('alertdialog')
}

function savedValues() {
  const saved = within(card('Note'))
  return Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
}

function many(prefix: string, count: number, make: (index: number) => Record<string, unknown>) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}`, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, ...make(index + 1) }))
}

describe('Consultation record: the Notes card (item 1)', () => {
  it('item 1: lists every clinical note of the encounter, the older one and the nursing notes included, as classic did', async () => {
    await openEncounter()
    const notes = within(card('Clinical notes'))
    expect(notes.getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['Consultation note', 'Vitals', 'Admission note'])
    // A nursing note says it is one, under its title.
    expect(noteRow('Vitals').getByText(/^Nursing observation · Recorded 30 Oct 2026, /)).toBeTruthy()
    expect(noteRow('Admission note').getByText(/^Admission · Recorded 29 Oct 2026, /)).toBeTruthy()
    expect(noteRow('Admission note').getByText('Draft')).toBeTruthy()
    // Its content is read only when asked for, as today.
    expect(api.noteRevisions).not.toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-0')
    await review('Admission note', 'Admitted with fever (fictional).')
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-0')
    expect(noteRow('Admission note').getByText('Revision 1')).toBeTruthy()
    expect(noteRow('Admission note').getByText(/^29 Oct 2026, .* · Admission$/)).toBeTruthy()
    expect(noteRow('Admission note').getByRole('button', { name: 'Hide note content' }).getAttribute('aria-expanded')).toBe('true')
    // The Saved record still summarises the newest note.
    expect(savedValues()).toMatchObject({ 'Note status': 'draft', Note: 'History\nCough for three days.' })
  })

  it('shows a visit’s nursing notes to the doctor when they are its only notes, and says "No notes" only when there are none', async () => {
    const handover = { ...OBSERVATION, id: 'b2c6ef36-0000-4000-8000-000000000002', title: 'Handover', status: 'draft' }
    pages['clinical-notes'] = { '': { items: [OBSERVATION, handover], nextCursor: null } }
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    const notes = () => within(card('Clinical notes'))
    await waitFor(() => expect(notes().getAllByRole('listitem')).toHaveLength(2))
    expect(notes().getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['Vitals', 'Handover'])
    expect(notes().queryByText('No notes for this encounter.')).toBeNull()
  })

  it('says "No notes for this encounter." when the visit has no notes at all', async () => {
    pages['clinical-notes'] = { '': { items: [], nextCursor: null } }
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    expect(await within(card('Clinical notes')).findByText('No notes for this encounter.')).toBeTruthy()
  })

  it('item 1: signs an older note under the clinician’s typed reason after SIGN is typed, after the access re-check', async () => {
    await openEncounter()
    // Nothing is signed unseen: no change until its content is read.
    expect(noteRow('Admission note').queryByRole('button', { name: 'Sign note' })).toBeNull()
    await review('Admission note', 'Admitted with fever (fictional).')
    const row = noteRow('Admission note')
    expect(row.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Hide note content', 'Refresh revisions', 'Sign note', 'Mark entered in error', 'Add a note revision',
    ])
    fireEvent.click(row.getByRole('button', { name: 'Sign note' }))
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'ok' } })
    fireEvent.click(submitIn(row, 'Sign note'))
    expect(row.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'Admission reviewed' } })
    fireEvent.click(submitIn(row, 'Sign note'))
    expect(within(dialog()).getByRole('heading', { name: 'Sign note?' })).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign note' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    const checks = api.lookupPatient.mock.calls.length
    pages['clinical-notes'] = { '': { items: [NOTE, OBSERVATION, { ...OLDER, status: 'signed', rowVersion: 6 }], nextCursor: null } }
    fireEvent.click(confirm)

    expect(await screen.findByText('Note updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-0',
      { expectedRowVersion: 5, changeReason: 'Admission reviewed', status: 'signed' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.updateRecord.mock.invocationCallOrder[0]!)
    // Today's reload: the page shown, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    await waitFor(() => expect(noteRow('Admission note').getByText('Signed')).toBeTruthy())
    // The form that held focus is gone: the note's title takes it.
    expect(document.activeElement?.textContent).toBe('Admission note')
    // The newest note is not touched.
    expect(savedValues()['Note status']).toBe('draft')
  })

  it('item 1: marks an older signed note entered in error under a typed reason, with a plain confirm', async () => {
    pages['clinical-notes'] = { '': { items: [NOTE, { ...OLDER, status: 'signed' }], nextCursor: null } }
    await openEncounter()
    await review('Admission note', 'Admitted with fever (fictional).')
    const row = noteRow('Admission note')
    // Today's transitions for a signed note: entered in error only (and a revision).
    expect(row.queryByRole('button', { name: 'Sign note' })).toBeNull()
    fireEvent.click(row.getByRole('button', { name: 'Mark entered in error' }))
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'Wrong patient' } })
    fireEvent.click(submitIn(row, 'Mark entered in error'))
    expect(within(dialog()).getByRole('heading', { name: 'Mark entered in error?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    pages['clinical-notes'] = { '': { items: [NOTE, { ...OLDER, status: 'entered_in_error', rowVersion: 6 }], nextCursor: null } }
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect(await screen.findByText('Note updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-0',
      { expectedRowVersion: 5, changeReason: 'Wrong patient', status: 'entered_in_error' })
    await waitFor(() => expect(noteRow('Admission note').getByText('Entered in error')).toBeTruthy())
    // A note entered in error is read, but offers no change.
    await noteRow('Admission note').findByText('Admitted with fever (fictional).')
    expect(noteRow('Admission note').queryByRole('button', { name: 'Mark entered in error' })).toBeNull()
    expect(noteRow('Admission note').queryByRole('button', { name: 'Add a note revision' })).toBeNull()
  })

  it('item 1: shows a failed status change in its form, and changes nothing when the confirm is cancelled', async () => {
    api.updateRecord.mockRejectedValueOnce(new HidApiError(412, 'The record changed since it was read.', { code: 'PRECONDITION_FAILED' }))
    await openEncounter()
    await review('Admission note', 'Admitted with fever (fictional).')
    const row = noteRow('Admission note')
    fireEvent.click(row.getByRole('button', { name: 'Mark entered in error' }))
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'Wrong patient' } })
    fireEvent.click(submitIn(row, 'Mark entered in error'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
    await waitFor(() => expect(submitIn(row, 'Mark entered in error').getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(submitIn(row, 'Mark entered in error'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect((await row.findByRole('alert')).textContent).toBe('The record changed since it was read.')
  })

  it('item 1: records a revision of an older note after the access re-check, with today’s checks, reusing the key on retry', async () => {
    await openEncounter()
    await review('Admission note', 'Admitted with fever (fictional).')
    const row = noteRow('Admission note')
    fireEvent.click(row.getByRole('button', { name: 'Add a note revision' }))
    const content = row.getByLabelText(labelled('Content')) as HTMLTextAreaElement
    const reason = row.getByLabelText(labelled('Reason for revision')) as HTMLInputElement
    expect([content.maxLength, reason.maxLength]).toEqual([100_000, 500])
    fireEvent.change(content, { target: { value: '   ' } })
    fireEvent.change(reason, { target: { value: 'ok' } })
    fireEvent.click(row.getByRole('button', { name: 'Record revision' }))
    expect(row.getByText('Enter the revised note content.')).toBeTruthy()
    expect(row.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()

    fireEvent.change(content, { target: { value: 'Admitted with fever and chills (fictional).' } })
    fireEvent.change(reason, { target: { value: 'Symptom added' } })
    api.addNoteRevision.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(row.getByRole('button', { name: 'Record revision' }))
    expect((await row.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.addNoteRevision.mock.invocationCallOrder[0]!)
    revisions['note-0'] = [...revisions['note-0']!, { id: 'rev-0b', revisionNo: 2, content: 'Admitted with fever and chills (fictional).', changeReason: 'Symptom added', createdAt: '2026-10-30T09:00:00.000Z' }]
    fireEvent.click(row.getByRole('button', { name: 'Record revision' }))
    expect(await row.findByText('Note changes saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-0',
      { expectedRowVersion: 5, changeReason: 'Symptom added', content: 'Admitted with fever and chills (fictional).' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(await row.findByText('Revision 2')).toBeTruthy()
  })

  it('item 1: hides a note’s content, and offers no change, when it cannot be read', async () => {
    api.noteRevisions.mockImplementation(async (_f: string, _p: string, _e: string, noteId: string) => {
      if (noteId === 'note-0') throw new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
      return revisions[noteId] ?? []
    })
    await openEncounter()
    fireEvent.click(noteRow('Admission note').getByRole('button', { name: 'Review note content' }))
    expect((await noteRow('Admission note').findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(noteRow('Admission note').queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(noteRow('Admission note').queryByRole('button', { name: 'Add a note revision' })).toBeNull()
  })

  it('item 1: offers no note change under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openEncounter()
    await review('Admission note', 'Admitted with fever (fictional).')
    expect(noteRow('Admission note').getAllByRole('button').map(button => button.textContent)).toEqual(['Hide note content', 'Refresh revisions'])
  })
})

describe('Consultation record: record pages past 50 (item 6)', () => {
  it('item 6: pages the Notes card past 50 with today’s cursor under "Record pages", the Saved record keeping the newest note', async () => {
    const first = [NOTE, ...many('note-p1', 49, index => ({ noteType: 'Progress', title: `Progress note ${index}`, status: 'signed', rowVersion: 1 }))]
    const second = many('note-p2', 3, index => ({ noteType: 'Progress', title: `Older progress note ${index}`, status: 'signed', rowVersion: 1 }))
    pages['clinical-notes'] = { '': { items: first, nextCursor: 'notes-cursor-2' }, 'notes-cursor-2': { items: second, nextCursor: null } }
    await openEncounter()
    const notes = () => within(card('Clinical notes'))
    expect(notes().getAllByRole('listitem')).toHaveLength(50)
    const pager = () => within(notes().getByRole('navigation', { name: 'Record pages' }))
    expect(pager().getByText('Page 1')).toBeTruthy()
    expect((pager().getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await notes().findByText('Older progress note 1')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: 'notes-cursor-2', fresh: false })
    expect(notes().getAllByRole('listitem')).toHaveLength(3)
    expect(pager().getByText('Page 2')).toBeTruthy()
    // An older note on the second page is read and offers today's actions too.
    revisions['note-p2-2'] = [{ id: 'rev-p2', revisionNo: 1, content: 'Afebrile (fictional).', changeReason: 'Ward round', createdAt: '2026-10-28T09:00:00.000Z' }]
    await review('Older progress note 2', 'Afebrile (fictional).')
    expect(noteRow('Older progress note 2').getByRole('button', { name: 'Mark entered in error' })).toBeTruthy()
    expect(noteRow('Older progress note 2').getByRole('button', { name: 'Add a note revision' })).toBeTruthy()
    expect(savedValues()).toMatchObject({ 'Note status': 'draft', Note: 'History\nCough for three days.' })
    fireEvent.click(pager().getByRole('button', { name: 'Previous page' }))
    expect(await notes().findByText('Progress note 49')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: false })
    expect(pager().getByText('Page 1')).toBeTruthy()
  })

  it('follow-up 1: History keeps the first page’s nursing observations while the Notes card shows another page', async () => {
    const first = [NOTE, OBSERVATION, ...many('note-p1', 48, index => ({ noteType: 'Progress', title: `Progress note ${index}`, status: 'signed', rowVersion: 1 }))]
    const second = many('note-p2', 2, index => ({ noteType: 'Progress', title: `Older progress note ${index}`, status: 'signed', rowVersion: 1 }))
    pages['clinical-notes'] = { '': { items: first, nextCursor: 'notes-cursor-2' }, 'notes-cursor-2': { items: second, nextCursor: null } }
    await openEncounter()
    const history = () => within(card('History'))
    expect(history().getByRole('link', { name: 'Nursing observations · b1c6ef36' })).toBeTruthy()
    const notes = () => within(card('Clinical notes'))
    fireEvent.click(within(notes().getByRole('navigation', { name: 'Record pages' })).getByRole('button', { name: 'Next page' }))
    expect(await notes().findByText('Older progress note 1')).toBeTruthy()
    expect(history().getByRole('link', { name: 'Nursing observations · b1c6ef36' })).toBeTruthy()
    expect(savedValues()).toMatchObject({ 'Note status': 'draft', Note: 'History\nCough for three days.' })
  })

  it('follow-up 2: a saved draft edit whose revisions cannot be read again shows neither the old content nor "Sign note"', async () => {
    await openEncounter()
    expect(within(card('Actions')).getByRole('button', { name: 'Sign note' })).toBeTruthy()
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    fireEvent.change(saved.getByLabelText(labelled('Clinical note')), { target: { value: 'History\nCough for four days.' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Duration corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Note changes saved.', { exact: false })).toBeTruthy()
    await waitFor(() => expect(within(card('Note')).queryByText('Cough for three days.', { exact: false })).toBeNull())
    expect(within(card('Actions')).queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(within(card('Note')).getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('follow-up 3: offers no "Write clinical note" to a role that may write notes but not read them', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    await within(card('Documents')).findByText('referral-letter.pdf')
    expect(within(card('Actions')).queryByRole('button', { name: 'Write clinical note' })).toBeNull()
    expect(api.noteRevisions).not.toHaveBeenCalled()
  })

  it('pages the Diagnoses card past 50 under "Record pages" for a reader without write access, offering no change', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    const first = many('dx-p1', 50, index => ({ codeSystem: 'ICD-10', code: `R${index}`, display: `Finding ${index} (fictional)`, clinicalStatus: 'active', verificationStatus: 'provisional', rowVersion: 1 }))
    pages.diagnoses = { '': { items: first, nextCursor: 'dx-cursor-2' }, 'dx-cursor-2': { items: [DIAGNOSIS], nextCursor: null } }
    await openEncounter()
    const view = () => within(card('Diagnoses'))
    expect(view().getAllByRole('listitem')).toHaveLength(50)
    const pager = () => within(view().getByRole('navigation', { name: 'Record pages' }))
    expect(pager().getByText('Page 1')).toBeTruthy()
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await view().findByText('Malaria (fictional)')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: 'dx-cursor-2', fresh: false })
    expect(view().getAllByRole('listitem')).toHaveLength(1)
    expect(view().getByText('ICD-10 · B54 · active · provisional')).toBeTruthy()
    expect(pager().getByText('Page 2')).toBeTruthy()
    // A read only: nothing to change, add or update.
    expect(view().queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
    expect(view().queryByRole('button', { name: 'Update diagnosis' })).toBeNull()
    expect(view().queryByRole('button', { name: 'Save record' })).toBeNull()
  })

  it('item 6: pages the Diagnoses card past 50 under "Record pages", a change re-reading the page shown', async () => {
    const first = many('dx-p1', 50, index => ({ codeSystem: 'ICD-10', code: `R${index}`, display: `Finding ${index} (fictional)`, clinicalStatus: 'active', verificationStatus: 'provisional', rowVersion: 1 }))
    const second = [DIAGNOSIS]
    pages.diagnoses = { '': { items: first, nextCursor: 'dx-cursor-2' }, 'dx-cursor-2': { items: second, nextCursor: null } }
    api.updateDiagnosis.mockResolvedValue({ ...DIAGNOSIS, verificationStatus: 'confirmed', rowVersion: 2 })
    await openEncounter()
    const diagnoses = () => within(card('Diagnoses'))
    expect(diagnoses().queryByText('Only the 50 most recent are shown.')).toBeNull()
    const pager = () => within(diagnoses().getByRole('navigation', { name: 'Record pages' }))
    expect(pager().getByText('Page 1')).toBeTruthy()
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await diagnoses().findByText('Malaria (fictional)')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: 'dx-cursor-2', fresh: false })
    expect(pager().getByText('Page 2')).toBeTruthy()
    fireEvent.click(diagnoses().getByRole('button', { name: 'Change this diagnosis' }))
    const verification = diagnoses().getAllByLabelText(labelled('Verification')).find(control => (control as HTMLSelectElement).value === 'provisional')!
    fireEvent.change(verification, { target: { value: 'confirmed' } })
    fireEvent.change(diagnoses().getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    fireEvent.click(diagnoses().getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    expect(api.updateDiagnosis).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'dx-1',
      { expectedRowVersion: 1, changeReason: 'Smear positive', verificationStatus: 'confirmed' })
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: 'dx-cursor-2', fresh: true })
  })

  it('item 6: pages the Documents card past 50 under "Record pages", reading today’s list once', async () => {
    const documents = many('doc', 55, index => ({ fileName: `scan-${index}.pdf`, mediaType: 'application/pdf', sizeBytes: 1024, status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z' }))
    api.documents.mockResolvedValue({ items: documents, nextCursor: null })
    await openEncounter()
    const docs = () => within(card('Documents'))
    await docs().findByText('scan-1.pdf')
    expect(docs().getAllByRole('listitem')).toHaveLength(50)
    expect(docs().queryByText('scan-51.pdf')).toBeNull()
    const pager = () => within(docs().getByRole('navigation', { name: 'Record pages' }))
    expect(pager().getByText('Page 1')).toBeTruthy()
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await docs().findByText('scan-55.pdf')).toBeTruthy()
    expect(docs().getAllByRole('listitem')).toHaveLength(5)
    expect(pager().getByText('Page 2')).toBeTruthy()
    expect((pager().getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
    // Today's read, with today's arguments only: page moves read nothing more.
    expect(api.documents).toHaveBeenCalledTimes(1)
    expect(api.documents).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    expect(docs().queryByText('Not every document of this encounter is listed here.')).toBeNull()
  })

  it('item 6: says when EHR holds more documents than today’s read answers', async () => {
    api.documents.mockResolvedValue({ items: [DOCUMENT], nextCursor: 'documents-cursor-2' })
    await openEncounter()
    expect(await within(card('Documents')).findByText('Not every document of this encounter is listed here.')).toBeTruthy()
    expect(within(card('Documents')).queryByRole('navigation', { name: 'Record pages' })).toBeNull()
  })

  it('item 6: shows no pager while a list has one page', async () => {
    await openEncounter()
    for (const title of ['Clinical notes', 'Diagnoses', 'Documents']) {
      expect(within(card(title)).queryByRole('navigation', { name: 'Record pages' })).toBeNull()
    }
  })

  it('item 6: starts a list again with today’s notice when EHR no longer accepts its cursor', async () => {
    const first = many('dx-p1', 50, index => ({ codeSystem: 'ICD-10', code: `R${index}`, display: `Finding ${index} (fictional)`, clinicalStatus: 'active', verificationStatus: 'provisional', rowVersion: 1 }))
    pages.diagnoses = {
      '': { items: first, nextCursor: 'dx-cursor-2' },
      'dx-cursor-2': { items: [DIAGNOSIS], nextCursor: 'dx-cursor-3' },
      'dx-cursor-3': new HidApiError(400, 'The cursor is not valid.', { code: 'INVALID_CURSOR' }),
    }
    await openEncounter()
    const diagnoses = () => within(card('Diagnoses'))
    const pager = () => within(diagnoses().getByRole('navigation', { name: 'Record pages' }))
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await diagnoses().findByText('Malaria (fictional)')).toBeTruthy()
    fireEvent.click(pager().getByRole('button', { name: 'Next page' }))
    expect(await diagnoses().findByText('This list changed since it was opened, so it shows the newest entries again.')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
    expect(pager().getByText('Page 1')).toBeTruthy()
    expect(diagnoses().getByText('Finding 1 (fictional)')).toBeTruthy()
  })

  it('item 6: keeps the page shown and says so when another page cannot be loaded', async () => {
    const first = [NOTE, ...many('note-p1', 49, index => ({ noteType: 'Progress', title: `Progress note ${index}`, status: 'signed', rowVersion: 1 }))]
    pages['clinical-notes'] = {
      '': { items: first, nextCursor: 'notes-cursor-2' },
      'notes-cursor-2': new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }),
    }
    await openEncounter()
    const notes = () => within(card('Clinical notes'))
    fireEvent.click(within(notes().getByRole('navigation', { name: 'Record pages' })).getByRole('button', { name: 'Next page' }))
    expect((await notes().findByRole('alert')).textContent).toBe('The page could not be loaded. EHR is unavailable.')
    expect(notes().getByText('Progress note 49')).toBeTruthy()
    expect(within(notes().getByRole('navigation', { name: 'Record pages' })).getByText('Page 1')).toBeTruthy()
  })
})
