import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * What the provider portal sends for orders between facilities (Novu, P4c, SPEC-FINAL §8, P4c services report §8),
 * through the registered staff client: every request names the working facility and the direct-care purpose; sending and
 * accepting carry the caller's Idempotency-Key; sending says the patient agreed and which attestation text the clinician
 * saw; accepting confirms the patient (a pharmacy also gives a reason); the directory is never retried.
 */
interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

async function signedIn(answer: unknown = { items: [] }, status = 200) {
  document.cookie = 'hid_access_csrf=csrf-1'
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  const { orderRoutesApi } = await import('./api')
  return { requests, orderRoutesApi }
}

const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const ENCOUNTER = 'b0000000-0000-4000-8000-000000000001'
const ORDER = 'c0000000-0000-4000-8000-000000000002'
const ROUTE = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const BASE = `/api/v1/ehr/patients/${PATIENT}/encounters/${ENCOUNTER}`

function careHeaders(request: Recorded) {
  expect(request.headers.get('x-facility-id')).toBe('facility-1')
  expect(request.headers.get('x-purpose-of-use')).toBe('direct-care')
}

describe('orders between facilities, on the wire', () => {
  it('searches the directory by kind and words, once, never retried', async () => {
    const { requests, orderRoutesApi } = await signedIn({ status: 503, code: 'UPSTREAM_UNAVAILABLE', detail: 'Down' }, 503)
    await expect(orderRoutesApi.destinations('facility-1', 'laboratory', 'Yaba')).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.pathname).toBe('/api/v1/identity/order-destinations')
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ kind: 'laboratory', query: 'Yaba' })
    careHeaders(requests[0]!)
  })

  it('reads the attestation text of a kind', async () => {
    const { requests, orderRoutesApi } = await signedIn({ kind: 'prescription', version: 'v1', text: 'I confirm…' })
    await orderRoutesApi.attestation('facility-1', 'prescription')
    expect(requests[0]!.url.pathname).toBe('/api/v1/ehr/order-route-attestation')
    expect(requests[0]!.url.search).toBe('?kind=prescription')
    careHeaders(requests[0]!)
  })

  it.each([['lab_request', 'lab-requests'], ['prescription', 'prescriptions']] as const)(
    'sends a %s with its version, the destination, the patient’s agreement, the attestation version and the key', async (kind, segment) => {
      const { requests, orderRoutesApi } = await signedIn({ route: {}, order: {}, replayed: false })
      await orderRoutesApi.send('facility-1', PATIENT, ENCOUNTER, kind, ORDER,
        { expectedRowVersion: 4, receivingFacilityId: 'f-2', attestationTextVersion: 'order-route-lab-attestation-v1' }, 'send-key-0001')
      expect(requests[0]!.method).toBe('POST')
      expect(requests[0]!.url.pathname).toBe(`${BASE}/${segment}/${ORDER}/order-routes`)
      expect(requests[0]!.body).toEqual({ expectedRowVersion: 4, receivingFacilityId: 'f-2', patientAgreed: true,
        attestationTextVersion: 'order-route-lab-attestation-v1' })
      expect(requests[0]!.headers.get('idempotency-key')).toBe('send-key-0001')
      careHeaders(requests[0]!)
    })

  it('lists an order’s routes, and withdraws one with its version and a reason', async () => {
    const { requests, orderRoutesApi } = await signedIn({ items: [] })
    await orderRoutesApi.routes('facility-1', PATIENT, ENCOUNTER, 'lab_request', ORDER)
    await orderRoutesApi.withdraw('facility-1', PATIENT, ENCOUNTER, 'prescription', ORDER, { id: ROUTE, version: 2 }, 'sent_in_error')
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([
      ['GET', `${BASE}/lab-requests/${ORDER}/order-routes`],
      ['POST', `${BASE}/prescriptions/${ORDER}/order-routes/${ROUTE}/withdraw`]])
    expect(requests[1]!.body).toEqual({ expectedVersion: 2, reason: 'sent_in_error' })
    expect(requests[1]!.headers.get('idempotency-key')).toBeNull()
    requests.forEach(careHeaders)
  })

  it('lists incoming orders, and finds one patient’s with the Health ID in a POST body, never in the address', async () => {
    const { requests, orderRoutesApi } = await signedIn({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    await orderRoutesApi.incoming('facility-1', 'lab')
    await orderRoutesApi.incoming('facility-1', 'pharmacy', 'HID-7KQ2M9')
    await orderRoutesApi.incoming('facility-1', 'lab', 'HID-7KQ2M9')
    expect(requests.map(request => [request.method, `${request.url.pathname}${request.url.search}`])).toEqual([
      ['GET', '/api/v1/lab/order-routes?view=incoming'],
      ['POST', '/api/v1/pharmacy/order-routes/search'],
      ['POST', '/api/v1/lab/order-routes/search']])
    expect(requests[1]!.body).toEqual({ view: 'incoming', healthId: 'HID-7KQ2M9' })
    expect(requests.every(request => !request.url.href.includes('HID-'))).toBe(true)
    // A search is a POST: it carries the session's CSRF header, and no key (it changes nothing).
    expect(requests[1]!.headers.get('x-csrf-token')).toBe('csrf-1')
    expect(requests[1]!.headers.get('idempotency-key')).toBeNull()
    requests.forEach(careHeaders)
  })

  it('does not repeat a failed search by Health ID', async () => {
    const { requests, orderRoutesApi } = await signedIn({ status: 503, code: 'UPSTREAM_UNAVAILABLE', detail: 'Down' }, 503)
    await expect(orderRoutesApi.incoming('facility-1', 'lab', 'HID-7KQ2M9')).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(1)
  })

  it('accepts with the version, the patient’s identifier and the key; a pharmacy also gives its reason', async () => {
    const { requests, orderRoutesApi } = await signedIn({ route: {}, workItem: {} })
    await orderRoutesApi.accept('facility-1', 'lab', { id: ROUTE, version: 1 }, { kind: 'health_id', value: 'HID-7KQ2M9' },
      'ignored for a laboratory', 'accept-key-1')
    await orderRoutesApi.accept('facility-1', 'pharmacy', { id: ROUTE, version: 1 }, { kind: 'date_of_birth', value: '1985-03-12' },
      'Patient at the counter', 'accept-key-2')
    expect(requests.map(request => [request.method, request.url.pathname, request.headers.get('idempotency-key')])).toEqual([
      ['POST', `/api/v1/lab/order-routes/${ROUTE}/accept`, 'accept-key-1'],
      ['POST', `/api/v1/pharmacy/order-routes/${ROUTE}/accept`, 'accept-key-2']])
    expect(requests[0]!.body).toEqual({ expectedVersion: 1, patientIdentifier: { kind: 'health_id', value: 'HID-7KQ2M9' } })
    expect(requests[1]!.body).toEqual({ expectedVersion: 1, patientIdentifier: { kind: 'date_of_birth', value: '1985-03-12' },
      reason: 'Patient at the counter' })
    requests.forEach(careHeaders)
  })

  it('sends the order’s reference with a date of birth only when it is given', async () => {
    const { requests, orderRoutesApi } = await signedIn({ route: {}, workItem: {} })
    await orderRoutesApi.accept('facility-1', 'lab', { id: ROUTE, version: 3 }, { kind: 'date_of_birth', value: '1985-03-12' },
      undefined, 'accept-key-3', '9C1B2D3E')
    await orderRoutesApi.accept('facility-1', 'pharmacy', { id: ROUTE, version: 3 }, { kind: 'date_of_birth', value: '1985-03-12' },
      'Patient at the counter', 'accept-key-4', '9C1B2D3E')
    await orderRoutesApi.accept('facility-1', 'lab', { id: ROUTE, version: 3 }, { kind: 'date_of_birth', value: '1985-03-12' },
      undefined, 'accept-key-5', undefined)
    expect(requests[0]!.body).toEqual({ expectedVersion: 3, patientIdentifier: { kind: 'date_of_birth', value: '1985-03-12' },
      reference: '9C1B2D3E' })
    expect(requests[1]!.body).toEqual({ expectedVersion: 3, patientIdentifier: { kind: 'date_of_birth', value: '1985-03-12' },
      reason: 'Patient at the counter', reference: '9C1B2D3E' })
    expect(requests[2]!.body).toEqual({ expectedVersion: 3, patientIdentifier: { kind: 'date_of_birth', value: '1985-03-12' } })
    requests.forEach(careHeaders)
  })

  it('declines with the version and a reason', async () => {
    const { requests, orderRoutesApi } = await signedIn({ route: { id: ROUTE, version: 2, effectiveState: 'declined' } })
    await orderRoutesApi.decline('facility-1', 'pharmacy', { id: ROUTE, version: 1 }, 'medicine_unavailable')
    expect(requests[0]!.url.pathname).toBe(`/api/v1/pharmacy/order-routes/${ROUTE}/decline`)
    expect(requests[0]!.body).toEqual({ expectedVersion: 1, reason: 'medicine_unavailable' })
    careHeaders(requests[0]!)
  })
})
