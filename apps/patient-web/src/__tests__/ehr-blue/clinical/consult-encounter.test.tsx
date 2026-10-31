import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { composeNote, splitNote } from '../../../ehr-blue/clinical/consult/encounters'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Consultation, one encounter: the design's record page (Saved record, Available actions with the typed SIGN
 * dialog and the More actions menu, Connected hospital history, Preserved versions & amendments) on today's
 * encounter, note, diagnosis and document calls, with every access re-check and refusal today has. Everything is
 * fictional.
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
const OTHER = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed' }
const NOTE = {
  id: 'note-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:10:00.000Z',
  noteType: 'Consultation', title: 'Consultation note', status: 'draft', rowVersion: 2,
}
const REVISION = { id: 'rev-1', revisionNo: 1, content: 'History\nCough for three days.', changeReason: 'Initial draft', createdAt: '2026-10-30T08:10:00.000Z' }
const DIAGNOSIS = {
  id: 'dx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:20:00.000Z', codeSystem: 'ICD-10', code: 'B54',
  display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'provisional', notes: null, rowVersion: 1,
}
const VITAL = { id: 'vital-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:05:00.000Z', status: 'final', pulseBpm: 80 }
const DOCUMENT = {
  id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z',
}
const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'
const ENDED = 'Patient access has ended. Reopen the record through governed access.'
const STALE = new HidApiError(412, 'The record changed since it was read.', { code: 'PRECONDITION_FAILED' })
const UNAVAILABLE = () => new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
/** The live actions behind More actions for an in-progress encounter with a draft note read (owner decision 1). */
const MENU = [
  'Put encounter on hold', 'Complete encounter', 'Cancel encounter', 'Mark encounter entered in error', 'Mark note entered in error',
  'View diagnoses', 'Add diagnosis', 'Change diagnosis', 'Upload document',
]

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  records = { 'clinical-notes': [NOTE], diagnoses: [DIAGNOSIS], vitals: [VITAL], prescriptions: [], 'lab-requests': [] }
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER, OTHER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: records[kind] ?? [], nextCursor: null }))
  api.noteRevisions.mockResolvedValue([REVISION])
  api.documents.mockResolvedValue({ items: [DOCUMENT], nextCursor: null })
  api.updateRecord.mockResolvedValue({ ...NOTE, status: 'signed', rowVersion: 3 })
  api.addNoteRevision.mockResolvedValue({ ...REVISION, id: 'rev-2', revisionNo: 2 })
  api.updateEncounter.mockImplementation(async (_f: string, _p: string, _e: string, input: { status: string }) => ({ ...ENCOUNTER, status: input.status, rowVersion: 4 }))
  api.createRecord.mockResolvedValue({ id: 'dx-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
  api.updateDiagnosis.mockResolvedValue({ ...DIAGNOSIS, verificationStatus: 'confirmed', rowVersion: 2 })
  api.documentDownload.mockResolvedValue({ url: 'https://storage.example.test/doc-1?signature=x', expiresInSeconds: 60 })
  api.uploadDocument.mockResolvedValue('doc-2')
})

afterEach(() => { vi.restoreAllMocks() })

async function openEncounter(text = 'Cough for three days.') {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: 'e0000000' })).toBeTruthy()
  // The note's content, once read (in the Saved record, and in a preserved version too).
  expect((await screen.findAllByText(text, { exact: false })).length).toBeGreaterThan(0)
}

function card(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement
}

function actions() {
  return within(card('Available actions'))
}

function history() {
  return within(card('Connected hospital history'))
}

