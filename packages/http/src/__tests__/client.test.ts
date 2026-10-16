import { describe, expect, it, vi } from 'vitest'
import { createApiClient, retryAfterSeconds } from '../client'
import { HidApiError } from '../errors'
import type { ApiClientOptions } from '../client'

const BASE_URL = 'https://gateway.staging.example/api'

interface StubResponse {
  status?: number
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
}

/** Statuses the Response constructor requires to carry a null body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

function jsonResponse({ status = 200, body, rawBody, headers = {} }: StubResponse): Response {
  const text = rawBody ?? (body === undefined ? '' : JSON.stringify(body))
  return new Response(NULL_BODY_STATUSES.has(status) ? null : text, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A fetch stub that replays a queue of responses and records every call. */
function stubFetch(responses: StubResponse[]) {
  const calls: { url: string; init: RequestInit }[] = []
  let index = 0

  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (next instanceof Error) throw next
    return jsonResponse(next ?? {})
  })

  return { impl: impl as unknown as typeof fetch, calls }
}

function makeClient(overrides: Partial<ApiClientOptions> = {}, responses: StubResponse[] = [{ body: { ok: true } }]) {
  const fetchStub = stubFetch(responses)
  const client = createApiClient({
    baseUrl: BASE_URL,
    clientId: 'test-web',
    fetchImpl: fetchStub.impl,
    sleep: async () => {},
    random: () => 1,
    ...overrides,
  })
  return { client, calls: fetchStub.calls, fetchImpl: fetchStub.impl }
}

