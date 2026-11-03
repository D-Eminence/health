import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDocumentTypesServed, learnDocumentTypesServed } from '../../../documentTypes'
import type * as DocumentTypesModule from '../../../documentTypes'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * Consultation > Documents with the document types (the owner's rule, 31 Oct; documentTypes.ts), as blue Migrate asks
 * them (#72): dormant until the EHR's document list answers `documentTypes: true`, then a "Document type" among this
 * host's types (ehr.: all three, the clinical document first) sent with the upload, each listed document's type, and
 * the backend's refusal of a lab result in documentTypes.ts's words. The host is the one seam mocked
 * (documentTypesHere); the host table itself is the real one. Fictional data only: Patient One, HID-ZDEMAAA2.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))
const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))

vi.mock('../../../documentTypes', async importOriginal => {
  const actual = await importOriginal<typeof DocumentTypesModule>()
  return { ...actual, documentTypesHere: () => actual.documentTypesOn(host.name) }
})
vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Orders part</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ALL = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read', 'ehr.document.write']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
// Today's document: no type (a clinical document).
const LETTER = {
  id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z',
}
const LAB = { ...LETTER, id: 'doc-2', fileName: 'full-blood-count.jpg', mediaType: 'image/jpeg', documentType: 'lab_result' }
const SHEET = { ...LETTER, id: 'doc-3', fileName: 'prescription.png', mediaType: 'image/png', documentType: 'prescription_sheet', scanStatus: 'pending' }
// A type a later contract might add: not named.
const LATER = { ...LETTER, id: 'doc-4', fileName: 'imaging.pdf', documentType: 'imaging_report' }
const UPLOADED = 'Uploaded. It can be opened once the virus check is done.'
const LAB_REFUSED = 'Lab results can be uploaded only in the EHR, Lab or Migrate.'
const NO_UPLOAD_HERE = 'Documents can be uploaded only in the EHR, Lab, Pharmacy or Migrate.'

/** The document list's answer: with `documentTypes` only when given. */
function listed(items: object[], documentTypes?: unknown) {
  return { items, nextCursor: null, ...(documentTypes === undefined ? {} : { documentTypes }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetDocumentTypesServed()
  host.name = 'ehr.healthidentitydirectory.com'
  staff.facilityId = undefined
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue(listed([LETTER, LAB, SHEET, LATER], true))
  api.uploadDocument.mockResolvedValue('doc-9')
})

afterEach(() => { forgetDocumentTypesServed() })

const card = () => screen.getByRole('heading', { level: 2, name: 'Documents' }).closest('section') as HTMLElement
const typeField = () => within(card()).queryByLabelText('Document type') as HTMLSelectElement | null
const fileField = (label: string) => within(card()).getByLabelText(labelled(label)) as HTMLInputElement
const line = (fileName: string) => (within(card()).getByText(fileName).closest('li') as HTMLElement).querySelector('.hid-ehr-clinical-cell-sub')?.textContent
const uploadForm = () => within(card()).getByRole('button', { name: 'Upload document' }).closest('form') as HTMLFormElement

async function openDocuments() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  await within(card()).findByText('referral-letter.pdf')
}

function pdf(name = 'demo-referral.pdf') {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' })
}

async function upload(file: File, label: string) {
  fireEvent.change(fileField(label), { target: { files: [file] } })
  await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Upload document' })) })
}

describe('Consultation documents with types: before the backend serves them', () => {
  it('is exactly today’s card while the list says nothing of the types: no type asked, sent or shown', async () => {
    api.documents.mockResolvedValue(listed([LETTER, LAB, SHEET]))
    await openDocuments()
    expect(typeField()).toBeNull()
    // Today's form: the file field labelled "Clinical document", and nothing else to fill in.
    expect([...uploadForm().elements].map(element => `${element.tagName}:${element.getAttribute('name') ?? ''}`)).toEqual(['INPUT:document', 'BUTTON:'])
    expect(fileField('Clinical document').closest('.hid-ehr-field')?.querySelector('label')?.textContent).toBe('Clinical document *')
    // Today's line under each file, whatever a listed document carries.
    expect(line('referral-letter.pdf')).toBe('PDF document · 20 KB · Checked')
    expect(line('full-blood-count.jpg')).toBe('JPEG image · 20 KB · Checked')
    expect(line('prescription.png')).toBe('PNG image · 20 KB · Being checked for viruses')
    expect(within(card()).queryByText(/Lab result|Prescription sheet/)).toBeNull()
    const file = pdf()
    await upload(file, 'Clinical document')
    expect(await within(card()).findByText(UPLOADED)).toBeTruthy()
    // Today's four arguments, and no fifth: the request names no type (staff/documentsApi.test.ts: today's eight fields).
    expect(api.uploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadDocument.mock.calls[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, file])
    expect(api.uploadDocument.mock.calls[0]).toHaveLength(4)
  })

  it('asks no type while the list has not answered yet', async () => {
    api.documents.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await waitFor(() => expect(api.documents).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID))
    await within(card()).findByRole('button', { name: 'Upload document' })
    expect(typeField()).toBeNull()
    expect(fileField('Clinical document')).toBeTruthy()
  })

  it('takes only an answer whose documentTypes is exactly true as served', async () => {
    api.documents.mockResolvedValue(listed([LETTER, LAB], 'true'))
    await openDocuments()
    expect(typeField()).toBeNull()
    expect(line('full-blood-count.jpg')).toBe('JPEG image · 20 KB · Checked')
  })
})

