import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { DOCUMENT_TYPE_NOT_ALLOWED_HERE_MESSAGE, documentTypesServed, forgetDocumentTypesServed } from '../../../documentTypes'
import type * as DocumentTypes from '../../../documentTypes'

/**
 * The document types on the classic Clinical record › Documents (the owner's rule, 31 Oct). The website ships before
 * the backend and stays dormant until the document list answers `documentTypes: true`: until then the page is exactly
 * today's, and an upload names no type. Once served, the upload card offers "Document type" (the types this host may
 * upload, "Clinical document" first and chosen) and sends the chosen one; the list names each document's type before
 * its media type. Once served, a host that may upload nothing (outreach. and the admin site) gets no upload card.
 *
 * Hostnames here are only strings handed to documentTypesOn: nothing is sent to them.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn() }))
const host = vi.hoisted(() => ({ name: 'localhost' }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'production', apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Staff One', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'Demo Laboratory', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.document.read', 'ehr.document.write'],
    } } } },
    activePatient: { hid: 'HID-ZDEMAAA2', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))
// The one seam that reads the page's host: the real host table, for the host each test names.
vi.mock('../../../documentTypes', async importOriginal => {
  const actual = await importOriginal<typeof DocumentTypes>()
  return { ...actual, documentTypesHere: () => actual.documentTypesOn(host.name) }
})

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2', fullName: 'Patient One', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
// As EHR's list sends it today: no type, size and version as text.
const listed = { id: 'document-1', patientId: PATIENT, encounterId: ENCOUNTER, fileName: 'referral.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', version: '1', createdAt: '2026-10-10T09:05:00.000Z' }
const labResult = { ...listed, id: 'document-2', fileName: 'haemoglobin.jpg', mediaType: 'image/jpeg', documentType: 'lab_result' }
const sheet = { ...listed, id: 'document-3', fileName: 'sheet.png', mediaType: 'image/png', documentType: 'prescription_sheet' }
const later = { ...listed, id: 'document-4', fileName: 'later.pdf', documentType: 'discharge_letter' }

const TODAY_CARD = 'Upload a documentFiles are scanned before download becomes available.Clinical documentUpload document'
const UPLOADED = 'Document uploaded. It can be opened once its virus scan is clean.'
const ALL = ['Clinical document', 'Lab result', 'Prescription sheet']

/**
 * jsdom builds a form's FormData from the file input's own file list, which a test cannot fill; fireEvent sets the
 * input's `files` property instead. This FormData adds what that property holds, as a browser's would.
 */
class ChosenFilesFormData extends FormData {
  constructor(form?: HTMLFormElement) {
    super(form)
    for (const input of form?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? []) {
      const chosen = input.files?.[0]
      if (chosen && input.name) this.set(input.name, chosen)
    }
  }
}

function served(items: readonly object[] = [listed]) { return { items, nextCursor: null, documentTypes: true } }
function dormant(items: readonly object[] = [listed]) { return { items, nextCursor: null } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('FormData', ChosenFilesFormData)
  forgetDocumentTypesServed()
  host.name = 'localhost'
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.documents.mockResolvedValue(dormant())
  api.uploadDocument.mockResolvedValue('document-9')
})
afterEach(() => {
  vi.unstubAllGlobals()
  forgetDocumentTypesServed()
})

/** Opens the Documents tab once write access is known (Start encounter shows it) and the list has answered. */
async function openDocuments(firstFile = 'referral.pdf') {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Start encounter' })
  fireEvent.click(await screen.findByRole('tab', { name: 'Documents' }))
  await screen.findByText(firstFile)
}

function uploadCard() {
  return screen.queryByRole('heading', { name: 'Upload a document' })?.closest<HTMLElement>('.staff-card') ?? null
}

function typeSelect() { return screen.queryByLabelText('Document type') as HTMLSelectElement | null }

function optionLabels(select: HTMLSelectElement) { return Array.from(select.options, option => option.textContent) }

function listedLine(fileName: string) {
  return screen.getByText(fileName).closest<HTMLElement>('.staff-list-item')!.querySelector('p')!.textContent
}

function choose(file: File) {
  fireEvent.change(within(uploadCard()!).getByLabelText(/^(Clinical document|File)$/), { target: { files: [file] } })
}

function pdf(name = 'scan.pdf') { return new File(['%PDF-1.7'], name, { type: 'application/pdf' }) }
function jpeg(name = 'haemoglobin.jpg') { return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], name, { type: 'image/jpeg' }) }

/**
 * Sends the upload form. The file input is `required`, and jsdom checks that against the file list it cannot be given,
 * so the form is submitted as a browser does once a file is chosen.
 */
function send() {
  fireEvent.submit(within(uploadCard()!).getByRole('button', { name: 'Upload document' }).closest('form')!)
}

async function submit() {
  send()
  await screen.findByText(UPLOADED)
}

