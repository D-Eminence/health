import { createHash } from 'node:crypto'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDocumentTypesServed } from '../../../../documentTypes'
import { setStaffSessionReady } from '../../../../staff/session'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * What the blue Laboratory page actually sends for a work item's result documents: the real staff API, with only the
 * network stubbed (the gateway and the storage bucket, on example.test). Dormant, the page sends exactly what the
 * redesigned page sends without them, its work list read and its point-of-care reads (/api/v1/commercial, answered
 * "not switched on" here), and nothing else; served, it reads the Lab work item's documents and attaches a lab result
 * with the work item and the type, PUTting the very File chosen, its bytes unchanged. Fictional data only: Demo Laboratory.
 */
const network = vi.hoisted(() => {
  const state = {
    workList: {} as Record<string, unknown>,
    documents: [] as unknown[],
    sent: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  // In place before the staff API loads, which binds the transport's fetch then.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    state.sent.push({ method, url, body: init?.body, headers: new Headers(init?.headers) })
    if (url.origin === 'https://storage.example.test') return new Response(null, { status: 200 })
    if (url.origin !== 'https://gateway.example.test') return new Response(null, { status: 500 })
    if (method === 'GET' && url.pathname === '/api/v1/lab/work-items') return json(state.workList)
    if (method === 'GET' && url.pathname === '/api/v1/ehr/documents') return json({ items: state.documents, nextCursor: null, documentTypes: true })
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/upload-intents') {
      const { mediaType } = JSON.parse(String(init?.body)) as { mediaType: string }
      return json({ document: { id: 'document-9' }, upload: { method: 'PUT', url: 'https://storage.example.test/bucket/document-9',
        requiredHeaders: { 'Content-Type': mediaType }, expiresInSeconds: 300 } })
    }
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/document-9/complete') return new Response(null, { status: 204 })
    return new Response(null, { status: 404 })
  })
  return state
})
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))

vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const WORK_ITEM = { id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: null,
  accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z' }
const LISTED = { id: 'document-1', patientId: PATIENT, encounterId: null, labWorkItemId: 'work-item-1', fileName: 'full-blood-count.pdf',
  mediaType: 'application/pdf', sizeBytes: 20480, status: 'available', scanStatus: 'clean', createdAt: '2026-10-09T09:30:00.000Z',
  documentType: 'lab_result' }
// A tiny JPEG: start-of-image, a JFIF header, end-of-image. Its bytes are what must reach storage, unchanged.
const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xFF, 0xD9])

const gateway = () => network.sent.filter(request => request.url.origin === 'https://gateway.example.test')
const named = (method: string, pathname: string) => network.sent.filter(request => request.method === method && request.url.pathname === pathname)

/** The redesign's own point-of-care reads (payment setup, the price list): sent with or without the document types. */
const pointOfCare = (request: { url: URL }) => request.url.pathname.startsWith('/api/v1/commercial/')

async function openRecord() {
  renderDept(<Laboratory />, { route: '/provider/laboratory/work' })
  fireEvent.click(await screen.findByRole('button', { name: /, Haemoglobin$/ }))
  await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })
}

beforeEach(() => {
  network.sent.length = 0
  network.documents = [LISTED]
  session.facility = fakeFacility(['lab.work-item.read', 'lab.document.read', 'lab.document.write'])
  setStaffSessionReady(true)
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  // Nothing went anywhere but the stubbed gateway and bucket.
  expect(network.sent.every(request => ['https://gateway.example.test', 'https://storage.example.test'].includes(request.url.origin))).toBe(true)
  setStaffSessionReady(false)
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('dormant', () => {
  it('sends exactly today’s work list read, and no document read, type or work item anywhere', async () => {
    network.workList = { items: [WORK_ITEM] }
    await openRecord()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(gateway().filter(request => !pointOfCare(request)).map(request => `${request.method} ${request.url.pathname}${request.url.search}`))
      .toEqual(['GET /api/v1/lab/work-items'])
    // The point-of-care reads are the redesign's own, and only reads.
    expect(gateway().filter(pointOfCare).every(request => request.method === 'GET')).toBe(true)
    expect(named('GET', '/api/v1/ehr/documents')).toEqual([])
    for (const request of network.sent) {
      expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/documentType|labWorkItemId|pharmacyWorkItemId|lab_result/)
    }
  })
})

describe('served', () => {
  it('reads the Lab work item’s documents, attaches a lab result with its work item and type, PUTs the very File, then reads again', async () => {
    network.workList = { items: [WORK_ITEM], documentTypes: true }
    await openRecord()
    const card = (await screen.findByRole('heading', { name: 'Result documents' })).closest('section') as HTMLElement
    expect(await within(card).findByText('full-blood-count.pdf')).toBeTruthy()
    const [read] = named('GET', '/api/v1/ehr/documents')
    expect(Object.fromEntries(read!.url.searchParams)).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1' })
    expect(read!.headers.get('X-Facility-ID')).toBe(DEMO_LABORATORY_ID)

    const file = new File([JPEG_BYTES], 'demo-lab-result.jpg', { type: 'image/jpeg' })
    network.documents = [LISTED, { ...LISTED, id: 'document-9', fileName: 'demo-lab-result.jpg', mediaType: 'image/jpeg',
      sizeBytes: JPEG_BYTES.byteLength, scanStatus: 'pending' }]
    fireEvent.change(within(card).getByLabelText(/^Lab result file/), { target: { files: [file] } })
    fireEvent.click(within(card).getByRole('button', { name: 'Attach result document' }))
    expect(await within(card).findByText('Result document attached. It can be opened once its virus scan is clean.')).toBeTruthy()
    expect(await within(card).findByText('demo-lab-result.jpg')).toBeTruthy()

    // The intent: today's fields with the Lab work item in place of an encounter, and the type.
    const [intent] = named('POST', '/api/v1/ehr/documents/upload-intents')
    const body = JSON.parse(String(intent!.body)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['patientId', 'labWorkItemId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex', 'classification',
      'retentionClass', 'documentType'])
    expect(body).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1', fileName: 'demo-lab-result.jpg', mediaType: 'image/jpeg',
      sizeBytes: JPEG_BYTES.byteLength, sha256Hex: createHash('sha256').update(JPEG_BYTES).digest('hex'), classification: 'phi',
      retentionClass: 'clinical-10y', documentType: 'lab_result' })
    expect(intent!.headers.get('X-Facility-ID')).toBe(DEMO_LABORATORY_ID)

    // The storage PUT: the very File chosen, its bytes unchanged; completed only after it.
    const puts = network.sent.filter(request => request.url.origin === 'https://storage.example.test')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.method).toBe('PUT')
    expect(puts[0]!.body).toBe(file)
    expect(new Uint8Array(await (puts[0]!.body as Blob).arrayBuffer())).toEqual(JPEG_BYTES)
    const order = network.sent.map(request => request.url.href)
    expect(order.indexOf('https://storage.example.test/bucket/document-9'))
      .toBeLessThan(order.indexOf('https://gateway.example.test/api/v1/ehr/documents/document-9/complete'))

    // The documents are read again, the same way, after the attach.
    await waitFor(() => expect(named('GET', '/api/v1/ehr/documents')).toHaveLength(2))
    expect(Object.fromEntries(named('GET', '/api/v1/ehr/documents')[1]!.url.searchParams)).toEqual({ patientId: PATIENT, labWorkItemId: 'work-item-1' })
    // Nothing named an encounter or a pharmacy work item.
    for (const request of gateway()) expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/encounterId|pharmacyWorkItemId/)
  })
})
