import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HidApiError,
  SESSION_CLIENT_MISMATCH,
  createApiClient,
  isSessionClientMismatch,
  onSessionClientMismatch,
  type ApiClient,
  type SessionClientMismatch,
} from '../index'

/**
 * hid-system #39: Identity reads `X-HID-Client` on a cookie refresh and will not
 * rotate the other Health ID app's sign-in. `staff-web` refreshing a patient
 * sign-in, or `patient-web` a staff one, is answered 403 SESSION_CLIENT_MISMATCH,
 * with nothing rotated and the cookies kept. The header names the app; it proves
 * nothing about who is signed in: Identity reads the sign-in's kind from its own
 * session record.
 */

const REFRESH = 'POST /api/v1/auth/refresh'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = `Refused: ${code}`) =>
  json({ type: 'https://healthidentitydirectory.com/problems/x', title: code, status, detail, code }, status)
const mismatch = () => problem(403, SESSION_CLIENT_MISMATCH,
  'This sign-in belongs to the staff application, not patient-web')
const ok = () => json({ ok: true })

/** Serves each `METHOD /path` its answers in order and records the headers of every request. */
function harness(clientId: string, routes: Record<string, Array<() => Response>>, options: Record<string, unknown> = {}) {
  const calls: Array<{ route: string; headers: Headers }> = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push({ route, headers: new Headers(init?.headers) })
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  })
  const onUnauthorized = vi.fn()
  const client: ApiClient = createApiClient({
    baseUrl: 'https://portal.example.test', clientId, sessionMode: 'cookie',
    fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, onUnauthorized,
    refreshSession: async () => { await client.post('/api/v1/auth/refresh') },
    ...options,
  })
  const named = (route: string) => calls.filter(call => call.route === route).map(call => call.headers.get('X-HID-Client'))
  return { client, calls, onUnauthorized, named }
}

async function refusal(promise: Promise<unknown>): Promise<HidApiError> {
  const error = await promise.then(() => undefined, (failure: unknown) => failure)
  expect(error).toBeInstanceOf(HidApiError)
  return error as HidApiError
}

