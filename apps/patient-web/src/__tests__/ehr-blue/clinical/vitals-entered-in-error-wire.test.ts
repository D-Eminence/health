import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * What the blue vitals pages send for EHR-C8b (hid-system 0142, ehr-api vitals.controller.ts markEnteredInError and
 * VitalsListQueryDto), through the real staff client with only the network stubbed (on example.test): the PATCH is
 * in the browser contract, goes with the facility and direct care, never with an Idempotency-Key, and its body is
 * exactly the row version, the status and the reason; the list asks for readings entered in error only when told to.
 * Every id is fictional.
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
const VITAL = 'f0000000-0000-4000-8000-000000000001'
const VITALS = `/api/v1/ehr/patients/${PATIENT}/encounters/${ENCOUNTER}/vitals`

describe('Vitals entered in error on the wire', () => {
  it('patches the one reading with exactly the row version, the status and the reason, with no Idempotency-Key', async () => {
    const { sent, staffApi } = await staffClient({ id: VITAL, status: 'entered_in_error', rowVersion: 4 })
    await staffApi.markVitalEnteredInError(FACILITY, PATIENT, ENCOUNTER, VITAL, { expectedRowVersion: 3, changeReason: 'Recorded on the wrong patient' })
    expect(sent).toHaveLength(1)
    const [request] = sent
    expect(request!.method).toBe('PATCH')
    expect(request!.url.pathname).toBe(`${VITALS}/${VITAL}`)
    expect(request!.url.search).toBe('')
    expect(request!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(request!.headers.get('x-purpose-of-use')).toBe('direct-care')
    expect(request!.headers.has('idempotency-key')).toBe(false)
    expect(request!.body).toEqual({ expectedRowVersion: 3, status: 'entered_in_error', changeReason: 'Recorded on the wrong patient' })
  })

  it('lists the readings entered in error only when asked, with the page’s cursor', async () => {
    const { sent, staffApi } = await staffClient({ items: [], nextCursor: null })
    await staffApi.records(FACILITY, PATIENT, ENCOUNTER, 'vitals')
    await staffApi.records(FACILITY, PATIENT, ENCOUNTER, 'vitals', { includeEnteredInError: true, cursor: 'cursor-2', fresh: true })
    expect(sent[0]!.url.pathname).toBe(VITALS)
    expect(Object.fromEntries(sent[0]!.url.searchParams)).toEqual({ limit: '50' })
    expect(Object.fromEntries(sent[1]!.url.searchParams)).toEqual({ limit: '50', cursor: 'cursor-2', includeEnteredInError: 'true' })
  })
})
