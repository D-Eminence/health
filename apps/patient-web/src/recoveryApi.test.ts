import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPrincipalRecoveryApi } from './recoveryApi'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => vi.unstubAllGlobals())

describe('principal recovery API', () => {
  it.each(['staff', 'admin'] as const)('sends %s recovery through registered public OTP routes', async audience => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ accepted: true, challengeId: 'challenge-1',
        verificationToken: 'verification-token', completed: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }))
    const api = createPrincipalRecoveryApi(audience)

    await api.start('clinician@example.test', 'siteverify-token')
    await api.verify('challenge-1', '123456')
    await api.complete('challenge-1', 'verification-token', 'long-enough-password')

    expect(requests.map(request => new URL(request.url).pathname)).toEqual([
      '/api/v1/auth/otp/start', '/api/v1/auth/otp/verify', '/api/v1/auth/otp/complete',
    ])
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      identifier: 'clinician@example.test', purpose: 'PASSWORD_RESET',
      turnstileToken: 'siteverify-token', turnstileAction: `${audience}-reset`,
    })
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      challengeId: 'challenge-1', purpose: 'PASSWORD_RESET', code: '123456',
    })
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({
      challengeId: 'challenge-1', purpose: 'PASSWORD_RESET',
      verificationToken: 'verification-token', newPassword: 'long-enough-password',
    })
    expect(requests.every(request => request.init.credentials === 'include')).toBe(true)
  })
})
