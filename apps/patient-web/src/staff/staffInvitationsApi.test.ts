import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/** The staff API with a session in use and ready, as the provider portal sets it once signed in. */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown; credentials: RequestCredentials | undefined }

function recordFetch(answer: unknown = {}, status = 200) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined, credentials: init.credentials })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/problem+json' } })
  }))
  return requests
}

const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const INVITATION = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const MEMBERSHIP = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'
const TOKEN = 'A'.repeat(43)

/**
 * "This isn't my organization" (P4 leftover 1, built in P4b): POST …/provider-enrollments/withdraw, accountless, with the
 * enrollment cookie the browser sends by itself, and no body (Identity reads none).
 */
describe('withdrawing a confirmed sign-up', () => {
  it('posts once, with no body, the cookies and no session headers', async () => {
    const requests = recordFetch({ withdrawn: true })
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.withdraw()).resolves.toEqual({ withdrawn: true })
    expect(requests.map(request => [request.method, request.url.pathname, request.body])).toEqual([
      ['POST', '/api/v1/identity/provider-enrollments/withdraw', undefined]])
    expect(requests[0]!.credentials).toBe('include')
    expect(requests[0]!.headers.has('x-csrf-token')).toBe(false)
    expect(requests[0]!.headers.has('authorization')).toBe(false)
  })

  it('is not repeated after a fault', async () => {
    const requests = recordFetch({ status: 503, code: 'UPSTREAM_UNAVAILABLE' }, 503)
    const { providerEnrollmentApi } = await import('./api')
    await expect(providerEnrollmentApi.withdraw()).rejects.toMatchObject({ status: 503 })
    expect(requests).toHaveLength(1)
  })
})

/** The Staff page's calls (P4b SPEC 6.3): the working facility, healthcare operations, and exactly Identity's DTOs. */
describe('a self-signed-up facility’s staff', () => {
  it('reads the Staff page with the facility and healthcare-operations purpose', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ members: [] })
    const { facilityStaffApi } = await signedInStaffApi()
    await facilityStaffApi.read(FACILITY)
    expect(requests.map(request => [request.method, request.url.pathname, request.url.search])).toEqual([
      ['GET', '/api/v1/identity/facility-staff', '']])
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
  })

  it('sends an invitation with the form’s Idempotency-Key, the attestation and the password, and a licence only for a clinician', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ invitationId: INVITATION, version: 1, expiresAt: '2026-11-01T09:00:00Z', deliveryOutcome: 'accepted',
      replayed: false })
    const { facilityStaffApi } = await signedInStaffApi()
    await facilityStaffApi.invite(FACILITY, { name: 'Ngozi Okafor', email: 'ngozi@ikejacare.example', role: 'nurse',
      licenceBody: 'NMCN', licenceNumber: 'RN 98765', currentPassword: 'my password' }, 'invite-key-0001')
    await facilityStaffApi.invite(FACILITY, { name: 'Tunde Bello', email: 'tunde@ikejacare.example', role: 'receptionist',
      currentPassword: 'my password' }, 'invite-key-0002')
    expect(requests.map(request => [request.method, request.url.pathname, request.body, request.headers.get('idempotency-key')])).toEqual([
      ['POST', '/api/v1/identity/staff-invitations', { name: 'Ngozi Okafor', email: 'ngozi@ikejacare.example', role: 'nurse',
        licenceBody: 'NMCN', licenceNumber: 'RN 98765', attested: true, currentPassword: 'my password' }, 'invite-key-0001'],
      ['POST', '/api/v1/identity/staff-invitations', { name: 'Tunde Bello', email: 'tunde@ikejacare.example',
        role: 'receptionist', attested: true, currentPassword: 'my password' }, 'invite-key-0002'],
    ])
    for (const request of requests) {
      expect(request.headers.get('x-facility-id')).toBe(FACILITY)
      expect(request.headers.get('x-csrf-token')).toBe('csrf-1')
    }
  })

  it('resends, revokes, removes and changes a role with the version read, in the body', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ version: 2 })
    const { facilityStaffApi } = await signedInStaffApi()
    await facilityStaffApi.recordAdministratorLicence(FACILITY, 'MDCN', 'MDCN/12345')
    await facilityStaffApi.resend(FACILITY, { invitationId: INVITATION, version: 3 })
    await facilityStaffApi.revoke(FACILITY, { invitationId: INVITATION, version: 4 })
    await facilityStaffApi.end(FACILITY, { membershipId: MEMBERSHIP, version: 5 }, 'Left the facility.', 'my password')
    await facilityStaffApi.changeRole(FACILITY, { membershipId: MEMBERSHIP, version: 6 }, { role: 'doctor', licenceBody: 'MDCN',
      licenceNumber: 'MDCN/777', reason: 'Qualified as a doctor.', currentPassword: 'my password' })
    expect(requests.map(request => [request.url.pathname, request.body, request.headers.has('idempotency-key')])).toEqual([
      ['/api/v1/identity/facility-staff/administrator-licence', { licenceBody: 'MDCN', licenceNumber: 'MDCN/12345' }, false],
      [`/api/v1/identity/staff-invitations/${INVITATION}/resend`, { expectedVersion: 3 }, false],
      [`/api/v1/identity/staff-invitations/${INVITATION}/revoke`, { expectedVersion: 4 }, false],
      [`/api/v1/identity/facility-staff/${MEMBERSHIP}/end`, { expectedVersion: 5, reason: 'Left the facility.',
        currentPassword: 'my password' }, false],
      [`/api/v1/identity/facility-staff/${MEMBERSHIP}/role`, { expectedVersion: 6, role: 'doctor', licenceBody: 'MDCN',
        licenceNumber: 'MDCN/777', attested: true, reason: 'Qualified as a doctor.', currentPassword: 'my password' }, false],
    ])
    for (const request of requests) {
      expect(request.method).toBe('POST')
      expect(request.headers.get('x-facility-id')).toBe(FACILITY)
    }
  })
})

