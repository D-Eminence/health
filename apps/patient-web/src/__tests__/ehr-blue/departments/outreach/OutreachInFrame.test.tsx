import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import type { StaffSession } from '../../../../staff/api'
import { outreachPage } from '../../../../ehr-blue/departments/outreach/page'
import { SESSION, facility, json, openStaffApp, serve, sessionAt } from '../../frame/blueHarness'

/*
 * Outreach inside the blue EHR's frame, as today's page opens it: with campaign or registration read, each reading only
 * what it allows, and listed in the sidebar with registration read (staff/navigation.ts). With neither, its address says
 * what it needs. Every account, facility, campaign and case is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { outreachPage: page } = await import('../../../../ehr-blue/departments/outreach/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [page] } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

// Demo Outreach, one of the four sealed demo facilities the blue EHR opens at.
const DEMO_OUTREACH_ID = '98d00002-0000-4000-8000-000000000004'
const CAMPAIGNS = 'GET /api/v1/outreach/registration-cases/campaigns'
const CASES = 'GET /api/v1/outreach/registration-cases'
const campaign = { id: 'c0a00000-0000-4000-8000-000000000001', name: 'Demo screening week', status: 'active', services: ['registration'],
  startsAt: '2026-10-01T00:00:00.000Z', rowVersion: 1 }

const demoOutreach = (permissions: readonly string[]) => facility(DEMO_OUTREACH_ID, 'Demo Outreach', permissions, ['nurse'])

function sessionWith(permissions: readonly string[]): StaffSession {
  const current = demoOutreach(permissions)
  return { actor: { id: 'staff-demo-1', email: 'demo.nurse@example.test', displayName: 'Demo Nurse', roles: ['nurse'], permissions: [],
    facilities: [current], facility: current }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

describe('the page entry', () => {
  it('opens with campaign or registration read, as today\'s page does, and is listed with registration read', () => {
    expect(outreachPage.permission).toBeUndefined()
    expect(outreachPage.visible?.(sessionWith(['outreach.campaign.read']))).toBe(true)
    expect(outreachPage.visible?.(sessionWith(['outreach.registration.read']))).toBe(true)
    expect(outreachPage.visible?.(sessionWith(['ehr.encounter.read']))).toBe(false)
    expect(outreachPage.listed?.(sessionWith(['outreach.campaign.read']))).toBe(false)
    expect(outreachPage.listed?.(sessionWith(['outreach.registration.read']))).toBe(true)
  })
})

describe('a membership with campaign read only', () => {
  it('opens Outreach at its address and shows the campaigns, reading no registration cases, with no sidebar entry', async () => {
    const demo = demoOutreach(['outreach.campaign.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAMPAIGNS]: [() => json([campaign]), () => json([campaign])] })
    await openStaffApp('/provider/outreach')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: 'Outreach' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Outreach')
    expect(await screen.findByText('Demo screening week')).toBeDefined()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    await waitFor(() => expect(sent.filter(request => request.route === CAMPAIGNS).length).toBeGreaterThan(0))
    expect(sent.filter(request => request.route === CASES)).toHaveLength(0)
  })
})

describe('a membership with registration read', () => {
  it('lists Outreach in the sidebar and opens it', async () => {
    const demo = demoOutreach(['outreach.registration.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CASES]: [() => json([]), () => json([])] })
    await openStaffApp('/provider/outreach')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Outreach' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(sent.filter(request => request.route === CASES).length).toBeGreaterThan(0))
    expect(sent.filter(request => request.route === CAMPAIGNS)).toHaveLength(0)
  })
})

describe('a membership with neither', () => {
  it('says at its address what Outreach needs, reading nothing', async () => {
    const demo = demoOutreach(['ehr.encounter.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/outreach')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: 'Outreach' })).toBeNull()
    expect(screen.getByText('Permission denied. This membership or branch cannot open this module: it needs outreach campaign or '
      + 'registration read permission.')).toBeDefined()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(sent.filter(request => request.route === CAMPAIGNS || request.route === CASES)).toHaveLength(0)
  })
})
