import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link } from 'react-router-dom'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, FACILITY, REAL_FACILITY, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, serve,
  sessionAt, where, withFramePages,
} from './blueHarness'

/**
 * Parity report rows of the "home, frame and access" group (docs/BLUE_EHR_PARITY_2026-11-01.md 15c, 3.3-47, 3.3-48,
 * 3.3-49, 3.3-51, 3.3-53, 3.3-56, 3.3-57): the blue frame and Home say and do what the classic portal did. Every account,
 * facility and patient here is fictional, and every request goes to the stubbed fetch.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
beforeEach(() => { jsdom.reconfigure({ url: servedFrom }) })
afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const menu = () => within(screen.getByRole('navigation', { name: 'Main navigation' }))

/** Opens the staff app on `host` (or the test's own address) for one fictional facility holding `permissions`. */
async function openAt(host: string | null, permissions: readonly string[], path = '/provider', routes: Record<string, (() => Response)[]> = {}) {
  if (host) jsdom.reconfigure({ url: `https://${host}${path}` })
  const clinic = facility(REAL_FACILITY, 'Riverside Diagnostics (fictional)', permissions, ['org_admin'])
  const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])], [REQUESTS]: many(() => json([])), ...routes })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('15c: Facility subscription is in every product site\'s menu, by its permission', () => {
  it.each(['lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com',
    'migrate.healthidentitydirectory.com'])('on %s', async host => {
    await openAt(host, ['audit.read', 'billing.subscription.read'])
    // Under the folded Settings group.
    fireEvent.click(menu().getByRole('button', { name: 'Settings' }))
    expect(menu().getByRole('link', { name: 'Facility subscription' }).getAttribute('href')).toBe('/provider/billing')
  })

  it('and not without its permission', async () => {
    await openAt('lab.healthidentitydirectory.com', ['audit.read'])
    const settings = menu().queryByRole('button', { name: 'Settings' })
    if (settings) fireEvent.click(settings)
    expect(menu().queryByRole('link', { name: 'Facility subscription' })).toBeNull()
  })
})

describe('3.3-53: Home greets as classic\'s Overview did; a product site keeps its own page first', () => {
  it('says classic\'s greeting and description', async () => {
    await openAt(null, ['identity.patient.read'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Good to see you, Demo.' })).toBeDefined()
    expect(screen.getByText('Provider workspace')).toBeDefined()
    expect(screen.getByText('Working at Riverside Diagnostics (fictional). All clinical activity uses your current membership and is checked by Health ID.')).toBeDefined()
  })

  // Owner's decision (24 November 2026, "Migrate works as before"): on a product site whose own page this session can
  // use, that page leads the menu and no Home is listed, as before website release C. This beats 3.3-53's Home on every
  // site there; the full EHR site keeps Home (above).
  it('lists the product\'s own page first, and no Home, on a product site whose own page opens', async () => {
    await openAt('outreach.healthidentitydirectory.com', ['outreach.registration.read'], '/provider', {
      'GET /api/v1/outreach/registration-cases/campaigns': many(() => json({ items: [] })),
    })
    await waitFor(() => expect(where()).toBe('/provider/outreach'))
    const links = menu().getAllByRole('link')
    expect(links[0]!.getAttribute('href')).toBe('/provider/outreach')
    expect(menu().queryByRole('link', { name: 'Home' })).toBeNull()
  })
})

describe('3.3-56, 3.3-57: Home\'s Workspaces card and Health ID Migrate card, in classic\'s words', () => {
  it('lists the workspaces this role holds here, with classic\'s words and link', async () => {
    await openAt(null, ['identity.patient.read', 'ehr.encounter.read'])
    const card = within(await screen.findByRole('region', { name: 'Workspaces' }))
    expect(card.getByText('Patient access')).toBeDefined()
    expect(card.getByText('Look up a Health ID after consent, patient PIN, or emergency authorization.')).toBeDefined()
    expect(card.getByText('Clinical record')).toBeDefined()
    expect(card.getAllByText('Open workspace')).toHaveLength(2)
    expect(card.queryByText(/no clinical modules/)).toBeNull()
  })

  it('says a role with none of them has no clinical module, never in "permission" words', async () => {
    await openAt(null, ['audit.read'])
    const card = within(await screen.findByRole('region', { name: 'Workspaces' }))
    expect(card.getByText('Your active facility has no clinical modules for your role. Ask an administrator to review your assignment.')).toBeDefined()
    expect(card.queryByText(/permission/i)).toBeNull()
  })

  it('says the other workspaces are on other Health ID sites, linked in the sidebar', async () => {
    await openAt('lab.healthidentitydirectory.com', ['audit.read', 'pharmacy.work-item.read'], '/provider/audit')
    fireEvent.click(menu().getByRole('link', { name: 'Home' }))
    const card = within(await screen.findByRole('region', { name: 'Workspaces' }))
    expect(card.getByText('Your other workspaces are on other Health ID sites, linked in the sidebar.')).toBeDefined()
  })

  it('shows Health ID Migrate for a role that reads document jobs, and not otherwise', async () => {
    await openAt(null, ['identity.patient.read', 'ocr.job.read'])
    const card = within(await screen.findByRole('region', { name: 'Health ID Migrate' }))
    expect(card.getByText('Document capture, extraction, validation, and publication.')).toBeDefined()
    expect(card.getByRole('link', { name: 'Open document workflow' }).getAttribute('href')).toBe('/provider/ocr')
  })

  it('shows no Health ID Migrate card without ocr.job.read', async () => {
    await openAt(null, ['identity.patient.read'])
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    expect(screen.queryByRole('region', { name: 'Health ID Migrate' })).toBeNull()
  })
})

describe('3.3-47, 3.3-48: Where are you working?', () => {
  it('asks with classic\'s heading and sentence, a radio choice and Continue, and says "Choose a facility to continue."', async () => {
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    const sent = serve({ [SESSION]: [sessionAt(undefined, [hospital, lab], 'default')], [FACILITY]: [sessionAt(hospital, [hospital, lab], 'selected')],
      [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Where are you working?' })).toBeDefined()
    expect(screen.getByText('You work at more than one facility. Choose where you are working before you continue. Patient access, records and requests use the facility you choose, and you can switch later from “Working at”.')).toBeDefined()
    // Nothing is preselected, and Continue with nothing chosen says so and sends nothing.
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).checked).toBe(false)
    // Said at the options, which Continue moves focus into, as classic's FacilityChoice does (an alert only for Enter on
    // an option: ParityFrameChooserSignIn.test.tsx).
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)
    expect(screen.getByText('Choose a facility to continue.')).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /^Demo Hospital/ }))
    expect(sent.some(call => call.route === FACILITY)).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: /^Demo Hospital/ }))
    expect(screen.queryByText('Choose a facility to continue.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: DEMO_HOSPITAL }])
  })
})

