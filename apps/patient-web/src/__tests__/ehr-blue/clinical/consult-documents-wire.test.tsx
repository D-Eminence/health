import { createHash } from 'node:crypto'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDocumentTypesServed } from '../../../documentTypes'
import { setStaffSessionReady } from '../../../staff/session'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, labelled, renderPage } from './harness'

/**
 * What blue Consultation > Documents actually sends when a file is uploaded: the real staff API, with only the network
 * stubbed (the gateway and the storage bucket, on example.test). Dormant (the list says nothing of the document types),
 * the upload intent is today's eight fields, byte for byte; served (`documentTypes: true`), the same eight and the
 * type chosen, nothing else. Fictional data only: Patient One at a demo facility.
 */
const network = vi.hoisted(() => {
  const state = {
    documentTypes: undefined as unknown,
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
    const { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, allowedLookup } = await import('./harness')
    const ENCOUNTER = { id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
      startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3 }
    const LETTER = { id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
      sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z' }
    if (method === 'POST' && url.pathname === '/api/v1/identity/patient-lookup') return json(allowedLookup)
    if (method === 'POST' && url.pathname === '/api/v1/identity/consent-status') return json({ readAllowed: true, writeAllowed: true })
    if (method === 'GET' && url.pathname === '/api/v1/ehr/documents') {
      return json({ items: [LETTER], nextCursor: null, ...(state.documentTypes === undefined ? {} : { documentTypes: state.documentTypes }) })
    }
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/upload-intents') {
      const { mediaType } = JSON.parse(String(init?.body)) as { mediaType: string }
      return json({ document: { id: 'doc-9' }, upload: { method: 'PUT', url: 'https://storage.example.test/bucket/doc-9',
        requiredHeaders: { 'Content-Type': mediaType }, expiresInSeconds: 300 } })
    }
    if (method === 'POST' && url.pathname === '/api/v1/ehr/documents/doc-9/complete') return new Response(null, { status: 204 })
    const encounters = `/api/v1/ehr/patients/${ENCOUNTER.patientId}/encounters`
    if (method === 'GET' && url.pathname === encounters) return json({ items: [ENCOUNTER], nextCursor: null })
    if (method === 'GET' && url.pathname === `${encounters}/${ENCOUNTER.id}`) return json(ENCOUNTER)
    // Every other read of the encounter (notes, diagnoses, vitals, orders): empty.
    if (method === 'GET' && url.pathname.startsWith(`${encounters}/${ENCOUNTER.id}/`)) return json({ items: [], nextCursor: null })
    return new Response(null, { status: 404 })
  })
  return state
})
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Orders part</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ENCOUNTER = { id: ENCOUNTER_ID, patientId: PATIENT_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T08:00:00.000Z' }
// A tiny PDF: its bytes are what the digest is taken of.
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 Demo Hospital referral')
/** Today's upload intent, field for field (staff/api.ts sendDocument). */
const TODAYS_FIELDS = ['patientId', 'encounterId', 'fileName', 'mediaType', 'sizeBytes', 'sha256Hex', 'classification', 'retentionClass']

const named = (method: string, pathname: string) => network.sent.filter(request => request.method === method && request.url.pathname === pathname)
const intentBody = () => {
  const [intent] = named('POST', '/api/v1/ehr/documents/upload-intents')
  return { text: String(intent!.body), headers: intent!.headers }
}
const card = () => screen.getByRole('heading', { level: 2, name: 'Documents' }).closest('section') as HTMLElement

async function uploadOne(label: string, chooseType?: string) {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  await within(card()).findByText('referral-letter.pdf')
  if (chooseType) fireEvent.change(within(card()).getByLabelText('Document type'), { target: { value: chooseType } })
  const file = new File([PDF_BYTES], 'demo-referral.pdf', { type: 'application/pdf' })
  fireEvent.change(within(card()).getByLabelText(labelled(label)), { target: { files: [file] } })
  await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Upload document' })) })
  expect(await within(card()).findByText('Uploaded. It can be opened once the virus check is done.')).toBeTruthy()
  return file
}

beforeEach(() => {
  network.sent.length = 0
  network.documentTypes = undefined
  staff.permissions = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read', 'ehr.document.write']
  staff.activePatient = activePatient()
  setStaffSessionReady(true)
  forgetDocumentTypesServed()
})
afterEach(() => {
  // Nothing went anywhere but the stubbed gateway and bucket.
  expect(network.sent.every(request => ['https://gateway.example.test', 'https://storage.example.test'].includes(request.url.origin))).toBe(true)
  setStaffSessionReady(false)
  forgetDocumentTypesServed()
})

describe('dormant: the document list says nothing of the types', () => {
  it('sends exactly today’s upload intent, byte for byte, and no type anywhere', async () => {
    const file = await uploadOne('Clinical document')
    const { text, headers } = intentBody()
    const sha256Hex = createHash('sha256').update(PDF_BYTES).digest('hex')
    // The exact body today's blue card sends: the same eight fields, in the same order, and nothing else.
    expect(text).toBe(JSON.stringify({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'demo-referral.pdf',
      mediaType: 'application/pdf', sizeBytes: file.size, sha256Hex, classification: 'phi', retentionClass: 'clinical-10y' }))
    expect(Object.keys(JSON.parse(text) as object)).toEqual(TODAYS_FIELDS)
    expect(headers.get('X-Facility-ID')).toBe(FACILITY_ID)
    // The storage PUT is the very File, then the upload is completed.
    const puts = network.sent.filter(request => request.url.origin === 'https://storage.example.test')
    expect(puts.map(request => request.method)).toEqual(['PUT'])
    expect(puts[0]!.body).toBe(file)
    await waitFor(() => expect(named('POST', '/api/v1/ehr/documents/doc-9/complete')).toHaveLength(1))
    for (const request of network.sent) {
      expect(`${request.url.href} ${typeof request.body === 'string' ? request.body : ''}`).not.toMatch(/documentType|labWorkItemId|pharmacyWorkItemId|clinical_document/)
    }
  })

  it('still sends today’s eight fields when an answer says documentTypes "true" (not exactly true)', async () => {
    network.documentTypes = 'true'
    await uploadOne('Clinical document')
    expect(Object.keys(JSON.parse(intentBody().text) as object)).toEqual(TODAYS_FIELDS)
  })
})

describe('served: the document list answers documentTypes: true', () => {
  it('sends today’s eight fields and the default type, and nothing else', async () => {
    network.documentTypes = true
    const file = await uploadOne('File')
    const body = JSON.parse(intentBody().text) as Record<string, unknown>
    expect(Object.keys(body)).toEqual([...TODAYS_FIELDS, 'documentType'])
    expect(body).toEqual({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'demo-referral.pdf', mediaType: 'application/pdf',
      sizeBytes: file.size, sha256Hex: createHash('sha256').update(PDF_BYTES).digest('hex'), classification: 'phi',
      retentionClass: 'clinical-10y', documentType: 'clinical_document' })
  })

  it('sends the type chosen, on the encounter, never a work item', async () => {
    network.documentTypes = true
    await uploadOne('File', 'prescription_sheet')
    const body = JSON.parse(intentBody().text) as Record<string, unknown>
    expect(body).toMatchObject({ encounterId: ENCOUNTER_ID, documentType: 'prescription_sheet' })
    expect(body).not.toHaveProperty('labWorkItemId')
    expect(body).not.toHaveProperty('pharmacyWorkItemId')
  })
})
