import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ environment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers()
  document.cookie = 'hid_access_admin_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function recordFetch(responses: Response[] = []) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return responses.shift() ?? json({ items: [], nextBeforeSequenceId: null, actor: {} })
  }))
  return requests
}

const grant = (idleExpiresAt: string) => ({ actor: { accountId: 'admin-1', platformPermissions: ['platform.admin.access'] },
  expiresAt: idleExpiresAt, idleExpiresAt })

describe('platform admin API', () => {
  it('sends platform administration requests without a facility context', async () => {
    const requests = recordFetch()
    const { adminApi } = await import('../api')

    await adminApi.session()
    await adminApi.overview()
    await adminApi.principals('admin')
    await adminApi.audit()
    await adminApi.audit(undefined, '41')

    expect(requests.map(request => request.url.pathname)).toEqual([
      '/api/v1/admin/session', '/api/v1/admin/overview', '/api/v1/admin/principals',
      '/api/v1/admin/audit/events', '/api/v1/admin/audit/events',
    ])
    for (const request of requests) expect(request.headers.has('x-facility-id')).toBe(false)
    expect(Object.fromEntries(requests[3]!.url.searchParams)).toEqual({ limit: '50' })
    expect(Object.fromEntries(requests[4]!.url.searchParams)).toEqual({ limit: '50', beforeSequenceId: '41' })
  })

  it('sends account commands with version and the submission idempotency key and no facility', async () => {
    const requests = recordFetch()
    const { adminApi } = await import('../api')
    await adminApi.command('/api/v1/admin/principals/account-1/status',
      { status: 'disabled', reason: 'Governed suspension' }, { version: 3, idempotencyKey: 'submission-key-1' })
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('if-match')).toBe('"3"')
    expect(requests[0]!.headers.get('idempotency-key')).toBe('submission-key-1')
    expect(requests[0]!.headers.has('x-facility-id')).toBe(false)
  })

  it('signs in through the platform routes and sends the platform CSRF token, not the staff one', async () => {
    document.cookie = 'hid_access_csrf=staff-csrf'
    document.cookie = 'hid_access_admin_csrf=platform-csrf'
    const requests = recordFetch([
      json({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' }),
      json(grant('2026-10-08T12:15:00.000Z')),
      json(grant('2026-10-08T12:30:00.000Z')),
      new Response(null, { status: 204 }),
    ])
    const { adminApi } = await import('../api')
    await expect(adminApi.login('admin@example.test', 'correct horse', 'turnstile-token'))
      .resolves.toEqual({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    await adminApi.verifyMfa({ code: '123456' })
    await adminApi.refresh()
    await adminApi.logout()
    expect(requests.map(request => request.url.pathname)).toEqual(['/api/v1/auth/admin/login',
      '/api/v1/auth/admin/mfa/verify', '/api/v1/auth/admin/refresh', '/api/v1/auth/admin/logout'])
    expect(requests[0]!.body).toEqual({ email: 'admin@example.test', password: 'correct horse',
      turnstileAction: 'admin-login', turnstileToken: 'turnstile-token' })
    expect(requests[1]!.body).toEqual({ code: '123456' })
    for (const request of requests) expect(request.headers.get('x-csrf-token')).toBe('platform-csrf')
  })

  it('records the session window from the server and reports how a refused session ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'))
    const problem = json({ code: 'AUTHENTICATION_REQUIRED', detail: 'Valid authentication is required' }, 401)
    recordFetch([
      json(grant('2026-10-08T12:15:00.000Z')),
      // The access token is refused, the one refresh is refused, and the read is not retried again.
      problem, json({ code: 'AUTHENTICATION_REQUIRED' }, 401),
      json({ code: 'AUTHENTICATION_REQUIRED' }, 401), json({ code: 'AUTHENTICATION_REQUIRED' }, 401),
    ])
    const { adminApi } = await import('../api')
    const { onSessionEnded, currentSessionWindow } = await import('../session-window')
    const ended = vi.fn()
    onSessionEnded(ended)

    await adminApi.verifyMfa({ code: '123456' })
    expect(currentSessionWindow().idleExpiresAt).toBe(Date.parse('2026-10-08T12:15:00.000Z'))
    // Before the reported idle expiry, a refusal means the server ended the session.
    await expect(adminApi.overview()).rejects.toMatchObject({ status: 401 })
    expect(ended).toHaveBeenLastCalledWith('revoked')
    vi.setSystemTime(new Date('2026-10-08T12:16:00.000Z'))
    await expect(adminApi.overview()).rejects.toMatchObject({ status: 401 })
    expect(ended).toHaveBeenLastCalledWith('expired')
  })

  it('ends the session with the reason the server gives, from the request or from the refused refresh (Stage 4A)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'))
    recordFetch([
      json(grant('2026-10-08T12:15:00.000Z')),
      // Before the idle expiry, yet the server says the session expired.
      json({ code: 'PLATFORM_SESSION_EXPIRED' }, 401), json({ code: 'PLATFORM_SESSION_EXPIRED' }, 401),
      json(grant('2026-10-08T12:15:00.000Z')),
      // The access cookie is gone (generic 401); the refresh itself says why.
      json({ code: 'AUTHENTICATION_REQUIRED' }, 401), json({ code: 'PLATFORM_SESSION_REVOKED' }, 401),
    ])
    const { adminApi } = await import('../api')
    const { onSessionEnded } = await import('../session-window')
    const ended = vi.fn()
    onSessionEnded(ended)
    await adminApi.verifyMfa({ code: '123456' })
    await expect(adminApi.overview()).rejects.toMatchObject({ status: 401, code: 'PLATFORM_SESSION_EXPIRED' })
    expect(ended).toHaveBeenLastCalledWith('expired')
    await adminApi.verifyMfa({ code: '654321' })
    vi.setSystemTime(new Date('2026-10-08T12:20:00.000Z'))
    await expect(adminApi.overview()).rejects.toMatchObject({ status: 401 })
    // After the reported idle expiry the reading alone would say expired; the server said revoked.
    expect(ended).toHaveBeenLastCalledWith('revoked')
    expect(ended).toHaveBeenCalledTimes(2)
  })

  it('pages approvals and demo requests with the backend cursor and limit', async () => {
    const requests = recordFetch([json({ items: [], nextCursor: null }), json({ items: [], nextCursor: null }),
      json({ items: [], nextCursor: null })])
    const { adminApi } = await import('../api')
    await adminApi.approvals('pending')
    await adminApi.approvals(null, { cursor: 'opaque-cursor' })
    await adminApi.demos({ status: 'new' }, { cursor: 'next-demo', limit: 100 })
    expect(requests.map(request => `${request.url.pathname}?${request.url.searchParams.toString()}`)).toEqual([
      '/api/v1/admin/approvals?status=pending&limit=50',
      '/api/v1/admin/approvals?limit=50&cursor=opaque-cursor',
      '/api/v1/admin/demo-requests?limit=100&status=new&cursor=next-demo',
    ])
  })

  it('does not treat a rejected sign-in or authenticator code as a session ending', async () => {
    recordFetch([
      json({ code: 'AUTHENTICATION_REQUIRED', detail: 'Invalid credentials' }, 401),
      json({ code: 'MFA_INVALID_CODE', detail: 'The code is not valid' }, 401),
      json({ code: 'MFA_INVALID_CODE', detail: 'The code is not valid' }, 401),
    ])
    const { adminApi } = await import('../api')
    const { onSessionEnded } = await import('../session-window')
    const ended = vi.fn()
    onSessionEnded(ended)
    await expect(adminApi.login('admin@example.test', 'wrong', '')).rejects.toMatchObject({ status: 401 })
    await expect(adminApi.verifyMfa({ code: '000000' })).rejects.toMatchObject({ code: 'MFA_INVALID_CODE' })
    await expect(adminApi.stepUp('000000')).rejects.toMatchObject({ code: 'MFA_INVALID_CODE' })
    expect(ended).not.toHaveBeenCalled()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('calls the Stage 2A security routes with the backend contract', async () => {
    const requests = recordFetch([
      json({ requestId: 'request-1', status: 'pending', expiresAt: '2026-10-09T12:00:00.000Z', version: 1, replayed: false }),
      json({ requestId: 'request-2', status: 'pending', expiresAt: '2026-10-09T12:00:00.000Z', version: 1, replayed: false }),
      json({ requestId: 'request-1', status: 'approved', action: 'platform_role.grant', targetAccountId: 'account-2',
        executed: true, version: 2, replayed: false }),
      json({ accountId: 'account-2', revokedCount: 1, replayed: false }),
      json({ sessionId: 'session-9', revokedCount: 1 }),
      json({ items: [] }),
    ])
    const { adminApi } = await import('../api')
    await adminApi.requestSuperAdmin('account-2', 'Second operator for on-call', 'key-a')
    await adminApi.requestMfaReset('account-2', 'Authenticator lost on travel', 'key-b')
    await adminApi.decideApproval({ id: 'request-1', version: 1 }, 'approve', 'Verified with the requester', 'key-c')
    await adminApi.revokePrincipalSession('account-2', 'session-2', { reason: 'Unrecognised device', compromised: true }, 'key-d')
    await adminApi.revokeOwnSession('session-9')
    await adminApi.approvals('pending')
    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /api/v1/admin/principals/account-2/super-admin-requests',
      'POST /api/v1/admin/principals/account-2/mfa-reset-requests',
      'POST /api/v1/admin/approvals/request-1/approve',
      'POST /api/v1/admin/principals/account-2/sessions/session-2/revoke',
      'POST /api/v1/admin/sessions/session-9/revoke',
      'GET /api/v1/admin/approvals',
    ])
    expect(requests.map(request => request.headers.get('idempotency-key'))).toEqual(['key-a', 'key-b', 'key-c', 'key-d', null, null])
    expect(requests[2]!.headers.get('if-match')).toBe('"1"')
    expect(requests[3]!.body).toEqual({ reason: 'Unrecognised device', compromised: true })
    expect(requests[5]!.url.searchParams.get('status')).toBe('pending')
  })

  it('downloads the principal export with its reason, reads the cap headers and never repeats it', async () => {
    const requests = recordFetch([
      new Response('account_id,email\r\n', { headers: { 'Content-Type': 'text/csv', 'X-HID-Export-Row-Count': '5000',
        'X-HID-Export-Row-Limit': '5000', 'X-HID-Export-Truncated': 'true' } }),
      new Response('account_id,email\r\n', { headers: { 'Content-Type': 'text/csv' } }),
      json({ code: 'ADMIN_DATA_UNAVAILABLE' }, 503),
    ])
    const { adminApi } = await import('../api')
    const capped = await adminApi.exportPrincipals({ reason: 'Quarterly access review', query: 'clinic', status: 'active' })
    expect(capped).toMatchObject({ rowCount: 5000, rowLimit: 5000, truncated: true })
    expect(await capped.blob.text()).toBe('account_id,email\r\n')
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ reason: 'Quarterly access review', query: 'clinic', status: 'active' })
    // Cross-origin, the browser may not expose the backend's export headers.
    await expect(adminApi.exportPrincipals({ reason: 'Quarterly access review' }))
      .resolves.toMatchObject({ rowCount: null, rowLimit: null, truncated: null })
    await expect(adminApi.exportPrincipals({ reason: 'Quarterly access review' })).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(3)
  })

  it('keeps sending facility context for provider workflows', async () => {
    const requests = recordFetch()
    const { staffApi } = await import('../../staff/api')
    await staffApi.facilityAudit('facility-1')
    expect(requests[0]!.url.pathname).toBe('/api/v1/audit/events')
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
  })
})
