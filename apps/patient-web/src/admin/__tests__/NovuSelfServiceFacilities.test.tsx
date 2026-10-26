import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * New facility sign-ups through the console's own client (P4): only a Novu build links and routes the page, for the
 * permission the Applications page needs, and the review goes as the organization-application commands do: If-Match
 * with the version listed, the session's CSRF token, no Idempotency-Key.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })
const READER = ['platform.admin.access', 'platform.identity-review.read']
const APPLICATION_ID = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'

interface Call { path: string; search: string; method: string; headers: Headers; body: unknown }

function serve(permissions: string[], items: unknown[] = []) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url)
    calls.push({ path: target.pathname, search: target.search, method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null })
    if (target.pathname === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-10-24T20:00:00Z' })
    if (target.pathname === '/api/v1/admin/self-service-facilities') return json({ items })
    if (target.pathname === '/api/v1/admin/self-service-applications') return json({ total: items.length, items })
    if (target.pathname === '/api/v1/admin/self-service-applications/search') return json({ total: items.length, items })
    if (target.pathname === '/api/v1/admin/self-service-applications/waive-refusal') {
      return json({ waived: [{ applicationId: APPLICATION_ID, waivedAt: '2026-10-25T09:00:00.000Z', version: 6 }] })
    }
    if (target.pathname.endsWith('/review')) return json({ applicationId: APPLICATION_ID, reviewedAt: '2026-10-24T12:00:00.000Z', version: 4 })
    // P4b: support's command on a reviewed administrator's access, the end of the first 30 days and the staff reads.
    if (target.pathname.endsWith('/administrator-role')) return json({ applicationId: APPLICATION_ID, version: 5, grantedRole: 'nurse', sessionsRevoked: 2 })
    if (target.pathname.endsWith('/end-probation')) return json({ applicationId: APPLICATION_ID, version: 6, probationEndedAt: '2026-10-26T09:00:00.000Z' })
    if (/^\/api\/v1\/admin\/facilities\/[^/]+\/staff$/.test(target.pathname)) {
      return json({ facility: { id: 'facility-1', name: 'IKEJA CARE LIMITED', selfService: null }, members: [], invitations: [] })
    }
    if (target.pathname === '/api/v1/admin/staff-invitations') return json({ items: [] })
    if (target.pathname.endsWith('/release')) return json({ applicationId: APPLICATION_ID, releasedAt: '2026-10-24T13:00:00.000Z', version: 5 })
    if (target.pathname.endsWith('/reject')) return json({ applicationId: APPLICATION_ID, rejectedAt: '2026-10-24T14:00:00.000Z', version: 3 })
    return json({ status: 404, code: 'NOT_FOUND', detail: `Cannot ${String(init.method)} ${target.pathname}` }, 404)
  }))
  return calls
}

