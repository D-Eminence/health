import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'

/*
 * HR & Credentials inside the blue EHR's frame, in place of its stand-in: a record link from Home's dashboards or the
 * Notifications drawer (/provider/hr/<id>, an id from the frame's own sample store) opens the page's list at
 * /provider/hr, not "Page not found". Every account, facility and record is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The frame's own registry and Home, with this page joining it as departments/pages.ts does. Registered per test: a
// vi.mock factory's module outlives vi.resetModules.
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { hrPage } = await import('../../../../ehr-blue/departments/hr/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [hrPage] } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const STAFF = 'GET /api/v1/identity/facility-staff'

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

describe('a record link from Home or the Notifications drawer', () => {
  it('opens HR & Credentials’ list at /provider/hr, not "Page not found", reading the staff once', async () => {
    const demo = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin']),
      selfService: { review: 'reviewed', organizationType: 'hospital' } }
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [STAFF]: [() => json(staff), () => json(staff)] })
    await openStaffApp('/provider/hr/5a000001')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(where()).toBe('/provider/hr'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HR & Credentials')
    expect(screen.queryByText('Page not found')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'HR & Credentials' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('button', { name: 'No licence on record' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Search sample records' })).toBeDefined()
    expect(sent.filter(request => request.route === STAFF)).toHaveLength(1)
  })
})