/** Joining by invitation (P4b SPEC 4.7-4.9). */
describe('joining a facility by invitation', () => {
  it('opens the link or the typed code accountless, with the staff-invitation check, and accepts with the password only', async () => {
    const requests = recordFetch({ accepted: true })
    const { staffInvitationApi } = await import('./api')
    await staffInvitationApi.open({ invitationId: INVITATION, token: TOKEN }, 'turnstile-1')
    await staffInvitationApi.open({ email: 'ngozi@ikejacare.example', code: '123456' }, 'turnstile-2')
    await staffInvitationApi.accept('a-long-enough-password')
    expect(requests.map(request => [request.method, request.url.pathname, request.body])).toEqual([
      ['POST', '/api/v1/identity/staff-invitations/open', { invitationId: INVITATION, token: TOKEN, turnstileToken: 'turnstile-1',
        turnstileAction: 'staff-invitation' }],
      ['POST', '/api/v1/identity/staff-invitations/open', { email: 'ngozi@ikejacare.example', code: '123456',
        turnstileToken: 'turnstile-2', turnstileAction: 'staff-invitation' }],
      ['POST', '/api/v1/identity/staff-invitations/accept', { password: 'a-long-enough-password' }],
    ])
    for (const request of requests) {
      expect(request.credentials).toBe('include')
      expect(request.headers.has('x-csrf-token')).toBe(false)
      expect(request.headers.has('x-facility-id')).toBe(false)
      // The secret travels only in the body, never in the address.
      expect(request.url.search).toBe('')
    }
  })

  it('previews and accepts signed in with the CSRF token and no facility', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ accepted: true })
    const { staffInvitationApi } = await signedInStaffApi()
    await staffInvitationApi.previewSignedIn({ invitationId: INVITATION, token: TOKEN })
    await staffInvitationApi.acceptSignedIn({ code: '123456' })
    expect(requests.map(request => [request.method, request.url.pathname, request.body])).toEqual([
      ['POST', '/api/v1/identity/staff-invitations/signed-in/preview', { invitationId: INVITATION, token: TOKEN }],
      ['POST', '/api/v1/identity/staff-invitations/signed-in/accept', { code: '123456' }],
    ])
    for (const request of requests) {
      expect(request.headers.get('x-csrf-token')).toBe('csrf-1')
      expect(request.headers.has('x-facility-id')).toBe(false)
    }
  })
})
