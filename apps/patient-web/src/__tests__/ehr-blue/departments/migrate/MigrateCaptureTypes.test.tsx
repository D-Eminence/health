import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { forgetDocumentTypesServed, learnDocumentTypesServed } from '../../../../documentTypes'
import type * as DocumentTypesModule from '../../../../documentTypes'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'

/**
 * Patient documents on the blue Migrate page, with the document types (the owner's rule, 31 Oct; documentTypes.ts):
 * dormant until the EHR's document list answers `documentTypes: true`, then a "Document type" sent with the upload,
 * each listed document's type, the backend's refusal of a lab result on another host, and no upload on a host that
 * uploads nothing. The host is the one seam mocked (documentTypesHere); the host table itself is the real one.
 * Fictional data only: Patient One, HID-ZDEMAAA2, Demo Hospital, Demo Laboratory.
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
const host = vi.hoisted(() => ({ name: 'migrate.healthidentitydirectory.com' }))

vi.mock('../../../../documentTypes', async importOriginal => {
  const actual = await importOriginal<typeof DocumentTypesModule>()
  return { ...actual, documentTypesHere: () => actual.documentTypesOn(host.name) }
})
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
const LAB_DOCUMENT = 'd0000000-0000-4000-8000-000000000002'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'outpatient', status: 'in_progress',
  startedAt: '2026-10-12T09:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
// Today's document: no type (a clinical document).
const clean = { id: DOCUMENT, patientId: PATIENT, encounterId: ENCOUNTER, fileName: 'discharge-summary.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-12T09:30:00.000Z' }
const labResult = { ...clean, id: LAB_DOCUMENT, fileName: 'full-blood-count.jpg', mediaType: 'image/jpeg', documentType: 'lab_result' }
const sheet = { ...clean, id: 'd0000000-0000-4000-8000-000000000003', fileName: 'prescription.png', mediaType: 'image/png',
  documentType: 'prescription_sheet', scanStatus: 'pending' }
// A type a later contract might add: not named.
const unknown = { ...clean, id: 'd0000000-0000-4000-8000-000000000004', fileName: 'imaging.pdf', documentType: 'imaging_report' }
const allowed = { authorization: { decision: 'allow' }, patient: { patientId: PATIENT, fullName: 'Patient One' } }
const OCR = ['ocr.job.read', 'ocr.job.write']
const DOCUMENTS = ['ehr.document.read', 'ehr.document.write']
const FILE_LIMITS = '(PDF, JPEG, PNG or TIFF, max 50 MiB)'
const TODAY_HINT = 'Files are scanned for viruses before they can be opened or sent to OCR.'
const NO_UPLOAD_HERE = 'Documents can be uploaded only in the EHR, Lab, Pharmacy or Migrate.'

/** The document list's answer: with `documentTypes: true` once the backend serves the types. */
function listed(items: object[], documentTypes?: unknown) {
  return { items, nextCursor: null, ...(documentTypes === undefined ? {} : { documentTypes }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetDocumentTypesServed()
  host.name = 'migrate.healthidentitydirectory.com'
  session.setActivePatient.mockReset()
  session.permissions = [...OCR, ...DOCUMENTS]
  session.activePatient = { hid: 'HID-ZDEMAAA2', purpose: 'direct-care', lookup: { patient: { patientId: PATIENT, fullName: 'Patient One' } } }
  api.lookupPatient.mockResolvedValue(allowed)
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [encounter], nextCursor: null })
  api.documents.mockResolvedValue(listed([clean, labResult, sheet, unknown], true))
  api.uploadDocument.mockResolvedValue(DOCUMENT)
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const card = () => screen.getByRole('heading', { name: 'Patient documents' }).closest('section') as HTMLElement
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const typeField = () => within(card()).queryByLabelText('Document type') as HTMLSelectElement | null
const fileField = () => within(card()).getByLabelText(new RegExp(`^(File|Clinical document|Lab result|Prescription sheet) \\(`)) as HTMLInputElement
const descriptions = (control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)

async function openDocuments() {
  renderDept(<Migrate />)
  await screen.findByText('discharge-summary.pdf')
}

function image(name = 'full-blood-count.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])], name, { type })
}

describe('Patient documents with types: before the backend serves them', () => {
  it('is exactly today\'s card while the list says nothing of the types: no type asked, sent or shown', async () => {
    api.documents.mockResolvedValue(listed([clean, labResult, sheet]))
    await openDocuments()
    expect(typeField()).toBeNull()
    const field = within(card()).getByLabelText(`Clinical document ${FILE_LIMITS} *`)
    expect(field.id).toBe('migrate-document-file')
    expect(descriptions(field)).toEqual([TODAY_HINT])
    // No type named on any listed document, whatever it carries.
    expect(within(row('discharge-summary.pdf')).getByText('application/pdf · 20 KiB')).toBeTruthy()
    expect(within(row('full-blood-count.jpg')).getByText('image/jpeg · 20 KiB')).toBeTruthy()
    expect(within(card()).queryByText(/Lab result|Prescription sheet/)).toBeNull()
    const file = image()
    fireEvent.change(field, { target: { files: [file] } })
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(within(card()).getByText('Document uploaded. It can be opened once its virus scan is clean.')).toBeTruthy())
    // Today's four arguments, and no fifth: the backend never sees a type.
    expect(api.uploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadDocument.mock.calls[0]).toEqual([DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER, file])
    expect(api.uploadDocument.mock.calls[0]).toHaveLength(4)
    expect(api.uploadDocument.mock.calls[0]![3]).toBe(file)
  })

  it('keeps today\'s reference line byte for byte, whatever a listed document carries', async () => {
    const bare = { ...labResult, id: 'd0000000-0000-4000-8000-000000000005', fileName: 'scan.tif', mediaType: '' }
    api.documents.mockResolvedValue(listed([clean, bare]))
    await openDocuments()
    const reference = (name: string) => row(name).querySelector('.hid-ehr-dept-reference')?.textContent
    expect(reference('discharge-summary.pdf')).toBe('application/pdf · 20 KiB')
    // Today's template, even for a media type left empty: nothing filtered out, no type named.
    expect(reference('scan.tif')).toBe(' · 20 KiB')
  })

  it('asks no type while nothing has said the types are served (the list not yet answered)', async () => {
    api.documents.mockReturnValue(new Promise(() => {}))
    renderDept(<Migrate />)
    await waitFor(() => expect(api.documents).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER))
    await screen.findByRole('button', { name: 'Upload document' })
    expect(typeField()).toBeNull()
    expect(descriptions(within(card()).getByLabelText(`Clinical document ${FILE_LIMITS} *`))).toEqual([TODAY_HINT])
  })

  it('takes only an answer whose documentTypes is exactly true as served', async () => {
    api.documents.mockResolvedValue(listed([clean, labResult], 'true'))
    await openDocuments()
    expect(typeField()).toBeNull()
    expect(within(row('full-blood-count.jpg')).getByText('image/jpeg · 20 KiB')).toBeTruthy()
    expect(within(card()).getByLabelText(`Clinical document ${FILE_LIMITS} *`)).toBeTruthy()
  })

  it('keeps today\'s upload on a host that uploads nothing, with no type and no notice', async () => {
    api.documents.mockResolvedValue(listed([clean]))
    host.name = 'outreach.healthidentitydirectory.com'
    await openDocuments()
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeTruthy()
    expect(typeField()).toBeNull()
    expect(within(card()).queryByText(NO_UPLOAD_HERE)).toBeNull()
    // Reading and opening stay as they are.
    expect(within(row('discharge-summary.pdf')).getByRole('button', { name: 'Open file' })).toBeTruthy()
    expect(within(row('discharge-summary.pdf')).getByRole('button', { name: 'Extract with OCR' })).toBeTruthy()
  })
})

