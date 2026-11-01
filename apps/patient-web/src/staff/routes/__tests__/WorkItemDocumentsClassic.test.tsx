import { createHash } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentTypesServed, forgetDocumentTypesServed } from '../../../documentTypes'
import type * as DocumentTypesModule from '../../../documentTypes'
import { forgetCannotCompleteServed } from '../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { forgetReceiving } from '../../orderRoutes'
import { setStaffSessionReady } from '../../session'
import { Laboratory, Pharmacy } from '../Operations'

/**
 * The work item documents on the classic Laboratory and Pharmacy pages ("Use the classic EHR"): "Result documents" on a
 * Lab work item (a lab result: lab.document.read / lab.document.write, only on a host that may upload one) and
 * "Prescription sheets" on a Pharmacy work item (a prescription sheet: pharmacy.document.read / pharmacy.document.write),
 * the same rules as the blue card, behind the same switch: until a work list answers `documentTypes: true`, the pages are
 * exactly today's and send exactly today's requests.
 *
 * The real staff API runs, with only the network stubbed (the gateway and the storage bucket, on example.test), so what
 * is checked is what would be sent. The host is the one seam mocked (documentTypesHere); the host table is the real one,
 * and its hostnames are only strings handed to it: nothing is sent to them. Fictional data only: Patient One,
 * HID-ZDEMAAA2, Demo Laboratory, Demo Pharmacy.
 */
interface Sent { method: string; url: URL; body: unknown; headers: Headers }

const network = vi.hoisted(() => {
  const state = {
    labList: {} as Record<string, unknown>,
    pharmacyList: {} as Record<string, unknown>,
    documents: [] as unknown[],
    /** What upload-intents answers instead of an intent: a refusal's status and body. */
    refuse: null as { status: number; body: Record<string, unknown> } | null,
    download: 'https://storage.example.test/bucket/document-1?X-Amz-Signature=demo',
    sent: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  // In place before the staff API loads, which binds the transport's fetch then.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    state.sent.push({ method, url, body: init?.body, headers: new Headers(init?.headers) })
    if (url.origin === 'https://storage.example.test') return new Response(null, { status: 200 })
    if (url.origin !== 'https://gateway.example.test') return new Response(null, { status: 500 })
    if (method === 'GET' && url.pathname === '/api/v1/lab/work-items') return json(state.labList)
    if (method === 'GET' && url.pathname === '/api/v1/pharmacy/work-items') return json(state.pharmacyList)
    if (method === 'GET' && url.pathname === '/api/v1/lab/accessions/accession-1') {
      return json({ id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open', specimens: [] })
    }
    if (method === 'GET' && url.pathname === '/api/v1/ehr/documents') return json({ items: state.documents, nextCursor: null, documentTypes: true })
    if (method === 'GET' && url.pathname === '/api/v1/ehr/documents/document-1/download') return json({ url: state.download, expiresInSeconds: 300 })
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/upload-intents') {
      if (state.refuse) return json(state.refuse.body, state.refuse.status)
      const { mediaType } = JSON.parse(String(init?.body)) as { mediaType: string }
      return json({ document: { id: 'document-9' }, upload: { method: 'PUT', url: 'https://storage.example.test/bucket/document-9',
        requiredHeaders: { 'Content-Type': mediaType }, expiresInSeconds: 300 } })
    }
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/document-9/complete') return new Response(null, { status: 204 })
    return new Response(null, { status: 404 })
  })
  return state
})
const session = vi.hoisted(() => ({ facility: undefined as undefined | {
  id: string; membershipId: string; organizationId: string; name: string; roles: string[]; permissions: string[]; isPrimary: boolean
} }))
const host = vi.hoisted(() => ({ name: 'lab.healthidentitydirectory.com' }))

vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { kind: 'staff', id: 'staff-demo-1', displayName: 'Demo Scientist',
      roles: session.facility?.roles ?? [], permissions: session.facility?.permissions ?? [],
      facilities: session.facility ? [session.facility] : [], facility: session.facility } } },
    lock: null, activePatient: null, setActivePatient: () => true, refresh: async () => {}, checkSession: () => {},
  }),
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../../documentTypes', async importOriginal => {
  const actual = await importOriginal<typeof DocumentTypesModule>()
  return { ...actual, documentTypesHere: () => actual.documentTypesOn(host.name) }
})

const DEMO_LABORATORY_ID = '98d00002-0000-4000-8000-000000000002'
const DEMO_PHARMACY_ID = '98d00002-0000-4000-8000-000000000003'
const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const OTHER_PATIENT = 'a0000000-0000-4000-8000-0000007b1d3a'

