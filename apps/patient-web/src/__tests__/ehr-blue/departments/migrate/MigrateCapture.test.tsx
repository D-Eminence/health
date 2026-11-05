import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { SAID_UNAVAILABLE } from '../../../said'

/**
 * Patient documents on the blue Migrate page: a document captured into the patient's documents on an encounter, as
 * today's clinical record takes it (staff/routes/Clinical.tsx Documents), then handed to OCR on the same page.
 * Fictional data only: Patient One, HID-ZDEMAAA2, Demo Hospital.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), documents: vi.fn(), uploadDocument: vi.fn(), documentDownload: vi.fn(),
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), createOcrJob: vi.fn(),
}))
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const session = vi.hoisted(() => ({
  permissions: [] as string[],
  activePatient: null as null | { hid: string; purpose: 'direct-care' | 'emergency'; lookup: { patient: { patientId: string; fullName: string } } },
  setActivePatient: vi.fn(),
}))

vi.mock('../../../../staff/api', () => ({
  staffApi: api,
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
}))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => ({ ...staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital' })),
      activePatient: session.activePatient, setActivePatient: session.setActivePatient }),
  }
})
vi.mock('../../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'outpatient', status: 'in_progress',
  startedAt: '2026-10-12T09:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
const secondEncounter = { ...encounter, id: 'e0000000-0000-4000-8000-000000000002', encounterType: 'emergency_department' }
const clean = { id: DOCUMENT, patientId: PATIENT, encounterId: ENCOUNTER, fileName: 'discharge-summary.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-12T09:30:00.000Z' }
const pending = { ...clean, id: 'd0000000-0000-4000-8000-000000000002', fileName: 'lab-report.png', mediaType: 'image/png', scanStatus: 'pending' }
const initiated = { ...clean, id: 'd0000000-0000-4000-8000-000000000003', fileName: 'referral.pdf', status: 'initiated', scanStatus: 'pending' }
const allowed = { authorization: { decision: 'allow' }, patient: { patientId: PATIENT, fullName: 'Patient One' } }
const OCR = ['ocr.job.read', 'ocr.job.write']
const DOCUMENTS = ['ehr.document.read', 'ehr.document.write']

beforeEach(() => {
  vi.clearAllMocks()
  session.setActivePatient.mockReset()
  session.permissions = [...OCR, ...DOCUMENTS]
  session.activePatient = { hid: 'HID-ZDEMAAA2', purpose: 'direct-care', lookup: { patient: { patientId: PATIENT, fullName: 'Patient One' } } }
  api.lookupPatient.mockResolvedValue(allowed)
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [encounter, secondEncounter], nextCursor: null })
  api.documents.mockResolvedValue({ items: [clean, pending, initiated], nextCursor: null })
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [] })
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const card = () => screen.getByRole('heading', { name: 'Patient documents' }).closest('section') as HTMLElement
const focused = () => document.activeElement
/** What describes a control, in order: a refused control's error first, then its hint. */
const descriptions = (control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)

const queuedJob = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 1,
  status: 'queued', attemptCount: 0, maxAttempts: 3, patientConfirmation: null }

/** Presses Extract with OCR on the clean discharge summary. */
async function extract() {
  await press(within(screen.getByText('discharge-summary.pdf').closest('tr') as HTMLElement).getByRole('button', { name: 'Extract with OCR' }))
}

async function openDocuments() {
  const view = renderDept(<Migrate />)
  await screen.findByText('discharge-summary.pdf')
  return view
}

function pdf(name = 'scan.pdf', type = 'application/pdf', body = '%PDF-1.7') {
  return new File([body], name, { type })
}

