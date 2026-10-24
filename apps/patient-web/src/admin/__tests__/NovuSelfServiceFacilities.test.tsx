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
    if (target.pathname.endsWith('/review')) return json({ applicationId: APPLICATION_ID, reviewedAt: '2026-10-24T12:00:00.000Z', version: 4 })
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
    expect(organizations([...READER, 'platform.facility.read'])).toEqual(['Applications', 'New facility sign-ups', 'Facilities'])
    expect(organizations(['platform.admin.access', 'platform.facility.read', 'platform.facility.manage'])).toEqual(['Facilities'])
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

  it('sends a review with If-Match, the note and the CSRF token, and no Idempotency-Key', async () => {
    const calls = serve(READER)
    document.cookie = 'hid_access_csrf=novu-proof; path=/'
    const { adminApi } = await import('../api')
    await expect(adminApi.reviewSelfServiceFacility({ applicationId: APPLICATION_ID, version: 3 }, 'Called the hospital; confirmed.'))
      .resolves.toEqual({ applicationId: APPLICATION_ID, reviewedAt: '2026-10-24T12:00:00.000Z', version: 4 })
    const review = calls.find(call => call.path.endsWith('/review'))!
    expect(review).toMatchObject({ method: 'POST', path: `/api/v1/admin/self-service-facilities/${APPLICATION_ID}/review`,
      body: { note: 'Called the hospital; confirmed.' } })
    expect(review.headers.get('if-match')).toBe('"3"')
    expect(review.headers.get('x-csrf-token')).toBe('novu-proof')
    expect(review.headers.has('idempotency-key')).toBe(false)
    // A version that was never read is not sent.
    expect(() => adminApi.reviewSelfServiceFacility({ applicationId: APPLICATION_ID, version: 0 }, 'Called the hospital; confirmed.'))
      .toThrow('Reload this item before changing it.')
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
