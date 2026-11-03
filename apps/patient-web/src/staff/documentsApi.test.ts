import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentType } from '../documentTypes'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh (and the served store with it).
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const FACILITY = 'facility-1'
const PATIENT = 'patient-1'
const STORAGE = 'https://storage.example.test/bucket/document-1'
const INTENT = '/api/v1/ehr/documents/upload-intents'
const COMPLETE = '/api/v1/ehr/documents/document-1/complete'
const LIST = '/api/v1/ehr/documents'

/** Today's upload-intent body, field for field: the encounter's, with no type. */
const TODAYS_FIELDS = ['patientId', 'encounterId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex', 'classification', 'retentionClass']

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** The gateway and the storage bucket, answering each step of an upload and any document list. */
function stubBackend() {
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin === 'https://storage.example.test') return new Response(null, { status: 200 })
    if (url.pathname === INTENT) return json({ document: { id: 'document-1' },
      upload: { method: 'PUT', url: STORAGE, requiredHeaders: { 'Content-Type': 'image/jpeg' }, expiresInSeconds: 300 } })
    if (url.pathname === COMPLETE) return new Response(null, { status: 204 })
    if (url.pathname === LIST) return json({ items: [], nextCursor: null, documentTypes: true })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/**
 * The staff API with a session in use and ready, as the provider portal sets it once signed in, and the document
 * types served when `served` says so (as a list that answered `documentTypes: true` would have taught the page).
 */
async function signedInStaffApi(served: boolean | null = null) {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  const documentTypes = await import('../documentTypes')
  if (served !== null) documentTypes.learnDocumentTypesServed(served)
  return import('./api')
}

type Fetch = ReturnType<typeof stubBackend>
const callsTo = (fetch: Fetch, pathname: string) => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === pathname)
const intentBody = (fetch: Fetch) => {
  const [call] = callsTo(fetch, INTENT)
  return JSON.parse(String(call![1]!.body)) as Record<string, unknown>
}
const pdf = () => new File(['%PDF-1.7 Demo Laboratory'], 'demo-referral.pdf', { type: 'application/pdf' })