describe('Patient documents: who sees them', () => {
  it('is not offered to a membership that does not read documents', () => {
    session.permissions = OCR
    renderDept(<Migrate />)
    expect(screen.queryByRole('heading', { name: 'Patient documents' })).toBeNull()
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('asks for a patient to be opened when none is', () => {
    session.activePatient = null
    renderDept(<Migrate />)
    expect(within(card()).getByText('No patient open')).toBeTruthy()
    expect(within(card()).getByText('Open a patient through an approved request or patient PIN to capture their documents here.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('captures nothing under emergency access, which is read-only', () => {
    session.activePatient = { ...session.activePatient!, purpose: 'emergency' }
    renderDept(<Migrate />)
    expect(within(card()).getByText('Emergency access is read-only, so documents cannot be captured for this patient.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })
})

describe('Patient documents: an encounter\'s documents', () => {
  it('checks access, then lists the newest encounter\'s documents with their scan status', async () => {
    await openDocuments()
    expect(api.lookupPatient).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, 'HID-ZDEMAAA2', 'direct-care')
    expect(api.consentStatus).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT)
    expect(api.encounters).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, { cursor: undefined, fresh: false })
    expect(api.documents).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER)
    expect(within(card()).getByText('Patient One · HID-ZDEMAAA2')).toBeTruthy()
    expect((within(card()).getByLabelText('Encounter') as HTMLSelectElement).value).toBe(ENCOUNTER)
    // The visit in plain words: its kind and where it is, never the raw class or status (owner, 2 November).
    expect([...(within(card()).getByLabelText('Encounter') as HTMLSelectElement).options].map(option => option.textContent))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^Outpatient visit · started .+ · In progress$/)]))
    expect(card().textContent).not.toMatch(/KiB|application\/|image\/|scan clean|in progress/)
    const cleanRow = screen.getByText('discharge-summary.pdf').closest('tr') as HTMLElement
    expect(within(cleanRow).getByText('Checked')).toBeTruthy()
    expect(within(cleanRow).getByText('PDF document · 20 KB')).toBeTruthy()
    expect((within(cleanRow).getByRole('button', { name: 'Open file' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(cleanRow).getByRole('button', { name: 'Extract with OCR' })).toBeTruthy()
    const pendingRow = screen.getByText('lab-report.png').closest('tr') as HTMLElement
    expect(within(pendingRow).getByText('Being checked for viruses')).toBeTruthy()
    expect(within(pendingRow).getByText(/^PNG image · /)).toBeTruthy()
    expect((within(pendingRow).getByRole('button', { name: 'Open file' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(pendingRow).queryByRole('button', { name: 'Extract with OCR' })).toBeNull()
    const initiatedRow = screen.getByText('referral.pdf').closest('tr') as HTMLElement
    expect(within(initiatedRow).getByText('not completed')).toBeTruthy()
    expect(within(initiatedRow).getByText('Upload not completed. Only the person who started it can finish it: upload the file again.')).toBeTruthy()
  })

  it('reads another encounter\'s documents when it is chosen', async () => {
    await openDocuments()
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    fireEvent.change(within(card()).getByLabelText('Encounter'), { target: { value: secondEncounter.id } })
    expect(await within(card()).findByText('No documents yet')).toBeTruthy()
    expect(api.documents).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, PATIENT, secondEncounter.id)
  })

  it('pages through encounters with the cursor EHR gave', async () => {
    api.encounters.mockResolvedValueOnce({ items: [encounter], nextCursor: 'cursor-demo-2' })
    await openDocuments()
    api.encounters.mockResolvedValueOnce({ items: [secondEncounter], nextCursor: null })
    await press(within(card()).getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(within(card()).getByText('Page 2')).toBeTruthy())
    expect(api.encounters).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, PATIENT, { cursor: 'cursor-demo-2', fresh: false })
    expect(within(card()).getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('lists only encounters of the patient open at the working facility', async () => {
    api.encounters.mockResolvedValue({ items: [
      { ...encounter, id: 'e0000000-0000-4000-8000-0000000000a1', patientId: 'a0000000-0000-4000-8000-0000000000ff', encounterType: 'inpatient' },
      { ...encounter, id: 'e0000000-0000-4000-8000-0000000000a2', facilityId: '98d00002-0000-4000-8000-000000000002', encounterType: 'maternity' },
      secondEncounter,
    ], nextCursor: null })
    renderDept(<Migrate />)
    await waitFor(() => expect(api.documents).toHaveBeenCalled())
    const select = within(card()).getByLabelText('Encounter') as HTMLSelectElement
    expect([...select.options].map(option => option.value)).toEqual([secondEncounter.id])
    expect(api.documents).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, secondEncounter.id)
    expect(api.documents).toHaveBeenCalledTimes(1)
  })

  it('says there is no encounter when none listed is the open patient\'s here', async () => {
    api.encounters.mockResolvedValue({ items: [{ ...encounter, facilityId: '98d00002-0000-4000-8000-000000000002' }], nextCursor: null })
    renderDept(<Migrate />)
    expect(await within(card()).findByText('No encounters yet')).toBeTruthy()
    expect(api.documents).not.toHaveBeenCalled()
  })

  it('says when the patient has no encounter to keep documents on', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    renderDept(<Migrate />)
    expect(await within(card()).findByText('No encounters yet')).toBeTruthy()
    expect(api.documents).not.toHaveBeenCalled()
  })

  it('says when encounters cannot be loaded', async () => {
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR service is unavailable', { code: 'EHR_SERVICE_UNAVAILABLE' }))
    renderDept(<Migrate />)
    expect((await within(card()).findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR service is unavailable')
  })

  it('closes the patient when access has ended, and says so', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Access denied', { code: 'PATIENT_ACCESS_DENIED' }))
    renderDept(<Migrate />)
    expect((await within(card()).findByRole('alert')).textContent).toBe('Access to this patient has ended. Open the patient again through approved access.')
    expect(session.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('still says access ended once the patient has closed', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(404, 'Patient not found', { code: 'PATIENT_NOT_FOUND' }))
    session.setActivePatient.mockImplementation(() => { session.activePatient = null })
    renderDept(<Migrate />)
    await waitFor(() => expect(within(card()).getByText('No patient open')).toBeTruthy())
    expect(within(card()).getByRole('alert').textContent).toBe('Access to this patient has ended. Open the patient again through approved access.')
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
  })

  it('closes the patient when the lookup answers for someone else', async () => {
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow' }, patient: { patientId: 'a0000000-0000-4000-8000-0000000000ff' } })
    renderDept(<Migrate />)
    expect((await within(card()).findByRole('alert')).textContent).toBe('Access to this patient has ended. Open the patient again through approved access.')
    expect(session.setActivePatient).toHaveBeenCalledWith(null)
  })
})

describe('Patient documents: capturing a document', () => {
  const HINT = 'Files are scanned for viruses before they can be opened or sent to OCR.'

  it('uploads a file into the chosen encounter, checks access first, and says it is being scanned', async () => {
    await openDocuments()
    const file = pdf()
    fireEvent.change(screen.getByLabelText(/^Clinical document/), { target: { files: [file] } })
    api.uploadDocument.mockResolvedValue(DOCUMENT)
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(within(card()).getByText('Document uploaded. It can be opened once its virus scan is clean.')).toBeTruthy())
    expect(api.uploadDocument).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER, file)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.uploadDocument.mock.invocationCallOrder[0]!)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('refuses no file, and a file of another type, at the field, sending nothing', async () => {
    await openDocuments()
    const field = screen.getByLabelText(/^Clinical document/)
    expect(field.id).toBe('migrate-document-file')
    expect(field.getAttribute('aria-invalid')).toBeNull()
    expect(descriptions(field)).toEqual([HINT])
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(focused()).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(field)[0]).toBe('Choose a file first.')
    fireEvent.change(field, { target: { files: [pdf('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')] } })
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(descriptions(field)[0]).toBe('Choose a PDF, JPEG, PNG or TIFF file of 50 MiB or less.'))
    expect(descriptions(field)).toEqual(['Choose a PDF, JPEG, PNG or TIFF file of 50 MiB or less.', HINT])
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('says a refused upload in the form, and gives focus back to Upload document', async () => {
    await openDocuments()
    fireEvent.change(screen.getByLabelText(/^Clinical document/), { target: { files: [pdf()] } })
    api.uploadDocument.mockRejectedValue(new HidApiError(413, 'The file is too large', { code: 'DOCUMENT_TOO_LARGE' }))
    const submit = screen.getByRole('button', { name: 'Upload document' })
    await press(submit)
    expect((await within(card()).findByRole('alert')).textContent).toBe('This file is too large. Choose a smaller file and try again.')
    expect(document.body.textContent).not.toContain('The file is too large')
    await waitFor(() => expect(focused()).toBe(submit))
  })

  it('offers no upload under read-only access, and says why', async () => {
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    await openDocuments()
    expect(within(card()).getByText('Read-only access. This authorization does not include changes. Ask the patient to approve a read-and-write request to add documents.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
  })

  it('offers no upload when write access cannot be confirmed', async () => {
    api.consentStatus.mockRejectedValue(new HidApiError(503, 'Identity is unavailable', { code: 'IDENTITY_UNAVAILABLE' }))
    await openDocuments()
    expect(await within(card()).findByText('Write access could not be confirmed, so uploads are unavailable. Refresh the page to try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
  })

  it('offers no upload to a membership without document write', async () => {
    session.permissions = [...OCR, 'ehr.document.read']
    await openDocuments()
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
  })
})

describe('Patient documents: opening and extracting', () => {
  it('opens a clean document from its signed storage link, in a tab of its own', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'https://storage.example.test/signed/discharge-summary.pdf', expiresInSeconds: 60 })
    await openDocuments()
    await press(within(screen.getByText('discharge-summary.pdf').closest('tr') as HTMLElement).getByRole('button', { name: 'Open file' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example.test/signed/discharge-summary.pdf', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
  })

  it('never opens a link that is not a signed storage link', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'javascript:alert(1)', expiresInSeconds: 60 })
    await openDocuments()
    await press(within(screen.getByText('discharge-summary.pdf').closest('tr') as HTMLElement).getByRole('button', { name: 'Open file' }))
    expect((await within(card()).findByRole('alert')).textContent).toBe('The document could not be opened.')
    expect(open).not.toHaveBeenCalled()
  })

  it('Extract with OCR sends the document for reading at once and opens it, with no form of IDs to fill in', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queuedJob)
    await extract()
    await screen.findByRole('heading', { name: 'Saved record' })
    await waitFor(() => expect(focused()).toBe(document.getElementById('migrate-view-title')))
    await waitFor(() => expect(document.getElementById('ocr-status')?.textContent).toBe('Reading the document. This page updates by itself when it’s ready.'))
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document ••••000001'])
    expect(screen.queryByRole('heading', { name: 'New document job' })).toBeNull()
    expect(screen.queryByLabelText(/^Patient ID/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
    expect(document.getElementById('ocr-status')?.textContent).toBe('Reading the document. This page updates by itself when it’s ready.')
    expect(screen.getAllByText('Waiting to be read').length).toBeGreaterThan(0)
    expect(screen.getByText('The document is being read. This page updates by itself every few seconds.')).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
    expect(api.createOcrJob).toHaveBeenCalledTimes(1)
    expect(api.createOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT, PATIENT)
    expect(api.findOcrJob.mock.invocationCallOrder[0]!).toBeLessThan(api.createOcrJob.mock.invocationCallOrder[0]!)
    expect(document.body.textContent).not.toMatch(/UUID/)
  })

  it('Extract with OCR on a document already sent for reading opens that reading and makes no other', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: { ...queuedJob, status: 'awaiting_validation', version: 3 } })
    await extract()
    await waitFor(() => expect(document.getElementById('ocr-status')?.textContent).toBe('This document was sent for reading before, so that reading is shown.'))
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
    expect(screen.getAllByText('Ready to check').length).toBeGreaterThan(0)
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('Extract with OCR sends nothing when the document cannot be checked first, and says so', async () => {
    await openDocuments()
    api.findOcrJob.mockRejectedValue(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await extract()
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(api.createOcrJob).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Patient documents' })).toBeTruthy()
    expect(document.getElementById('ocr-status')?.textContent).toBe('')
  })

  it('Extract with OCR stays on the list and says why when OCR refuses the document', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockRejectedValue(new HidApiError(409, 'The document is not virus scan clean', { code: 'OCR_DOCUMENT_NOT_READY' }))
    await extract()
    expect((await screen.findByRole('alert')).textContent).toBe('This document hasn’t finished its virus check yet. Try again once it has.')
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
  })

  it('Extract with OCR refused for want of the patient’s OK (403, or today’s 404) says what to do, plainly, on the list', async () => {
    const SENTENCE = 'To bring in this patient’s paper records, ask the patient to approve access or enter their Access PIN.'
    for (const refusal of [new HidApiError(403, 'Records processing consent is required', { code: 'OCR_RECORDS_PROCESSING_CONSENT_REQUIRED' }),
      new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })]) {
      const view = await openDocuments()
      api.findOcrJob.mockResolvedValue({ job: null })
      api.createOcrJob.mockRejectedValue(refusal)
      await extract()
      expect((await screen.findByRole('alert')).textContent).toBe(SENTENCE)
      expect(document.body.textContent).not.toContain('Records processing consent is required')
      expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
      view.unmount()
    }
  })

  it('Extract with OCR does not move the user off Create record when its answer comes later; the reading is listed', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: null })
    let answer!: (job: typeof queuedJob) => void
    api.createOcrJob.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await extract()
    await waitFor(() => expect(api.createOcrJob).toHaveBeenCalledTimes(1))
    await press(screen.getByRole('button', { name: 'Create record' }))
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['New document job'])
    await act(async () => { answer(queuedJob) })
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['New document job'])
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    expect(document.getElementById('ocr-status')?.textContent).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('button', { name: 'Document ••••000001' })).toBeTruthy()
  })

  it('Extract with OCR does not replace a record the user opened while it was still sending', async () => {
    const other = { ...queuedJob, id: 'j0000000-0000-4000-8000-000000000002', documentId: 'd0000000-0000-4000-8000-000000000009', status: 'awaiting_validation', version: 2 }
    await openDocuments()
    // A reading of another document, found first and then listed on this page.
    api.findOcrJob.mockResolvedValue({ job: other })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: other.documentId } })
    await press(screen.getByRole('button', { name: 'Find job' }))
    await screen.findByRole('heading', { name: 'Saved record' })
    await press(screen.getByRole('button', { name: 'Back to list' }))
    // Extract on the discharge summary: checked, then sent; the sending answers only after the other record is opened.
    api.findOcrJob.mockImplementation(async (_facility: string, documentId: string) => ({ job: documentId === other.documentId ? other : null }))
    let answer!: (job: typeof queuedJob) => void
    api.createOcrJob.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await extract()
    await waitFor(() => expect(api.createOcrJob).toHaveBeenCalledTimes(1))
    await press(screen.getByRole('button', { name: 'Document ••••000009' }))
    await screen.findByRole('heading', { name: 'Saved record' })
    await act(async () => { answer(queuedJob) })
    await waitFor(() => expect(api.findOcrJob).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, other.documentId))
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document ••••000009'])
    expect(screen.getAllByText('Ready to check').length).toBeGreaterThan(0)
    expect(document.getElementById('ocr-status')?.textContent).toBe('')
  })

  it('once the page stops checking a reading by itself, the notice no longer says it updates by itself', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queuedJob)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await extract()
      await waitFor(() => expect(document.getElementById('ocr-status')?.textContent).toBe('Reading the document. This page updates by itself when it’s ready.'))
      api.findOcrJob.mockResolvedValue({ job: queuedJob })
      for (let left = 185_000; left > 0; left -= 5_000) await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(screen.getByText('This is taking longer than usual. Use Refresh status to check again.')).toBeTruthy()
      expect(document.getElementById('ocr-status')?.textContent).toBe('')
    }
    finally { vi.useRealTimers() }
  })

  it('once a check of a reading fails, the notice no longer says the page updates by itself', async () => {
    await openDocuments()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queuedJob)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await extract()
      await waitFor(() => expect(document.getElementById('ocr-status')?.textContent).toBe('Reading the document. This page updates by itself when it’s ready.'))
      api.findOcrJob.mockRejectedValue(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      await waitFor(() => expect(screen.getByText('The document’s progress couldn’t be checked just now. Use Refresh status to try again.')).toBeTruthy())
      expect(document.getElementById('ocr-status')?.textContent).toBe('')
    }
    finally { vi.useRealTimers() }
  })

  it('going to a job and back keeps the encounter and page chosen, and reads nothing again', async () => {
    api.encounters.mockResolvedValueOnce({ items: [encounter, secondEncounter], nextCursor: 'cursor-demo-2' })
    await openDocuments()
    api.encounters.mockResolvedValueOnce({ items: [secondEncounter, { ...secondEncounter, id: 'e0000000-0000-4000-8000-000000000003' }], nextCursor: null })
    await press(within(card()).getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(within(card()).getByText('Page 2')).toBeTruthy())
    fireEvent.change(within(card()).getByLabelText('Encounter'), { target: { value: 'e0000000-0000-4000-8000-000000000003' } })
    await screen.findByText('discharge-summary.pdf')
    const reads = () => [api.lookupPatient, api.consentStatus, api.encounters, api.documents].map(fn => fn.mock.calls.length)
    const before = reads()
    api.findOcrJob.mockResolvedValue({ job: { ...queuedJob, status: 'awaiting_validation', version: 3 } })
    await extract()
    await screen.findByRole('heading', { name: 'Saved record' })
    expect(screen.queryByRole('heading', { name: 'Patient documents' })).toBeNull()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { name: 'Patient documents' })).toBeTruthy()
    expect((within(card()).getByLabelText('Encounter') as HTMLSelectElement).value).toBe('e0000000-0000-4000-8000-000000000003')
    expect(within(card()).getByText('Page 2')).toBeTruthy()
    expect(reads()).toEqual(before)
  })

  it('without OCR job write, Extract with OCR fills in Find document job and takes focus there', async () => {
    session.permissions = ['ocr.job.read', ...DOCUMENTS]
    await openDocuments()
    await press(within(screen.getByText('discharge-summary.pdf').closest('tr') as HTMLElement).getByRole('button', { name: 'Extract with OCR' }))
    const field = screen.getByLabelText(/^Document ID/) as HTMLInputElement
    await waitFor(() => expect(focused()).toBe(field))
    expect(field.value).toBe(DOCUMENT)
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })

  it('without OCR job write, Extract with OCR reads nothing by itself, however long the page stays open', async () => {
    session.permissions = ['ocr.job.read', ...DOCUMENTS]
    await openDocuments()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await extract()
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(api.findOcrJob).not.toHaveBeenCalled()
      expect(api.createOcrJob).not.toHaveBeenCalled()
    }
    finally { vi.useRealTimers() }
  })
})