describe('3.3-49: Switch facility asks in place first', () => {
  it('asks "You are working at X. Switch to Y?" in the facility menu, and Cancel switches nothing', async () => {
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    const sent = serve({ [SESSION]: [sessionAt(hospital, [hospital, lab])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    fireEvent.click(screen.getByRole('button', { name: /^Demo Hospital/ }))
    expect(screen.getByText('Working at')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Demo Laboratory' }))
    const question = screen.getByRole('group', { name: 'You are working at Demo Hospital. Switch to Demo Laboratory?' })
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Switch to Demo Laboratory\?/)).toBeNull()
    expect(sent.some(call => call.route === FACILITY)).toBe(false)
  })

  it('on the Switch facility page, asks the same in place, with classic\'s sentence, before anything is sent', async () => {
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    const sent = serve({ [SESSION]: [sessionAt(hospital, [hospital, lab])], [FACILITY]: [sessionAt(lab, [hospital, lab], 'selected')],
      [REQUESTS]: many(() => json([])), 'GET /api/v1/lab/work-items': many(() => json({ items: [] })) })
    await openStaffApp('/provider/institutions')
    expect(await screen.findByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
    expect(screen.getByText('Patient access, records and requests use the facility you choose.')).toBeDefined()
    expect((screen.getByRole('radio', { name: /^Demo Hospital/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /^Demo Laboratory/ }))
    const question = screen.getByRole('group', { name: 'You are working at Demo Hospital. Switch to Demo Laboratory?' })
    expect(sent.some(call => call.route === FACILITY)).toBe(false)
    fireEvent.click(within(question).getByRole('button', { name: 'Switch facility' }))
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: DEMO_LABORATORY }])
  })
})

describe('3.3-51: the tab title is the blue page\'s on every move', () => {
  it('names the tab again on a move between two addresses that share one label, after classic\'s ProviderTitle renamed it', async () => {
    // A blue page below an address classic names ("Facility audit"), and one below it classic does not know.
    withFramePages(() => [{ path: 'audit/*', group: 'Insight', label: 'Audit trail', status: 'live', permission: 'audit.read',
      element: <Link to="/provider/audit">Newest events (fictional)</Link> }])
    await openAt(null, ['audit.read'], '/provider/audit/older')
    await waitFor(() => expect(document.title).toBe('Audit trail · Health ID EHR'))
    fireEvent.click(screen.getByRole('link', { name: 'Newest events (fictional)' }))
    await waitFor(() => expect(where()).toBe('/provider/audit'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.title).toBe('Audit trail · Health ID EHR')
  })
})