/** The line under the heading: status, patient, time. */
function meta() {
  return screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`).parentElement as HTMLElement
}

function dialog() {
  return screen.getByRole('alertdialog')
}

function savedValues() {
  const saved = within(card('Saved record'))
  return Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
}

function savedLabels() {
  return within(card('Saved record')).getAllByRole('term').map(term => term.textContent)
}

/** The open action's submit button (the action's own button toggles its form). */
function submitOf(name: string) {
  return actions().getAllByRole('button', { name }).find(button => button.getAttribute('type') === 'submit')!
}

/** The "More actions" menu button at the end of Available actions. */
function moreButton() {
  return actions().getByRole('button', { name: /^More actions/ })
}

/** What More actions offers (the menu is opened, read and closed again). */
function menuLabels() {
  fireEvent.click(moreButton())
  const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  return labels
}

/** Chooses one of More actions' items, which opens its form in Available actions. */
function chooseMore(label: string) {
  fireEvent.click(moreButton())
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
}

/** Opens "Sign note" in Available actions and gives today's reason. */
function openSign(reason = 'Reviewed with the patient') {
  fireEvent.click(actions().getByRole('button', { name: 'Sign note' }))
  fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: reason } })
}

/** Today's OCR page stand-in: where it was opened, and what router state it was handed. */
function OcrPage() {
  const location = useLocation()
  return (
    <div data-testid="ocr-page">
      <p data-testid="ocr-path">{location.pathname}</p>
      <p data-testid="ocr-search">{location.search}</p>
      <p data-testid="ocr-state">{JSON.stringify(location.state)}</p>
    </div>
  )
}

/** The encounter page with today's OCR route beside it. */
function renderWithOcr() {
  return render(
    <MemoryRouter initialEntries={[`/provider/clinical/${ENCOUNTER_ID}`]}>
      <Routes>
        <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
        <Route path="/provider/ocr" element={<OcrPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Consultation record', () => {
  it('audit 10: shows the design’s Saved record rows (Visit, Complaint, History, Diagnosis, Note) and "Saved" in the meta line', async () => {
    await openEncounter()
    expect(screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`)).toBeTruthy()
    expect(within(meta()).getByText('in progress')).toBeTruthy()
    // No updatedAt from EHR: the time it started is when it was saved.
    expect(within(meta()).getByText(`Saved ${new Date(ENCOUNTER.startedAt).toLocaleString('en-US')}`)).toBeTruthy()
    expect(within(meta()).queryByText(/^Started /)).toBeNull()
    // The note holds only a History section: no Examination row, and no clinical note section ("Not recorded").
    expect(savedLabels()).toEqual(['Visit', 'Complaint', 'History', 'Diagnosis', 'Note'])
    expect(savedValues()).toEqual({
      Visit: 'e0000000', Complaint: 'Fever for two days', History: 'Cough for three days.', Diagnosis: 'Malaria (fictional)', Note: 'Not recorded',
    })
    expect(within(card('Saved record')).getByRole('button', { name: 'Edit unsigned draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
    // Reads: the access re-check first; records with today's four arguments.
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes')
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1')
    // The patient's other encounters are no longer read for this page (audit 13).
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('audit 10: splits a note New consultation composed into History, Examination, Note and Follow-up, and shows the time EHR last saved the encounter', async () => {
    api.encounter.mockResolvedValue({ ...ENCOUNTER, updatedAt: '2026-10-30T09:45:00.000Z' })
    const content = composeNote([['History', 'Cough for three days.'], ['Examination', 'Chest clear (fictional).'], ['Clinical note', 'Viral illness (fictional).'], ['Follow-up', 'Review in two days']])
    api.noteRevisions.mockResolvedValue([{ ...REVISION, content }])
    await openEncounter('Viral illness (fictional).')
    expect(savedLabels()).toEqual(['Visit', 'Complaint', 'History', 'Examination', 'Diagnosis', 'Note', 'Follow-up'])
    expect(savedValues()).toMatchObject({
      History: 'Cough for three days.', Examination: 'Chest clear (fictional).', Note: 'Viral illness (fictional).', 'Follow-up': 'Review in two days',
    })
    expect(within(meta()).getByText(`Saved ${new Date('2026-10-30T09:45:00.000Z').toLocaleString('en-US')}`)).toBeTruthy()
  })

  it('audit 10: shows a note that was not written in sections whole, as Note', async () => {
    api.noteRevisions.mockResolvedValue([{ ...REVISION, content: 'Fever settling (fictional).\n\nPlan: fluids.' }])
    await openEncounter('Fever settling (fictional).')
    expect(savedLabels()).toEqual(['Visit', 'Complaint', 'Diagnosis', 'Note'])
    expect(within(card('Saved record')).getByText('Fever settling (fictional).\n\nPlan: fluids.', { normalizer: value => value })).toBeTruthy()
  })

  it('audit 10: reads a note back into the sections New consultation composes', () => {
    const content = composeNote([['History', 'Cough.\n\nThree days.'], ['Examination', 'Chest clear.'], ['Clinical note', 'Viral.'], ['Follow-up', 'Two days']])
    expect(splitNote(content)).toEqual({ sectioned: true, history: 'Cough.\n\nThree days.', examination: 'Chest clear.', note: 'Viral.', followup: 'Two days' })
    expect(splitNote('History\nCough for three days.')).toEqual({ sectioned: true, history: 'Cough for three days.', examination: '', note: '', followup: '' })
    expect(splitNote('Clinical note:\nViral.')).toMatchObject({ sectioned: true, note: 'Viral.' })
    expect(splitNote('Fever settling.')).toEqual({ sectioned: false, history: '', examination: '', note: 'Fever settling.', followup: '' })
    // A note that does not start with a section is one note, whatever it says later.
    expect(splitNote('History of travel.\n\nExamination\nNormal.')).toMatchObject({ sectioned: false, note: 'History of travel.\n\nExamination\nNormal.' })
  })

  it('audit 10: keeps the Note row’s loading and refusal states', async () => {
    api.noteRevisions.mockReturnValue(new Promise(() => {}))
    const view = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    view.unmount()
    records['clinical-notes'] = []
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'clinical-notes') throw new HidApiError(503, 'Notes are unavailable.', { code: 'UNAVAILABLE' })
      return { items: records[kind] ?? [], nextCursor: null }
    })
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await within(await screen.findByRole('heading', { level: 2, name: 'Saved record' }).then(heading => heading.closest('section')!)).findByText('Notes are unavailable.')).toBeTruthy()
  })

  it('audit 11: Available actions shows the design’s actions; every other live action is behind one More actions menu at its end', async () => {
    await openEncounter()
    const buttons = actions().getAllByRole('button')
    expect(buttons.map(button => button.textContent?.replace('▾', ''))).toEqual(['Sign note', 'Write clinical note', 'More actions'])
    expect(moreButton().getAttribute('aria-haspopup')).toBe('menu')
    expect(menuLabels()).toEqual(MENU)
    // The design's note on connected orders follows (rendered by ./orders).
    expect(actions().getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
  })

  it('audit 11: offers a signed note’s "Amend signed note" with the menu, and "Resume encounter" for one on hold', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold' })
    await openEncounter()
    expect(actions().getAllByRole('button').map(button => button.textContent?.replace('▾', ''))).toEqual(['Amend signed note', 'Write clinical note', 'More actions'])
    expect(menuLabels()).toEqual(['Resume encounter', 'Cancel encounter', 'Mark encounter entered in error', 'Mark note entered in error', 'View diagnoses', 'Add diagnosis', 'Change diagnosis', 'Upload document'])
  })

  it('audit 11: marks the consultation note entered in error from More actions, under a typed reason, with a plain confirm', async () => {
    await openEncounter()
    chooseMore('Mark note entered in error')
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().textContent).toContain('Mark note entered in error open')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'ok' } })
    fireEvent.click(submitOf('Mark note entered in error'))
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Wrong patient' } })
    fireEvent.click(submitOf('Mark note entered in error'))
    expect(within(dialog()).getByRole('heading', { name: 'Mark note entered in error?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark note entered in error' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Wrong patient', status: 'entered_in_error' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('audit 13: lists the other workspaces’ records in the sidebar’s order, every row opening, by ids only', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read', 'ehr.lab-request.read']
    const observation = { ...NOTE, id: 'b1c6ef36-0000-4000-8000-000000000001', noteType: 'Nursing observation', title: 'Vitals', status: 'signed' }
    records['clinical-notes'] = [NOTE, observation]
    records.prescriptions = [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, medicationDisplay: 'Amoxicillin (fictional)', status: 'active' }]
    records['lab-requests'] = [{ id: 'lab-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, testDisplay: 'Malaria smear (fictional)', status: 'draft' }]
    await openEncounter()
    await history().findByRole('button', { name: 'Documents · referral-letter.pdf' })
    expect(history().getByText('Only records available to your current permissions are listed.')).toBeTruthy()
    const rows = history().getAllByRole('listitem')
    expect(rows.map(row => (row.querySelector('a, button') as HTMLElement).textContent)).toEqual([
      'Triage & Vitals · vital-1', 'Laboratory · Malaria smear (fictional)', 'Pharmacy · Amoxicillin (fictional)',
      'Nursing observations · b1c6ef36', 'Documents · referral-letter.pdf',
    ])
    const row = (name: string) => rows.find(item => item.textContent?.includes(name)) as HTMLElement
    const link = (name: string) => history().getByRole('link', { name }).getAttribute('href')
    expect(link('Triage & Vitals · vital-1')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-1`)
    expect(within(row('Triage & Vitals · vital-1')).getByText('final')).toBeTruthy()
    expect(link('Laboratory · Malaria smear (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/lab-1`)
    expect(link('Pharmacy · Amoxicillin (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/rx-1`)
    expect(link('Nursing observations · b1c6ef36')).toBe(`/provider/nursing/${ENCOUNTER_ID}~${observation.id}`)
    expect(within(row('Nursing observations · b1c6ef36')).getByText('signed')).toBeTruthy()
    expect(within(row('Documents · referral-letter.pdf')).getByText('available')).toBeTruthy()
    // Not this workspace's own records: no other encounter, no clinical note of this encounter, no diagnosis.
    expect(history().queryByText(/^Consultation · /)).toBeNull()
    expect(history().queryByText(/^Clinical notes · /)).toBeNull()
    expect(history().queryByText(/^Diagnoses · /)).toBeNull()
    for (const href of history().getAllByRole('link').map(item => item.getAttribute('href') ?? '')) {
      expect(href).not.toContain(PATIENT_HID)
      expect(href).not.toContain(PATIENT_ID)
    }
  })

  it('audit 13: says the history is empty only once its lists are read', async () => {
    records.vitals = []
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    await openEncounter()
    expect(await history().findByText('No other records for this patient yet.')).toBeTruthy()
  })

  it('audit 9: the page has no "Reported by the patient", Diagnoses or Documents card; today’s chart sections stay on the Consultation list', async () => {
    await openEncounter()
    await act(async () => {})
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual([
      'Saved record', 'Available actions', 'Connected hospital history', 'Clinical notes',
    ])
    expect(document.querySelector('.hid-ehr-clinical-today')).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('item 1: offers "Write clinical note" while the encounter already has a note, with today’s note type, title and content', async () => {
    api.createRecord.mockResolvedValue({ id: 'note-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
    await openEncounter()
    // The draft is there and still offered for signing; a second note can be written beside it.
    expect(actions().getByRole('button', { name: 'Sign note' })).toBeTruthy()
    fireEvent.click(actions().getByRole('button', { name: 'Write clinical note' }))
    expect(actions().getByText('Notes are saved as drafts. Signing needs its own reviewed action.')).toBeTruthy()
    const type = actions().getByLabelText(labelled('Note type')) as HTMLInputElement
    const title = actions().getByLabelText(labelled('Title')) as HTMLInputElement
    const content = actions().getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect([type.maxLength, type.placeholder, title.maxLength, content.maxLength]).toEqual([80, 'Consultation', 240, 100_000])
    fireEvent.click(actions().getByRole('button', { name: 'Save draft' }))
    expect(actions().getAllByText('Complete this field.')).toHaveLength(3)
    expect(api.createRecord).not.toHaveBeenCalled()
    fireEvent.change(type, { target: { value: ' Progress ' } })
    fireEvent.change(title, { target: { value: 'Evening review' } })
    fireEvent.change(content, { target: { value: 'Fever settling.' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(actions().getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Progress', title: 'Evening review', status: 'draft', content: 'Fever settling.',
    }, expect.any(String))
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    // Today's create reads the notes' first page again, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    expect(actions().getByRole('button', { name: 'Write clinical note' })).toBeTruthy()
  })

  it('item 1: still offers "Write clinical note" once the consultation note is entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    await openEncounter()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(menuLabels()).not.toContain('Mark note entered in error')
    expect(actions().getByRole('button', { name: 'Write clinical note' })).toBeTruthy()
  })

  it('leaves a refuted diagnosis out of the encounter’s Diagnosis', async () => {
    records.diagnoses = [
      { ...DIAGNOSIS, verificationStatus: 'refuted' },
      { ...DIAGNOSIS, id: 'dx-2', code: 'R50.9', display: 'Fever (fictional)', verificationStatus: 'confirmed' },
    ]
    await openEncounter()
    expect(savedValues().Diagnosis).toBe('Fever (fictional)')
    // Both are still listed, as today's Diagnoses tab lists them, where a diagnosis is changed.
    chooseMore('Change diagnosis')
    const options = within(actions().getByLabelText(labelled('Diagnosis'))).getAllByRole('option').map(option => option.textContent)
    expect(options).toEqual(['Select…', 'Malaria (fictional) · ICD-10 · B54 · active · refuted', 'Fever (fictional) · ICD-10 · R50.9 · active · confirmed'])
  })

  it('says the role grants no access to encounter records when it holds none of the record reads', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'e0000000' })).toBeTruthy()
    expect(screen.getByText('Your current facility role does not grant access to encounter records.')).toBeTruthy()
    expect(api.records).not.toHaveBeenCalled()
    expect(api.documents).not.toHaveBeenCalled()
  })

  it('does not say so when the role holds one record read', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('link', { name: 'Triage & Vitals · vital-1' })).toBeTruthy()
    expect(screen.queryByText('Your current facility role does not grant access to encounter records.')).toBeNull()
  })

  it('item 7: signs the consultation note under the clinician’s typed reason, only after SIGN is typed, after the access re-check', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Sign note' }))
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'ok' } })
    fireEvent.click(submitOf('Sign note'))
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Reviewed with the patient' } })
    fireEvent.click(submitOf('Sign note'))
    expect(within(dialog()).getByRole('heading', { name: 'Sign note?' })).toBeTruthy()
    expect(within(dialog()).getByText('Review the entered details before continuing. This action changes the saved record and is recorded in its history.')).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign note' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'sign' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    expect(confirm.disabled).toBe(false)
    const checks = api.lookupPatient.mock.calls.length
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', rowVersion: 3 }]
    fireEvent.click(confirm)

    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Reviewed with the patient', status: 'signed' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    await waitFor(() => expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull())
    // "Amend signed note" needs the signed note's content, read again once its version changed.
    expect(await actions().findByRole('button', { name: 'Amend signed note' })).toBeTruthy()
  })

  it('keeps the draft when the sign dialog is cancelled, or closed with Escape', async () => {
    await openEncounter()
    openSign()
    const submit = () => submitOf('Sign note')
    fireEvent.click(submit())
    // Focus starts on Cancel, a real button.
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(submit()).toBeTruthy()
    await waitFor(() => expect(submit().getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(submit())
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
    // Still the draft: "Sign note" and "Edit unsigned draft" are still offered.
    expect(actions().getByRole('button', { name: 'Sign note', expanded: true })).toBeTruthy()
    expect(within(card('Saved record')).getByRole('button', { name: 'Edit unsigned draft' })).toBeTruthy()
  })

  it('offers no signing until the note’s content has been read', async () => {
    api.noteRevisions.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit unsigned draft' })).toBeNull()
    expect(menuLabels()).not.toContain('Mark note entered in error')
  })

  it('shows a note that cannot be read, and offers no signing', async () => {
    api.noteRevisions.mockRejectedValue(UNAVAILABLE())
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
  })

  it('shows a stale sign in the form, as today', async () => {
    api.updateRecord.mockRejectedValueOnce(STALE)
    await openEncounter()
    openSign()
    fireEvent.click(submitOf('Sign note'))
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign note' }))
    expect((await actions().findByRole('alert')).textContent).toBe('The record changed since it was read.')
  })

  it('item 7: edits the unsigned draft as a new revision under the clinician’s typed reason, prefilled with its content', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit unsigned draft' }))
    const saved = within(card('Saved record'))
    const content = saved.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect(content.value).toBe('History\nCough for three days.')
    fireEvent.change(content, { target: { value: 'History\nCough for four days.' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }))
    expect(saved.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Duration corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }))
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'History\nCough for four days.' }, expect.any(String))
    // Nothing typed in the diagnosis fields: no diagnosis is written.
    expect(api.createRecord).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit unsigned draft' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('audit 9: "Edit unsigned draft" takes New consultation’s diagnosis fields; the diagnosis is saved after the revision, a retry sending only it, under the same key', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit unsigned draft' }))
    const saved = within(card('Saved record'))
    expect(saved.getByText('Optional. With a code system and code, it is saved as this encounter’s diagnosis.')).toBeTruthy()
    expect((saved.getByLabelText(labelled('Diagnosis code system')) as HTMLInputElement).placeholder).toBe('ICD-10')
    expect((saved.getByLabelText(labelled('Clinical status')) as HTMLSelectElement).value).toBe('active')
    expect((saved.getByLabelText(labelled('Verification')) as HTMLSelectElement).value).toBe('unconfirmed')
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis / assessment')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    const save = () => saved.getByRole('button', { name: 'Save draft changes' })
    fireEvent.click(save())
    // New consultation's check: with an assessment, its code system and code are needed too.
    expect(saved.getAllByText('Complete this field.')).toHaveLength(2)
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis code')), { target: { value: 'B54' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(save())
    expect((await saved.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    // The revision is in, and the page says so; each save re-checked access first.
    expect(screen.getByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'unconfirmed',
    }, expect.any(String))

    fireEvent.click(save())
    expect(await screen.findByText('A new note revision was recorded. Clinical record saved by the backend.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(2)
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
    // Today's create read: the diagnoses' first page, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
  })

  it('audit 9: a draft form left after its revision was saved and its diagnosis refused reads the note again', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit unsigned draft' }))
    const saved = within(card('Saved record'))
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis / assessment')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis code')), { target: { value: 'B54' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    fireEvent.click(saved.getByRole('button', { name: 'Save draft changes' }))
    expect((await saved.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(api.records).not.toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    records['clinical-notes'] = [{ ...NOTE, rowVersion: 3 }]
    fireEvent.click(saved.getByRole('button', { name: 'Cancel editing' }))
    await waitFor(() => expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true }))
    // The revision was sent once, and nothing more is sent.
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(1)
  })

  it('amends a signed note with today’s checks, reusing the key on retry', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    const save = () => submitOf('Amend signed note')
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'ok' } })
    fireEvent.click(save())
    expect(actions().getByText('Enter the revised note content.')).toBeTruthy()
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()

    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Corrected: cough for four days.' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Duration corrected' } })
    api.addNoteRevision.mockRejectedValueOnce(UNAVAILABLE())
    fireEvent.click(save())
    expect((await actions().findByRole('alert')).textContent).toBe('EHR is unavailable.')
    fireEvent.click(save())
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'Corrected: cough for four days.' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('audit 9: "Amend signed note" takes the diagnosis fields too, and shows a refused diagnosis field at its control', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    const labels = Array.from(card('Available actions').querySelectorAll('form label')).map(label => label.textContent)
    expect(labels).toEqual(['Amendment *', 'Diagnosis / assessment', 'Diagnosis code system', 'Diagnosis code', 'Clinical status', 'Verification', 'Reason *'])
    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Smear positive (fictional).' } })
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis / assessment')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis code')), { target: { value: 'B54' } })
    fireEvent.change(actions().getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Result back' } })
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'code', messages: ['code must be shorter than or equal to 100 characters'] }],
    }))
    fireEvent.click(submitOf('Amend signed note'))
    expect((await actions().findByRole('alert')).textContent).toBe('One or more request fields are invalid. Code must be shorter than or equal to 100 characters.')
    expect(actions().getByLabelText(labelled('Diagnosis code')).getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(submitOf('Amend signed note'))
    expect(await screen.findByText('A new note revision was recorded. Clinical record saved by the backend.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'confirmed',
    }, expect.any(String))
  })

  it('audit 9: offers no diagnosis fields, and no diagnosis actions, without ehr.diagnosis.write', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.write')
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit unsigned draft' }))
    expect(within(card('Saved record')).queryByLabelText(labelled('Diagnosis / assessment'))).toBeNull()
    expect(menuLabels()).not.toContain('Add diagnosis')
    expect(menuLabels()).not.toContain('Change diagnosis')
  })

  it('audit 14: keeps every revision under "Preserved versions & amendments", named by the note’s status and the reason', async () => {
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
      REVISION,
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    const versions = await screen.findByRole('heading', { level: 2, name: 'Preserved versions & amendments' })
    const summaries = Array.from(versions.closest('section')!.querySelectorAll('summary')).map(summary => summary.textContent)
    expect(summaries).toEqual([
      '2026-10-30T08:10:00.000Z · draft · Initial draft',
      '2026-10-30T09:00:00.000Z · draft · Duration corrected',
    ])
    // The latest revision is the note shown.
    expect(savedValues().History).toBe('Cough for four days.')
  })

  it('audit 14: shows a signed note’s card with one revision: the version it was signed as, "{signedAt} · draft · Sign note"', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    await openEncounter()
    const versions = card('Preserved versions & amendments')
    expect(Array.from(versions.querySelectorAll('summary')).map(summary => summary.textContent)).toEqual(['2026-10-30T08:40:00.000Z · draft · Sign note'])
    expect(within(versions).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('audit 14: places the signed version among an amended note’s revisions, with the content signed', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'amended', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      REVISION,
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
    ])
    await openEncounter('Cough for four days.')
    const versions = card('Preserved versions & amendments')
    // Each revision is named by the status it was saved under: a draft before signing, an amendment after.
    expect(Array.from(versions.querySelectorAll('summary')).map(summary => summary.textContent)).toEqual([
      '2026-10-30T08:10:00.000Z · draft · Initial draft',
      '2026-10-30T08:40:00.000Z · draft · Sign note',
      '2026-10-30T09:00:00.000Z · amended · Duration corrected',
    ])
    const signed = Array.from(versions.querySelectorAll('details'))[1]!
    expect(within(signed).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('audit 14: names a signed note’s draft edits "draft", not by the status the note has now', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T09:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, createdAt: '2026-10-30T09:31:00.000Z', changeReason: 'Initial note' },
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Added plan', createdAt: '2026-10-30T09:35:00.000Z' },
    ])
    await openEncounter('Cough for four days.')
    expect(Array.from(card('Preserved versions & amendments').querySelectorAll('summary')).map(summary => summary.textContent)).toEqual([
      '2026-10-30T09:31:00.000Z · draft · Initial note',
      '2026-10-30T09:35:00.000Z · draft · Added plan',
      '2026-10-30T09:40:00.000Z · draft · Sign note',
    ])
  })

  it('audit 14: shows no card for a draft with one revision', async () => {
    await openEncounter()
    expect(screen.queryByRole('heading', { level: 2, name: 'Preserved versions & amendments' })).toBeNull()
  })

  it('audit 11: completes the encounter from More actions with a reason, re-checking access first', async () => {
    await openEncounter()
    chooseMore('Complete encounter')
    expect(actions().getByText(/^Cancelling this encounter also cancels its draft/)).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: '  ' } })
    const save = () => submitOf('Complete encounter')
    fireEvent.click(save())
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.updateEncounter).not.toHaveBeenCalled()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(save())
    expect(await screen.findByText('Encounter status updated.')).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID,
      { expectedRowVersion: 3, changeReason: 'Seen and treated', status: 'completed', endedAt: expect.any(String) })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(within(meta()).getByText('completed')).toBeTruthy()
    // The form is gone; focus goes to Available actions, and the completed encounter offers no status change.
    expect(actions().queryByRole('button', { name: 'Complete encounter' })).toBeNull()
    expect(menuLabels()).not.toContain('Complete encounter')
  })

  it('audit 11: asks before cancelling the encounter (no typed word), and says when the role may not', async () => {
    api.updateEncounter.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    await openEncounter()
    chooseMore('Cancel encounter')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Booked in error' } })
    fireEvent.click(submitOf('Cancel encounter'))
    expect(within(dialog()).getByRole('heading', { name: 'Cancel encounter?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel encounter' }))
    expect((await actions().findByRole('alert')).textContent).toBe('You may not cancel this encounter: it holds records that this change would also change, and your role may not change all of them. Nothing was changed. Ask a colleague whose role may change all of its records (usually a doctor or clinician) to make this change.')
  })

  it('audit 11: re-reads an encounter that changed meanwhile and says so', async () => {
    api.updateEncounter.mockRejectedValueOnce(STALE)
    await openEncounter()
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 5 })
    chooseMore('Complete encounter')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    // A pressed button takes focus (as in a browser); the change removes it with its form.
    act(() => { submitOf('Complete encounter').focus() })
    fireEvent.click(submitOf('Complete encounter'))
    expect((await screen.findByRole('alert')).textContent).toBe('This encounter changed since it was loaded and now shows its current status. Choose the change again if it is still needed.')
    expect(within(meta()).getByText('on hold')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Available actions')
    expect(menuLabels()).toContain('Resume encounter')
  })

  it('shows today’s read-only sentence and no changes under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openEncounter()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(actions().getByText('No further actions for your permission and this record state.')).toBeTruthy()
    // Nothing to change: the menu holds only today's diagnoses list, a read (review finding 1).
    expect(menuLabels()).toEqual(['View diagnoses'])
    expect(screen.queryByRole('button', { name: 'Edit unsigned draft' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
    // The documents still open (a read), from the history.
    expect((await history().findByRole('button', { name: 'Documents · referral-letter.pdf' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the read-only emergency notice and reads nothing for an emergency patient', () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records).not.toHaveBeenCalled()
  })

  it('closes the patient when the re-check before a change is refused (403), and changes nothing', async () => {
    await openEncounter()
    openSign()
    fireEvent.click(submitOf('Sign note'))
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign note' }))
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText(ENDED)).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  it('shows "Record not found" for an encounter EHR does not return', async () => {
    api.encounter.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    renderPage(<ConsultWorkspace />, 'consult', '/e9999999-0000-4000-8000-000000000009')
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
  })

  it('mounts the orders pages under the encounter', async () => {
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}/orders/new`)
    expect(screen.getByText('Order pages part')).toBeTruthy()
  })
})

describe('Consultation record: diagnoses, in More actions (audit 9)', () => {
  it('audit 9: "Add diagnosis" adds one with today’s fields, and shows a refused field at its control with today’s sentence', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'display', messages: ['display must be shorter than or equal to 500 characters'] }],
    }))
    await openEncounter()
    chooseMore('Add diagnosis')
    fireEvent.change(actions().getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(actions().getByLabelText(labelled('Code')), { target: { value: 'R50.9' } })
    fireEvent.change(actions().getByLabelText(labelled('Display')), { target: { value: 'Fever' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(actions().getByRole('button', { name: 'Save record' }))
    expect((await actions().findByRole('alert')).textContent).toBe('One or more request fields are invalid. Display must be shorter than or equal to 500 characters.')
    expect(actions().getByLabelText(labelled('Display')).getAttribute('aria-invalid')).toBe('true')
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)

    fireEvent.click(actions().getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses',
      { codeSystem: 'ICD-10', code: 'R50.9', display: 'Fever', clinicalStatus: 'active', verificationStatus: 'unconfirmed', notes: undefined }, expect.any(String))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
  })

  it('audit 9: "Change diagnosis" picks the diagnosis, then sends only what changed, after the access re-check', async () => {
    await openEncounter()
    chooseMore('Change diagnosis')
    // Nothing is offered to change until a diagnosis is picked.
    expect(actions().queryByRole('button', { name: 'Update diagnosis' })).toBeNull()
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis')), { target: { value: 'dx-1' } })
    expect(actions().getByText('Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.')).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    fireEvent.click(actions().getByRole('button', { name: 'Update diagnosis' }))
    expect(actions().getByText('Change the clinical status, verification or notes before saving.')).toBeTruthy()
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
    fireEvent.change(actions().getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(actions().getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    expect(api.updateDiagnosis).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'dx-1',
      { expectedRowVersion: 1, changeReason: 'Smear positive', verificationStatus: 'confirmed' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    // Today's read after a change: the page shown, fresh; the form closes.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
    expect(actions().queryByRole('button', { name: 'Update diagnosis' })).toBeNull()
  })

  it('audit 9: shows a refused change in its form, as today', async () => {
    api.updateDiagnosis.mockRejectedValueOnce(STALE)
    await openEncounter()
    chooseMore('Change diagnosis')
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis')), { target: { value: 'dx-1' } })
    fireEvent.change(actions().getByLabelText(labelled('Clinical status')), { target: { value: 'resolved' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Treated' } })
    fireEvent.click(actions().getByRole('button', { name: 'Update diagnosis' }))
    expect((await actions().findByRole('alert')).textContent).toBe('The record changed since it was read.')
  })

  it('audit 9: offers no change for a diagnosis entered in error', async () => {
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'entered_in_error' }]
    await openEncounter()
    expect(menuLabels()).not.toContain('Change diagnosis')
    expect(menuLabels()).toContain('Add diagnosis')
  })

  it('audit 9: lists a diagnosis entered in error in the picker, but not as a choice', async () => {
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'entered_in_error' }, { ...DIAGNOSIS, id: 'dx-2', display: 'Fever (fictional)' }]
    await openEncounter()
    chooseMore('Change diagnosis')
    const options = within(actions().getByLabelText(labelled('Diagnosis'))).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(option => [option.textContent, option.disabled])).toEqual([
      ['Select…', false],
      ['Malaria (fictional) · ICD-10 · B54 · active · entered in error', true],
      ['Fever (fictional) · ICD-10 · B54 · active · provisional', false],
    ])
  })

  it('audit 9: "View diagnoses" lists every diagnosis as today’s Diagnoses tab did, for a reader without write access', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    records.diagnoses = [
      { ...DIAGNOSIS, notes: 'Smear pending (fictional).' },
      { ...DIAGNOSIS, id: 'dx-2', display: 'Dengue (fictional)', code: 'A90', verificationStatus: 'refuted' },
      { ...DIAGNOSIS, id: 'dx-3', display: 'Typhoid (fictional)', code: 'A01', verificationStatus: 'entered_in_error' },
    ]
    await openEncounter()
    // The Saved record names the encounter's diagnosis; the list keeps the ruled-out and retracted ones too.
    expect(savedValues().Diagnosis).toBe('Malaria (fictional)')
    chooseMore('View diagnoses')
    expect(actions().getByRole('heading', { level: 3, name: 'Diagnoses' })).toBeTruthy()
    const rows = actions().getAllByRole('listitem')
    expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual(['Malaria (fictional)', 'Dengue (fictional)', 'Typhoid (fictional)'])
    expect(within(rows[0]!).getByText('ICD-10 · B54 · active · provisional')).toBeTruthy()
    expect(within(rows[0]!).getByText('Smear pending (fictional).')).toBeTruthy()
    expect(within(rows[1]!).getByText('refuted')).toBeTruthy()
    expect(within(rows[2]!).getByText('entered in error')).toBeTruthy()
    // A read: no change is offered from it.
    expect(actions().queryByRole('button', { name: /^Change|Update diagnosis/ })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Save record' })).toBeNull()
  })

  it('audit 9: "View diagnoses" keeps today’s empty sentence without ehr.diagnosis.write', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.write')
    records.diagnoses = []
    await openEncounter()
    expect(menuLabels()).not.toContain('Add diagnosis')
    chooseMore('View diagnoses')
    expect(actions().getByText('No diagnoses for this encounter.')).toBeTruthy()
  })

  it('audit 9: "View diagnoses" shows a refused diagnoses read as an alert', async () => {
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'diagnoses') throw new HidApiError(503, 'Diagnoses are unavailable.', { code: 'UNAVAILABLE' })
      return { items: records[kind] ?? [], nextCursor: null }
    })
    await openEncounter()
    chooseMore('View diagnoses')
    expect(actions().getByRole('alert').textContent).toBe('Diagnoses are unavailable.')
    expect(actions().queryByText('No diagnoses for this encounter.')).toBeNull()
  })

  it('audit 9: offers no "View diagnoses" without ehr.diagnosis.read', async () => {
    staff.permissions = ALL.filter(permission => !permission.startsWith('ehr.diagnosis.'))
    await openEncounter()
    expect(menuLabels()).not.toContain('View diagnoses')
    expect(savedLabels()).not.toContain('Diagnosis')
  })
})

describe('Consultation record: closing what More actions opened (review finding 2)', () => {
  it('audit 11: "Cancel" closes a status change More actions opened, changing nothing, with focus back on the menu button', async () => {
    await openEncounter()
    chooseMore('Cancel encounter')
    expect(actions().getByText(/^Cancelling this encounter also cancels its draft/)).toBeTruthy()
    const cancel = actions().getByRole('button', { name: 'Cancel' })
    expect(cancel.getAttribute('type')).toBe('button')
    act(() => { cancel.focus() })
    fireEvent.click(cancel)
    expect(actions().queryByText(/^Cancelling this encounter also cancels its draft/)).toBeNull()
    expect(actions().queryByLabelText(labelled('Reason for change'))).toBeNull()
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().textContent).not.toContain('open')
    expect(api.updateEncounter).not.toHaveBeenCalled()
  })

  it('audit 9: "Cancel" closes "Add diagnosis", "Change diagnosis" (before and after a diagnosis is picked) and "Upload document"; "Close" closes "View diagnoses"', async () => {
    await openEncounter()
    const closes = (item: string, label: string, open: () => HTMLElement | null) => {
      chooseMore(item)
      expect(open()).toBeTruthy()
      fireEvent.click(actions().getByRole('button', { name: label }))
      expect(open()).toBeNull()
      expect(document.activeElement).toBe(moreButton())
    }
    closes('Add diagnosis', 'Cancel', () => actions().queryByRole('button', { name: 'Save record' }))
    closes('Change diagnosis', 'Cancel', () => actions().queryByLabelText(labelled('Diagnosis')))
    chooseMore('Change diagnosis')
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis')), { target: { value: 'dx-1' } })
    const update = actions().getByRole('button', { name: 'Update diagnosis' })
    // "Cancel" sits beside "Update diagnosis" once a diagnosis is picked.
    expect(update.parentElement?.contains(actions().getByRole('button', { name: 'Cancel' }))).toBe(true)
    fireEvent.click(actions().getByRole('button', { name: 'Cancel' }))
    expect(actions().queryByRole('button', { name: 'Update diagnosis' })).toBeNull()
    closes('Upload document', 'Cancel', () => actions().queryByRole('heading', { name: 'Upload a document' }))
    closes('View diagnoses', 'Close', () => actions().queryByRole('heading', { level: 3, name: 'Diagnoses' }))
    expect(api.createRecord).not.toHaveBeenCalled()
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('audit 11: the design’s own actions toggle with their button and carry no "Cancel"', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Write clinical note' }))
    expect(actions().queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(actions().getAllByRole('button', { name: 'Write clinical note' })[0]!)
    expect(actions().queryByRole('button', { name: 'Save draft' })).toBeNull()
  })
})

describe('Consultation record: documents (audit 9 and 13)', () => {
  it('audit 13: the "Documents · <file>" history row opens a clean document after the access re-check, in a new tab with no opener', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await openEncounter()
    const open = await history().findByRole('button', { name: 'Documents · referral-letter.pdf' })
    // A clean document is the design's one-line row: its link and badge, with no type, size or scan line.
    expect(history().queryByText('application/pdf · 20 KiB · scan: clean')).toBeNull()
    expect(open.getAttribute('aria-describedby')).toBeNull()
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(open)
    await waitFor(() => expect(opened).toHaveBeenCalledWith('https://storage.example.test/doc-1?signature=x', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(FACILITY_ID, 'doc-1')
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('audit 13: keeps the row disabled until the scan is clean, and explains an unfinished upload', async () => {
    api.documents.mockResolvedValue({ items: [{ ...DOCUMENT, status: 'initiated', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    expect((await history().findByRole('button', { name: 'Documents · referral-letter.pdf' }) as HTMLButtonElement).disabled).toBe(true)
    expect(history().getByText('Upload not completed; only the person who started it can finish it. Upload the file again.')).toBeTruthy()
    expect(history().queryByText(/scan:/)).toBeNull()
  })

  it('audit 13: a document whose scan is not clean keeps its type, size and scan line, which describes its disabled row', async () => {
    api.documents.mockResolvedValue({ items: [{ ...DOCUMENT, scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const open = await history().findByRole('button', { name: 'Documents · referral-letter.pdf' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(open.getAttribute('aria-describedby')).toBe(history().getByText('application/pdf · 20 KiB · scan: pending').id)
  })

  it('audit 13: refuses a link that is not a signed https link', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'javascript:alert(1)', expiresInSeconds: 60 })
    await openEncounter()
    fireEvent.click(await history().findByRole('button', { name: 'Documents · referral-letter.pdf' }))
    expect((await history().findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(opened).not.toHaveBeenCalled()
  })

  it('audit 9: "Upload document" (More actions) checks the file, then uploads it after the access re-check', async () => {
    await openEncounter()
    chooseMore('Upload document')
    expect(actions().getByRole('heading', { name: 'Upload a document' })).toBeTruthy()
    expect(actions().getByText('Files are scanned before download becomes available.')).toBeTruthy()
    const upload = actions().getByRole('button', { name: 'Upload document' })
    expect(upload.getAttribute('type')).toBe('submit')
    fireEvent.click(upload)
    expect(actions().getByText('Select a file first.')).toBeTruthy()
    const input = actions().getByLabelText(labelled('Clinical document')) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    fireEvent.click(upload)
    expect(actions().getByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(upload)
    expect(await actions().findByText('Document uploaded. It can be opened once its virus scan is clean.')).toBeTruthy()
    expect(api.uploadDocument).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, file)
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('audit 9: says a refused upload in its form', async () => {
    api.uploadDocument.mockRejectedValueOnce(new HidApiError(413, 'The file is too large.', { code: 'PAYLOAD_TOO_LARGE' }))
    await openEncounter()
    chooseMore('Upload document')
    fireEvent.change(actions().getByLabelText(labelled('Clinical document')), { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(actions().getByRole('button', { name: 'Upload document' }))
    expect((await actions().findByRole('alert')).textContent).toBe('The file is too large.')
  })

  it('audit 9: offers no upload without ehr.document.write', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.document.write')
    await openEncounter()
    expect(menuLabels()).not.toContain('Upload document')
  })

  it('item 3: links a clean document to today’s OCR page from its history row, with the ids in router state only, as today', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    renderWithOcr()
    expect(await screen.findByRole('heading', { level: 1, name: 'e0000000' })).toBeTruthy()
    const link = await history().findByRole('link', { name: 'Extract with OCR' })
    expect(link.closest('li')?.textContent).toContain('Documents · referral-letter.pdf')
    // The address names no record, patient or facility: today's route, and the ids in router state.
    expect(link.getAttribute('href')).toBe('/provider/ocr')
    for (const id of ['doc-1', PATIENT_ID, PATIENT_HID, FACILITY_ID, 'staff-1']) expect(link.getAttribute('href')).not.toContain(id)
    fireEvent.click(link)
    expect(await screen.findByTestId('ocr-page')).toBeTruthy()
    expect(screen.getByTestId('ocr-path').textContent).toBe('/provider/ocr')
    expect(screen.getByTestId('ocr-search').textContent).toBe('')
    expect(JSON.parse(screen.getByTestId('ocr-state').textContent ?? 'null')).toEqual({
      ocrDocumentId: 'doc-1', ocrPatientId: PATIENT_ID, actorId: 'staff-1', facilityId: FACILITY_ID,
    })
  })

  it('item 3: offers no OCR link without ocr.job.read, nor for a document whose scan is not clean', async () => {
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'lab-scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    expect(await history().findByRole('button', { name: 'Documents · lab-scan.pdf' })).toBeTruthy()
    expect(history().queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
  })

  it('item 3: links only the clean document when the role may read OCR jobs', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'lab-scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const row = async (name: string) => (await history().findByRole('button', { name })).closest('li') as HTMLElement
    expect(history().getAllByRole('link', { name: 'Extract with OCR' })).toHaveLength(1)
    expect(within(await row('Documents · lab-scan.pdf')).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(within(await row('Documents · referral-letter.pdf')).getByRole('link', { name: 'Extract with OCR' })).toBeTruthy()
  })

  it('audit 13: keeps today’s "Loading documents…" and "No documents for this encounter." under the history rows', async () => {
    let answer: (page: { items: unknown[]; nextCursor: null }) => void = () => {}
    api.documents.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await openEncounter()
    // The other lists are read: the vitals row shows, and the documents say they are still loading.
    expect(await history().findByRole('link', { name: /^Triage & Vitals · / })).toBeTruthy()
    expect(history().getByText('Loading documents…')).toBeTruthy()
    expect(history().queryByText('Loading records…')).toBeNull()
    expect(history().queryByText('No documents for this encounter.')).toBeNull()
    await act(async () => { answer({ items: [], nextCursor: null }) })
    expect(history().queryByText('Loading documents…')).toBeNull()
    const none = history().getByText('No documents for this encounter.')
    expect(history().getByRole('list').compareDocumentPosition(none) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('audit 13: says no empty sentence while the encounter has documents', async () => {
    await openEncounter()
    await history().findByRole('button', { name: 'Documents · referral-letter.pdf' })
    expect(history().queryByText('No documents for this encounter.')).toBeNull()
    expect(history().queryByText('Loading documents…')).toBeNull()
  })

  it('audit 13: says nothing about documents without ehr.document.read, and reads none', async () => {
    staff.permissions = ALL.filter(permission => !permission.startsWith('ehr.document.'))
    await openEncounter()
    await act(async () => {})
    expect(api.documents).not.toHaveBeenCalled()
    expect(history().queryByText('No documents for this encounter.')).toBeNull()
    expect(history().queryByText('Loading documents…')).toBeNull()
  })

  it('audit 13: says the document row is busy while it opens', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    let answer: (link: { url: string; expiresInSeconds: number }) => void = () => {}
    api.documentDownload.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await openEncounter()
    const open = await history().findByRole('button', { name: 'Documents · referral-letter.pdf' })
    expect(open.getAttribute('aria-busy')).toBeNull()
    fireEvent.click(open)
    await waitFor(() => expect(open.getAttribute('aria-busy')).toBe('true'))
    expect(open.getAttribute('aria-disabled')).toBe('true')
    // A second press while it opens asks for nothing more.
    fireEvent.click(open)
    await act(async () => { answer({ url: 'https://storage.example.test/doc-1?signature=x', expiresInSeconds: 60 }) })
    await waitFor(() => expect(open.getAttribute('aria-busy')).toBeNull())
    expect(api.documentDownload).toHaveBeenCalledTimes(1)
  })

  it('shows a refused document list as an alert in the history', async () => {
    api.documents.mockRejectedValue(new HidApiError(503, 'Documents are unavailable.', { code: 'UNAVAILABLE' }))
    await openEncounter()
    await act(async () => {})
    expect(history().getByRole('alert').textContent).toBe('Documents are unavailable.')
  })

  it('shows each history list’s own failure, so a refused document list is not hidden by a failed vitals read', async () => {
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'vitals') throw new HidApiError(503, 'Vitals are unavailable.', { code: 'UNAVAILABLE' })
      return { items: records[kind] ?? [], nextCursor: null }
    })
    api.documents.mockRejectedValue(new HidApiError(403, 'Your role cannot read documents for this patient.', { code: 'PERMISSION_DENIED' }))
    await openEncounter()
    await waitFor(() => expect(history().getAllByRole('alert')).toHaveLength(2))
    expect(history().getAllByRole('alert').map(alert => alert.textContent)).toEqual(['Vitals are unavailable.', 'Your role cannot read documents for this patient.'])
  })

  it('says a failure two history lists share once', async () => {
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'vitals') throw UNAVAILABLE()
      return { items: records[kind] ?? [], nextCursor: null }
    })
    api.documents.mockRejectedValue(UNAVAILABLE())
    await openEncounter()
    await waitFor(() => expect(history().getByRole('alert').textContent).toBe('EHR is unavailable.'))
    expect(history().getAllByRole('alert')).toHaveLength(1)
  })
})
