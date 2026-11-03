import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LabResult } from './api'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/** The staff API with a session in use and ready, as the provider portal sets it once signed in. */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(answer: unknown = {}, status = 200) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  return requests
}

const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const result = (overrides: Partial<LabResult> = {}): LabResult => ({ id: 'result-1', executionId: 'execution-1',
  status: 'entered_unverified', verificationStatus: 'unverified', currentVersion: 3, currentReleasedVersion: null, revisions: [], ...overrides })

/** One-person lab (owner decision 33.3, hid-system 0111): the facility switch, and the self-check on verify. */
describe('the facility’s One-person lab switch', () => {
  it('reads the facility settings with the facility and healthcare-operations purpose', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const settings = { onePersonLab: { enabled: false, changedAt: null, changedByName: null, reason: null } }
    const requests = recordFetch(settings)
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.facilitySettings(FACILITY)).resolves.toEqual(settings)
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['GET', '/api/v1/identity/facility-settings']])
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
  })

  it('switches it with exactly Identity’s body, the facility, healthcare operations and the CSRF token', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ enabled: true, changedAt: '2026-11-03T10:00:00.000Z', settingId: 'setting-1' })
    const { staffApi } = await signedInStaffApi()
    await staffApi.setOnePersonLab(FACILITY, true, 'Only one scientist works here')
    expect(requests.map(request => [request.method, request.url.pathname, request.body])).toEqual([
      ['POST', '/api/v1/identity/facility-settings/one-person-lab', { enabled: true, reason: 'Only one scientist works here' }]])
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
    expect(requests[0]!.headers.get('x-csrf-token')).toBe('csrf-1')
  })
})

describe('verifying a lab result', () => {
  it('sends today’s body for an ordinary check', async () => {
    const requests = recordFetch(result())
    const { staffApi } = await signedInStaffApi()
    await staffApi.verifyLabResult(FACILITY, result({ onePersonLab: true }), 'Independent review')
    expect(requests[0]!.url.pathname).toBe('/api/v1/lab/results/result-1/verify')
    expect(Object.keys(requests[0]!.body as object).sort()).toEqual(['expectedResultVersion', 'occurredAt', 'reason'])
    expect(requests[0]!.body).toMatchObject({ expectedResultVersion: 3, reason: 'Independent review' })
  })

  it('sends selfCheck: true and the reason exactly as typed for a self-check at a one-person lab', async () => {
    const requests = recordFetch(result())
    const { staffApi } = await signedInStaffApi()
    await staffApi.verifyLabResult(FACILITY, result({ onePersonLab: true }), '  Only scientist on duty  ', { selfCheck: true })
    expect(requests[0]!.body).toMatchObject({ expectedResultVersion: 3, reason: '  Only scientist on duty  ', selfCheck: true })
  })

  it.each([['off', false], ['absent (an image before 0111)', undefined]])('never sends selfCheck when the read says onePersonLab is %s', async (_, onePersonLab) => {
    const requests = recordFetch(result())
    const { staffApi } = await signedInStaffApi()
    await staffApi.verifyLabResult(FACILITY, result(onePersonLab === undefined ? {} : { onePersonLab }), 'Only scientist on duty', { selfCheck: true })
    expect(requests[0]!.body).not.toHaveProperty('selfCheck')
  })

  it('keeps release’s old body', async () => {
    const requests = recordFetch(result())
    const { staffApi } = await signedInStaffApi()
    await staffApi.releaseLabResult(FACILITY, result({ onePersonLab: true, status: 'verified_not_released' }), 'Ready')
    expect(Object.keys(requests[0]!.body as object).sort()).toEqual(['expectedResultVersion', 'occurredAt', 'reason'])
  })
})