const LAB_WORK = ['lab.work-item.read', 'lab.accession.read']
const LAB_DOCUMENTS = [...LAB_WORK, 'lab.document.read', 'lab.document.write']
const PHARMACY_WORK = ['pharmacy.work-item.read', 'pharmacy.dispensing.create']
const PHARMACY_DOCUMENTS = [...PHARMACY_WORK, 'pharmacy.document.read', 'pharmacy.document.write']

const LAB_ITEM = { id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z' }
const ACCESSIONED = { ...LAB_ITEM, id: 'work-item-2', testName: 'Blood glucose', accessionId: 'accession-1',
  accessionNumber: 'ACC-2026-000123' }
const PHARMACY_ITEM = { id: 'work-item-1', patientId: PATIENT, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
  medication: { display: 'Amoxicillin 500 mg capsule' }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily',
  dispensing: null }
const PHARMACY_ITEM_2 = { ...PHARMACY_ITEM, id: 'work-item-2', medication: { display: 'Metformin 850 mg tablet' }, doseUnit: 'tablet' }

const LAB_RESULT = { id: 'document-1', patientId: PATIENT, encounterId: null, labWorkItemId: 'work-item-1',
  fileName: 'full-blood-count.jpg', mediaType: 'image/jpeg', sizeBytes: '20480', status: 'available', scanStatus: 'clean',
  createdAt: '2026-10-09T09:30:00.000Z', documentType: 'lab_result' }
const PENDING = { ...LAB_RESULT, id: 'document-2', fileName: 'haemoglobin-report.pdf', mediaType: 'application/pdf',
  sizeBytes: 102400, scanStatus: 'pending' }
const SHEET = { id: 'document-1', patientId: PATIENT, encounterId: null, pharmacyWorkItemId: 'work-item-1',
  fileName: 'prescription-sheet.png', mediaType: 'image/png', sizeBytes: 4096, status: 'available', scanStatus: 'pending',
  createdAt: '2026-10-08T10:00:00.000Z', documentType: 'prescription_sheet' }

const LAB_HINT = 'PDF, JPEG, PNG or TIFF, up to 50 MiB. Images are kept exactly as uploaded, and Health ID reads a lab result by '
  + 'itself once its virus scan is clean.'
const LAB_ATTACHED = 'Result document attached. It can be opened once its virus scan is clean.'
const SHEET_ATTACHED = 'Prescription sheet attached. It can be opened once its virus scan is clean.'
const NOT_HERE = 'Lab results can be uploaded only in the EHR, Lab or Migrate.'

// A tiny JPEG and PNG: their bytes are what must reach storage, unchanged.
const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D])
const jpeg = () => new File([JPEG_BYTES], 'demo-lab-result.jpg', { type: 'image/jpeg' })
const png = () => new File([PNG_BYTES], 'demo-prescription-sheet.png', { type: 'image/png' })

const ORIGINS = ['https://gateway.example.test', 'https://storage.example.test']
const gateway = () => network.sent.filter(request => request.url.origin === 'https://gateway.example.test')
const named = (method: string, pathname: string) => network.sent.filter(request => request.method === method && request.url.pathname === pathname)
const documentReads = () => named('GET', '/api/v1/ehr/documents')

/** What a request is, every byte the page chose: method, address, headers (less the per-request ids the client makes), body. */
function wire(requests: readonly Sent[]) {
  return requests.map(request => ({
    method: request.method,
    url: request.url.href,
    headers: [...request.headers].filter(([name]) => !['x-request-id', 'x-correlation-id', 'idempotency-key'].includes(name)),
    body: request.body === undefined || request.body === null ? null : String(request.body),
  }))
}

function as(permissions: string[], kind: 'laboratory' | 'pharmacy' = 'laboratory') {
  session.facility = { id: kind === 'laboratory' ? DEMO_LABORATORY_ID : DEMO_PHARMACY_ID, membershipId: 'membership-demo-1',
    organizationId: 'organization-demo-1', name: kind === 'laboratory' ? 'Demo Laboratory' : 'Demo Pharmacy',
    roles: [kind === 'laboratory' ? 'lab_scientist' : 'pharmacist'], permissions, isPrimary: true }
}

function renderPage(page: 'lab' | 'pharmacy') {
  return render(<MemoryRouter>{page === 'lab' ? <Laboratory /> : <Pharmacy />}</MemoryRouter>)
}

/** Lets every read in flight answer. */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}

/** A work row, by the name of its test or medication. */
async function row(name: string) {
  return (await screen.findByText(name)).closest<HTMLElement>('.staff-list-item')!
}

function card(title: 'Result documents' | 'Prescription sheets') {
  return screen.getByRole('heading', { name: title }).closest<HTMLElement>('.staff-card')!
}

