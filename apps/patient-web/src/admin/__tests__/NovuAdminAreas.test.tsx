import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * Novu serves no two-person approvals, no administrator authenticator or
 * session list, and no single-session review: the production console neither
 * links nor routes those areas, and asks for none of them.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unauthorized = { status: 401, code: 'AUTHENTICATION_REQUIRED', detail: 'Valid authentication is required' }
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

/** Novu 0064's role_permissions for the support and auditor roles, and every code a Super Admin holds there. */
const SUPPORT_ADMIN = ['platform.admin.access', 'platform.principal.read', 'platform.session.revoke']
const SECURITY_AUDITOR = ['platform.admin.access', 'platform.audit.read', 'platform.integration.read', 'platform.operations.read']
const SUPER_ADMIN = ['platform.admin.access', 'platform.principal.read', 'platform.principal.manage', 'platform.role.manage',
  'platform.session.revoke', 'platform.audit.read', 'platform.facility.read', 'platform.identity-review.read']

beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  vi.resetModules()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

describe('the Novu admin navigation', () => {
  it('links neither approvals nor my security, whatever the administrator holds', async () => {
    const { NAVIGATION_ITEMS, canOpen, isServed, visibleNavigation } = await import('../navigation')
    const titles = (permissions: string[]) => visibleNavigation(actor(permissions)).flatMap(section => section.items.map(item => item.title))
    expect(titles(SUPPORT_ADMIN)).toEqual(['Overview', 'Users & roles'])
    expect(titles(SECURITY_AUDITOR)).toEqual(['Overview', 'Audit', 'Service health', 'Integrations'])
    expect(titles(SUPER_ADMIN)).not.toContain('Approvals')
    const unserved = NAVIGATION_ITEMS.filter(item => !isServed(item)).map(item => item.path)
    expect(unserved).toEqual(['/admin/approvals', '/admin/clinicians', '/admin/security'])
    expect(NAVIGATION_ITEMS.filter(item => !isServed(item)).some(item => canOpen(item, actor(SUPER_ADMIN)))).toBe(false)
  })

  it('still links both on the main backend', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const { visibleNavigation } = await import('../navigation')
    const titles = visibleNavigation(actor(SECURITY_AUDITOR)).flatMap(section => section.items.map(item => item.title))
    expect(titles).toEqual(['Overview', 'Approvals', 'Audit', 'My security', 'Service health', 'Integrations'])
  })
})

describe('the Novu admin workspace', () => {
  function serve(permissions: string[]) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname; calls.push(path)
      if (path === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-10-19T10:00:00Z' })
      if (path === '/api/v1/admin/overview') return json({ registeredPatients: 3, facilities: 2, verifiedFacilities: 2,
        suspendedFacilities: 0, activeStaffMemberships: 1, pendingIdentityReviews: 0 })
      if (path === '/api/v1/admin/organization-applications') return json({ items: [] })
      return json(unauthorized, 401)
    }))
    return calls
  }

  async function openAt(path: string) {
    const { App } = await import('../App')
    render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
  }

  it.each([['/admin/approvals'], ['/admin/security'], ['/admin/clinicians'], ['/admin/clinicians/0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a']])('answers %s with page not found, without asking the backend', async path => {
    const calls = serve(SUPER_ADMIN)
    await openAt(path)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Access denied' })).toBeNull()
    expect(document.title).toBe('Platform · Health ID Platform')
    expect(calls.filter(called => called.includes('/approvals') || called.includes('/sessions') || called.includes('/mfa')
      || called.includes('clinician'))).toEqual([])
  })

  it('shows no pending approvals on the overview of an administrator who manages roles', async () => {
    const calls = serve(SUPER_ADMIN)
    await openAt('/admin/overview')
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    await screen.findByRole('link', { name: 'Organization applications' })
    expect(screen.queryByRole('link', { name: 'Pending approvals' })).toBeNull()
    expect(calls).not.toContain('/api/v1/admin/approvals')
  })
})
