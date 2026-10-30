import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, withFramePages,
} from './blueHarness'

/**
 * The switch review's frame items: the demo's sample dashboards only at the demo facilities, Choose workspace as the
 * live facility switch, the page hidden under the lock screen, and today's pages left to refuse only where they read
 * nothing first. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
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
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const panel = screen.getByRole('region', { name: 'Account' })
    expect(within(panel).queryByText('View Home as a demo role (sample)')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Platform Super Admin' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Doctor' })).toBeNull()
  })

  it('offers them at a demo facility', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const panel = screen.getByRole('region', { name: 'Account' })
    expect(within(panel).getByRole('group', { name: 'View Home as a demo role (sample)' })).toBeDefined()
    expect(within(panel).getByRole('button', { name: 'Doctor' })).toBeDefined()
  })

  it('lists Choose workspace beside Home, out of the design review, for whoever has a facility to switch to', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', [])
    const annex = facility(ANNEX, 'Riverside Annex (fictional)', [])
    serve({ [SESSION]: [sessionAt(riverside, [riverside, annex])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    const choose = within(nav()).getByRole('link', { name: 'Choose workspace' })
    const home = within(nav()).getByRole('link', { name: 'Home' })
    // In the same, unheaded group as Home.
    expect(choose.closest('ul')).toBe(home.closest('ul'))
    expect(within(nav()).queryByRole('button', { name: 'Design review' })).toBeNull()
    fireEvent.click(choose)
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
  })

  it('does not list it for someone with one facility, and keeps only What\'s left in a demo\'s design review', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    expect(within(nav()).queryByRole('link', { name: 'Choose workspace' })).toBeNull()
    const review = within(nav()).getByRole('button', { name: 'Design review' })
    const list = document.getElementById(review.getAttribute('aria-controls')!)!
    expect(within(list).getAllByRole('link').map(link => link.textContent)).toEqual(['What’s left'])
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
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
    const main = document.getElementById('main-content')!
    expect(main.tagName).toBe('MAIN')
    expect(main.hidden).toBe(false)
    await lockAfterAway(clock.set, clock.advance)
    expect(main.hidden).toBe(true)
  })
})

describe('5. today\'s page refuses only where it reads nothing first', () => {
  async function standIns() {
    const { TODAY_PATHS } = await import('../../../ehr-blue/frame/pages')
    return [...TODAY_PATHS]
  }

  it('leaves Access requests and Clinical record to the frame: they read before refusing', async () => {
    for (const [path, label] of [['requests', 'External record access'], ['clinical', 'Consultation']] as const) {
      vi.resetModules()
      withFramePages()
      const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
      const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
      const { unmount } = await openStaffApp(`/provider/${path}`)
      expect(await screen.findByText(`${label} is not open to you here`)).toBeDefined()
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
      await waitFor(() => expect(document.querySelector('.hid-ehr-blue-live h1')).not.toBeNull())
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect({ path, routes: sent.map(call => call.route) }).toEqual({ path, routes: [SESSION] })
      unmount()
    }
  })
})