async function openAt(path: string) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); vi.resetModules() })
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('New facility sign-ups in the Novu console', () => {
  it('is linked under Organizations, after Applications, for the Applications page’s permission only', async () => {
    const { visibleNavigation } = await import('../navigation')
    const organizations = (permissions: string[]) => visibleNavigation(actor(permissions))
      .find(section => section.title === 'Organizations')?.items.map(item => item.title) ?? []
    // Item 3: support's wrong-patient reports are listed for platform.facility.read too.
    expect(organizations([...READER, 'platform.facility.read'])).toEqual(['Applications', 'New facility sign-ups', 'Facilities',
      'Wrong-patient reports'])
    expect(organizations(['platform.admin.access', 'platform.facility.read', 'platform.facility.manage'])).toEqual(['Facilities',
      'Wrong-patient reports'])
  })

  it('lists the ones to review, named in the tab, through the registered route', async () => {
    const calls = serve(READER, [{ applicationId: APPLICATION_ID, version: 3, organizationId: 'org-1', organizationName: 'IKEJA CARE LIMITED',
      facilityId: 'facility-1', facilityName: 'IKEJA CARE LIMITED', facilityLifecycleStatus: 'verified', productCode: 'ehr',
      organizationType: 'hospital', cacHint: 'RC••••56', administratorName: 'Bola Adewale', administratorEmail: 'bola@ikejacare.example',
      administratorAccountId: 'account-1', administratorAccountStatus: 'active', activatedAt: '2026-10-24T09:00:00.000Z',
      reviewedAt: null, reviewedByAccountId: null, reviewNote: null }])
    await openAt('/admin/self-service-facilities')
    expect(await screen.findByRole('heading', { name: 'IKEJA CARE LIMITED', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups (1 to review)')
    expect(document.title).toBe('New facility sign-ups · Health ID Platform')
    expect(calls.filter(call => call.path === '/api/v1/admin/self-service-facilities').map(call => [call.method, call.search]))
      .toEqual([['GET', '?state=unreviewed']])
  })

  it('refuses the page to an administrator without the permission, without asking for the list', async () => {
    const calls = serve(['platform.admin.access', 'platform.facility.read'])
    await openAt('/admin/self-service-facilities')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'New facility sign-ups' })).toBeNull()
    expect(calls.some(call => call.path.includes('self-service'))).toBe(false)
  })

  it('sends a review with If-Match, the note, the administrator’s access and the CSRF token, and no Idempotency-Key', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    const access = { grantedRole: 'doctor' as const, verificationMethod: 'regulator_register' as const,
      administratorLicence: { body: 'MDCN', number: 'MDCN/12345' } }
    await expect(adminApi.reviewSelfServiceFacility({ applicationId: APPLICATION_ID, version: 3 }, 'Called the hospital; confirmed.',
      access)).resolves.toEqual({ applicationId: APPLICATION_ID, reviewedAt: '2026-10-24T12:00:00.000Z', version: 4 })
    const review = calls.find(call => call.path.endsWith('/review'))!
    // P4b: the body Identity's ReviewSelfServiceFacilityDto takes, and nothing else (unknown fields are refused).
    expect(review).toMatchObject({ method: 'POST', path: `/api/v1/admin/self-service-facilities/${APPLICATION_ID}/review` })
    expect(review.body).toEqual({ note: 'Called the hospital; confirmed.', grantedRole: 'doctor',
      verificationMethod: 'regulator_register', administratorLicence: { body: 'MDCN', number: 'MDCN/12345' } })
    expect(review.headers.get('if-match')).toBe('"3"')
    expect(review.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(review.headers.has('idempotency-key')).toBe(false)
    // No clinical role: no licence at all.
    await adminApi.reviewSelfServiceFacility({ applicationId: APPLICATION_ID, version: 3 }, 'Called the hospital; confirmed.',
      { grantedRole: 'none', verificationMethod: 'officer_match' })
    expect(calls.filter(call => call.path.endsWith('/review')).at(-1)!.body).toEqual({ note: 'Called the hospital; confirmed.',
      grantedRole: 'none', verificationMethod: 'officer_match' })
    // A version that was never read is not sent.
    expect(() => adminApi.reviewSelfServiceFacility({ applicationId: APPLICATION_ID, version: 0 }, 'Called the hospital; confirmed.',
      access)).toThrow('Reload this item before changing it.')
  })

  it('changes the administrator’s access and ends the first 30 days with If-Match, each with its own body (P4b)', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.setSelfServiceAdministratorRole({ applicationId: APPLICATION_ID, version: 4 }, 'Now a practising nurse.',
      { grantedRole: 'nurse', verificationMethod: 'regulator_register', administratorLicence: { body: 'NMCN', number: 'RN 1' } }))
      .resolves.toEqual({ applicationId: APPLICATION_ID, version: 5, grantedRole: 'nurse', sessionsRevoked: 2 })
    await expect(adminApi.endSelfServiceProbation({ applicationId: APPLICATION_ID, version: 5 }, 'Busy emergency unit.'))
      .resolves.toEqual({ applicationId: APPLICATION_ID, version: 6, probationEndedAt: '2026-10-26T09:00:00.000Z' })
    const posts = calls.filter(call => call.method === 'POST')
    expect(posts.map(call => [call.path, call.body, call.headers.get('if-match'), call.headers.has('idempotency-key')])).toEqual([
      [`/api/v1/admin/self-service-facilities/${APPLICATION_ID}/administrator-role`, { grantedRole: 'nurse',
        verificationMethod: 'regulator_register', administratorLicence: { body: 'NMCN', number: 'RN 1' },
        reason: 'Now a practising nurse.' }, '"4"', false],
      [`/api/v1/admin/self-service-facilities/${APPLICATION_ID}/end-probation`, { reason: 'Busy emergency unit.' }, '"5"', false],
    ])
    for (const call of posts) expect(call.headers.get('x-csrf-token')).toBe('novu-proof')
  })

  it('reads a facility’s staff by its id, and finds an invitation by the reference in the query, never a facility header (P4b)', async () => {
    const calls = serve(READER)
    const { adminApi } = await import('../api')
    const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
    await expect(adminApi.facilityStaff(FACILITY)).resolves.toMatchObject({ members: [], invitations: [] })
    await expect(adminApi.findStaffInvitations('3F2A9C1B')).resolves.toEqual({ items: [] })
    expect(calls.filter(call => call.path.includes('staff')).map(call => [call.method, call.path, call.search,
      call.headers.has('x-facility-id')])).toEqual([
      ['GET', `/api/v1/admin/facilities/${FACILITY}/staff`, '', false],
      ['GET', '/api/v1/admin/staff-invitations', '?reference=3F2A9C1B', false],
    ])
  })

  it('says an Identity without the staff reads has none, not the router’s words (P4b)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET …' }, 404)))
    const { adminApi } = await import('../api')
    await expect(adminApi.facilityStaff('0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f')).rejects.toMatchObject({ status: 404,
      code: 'FACILITY_STAFF_UNAVAILABLE' })
    await expect(adminApi.findStaffInvitations('3F2A9C1B')).rejects.toMatchObject({ status: 404,
      code: 'STAFF_INVITATION_LOOKUP_UNAVAILABLE' })
  })

  it('sends a release with If-Match, the reason and the CSRF token, and no Idempotency-Key (P4 round 2)', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.releaseSelfServiceFacility({ applicationId: APPLICATION_ID, version: 4 }, 'The company did not sign up.'))
      .resolves.toEqual({ applicationId: APPLICATION_ID, releasedAt: '2026-10-24T13:00:00.000Z', version: 5 })
    const release = calls.find(call => call.path.endsWith('/release'))!
    expect(release).toMatchObject({ method: 'POST', path: `/api/v1/admin/self-service-facilities/${APPLICATION_ID}/release` })
    expect(release.body).toEqual({ reason: 'The company did not sign up.' })
    expect(release.headers.get('if-match')).toBe('"4"')
    expect(release.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(release.headers.has('idempotency-key')).toBe(false)
    expect(release.headers.has('x-facility-id')).toBe(false)
    expect(() => adminApi.releaseSelfServiceFacility({ applicationId: APPLICATION_ID, version: 0 }, 'The company did not sign up.'))
      .toThrow('Reload this item before changing it.')
  })

  it('lists open applications with one GET and no query, and rejects one with If-Match, the reason and the CSRF token (P4 round 2)', async () => {
    const calls = serve(READER, [{ applicationId: APPLICATION_ID, version: 2 }])
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.selfServiceApplications()).resolves.toEqual({ total: 1,
      items: [{ applicationId: APPLICATION_ID, version: 2 }] })
    expect(calls.filter(call => call.path === '/api/v1/admin/self-service-applications').map(call => [call.method, call.search]))
      .toEqual([['GET', '']])
    await expect(adminApi.rejectSelfServiceApplication({ applicationId: APPLICATION_ID, version: 2 }, 'Not the company’s own.'))
      .resolves.toEqual({ applicationId: APPLICATION_ID, rejectedAt: '2026-10-24T14:00:00.000Z', version: 3 })
    const reject = calls.find(call => call.path.endsWith('/reject'))!
    expect(reject).toMatchObject({ method: 'POST', path: `/api/v1/admin/self-service-applications/${APPLICATION_ID}/reject` })
    // Without allowRetry the body is the one an Identity before hid-system R15 takes too.
    expect(reject.body).toEqual({ reason: 'Not the company’s own.' })
    expect(reject.headers.get('if-match')).toBe('"2"')
    expect(reject.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(reject.headers.has('idempotency-key')).toBe(false)
  })

  it('sends allowRetry: true with a rejection or release only when support lets the applicant start again (R15)', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await adminApi.rejectSelfServiceApplication({ applicationId: APPLICATION_ID, version: 2 }, 'The applicant mistyped the email.', true)
    await adminApi.releaseSelfServiceFacility({ applicationId: APPLICATION_ID, version: 4 }, 'The company’s own, wrong email.', true)
    await adminApi.rejectSelfServiceApplication({ applicationId: APPLICATION_ID, version: 3 }, 'Not the company’s own.', false)
    expect(calls.filter(call => call.method === 'POST').map(call => [call.path.split('/').slice(-1)[0], call.body,
      call.headers.get('if-match')])).toEqual([
      ['reject', { reason: 'The applicant mistyped the email.', allowRetry: true }, '"2"'],
      ['release', { reason: 'The company’s own, wrong email.', allowRetry: true }, '"4"'],
      ['reject', { reason: 'Not the company’s own.' }, '"3"'],
    ])
  })

  it('finds one CAC number’s open applications with a POST, the number in the body, never in the address (R16)', async () => {
    const calls = serve(READER, [{ applicationId: APPLICATION_ID, version: 2, holdsCac: true }])
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.searchSelfServiceApplications('RC1234521')).resolves.toEqual({ total: 1,
      items: [{ applicationId: APPLICATION_ID, version: 2, holdsCac: true }] })
    const search = calls.find(call => call.path.endsWith('/search'))!
    expect(search).toMatchObject({ method: 'POST', path: '/api/v1/admin/self-service-applications/search', search: '',
      body: { cacRegistrationNumber: 'RC1234521' } })
    expect(search.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(search.headers.has('if-match')).toBe(false)
    expect(search.headers.has('x-facility-id')).toBe(false)
  })

  it('says an Identity without the search can’t search, not the router’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 404, code: 'NOT_FOUND',
      detail: 'Cannot POST /api/v1/admin/self-service-applications/search' }, 404)))
    const { adminApi } = await import('../api')
    await expect(adminApi.searchSelfServiceApplications('RC1234521')).rejects.toMatchObject({ status: 404,
      code: 'SELF_SERVICE_APPLICATION_SEARCH_UNAVAILABLE' })
  })

  it('lifts a refusal with one POST: the CAC number, product and reason, the CSRF token, no If-Match or Idempotency-Key (R15)', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.waiveSelfServiceRefusals({ cacRegistrationNumber: 'RC1234521', productCode: 'pharmacy',
      reason: 'The company’s own administrator.' })).resolves.toEqual({ waived: [{ applicationId: APPLICATION_ID,
      waivedAt: '2026-10-25T09:00:00.000Z', version: 6 }] })
    const waive = calls.find(call => call.path.endsWith('/waive-refusal'))!
    expect(waive).toMatchObject({ method: 'POST', path: '/api/v1/admin/self-service-applications/waive-refusal' })
    expect(waive.body).toEqual({ cacRegistrationNumber: 'RC1234521', productCode: 'pharmacy',
      reason: 'The company’s own administrator.' })
    expect(waive.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(waive.headers.has('if-match')).toBe(false)
    expect(waive.headers.has('idempotency-key')).toBe(false)
  })

  it('opens the open applications view from its address, through the registered route', async () => {
    const calls = serve(READER, [{ applicationId: APPLICATION_ID, version: 2, productCode: 'ehr', organizationType: 'hospital',
      cacHint: 'RC****21', organizationName: 'SURULERE CLINIC LTD', administratorName: 'Tunde Bello',
      administratorEmail: 'tunde@example.test', status: 'ready_for_review', verificationResult: 'verified', emailVerified: true,
      submittedAt: '2026-10-24T08:00:00.000Z', lapsesAt: '2026-10-24T08:00:00.000Z', holdsCac: false }])
    await openAt('/admin/self-service-facilities?state=open')
    expect(await screen.findByRole('heading', { name: 'SURULERE CLINIC LTD', level: 2 })).toBeTruthy()
    expect(calls.some(call => call.path === '/api/v1/admin/self-service-facilities')).toBe(false)
    // The read permission alone shows the list, not the commands.
    expect(screen.queryByText('Reject', { selector: 'summary' })).toBeNull()
    expect(screen.queryByText('Lift a 7-day refusal', { selector: 'summary' })).toBeNull()
    expect(screen.getByText('Holds the CAC number', { selector: 'dt' }).nextElementSibling?.textContent).toMatch(/^No: /)
    expect(calls.filter(call => call.path.startsWith('/api/v1/admin/self-service-applications')).map(call => call.method))
      .toEqual(['GET'])
  })

  it('says an Identity without open applications has none, not the router’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 404, code: 'NOT_FOUND',
      detail: 'Cannot GET /api/v1/admin/self-service-applications' }, 404)))
    const { adminApi } = await import('../api')
    await expect(adminApi.selfServiceApplications()).rejects.toMatchObject({ status: 404, code: 'SELF_SERVICE_APPLICATIONS_UNAVAILABLE' })
  })

  it('says an Identity without self sign-up has no list, not the router’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 404, code: 'NOT_FOUND',
      detail: 'Cannot GET /api/v1/admin/self-service-facilities' }, 404)))
    const { adminApi } = await import('../api')
    await expect(adminApi.selfServiceFacilities('unreviewed')).rejects.toMatchObject({ status: 404, code: 'SELF_SERVICE_REVIEW_UNAVAILABLE' })
  })
})

describe('New facility sign-ups in a main-v1 console', () => {
  it('is neither linked nor routed, and the backend is not asked', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const { NAVIGATION_ITEMS, isServed, visibleNavigation } = await import('../navigation')
    expect(NAVIGATION_ITEMS.filter(item => !isServed(item)).map(item => item.path)).toContain('/admin/self-service-facilities')
    expect(visibleNavigation(actor([...READER, 'platform.facility.manage'])).flatMap(section => section.items.map(item => item.title)))
      .not.toContain('New facility sign-ups')
  })

  it('answers the address with page not found', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const calls = serve([...READER, 'platform.facility.manage'])
    await openAt('/admin/self-service-facilities')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(calls.some(call => call.path.includes('self-service'))).toBe(false)
  })
})
