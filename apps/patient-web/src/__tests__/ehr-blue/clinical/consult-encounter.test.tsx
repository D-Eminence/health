import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, labelled, patientBanner, renderPage } from './harness'

/**
 * Consultation, one encounter: the design's record page (Saved record, Available actions with the typed SIGN
 * dialog, History, Earlier versions) on today's encounter, note, diagnosis and
 * document calls, with every access re-check and refusal today has. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

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
const ENDED = 'Patient access has ended. Find the patient again to reopen their record.'
const STALE = new HidApiError(412, 'The record changed since it was read.', { code: 'PRECONDITION_FAILED' })

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.facilityId = undefined
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

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
  // The note's content, once read (in the Note card, and in an earlier version too).
  expect((await screen.findAllByText('Cough for three days.', { exact: false })).length).toBeGreaterThan(0)
}

function card(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement
}

function actions() {
  return within(card('Actions'))
}

/** The line under the heading: status and time (the patient is in the sticky patient banner above it). */
function meta() {
  return screen.getByText(/^Started /).parentElement as HTMLElement
}

function dialog() {
  return screen.getByRole('alertdialog')
}

/** The open action's submit button (the action's own button toggles its form). */
function submitOf(name: string) {
  return actions().getAllByRole('button', { name }).find(button => button.getAttribute('type') === 'submit')!
}

const UNAVAILABLE = () => new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
/** The live actions behind More actions for an in-progress consultation with a draft note read (owner decision 1). */
const MENU = ['Complete consultation', 'Put on hold', 'Cancel consultation', 'Mark as entered in error', 'Mark note entered in error']

function history() {
  return within(card('History'))
}

/** The "More actions" menu button at the end of Actions. */
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

/** Chooses one of More actions' items, which opens its form in Actions. */
function chooseMore(label: string) {
  fireEvent.click(moreButton())
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
}