describe('an encounter upload (uploadDocument)', () => {
  it('without a type sends exactly today’s eight fields, before the backend says anything', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi()
    const file = pdf()

    await expect(staffApi.uploadDocument(FACILITY, PATIENT, 'encounter-1', file)).resolves.toBe('document-1')

    const body = intentBody(fetch)
    expect(Object.keys(body)).toEqual(TODAYS_FIELDS)
    expect(body).toEqual({ patientId: PATIENT, encounterId: 'encounter-1', fileName: 'demo-referral.pdf', mediaType: 'application/pdf',
      sizeBytes: file.size, sha256Hex: createHash('sha256').update('%PDF-1.7 Demo Laboratory').digest('hex'),
      classification: 'phi', retentionClass: 'clinical-10y' })
    expect(callsTo(fetch, COMPLETE)).toHaveLength(1)
  })

  it('without a type still sends exactly today’s eight fields once the types are served', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)

    await staffApi.uploadDocument(FACILITY, PATIENT, 'encounter-1', pdf())

    expect(Object.keys(intentBody(fetch))).toEqual(TODAYS_FIELDS)
  })

  it('with a type adds documentType, and nothing else, once the types are served', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)

    await staffApi.uploadDocument(FACILITY, PATIENT, 'encounter-1', pdf(), 'lab_result')

    const body = intentBody(fetch)
    expect(Object.keys(body)).toEqual([...TODAYS_FIELDS, 'documentType'])
    expect(body).toMatchObject({ encounterId: 'encounter-1', documentType: 'lab_result' })
    expect(body).not.toHaveProperty('labWorkItemId')
    expect(body).not.toHaveProperty('pharmacyWorkItemId')
  })

  it.each([null, false] as const)('with a type is refused here, and nothing sent, while served is %s', async served => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(served)

    await expect(staffApi.uploadDocument(FACILITY, PATIENT, 'encounter-1', pdf(), 'clinical_document'))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPES_NOT_SERVED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a type the contract does not name, and sends nothing', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)

    await expect(staffApi.uploadDocument(FACILITY, PATIENT, 'encounter-1', pdf(), 'x_ray' as DocumentType))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPES_NOT_SERVED' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('a work item upload (uploadWorkItemDocument)', () => {
  it('keeps a lab result on the Lab work item: labWorkItemId and its type, no encounterId', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)
    const file = pdf()

    await expect(staffApi.uploadWorkItemDocument(FACILITY, PATIENT, { kind: 'lab', id: 'lab-work-1' }, file, 'lab_result'))
      .resolves.toBe('document-1')

    const body = intentBody(fetch)
    expect(Object.keys(body)).toEqual(['patientId', 'labWorkItemId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex',
      'classification', 'retentionClass', 'documentType'])
    expect(body).toMatchObject({ patientId: PATIENT, labWorkItemId: 'lab-work-1', documentType: 'lab_result',
      classification: 'phi', retentionClass: 'clinical-10y', sizeBytes: file.size })
    expect(body).not.toHaveProperty('encounterId')
    expect(body).not.toHaveProperty('pharmacyWorkItemId')
    expect(callsTo(fetch, COMPLETE)).toHaveLength(1)
  })

  it('keeps a prescription sheet on the Pharmacy work item: pharmacyWorkItemId, no encounterId', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)

    await staffApi.uploadWorkItemDocument(FACILITY, PATIENT, { kind: 'pharmacy', id: 'pharmacy-work-1' }, pdf(), 'prescription_sheet')

    const body = intentBody(fetch)
    expect(body).toMatchObject({ pharmacyWorkItemId: 'pharmacy-work-1', documentType: 'prescription_sheet' })
    expect(body).not.toHaveProperty('encounterId')
    expect(body).not.toHaveProperty('labWorkItemId')
  })

  it.each([null, false] as const)('is refused here, and nothing sent, while served is %s', async served => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(served)

    await expect(staffApi.uploadWorkItemDocument(FACILITY, PATIENT, { kind: 'lab', id: 'lab-work-1' }, pdf(), 'lab_result'))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPES_NOT_SERVED' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the stored file', () => {
  // A tiny JPEG: start-of-image, a JFIF header, end-of-image. Its bytes are what must reach storage, unchanged.
  const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xD9])

  it.each([
    ['an encounter upload', (api: Awaited<ReturnType<typeof signedInStaffApi>>['staffApi'], file: File) =>
      api.uploadDocument(FACILITY, PATIENT, 'encounter-1', file, 'lab_result')],
    ['a Lab work item upload', (api: Awaited<ReturnType<typeof signedInStaffApi>>['staffApi'], file: File) =>
      api.uploadWorkItemDocument(FACILITY, PATIENT, { kind: 'lab', id: 'lab-work-1' }, file, 'lab_result')],
  ])('is PUT as the very File chosen, its bytes never re-encoded (%s, image/jpeg)', async (_name, upload) => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)
    const file = new File([JPEG_BYTES], 'demo-lab-result.jpg', { type: 'image/jpeg' })

    await upload(staffApi, file)

    const puts = fetch.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://storage.example.test')
    expect(puts).toHaveLength(1)
    const [url, init] = puts[0]!
    expect(String(url)).toBe(STORAGE)
    expect(init!.method).toBe('PUT')
    expect(init!.body).toBe(file)
    expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(JPEG_BYTES)
    // What the intent declared is the file as chosen: its name, type, size and the SHA-256 of its exact bytes.
    expect(intentBody(fetch)).toMatchObject({ fileName: 'demo-lab-result.jpg', mediaType: 'image/jpeg', sizeBytes: JPEG_BYTES.byteLength,
      sha256Hex: createHash('sha256').update(JPEG_BYTES).digest('hex') })
    // Completed only after the bytes were stored.
    const order = fetch.mock.calls.map(([called]) => new URL(String(called)))
    expect(order.findIndex(called => called.origin === 'https://storage.example.test'))
      .toBeLessThan(order.findIndex(called => called.pathname === COMPLETE))
  })
})

describe('a document list', () => {
  it('for an encounter asks exactly as today: the patient and the encounter', async () => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi()

    await staffApi.documents(FACILITY, PATIENT, 'encounter-1')

    const [url] = callsTo(fetch, LIST)[0]!
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({ patientId: PATIENT, encounterId: 'encounter-1' })
  })

  it.each([
    [{ kind: 'lab', id: 'lab-work-1' } as const, { patientId: PATIENT, labWorkItemId: 'lab-work-1' }],
    [{ kind: 'pharmacy', id: 'pharmacy-work-1' } as const, { patientId: PATIENT, pharmacyWorkItemId: 'pharmacy-work-1' }],
  ])('for a work item carries that work item and no encounter (%o)', async (workItem, query) => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(true)

    const page = await staffApi.workItemDocuments(FACILITY, PATIENT, workItem)

    const [url, init] = callsTo(fetch, LIST)[0]!
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual(query)
    expect(new Headers(init!.headers).get('X-Facility-ID')).toBe(FACILITY)
    expect(page).toEqual({ items: [], nextCursor: null, documentTypes: true })
  })

  it.each([null, false] as const)('for a work item is not read while served is %s', async served => {
    const fetch = stubBackend()
    const { staffApi } = await signedInStaffApi(served)

    await expect(staffApi.workItemDocuments(FACILITY, PATIENT, { kind: 'lab', id: 'lab-work-1' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPES_NOT_SERVED' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
