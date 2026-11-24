import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'

/**
 * A patient's Access PIN opens their records for 24 hours, to see and add to (owner, 10 Nov 2026): hid-system's database
 * (0122, live since 17 Nov 2026) gives 1440 minutes whatever is asked. The website asks for 60, which Identity accepts
 * (5 to 1440). It ships only with that backend (the release dependencies pin it): before 0122 a PIN gave 60 minutes of
 * reading only. The scope is Identity's to set, so the request names none.
 */
describe('the Access PIN call', () => {
  it('asks for 60 minutes, which Identity accepts before and after the 24-hour change, at the selected facility', async () => {
    const requests: { url: URL; headers: Headers; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
        body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ accessRequestId: 'request-1', consentGrantId: 'grant-1', patientId: 'patient-1',
        status: 'active', expiresAt: '2026-11-11T10:00:00Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { setStaffSessionReady } = await import('./session')
    setStaffSessionReady(true)
    const { staffApi } = await import('./api')
    await staffApi.verifyPin(FACILITY, ' hid-abc234 ', '4821')
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['POST', '/api/v1/identity/standard-access/pin']])
    expect(requests[0]!.body).toEqual({ hid: 'HID-ABC234', pin: '4821', durationMinutes: 60 })
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
  })
})