describe('Patient documents with types: once served', () => {
  it('asks for the document type, the clinical document first, among the three Migrate may upload', async () => {
    await openDocuments()
    const select = typeField()!
    expect(select).toBeTruthy()
    expect(select.id).toBe('migrate-document-type')
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['clinical_document', 'Clinical document'], ['lab_result', 'Lab result'], ['prescription_sheet', 'Prescription sheet'],
    ])
    expect(select.value).toBe('clinical_document')
    const field = within(card()).getByLabelText(`File ${FILE_LIMITS} *`)
    expect(descriptions(field)).toEqual(['Files are stored exactly as uploaded and scanned for viruses before they can be opened or sent to OCR.'])
  })

  it('names each listed document\'s type: none given is a clinical document, one not known is not named', async () => {
    await openDocuments()
    expect(api.documents).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER)
    expect(within(row('discharge-summary.pdf')).getByText('Clinical document · application/pdf · 20 KiB')).toBeTruthy()
    expect(within(row('full-blood-count.jpg')).getByText('Lab result · image/jpeg · 20 KiB')).toBeTruthy()
    expect(within(row('prescription.png')).getByText('Prescription sheet · image/png · 20 KiB')).toBeTruthy()
    expect(within(row('imaging.pdf')).getByText('application/pdf · 20 KiB')).toBeTruthy()
  })

  it('sends a lab result with its type, the very file chosen, and says OCR reads it once its scan is clean', async () => {
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    expect(typeField()!.value).toBe('lab_result')
    const field = fileField()
    expect(descriptions(field)).toEqual(['Files are stored exactly as uploaded and scanned for viruses before they can be opened. A lab result is read by OCR automatically once its scan is clean.'])
    const file = image()
    fireEvent.change(field, { target: { files: [file] } })
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(within(card()).getByText('Lab result uploaded. It can be opened once its virus scan is clean, and OCR then reads it automatically.')).toBeTruthy())
    expect(api.uploadDocument).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER, file, 'lab_result')
    // Stored exactly as uploaded: the page hands over the File itself, not a copy or a re-encoding.
    expect(api.uploadDocument.mock.calls[0]![3]).toBe(file)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.uploadDocument.mock.invocationCallOrder[0]!)
    // The list is read again, and the form starts over at the default type.
    expect(api.documents).toHaveBeenCalledTimes(2)
    expect(typeField()!.value).toBe('clinical_document')
  })

  it('sends the default type when none other is chosen, and a prescription sheet as one', async () => {
    await openDocuments()
    const first = new File(['%PDF-1.7'], 'referral.pdf', { type: 'application/pdf' })
    fireEvent.change(fileField(), { target: { files: [first] } })
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(within(card()).getByText('Document uploaded. It can be opened once its virus scan is clean.')).toBeTruthy())
    expect(api.uploadDocument).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER, first, 'clinical_document')
    fireEvent.change(typeField()!, { target: { value: 'prescription_sheet' } })
    const second = image('prescription.png', 'image/png')
    fireEvent.change(fileField(), { target: { files: [second] } })
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(within(card()).getByText('Prescription sheet uploaded. It can be opened once its virus scan is clean.')).toBeTruthy())
    expect(api.uploadDocument).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, PATIENT, ENCOUNTER, second, 'prescription_sheet')
  })

  /** An upload left running until `refuse` is called with the backend's refusal. */
  function uploadRefusedLater() {
    let refuse: (reason: unknown) => void = () => {}
    api.uploadDocument.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
    return (reason: unknown) => refuse(reason)
  }

  it('says the backend\'s refusal of a lab result on this host, and gives lost focus back to Upload document', async () => {
    host.name = 'app.staging.healthidentitydirectory.com'
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    fireEvent.change(fileField(), { target: { files: [image()] } })
    const refuse = uploadRefusedLater()
    const submit = screen.getByRole('button', { name: 'Upload document' })
    await press(submit)
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1))
    // Focus is lost while the upload runs (on the page itself); the refusal gives it back to the button.
    act(() => { submit.blur() })
    expect(document.activeElement).toBe(document.body)
    await act(async () => { refuse(new HidApiError(403, 'Forbidden', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' })) })
    expect((await within(card()).findByRole('alert')).textContent).toBe('Lab results can be uploaded only in the EHR, Lab or Migrate.')
    await waitFor(() => expect(document.activeElement).toBe(submit))
    // The type chosen is kept, so the person sees what was refused.
    expect(typeField()!.value).toBe('lab_result')
  })

  it('says any other refusal in the backend\'s words, as today, and leaves focus where the person went meanwhile', async () => {
    await openDocuments()
    fireEvent.change(fileField(), { target: { files: [image()] } })
    const refuse = uploadRefusedLater()
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1))
    act(() => { typeField()!.focus() })
    await act(async () => { refuse(new HidApiError(413, 'The file is too large', { code: 'DOCUMENT_TOO_LARGE' })) })
    expect((await within(card()).findByRole('alert')).textContent).toBe('The file is too large')
    expect(document.activeElement).toBe(typeField())
  })

  it('still refuses no file at the field, sending nothing', async () => {
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    const field = fileField()
    await press(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(descriptions(field)[0]).toBe('Choose a file first.')
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('on Pharmacy offers a clinical document or a prescription sheet, never a lab result', async () => {
    host.name = 'pharmacy.healthidentitydirectory.com'
    await openDocuments()
    expect([...typeField()!.options].map(option => option.textContent)).toEqual(['Clinical document', 'Prescription sheet'])
  })

  it('on Lab and the EHR, production and staging, offers all three', async () => {
    for (const name of ['lab.healthidentitydirectory.com', 'ehr.staging.healthidentitydirectory.com']) {
      host.name = name
      const { unmount } = renderDept(<Migrate />)
      await screen.findByText('discharge-summary.pdf')
      expect([...typeField()!.options].map(option => option.value)).toEqual(['clinical_document', 'lab_result', 'prescription_sheet'])
      unmount()
    }
  })

  it('on outreach and the admin site offers no upload, and says where documents are uploaded', async () => {
    for (const name of ['outreach.staging.healthidentitydirectory.com', 'admin.healthidentitydirectory.com']) {
      host.name = name
      const { unmount } = renderDept(<Migrate />)
      await screen.findByText('discharge-summary.pdf')
      expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
      expect(typeField()).toBeNull()
      expect(within(card()).getByText(NO_UPLOAD_HERE)).toBeTruthy()
      // The list still names each type.
      expect(within(row('full-blood-count.jpg')).getByText('Lab result · image/jpeg · 20 KiB')).toBeTruthy()
      unmount()
    }
  })

  it('stays served once learned, even when a later answer says nothing of the types', async () => {
    learnDocumentTypesServed(true)
    api.documents.mockResolvedValue(listed([clean]))
    await openDocuments()
    expect(typeField()).toBeTruthy()
    expect(within(row('discharge-summary.pdf')).getByText('Clinical document · application/pdf · 20 KiB')).toBeTruthy()
  })

  it('offers no type to a membership without document write, nor under read-only access', async () => {
    session.permissions = [...OCR, 'ehr.document.read']
    const { unmount } = renderDept(<Migrate />)
    await screen.findByText('discharge-summary.pdf')
    expect(typeField()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
    expect(within(card()).queryByText(NO_UPLOAD_HERE)).toBeNull()
    unmount()
    session.permissions = [...OCR, ...DOCUMENTS]
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    await openDocuments()
    expect(typeField()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull()
  })

  it('hands a clean lab result to OCR by its document and patient, as any document', async () => {
    await openDocuments()
    await press(within(row('full-blood-count.jpg')).getByRole('button', { name: 'Extract with OCR' }))
    expect(screen.getByRole('heading', { level: 1, name: 'New document job' })).toBeTruthy()
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(LAB_DOCUMENT)
    expect((screen.getByLabelText(/^Patient ID/) as HTMLInputElement).value).toBe(PATIENT)
  })
})
