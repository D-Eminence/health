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
      '/api/v1/admin/session', '/api/v1/admin/overview', '/api/v1/admin/principals/search',
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
      json({ items: [], nextCursor: null }), json({ items: [], nextCursor: null })])
    const { adminApi } = await import('../api')
    await adminApi.approvals('pending')
    await adminApi.approvals(null, { cursor: 'opaque-cursor' })
    await adminApi.approvals('approved', { limit: 20 })
    await adminApi.demos({ status: 'new' }, { cursor: 'next-demo', limit: 100 })
    expect(requests.map(request => `${request.url.pathname}?${request.url.searchParams.toString()}`)).toEqual([
      // The backend's default page of 50; only parameters the caller gives are sent.
      '/api/v1/admin/approvals?status=pending',
      '/api/v1/admin/approvals?cursor=opaque-cursor',
      '/api/v1/admin/approvals?status=approved&limit=20',
      '/api/v1/admin/demo-requests?limit=100&status=new&cursor=next-demo',
    ])
  })

  it('reads a list from an Identity build before Stage 4A as its last page', async () => {
    const approval = { id: 'approval-1' }
    const demo = { id: 'demo-1' }
    const requests = recordFetch([json({ items: [approval] }), json({ items: [demo] })])
    const { adminApi } = await import('../api')
    // Before Stage 4A, /admin/approvals refuses every parameter but `status` and neither list returns `nextCursor`.
    await expect(adminApi.approvals('pending')).resolves.toEqual({ items: [approval], nextCursor: null })
    await expect(adminApi.demos()).resolves.toEqual({ items: [demo], nextCursor: null })
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ status: 'pending' })
    expect(Object.fromEntries(requests[1]!.url.searchParams)).toEqual({ limit: '50' })
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

  // hid-system A24 (ADR-059, D-Eminence/hid-system#76): a search term is a name or an email address, and
  // request-line access logs keep URLs, so the search and the export send their terms, and the export
  // its audited reason, in a POST body. The GET forms stay one release for older consoles, then go.
  it('searches users with the terms in a POST body, never in the URL, sending the platform CSRF token', async () => {
    document.cookie = 'hid_access_admin_csrf=platform-csrf'
    const page = { items: [], page: 2, pageSize: 25, total: 0 }
    const requests = recordFetch([json(page), json({ ...page, page: 1 })])
    const { adminApi } = await import('../api')
    await expect(adminApi.principals('ada@example.test', { page: 2, status: 'active' })).resolves.toEqual(page)
    await adminApi.principals('Ada Operator')
    expect(requests.map(request => `${request.method} ${request.url.pathname}${request.url.search}`)).toEqual([
      'POST /api/v1/admin/principals/search', 'POST /api/v1/admin/principals/search'])
    expect(requests[0]!.body).toEqual({ query: 'ada@example.test', page: 2, pageSize: 25, status: 'active' })
    // An absent status is left out: the backend refuses a null one.
    expect(requests[1]!.body).toEqual({ query: 'Ada Operator', page: 1, pageSize: 25 })
    for (const request of requests) {
      expect(request.headers.get('x-csrf-token')).toBe('platform-csrf')
      expect(request.headers.has('x-facility-id')).toBe(false)
      // A search is no governed command: no version or idempotency key.
      expect(request.headers.has('if-match')).toBe(false)
      expect(request.headers.has('idempotency-key')).toBe(false)
    }
  })

  it('downloads the principal export with its reason in a POST body, reads the cap headers and never repeats it', async () => {
    document.cookie = 'hid_access_admin_csrf=platform-csrf'
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
    expect(`${requests[0]!.method} ${requests[0]!.url.pathname}${requests[0]!.url.search}`).toBe('POST /api/v1/admin/principals/export')
    expect(requests[0]!.body).toEqual({ reason: 'Quarterly access review', query: 'clinic', status: 'active' })
    expect(requests[0]!.headers.get('x-csrf-token')).toBe('platform-csrf')
    expect(requests[0]!.headers.get('accept')).toBe('*/*')
    // Cross-origin, the browser may not expose the backend's export headers.
    await expect(adminApi.exportPrincipals({ reason: 'Quarterly access review' }))
      .resolves.toMatchObject({ rowCount: null, rowLimit: null, truncated: null })
    expect(requests[1]!.body).toEqual({ reason: 'Quarterly access review' })
    await expect(adminApi.exportPrincipals({ reason: 'Quarterly access review' })).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(3)
    for (const request of requests) expect(request.url.search).toBe('')
  })

  // hid-system ADR-066 (branch claude/clinician-self-signup at fa58e2b): the verification queue A1-A5.
  it('lists and opens clinician applications with the state, cursor and limit the backend takes', async () => {
    const item = { applicationId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a', version: 3 }
    const requests = recordFetch([json({ items: [item], nextCursor: 'next-page' }), json({ items: [] }),
      json({ items: [], nextCursor: null }), json({ ...item, state: 'submitted' })])
    const { adminApi } = await import('../api')
    await expect(adminApi.clinicianApplications('open')).resolves.toEqual({ items: [item], nextCursor: 'next-page' })
    // A list without nextCursor is its last page.
    await expect(adminApi.clinicianApplications('approved', { cursor: 'next-page' })).resolves.toEqual({ items: [], nextCursor: null })
    await adminApi.clinicianApplications('under_review', { limit: 50 })
    await expect(adminApi.clinicianApplication(item.applicationId)).resolves.toMatchObject({ state: 'submitted' })
    expect(requests.map(request => `${request.method} ${request.url.pathname}?${request.url.searchParams.toString()}`)).toEqual([
      'GET /api/v1/admin/clinician-applications?state=open',
      'GET /api/v1/admin/clinician-applications?state=approved&cursor=next-page',
      'GET /api/v1/admin/clinician-applications?state=under_review&limit=50',
      `GET /api/v1/admin/clinician-applications/${item.applicationId}?`,
    ])
    for (const request of requests) {
      expect(request.headers.has('x-facility-id')).toBe(false)
      expect(request.headers.has('idempotency-key')).toBe(false)
    }
  })

  it('sends the three clinician review commands with the platform CSRF token, If-Match, the key and the contract body', async () => {
    document.cookie = 'hid_access_admin_csrf=platform-csrf'
    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const requests = recordFetch([
      json({ applicationId, state: 'under_review', attestationId: 'attestation-1', attestedRoles: ['doctor'],
        verificationMethod: 'manual_review', validUntil: '2027-03-31T22:59:59.000Z', version: 4, replayed: false }, 201),
      json({ applicationId, state: 'approved', accountId: 'account-1', facilityId: 'facility-1', membershipId: 'membership-1',
        roleCode: 'doctor', attestationId: 'attestation-1', version: 5, replayed: false }, 201),
      json({ applicationId, state: 'rejected', decisionCode: 'licence_not_current', version: 4, replayed: true }, 201),
    ])
    const { adminApi } = await import('../api')
    const checklist = { registerChecked: true, licenceCurrentUntilRecorded: true, identityMethod: 'video_call_photo_id',
      identityConfirmed: true, employmentChannel: 'facility_public_phone', employmentConfirmed: true } as const
    const attest = { validUntil: '2027-03-31T23:59:59+01:00', evidenceReference: 'Ticket HID-VER-1234', checklist,
      authenticatorCode: '123456', reason: 'Licence and identity confirmed on a video call' }
    await expect(adminApi.attestClinicianApplication({ applicationId, version: 3 }, attest, 'key-attest'))
      .resolves.toMatchObject({ state: 'under_review', version: 4, replayed: false })
    await expect(adminApi.approveClinicianApplication({ applicationId, version: 4 }, 'Step 1 evidence reviewed', 'key-approve'))
      .resolves.toMatchObject({ state: 'approved', membershipId: 'membership-1' })
    await expect(adminApi.rejectClinicianApplication({ applicationId, version: 3 }, 'licence_not_current',
      'The register shows the licence expired', 'key-reject')).resolves.toMatchObject({ replayed: true })
    expect(requests.map(request => `${request.method} ${request.url.pathname}${request.url.search}`)).toEqual([
      `POST /api/v1/admin/clinician-applications/${applicationId}/attest`,
      `POST /api/v1/admin/clinician-applications/${applicationId}/approve`,
      `POST /api/v1/admin/clinician-applications/${applicationId}/reject`,
    ])
    expect(requests.map(request => request.headers.get('if-match'))).toEqual(['"3"', '"4"', '"3"'])
    expect(requests.map(request => request.headers.get('idempotency-key'))).toEqual(['key-attest', 'key-approve', 'key-reject'])
    for (const request of requests) {
      expect(request.headers.get('x-csrf-token')).toBe('platform-csrf')
      expect(request.headers.has('x-facility-id')).toBe(false)
    }
    expect(requests[0]!.body).toEqual(attest)
    expect(requests[1]!.body).toEqual({ reason: 'Step 1 evidence reviewed' })
    expect(requests[2]!.body).toEqual({ decisionCode: 'licence_not_current', reason: 'The register shows the licence expired' })
  })

  it('names an Identity without the clinician queue instead of showing its bare 404', async () => {
    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    recordFetch([
      json({ code: 'NOT_FOUND', detail: 'Cannot GET /api/v1/admin/clinician-applications?state=open', correlationId: 'corr-1' }, 404),
      json({ code: 'NOT_FOUND', detail: `Cannot GET /api/v1/admin/clinician-applications/${applicationId}` }, 404),
      json({ code: 'CLINICIAN_APPLICATION_NOT_FOUND', detail: 'The application was not found' }, 404),
    ])
    const { adminApi } = await import('../api')
    await expect(adminApi.clinicianApplications('open')).rejects.toMatchObject({ status: 404, code: 'CLINICIAN_QUEUE_UNAVAILABLE' })
    await expect(adminApi.clinicianApplication(applicationId)).rejects.toMatchObject({ status: 404, code: 'CLINICIAN_QUEUE_UNAVAILABLE' })
    // The queue's own answer for a missing application is kept as it is.
    await expect(adminApi.clinicianApplication(applicationId)).rejects.toMatchObject({ status: 404, code: 'CLINICIAN_APPLICATION_NOT_FOUND' })
  })

  it('never sends a clinician review command without a version to match', async () => {
    const requests = recordFetch()
    const { adminApi } = await import('../api')
    expect(() => adminApi.approveClinicianApplication({ applicationId: 'application-1', version: 0 }, 'Reviewed evidence', 'key-1'))
      .toThrow('Reload this item before changing it.')
    expect(requests).toHaveLength(0)
  })

  it('keeps sending facility context for provider workflows', async () => {
    const requests = recordFetch()
    // Protected staff requests wait for a ready session, as the provider portal sets once signed in.
    const { setStaffSessionReady } = await import('../../staff/session')
    setStaffSessionReady(true)
    const { staffApi } = await import('../../staff/api')
    await staffApi.facilityAudit('facility-1')
    expect(requests[0]!.url.pathname).toBe('/api/v1/audit/events')
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
  })
})
