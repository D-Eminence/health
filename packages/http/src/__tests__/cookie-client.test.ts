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

  // hid-system #39: Identity reads X-HID-Client on these two cookie calls only, so a
  // portal refreshes or ends only its own kind of sign-in on the shared cookies.
  it.each(['/api/v1/auth/refresh', '/api/v1/auth/logout'])('names the application on POST %s', async path => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const { client, calls } = harness([new Response(null, { status: 204 })])
    await client.post(path)
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('X-HID-Client')).toBe('patient-web')
    // The CSRF token and cookies go as before.
    expect(headers.get('X-CSRF-Token')).toBe('csrf-value')
    expect(calls[0]?.init.credentials).toBe('include')
    expect(headers.has('Authorization')).toBe(false)
  })

  it('names the application on no other cookie call', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const { client, calls } = harness(Array.from({ length: 8 }, () => new Response('{}')),
      { getDefaultHeaders: () => ({ 'X-HID-Client': 'staff-web' }) })
    await client.get('/api/v1/auth/session')
    await client.get('/api/v1/auth/refresh')
    await client.post('/api/v1/auth/login', {})
    await client.post('/api/v1/auth/facility', { facilityId: 'facility-1' })
    await client.post('/api/v1/auth/admin/refresh')
    await client.post('/api/v1/auth/admin/logout')
    await client.post('/api/v1/auth/refresh/extra')
    await client.post('/api/v1/identity/me/access-pin', { pin: '123456' })
    expect(calls.map(call => new Headers(call.init.headers).has('X-HID-Client'))).toEqual(Array(8).fill(false))
  })

  it('names only its own application, whatever a caller asks', async () => {
    const { client, calls } = harness([new Response(null, { status: 204 })],
      { getDefaultHeaders: () => ({ 'X-HID-Client': 'staff-web' }) })
    await client.request({ method: 'POST', path: '/api/v1/auth/logout', headers: { 'X-HID-Client': 'staff-web' } })
    expect(new Headers(calls[0]?.init.headers).get('X-HID-Client')).toBe('patient-web')
  })

  it('names the application on the refresh made for a protected request, and not on its repeat', async () => {
    vi.stubGlobal('document', { cookie: 'hid_access_csrf=csrf-value' })
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([
      new Response('{}', { status: 401 }),
      new Response(JSON.stringify({ actor: { kind: 'patient' } })),
      new Response(JSON.stringify({ patientId: 'patient-1' })),
    ], { refreshSession })
    await fixture.client.get('/api/v1/identity/me')
    expect(fixture.calls.map(call => new Headers(call.init.headers).get('X-HID-Client'))).toEqual([null, 'patient-web', null])
  })

  it('does not restore the session or repeat the request when the refresh names the other application', async () => {
    const mismatch = () => new Response(JSON.stringify({ code: 'SESSION_CLIENT_MISMATCH',
      detail: 'This sign-in belongs to the staff application, not patient-web' }),
    { status: 403, headers: { 'Content-Type': 'application/problem+json' } })
    const onUnauthorized = vi.fn()
    const refreshSession = vi.fn(async () => { await fixture.client.post('/api/v1/auth/refresh') })
    const fixture = harness([new Response('{}', { status: 401 }), mismatch()], { refreshSession, onUnauthorized })
    await expect(fixture.client.get('/api/v1/identity/me')).rejects.toMatchObject({ status: 403, code: 'SESSION_CLIENT_MISMATCH' })
    expect(fixture.calls.map(call => new URL(call.url).pathname)).toEqual(['/api/v1/identity/me', '/api/v1/auth/refresh'])
    expect(refreshSession).toHaveBeenCalledTimes(1)
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

  it('returns a download with its readable headers and still reads a refused download as a problem', async () => {
    const { client, calls } = harness([
      new Response('account_id,email\r\n', { headers: { 'Content-Type': 'text/csv', 'X-HID-Export-Row-Count': '0' } }),
      new Response(JSON.stringify({ code: 'STEP_UP_REQUIRED', detail: 'Confirm', correlationId: 'corr-1' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    ])
    const download = await client.request<{ blob: Blob; headers: Headers }>({ method: 'GET',
      path: '/api/v1/admin/principals/export', query: { reason: 'Quarterly review' }, responseType: 'download' })
    expect(await download.blob.text()).toBe('account_id,email\r\n')
    expect(download.headers.get('X-HID-Export-Row-Count')).toBe('0')
    expect(new Headers(calls[0]?.init.headers).get('Accept')).toBe('*/*')
    await expect(client.request({ method: 'GET', path: '/api/v1/admin/principals/export',
      query: { reason: 'Another review' }, responseType: 'download' })).rejects.toMatchObject({ status: 403, code: 'STEP_UP_REQUIRED' })
  })

  it('does not restore the session or resend a code the backend rejected', async () => {
    const refreshSession = vi.fn(async () => undefined)
    const { client, calls } = harness([
      new Response(JSON.stringify({ code: 'MFA_INVALID_CODE', detail: 'The code is not valid' }), { status: 401 }),
      new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED', detail: 'Expired' }), { status: 401 }),
      new Response(JSON.stringify({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })),
    ], { refreshSession })
    const keepCodeRejection = (error: { code: string }) => error.code !== 'MFA_INVALID_CODE'
    await expect(client.request({ method: 'POST', path: '/api/v1/admin/mfa/step-up', body: { code: '123456' },
      refreshOnUnauthorized: keepCodeRejection })).rejects.toMatchObject({ status: 401, code: 'MFA_INVALID_CODE' })
    expect(calls).toHaveLength(1)
    expect(refreshSession).not.toHaveBeenCalled()
    // An expired access token is still restored once for the same kind of request.
    await expect(client.request({ method: 'POST', path: '/api/v1/admin/mfa/step-up', body: { code: '654321' },
      refreshOnUnauthorized: keepCodeRejection })).resolves.toEqual({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(3)
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
