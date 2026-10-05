import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../client'
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