/** The Earlier versions card's summaries. */
function versionSummaries() {
  return Array.from(card('Earlier versions').querySelectorAll('summary')).map(summary => summary.textContent)
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
  it('shows the design’s record page on today’s encounter, note and diagnosis', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    await openEncounter()
    // The patient is named once, in the sticky banner over the page.
    expect(patientBanner().textContent).toContain(PATIENT_HID)
    expect(within(meta()).getByText('In progress')).toBeTruthy()
    expect(within(meta()).getByText(/^Started \d+ \w+ 2026, /)).toBeTruthy()
    const saved = within(card('Note'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values).toMatchObject({
      'Type of visit': 'Outpatient', Complaint: 'Fever for two days', Diagnosis: 'Malaria (fictional)', 'Note status': 'draft',
      Note: 'History\nCough for three days.',
    })
    // The note's actions; every other live action is behind one More actions menu at the card's end.
    expect(actions().getAllByRole('button').map(button => button.textContent?.replace('▾', ''))).toEqual(['Sign note', 'Write note', 'More actions'])
    expect(moreButton().getAttribute('aria-haspopup')).toBe('menu')
    expect(menuLabels()).toEqual(MENU)
    // The orders are a card of their own now, after the diagnoses.
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
    expect(saved.getByRole('button', { name: 'Edit draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
    // Reads: the access re-check first; records with today's four arguments.
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes')
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1')
  })

  it('lists the connected hospital history, each with its status, linking records that have their own page by ids only', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read', 'ehr.lab-request.read']
    const observation = { ...NOTE, id: 'b1c6ef36-0000-4000-8000-000000000001', noteType: 'Nursing observation', title: 'Vitals', status: 'signed' }
    records['clinical-notes'] = [NOTE, observation]
    records.prescriptions = [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, medicationDisplay: 'Amoxicillin (fictional)', status: 'active' }]
    records['lab-requests'] = [{ id: 'lab-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, testDisplay: 'Malaria smear (fictional)', status: 'draft' }]
    await openEncounter()
    const history = within(card('History'))
    expect(history.getByText('Only records your role can see are listed.')).toBeTruthy()
    const row = (name: string) => history.getByText(name).closest('li') as HTMLElement
    const link = (name: string) => history.getByRole('link', { name }).getAttribute('href')
    expect(link('Consultation · e2222222')).toBe(`/provider/clinical/${OTHER.id}`)
    for (const label of ['Notes · Consultation note', 'Diagnoses · Malaria (fictional)', 'Documents · referral-letter.pdf']) {
      expect(history.getByText(label).tagName).toBe('SPAN')
    }
    expect(within(row('Notes · Consultation note')).getByText('Draft')).toBeTruthy()
    // A nursing observation is not a clinical note row: it links to its own page, as the nursing pages name it.
    expect(history.queryByText('Notes · Vitals')).toBeNull()
    expect(link('Nursing observations · b1c6ef36')).toBe(`/provider/nursing/${ENCOUNTER_ID}~${observation.id}`)
    expect(within(row('Nursing observations · b1c6ef36')).getByText('Signed')).toBeTruthy()
    expect(link('Vitals · vital-1')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-1`)
    expect(within(row('Vitals · vital-1')).getByText('Final')).toBeTruthy()
    expect(link('Pharmacy · Amoxicillin (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/rx-1`)
    expect(link('Laboratory · Malaria smear (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/lab-1`)
    for (const href of history.getAllByRole('link').map(item => item.getAttribute('href') ?? '')) {
      expect(href).not.toContain(PATIENT_HID)
      expect(href).not.toContain(PATIENT_ID)
    }
  })

  it('item 1: offers "Write clinical note" while the encounter already has a note, with today’s note type, title and content', async () => {
    api.createRecord.mockResolvedValue({ id: 'note-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
    await openEncounter()
    // The draft is there and still offered for signing; a second note can be written beside it.
    expect(actions().getByRole('button', { name: 'Sign note' })).toBeTruthy()
    fireEvent.click(actions().getByRole('button', { name: 'Write note' }))
    expect(actions().getByText('The note saves as a draft. Sign it on the consultation’s page.')).toBeTruthy()
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
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Progress', title: 'Evening review', status: 'draft', content: 'Fever settling.',
    }, expect.any(String))
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    // Today's create reads the notes' first page again, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    expect(actions().getByRole('button', { name: 'Write note' })).toBeTruthy()
  })

  it('item 1: still offers "Write clinical note" once the consultation note is entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    await openEncounter()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Mark note entered in error' })).toBeNull()
    expect(actions().getByRole('button', { name: 'Write note' })).toBeTruthy()
  })

  it('leaves a refuted diagnosis out of the encounter’s Diagnosis, and badges it refuted', async () => {
    records.diagnoses = [
      { ...DIAGNOSIS, verificationStatus: 'refuted' },
      { ...DIAGNOSIS, id: 'dx-2', code: 'R50.9', display: 'Fever (fictional)', verificationStatus: 'confirmed' },
    ]
    await openEncounter()
    const saved = within(card('Note'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values.Diagnosis).toBe('Fever (fictional)')
    const history = within(card('History'))
    expect(within(history.getByText('Diagnoses · Malaria (fictional)').closest('li') as HTMLElement).getByText('Refuted')).toBeTruthy()
    expect(within(history.getByText('Diagnoses · Fever (fictional)').closest('li') as HTMLElement).getByText('Active')).toBeTruthy()
    expect(within(card('Diagnoses')).getByText('ICD-10 · B54 · active · refuted')).toBeTruthy()
  })

  it('says the role grants no access to encounter records when it holds none of the record reads', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    expect(screen.getByText('Your role here can’t see these records.')).toBeTruthy()
    expect(api.records).not.toHaveBeenCalled()
    expect(api.documents).not.toHaveBeenCalled()
  })

  it('does not say so when the role holds one record read', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('link', { name: 'Vitals · vital-1' })).toBeTruthy()
    expect(screen.queryByText('Your role here can’t see these records.')).toBeNull()
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
    expect(within(dialog()).getByText('Check the details first. This changes the saved record; the change is kept in its history.')).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign note' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'sign' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    expect(confirm.disabled).toBe(false)
    const checks = api.lookupPatient.mock.calls.length
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', rowVersion: 3 }]
    fireEvent.click(confirm)

    expect(await screen.findByText('Note updated.')).toBeTruthy()
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
    expect(within(card('Note')).getByText('draft')).toBeTruthy()
  })

  it('offers no signing until the note’s content has been read', async () => {
    api.noteRevisions.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull()
  })

  it('shows a note that cannot be read, and offers no signing', async () => {
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    const content = saved.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect(content.value).toBe('History\nCough for three days.')
    fireEvent.change(content, { target: { value: 'History\nCough for four days.' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(saved.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Duration corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Note changes saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'History\nCough for four days.' }, expect.any(String))
    expect(screen.getByRole('button', { name: 'Edit draft' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('amends a signed note with today’s checks, reusing the key on retry', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    const form = actions().getByRole('button', { name: 'Amend signed note', expanded: true }).parentElement!.parentElement!
    const save = () => actions().getAllByRole('button', { name: 'Amend signed note' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.change(within(form).getByLabelText(labelled('Reason')), { target: { value: 'ok' } })
    fireEvent.click(save())
    expect(actions().getByText('Enter the revised note content.')).toBeTruthy()
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()

    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Corrected: cough for four days.' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Duration corrected' } })
    api.addNoteRevision.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(save())
    expect((await actions().findByRole('alert')).textContent).toBe('EHR is unavailable.')
    fireEvent.click(save())
    expect(await screen.findByText('Note changes saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'Corrected: cough for four days.' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('keeps every revision under "Earlier versions"', async () => {
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
      REVISION,
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    const versions = await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    const summaries = Array.from(versions.closest('section')!.querySelectorAll('summary')).map(summary => summary.textContent)
    // Each named by the status it was saved under: a never-signed note's are drafts.
    expect(summaries).toEqual([
      `${formatWhen('2026-10-30T08:10:00.000Z')} · Version 1 · Draft · Initial draft`,
      `${formatWhen('2026-10-30T09:00:00.000Z')} · Version 2 · Draft · Duration corrected`,
    ])
    // The latest revision is the note shown.
    expect(within(card('Note')).getByText('History\nCough for four days.', { normalizer: value => value })).toBeTruthy()
  })

  it('completes the encounter with a reason, re-checking access first', async () => {
    await openEncounter()
    chooseMore('Complete consultation')
    expect(actions().getByText(/^Cancelling also cancels its open prescriptions and lab requests\./)).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: '  ' } })
    const save = () => actions().getAllByRole('button', { name: 'Complete consultation' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.click(save())
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.updateEncounter).not.toHaveBeenCalled()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    fireEvent.click(save())
    expect(await screen.findByText('Consultation updated.')).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID,
      { expectedRowVersion: 3, changeReason: 'Seen and treated', status: 'completed', endedAt: expect.any(String) })
    expect(within(meta()).getByText('Completed')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Complete consultation' })).toBeNull()
    expect(menuLabels()).not.toContain('Complete consultation')
  })

  it('asks before cancelling the encounter (no typed word), and says when the role may not', async () => {
    api.updateEncounter.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    await openEncounter()
    chooseMore('Cancel consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Booked in error' } })
    fireEvent.click(actions().getAllByRole('button', { name: 'Cancel consultation' }).find(button => button.getAttribute('type') === 'submit')!)
    expect(within(dialog()).getByRole('heading', { name: 'Cancel consultation?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel consultation' }))
    expect((await actions().findByRole('alert')).textContent).toBe('You can’t cancel this consultation: it holds records your role can’t change. Nothing was changed. Ask a doctor or clinician to do it.')
  })

  it('re-reads an encounter that changed meanwhile and says so', async () => {
    api.updateEncounter.mockRejectedValueOnce(STALE)
    await openEncounter()
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 5 })
    chooseMore('Complete consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    // A pressed button takes focus (as in a browser); the change removes it with its form.
    act(() => { submitOf('Complete consultation').focus() })
    fireEvent.click(submitOf('Complete consultation'))
    expect((await screen.findByRole('alert')).textContent).toBe('Someone changed this consultation while you had it open. It now shows its current status; choose the change again if it’s still needed.')
    expect(within(meta()).getByText('On hold')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Actions')
    expect(menuLabels()).toContain('Resume consultation')
  })

  it('shows today’s read-only sentence and no changes under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openEncounter()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(actions().getByText('Nothing more to do here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Add a diagnosis' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
  })

  it('shows the read-only emergency notice and reads nothing for an emergency patient', () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
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
    expect(screen.getByText('This record doesn’t exist, or it belongs to another facility.')).toBeTruthy()
  })

  it('shows no Orders card to a role that may add orders but read none, at a real facility: it would be empty', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.write', 'ehr.lab-request.write']
    await openEncounter()
    expect(screen.queryByRole('heading', { level: 2, name: 'Orders' })).toBeNull()
    expect(screen.queryByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeNull()
  })

  it('shows the Orders card to a role that reads lab requests only', async () => {
    staff.permissions = [...ALL, 'ehr.lab-request.read']
    await openEncounter()
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
  })

  it('keeps the Orders card at a demo facility, for its sample radiology and referral steps', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    api.encounter.mockResolvedValue({ ...ENCOUNTER, facilityId: DEMO_HOSPITAL_ID })
    await openEncounter()
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
  })

  it('mounts the orders pages under the encounter', async () => {
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}/orders/new`)
    expect(screen.getByText('Order pages part')).toBeTruthy()
  })
})

describe('Consultation record: diagnoses', () => {
  it('adds a diagnosis, and shows a refused field at its control with today’s sentence', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'display', messages: ['display must be shorter than or equal to 500 characters'] }],
    }))
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    expect(diagnoses.getByText('Malaria (fictional)')).toBeTruthy()
    expect(diagnoses.getByText('ICD-10 · B54 · active · provisional')).toBeTruthy()
    fireEvent.change(diagnoses.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Code')), { target: { value: 'R50.9' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Diagnosis')), { target: { value: 'Fever' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Add diagnosis' }))
    expect((await diagnoses.findByRole('alert')).textContent).toBe('One or more request fields are invalid. Display must be shorter than or equal to 500 characters.')
    expect(diagnoses.getByLabelText(labelled('Diagnosis')).getAttribute('aria-invalid')).toBe('true')

    fireEvent.click(diagnoses.getByRole('button', { name: 'Add diagnosis' }))
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses',
      { codeSystem: 'ICD-10', code: 'R50.9', display: 'Fever', clinicalStatus: 'active', verificationStatus: 'unconfirmed', notes: undefined }, expect.any(String))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('changes a diagnosis, sending only what changed', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    fireEvent.change(diagnoses.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Update diagnosis' }))
    expect(diagnoses.getByText('Change the clinical status, verification or notes before saving.')).toBeTruthy()
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
    const verification = diagnoses.getAllByLabelText(labelled('Verification')).find(control => (control as HTMLSelectElement).value === 'provisional')!
    fireEvent.change(verification, { target: { value: 'confirmed' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    expect(api.updateDiagnosis).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'dx-1',
      { expectedRowVersion: 1, changeReason: 'Smear positive', verificationStatus: 'confirmed' })
  })

  it('says when there are none, and offers no change for one entered in error', async () => {
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'entered_in_error' }]
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    expect(diagnoses.getByText('Entered in error')).toBeTruthy()
    expect(diagnoses.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
  })
})

describe('Consultation record: documents', () => {
  it('opens a clean document after the access re-check, in a new tab with no opener', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await openEncounter()
    const documents = within(card('Documents'))
    expect(documents.getByText('PDF · 20 KB · Checked')).toBeTruthy()
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(documents.getByRole('button', { name: 'Open file referral-letter.pdf' }))
    await waitFor(() => expect(opened).toHaveBeenCalledWith('https://storage.example.test/doc-1?signature=x', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(FACILITY_ID, 'doc-1')
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('keeps "Open file" disabled until the scan is clean, and explains an unfinished upload', async () => {
    api.documents.mockResolvedValue({ items: [{ ...DOCUMENT, status: 'initiated', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const documents = within(card('Documents'))
    expect((documents.getByRole('button', { name: 'Open file referral-letter.pdf' }) as HTMLButtonElement).disabled).toBe(true)
    expect(documents.getByText('Upload didn’t finish. Upload the file again.')).toBeTruthy()
    expect(documents.queryByText(/scan:/)).toBeNull()
  })

  it('refuses a link that is not a signed https link', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'javascript:alert(1)', expiresInSeconds: 60 })
    await openEncounter()
    fireEvent.click(within(card('Documents')).getByRole('button', { name: 'Open file referral-letter.pdf' }))
    expect((await within(card('Documents')).findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(opened).not.toHaveBeenCalled()
  })

  it('checks the file, then uploads it after the access re-check', async () => {
    await openEncounter()
    const documents = within(card('Documents'))
    const upload = documents.getByRole('button', { name: 'Upload document' })
    expect(upload.getAttribute('type')).toBe('submit')
    fireEvent.click(upload)
    expect(documents.getByText('Select a file first.')).toBeTruthy()
    const input = documents.getByLabelText(labelled('Clinical document')) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    fireEvent.click(upload)
    expect(documents.getByText('Use a PDF, JPEG, PNG or TIFF file up to 50 MB.')).toBeTruthy()
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(upload)
    expect(await documents.findByText('Uploaded. It can be opened once the virus check is done.')).toBeTruthy()
    expect(api.uploadDocument).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, file)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('shows the empty and failed states', async () => {
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    await openEncounter()
    expect(within(card('Documents')).getByText('No documents for this encounter.')).toBeTruthy()
  })

  it('item 3: links a clean document to today’s OCR page with the ids in router state only, as today', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    renderWithOcr()
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    const link = await within(card('Documents')).findByRole('link', { name: 'Extract with OCR' })
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
    expect(within(card('Documents')).getByText('referral-letter.pdf')).toBeTruthy()
    expect(within(card('Documents')).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
  })

  it('item 3: links only the clean document when the role may read OCR jobs', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'lab-scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const documents = within(card('Documents'))
    expect(documents.getAllByRole('link', { name: 'Extract with OCR' })).toHaveLength(1)
    expect(within(documents.getByText('lab-scan.pdf').closest('li') as HTMLElement).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(within(documents.getByText('referral-letter.pdf').closest('li') as HTMLElement).getByRole('link', { name: 'Extract with OCR' })).toBeTruthy()
  })

  it('shows a refused document list as an alert', async () => {
    api.documents.mockRejectedValue(new HidApiError(503, 'Documents are unavailable.', { code: 'UNAVAILABLE' }))
    await openEncounter()
    await act(async () => {})
    expect(within(card('Documents')).getByRole('alert').textContent).toBe('Documents are unavailable.')
  })
})

describe('Consultation record: More actions, diagnoses with a note change, and versions (#62)', () => {
  it('offers a signed note’s "Amend signed note" with the menu, and "Resume consultation" for one on hold', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold' })
    await openEncounter()
    expect(actions().getAllByRole('button').map(button => button.textContent?.replace('▾', ''))).toEqual(['Amend signed note', 'Write note', 'More actions'])
    expect(menuLabels()).toEqual(['Resume consultation', 'Cancel consultation', 'Mark as entered in error', 'Mark note entered in error'])
  })

  it('marks the consultation note entered in error from More actions, under a typed reason, with a plain confirm', async () => {
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
    expect(await screen.findByText('Note updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Wrong patient', status: 'entered_in_error' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('"Cancel" closes a status change More actions opened, changing nothing, with focus back on the menu button', async () => {
    await openEncounter()
    chooseMore('Cancel consultation')
    expect(actions().getByText(/^Cancelling also cancels/)).toBeTruthy()
    const cancel = actions().getByRole('button', { name: 'Cancel' })
    expect(cancel.getAttribute('type')).toBe('button')
    act(() => { cancel.focus() })
    fireEvent.click(cancel)
    expect(actions().queryByText(/^Cancelling also cancels/)).toBeNull()
    expect(actions().queryByLabelText(labelled('Reason for change'))).toBeNull()
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().textContent).not.toContain('open')
    expect(api.updateEncounter).not.toHaveBeenCalled()
  })

  it('the note’s own actions toggle with their button and carry no "Cancel"', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Write note' }))
    expect(actions().queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(actions().getAllByRole('button', { name: 'Write note' })[0]!)
    expect(actions().queryByRole('button', { name: 'Save draft' })).toBeNull()
  })

  it('offers no "Write note" to a role that may write notes but not read them', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e0000000' })).toBeTruthy()
    await screen.findByRole('heading', { level: 2, name: 'Actions' })
    expect(actions().queryByRole('button', { name: 'Write note' })).toBeNull()
  })

  it('"Edit draft" takes New consultation’s diagnosis fields; the diagnosis is saved after the revision, a retry sending only it, under the same key', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    expect(saved.getByText('Optional. Add its code to save it as this consultation’s diagnosis.')).toBeTruthy()
    expect((saved.getByLabelText(labelled('Code system')) as HTMLInputElement).placeholder).toBe('ICD-10')
    expect((saved.getByLabelText(labelled('Clinical status')) as HTMLSelectElement).value).toBe('active')
    expect((saved.getByLabelText(labelled('Verification')) as HTMLSelectElement).value).toBe('unconfirmed')
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    const save = () => saved.getByRole('button', { name: 'Save draft' })
    fireEvent.click(save())
    // New consultation's check: with a diagnosis, its code system and code are needed too.
    expect(saved.getAllByText('Complete this field.')).toHaveLength(2)
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(save())
    expect((await saved.findByRole('alert')).textContent).toContain('EHR is unavailable.')
    // The revision is in, and the page says so; each save re-checked access first.
    expect(screen.getByText('Note changes saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'unconfirmed',
    }, expect.any(String))

    fireEvent.click(save())
    expect(await screen.findByText('Note changes saved. Saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(2)
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
    // Today's create read: the diagnoses' first page, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
  })

  it('a draft form left after its revision was saved and its diagnosis refused reads the note again', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    fireEvent.click(saved.getByRole('button', { name: 'Save draft' }))
    expect((await saved.findByRole('alert')).textContent).toContain('EHR is unavailable.')
    expect(api.records).not.toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    records['clinical-notes'] = [{ ...NOTE, rowVersion: 3 }]
    fireEvent.click(saved.getByRole('button', { name: 'Cancel editing' }))
    await waitFor(() => expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true }))
    // The revision was sent once, and nothing more is sent.
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(1)
  })

  it('"Amend signed note" takes the diagnosis fields too, and shows a refused diagnosis field at its control', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Smear positive (fictional).' } })
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(actions().getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(actions().getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    fireEvent.change(actions().getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Result back' } })
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'code', messages: ['code must be shorter than or equal to 100 characters'] }],
    }))
    fireEvent.click(submitOf('Amend signed note'))
    expect(await actions().findByRole('alert')).toBeTruthy()
    expect(actions().getByLabelText(labelled('Code')).getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(submitOf('Amend signed note'))
    expect(await screen.findByText('Note changes saved. Saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'confirmed',
    }, expect.any(String))
  })

  it('offers no diagnosis fields with a note change without ehr.diagnosis.write', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.write')
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    expect(within(card('Note')).queryByLabelText(labelled('Code system'))).toBeNull()
    expect(within(card('Note')).getByLabelText(labelled('Clinical note'))).toBeTruthy()
  })

  it('shows a signed note’s versions with one revision: the version it was signed as', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    await openEncounter()
    expect(versionSummaries()).toEqual([`${formatWhen('2026-10-30T08:40:00.000Z')} · Version 1 · Draft · Sign note`])
    expect(within(card('Earlier versions')).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('places the signed version among an amended note’s revisions, with the content signed', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'amended', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      REVISION,
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    // Each revision is named by the status it was saved under: a draft before signing, an amendment after.
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-30T08:10:00.000Z')} · Version 1 · Draft · Initial draft`,
      `${formatWhen('2026-10-30T08:40:00.000Z')} · Version 1 · Draft · Sign note`,
      `${formatWhen('2026-10-30T09:00:00.000Z')} · Version 2 · Amended · Duration corrected`,
    ])
    const signed = Array.from(card('Earlier versions').querySelectorAll('details'))[1]!
    expect(within(signed).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('names a signed note’s draft edits "Draft", not by the status the note has now', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T09:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, createdAt: '2026-10-30T09:31:00.000Z', changeReason: 'Initial note' },
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Added plan', createdAt: '2026-10-30T09:35:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-30T09:31:00.000Z')} · Version 1 · Draft · Initial note`,
      `${formatWhen('2026-10-30T09:35:00.000Z')} · Version 2 · Draft · Added plan`,
      `${formatWhen('2026-10-30T09:40:00.000Z')} · Version 2 · Draft · Sign note`,
    ])
  })

  it('names a never-signed note’s revisions "Draft" once it is marked entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, createdAt: '2026-10-29T09:31:00.000Z', changeReason: 'Initial note' },
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Added plan', createdAt: '2026-10-29T09:35:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    // Both were saved while the note was a draft; only the note itself is now entered in error.
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-29T09:31:00.000Z')} · Version 1 · Draft · Initial note`,
      `${formatWhen('2026-10-29T09:35:00.000Z')} · Version 2 · Draft · Added plan`,
    ])
  })

  it('shows no versions card for a draft with one revision', async () => {
    await openEncounter()
    expect(screen.queryByRole('heading', { level: 2, name: 'Earlier versions' })).toBeNull()
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
