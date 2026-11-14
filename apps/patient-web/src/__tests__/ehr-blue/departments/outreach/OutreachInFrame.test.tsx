import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import type { StaffSession } from '../../../../staff/api'
import { outreachPage } from '../../../../ehr-blue/departments/outreach/page'
import { SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'

/*
 * Outreach inside the blue EHR's frame, as today's page opens it: with campaign or registration read, each reading only
 * what it allows, and listed in the sidebar with registration read (staff/navigation.ts). With neither, its address says
 * Outreach isn't available yet, asking nobody. Every account, facility, campaign and case is fictional.
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
  it('lists Outreach in the sidebar (as Overview, Outreach on its own here, with no Campaigns without campaign read) and opens it', async () => {
    const demo = demoOutreach(['outreach.registration.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CASES]: [() => json([]), () => json([])] })
    await openStaffApp('/provider/outreach')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).queryByRole('link', { name: 'Campaigns' })).toBeNull()
    await waitFor(() => expect(sent.filter(request => request.route === CASES).length).toBeGreaterThan(0))
    expect(sent.filter(request => request.route === CAMPAIGNS)).toHaveLength(0)
  })
})

describe('a membership with neither', () => {
  it('says at its address that Outreach isn’t available yet, asking nobody and reading nothing', async () => {
    const demo = demoOutreach(['ehr.encounter.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/outreach')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: 'Outreach' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Outreach unavailable')
    expect(screen.getByText('Outreach isn’t available at your facility yet.')).toBeDefined()
    expect(screen.queryByText(/Ask your facility administrator/)).toBeNull()
    expect(screen.queryByText(/read permission/)).toBeNull()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(sent.filter(request => request.route === CAMPAIGNS || request.route === CASES)).toHaveLength(0)
  })
})

describe('Outreach on its own, inside a campaign, on a phone’s Menu', () => {
  // Owner, 13 November 2026: opening Menu inside a campaign kept nothing of it. Now the tab bar keeps the campaign's
  // Today, the Menu page lists the campaign's sections under its name, and closing the Menu shows the campaign as it was,
  // reading nothing again.
  const running = { ...campaign, id: 'c0a00000-0000-4000-8000-000000000002', name: 'Demo hepatitis drive', startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2099-12-31T00:00:00.000Z' }
  const at = `/api/v1/outreach/registration-cases/campaigns/${running.id}`
  const always = <T,>(answer: () => T) => Array.from({ length: 40 }, () => answer)
  const plan = { campaignId: running.id, organisationName: 'Demo Volunteers', target: 0, focuses: ['hepatitis_b'], sites: [],
    package: { vitals: [], tests: [], questions: [] }, stationMode: 'single', stations: ['register'], partners: [],
    consent: { text: 'Demo', version: '1' }, kits: [], rowVersion: 1 }

  it('keeps the campaign, its tab bar and its sections while the Menu opens and closes', async () => {
    const demo = demoOutreach(['outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read'])
    const sent = serve({
      [SESSION]: always(sessionAt(demo, [demo])),
      [CAMPAIGNS]: always(() => json([running])),
      [CASES]: always(() => json([])),
      [`GET ${at}/team`]: always(() => json({ members: [], you: { memberId: 'tm-1', roles: ['registrar'], siteId: null, station: null } })),
      [`GET ${at}/plan`]: always(() => json(plan)),
    })
    await openStaffApp('/provider/outreach')
    // Someone who only works in the field goes straight into the campaign running for them, on the capture page.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo hepatitis drive'), { timeout: 10000 })
    const title = screen.getByRole('heading', { level: 1 })
    const quick = screen.getByRole('navigation', { name: 'Quick' })
    // Their tab bar carries their own sections (owner, 14 Nov 2026), not the organisation's Overview and Campaigns; capturing
    // is a button, not a section.
    await waitFor(() => expect(within(quick).getAllByRole('link').map(link => link.textContent)).toEqual(['People']))
    await waitFor(() => expect(where()).toBe('/provider/outreach/today'))
    const reads = sent.filter(request => request.route === CAMPAIGNS).length

    await act(async () => { fireEvent.click(within(quick).getByRole('button', { name: 'Menu' })) })
    const menu = screen.getByRole('heading', { level: 1, name: 'Menu' })
    const lists = [...menu.closest('div')!.parentElement!.querySelectorAll('ul')]
    const groups = lists.map(list => [list.previousElementSibling?.textContent ?? '', [...list.querySelectorAll('a')].map(link => link.textContent)])
    expect(groups).toContainEqual(['Demo hepatitis drive', ['People']])
    expect(groups).toContainEqual(['', ['Campaigns']])
    expect(within(quick).getAllByRole('link').map(link => link.textContent)).toEqual(['People'])

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close menu' })) })
    expect(screen.getByRole('heading', { level: 1 })).toBe(title)
    expect(where()).toBe('/provider/outreach/today')
    expect(within(quick).getAllByRole('link').map(link => link.textContent)).toEqual(['People'])
    expect(sent.filter(request => request.route === CAMPAIGNS)).toHaveLength(reads)
    // No "Dashboard" anywhere in Outreach.
    expect(document.body.textContent).not.toMatch(/Dashboard/)
  })
})
