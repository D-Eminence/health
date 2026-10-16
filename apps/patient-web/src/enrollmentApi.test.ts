import { describe, expect, it, vi } from 'vitest'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi } from './api'

interface Request { method: string; path: string; body: unknown; headers: Headers }

/** The patient API over the registered browser client, against a recorded fetch. */
function enrollmentApi(answer: (request: Request) => Response = () => json({})) {
  const requests: Request[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { method: init?.method ?? 'GET', path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined, headers: new Headers(init?.headers) }
    requests.push(request)
    return answer(request)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  return { api, requests }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const BASE = '/api/v1/identity/patient-enrollments'
const CHALLENGE = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'

/**
 * The patient enrollment routes of hid-system main f9dbaf0: the NIN holder step
 * (#84, ADR-062), the facility route (#85, ADR-063) and ADR-061's activation
 * body (#82). Only the start carries an Idempotency-Key.
 */
describe('patient enrollment API', () => {
  it('sends each step to its route, with its body', async () => {
    const { api, requests } = enrollmentApi()
    await api.enrollmentStart('12345678901', 'turnstile-token', 'key-1')
    await api.enrollmentHolderCode()
    await api.enrollmentHolderVerify(CHALLENGE, '123456')
    await api.enrollmentFacilityCode()
    await api.participatingFacilities()
    await api.enrollmentContact('email', 'ada@example.test')
    await api.enrollmentVerify('challenge-1', '654321')
    await api.enrollmentActivate('a-long-enough-password', { dateOfBirth: '1990-02-03', gender: 'female' })
    await api.enrollmentActivate('a-long-enough-password')

    expect(requests.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', BASE, { nin: '12345678901', turnstileAction: 'patient-enrollment', turnstileToken: 'turnstile-token' }],
      ['POST', `${BASE}/holder`, undefined],
      ['POST', `${BASE}/holder/verify`, { challengeId: CHALLENGE, code: '123456' }],
      ['POST', `${BASE}/facility-code`, undefined],
      ['GET', `${BASE}/participating-facilities`, undefined],
      ['POST', `${BASE}/contact`, { channel: 'email', contact: 'ada@example.test' }],
      ['POST', `${BASE}/contact/verify`, { challengeId: 'challenge-1', code: '654321' }],
      ['POST', `${BASE}/activate`, { password: 'a-long-enough-password', dateOfBirth: '1990-02-03', gender: 'female' }],
      ['POST', `${BASE}/activate`, { password: 'a-long-enough-password' }],
    ])
    expect(requests.map(request => request.headers.get('Idempotency-Key'))).toEqual(['key-1', null, null, null, null, null, null, null, null])
  })

  it('reads availability as { open, online, facility }, and an Identity before the holder step as { open }', async () => {
    let answer: unknown = { open: true, online: false, facility: true }
    const { api, requests } = enrollmentApi(() => json(answer))
    expect(await api.enrollmentAvailability()).toEqual({ open: true, online: false, facility: true })
    answer = { open: false }
    expect(await api.enrollmentAvailability()).toEqual({ open: false })
    expect(requests.map(({ method, path }) => [method, path])).toEqual([['GET', `${BASE}/availability`], ['GET', `${BASE}/availability`]])
  })

  it('never sends a step again on its own, an outage included', async () => {
    const { api, requests } = enrollmentApi(() => json({ code: 'ENROLLMENT_UNAVAILABLE', detail: 'Unavailable' }, 503))
    await expect(api.enrollmentHolderCode()).rejects.toMatchObject({ status: 503 })
    await expect(api.enrollmentHolderVerify(CHALLENGE, '123456')).rejects.toMatchObject({ status: 503 })
    await expect(api.enrollmentFacilityCode()).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(3)
  })
})
