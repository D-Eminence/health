import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../client'
import { uploadPresignedObject } from '../upload'

afterEach(() => vi.unstubAllGlobals())

function harness(responses: Response[], options: Record<string, unknown> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return responses.shift() ?? new Response(JSON.stringify({ ok: true }))
  })
  const client = createApiClient({ baseUrl: 'https://api.example.org', clientId: 'patient-web',
    sessionMode: 'cookie', fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {}, ...options })
  return { client, calls }
}

describe('hid-system cookie transport', () => {
  it('sends cookie credentials and only CORS-allowed transport headers', async () => {
    const { client, calls } = harness([new Response(JSON.stringify({ actor: { id: 'id' } }))])
    await client.get('/api/v1/auth/session')
    const headers = new Headers(calls[0]?.init.headers)
    expect(calls[0]?.init.credentials).toBe('include')
    expect(calls[0]?.init.cache).toBe('no-store')
    expect(headers.get('X-Correlation-ID')).toMatch(/^hid_web_/)
    expect(headers.has('X-Request-ID')).toBe(false)
    expect(headers.has('X-HID-Client')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
  })

  it('reads CSRF cookie for writes and does not add it to reads', async () => {
    vi.stubGlobal('document', { cookie: 'other=1; hid_access_csrf=csrf-value' })
    const { client, calls } = harness([new Response('{}'), new Response('{}')])
    await client.get('/api/v1/identity/me')
    await client.post('/api/v1/identity/me/access-pin', { pin: '123456' })
    expect(new Headers(calls[0]?.init.headers).has('X-CSRF-Token')).toBe(false)
    expect(new Headers(calls[1]?.init.headers).get('X-CSRF-Token')).toBe('csrf-value')
  })

  it('uses the response CSRF token when no readable cookie is available', async () => {
    const { client, calls } = harness([
      new Response('{}', { headers: { 'X-CSRF-Token': 'bootstrap-csrf' } }),
      new Response('{}'),
    ])
    await client.get('/api/v1/auth/session')
    await client.request({ method: 'DELETE', path: '/api/v1/identity/me/access-pin' })
    expect(new Headers(calls[1]?.init.headers).get('X-CSRF-Token')).toBe('bootstrap-csrf')
  })

  it('restores an expired access cookie once and retries the protected read', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([
      new Response('{}', { status: 401 }),
      new Response(JSON.stringify({ actor: { kind: 'patient' } }), { headers: { 'X-CSRF-Token': 'rotated' } }),
      new Response(JSON.stringify({ patientId: 'patient-1' })),
    ], { refreshSession })
    await expect(fixture.client.get('/api/v1/identity/me')).resolves.toEqual({ patientId: 'patient-1' })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(fixture.calls.map(call => new URL(call.url).pathname)).toEqual([
      '/api/v1/identity/me', '/api/v1/auth/refresh', '/api/v1/identity/me',
    ])
    expect(new Headers(fixture.calls[1]?.init.headers).get('X-CSRF-Token')).toBe('csrf-value')
  })

  it('preserves domain data envelopes and reads Problem Details', async () => {
    const problem = { type: 'about:blank', title: 'Bad Request', status: 400,
      detail: 'One or more request fields are invalid.', code: 'VALIDATION_FAILED',
      correlationId: 'abc-123', errors: [{ field: 'email', messages: ['invalid'] }] }
    const { client } = harness([
      new Response(JSON.stringify({ data: [{ product_slug: 'ehr' }] })),
      new Response(JSON.stringify(problem), { status: 400,
        headers: { 'Content-Type': 'application/problem+json' } }),
    ])
    await expect(client.get('/api/v1/commercial/pricing')).resolves.toEqual({ data: [{ product_slug: 'ehr' }] })
    await expect(client.post('/api/v1/commercial/demo-requests', {})).rejects.toMatchObject({
      status: 400, code: 'VALIDATION_FAILED', message: problem.detail,
      requestId: 'abc-123', details: problem.errors,
    })
  })

  it.each(['/api/v1/auth/session', '/api/v1/admin/session'])('does not refresh anonymous bootstrap %s', async (path) => {
    vi.stubGlobal('document', { cookie: '' })
    const refreshSession = vi.fn()
    const onUnauthorized = vi.fn()
    const { client, calls } = harness([new Response('{}', { status: 401 })], { refreshSession, onUnauthorized })
    await expect(client.get(path)).rejects.toMatchObject({ status: 401 })
    expect(refreshSession).not.toHaveBeenCalled()
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(1)
  })

  it('restores auth/session bootstrap through the same single refresh path', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([
      new Response('{}', { status: 401 }), new Response('{}'),
      new Response(JSON.stringify({ actor: { kind: 'staff' } })),
    ], { refreshSession })
    await expect(fixture.client.get('/api/v1/auth/session', { auth: 'optional' })).resolves.toEqual({ actor: { kind: 'staff' } })
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(fixture.calls.map(call => new URL(call.url).pathname)).toEqual([
      '/api/v1/auth/session', '/api/v1/auth/refresh', '/api/v1/auth/session',
    ])
  })

  it('returns the original unauthorized result when stale refresh CSRF is rejected', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=stale-value' })
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([
      new Response('{}', { status: 401 }),
      new Response(JSON.stringify({ code: 'CSRF_VALIDATION_FAILED', detail: 'Refresh CSRF validation failed' }), { status: 403 }),
    ], { refreshSession })
    await expect(fixture.client.get('/api/v1/auth/session')).rejects.toMatchObject({ status: 401 })
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(fixture.calls).toHaveLength(2)
  })

  it('preserves CSRF rejection of a protected write without refreshing or repeating it', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=stale-value' })
    const refreshSession = vi.fn()
    const { client, calls } = harness([
      new Response(JSON.stringify({ code: 'CSRF_VALIDATION_FAILED' }), { status: 403 }),
    ], { refreshSession })
    await expect(client.post('/api/v1/identity/me/access-pin', {})).rejects.toMatchObject({ status: 403, code: 'CSRF_VALIDATION_FAILED' })
    expect(refreshSession).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it.each([403, 503])('does not hide a refresh failure with status %s', async (status) => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([
      new Response('{}', { status: 401 }), new Response('{}', { status }),
    ], { refreshSession })
    await expect(fixture.client.get('/api/v1/auth/session')).rejects.toMatchObject({ status })
    expect(fixture.calls).toHaveLength(2)
  })

  it('redacts patient UUIDs from transport logs', async () => {
    const warn = vi.fn()
    const patientId = '123e4567-e89b-42d3-a456-426614174000'
    const { client } = harness([new Response('{}', { status: 403 })], {
      logger: { debug: vi.fn(), warn, error: vi.fn() },
    })
    await expect(client.get(`/api/v1/ehr/patients/${patientId}/encounters`)).rejects.toMatchObject({ status: 403 })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(patientId)
  })
})

describe('presigned document upload', () => {
  it('sends raw bytes and required signed headers without cookies', async () => {
    const calls: RequestInit[] = []
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Response(null, { status: 200 })
    })
    const body = new Blob(['clinical bytes'], { type: 'application/pdf' })
    await uploadPresignedObject({ url: 'https://storage.example.org/signed?token=secret', body,
      requiredHeaders: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'checksum' },
      fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(calls[0]?.body).toBe(body)
    expect(calls[0]?.credentials).toBe('omit')
    expect(new Headers(calls[0]?.headers).get('x-amz-checksum-sha256')).toBe('checksum')
  })

  it('refuses an insecure remote upload URL', async () => {
    const fetchImpl = vi.fn()
    await expect(uploadPresignedObject({ url: 'http://storage.example.org/signed',
      body: new Blob(['data']), requiredHeaders: {}, fetchImpl })).rejects.toMatchObject({
      code: 'INVALID_UPLOAD_URL',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
