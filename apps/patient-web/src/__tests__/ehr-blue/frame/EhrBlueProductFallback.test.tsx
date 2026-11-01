import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { LAB_WORK, REAL_FACILITY, SESSION, facility, homeHeading, json, openStaffApp, serve, sessionAt, where } from './blueHarness'

/**
 * A product's own site (lab., outreach., migrate.) opens its own page at /provider, as long as this session may open
 * it. When it may not, /provider is the Overview (Home), as today's portal lands there (staff/navigation.ts
 * staffLandingPath, the parity report's 3.1 #15): the product's page would only refuse. Run on the real, merged
 * registry, at a fictional clinic. The address is only the page's own (jsdom's URL): nothing is sent there, and every
 * request goes to the stubbed fetch.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
beforeEach(() => { jsdom.reconfigure({ url: servedFrom }) })
afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)

/** Opens the staff app at /provider on a product's site, for a person at a fictional clinic holding `permissions`. */
async function openOn(host: string, permissions: readonly string[], routes: Record<string, (() => Response)[]> = {}) {
  jsdom.reconfigure({ url: `https://${host}/provider` })
  const clinic = facility(REAL_FACILITY, 'Riverside Diagnostics (fictional)', permissions, ['org_admin'])
  const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])], ...routes })
  await openStaffApp('/provider')
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

/** The phone tab bar's first tab: the product's own page, or Home when that page is not open to this session. */
const firstTab = () => within(screen.getByRole('navigation', { name: 'Quick' })).getAllByRole('link')[0]!

/** A link in the sidebar's menu, by its name. */
const menuLink = (name: string) => within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name })

// Facility audit only: an administrator who holds none of the product's own permissions.
const ADMIN_ONLY = ['audit.read']

describe('a product site whose own page this session may not open', () => {
  it.each([
    ['lab.healthidentitydirectory.com', 'Laboratory unavailable', '/lab/'],
    ['outreach.healthidentitydirectory.com', 'Outreach unavailable', '/outreach/'],
    ['migrate.healthidentitydirectory.com', 'Document OCR unavailable', '/ocr/'],
  ])('on %s, opens the Overview at /provider instead of the refusal, and reads none of the product\'s work', async (host, refusal, api) => {
    const sent = await openOn(host, ADMIN_ONLY)
    const [heading] = await screen.findAllByRole('heading', { level: 1 })
    // The address stays /provider: it no longer moves on to the product's page, which would refuse.
    expect(where()).toBe('/provider')
    expect(screen.queryByRole('heading', { name: refusal })).toBeNull()
    expect(heading!.textContent).toMatch(homeHeading())
    // Home says what today's Overview says to a role without clinical work, in plain words.
    expect(screen.getByText('You have no clinical work at this facility yet. Ask an administrator to check your role.')).toBeDefined()
    expect(sent.some(call => call.route.includes(api))).toBe(false)
  })

  it('lists Home in the menu and leads its first tab there, instead of to the product page that would refuse', async () => {
    await openOn('lab.healthidentitydirectory.com', ADMIN_ONLY)
    await screen.findAllByRole('heading', { level: 1 })
    expect(menuLink('Home')?.getAttribute('href')).toBe('/provider')
    expect(firstTab().getAttribute('href')).toBe('/provider')
    expect(firstTab().textContent).toBe('Home')
  })
})

describe('a product site whose own page this session may open', () => {
  it.each([
    ['lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/laboratory/work', { [LAB_WORK]: many(() => json({ items: [] })) }],
    ['outreach.healthidentitydirectory.com', ['outreach.registration.read'], '/provider/outreach', {}],
    ['migrate.healthidentitydirectory.com', ['ocr.job.read'], '/provider/ocr', {}],
  ] as const)('on %s, still opens the product\'s own page at /provider', async (host, permissions, page, routes) => {
    await openOn(host, permissions, routes)
    await waitFor(() => expect(where()).toBe(page))
    expect(screen.queryByRole('heading', { level: 1, name: homeHeading() })).toBeNull()
  })

  it('keeps its first tab on the product\'s own page, under the product\'s name, and lists no Home', async () => {
    await openOn('lab.healthidentitydirectory.com', ['lab.work-item.read'], { [LAB_WORK]: many(() => json({ items: [] })) })
    await waitFor(() => expect(where()).toBe('/provider/laboratory/work'))
    expect(menuLink('Home')).toBeNull()
    expect(firstTab().getAttribute('href')).toBe('/provider/laboratory')
    expect(firstTab().textContent).toBe('Lab')
  })
})
