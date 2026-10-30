import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Consultation, one encounter: the design's record page (Saved record, Available actions with the typed SIGN
 * dialog, Connected hospital history, Preserved versions & amendments) on today's encounter, note, diagnosis and
 * document calls, with every access re-check and refusal today has. Everything is fictional.
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

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: 'e0000000' })).toBeTruthy()
  await screen.findByText('Cough for three days.', { exact: false })
}

function card(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement
}

function actions() {
  return within(card('Available actions'))
}

/** The line under the heading: status, patient, time. */
function meta() {
  return screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`).parentElement as HTMLElement
}

function dialog() {
  return screen.getByRole('alertdialog')
}

describe('Consultation record', () => {
  it('shows the design’s record page on today’s encounter, note and diagnosis', async () => {
    await openEncounter()
    expect(screen.getByText(`${PATIENT_NAME} · ${PATIENT_HID}`)).toBeTruthy()
    expect(within(meta()).getByText('in progress')).toBeTruthy()
    expect(within(meta()).getByText(/^Started \d+\/\d+\/2026, /)).toBeTruthy()
    const saved = within(card('Saved record'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values).toMatchObject({
      'Encounter type': 'Outpatient', Complaint: 'Fever for two days', Diagnosis: 'Malaria (fictional)', 'Note status': 'draft',
      Note: 'History\nCough for three days.',
    })
    expect(actions().getAllByRole('button').map(button => button.textContent)).toEqual([
      'Sign encounter', 'Mark note entered in error', 'Put encounter on hold', 'Complete encounter', 'Cancel encounter', 'Mark encounter entered in error',
    ])
    expect(actions().getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
    expect(saved.getByRole('button', { name: 'Edit unsigned draft' })).toBeTruthy()
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
    const history = within(card('Connected hospital history'))
    expect(history.getByText('Only records available to your current permissions are listed.')).toBeTruthy()
    const row = (name: string) => history.getByText(name).closest('li') as HTMLElement
    const link = (name: string) => history.getByRole('link', { name }).getAttribute('href')
    expect(link('Consultation · e2222222')).toBe(`/provider/clinical/${OTHER.id}`)
    for (const label of ['Clinical notes · Consultation note', 'Diagnoses · Malaria (fictional)', 'Documents · referral-letter.pdf']) {
      expect(history.getByText(label).tagName).toBe('SPAN')
    }
    expect(within(row('Clinical notes · Consultation note')).getByText('draft')).toBeTruthy()
    // A nursing observation is not a clinical note row: it links to its own page, as the nursing pages name it.
    expect(history.queryByText('Clinical notes · Vitals')).toBeNull()
    expect(link('Nursing observations · b1c6ef36')).toBe(`/provider/nursing/${ENCOUNTER_ID}~${observation.id}`)
    expect(within(row('Nursing observations · b1c6ef36')).getByText('signed')).toBeTruthy()
    expect(link('Triage & Vitals · vital-1')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-1`)
    expect(within(row('Triage & Vitals · vital-1')).getByText('final')).toBeTruthy()
    expect(link('Pharmacy · Amoxicillin (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/rx-1`)
    expect(link('Laboratory · Malaria smear (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/lab-1`)
    for (const href of history.getAllByRole('link').map(item => item.getAttribute('href') ?? '')) {
      expect(href).not.toContain(PATIENT_HID)
      expect(href).not.toContain(PATIENT_ID)
    }
  })

  it('offers "Write clinical note" again once the consultation note is entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    api.createRecord.mockResolvedValue({ id: 'note-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
    await openEncounter()
    expect(actions().queryByRole('button', { name: 'Sign encounter' })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Mark note entered in error' })).toBeNull()
    fireEvent.click(actions().getByRole('button', { name: 'Write clinical note' }))
    fireEvent.change(actions().getByLabelText(labelled('Clinical note')), { target: { value: 'History\nCough for three days, correct patient.' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(actions().getAllByRole('button', { name: 'Write clinical note' }).find(button => button.getAttribute('type') === 'submit')!)
    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Consultation', title: 'Consultation note', status: 'draft', content: 'History\nCough for three days, correct patient.',
    }, expect.any(String))
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('leaves a refuted diagnosis out of the encounter’s Diagnosis, and badges it refuted', async () => {
    records.diagnoses = [
      { ...DIAGNOSIS, verificationStatus: 'refuted' },
      { ...DIAGNOSIS, id: 'dx-2', code: 'R50.9', display: 'Fever (fictional)', verificationStatus: 'confirmed' },
    ]
    await openEncounter()
    const saved = within(card('Saved record'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values.Diagnosis).toBe('Fever (fictional)')
    const history = within(card('Connected hospital history'))
    expect(within(history.getByText('Diagnoses · Malaria (fictional)').closest('li') as HTMLElement).getByText('refuted')).toBeTruthy()
    expect(within(history.getByText('Diagnoses · Fever (fictional)').closest('li') as HTMLElement).getByText('active')).toBeTruthy()
    expect(within(card('Diagnoses')).getByText('ICD-10 · B54 · active · refuted')).toBeTruthy()
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

  it('signs the encounter’s note only after SIGN is typed, after the access re-check', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Sign encounter' }))
    const submit = actions().getAllByRole('button', { name: 'Sign encounter' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.click(submit)
    expect(within(dialog()).getByRole('heading', { name: 'Sign encounter?' })).toBeTruthy()
    expect(within(dialog()).getByText('Review the entered details before continuing. This action changes the saved record and is recorded in its history.')).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign encounter' }) as HTMLButtonElement
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
      { expectedRowVersion: 2, changeReason: 'Sign encounter', status: 'signed' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { fresh: true })
    await waitFor(() => expect(actions().queryByRole('button', { name: 'Sign encounter' })).toBeNull())
    expect(actions().getByRole('button', { name: 'Amend signed note' })).toBeTruthy()
  })

  it('keeps the draft when the sign dialog is cancelled, or closed with Escape', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Sign encounter' }))
    const submit = () => actions().getAllByRole('button', { name: 'Sign encounter' }).find(button => button.getAttribute('type') === 'submit')!
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
    expect(within(card('Saved record')).getByText('draft')).toBeTruthy()
  })

  it('offers no signing until the note’s content has been read', async () => {
    api.noteRevisions.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Sign encounter' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit unsigned draft' })).toBeNull()
  })

  it('shows a note that cannot be read, and offers no signing', async () => {
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    expect(actions().queryByRole('button', { name: 'Sign encounter' })).toBeNull()
  })

  it('shows a stale sign in the form, as today', async () => {
    api.updateRecord.mockRejectedValueOnce(STALE)
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Sign encounter' }))
    fireEvent.click(actions().getAllByRole('button', { name: 'Sign encounter' }).find(button => button.getAttribute('type') === 'submit')!)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign encounter' }))
    expect((await actions().findByRole('alert')).textContent).toBe('The record changed since it was read.')
  })

  it('edits the unsigned draft as a new revision, prefilled with its content', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit unsigned draft' }))
    const content = within(card('Saved record')).getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect(content.value).toBe('History\nCough for three days.')
    fireEvent.change(content, { target: { value: 'History\nCough for four days.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }))
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Draft edited', content: 'History\nCough for four days.' }, expect.any(String))
    expect(screen.getByRole('button', { name: 'Edit unsigned draft' }).getAttribute('aria-expanded')).toBe('false')
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
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'Corrected: cough for four days.' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('keeps every revision under "Preserved versions & amendments"', async () => {
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
      REVISION,
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    const versions = await screen.findByRole('heading', { level: 2, name: 'Preserved versions & amendments' })
    const summaries = Array.from(versions.closest('section')!.querySelectorAll('summary')).map(summary => summary.textContent)
    expect(summaries).toEqual([
      '2026-10-30T08:10:00.000Z · Revision 1 · Initial draft',
      '2026-10-30T09:00:00.000Z · Revision 2 · Duration corrected',
    ])
    // The latest revision is the note shown.
    expect(within(card('Saved record')).getByText('History\nCough for four days.', { normalizer: value => value })).toBeTruthy()
  })

  it('completes the encounter with a reason, re-checking access first', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Complete encounter' }))
    expect(actions().getByText(/^Cancelling this encounter also cancels its draft/)).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: '  ' } })
    const save = () => actions().getAllByRole('button', { name: 'Complete encounter' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.click(save())
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.updateEncounter).not.toHaveBeenCalled()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    fireEvent.click(save())
    expect(await screen.findByText('Encounter status updated.')).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID,
      { expectedRowVersion: 3, changeReason: 'Seen and treated', status: 'completed', endedAt: expect.any(String) })
    expect(within(meta()).getByText('completed')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Complete encounter' })).toBeNull()
  })

  it('asks before cancelling the encounter (no typed word), and says when the role may not', async () => {
    api.updateEncounter.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Cancel encounter' }))
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Booked in error' } })
    fireEvent.click(actions().getAllByRole('button', { name: 'Cancel encounter' }).find(button => button.getAttribute('type') === 'submit')!)
    expect(within(dialog()).getByRole('heading', { name: 'Cancel encounter?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel encounter' }))
    expect((await actions().findByRole('alert')).textContent).toBe('You may not cancel this encounter: it holds records that this change would also change, and your role may not change all of them. Nothing was changed. Ask a colleague whose role may change all of its records (usually a doctor or clinician) to make this change.')
  })

  it('re-reads an encounter that changed meanwhile and says so', async () => {
    api.updateEncounter.mockRejectedValueOnce(STALE)
    await openEncounter()
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 5 })
    fireEvent.click(actions().getByRole('button', { name: 'Complete encounter' }))
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    fireEvent.click(actions().getAllByRole('button', { name: 'Complete encounter' }).find(button => button.getAttribute('type') === 'submit')!)
    expect((await screen.findByRole('alert')).textContent).toBe('This encounter changed since it was loaded and now shows its current status. Choose the change again if it is still needed.')
    expect(within(meta()).getByText('on hold')).toBeTruthy()
    expect(actions().getByRole('button', { name: 'Resume encounter' })).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Available actions')
  })

  it('shows today’s read-only sentence and no changes under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openEncounter()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(actions().getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit unsigned draft' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Add diagnoses' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
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
    fireEvent.click(actions().getByRole('button', { name: 'Sign encounter' }))
    fireEvent.click(actions().getAllByRole('button', { name: 'Sign encounter' }).find(button => button.getAttribute('type') === 'submit')!)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign encounter' }))
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
    fireEvent.change(diagnoses.getByLabelText(labelled('Display')), { target: { value: 'Fever' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Save record' }))
    expect((await diagnoses.findByRole('alert')).textContent).toBe('One or more request fields are invalid. Display must be shorter than or equal to 500 characters.')
    expect(diagnoses.getByLabelText(labelled('Display')).getAttribute('aria-invalid')).toBe('true')

    fireEvent.click(diagnoses.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Clinical record saved by the backend.')).toBeTruthy()
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
    expect(diagnoses.getByText('entered in error')).toBeTruthy()
    expect(diagnoses.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
  })
})

describe('Consultation record: documents', () => {
  it('opens a clean document after the access re-check, in a new tab with no opener', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await openEncounter()
    const documents = within(card('Documents'))
    expect(documents.getByText('application/pdf · 20 KiB · scan: clean')).toBeTruthy()
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
    expect(documents.getByText('Upload not completed; only the person who started it can finish it. Upload the file again.')).toBeTruthy()
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
    expect(documents.getByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(upload)
    expect(await documents.findByText('Document uploaded. It can be opened once its virus scan is clean.')).toBeTruthy()
    expect(api.uploadDocument).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, file)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('shows the empty and failed states', async () => {
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    await openEncounter()
    expect(within(card('Documents')).getByText('No documents for this encounter.')).toBeTruthy()
  })

  it('shows a refused document list as an alert', async () => {
    api.documents.mockRejectedValue(new HidApiError(503, 'Documents are unavailable.', { code: 'UNAVAILABLE' }))
    await openEncounter()
    await act(async () => {})
    expect(within(card('Documents')).getByRole('alert').textContent).toBe('Documents are unavailable.')
  })
})
