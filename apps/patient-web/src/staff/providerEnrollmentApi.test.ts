import { afterEach, describe, expect, it, vi } from 'vitest'

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