describe('Consultation documents with types: once served', () => {
  it('learns it from this card’s own document list, and asks for the type among all three on ehr., the clinical document first', async () => {
    await openDocuments()
    const select = typeField()!
    expect(select).toBeTruthy()
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['clinical_document', 'Clinical document'], ['lab_result', 'Lab result'], ['prescription_sheet', 'Prescription sheet'],
    ])
    expect(select.value).toBe('clinical_document')
    expect(fileField('File')).toBeTruthy()
  })

  it('offers all three on the EHR, production and staging', async () => {
    for (const name of ['ehr.healthidentitydirectory.com', 'ehr.staging.healthidentitydirectory.com']) {
      host.name = name
      const { unmount } = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
      await within(await screen.findByRole('heading', { level: 2, name: 'Documents' }).then(heading => heading.closest('section') as HTMLElement)).findByText('referral-letter.pdf')
      expect([...typeField()!.options].map(option => option.value)).toEqual(['clinical_document', 'lab_result', 'prescription_sheet'])
      unmount()
    }
  })

  it('on a host that uploads nothing (outreach, the admin site) offers no upload and says where documents are uploaded', async () => {
    for (const name of ['outreach.healthidentitydirectory.com', 'admin.healthidentitydirectory.com']) {
      host.name = name
      const { unmount } = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
      await within(await screen.findByRole('heading', { level: 2, name: 'Documents' }).then(heading => heading.closest('section') as HTMLElement)).findByText('referral-letter.pdf')
      expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
      expect(typeField()).toBeNull()
      expect(within(card()).getByRole('status').textContent).toBe(NO_UPLOAD_HERE)
      // The list still names each type, and opening stays as it is.
      expect(line('full-blood-count.jpg')).toBe('Lab result · JPEG image · 20 KB · Checked')
      expect(within(card()).getByRole('button', { name: 'Open file referral-letter.pdf' })).toBeTruthy()
      unmount()
    }
  })

  it('keeps today’s upload, with no type and no notice, on a host that uploads nothing while not served', async () => {
    host.name = 'outreach.healthidentitydirectory.com'
    api.documents.mockResolvedValue(listed([LETTER]))
    await openDocuments()
    expect(within(card()).getByRole('button', { name: 'Upload document' })).toBeTruthy()
    expect(typeField()).toBeNull()
    expect(within(card()).queryByText(NO_UPLOAD_HERE)).toBeNull()
  })

  it('names each listed document’s type: none given is a clinical document, one not known is not named', async () => {
    await openDocuments()
    expect(line('referral-letter.pdf')).toBe('Clinical document · PDF document · 20 KB · Checked')
    expect(line('full-blood-count.jpg')).toBe('Lab result · JPEG image · 20 KB · Checked')
    expect(line('prescription.png')).toBe('Prescription sheet · PNG image · 20 KB · Being checked for viruses')
    expect(line('imaging.pdf')).toBe('PDF document · 20 KB · Checked')
  })

  it('sends the clinical document by default, then the type chosen, after the access re-check, and starts over at the default', async () => {
    await openDocuments()
    const first = pdf()
    await upload(first, 'File')
    expect(await within(card()).findByText(UPLOADED)).toBeTruthy()
    expect(api.uploadDocument).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, first, 'clinical_document')
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.uploadDocument.mock.invocationCallOrder[0]!)
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    expect(typeField()!.value).toBe('lab_result')
    const second = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'full-blood-count.jpg', { type: 'image/jpeg' })
    await upload(second, 'File')
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(2))
    expect(api.uploadDocument).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, second, 'lab_result')
    // The very File chosen, never a copy; the list read again; the form back at the default type.
    expect(api.uploadDocument.mock.calls[1]![3]).toBe(second)
    await waitFor(() => expect(typeField()!.value).toBe('clinical_document'))
    expect(api.documents).toHaveBeenCalledTimes(3)
  })

  it('says the backend’s refusal of a lab result here in documentTypes.ts’s words, keeping the type chosen', async () => {
    api.uploadDocument.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' }))
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    await upload(pdf(), 'File')
    expect((await within(card()).findByRole('alert')).textContent).toBe(LAB_REFUSED)
    expect(within(card()).queryByText('Forbidden')).toBeNull()
    expect(typeField()!.value).toBe('lab_result')
  })

  it('says any other refusal as the card says it without types, never as the lab-result refusal', async () => {
    // Another code, with no words of its own, while a lab result is chosen: the card's own sentence. It does not pin how
    // a server's words are shown, so it holds with today's handling and with the shared plain words alike.
    api.uploadDocument.mockRejectedValue(new HidApiError(400, '', { code: 'BAD_REQUEST' }))
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'lab_result' } })
    await upload(pdf(), 'File')
    expect((await within(card()).findByRole('alert')).textContent).toBe('Document could not be uploaded.')
    expect(within(card()).queryByText(LAB_REFUSED)).toBeNull()
  })

  it('still refuses no file at the field, sending nothing', async () => {
    await openDocuments()
    fireEvent.change(typeField()!, { target: { value: 'prescription_sheet' } })
    fireEvent.click(within(card()).getByRole('button', { name: 'Upload document' }))
    expect(within(card()).getByText('Select a file first.')).toBeTruthy()
    expect(document.activeElement).toBe(fileField('File'))
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('learns it from the list read again after an upload, too', async () => {
    api.documents.mockResolvedValueOnce(listed([LETTER])).mockResolvedValue(listed([LETTER], true))
    await openDocuments()
    expect(typeField()).toBeNull()
    await upload(pdf(), 'Clinical document')
    expect(await within(card()).findByText(UPLOADED)).toBeTruthy()
    // Sent as today, since nothing had said so yet; the list read again then says it.
    expect(api.uploadDocument.mock.calls[0]).toHaveLength(4)
    expect(api.documents).toHaveBeenCalledTimes(2)
    expect(await within(card()).findByLabelText('Document type')).toBeTruthy()
    expect(line('referral-letter.pdf')).toBe('Clinical document · PDF document · 20 KB · Checked')
  })

  it('stays served once learned, even when a later answer says nothing of the types', async () => {
    learnDocumentTypesServed(true)
    api.documents.mockResolvedValue(listed([LETTER]))
    await openDocuments()
    expect(typeField()).toBeTruthy()
    expect(line('referral-letter.pdf')).toBe('Clinical document · PDF document · 20 KB · Checked')
  })

  it('offers no type without document write, nor under a read-only grant', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read']
    const { unmount } = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await within(await screen.findByRole('heading', { level: 2, name: 'Documents' }).then(heading => heading.closest('section') as HTMLElement)).findByText('referral-letter.pdf')
    expect(typeField()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
    unmount()
    staff.permissions = [...ALL]
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openDocuments()
    expect(typeField()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
  })

  it('reads and uploads nothing under emergency access, served or not', () => {
    learnDocumentTypesServed(true)
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByLabelText('Document type')).toBeNull()
    expect(api.documents).not.toHaveBeenCalled()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('hands a clean lab result to today’s OCR page with exactly today’s router state, whatever its type', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    function OcrPage() {
      const location = useLocation()
      return <p data-testid="ocr-state">{JSON.stringify(location.state)}</p>
    }
    render(
      <MemoryRouter initialEntries={[`/provider/clinical/${ENCOUNTER_ID}`]}>
        <Routes>
          <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
          <Route path="/provider/ocr" element={<OcrPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const row = (await within(await screen.findByRole('heading', { level: 2, name: 'Documents' }).then(heading => heading.closest('section') as HTMLElement))
      .findByText('full-blood-count.jpg')).closest('li') as HTMLElement
    const link = within(row).getByRole('link', { name: 'Extract with OCR' })
    expect(link.getAttribute('href')).toBe('/provider/ocr')
    fireEvent.click(link)
    expect(JSON.parse((await screen.findByTestId('ocr-state')).textContent ?? 'null')).toEqual({
      ocrDocumentId: 'doc-2', ocrPatientId: PATIENT_ID, actorId: 'staff-1', facilityId: FACILITY_ID,
    })
  })
})