function listen() {
  const heard: SessionClientMismatch[] = []
  const stop = onSessionClientMismatch(event => { heard.push(event) })
  return { heard, stop }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('naming the app on a cookie refresh', () => {
  it.each(['patient-web', 'staff-web'])('names %s on the refresh and on no other request', async (clientId) => {
    const { client, calls, named } = harness(clientId, {
      [REFRESH]: [ok], 'GET /api/v1/auth/session': [ok], 'POST /api/v1/auth/logout': [ok],
      'POST /api/v1/auth/admin/refresh': [ok], 'POST /api/v1/auth/facility': [ok], 'GET /api/v1/ehr/me/records': [ok],
    })
    await client.post('/api/v1/auth/refresh')
    await client.get('/api/v1/auth/session')
    await client.post('/api/v1/auth/logout')
    await client.post('/api/v1/auth/admin/refresh')
    await client.post('/api/v1/auth/facility', { facilityId: 'f' })
    await client.get('/api/v1/ehr/me/records')
    expect(named(REFRESH)).toEqual([clientId])
    // No other service's CORS allow-list admits the header: it must never leave on another route.
    expect(calls.filter(call => call.route !== REFRESH).map(call => call.headers.has('X-HID-Client')))
      .toEqual([false, false, false, false, false])
  })

  it('names the app on the refresh made for a protected request, not on that request or its repeat', async () => {
    const { client, calls } = harness('patient-web', {
      'GET /api/v1/identity/me': [() => problem(401, 'AUTHENTICATION_REQUIRED'), ok], [REFRESH]: [ok],
    })
    await client.get('/api/v1/identity/me')
    expect(calls.map(call => [call.route, call.headers.get('X-HID-Client')])).toEqual([
      ['GET /api/v1/identity/me', null], [REFRESH, 'patient-web'], ['GET /api/v1/identity/me', null],
    ])
  })

  it('never names the app on a read retried after a server error', async () => {
    const { client, calls } = harness('staff-web', { 'GET /api/v1/ehr/me/records': [() => problem(503, 'UPSTREAM_UNAVAILABLE'), ok] })
    await client.get('/api/v1/ehr/me/records')
    expect(calls.map(call => call.headers.has('X-HID-Client'))).toEqual([false, false])
  })

  it('names the app on a refresh from a page on the gateway origin', async () => {
    vi.stubGlobal('location', { origin: 'https://portal.example.test' })
    const { client, named } = harness('patient-web', { [REFRESH]: [ok] })
    await client.post('/api/v1/auth/refresh')
    expect(named(REFRESH)).toEqual(['patient-web'])
  })

  it('does not name the app on a refresh from a page on another origin, so a gateway without #39 keeps refreshing', async () => {
    // A cross-origin refresh carrying the header is preflighted, and Identity's
    // allow-list admits it only from hid-system #39. Without the header,
    // Identity refreshes as before #39.
    vi.stubGlobal('location', { origin: 'https://app.example.test' })
    const { client, named } = harness('staff-web', {
      'GET /api/v1/identity/me': [() => problem(401, 'AUTHENTICATION_REQUIRED'), ok], [REFRESH]: [ok, ok],
    })
    await client.post('/api/v1/auth/refresh')
    await client.get('/api/v1/identity/me')
    expect(named(REFRESH)).toEqual([null, null])
  })

  it('keeps naming the app on every request of a bearer client, as before', async () => {
    const { client, calls } = harness('admin-web', { 'GET /api/v1/identity/me': [ok] },
      { sessionMode: 'bearer', getAccessToken: () => 'token', refreshSession: undefined })
    await client.get('/api/v1/identity/me')
    expect(calls[0]?.headers.get('X-HID-Client')).toBe('admin-web')
  })
})

describe('a refresh refused because the sign-in belongs to the other app', () => {
  it('rejects the protected request with the mismatch, never repeats it, never reports a 401, and tells listeners once', async () => {
    const { heard, stop } = listen()
    const { client, calls, onUnauthorized } = harness('patient-web', {
      'GET /api/v1/identity/me': [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [mismatch],
    })
    const error = await refusal(client.get('/api/v1/identity/me'))
    stop()
    expect([error.status, error.code, error.retryable]).toEqual([403, SESSION_CLIENT_MISMATCH, false])
    expect(isSessionClientMismatch(error)).toBe(true)
    expect(calls.map(call => call.route)).toEqual(['GET /api/v1/identity/me', REFRESH])
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(heard).toHaveLength(1)
    expect(heard[0]?.clientId).toBe('patient-web')
    expect(heard[0]?.error.code).toBe(SESSION_CLIENT_MISMATCH)
  })

  it('shares one refresh between concurrent requests: both get the mismatch, listeners hear it once', async () => {
    const { heard, stop } = listen()
    const { client, calls } = harness('staff-web', {
      'GET /api/v1/identity/access-requests': [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      'GET /api/v1/audit/events': [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      [REFRESH]: [mismatch],
    })
    const [first, second] = await Promise.all([
      refusal(client.get('/api/v1/identity/access-requests')), refusal(client.get('/api/v1/audit/events')),
    ])
    stop()
    expect([first.code, second.code]).toEqual([SESSION_CLIENT_MISMATCH, SESSION_CLIENT_MISMATCH])
    expect(calls.filter(call => call.route === REFRESH)).toHaveLength(1)
    expect(heard.map(event => event.clientId)).toEqual(['staff-web'])
  })

  it('tells listeners about a refresh the app makes itself (the provider portal on open)', async () => {
    const { heard, stop } = listen()
    const { client } = harness('staff-web', { [REFRESH]: [mismatch] })
    const error = await refusal(client.post('/api/v1/auth/refresh'))
    stop()
    expect(isSessionClientMismatch(error)).toBe(true)
    expect(heard.map(event => event.clientId)).toEqual(['staff-web'])
  })

  it('keeps an ordinary expiry as before: a refused refresh 401 reports the original 401 and is no mismatch', async () => {
    const { heard, stop } = listen()
    const { client, onUnauthorized } = harness('patient-web', {
      'GET /api/v1/identity/me': [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(401, 'AUTHENTICATION_REQUIRED')],
    })
    const error = await refusal(client.get('/api/v1/identity/me'))
    stop()
    expect(error.status).toBe(401)
    expect(onUnauthorized).toHaveBeenCalled()
    expect(isSessionClientMismatch(error)).toBe(false)
    expect(heard).toEqual([])
  })

  it('is no mismatch when the refresh is refused for another reason (CSRF)', async () => {
    const { heard, stop } = listen()
    const { client } = harness('patient-web', {
      'GET /api/v1/identity/me': [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')],
    })
    const error = await refusal(client.get('/api/v1/identity/me'))
    stop()
    expect([error.status, error.code]).toEqual([403, 'CSRF_VALIDATION_FAILED'])
    expect(isSessionClientMismatch(error)).toBe(false)
    expect(heard).toEqual([])
  })

  it('is no mismatch when another route answers with the same code', async () => {
    const { heard, stop } = listen()
    const { client } = harness('patient-web', { 'POST /api/v1/auth/logout': [mismatch] })
    await refusal(client.post('/api/v1/auth/logout'))
    stop()
    expect(heard).toEqual([])
  })

  it('fails the refresh with the mismatch even when a listener throws, and still tells the others', async () => {
    const stopFaulty = onSessionClientMismatch(() => { throw new Error('listener bug') })
    const { heard, stop } = listen()
    const { client } = harness('patient-web', { [REFRESH]: [mismatch] })
    const error = await refusal(client.post('/api/v1/auth/refresh'))
    stopFaulty(); stop()
    expect(isSessionClientMismatch(error)).toBe(true)
    expect(heard).toHaveLength(1)
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const { heard, stop } = listen()
    stop()
    const { client } = harness('patient-web', { [REFRESH]: [mismatch] })
    await refusal(client.post('/api/v1/auth/refresh'))
    expect(heard).toEqual([])
  })
})

describe('isSessionClientMismatch', () => {
  it('matches only a 403 carrying the code', () => {
    expect(isSessionClientMismatch(new HidApiError(403, 'x', { code: SESSION_CLIENT_MISMATCH }))).toBe(true)
    expect(isSessionClientMismatch(new HidApiError(401, 'x', { code: SESSION_CLIENT_MISMATCH }))).toBe(false)
    expect(isSessionClientMismatch(new HidApiError(403, 'x', { code: 'CSRF_VALIDATION_FAILED' }))).toBe(false)
    expect(isSessionClientMismatch(Object.assign(new Error('x'), { status: 403, code: SESSION_CLIENT_MISMATCH }))).toBe(false)
    expect(isSessionClientMismatch(undefined)).toBe(false)
  })
})