describe('dormant: until the document list says the types are served', () => {
  it('shows exactly today’s upload card, with no type to choose', async () => {
    await openDocuments()
    expect(documentTypesServed()).toBe(false)
    const card = uploadCard()!
    expect(card.textContent).toBe(TODAY_CARD)
    expect(typeSelect()).toBeNull()
    expect(within(card).queryByRole('combobox')).toBeNull()
    const input = within(card).getByLabelText('Clinical document') as HTMLInputElement
    expect(input.id).toBe('clinical-document')
    expect(input.name).toBe('document')
    expect(input.accept).toBe('.pdf,.jpg,.jpeg,.png,.tif,.tiff')
  })

  it.each([
    'ehr.healthidentitydirectory.com',
    'lab.healthidentitydirectory.com',
    'pharmacy.healthidentitydirectory.com',
    'migrate.staging.healthidentitydirectory.com',
  ])('shows today’s card on %s too', async name => {
    host.name = name
    await openDocuments()
    expect(uploadCard()!.textContent).toBe(TODAY_CARD)
    expect(typeSelect()).toBeNull()
  })

  it('uploads exactly as today: the file and nothing naming a type', async () => {
    await openDocuments()
    const file = pdf()
    choose(file)
    await submit()
    expect(api.uploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadDocument.mock.calls[0]).toEqual(['facility-1', PATIENT, ENCOUNTER, file])
    expect(api.uploadDocument.mock.calls[0]).toHaveLength(4)
    expect(api.uploadDocument.mock.calls[0]![3]).toBe(file)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('names no type in the list, even for a document that carries one', async () => {
    api.documents.mockResolvedValue(dormant([listed, labResult]))
    await openDocuments()
    expect(listedLine('referral.pdf')).toBe('application/pdf · 20 KiB · scan: clean')
    expect(listedLine('haemoglobin.jpg')).toBe('image/jpeg · 20 KiB · scan: clean')
    expect(screen.queryByText(/Lab result/)).toBeNull()
  })

  it('stays dormant on an answer that does not say exactly `documentTypes: true`', async () => {
    api.documents.mockResolvedValue({ ...dormant(), documentTypes: 'true' })
    await openDocuments()
    expect(documentTypesServed()).toBe(false)
    expect(uploadCard()!.textContent).toBe(TODAY_CARD)
  })

  it('reads the list with today’s three arguments', async () => {
    await openDocuments()
    expect(api.documents).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER)
    expect(api.documents.mock.calls[0]).toHaveLength(3)
  })
})

describe('served on ehr.', () => {
  beforeEach(() => {
    host.name = 'ehr.healthidentitydirectory.com'
    api.documents.mockResolvedValue(served([listed, labResult, sheet, later]))
  })

  it('learns from the list that the types are served, and offers all three, Clinical document first and chosen', async () => {
    await openDocuments()
    expect(documentTypesServed()).toBe(true)
    const select = typeSelect()!
    expect(optionLabels(select)).toEqual(ALL)
    expect(Array.from(select.options, option => option.value)).toEqual(['clinical_document', 'lab_result', 'prescription_sheet'])
    expect(select.value).toBe('clinical_document')
    expect(within(uploadCard()!).getByLabelText('File')).toHaveProperty('id', 'clinical-document')
  })

  it('sends the chosen type with the file, unchanged', async () => {
    await openDocuments()
    const file = jpeg()
    choose(file)
    fireEvent.change(typeSelect()!, { target: { value: 'lab_result' } })
    await submit()
    expect(api.uploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadDocument.mock.calls[0]).toEqual(['facility-1', PATIENT, ENCOUNTER, file, 'lab_result'])
    expect(api.uploadDocument.mock.calls[0]![3]).toBe(file)
    // The form starts again from Clinical document.
    expect(typeSelect()!.value).toBe('clinical_document')
  })

  it('sends Clinical document when nothing else is chosen', async () => {
    await openDocuments()
    choose(pdf())
    await submit()
    expect(api.uploadDocument.mock.calls[0]![4]).toBe('clinical_document')
  })

  it('sends a prescription sheet', async () => {
    await openDocuments()
    choose(pdf('sheet.pdf'))
    fireEvent.change(typeSelect()!, { target: { value: 'prescription_sheet' } })
    await submit()
    expect(api.uploadDocument.mock.calls[0]![4]).toBe('prescription_sheet')
  })

  it('names each listed document’s type before its media type, and nothing for a type it does not know', async () => {
    await openDocuments()
    expect(listedLine('haemoglobin.jpg')).toBe('Lab result · image/jpeg · 20 KiB · scan: clean')
    expect(listedLine('sheet.png')).toBe('Prescription sheet · image/png · 20 KiB · scan: clean')
    // A document that carries no type is left as it is today; one of a type not named here says nothing of it.
    expect(listedLine('referral.pdf')).toBe('application/pdf · 20 KiB · scan: clean')
    expect(listedLine('later.pdf')).toBe('application/pdf · 20 KiB · scan: clean')
  })

  it('names Clinical document for a document that carries that type', async () => {
    api.documents.mockResolvedValue(served([{ ...listed, documentType: 'clinical_document' }]))
    await openDocuments()
    expect(listedLine('referral.pdf')).toBe('Clinical document · application/pdf · 20 KiB · scan: clean')
  })

  it('still refuses a missing or unsupported file at its field, before anything is sent', async () => {
    await openDocuments()
    send()
    expect(await screen.findByText('Select a file first.')).toBeTruthy()
    choose(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    send()
    expect(await screen.findByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })
})

describe('served on pharmacy.', () => {
  beforeEach(() => {
    host.name = 'pharmacy.healthidentitydirectory.com'
    api.documents.mockResolvedValue(served())
  })

  it('offers Clinical document and Prescription sheet, never Lab result', async () => {
    await openDocuments()
    const select = typeSelect()!
    expect(optionLabels(select)).toEqual(['Clinical document', 'Prescription sheet'])
    expect(select.value).toBe('clinical_document')
    expect(within(uploadCard()!).queryByText('Lab result')).toBeNull()
  })

  it('sends a prescription sheet', async () => {
    await openDocuments()
    const file = jpeg('sheet.jpg')
    choose(file)
    fireEvent.change(typeSelect()!, { target: { value: 'prescription_sheet' } })
    await submit()
    expect(api.uploadDocument.mock.calls[0]).toEqual(['facility-1', PATIENT, ENCOUNTER, file, 'prescription_sheet'])
  })

  it('on staging too', async () => {
    host.name = 'pharmacy.staging.healthidentitydirectory.com'
    await openDocuments()
    expect(optionLabels(typeSelect()!)).toEqual(['Clinical document', 'Prescription sheet'])
  })

  it('refuses a Lab result at its field and sends nothing, even when the form names one', async () => {
    await openDocuments()
    const select = typeSelect()!
    // A form that names a type this host does not offer (one kept from another page, or changed by hand).
    const stale = document.createElement('option')
    stale.value = 'lab_result'
    stale.textContent = 'Lab result'
    select.append(stale)
    choose(jpeg())
    fireEvent.change(select, { target: { value: 'lab_result' } })
    send()
    expect(await screen.findByText('Choose a document type.')).toBeTruthy()
    expect(api.uploadDocument).not.toHaveBeenCalled()
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(select.getAttribute('aria-describedby')).toContain('clinical-document-type-error')
    expect(document.activeElement).toBe(select)
  })
})

describe('served on the other facility hosts', () => {
  it.each([
    'lab.healthidentitydirectory.com',
    'migrate.healthidentitydirectory.com',
    'ehr.staging.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com',
    'localhost',
  ])('offers all three on %s', async name => {
    host.name = name
    api.documents.mockResolvedValue(served())
    await openDocuments()
    expect(optionLabels(typeSelect()!)).toEqual(ALL)
  })
})

describe('a host that uploads nothing', () => {
  const NONE = [
    'outreach.healthidentitydirectory.com',
    'outreach.staging.healthidentitydirectory.com',
    'admin.healthidentitydirectory.com',
    'admin.staging.healthidentitydirectory.com',
  ]

  it.each(NONE)('%s: today\'s upload card while dormant, and the list as today', async name => {
    host.name = name
    await openDocuments()
    expect(uploadCard()).not.toBeNull()
    expect(screen.getByLabelText('Clinical document')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeTruthy()
    expect(typeSelect()).toBeNull()
    expect(listedLine('referral.pdf')).toBe('application/pdf · 20 KiB · scan: clean')
    expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy()
  })

  it.each(NONE)('%s: no upload card once served either', async name => {
    host.name = name
    api.documents.mockResolvedValue(served())
    await openDocuments()
    expect(documentTypesServed()).toBe(true)
    expect(uploadCard()).toBeNull()
    expect(typeSelect()).toBeNull()
  })
})

describe('a type the backend refuses on this host', () => {
  it('says lab results can be uploaded only in the EHR, Lab or Migrate (403 DOCUMENT_TYPE_NOT_ALLOWED_HERE)', async () => {
    // The staging main site offers Lab result, as ehr. does; the backend refuses it there.
    host.name = 'staging.healthidentitydirectory.com'
    api.documents.mockResolvedValue(served())
    api.uploadDocument.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' }))
    await openDocuments()
    choose(jpeg())
    fireEvent.change(typeSelect()!, { target: { value: 'lab_result' } })
    send()
    expect((await screen.findByRole('alert')).textContent).toBe(DOCUMENT_TYPE_NOT_ALLOWED_HERE_MESSAGE)
    expect(DOCUMENT_TYPE_NOT_ALLOWED_HERE_MESSAGE).toBe('Lab results can be uploaded only in the EHR, Lab or Migrate.')
    expect(screen.queryByText(UPLOADED)).toBeNull()
    // The choice stays, so the file can be sent again as another type.
    expect(typeSelect()!.value).toBe('lab_result')
  })

  it('says any other refusal in its own words, as today', async () => {
    api.documents.mockResolvedValue(served())
    api.uploadDocument.mockRejectedValue(new HidApiError(403, 'Access denied', { code: 'FORBIDDEN' }))
    await openDocuments()
    choose(pdf())
    send()
    expect((await screen.findByRole('alert')).textContent).toBe('Access denied')
  })
})
