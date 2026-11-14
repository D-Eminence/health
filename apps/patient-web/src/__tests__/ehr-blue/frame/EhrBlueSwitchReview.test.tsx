import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, REAL_FACILITY, REQUESTS, SESSION, accountButton, facility, homeHeading, json, openStaffApp, serve, sessionAt,
  where, withFramePages,
} from './blueHarness'

/**
 * The switch review's frame items: the demo's sample dashboards only at the demo facilities, Choose workspace as the
 * live facility switch, the page hidden under the lock screen, and today's pages left to refuse only where they read
 * nothing first. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The clinic switch as it ships, unless a test turns it on (switchedOn): a vi.doMock outlives the test that made it.
beforeEach(() => { withFramePages(); vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false })) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const ANNEX = 'f0000000-0000-4000-8000-000000000002'

/** The blue EHR at every facility: the clinic switch on, and both page sets present (as pageSets.ts lists them). */
function switchedOn() {
  vi.doMock('../../../ehr-blue/pageSets', () => ({
    PAGE_FILES: ['./clinical/pages.ts', './departments/pages.ts', './frame/pages.ts', './home/pages.ts'],
  }))
  vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
}

describe('2. the demo\'s sample dashboards, and Choose workspace as the live facility switch', () => {
  it('offers no "View Home as a demo role" at a clinic', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(riverside, [riverside])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    fireEvent.click(accountButton())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    expect(screen.queryByText('View Home as a demo role (sample)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Platform Super Admin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Doctor' })).toBeNull()
  })

  // The top-bar account menu and its sample items were removed (the sidebar's switcher and sign-out replace it): the
  // demo facilities are offered no sample dashboards either.
  it('offers none at a demo facility either', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    fireEvent.click(accountButton())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'View Home as a demo role (sample)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Doctor' })).toBeNull()
  })

  it('opens Choose workspace from Switch facility as a page of its own, with no sidebar entry (admin/institutions)', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', [])
    const annex = facility(ANNEX, 'Riverside Annex (fictional)', [])
    serve({ [SESSION]: [sessionAt(riverside, [riverside, annex])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    const choose = within(nav()).getByRole('link', { name: 'Choose workspace' })
    const home = within(nav()).getByRole('link', { name: 'Home' })
    // In the same, unheaded group as Home.
    expect(choose.closest('ul')).toBe(home.closest('ul'))
    expect(within(nav()).queryByRole('button', { name: 'Design review' })).toBeNull()
    fireEvent.click(choose)
    expect(await screen.findByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
  })

  it('names the tab Choose workspace, not today\'s Page not found', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const laboratory = facility(DEMO_LABORATORY, 'Demo Laboratory', [])
    serve({ [SESSION]: [sessionAt(demo, [demo, laboratory])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    fireEvent.click(within(nav()).getByRole('link', { name: 'Choose workspace' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
    expect(where()).toBe('/provider/institutions')
    await waitFor(() => expect(document.title).toBe('Choose workspace · Health ID EHR'))
  })

  // The design review is no longer listed, even at a demo facility (only working screens are).
  it('does not list it for someone with one facility, nor a design review at a demo', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    expect(within(nav()).queryByRole('link', { name: 'Choose workspace' })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: 'Design review' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'What’s left' })).toBeNull()
  })
})

describe('3. the page is hidden under the lock screen', () => {
  /** Away for over a minute, and the check on return gets an answer the portal cannot read: the session stays locked. */
  async function lockAfterAway(setVisibility: (state: DocumentVisibilityState) => void, advance: () => void) {
    act(() => {
      setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange'))
      advance()
      setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange'))
    })
    await screen.findByRole('button', { name: 'Try again' })
  }

  function awayClock() {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    return { set: (state: DocumentVisibilityState) => { visibility = state }, advance: () => { now += 61_000 } }
  }

  it('hides the frame\'s main content while the session is checked', async () => {
    const clock = awayClock()
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo]), () => json({})] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    const main = document.getElementById('main-content')!
    expect(main.tagName).toBe('MAIN')
    expect(main.hidden).toBe(false)
    await lockAfterAway(clock.set, clock.advance)
    expect(main.hidden).toBe(true)
  })

  it('hides the workspace chooser\'s main content too', async () => {
    const clock = awayClock()
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const laboratory = facility(DEMO_LABORATORY, 'Demo Laboratory', [])
    serve({ [SESSION]: [sessionAt(undefined, [hospital, laboratory], 'default'), () => json({})] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Where are you working today?' })).toBeDefined()
    const main = document.getElementById('main-content')!
    expect(main.tagName).toBe('MAIN')
    expect(main.hidden).toBe(false)
    await lockAfterAway(clock.set, clock.advance)
    expect(main.hidden).toBe(true)
  })
})

describe('5. today\'s page refuses only where it reads nothing first', () => {
  const NOTICE = 'Your current permissions no longer allow that page. Choose an authorized workflow.'

  async function standIns() {
    const { TODAY_PATHS } = await import('../../../ehr-blue/frame/pages')
    return [...TODAY_PATHS]
  }

  it('leaves Access requests and Clinical record to the frame, which sends Home: they read before refusing', async () => {
    for (const path of ['requests', 'clinical']) {
      vi.resetModules()
      withFramePages()
      const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
      const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
      const { unmount } = await openStaffApp(`/provider/${path}`)
      expect(await screen.findByText(NOTICE)).toBeDefined()
      expect(where()).toBe('/provider')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(sent.map(call => call.route)).toEqual([SESSION])
      unmount()
    }
  })

  it('lets every other stand-in, with no permissions, send nothing but the session read', async () => {
    const paths = (await standIns()).filter(path => path !== 'requests' && path !== 'clinical')
    expect(paths.length).toBeGreaterThan(5)
    for (const path of paths) {
      vi.resetModules()
      withFramePages()
      const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
      const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
      const { unmount } = await openStaffApp(`/provider/${path}`)
      await waitFor(() => expect({ path, h1: document.querySelector('.hid-ehr-blue-live h1') !== null }).toEqual({ path, h1: true }))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect({ path, routes: sent.map(call => call.route) }).toEqual({ path, routes: [SESSION] })
      unmount()
    }
  })
})
