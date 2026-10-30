import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import type { StaffSession } from '../../../../staff/api'
import { staffAccessPage } from '../../../../ehr-blue/departments/staff/page'
import { DEMO_HOSPITAL, SESSION, facility, json, openStaffApp, serve, sessionAt } from '../../frame/blueHarness'

/*
 * Staff & access inside the blue EHR's frame, listed only where today's sidebar lists Staff: a facility that signed itself
 * up, on Novu. At a governed facility Health ID support manages who works there, so the page is left out of the sidebar
 * and search (visible()), and nothing reads its staff. Every account and facility is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { staffAccessPage: page } = await import('../../../../ehr-blue/departments/staff/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [page] } }),
    }
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const STAFF = 'GET /api/v1/identity/facility-staff'
const SELF_SIGNED = { selfService: { review: 'reviewed', organizationType: 'hospital' } }

const governed = () => facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin'])
const selfSigned = () => ({ ...governed(), ...SELF_SIGNED })

const staff = {
  facility: { id: DEMO_HOSPITAL, name: 'Demo Hospital', organizationType: 'hospital', reviewState: 'reviewed', firstThirtyDaysEndAt: null,
    invitationsOpen: true, deliveryPaused: false },
  canInvite: true,
  limits: { pendingInvitations: 0, pendingLimit: 100, invitationsToday: 0, invitationsPerDay: 30, emailsToday: 0, emailsPerDay: 60 },
  inviteOptions: { roles: [], attestation: null }, administratorLicence: null, administratorLicenceBodies: [],
  members: [{ membershipId: '5e0a1b2c-0000-4000-8000-00000000a001', version: 1, accountId: 'account-demo-1', name: 'Demo Administrator',
    email: 'demo.admin@example.test', roles: ['org_admin'], isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z', licence: null }],
  invitations: [],
}

function sessionWith(current: ReturnType<typeof governed>): StaffSession {
  return { actor: { id: 'staff-demo-1', email: 'demo.admin@example.test', displayName: 'Demo Administrator', roles: ['org_admin'],
    permissions: [], facilities: [current], facility: current }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

describe('the page entry', () => {
  it('shows only where today\'s sidebar shows Staff: a self-signed-up facility, on Novu', () => {
    expect(staffAccessPage.visible?.(sessionWith(selfSigned()))).toBe(true)
    expect(staffAccessPage.visible?.(sessionWith(governed()))).toBe(false)
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(staffAccessPage.visible?.(sessionWith(selfSigned()))).toBe(false)
  })
})

describe('at a governed facility', () => {
  it('leaves Staff & access out of the sidebar and search, and its address reads no staff', async () => {
    const demo = governed()
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/staff')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: 'Staff & access' })).toBeNull()
    // The frame refuses the address; nothing of the staff list shows and nothing asks for it.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Staff & access')
    expect(screen.queryByRole('heading', { name: 'Hospital memberships' })).toBeNull()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search Health ID' })
    fireEvent.change(within(search).getByRole('searchbox', { name: 'Search work areas' }), { target: { value: 'Staff' } })
    expect(within(search).queryByRole('link', { name: /Staff & access/ })).toBeNull()
    expect(sent.filter(request => request.route === STAFF)).toHaveLength(0)
  })
})

describe('at a self-signed-up facility', () => {
  it('lists Staff & access and opens it, reading the staff once', async () => {
    const demo = selfSigned()
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [STAFF]: [() => json(staff), () => json(staff)] })
    await openStaffApp('/provider/staff')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Staff & access' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(sent.filter(request => request.route === STAFF)).toHaveLength(1))
    expect(await screen.findByText('Demo Administrator')).toBeDefined()
  })
})