describe('createApiClient: request construction', () => {
  it('joins the configured base URL with the endpoint path', async () => {
    const { client, calls } = makeClient()
    await client.get('/patients-me', { auth: 'none' })

    expect(calls[0]?.url).toBe(`${BASE_URL}/patients-me`)
  })

  it('tolerates a base URL with a trailing slash and a path without a leading one', async () => {
    const { client, calls } = makeClient({ baseUrl: `${BASE_URL}/` })
    await client.get('patients-me', { auth: 'none' })

    expect(calls[0]?.url).toBe(`${BASE_URL}/patients-me`)
  })

  it('serialises query parameters and drops empty ones', async () => {
    const { client, calls } = makeClient()
    await client.get('/patients-records', {
      auth: 'none',
      query: { limit: 20, cursor: undefined, filter: null, q: '' },
    })

    expect(calls[0]?.url).toBe(`${BASE_URL}/patients-records?limit=20`)
  })

  it('sets correlation and client headers on every call', async () => {
    const { client, calls } = makeClient()
    await client.get('/health-check', { auth: 'none' })

    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('X-Request-ID')).toMatch(/^hid_web_/)
    expect(headers.get('X-HID-Client')).toBe('test-web')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('never lets the browser cache or attach cookies to a clinical call', async () => {
    const { client, calls } = makeClient()
    await client.get('/patients-records', { auth: 'none' })

    expect(calls[0]?.init.cache).toBe('no-store')
    expect(calls[0]?.init.credentials).toBe('omit')
  })
})

describe('createApiClient: authentication', () => {
  it('attaches the bearer token when one is available', async () => {
    const { client, calls } = makeClient({ getAccessToken: () => 'token-abc' })
    await client.get('/patients-me')

    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer token-abc')
  })

  it('fails fast without a round trip when auth is required and absent', async () => {
    const { client, calls } = makeClient({ getAccessToken: () => null })

    await expect(client.get('/patients-me')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(calls).toHaveLength(0)
  })

  it('proceeds without a token when auth is optional', async () => {
    const { client, calls } = makeClient({ getAccessToken: () => null })
    await client.get('/pricing', { auth: 'optional' })

    expect(new Headers(calls[0]?.init.headers).has('Authorization')).toBe(false)
  })

  it('never sends a token to a public endpoint', async () => {
    const { client, calls } = makeClient({ getAccessToken: () => 'token-abc' })
    await client.post('/patient-login', { identifier: 'x' }, { auth: 'none' })

    expect(new Headers(calls[0]?.init.headers).has('Authorization')).toBe(false)
  })

  it('notifies the application once on a 401 and still rejects', async () => {
    const onUnauthorized = vi.fn()
    const { client } = makeClient(
      { getAccessToken: () => 'stale', onUnauthorized },
      [{ status: 401, body: { message: 'Session expired.', code: 'TOKEN_EXPIRED' } }],
    )

    await expect(client.get('/patients-me')).rejects.toBeInstanceOf(HidApiError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onUnauthorized.mock.calls[0]?.[0]).toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' })
  })
})

describe('createApiClient: responses', () => {
  it('unwraps a { data } envelope', async () => {
    const { client } = makeClient({}, [{ body: { data: { hidCode: 'HID-1' } } }])
    await expect(client.get('/patients-me', { auth: 'none' })).resolves.toEqual({ hidCode: 'HID-1' })
  })

  it('returns a bare payload untouched', async () => {
    const { client } = makeClient({}, [{ body: { records: [] } }])
    await expect(client.get('/patients-records', { auth: 'none' })).resolves.toEqual({ records: [] })
  })

  it('resolves to undefined on 204', async () => {
    const { client } = makeClient({}, [{ status: 204 }])
    await expect(client.get('/notifications-list', { auth: 'none' })).resolves.toBeUndefined()
  })

  it('rejects an unparseable success body rather than passing junk to the UI', async () => {
    const { client } = makeClient({}, [{ rawBody: '<html>gateway error</html>' }])
    await expect(client.get('/patients-me', { auth: 'none' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
})

describe('createApiClient: errors', () => {
  it('surfaces the backend error envelope verbatim', async () => {
    const { client } = makeClient({}, [
      {
        status: 403,
        body: {
          message: 'You do not have permission to perform this action.',
          code: 'FORBIDDEN_ROLE',
          requestId: 'hid_abc123',
          retryable: false,
        },
      },
    ])

    await expect(client.get('/admin-billing', { auth: 'none' })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN_ROLE',
      requestId: 'hid_abc123',
      retryable: false,
    })
  })

  it('falls back to a safe message when the backend sends transport noise', async () => {
    const { client } = makeClient({}, [{ status: 500, body: { message: 'Internal Server Error' } }])

    await expect(client.get('/staff-dashboard', { auth: 'none' })).rejects.toMatchObject({
      message: 'The service is temporarily unavailable. Please try again shortly.',
    })
  })

  it('reads the request id from the response header when the body omits it', async () => {
    const { client } = makeClient({}, [
      { status: 404, body: { message: 'Not found.' }, headers: { 'X-Request-ID': 'hid_header_1' } },
    ])

    await expect(client.get('/patients-records', { auth: 'none' })).rejects.toMatchObject({
      requestId: 'hid_header_1',
    })
  })

  it('reports an unreachable gateway as a retryable network error', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const client = createApiClient({
      baseUrl: BASE_URL,
      clientId: 'test-web',
      fetchImpl: failing as unknown as typeof fetch,
      sleep: async () => {},
    })

    await expect(client.post('/records-create', {}, { auth: 'none' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: true,
    })
  })
})

describe('createApiClient: cancellation', () => {
  it('reports caller cancellation as a non-retryable cancellation error', async () => {
    const controller = new AbortController()
    const client = createApiClient({
      baseUrl: BASE_URL,
      clientId: 'test-web',
      fetchImpl: (async () => {
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      }) as unknown as typeof fetch,
      sleep: async () => {},
    })

    const promise = client.get('/patients-records', { auth: 'none', signal: controller.signal })
    await expect(promise).rejects.toMatchObject({ code: 'REQUEST_CANCELLED', retryable: false })
  })

  it('turns an exceeded time budget into a timeout error', async () => {
    const client = createApiClient({
      baseUrl: BASE_URL,
      clientId: 'test-web',
      timeoutMs: 5,
      sleep: async () => {},
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })) as unknown as typeof fetch,
    })

    await expect(client.get('/patients-records', { auth: 'none', retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } })).rejects.toMatchObject({
      status: 408,
      code: 'REQUEST_TIMEOUT',
    })
  })
})

describe('createApiClient: retries and deduplication', () => {
  it('retries a failed read and returns the eventual success', async () => {
    const { client, calls } = makeClient({}, [
      { status: 503, body: { message: 'Service unavailable.' } },
      { body: { data: { ok: true } } },
    ])

    await expect(client.get('/staff-dashboard', { auth: 'none' })).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('never retries a write', async () => {
    const { client, calls } = makeClient({}, [{ status: 503, body: { message: 'Service unavailable.' } }])

    await expect(client.post('/records-create', { title: 'x' }, { auth: 'none' })).rejects.toMatchObject({
      status: 503,
    })
    expect(calls).toHaveLength(1)
  })

  it('does not retry a client error', async () => {
    const { client, calls } = makeClient({}, [{ status: 400, body: { message: 'Bad input.' } }])

    await expect(client.get('/patients-records', { auth: 'none' })).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(1)
  })

  it('collapses concurrent identical reads into one request', async () => {
    const { client, calls } = makeClient({}, [{ body: { data: { ok: true } } }])

    const [first, second] = await Promise.all([
      client.get('/patients-me', { auth: 'none' }),
      client.get('/patients-me', { auth: 'none' }),
    ])

    expect(calls).toHaveLength(1)
    expect(first).toEqual(second)
  })

  function pendingFetch() {
    const calls: RequestInit[] = []
    let release: (response: Response) => void = () => undefined
    const impl = ((_url: string, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Promise<Response>((resolve, reject) => {
        release = resolve
        if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }) as unknown as typeof fetch
    return { calls, impl, release: (response: Response) => release(response) }
  }

  it('keeps a shared read alive for a caller that did not cancel', async () => {
    // A remounted component (for example under React StrictMode) cancels the
    // first read and immediately asks again for the same data.
    const fetch = pendingFetch()
    const client = createApiClient({ baseUrl: BASE_URL, clientId: 'test-web', fetchImpl: fetch.impl, sleep: async () => {} })
    const first = new AbortController()
    const firstRead = client.get('/patients-me', { auth: 'none', signal: first.signal })
    const secondRead = client.get('/patients-me', { auth: 'none', signal: new AbortController().signal })
    await vi.waitFor(() => expect(fetch.calls).toHaveLength(1))
    first.abort()
    await expect(firstRead).rejects.toMatchObject({ code: 'REQUEST_CANCELLED', retryable: false })
    fetch.release(jsonResponse({ body: { data: { ok: true } } }))
    await expect(secondRead).resolves.toEqual({ ok: true })
    expect(fetch.calls).toHaveLength(1)
  })

  it('starts afresh for a caller that asks again right after the only caller cancelled', async () => {
    // React StrictMode runs an effect, its cleanup, then the effect again.
    const fetch = pendingFetch()
    const client = createApiClient({ baseUrl: BASE_URL, clientId: 'test-web', fetchImpl: fetch.impl, sleep: async () => {} })
    const first = new AbortController()
    const firstRead = client.get('/patients-me', { auth: 'none', signal: first.signal })
    first.abort()
    const secondRead = client.get('/patients-me', { auth: 'none', signal: new AbortController().signal })
    await expect(firstRead).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    await vi.waitFor(() => expect(fetch.calls).toHaveLength(2))
    fetch.release(jsonResponse({ body: { data: { ok: true } } }))
    await expect(secondRead).resolves.toEqual({ ok: true })
    expect(fetch.calls[0]?.signal?.aborted).toBe(true)
  })

  it('cancels a shared read once every caller has cancelled', async () => {
    const fetch = pendingFetch()
    const client = createApiClient({ baseUrl: BASE_URL, clientId: 'test-web', fetchImpl: fetch.impl, sleep: async () => {} })
    const first = new AbortController()
    const second = new AbortController()
    const reads = [client.get('/patients-me', { auth: 'none', signal: first.signal }),
      client.get('/patients-me', { auth: 'none', signal: second.signal })]
    await vi.waitFor(() => expect(fetch.calls).toHaveLength(1))
    first.abort()
    expect(fetch.calls[0]?.signal?.aborted).toBe(false)
    second.abort()
    for (const read of reads) await expect(read).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(fetch.calls[0]?.signal?.aborted).toBe(true)
    // A later read starts a fresh request.
    const later = client.get('/patients-me', { auth: 'none' })
    await vi.waitFor(() => expect(fetch.calls).toHaveLength(2))
    fetch.release(jsonResponse({ body: { data: { fresh: true } } }))
    await expect(later).resolves.toEqual({ fresh: true })
    expect(fetch.calls).toHaveLength(2)
  })

  it('keeps different queries separate', async () => {
    const { client, calls } = makeClient({}, [{ body: { data: {} } }])

    await Promise.all([
      client.get('/patients-records', { auth: 'none', query: { page: 1 } }),
      client.get('/patients-records', { auth: 'none', query: { page: 2 } }),
    ])

    expect(calls).toHaveLength(2)
  })

  it('does not deduplicate writes', async () => {
    const { client, calls } = makeClient({}, [{ body: { data: {} } }])

    await Promise.all([
      client.post('/records-create', { title: 'a' }, { auth: 'none' }),
      client.post('/records-create', { title: 'a' }, { auth: 'none' }),
    ])

    expect(calls).toHaveLength(2)
  })
})

describe('retryAfterSeconds', () => {
  // A wait the server names, such as a code's resend cooldown, is the caller's to show;
  // the error itself stays without it (the retry loop's own bookkeeping).
  it('gives the Retry-After of a refused request, in seconds', async () => {
    const { client } = makeClient({}, [{ status: 429, body: { code: 'OTP_RESEND_COOLDOWN', message: 'Wait.' }, headers: { 'Retry-After': '42' } }])
    const error = await client.post('/codes', undefined, { auth: 'none' }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(HidApiError)
    expect(retryAfterSeconds(error)).toBe(42)
    expect(Object.keys(error as object)).not.toContain('retryAfter')
  })

  it('is null without the header, for an error the client did not make, and for anything else', async () => {
    const { client } = makeClient({}, [{ status: 429, body: { message: 'Slow down.' } }])
    const error = await client.post('/codes', undefined, { auth: 'none' }).catch((reason: unknown) => reason)
    expect(retryAfterSeconds(error)).toBeNull()
    expect(retryAfterSeconds(new HidApiError(429, 'Slow down.'))).toBeNull()
    expect(retryAfterSeconds(new Error('no'))).toBeNull()
    expect(retryAfterSeconds(undefined)).toBeNull()
  })
})

describe('beforeAttempt', () => {
  it('runs before every attempt, the retries after a backoff included', async () => {
    const order: string[] = []
    const { client, fetchImpl } = makeClient({}, [{ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } }, { body: { ok: true } }])
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push('fetch-1')
      return jsonResponse({ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } })
    }).mockImplementationOnce(async () => {
      order.push('fetch-2')
      return jsonResponse({ body: { ok: true } })
    })

    await expect(client.get('/records', { auth: 'none', beforeAttempt: async () => { order.push('before') } })).resolves.toEqual({ ok: true })
    expect(order).toEqual(['before', 'fetch-1', 'before', 'fetch-2'])
  })

  it('ends the request without sending it when it rejects, and does not retry', async () => {
    const { client, calls } = makeClient()
    const stopped = new HidApiError(0, 'Stopped', { code: 'REQUEST_CANCELLED', retryable: false })

    await expect(client.get('/records', { auth: 'none', beforeAttempt: async () => { throw stopped } })).rejects.toBe(stopped)
    expect(calls).toHaveLength(0)
  })
})

describe('beforeAttempt and the CSRF token', () => {
  it('reads the CSRF token after the wait, so a token rotated meanwhile is the one sent', async () => {
    let csrf = 'token-before'
    const { client, calls } = makeClient({ sessionMode: 'cookie', getCsrfToken: () => csrf })
    await client.post('/records-create', { a: 1 }, { auth: 'none', beforeAttempt: async () => { csrf = 'token-after' } })
    expect(new Headers(calls[0]!.init.headers).get('X-CSRF-Token')).toBe('token-after')
  })
})
