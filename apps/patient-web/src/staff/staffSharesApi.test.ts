import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(answer: unknown, status = 200) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/problem+json' } })
  }))
  return requests
}

const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const INVITATION = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'

/**
 * The clinician's side of patient sharing (hid-1.0 parity B4, hid-system 0095; contract S1 to S3): direct care at the
 * selected facility, on Identity's /api/v1/identity/... paths, and answers read field by field.
 */
describe('the provider portal’s sharing calls', () => {
  it('reads Shared with you with the facility and direct-care purpose, keeping well-formed rows only', async () => {
    const row = { consentGrantId: 'grant-1', patientId: 'patient-1', hid: 'HID-ABC234', fullName: 'Amaka Eze', level: 'view_only',
      duration: '7d', scope: 'read_records', startsAt: '2026-10-28T10:00:00Z', expiresAt: '2026-11-04T10:00:00Z' }
    const requests = recordFetch({ items: [row, { ...row, consentGrantId: 'grant-2', level: 'everything' }, 'junk'] })
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.sharedWithMe(FACILITY)).resolves.toEqual([row])
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['GET', '/api/v1/identity/shared-with-me']])
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })

  it('reads the invitations to the clinician’s email, and none when the membership may not receive shares', async () => {
    const item = { invitationId: INVITATION, reference: 'ABCD2345', inviteeName: 'Dr Obi', level: 'clinical_review', duration: '30d',
      createdAt: '2026-10-27T09:00:00Z', expiresAt: '2026-11-26T09:00:00Z' }
    const requests = recordFetch({ eligible: true, items: [item] })
    let { staffApi } = await signedInStaffApi()
    await expect(staffApi.staffShareInvitations(FACILITY)).resolves.toEqual({ eligible: true, items: [item] })
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['GET', '/api/v1/identity/share-invitations']])
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
    vi.unstubAllGlobals(); vi.resetModules()
    recordFetch({ eligible: false, items: [item] });
    ({ staffApi } = await signedInStaffApi())
    await expect(staffApi.staffShareInvitations(FACILITY)).resolves.toEqual({ eligible: false, items: [] })
  })

  it('accepts an invitation with no body, the CSRF token and the facility', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ invitationId: INVITATION, status: 'accepted', acceptedAt: '2026-10-28T11:00:00Z', replayed: false })
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.acceptShareInvitation(FACILITY, INVITATION)).resolves.toEqual({ invitationId: INVITATION, status: 'accepted',
      acceptedAt: '2026-10-28T11:00:00Z', replayed: false })
    expect(requests.map(request => [request.method, request.url.pathname, request.body])).toEqual([
      ['POST', `/api/v1/identity/share-invitations/${INVITATION}/accept`, undefined]])
    expect(requests[0]!.headers.get('x-csrf-token')).toBe('csrf-1')
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })

  it('reports 404, the answer of a backend before 0095, as itself', async () => {
    recordFetch({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET' }, 404)
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.sharedWithMe(FACILITY)).rejects.toMatchObject({ status: 404 })
  })
})
