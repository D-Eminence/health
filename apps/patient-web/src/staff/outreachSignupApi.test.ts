import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
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

function recordFetch(body: unknown, status = 200) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } })
  }))
  return requests
}

/** Open sign-up on outreach. (owner decisions of 11 November 2026): the requests, as identity-api and outreach-api take them. */
describe('open sign-up on outreach.: the organiser sign-up', () => {
  it('asks whether sign-up is open, then sends details, the code and the terms with the password, each once', async () => {
    const requests = recordFetch({ open: true, termsVersion: '2026-11-01' })
    const { outreachOrganiserApi } = await import('./api')
    await outreachOrganiserApi.availability()
    await outreachOrganiserApi.start({ organiserName: 'Funke Ade', email: 'funke@example.test', phone: '08012345678',
      groupName: 'Ajegunle Health Volunteers', kind: 'group', turnstileToken: 'token-1' })
    await outreachOrganiserApi.verify('c0de0000-0000-4000-8000-000000000001', '123456')
    await outreachOrganiserApi.activate({ termsVersion: '2026-11-01', password: 'a long fictional passphrase' })
    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'GET /api/v1/identity/outreach-organisers/availability',
      'POST /api/v1/identity/outreach-organisers',
      'POST /api/v1/identity/outreach-organisers/verify-email',
      'POST /api/v1/identity/outreach-organisers/activate',
    ])
    expect(requests[1]!.body).toEqual({ organiserName: 'Funke Ade', email: 'funke@example.test', phone: '08012345678',
      groupName: 'Ajegunle Health Volunteers', kind: 'group', turnstileToken: 'token-1', turnstileAction: 'outreach-organiser-signup' })
    expect(requests[2]!.body).toEqual({ challengeId: 'c0de0000-0000-4000-8000-000000000001', code: '123456' })
    expect(requests[3]!.body).toEqual({ termsVersion: '2026-11-01', acceptTerms: true, password: 'a long fictional passphrase' })
  })

  it('does not send a closed sign-up again by itself (423)', async () => {
    const requests = recordFetch({ status: 423, code: 'OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE', detail: 'closed' }, 423)
    const { outreachOrganiserApi } = await import('./api')
    await expect(outreachOrganiserApi.start({ organiserName: 'Funke Ade', email: 'funke@example.test', phone: '08012345678',
      groupName: 'Ajegunle Health Volunteers', kind: 'group' })).rejects.toMatchObject({ status: 423, code: 'OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE' })
    expect(requests).toHaveLength(1)
  })
})

describe('open sign-up on outreach.: signed in', () => {
  it('starts an outreach group for the signed-in login, with no facility', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ started: true, organizationId: 'org-1', facilityId: 'f-1', membershipId: 'm-1', reviewState: 'pending' })
    const { staffApi } = await signedInStaffApi()
    await staffApi.startOutreachGroup({ groupName: 'Ajegunle Health Volunteers', kind: 'group', phone: '08012345678',
      termsVersion: '2026-11-01', acceptTerms: true })
    expect(requests[0]!.url.pathname).toBe('/api/v1/identity/outreach-organisers/for-my-account')
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('x-facility-id')).toBeNull()
    expect(requests[0]!.body).toEqual({ groupName: 'Ajegunle Health Volunteers', kind: 'group', phone: '08012345678',
      termsVersion: '2026-11-01', acceptTerms: true })
  })

  it('lists and sends the team’s invitations at the group, with the caller’s Idempotency-Key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ invitations: [] })
    const { staffApi } = await signedInStaffApi()
    await staffApi.outreachInvitations('f-1')
    await staffApi.createOutreachInvitation('f-1', { name: 'Bisi Adeyemi', email: 'bisi@example.test' }, 'key-1')
    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'GET /api/v1/identity/outreach-invitations', 'POST /api/v1/identity/outreach-invitations'])
    expect(requests.every(request => request.headers.get('x-facility-id') === 'f-1')).toBe(true)
    expect(requests[1]!.headers.get('idempotency-key')).toBe('key-1')
    expect(requests[1]!.body).toEqual({ name: 'Bisi Adeyemi', email: 'bisi@example.test' })
  })

  it('sends a registration’s consent with it, under the command’s Idempotency-Key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'case-1', status: 'identity_resolution_pending', rowVersion: 1, possibleDuplicate: true })
    const { staffApi } = await signedInStaffApi()
    const command = { localCommandId: 'c0000000-0000-4000-8000-000000000001', temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001' }
    const created = await staffApi.createOutreachCase('f-1', { campaignId: 'campaign-1', fullName: 'Kemi Balogun', sex: 'female', ageYears: 30,
      consent: { textVersion: 'outreach-notice-2026-11-01', language: 'yo', method: 'verbal_read_aloud' } }, command)
    expect(created.possibleDuplicate).toBe(true)
    expect(requests[0]!.headers.get('idempotency-key')).toBe(command.localCommandId)
    expect(requests[0]!.body).toMatchObject({ consent: { textVersion: 'outreach-notice-2026-11-01', language: 'yo', method: 'verbal_read_aloud' },
      ...command })
  })
})