function choose(within_: HTMLElement, label: RegExp, file: File | null) {
  fireEvent.change(within(within_).getByLabelText(label), { target: { files: file ? [file] : [] } })
}

/**
 * Sends the attach form. The file input is `required`, and jsdom checks that against the file list it cannot be given,
 * so the form is submitted as a browser does once a file is chosen.
 */
function send(container: HTMLElement, name: string) {
  fireEvent.submit(within(container).getByRole('button', { name }).closest('form')!)
}

/** Opens a work item's documents once its row offers them: the row shows as soon as the list answers, the offer once learned. */
async function openLabDocuments(name = 'Haemoglobin') {
  fireEvent.click(await within(await row(name)).findByRole('button', { name: 'Result documents' }))
  return card('Result documents')
}

async function openSheets(name = 'Amoxicillin 500 mg capsule') {
  fireEvent.click(await within(await row(name)).findByRole('button', { name: 'Prescription sheets' }))
  return card('Prescription sheets')
}

function listedLine(container: HTMLElement, fileName: string) {
  return within(container).getByText(fileName).closest<HTMLElement>('.staff-list-item')!.querySelector('p')!.textContent
}

const open = vi.fn()

beforeEach(() => {
  network.sent.length = 0
  network.labList = { items: [LAB_ITEM] }
  network.pharmacyList = { items: [PHARMACY_ITEM] }
  network.documents = []
  network.refuse = null
  network.download = 'https://storage.example.test/bucket/document-1?X-Amz-Signature=demo'
  host.name = 'lab.healthidentitydirectory.com'
  open.mockReset()
  vi.spyOn(window, 'open').mockImplementation(open)
  setStaffSessionReady(true)
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  // Nothing went anywhere but the stubbed gateway and bucket.
  expect(network.sent.every(request => ORIGINS.includes(request.url.origin))).toBe(true)
  vi.mocked(window.open).mockRestore()
  setStaffSessionReady(false)
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('switch off: exactly today’s pages and requests', () => {
  /** Renders a page, lets it settle, and returns its markup and every request it sent. */
  async function today(page: 'lab' | 'pharmacy', permissions: string[], act_?: () => Promise<void>) {
    as(permissions, page === 'lab' ? 'laboratory' : 'pharmacy')
    network.sent.length = 0
    const view = renderPage(page)
    await screen.findByText(page === 'lab' ? 'Haemoglobin' : 'Amoxicillin 500 mg capsule')
    await act_?.()
    await settle()
    const shown = { html: view.container.innerHTML, sent: wire(network.sent) }
    cleanup()
    forgetDocumentTypesServed()
    return shown
  }

  it('Laboratory: holding the document permissions changes nothing, and only today’s reads go out', async () => {
    network.labList = { items: [LAB_ITEM, ACCESSIONED] }
    // Today's layout, never wrapped: the work list and, beside it, the one card for the chosen work.
    const beside = () => [...screen.getByText('Haemoglobin').closest('.staff-two-col')!.children] as HTMLElement[]
    const openAccession = async () => {
      expect(beside().map(child => child.classList.contains('staff-list') || child.classList.contains('staff-card'))).toEqual([true, true])
      expect(within(beside()[1]!).getByRole('heading', { name: 'Choose work' })).toBeTruthy()
      fireEvent.click(within(await row('Blood glucose')).getByRole('button', { name: 'Open accession' }))
      await screen.findByText('Accession ACC-2026-000123')
      expect(beside()).toHaveLength(2)
      expect(beside()[1]!.classList.contains('staff-card')).toBe(true)
      expect(within(beside()[1]!).getByRole('heading', { name: 'Specimen accession' })).toBeTruthy()
    }
    const without = await today('lab', LAB_WORK, openAccession)
    const holding = await today('lab', LAB_DOCUMENTS, openAccession)
    expect(holding.html).toBe(without.html)
    expect(holding.sent).toEqual(without.sent)
    // Today's two reads, byte for byte: the work list, then the accession opened.
    const headers = [['accept', 'application/json'], ['x-facility-id', DEMO_LABORATORY_ID], ['x-purpose-of-use', 'direct-care']]
    expect(holding.sent).toEqual([
      { method: 'GET', url: 'https://gateway.example.test/api/v1/lab/work-items', headers, body: null },
      { method: 'GET', url: 'https://gateway.example.test/api/v1/lab/accessions/accession-1', headers, body: null },
    ])
    expect(holding.html).not.toMatch(/Result documents|Lab result file|Attach result document/)
    expect(documentsServedNever()).toBe(true)
  })

  it('Pharmacy: holding the document permissions changes nothing, and only today’s read goes out', async () => {
    network.pharmacyList = { items: [PHARMACY_ITEM, PHARMACY_ITEM_2] }
    const without = await today('pharmacy', PHARMACY_WORK)
    const holding = await today('pharmacy', PHARMACY_DOCUMENTS)
    expect(holding.html).toBe(without.html)
    expect(holding.sent).toEqual(without.sent)
    expect(holding.sent).toEqual([{ method: 'GET', url: 'https://gateway.example.test/api/v1/pharmacy/work-items',
      headers: [['accept', 'application/json'], ['x-facility-id', DEMO_PHARMACY_ID], ['x-purpose-of-use', 'direct-care']], body: null }])
    expect(holding.html).not.toMatch(/Prescription sheets|Prescription sheet file|Attach prescription sheet/)
  })

  it('learns the switch is off from a work list without it, and offers nothing', async () => {
    as(LAB_DOCUMENTS)
    renderPage('lab')
    await row('Haemoglobin')
    await settle()
    expect(documentTypesServed()).toBe(false)
    expect(screen.queryByRole('button', { name: 'Result documents' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
  })

  it.each([{ documentTypes: 'true' }, { documentTypes: 1 }, { documentTypes: false }])(
    'stays off on an answer that does not say exactly `documentTypes: true` (%o)', async extra => {
      network.pharmacyList = { items: [PHARMACY_ITEM], ...extra }
      as(PHARMACY_DOCUMENTS, 'pharmacy')
      renderPage('pharmacy')
      await row('Amoxicillin 500 mg capsule')
      await settle()
      expect(documentTypesServed()).toBe(false)
      expect(screen.queryByRole('button', { name: 'Prescription sheets' })).toBeNull()
      expect(gateway().map(request => `${request.method} ${request.url.pathname}${request.url.search}`)).toEqual(['GET /api/v1/pharmacy/work-items'])
    })

  /** Nothing of a document's type, work item or the documents list was ever sent. */
  function documentsServedNever() {
    return network.sent.every(request => !/documentType|labWorkItemId|pharmacyWorkItemId|lab_result|prescription_sheet|\/ehr\/documents/
      .test(`${request.url.href} ${String(request.body ?? '')}`))
  }
})

describe('switch on: Result documents on a Lab work item', () => {
  beforeEach(() => {
    network.labList = { items: [LAB_ITEM], documentTypes: true }
    network.documents = [LAB_RESULT, PENDING]
    as(LAB_DOCUMENTS)
  })

  it('opens from the work row, reads the work item’s documents with its own patient, and lists them', async () => {
    renderPage('lab')
    await row('Haemoglobin')
    // Nothing is read until the work is chosen.
    await settle()
    expect(documentReads()).toEqual([])
    const shown = await openLabDocuments()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Result documents' }))
    expect(within(shown).getByText('For Haemoglobin')).toBeTruthy()
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    const [read] = documentReads()
    expect(Object.fromEntries(read!.url.searchParams)).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1' })
    expect(read!.headers.get('X-Facility-ID')).toBe(DEMO_LABORATORY_ID)
    expect(documentReads()).toHaveLength(1)
    expect(listedLine(shown, 'full-blood-count.jpg')).toBe('Lab result · image/jpeg · 20 KiB · scan: clean')
    expect(listedLine(shown, 'haemoglobin-report.pdf')).toBe('Lab result · application/pdf · 100 KiB · scan: pending')
    // Open file only once its scan is clean.
    const clean = within(shown).getByText('full-blood-count.jpg').closest<HTMLElement>('.staff-list-item')!
    const scanning = within(shown).getByText('haemoglobin-report.pdf').closest<HTMLElement>('.staff-list-item')!
    expect(within(clean).getByRole('button', { name: 'Open file' })).toBeTruthy()
    expect(within(scanning).queryByRole('button', { name: 'Open file' })).toBeNull()
    // The patient is never named or shown here.
    expect(shown.textContent).not.toContain(PATIENT)
    expect(shown.textContent).not.toContain('4f9c2e')
  })

  it('shows only documents of this work item’s patient kept on this work item', async () => {
    network.documents = [LAB_RESULT, { ...LAB_RESULT, id: 'document-3', fileName: 'other-patient.pdf', patientId: OTHER_PATIENT },
      { ...LAB_RESULT, id: 'document-4', fileName: 'other-work.pdf', labWorkItemId: 'work-item-9' }]
    renderPage('lab')
    const shown = await openLabDocuments()
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(within(shown).queryByText('other-patient.pdf')).toBeNull()
    expect(within(shown).queryByText('other-work.pdf')).toBeNull()
  })

  it('says when there are none yet', async () => {
    network.documents = []
    renderPage('lab')
    const shown = await openLabDocuments()
    expect(await within(shown).findByText('No result documents yet.')).toBeTruthy()
  })

  it('attaches a lab result: the work item and the type in the intent, the very File PUT, completed after it, then read again', async () => {
    renderPage('lab')
    const shown = await openLabDocuments()
    await within(shown).findByText('full-blood-count.jpg')
    const field = within(shown).getByLabelText(/^Lab result file/)
    expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toBe(LAB_HINT)
    const file = jpeg()
    network.documents = [LAB_RESULT, { ...LAB_RESULT, id: 'document-9', fileName: 'demo-lab-result.jpg', sizeBytes: JPEG_BYTES.byteLength,
      scanStatus: 'pending' }]
    choose(shown, /^Lab result file/, file)
    send(shown, 'Attach result document')
    expect(await within(shown).findByText(LAB_ATTACHED)).toBeTruthy()
    expect(await within(shown).findByText('demo-lab-result.jpg')).toBeTruthy()

    const [intent] = named('POST', '/api/v1/ehr/documents/upload-intents')
    const body = JSON.parse(String(intent!.body)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['patientId', 'labWorkItemId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex', 'classification',
      'retentionClass', 'documentType'])
    expect(body).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1', fileName: 'demo-lab-result.jpg', mediaType: 'image/jpeg',
      sizeBytes: JPEG_BYTES.byteLength, sha256Hex: createHash('sha256').update(JPEG_BYTES).digest('hex'), classification: 'phi',
      retentionClass: 'clinical-10y', documentType: 'lab_result' })
    expect(intent!.headers.get('X-Facility-ID')).toBe(DEMO_LABORATORY_ID)

    const puts = network.sent.filter(request => request.url.origin === 'https://storage.example.test')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.method).toBe('PUT')
    expect(puts[0]!.body).toBe(file)
    expect(new Uint8Array(await (puts[0]!.body as Blob).arrayBuffer())).toEqual(JPEG_BYTES)
    const order = network.sent.map(request => request.url.href)
    expect(order.indexOf('https://storage.example.test/bucket/document-9'))
      .toBeLessThan(order.indexOf('https://gateway.example.test/api/v1/ehr/documents/document-9/complete'))

    await waitFor(() => expect(documentReads()).toHaveLength(2))
    expect(Object.fromEntries(documentReads()[1]!.url.searchParams)).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1' })
    for (const request of gateway()) expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/encounterId|pharmacyWorkItemId/)
  })

  it('refuses a missing or unsupported file at its field, and sends nothing', async () => {
    renderPage('lab')
    const shown = await openLabDocuments()
    await within(shown).findByText('full-blood-count.jpg')
    send(shown, 'Attach result document')
    const field = within(shown).getByLabelText(/^Lab result file/)
    await waitFor(() => expect(document.getElementById(`${field.id}-error`)?.textContent).toBe('Select a file first.'))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field)
    choose(shown, /^Lab result file/, new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    send(shown, 'Attach result document')
    await waitFor(() => expect(document.getElementById(`${field.id}-error`)?.textContent).toBe('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.'))
    expect(named('POST', '/api/v1/ehr/documents/upload-intents')).toEqual([])
  })

  it('says a lab result refused on this host in the core’s words (403 DOCUMENT_TYPE_NOT_ALLOWED_HERE)', async () => {
    network.refuse = { status: 403, body: { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE', message: 'Document type not allowed on this host' } }
    renderPage('lab')
    const shown = await openLabDocuments()
    await within(shown).findByText('full-blood-count.jpg')
    choose(shown, /^Lab result file/, jpeg())
    send(shown, 'Attach result document')
    const alerts = await within(shown).findAllByRole('alert')
    expect(alerts.map(alert => alert.textContent)).toEqual([NOT_HERE])
    expect(within(shown).queryByText(LAB_ATTACHED)).toBeNull()
    expect(network.sent.filter(request => request.url.origin === 'https://storage.example.test')).toEqual([])
    expect(named('POST', '/api/v1/ehr/documents/document-9/complete')).toEqual([])
  })

  it('opens a clean file only through a signed storage link, in a tab of its own', async () => {
    renderPage('lab')
    const shown = await openLabDocuments()
    fireEvent.click(await within(shown).findByRole('button', { name: 'Open file' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example.test/bucket/document-1?X-Amz-Signature=demo', '_blank',
      'noopener,noreferrer'))
    expect(named('GET', '/api/v1/ehr/documents/document-1/download')[0]!.headers.get('X-Facility-ID')).toBe(DEMO_LABORATORY_ID)
  })

  it('never opens a link that is not a signed storage link', async () => {
    network.download = 'javascript:alert(1)'
    renderPage('lab')
    const shown = await openLabDocuments()
    fireEvent.click(await within(shown).findByRole('button', { name: 'Open file' }))
    expect((await within(shown).findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(open).not.toHaveBeenCalled()
  })

  it('shows under the accession when the work is opened from its accession too', async () => {
    network.labList = { items: [ACCESSIONED], documentTypes: true }
    network.documents = [{ ...LAB_RESULT, labWorkItemId: 'work-item-2' }]
    renderPage('lab')
    fireEvent.click(within(await row('Blood glucose')).getByRole('button', { name: 'Open accession' }))
    await screen.findByText('Accession ACC-2026-000123')
    const shown = card('Result documents')
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    const column = shown.parentElement!
    expect(column.className).toBe('staff-stack')
    expect(within(column).getByRole('heading', { name: 'Specimen accession' })).toBeTruthy()
    expect(Object.fromEntries(documentReads()[0]!.url.searchParams)).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-2' })
  })

  it('on work whose order from another facility has ended, lists its documents but attaches nothing', async () => {
    network.labList = { items: [{ ...LAB_ITEM, orderRoute: { id: 'route-1', reference: 'LR-DEMO-1', effectiveState: 'cancelled',
      access: 'read', orderingFacilityName: 'Demo Hospital', ordererName: null } }], documentTypes: true }
    renderPage('lab')
    const shown = await openLabDocuments()
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(within(shown).getByText('This order from another facility has ended: nothing more can be attached to it.')).toBeTruthy()
    expect(within(shown).queryByLabelText(/^Lab result file/)).toBeNull()
    expect(within(shown).queryByRole('button', { name: 'Attach result document' })).toBeNull()
  })

  it('chosen for its documents, a closed order or work already accessioned never shows the form preparing an accession', async () => {
    // A closed order: its row hides Prepare accession (B3), and so does choosing it for its documents.
    as([...LAB_DOCUMENTS, 'lab.accession.create'])
    network.labList = { items: [{ ...LAB_ITEM, orderRoute: { id: 'route-1', reference: 'LR-DEMO-1', effectiveState: 'cancelled',
      access: 'read', orderingFacilityName: 'Demo Hospital', ordererName: null } }], documentTypes: true }
    renderPage('lab')
    expect(within(await row('Haemoglobin')).queryByRole('button', { name: 'Prepare accession' })).toBeNull()
    const shown = await openLabDocuments()
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create specimen accession' })).toBeNull()
    // Only reads went out.
    expect(network.sent.filter(request => request.method !== 'GET')).toEqual([])
    cleanup()
    // Accessioned work this member cannot open: its row offers no accession, and neither does choosing it.
    as(['lab.work-item.read', 'lab.accession.create', 'lab.document.read'])
    network.labList = { items: [ACCESSIONED], documentTypes: true }
    network.documents = [{ ...LAB_RESULT, labWorkItemId: 'work-item-2' }]
    renderPage('lab')
    expect(within(await row('Blood glucose')).queryByRole('button', { name: /accession/i })).toBeNull()
    const again = await openLabDocuments('Blood glucose')
    expect(await within(again).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create specimen accession' })).toBeNull()
  })

  it('chosen for its documents, work that may still be prepared shows the form its row offers, focus at the documents', async () => {
    as([...LAB_DOCUMENTS, 'lab.accession.create'])
    renderPage('lab')
    expect(within(await row('Haemoglobin')).getByRole('button', { name: 'Prepare accession' })).toBeTruthy()
    const shown = await openLabDocuments()
    await within(shown).findByText('full-blood-count.jpg')
    expect(screen.getByRole('heading', { name: 'Create specimen accession' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Result documents' }))
  })
})

describe('switch on: who and where', () => {
  beforeEach(() => {
    network.labList = { items: [LAB_ITEM], documentTypes: true }
    network.pharmacyList = { items: [PHARMACY_ITEM], documentTypes: true }
    network.documents = [LAB_RESULT]
  })

  it('lab.document.read alone: the list, no form', async () => {
    as([...LAB_WORK, 'lab.document.read'])
    renderPage('lab')
    const shown = await openLabDocuments()
    expect(await within(shown).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(within(shown).queryByLabelText(/^Lab result file/)).toBeNull()
    expect(within(shown).queryByRole('button', { name: 'Attach result document' })).toBeNull()
  })

  it('lab.document.write alone: the form, and no list read', async () => {
    as([...LAB_WORK, 'lab.document.write'])
    renderPage('lab')
    const shown = await openLabDocuments()
    expect(within(shown).getByLabelText(/^Lab result file/)).toBeTruthy()
    await settle()
    expect(documentReads()).toEqual([])
    expect(within(shown).queryByText('full-blood-count.jpg')).toBeNull()
  })

  it('neither: nothing offered and nothing read, though the switch is on', async () => {
    as(LAB_WORK)
    renderPage('lab')
    await row('Haemoglobin')
    await settle()
    expect(documentTypesServed()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Result documents' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(documentReads()).toEqual([])
  })

  it('pharmacy permissions offer no result documents, and lab permissions no prescription sheets', async () => {
    as([...LAB_WORK, 'pharmacy.document.read', 'pharmacy.document.write'])
    renderPage('lab')
    await row('Haemoglobin')
    await settle()
    expect(screen.queryByRole('button', { name: 'Result documents' })).toBeNull()
    cleanup()
    as([...PHARMACY_WORK, 'lab.document.read', 'lab.document.write'], 'pharmacy')
    renderPage('pharmacy')
    await row('Amoxicillin 500 mg capsule')
    await settle()
    expect(screen.queryByRole('button', { name: 'Prescription sheets' })).toBeNull()
    expect(documentReads()).toEqual([])
  })

  it.each([
    'lab.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com',
    'lab.staging.healthidentitydirectory.com', 'localhost',
  ])('offers result documents on %s', async name => {
    host.name = name
    as(LAB_DOCUMENTS)
    renderPage('lab')
    expect(await openLabDocuments()).toBeTruthy()
  })

  it.each([
    'pharmacy.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com',
    'admin.healthidentitydirectory.com',
  ])('offers no result documents on %s, and reads none', async name => {
    host.name = name
    as(LAB_DOCUMENTS)
    renderPage('lab')
    await row('Haemoglobin')
    await settle()
    expect(screen.queryByRole('button', { name: 'Result documents' })).toBeNull()
    expect(documentReads()).toEqual([])
  })

  it.each(['pharmacy.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com'])(
    'offers prescription sheets on %s', async name => {
      host.name = name
      as(PHARMACY_DOCUMENTS, 'pharmacy')
      renderPage('pharmacy')
      expect(await openSheets()).toBeTruthy()
    })

  it.each(['outreach.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com'])(
    'offers no prescription sheets on %s', async name => {
      host.name = name
      as(PHARMACY_DOCUMENTS, 'pharmacy')
      renderPage('pharmacy')
      await row('Amoxicillin 500 mg capsule')
      await settle()
      expect(screen.queryByRole('button', { name: 'Prescription sheets' })).toBeNull()
    })
})

describe('switch on: work with no patient on Health ID', () => {
  // A walk-in served without a Health ID has no patient to keep a document on: no button, no card, nothing read.
  it('offers no Result documents on such Lab work', async () => {
    network.labList = { items: [{ ...LAB_ITEM, patientId: '' }], documentTypes: true }
    as([...LAB_WORK, 'lab.document.read', 'lab.document.write'])
    renderPage('lab')
    await row('Haemoglobin')
    await settle()
    expect(documentTypesServed()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Result documents' })).toBeNull()
    expect(documentReads()).toEqual([])
  })

  it('offers no Prescription sheets on such Pharmacy work', async () => {
    host.name = 'pharmacy.healthidentitydirectory.com'
    network.pharmacyList = { items: [{ ...PHARMACY_ITEM, patientId: '' }], documentTypes: true }
    as(PHARMACY_DOCUMENTS, 'pharmacy')
    renderPage('pharmacy')
    const item = await row('Amoxicillin 500 mg capsule')
    await settle()
    expect(documentTypesServed()).toBe(true)
    expect(within(item).queryByRole('button', { name: 'Prescription sheets' })).toBeNull()
    expect(documentReads()).toEqual([])
  })
})

describe('switch on: Prescription sheets on a Pharmacy work item', () => {
  beforeEach(() => {
    host.name = 'pharmacy.healthidentitydirectory.com'
    network.pharmacyList = { items: [PHARMACY_ITEM, PHARMACY_ITEM_2], documentTypes: true }
    network.documents = [SHEET]
    as(PHARMACY_DOCUMENTS, 'pharmacy')
  })

  it('opens in its row when asked for, reading only that work item’s sheets with its own patient', async () => {
    renderPage('pharmacy')
    const item = await row('Amoxicillin 500 mg capsule')
    await settle()
    expect(documentReads()).toEqual([])
    const toggle = await within(item).findByRole('button', { name: 'Prescription sheets' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const shown = card('Prescription sheets')
    expect(item.contains(shown)).toBe(true)
    expect(await within(shown).findByText('prescription-sheet.png')).toBeTruthy()
    expect(listedLine(shown, 'prescription-sheet.png')).toBe('Prescription sheet · image/png · 4 KiB · scan: pending')
    // Scan pending: no Open file.
    expect(within(shown).queryByRole('button', { name: 'Open file' })).toBeNull()
    expect(documentReads()).toHaveLength(1)
    const [read] = documentReads()
    expect(Object.fromEntries(read!.url.searchParams)).toEqual({ patientId: PATIENT, pharmacyWorkItemId: 'work-item-1' })
    expect(read!.headers.get('X-Facility-ID')).toBe(DEMO_PHARMACY_ID)
    expect(shown.textContent).not.toContain('4f9c2e')
    // Closed again, it goes.
    fireEvent.click(toggle)
    expect(screen.queryByRole('heading', { name: 'Prescription sheets' })).toBeNull()
  })

  it('attaches a prescription sheet: the work item and the type in the intent, the very File PUT, then read again', async () => {
    renderPage('pharmacy')
    const shown = await openSheets()
    await within(shown).findByText('prescription-sheet.png')
    const file = png()
    choose(shown, /^Prescription sheet file/, file)
    send(shown, 'Attach prescription sheet')
    expect(await within(shown).findByText(SHEET_ATTACHED)).toBeTruthy()
    const [intent] = named('POST', '/api/v1/ehr/documents/upload-intents')
    const body = JSON.parse(String(intent!.body)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['patientId', 'pharmacyWorkItemId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex',
      'classification', 'retentionClass', 'documentType'])
    expect(body).toEqual({ patientId: PATIENT, pharmacyWorkItemId: 'work-item-1', fileName: 'demo-prescription-sheet.png',
      mediaType: 'image/png', sizeBytes: PNG_BYTES.byteLength, sha256Hex: createHash('sha256').update(PNG_BYTES).digest('hex'),
      classification: 'phi', retentionClass: 'clinical-10y', documentType: 'prescription_sheet' })
    expect(intent!.headers.get('X-Facility-ID')).toBe(DEMO_PHARMACY_ID)
    const puts = network.sent.filter(request => request.url.origin === 'https://storage.example.test')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.method).toBe('PUT')
    expect(puts[0]!.body).toBe(file)
    expect(new Uint8Array(await (puts[0]!.body as Blob).arrayBuffer())).toEqual(PNG_BYTES)
    await waitFor(() => expect(documentReads()).toHaveLength(2))
    for (const request of gateway()) expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/encounterId|labWorkItemId/)
  })

  it('keeps the backend’s own words for a prescription sheet it refuses: the lab-result words are not about it', async () => {
    network.refuse = { status: 403, body: { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE', message: 'Prescription sheets are not accepted here' } }
    renderPage('pharmacy')
    const shown = await openSheets()
    await within(shown).findByText('prescription-sheet.png')
    choose(shown, /^Prescription sheet file/, png())
    send(shown, 'Attach prescription sheet')
    expect((await within(shown).findByRole('alert')).textContent).toBe('Prescription sheets are not accepted here')
    expect(within(shown).queryByText(SHEET_ATTACHED)).toBeNull()
  })

  it('pharmacy.document.write alone: the form, and no list read', async () => {
    as([...PHARMACY_WORK, 'pharmacy.document.write'], 'pharmacy')
    renderPage('pharmacy')
    const shown = await openSheets()
    expect(within(shown).getByLabelText(/^Prescription sheet file/)).toBeTruthy()
    await settle()
    expect(documentReads()).toEqual([])
  })

  it('on a prescription whose order from another facility has ended, lists its sheets but attaches nothing', async () => {
    network.pharmacyList = { items: [{ ...PHARMACY_ITEM, orderRoute: { id: 'route-1', reference: 'RX-DEMO-1', effectiveState: 'expired',
      access: 'read', orderingFacilityName: 'Demo Hospital', ordererName: null } }], documentTypes: true }
    renderPage('pharmacy')
    const shown = await openSheets()
    expect(await within(shown).findByText('prescription-sheet.png')).toBeTruthy()
    expect(within(shown).getByText('This order from another facility has ended: nothing more can be attached to it.')).toBeTruthy()
    expect(within(shown).queryByLabelText(/^Prescription sheet file/)).toBeNull()
    expect(within(shown).queryByRole('button', { name: 'Attach prescription sheet' })).toBeNull()
  })

  it('pharmacy.document.read alone: the list, no form', async () => {
    as([...PHARMACY_WORK, 'pharmacy.document.read'], 'pharmacy')
    renderPage('pharmacy')
    const shown = await openSheets()
    expect(await within(shown).findByText('prescription-sheet.png')).toBeTruthy()
    expect(within(shown).queryByLabelText(/^Prescription sheet file/)).toBeNull()
  })
})
