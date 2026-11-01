import { createHash } from 'node:crypto'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDocumentTypesServed } from '../../../../documentTypes'
import { setStaffSessionReady } from '../../../../staff/session'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { accepted, AMOXICILLIN, CREATE, PATIENT_A, PRESCRIPTIONS, READ } from './fixtures'

/**
 * What the blue Pharmacy page actually sends for a work item's prescription sheets: the real staff API, with only the
 * network stubbed (the gateway and the storage bucket, on example.test). Dormant, the page sends exactly what the
 * redesigned page sends without them, its work list read and its point-of-care reads (/api/v1/commercial, answered
 * "not switched on" here), and nothing else; served, it reads the Pharmacy work item's sheets and attaches one with
 * the work item and the type, PUTting the very File chosen, its bytes unchanged. Fictional data only: Demo Pharmacy.
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
    if (method === 'GET' && url.pathname === '/api/v1/pharmacy/work-items') return json(state.workList)
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

const LISTED = { id: 'document-1', patientId: PATIENT_A, encounterId: null, pharmacyWorkItemId: accepted.id,
  fileName: 'prescription-sheet.pdf', mediaType: 'application/pdf', sizeBytes: 20480, status: 'available', scanStatus: 'clean',
  createdAt: '2026-10-08T10:00:00.000Z', documentType: 'prescription_sheet' }
// A tiny PNG signature followed by an image header's start. Its bytes are what must reach storage, unchanged.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52])

const gateway = () => network.sent.filter(request => request.url.origin === 'https://gateway.example.test')
const named = (method: string, pathname: string) => network.sent.filter(request => request.method === method && request.url.pathname === pathname)

/** The redesign's own point-of-care reads (payment setup): sent with or without the document types. */
const pointOfCare = (request: { url: URL }) => request.url.pathname.startsWith('/api/v1/commercial/')

async function openRecord() {
  renderDept(<Pharmacy />, { route: PRESCRIPTIONS })
  fireEvent.click(await screen.findByRole('button', { name: AMOXICILLIN }))
  await screen.findByRole('heading', { level: 1, name: AMOXICILLIN })
}

beforeEach(() => {
  network.sent.length = 0
  network.documents = [LISTED]
  session.facility = fakeFacility([READ, CREATE, 'pharmacy.document.read', 'pharmacy.document.write'],
    { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
  setStaffSessionReady(true)
  forgetDocumentTypesServed()
})
afterEach(() => {
  // Nothing went anywhere but the stubbed gateway and bucket.
  expect(network.sent.every(request => ['https://gateway.example.test', 'https://storage.example.test'].includes(request.url.origin))).toBe(true)
  setStaffSessionReady(false)
  forgetDocumentTypesServed()
})

describe('dormant', () => {
  it('sends exactly today’s work list read, and no document read, type or work item anywhere', async () => {
    network.workList = { items: [accepted] }
    await openRecord()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByRole('heading', { name: 'Prescription sheets' })).toBeNull()
    expect(gateway().filter(request => !pointOfCare(request)).map(request => `${request.method} ${request.url.pathname}${request.url.search}`))
      .toEqual(['GET /api/v1/pharmacy/work-items'])
    // The point-of-care reads are the redesign's own, and only reads.
    expect(gateway().filter(pointOfCare).every(request => request.method === 'GET')).toBe(true)
    expect(named('GET', '/api/v1/ehr/documents')).toEqual([])
    for (const request of network.sent) {
      expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/documentType|labWorkItemId|pharmacyWorkItemId|prescription_sheet/)
    }
  })
})

describe('served', () => {
  it('reads the Pharmacy work item’s sheets, attaches one with its work item and type, PUTs the very File, then reads again', async () => {
    network.workList = { items: [accepted], documentTypes: true }
    await openRecord()
    const card = (await screen.findByRole('heading', { name: 'Prescription sheets' })).closest('section') as HTMLElement
    expect(await within(card).findByText('prescription-sheet.pdf')).toBeTruthy()
    const [read] = named('GET', '/api/v1/ehr/documents')
    expect(Object.fromEntries(read!.url.searchParams)).toEqual({ patientId: PATIENT_A, pharmacyWorkItemId: accepted.id })
    expect(read!.headers.get('X-Facility-ID')).toBe(DEMO_PHARMACY_ID)

    const file = new File([PNG_BYTES], 'demo-prescription.png', { type: 'image/png' })
    network.documents = [LISTED, { ...LISTED, id: 'document-9', fileName: 'demo-prescription.png', mediaType: 'image/png',
      sizeBytes: PNG_BYTES.byteLength, scanStatus: 'pending' }]
    fireEvent.change(within(card).getByLabelText(/^Prescription sheet file/), { target: { files: [file] } })
    fireEvent.click(within(card).getByRole('button', { name: 'Attach prescription sheet' }))
    expect(await within(card).findByText('Prescription sheet attached. It can be opened once its virus scan is clean.')).toBeTruthy()
    expect(await within(card).findByText('demo-prescription.png')).toBeTruthy()

    const [intent] = named('POST', '/api/v1/ehr/documents/upload-intents')
    const body = JSON.parse(String(intent!.body)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['patientId', 'pharmacyWorkItemId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex',
      'classification', 'retentionClass', 'documentType'])
    expect(body).toEqual({ patientId: PATIENT_A, pharmacyWorkItemId: accepted.id, fileName: 'demo-prescription.png', mediaType: 'image/png',
      sizeBytes: PNG_BYTES.byteLength, sha256Hex: createHash('sha256').update(PNG_BYTES).digest('hex'), classification: 'phi',
      retentionClass: 'clinical-10y', documentType: 'prescription_sheet' })

    const puts = network.sent.filter(request => request.url.origin === 'https://storage.example.test')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.method).toBe('PUT')
    expect(puts[0]!.body).toBe(file)
    expect(new Uint8Array(await (puts[0]!.body as Blob).arrayBuffer())).toEqual(PNG_BYTES)
    const order = network.sent.map(request => request.url.href)
    expect(order.indexOf('https://storage.example.test/bucket/document-9'))
      .toBeLessThan(order.indexOf('https://gateway.example.test/api/v1/ehr/documents/document-9/complete'))

    await waitFor(() => expect(named('GET', '/api/v1/ehr/documents')).toHaveLength(2))
    for (const request of gateway()) expect(`${request.url.href} ${String(request.body ?? '')}`).not.toMatch(/encounterId|labWorkItemId/)
  })
})
