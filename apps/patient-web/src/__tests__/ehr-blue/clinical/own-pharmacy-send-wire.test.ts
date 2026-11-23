import { findEndpoint } from '@hid/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * What the blue prescription page's "Send to pharmacy" sends (hid-system 0133, ehr-api at 06f98040: `POST
 * .../prescriptions/:prescriptionId/own-pharmacy-send`, prescriptions.controller.ts sendToOwnPharmacy and
 * SendPrescriptionToOwnPharmacyDto), through the real staff client with only the network stubbed (on example.test): the
 * route is in the browser contract and allowed to the staff site, it goes with the facility and direct care, never
 * with an Idempotency-Key, and its body is the row version, with the allergy acknowledgement only when one is given.
 * Every id and token is fictional.
 */
interface Sent { url: URL; method: string; body: unknown; headers: Headers }

async function staffClient(answer: unknown) {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  document.cookie = 'hid_access_csrf=csrf-1'
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    sent.push({ url: new URL(String(url)), method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const { setStaffSessionReady } = await import('../../../staff/session')
  setStaffSessionReady(true)
  const { staffApi } = await import('../../../staff/api')
  return { sent, staffApi }
}

const FACILITY = 'facility-demo-hospital'
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const RX = 'b0000000-0000-4000-8000-000000000001'
const PATH = `/api/v1/ehr/patients/${PATIENT}/encounters/${ENCOUNTER}/prescriptions/${RX}/own-pharmacy-send`
const ACK = { reason: 'Tolerated amoxicillin in 2024; observe for 30 minutes.', warningToken: 'b1'.repeat(32) }
const SENT = { pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } }

describe('Send to pharmacy on the wire', () => {
  it('posts the row version to own-pharmacy-send with the facility and direct care, and no Idempotency-Key', async () => {
    const { sent, staffApi } = await staffClient(SENT)
    const answer = await staffApi.ownPharmacySend(FACILITY, PATIENT, ENCOUNTER, RX, 4, null)
    expect(answer).toEqual(SENT)
    expect(sent).toHaveLength(1)
    const [request] = sent
    expect(request!.method).toBe('POST')
    expect(request!.url.pathname).toBe(PATH)
    expect(request!.url.search).toBe('')
    expect(request!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(request!.headers.get('x-purpose-of-use')).toBe('direct-care')
    expect(request!.headers.has('idempotency-key')).toBe(false)
    expect(request!.body).toEqual({ expectedRowVersion: 4 })
    expect(Object.keys(request!.body as object)).not.toContain('allergyAcknowledgement')
  })

  it('carries the allergy acknowledgement only when given, at the same version, still with no key', async () => {
    const { sent, staffApi } = await staffClient(SENT)
    await staffApi.ownPharmacySend(FACILITY, PATIENT, ENCOUNTER, RX, 4, { ...ACK, extra: 'not sent' } as never)
    expect(sent[0]!.url.pathname).toBe(PATH)
    expect(sent[0]!.body).toEqual({ expectedRowVersion: 4, allergyAcknowledgement: ACK })
    expect(sent[0]!.headers.has('idempotency-key')).toBe(false)
  })

  it('is registered as the prescriber’s write, for the staff site', () => {
    expect(findEndpoint('ehr.prescriptionOwnPharmacySend')).toMatchObject({
      service: 'ehr', methods: ['POST'], permissions: { POST: ['ehr.prescription.write'] },
      path: '/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId/own-pharmacy-send',
    })
  })
})
