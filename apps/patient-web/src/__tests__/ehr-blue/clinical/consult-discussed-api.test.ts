import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The client binds fetch when it is first made, so each test loads the modules afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/**
 * "Discussed with the patient"'s three lab-api routes (hid-system #177) on the staff portal's registered HTTP client:
 * the paths, headers and bodies lab-api reads, and a 404 or 403 on the list read as "not offered". Fictional ids.
 */
const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const RESULT = 'b0000000-0000-4000-8000-000000000002'
const KEY = 'd0000000-0000-4000-8000-000000000003'

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status < 400 ? 'application/json' : 'application/problem+json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function discussedApi() {
  const { setStaffSessionReady } = await import('../../../staff/session')
  setStaffSessionReady(true)
  return (await import('../../../ehr-blue/clinical/consult/orders/discussedApi')).discussedApi
}

const problem = (status: number, code: string) => ({ type: 'about:blank', title: code, status, code, detail: code })

function sent(fetch: ReturnType<typeof stubFetch>) {
  const [url, init] = fetch.mock.calls[0]!
  const headers = new Headers(init?.headers)
  return { method: init?.method, path: new URL(String(url)).pathname, headers, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined }
}

describe('the result-discussion routes', () => {
  it('reads the patient’s held results under direct care at the facility', async () => {
    const fetch = stubFetch(200, { results: [{ resultId: RESULT, resultVersion: 2, test: { codeSystem: null, code: null, name: 'Sample' },
      releasedAt: '2026-11-03T10:00:00.000Z', gate: { sensitive: true, critical: false }, finishedVisit: true, discussion: null,
      visibleToPatient: false }], truncated: false })
    const answer = await (await discussedApi()).list(FACILITY, PATIENT)
    expect(answer?.results.get(RESULT)).toMatchObject({ resultVersion: 2, discussion: null, visibleToPatient: false })
    const request = sent(fetch)
    expect(request.method).toBe('GET')
    expect(request.path).toBe(`/api/v1/lab/patients/${PATIENT}/result-discussions`)
    expect(request.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(request.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  })

  it.each([
    ['the gateway’s 404 (not served)', 404, 'API_ROUTE_NOT_FOUND'],
    ['a plain 404', 404, 'NOT_FOUND'],
    ['403 PERMISSION_DENIED', 403, 'PERMISSION_DENIED'],
    ['403 PATIENT_ACCESS_DENIED', 403, 'PATIENT_ACCESS_DENIED'],
  ])('answers no list for %s, so nothing is offered', async (_, status, code) => {
    stubFetch(status, problem(status, code))
    await expect((await discussedApi()).list(FACILITY, PATIENT)).resolves.toBeNull()
  })

  it('marks the version shown, with the Idempotency-Key given', async () => {
    const fetch = stubFetch(201, { resultId: RESULT, resultVersion: 2, state: 'discussed', eventNo: 4, discussedAt: '2026-11-04T09:30:00.000Z',
      visibleToPatient: true, replayed: false })
    const answer = await (await discussedApi()).mark(FACILITY, PATIENT, RESULT, 2, KEY)
    expect(answer).toEqual({ resultId: RESULT, resultVersion: 2, state: 'discussed', eventNo: 4, at: '2026-11-04T09:30:00.000Z', visibleToPatient: true })
    const request = sent(fetch)
    expect(request.method).toBe('POST')
    expect(request.path).toBe(`/api/v1/lab/patients/${PATIENT}/results/${RESULT}/discussion`)
    expect(request.body).toEqual({ resultVersion: 2 })
    expect(request.headers.get('Idempotency-Key')).toBe(KEY)
    expect(request.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(request.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  })

  it('withdraws with the version, the reason code and the reason, with the Idempotency-Key given', async () => {
    const fetch = stubFetch(200, { resultId: RESULT, resultVersion: 2, state: 'withdrawn', eventNo: 5, withdrawnAt: '2026-11-04T11:00:00.000Z',
      visibleToPatient: false, replayed: false })
    const answer = await (await discussedApi()).withdraw(FACILITY, PATIENT, RESULT, 2, 'not_yet_discussed', 'Patient left before we spoke', KEY)
    expect(answer).toMatchObject({ state: 'withdrawn', at: '2026-11-04T11:00:00.000Z', visibleToPatient: false })
    const request = sent(fetch)
    expect(request.method).toBe('POST')
    expect(request.path).toBe(`/api/v1/lab/patients/${PATIENT}/results/${RESULT}/discussion/withdrawal`)
    expect(request.body).toEqual({ resultVersion: 2, reasonCode: 'not_yet_discussed', reason: 'Patient left before we spoke' })
    expect(request.headers.get('Idempotency-Key')).toBe(KEY)
  })

  it('throws a refused mark with its status and code, for the screen to say in words', async () => {
    stubFetch(409, problem(409, 'RESULT_VERSION_CHANGED'))
    await expect((await discussedApi()).mark(FACILITY, PATIENT, RESULT, 1, KEY)).rejects.toMatchObject({ status: 409, code: 'RESULT_VERSION_CHANGED' })
  })
})
