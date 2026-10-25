import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => vi.unstubAllGlobals())

describe('provider enrollment API', () => {
  it('sends the accountless flow through the registered provider-enrollment routes', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ accepted: true, challengeId: 'challenge-1', verified: true,
        activated: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    // The staff client binds fetch when its module loads, so import after stubbing.
    const { providerEnrollmentApi } = await import('./api')

    await providerEnrollmentApi.start({
      productCode: 'ehr', organizationType: 'clinic', cacRegistrationNumber: 'RC1234567',
      administratorName: 'Ada Admin', administratorEmail: 'admin@example.test',
      turnstileToken: 'siteverify-token',
    })
    await providerEnrollmentApi.verify('challenge-1', '123456')
    await providerEnrollmentApi.activate('long-enough-password')

    expect(requests.map(request => [request.init.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/api/v1/identity/provider-enrollments'],
      ['POST', '/api/v1/identity/provider-enrollments/verify'],
      ['POST', '/api/v1/identity/provider-enrollments/activate'],
    ])
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      productCode: 'ehr', organizationType: 'clinic', cacRegistrationNumber: 'RC1234567',
      administratorName: 'Ada Admin', administratorEmail: 'admin@example.test',
      turnstileToken: 'siteverify-token', turnstileAction: 'provider-enrollment',
    })
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({ challengeId: 'challenge-1', code: '123456' })
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({ password: 'long-enough-password' })
    // Cookies carry the enrollment session; the cross-origin gateway admits no
    // enrollment-specific header, and accountless calls carry no CSRF or bearer.
    for (const request of requests) {
      const headers = new Headers(request.init.headers)
      expect(request.init.credentials).toBe('include')
      expect(headers.has('x-hid-enrollment-challenge')).toBe(false)
      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('x-csrf-token')).toBe(false)
    }
  })
})

/**
 * Facility self sign-up on Novu (P4): the availability read, and a start that
 * may take longer than the client's usual 15 s (Siteverify, then QoreID's token
 * and lookup, then the email code).
 */
describe('provider enrollment API on Novu (P4)', () => {
  // The staff client binds fetch when its module loads: each test loads it afresh, after stubbing.
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.useRealTimers() })

  it('asks whether sign-up is open with one public GET, never repeated, not even after a 404', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET' }),
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    }))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.availability()).rejects.toMatchObject({ status: 404 })
    expect(requests.map(request => [request.init.method, new URL(request.url).pathname]))
      .toEqual([['GET', '/api/v1/identity/provider-enrollments/availability']])
    const headers = new Headers(requests[0]?.init.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('x-csrf-token')).toBe(false)
  })

  it('reads the organization a confirmed sign-up registers with one GET carrying the cookies, never repeated (P4)', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET' }),
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    }))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.profile()).rejects.toMatchObject({ status: 404 })
    expect(requests.map(request => [request.init.method, new URL(request.url).pathname]))
      .toEqual([['GET', '/api/v1/identity/provider-enrollments/profile']])
    // The enrollment cookie (path /api/v1/identity/provider-enrollments) is the only credential.
    expect(requests[0]?.init.credentials).toBe('include')
    const headers = new Headers(requests[0]?.init.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('x-csrf-token')).toBe(false)
  })

  it('answers { open } as Identity says it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ open: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.availability()).resolves.toEqual({ open: false })
  })

  it.each([
    [{ open: false, reason: 'closed' }],
    [{ open: false, reason: 'unavailable' }],
  ])('passes availability’s reason on as Identity says it (P4 round 2): %j', async answer => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer),
      { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.availability()).resolves.toEqual(answer)
  })

  it('passes a start that sent no code on as Identity says it, without a challenge when none can be entered', async () => {
    const answer = { accepted: true, codeSent: false, resendAfterSeconds: 78_660 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer),
      { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.start({ productCode: 'ehr', organizationType: 'hospital',
      cacRegistrationNumber: 'RC1234567', administratorName: 'Ada Admin', administratorEmail: 'admin@example.test',
      turnstileToken: 'siteverify-token' })).resolves.toEqual(answer)
  })

  it('reads what a confirmed sign-up registers: Identity’s six fields (P4 round 2)', async () => {
    const answer = { organizationName: 'IKEJA CARE LIMITED', registrationNumber: 'RC1234567', productCode: 'ehr',
      organizationType: 'hospital', administratorName: 'Ada Admin', administratorEmail: 'admin@example.test' }
    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.profile()).resolves.toEqual(answer)
    expect(requests.map(request => [request.init.method, new URL(request.url).pathname]))
      .toEqual([['GET', '/api/v1/identity/provider-enrollments/profile']])
    expect(requests[0]?.init.body ?? null).toBeNull()
  })

  it('waits about 35 s for a start, not the usual 15 s, and never sends it twice', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url: string | URL | Request, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetch)
    const { providerEnrollmentApi, PROVIDER_ENROLLMENT_START_TIMEOUT_MS } = await import('./api')
    expect(PROVIDER_ENROLLMENT_START_TIMEOUT_MS).toBe(35_000)
    let settled: unknown = null
    const start = providerEnrollmentApi.start({ productCode: 'ehr', organizationType: 'hospital',
      cacRegistrationNumber: 'RC1234567', administratorName: 'Ada Admin', administratorEmail: 'admin@example.test',
      turnstileToken: 'siteverify-token' }).catch(error => { settled = error })
    await vi.advanceTimersByTimeAsync(16_000)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(19_500)
    await start
    expect(settled).toMatchObject({ status: 408, code: 'REQUEST_TIMEOUT' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
