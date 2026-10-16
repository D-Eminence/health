import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * The staff API with a session in use and ready, as the provider portal sets it
 * once signed in: protected requests wait for that, and these tests have no portal.
 */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(body: unknown) {
  const requests: Recorded[] = []
  const settle: Array<() => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Promise<Response>(resolve => {
      settle.push(() => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    })
  }))
  return { requests, settleAll: () => { for (const done of settle.splice(0)) done() } }
}

const ENCOUNTER = '/api/v1/ehr/patients/patient-1/encounters/encounter-1'
const ORDER = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'

/**
 * hid-system #56 (lab-requests.controller.ts sendToLab): POST
 * .../lab-requests/:requestId/lab-work-item sends a saved active request to Lab
 * at the version the clinician read. Its body is SendLabRequestToLabDto, exactly
 * { expectedRowVersion } (forbidNonWhitelisted refuses anything else), and it
 * needs an Idempotency-Key.
 */
describe('sending a saved lab request to Lab', () => {
  it('posts only the version read, with the facility, the purpose and the attempt key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const { requests, settleAll } = recordFetch({ id: 'work-item-1' })
    const { staffApi } = await signedInStaffApi()

    const sent = staffApi.sendLabRequestToLab('facility-1', 'patient-1', 'encounter-1', 'request-1', 3, 'send-key-0000000001')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    settleAll()
    await expect(sent).resolves.toEqual({ id: 'work-item-1' })

    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.url.pathname).toBe(`${ENCOUNTER}/lab-requests/request-1/lab-work-item`)
    expect(requests[0]!.body).toEqual({ expectedRowVersion: 3 })
    expect(requests[0]!.headers.get('idempotency-key')).toBe('send-key-0000000001')
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })
})

/**
 * hid-system #51 (lab-executions.controller.ts releasedForEhrOrder): the released
 * Lab results of the work item accepted from one EHR lab request. Each read is
 * audited, and a read made to confirm what is shown must be a request of its own.
 */
describe('released Lab results for a lab request', () => {
  it('reads them by the EHR request, for the facility, and never merges two reads in flight', async () => {
    const { requests, settleAll } = recordFetch({ workItemId: 'work-item-1', sourceEhrOrderId: ORDER, results: [] })
    const { staffApi } = await signedInStaffApi()

    const earlier = staffApi.labReleasedResultsForOrder('facility-1', ORDER)
    const later = staffApi.labReleasedResultsForOrder('facility-1', ORDER)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    settleAll()
    await Promise.all([earlier, later])

    for (const request of requests) {
      expect(request.method).toBe('GET')
      expect(request.url.pathname).toBe(`/api/v1/lab/ehr-orders/${ORDER}/released-results`)
      expect(request.headers.get('x-facility-id')).toBe('facility-1')
      expect(request.headers.get('x-purpose-of-use')).toBe('direct-care')
    }
  })

  it('reads them under the emergency purpose when asked', async () => {
    const { requests, settleAll } = recordFetch({ workItemId: 'work-item-1', sourceEhrOrderId: ORDER, results: [] })
    const { staffApi } = await signedInStaffApi()

    const read = staffApi.labReleasedResultsForOrder('facility-1', ORDER, 'emergency')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    settleAll()
    await read
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('emergency')
  })
})
