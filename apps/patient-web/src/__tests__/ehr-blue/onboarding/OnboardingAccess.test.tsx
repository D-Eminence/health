import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { onboardingPage } from '../../../ehr-blue/onboarding/page'
import { DEMO_HOSPITAL, SESSION, openStaffApp, serve, pageRoutes } from '../frame/blueHarness'
import {
  RIVERSIDE, STAFF, eyebrow, heading, many, membership, nav, sessionWith, staffAnswer, staffSession,
  withOnboardingPages,
} from './onboardingHarness'

/*
 * Who Facility setup is for: with the clinic switch on, the administrator (workforce.manage) of a facility that signed
 * itself up, where today's sidebar lists Staff (Novu). It is listed, in the sidebar and search, only there; elsewhere
 * its address says so in one sentence and reads nothing. The switch-off case is OnboardingSwitchOff.test.tsx.
 */
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  withOnboardingPages()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const NOT_SELF_SIGNED_UP = 'Facility setup is for a facility that signed itself up to Health ID.'

describe('the page entry', () => {
  it('is the design\'s onboarding under Settings, partly live, needing workforce.manage, never at the frame\'s setup path', () => {
    expect(onboardingPage).toMatchObject({ path: 'onboarding/*', group: 'Settings', label: 'Facility setup', status: 'partial',
      permission: 'workforce.manage' })
    expect(onboardingPage.listed).toBeUndefined()
  })

  it('shows for the administrator of a facility that signed itself up, pending or checked', () => {
    expect(onboardingPage.visible?.(staffSession(membership({ review: 'reviewed' })))).toBe(true)
    expect(onboardingPage.visible?.(staffSession(membership({ review: 'pending' })))).toBe(true)
  })

  it('does not show at a governed facility', () => {
    expect(onboardingPage.visible?.(staffSession(membership({ review: null })))).toBe(false)
  })

  it('does not show to a member without workforce.manage', () => {
    expect(onboardingPage.visible?.(staffSession(membership({ permissions: ['identity.patient.read'] })))).toBe(false)
  })

  it('keeps Staff & access\'s rule: not on a service without today\'s staff management (main)', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(onboardingPage.visible?.(staffSession(membership()))).toBe(false)
  })
})

describe('in the frame', () => {
  it('lists Facility setup in the sidebar and search for a self-signed-up facility\'s administrator, and opens it', async () => {
    const riverside = membership()
    serve({ [SESSION]: [sessionWith(riverside)], [STAFF]: many(staffAnswer()) })
    await openStaffApp('/provider/onboarding')
    const link = within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Facility setup' })
    expect(link.getAttribute('href')).toBe('/provider/onboarding')
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(heading()).toBeDefined()
    expect(eyebrow()).toBe('Step 1 of 9 · Facility')
    expect(document.title).toBe('Facility setup · Health ID EHR')
    // The frame's own Facility settings sample is not listed (only working screens are), and is not this page.
    expect(within(nav()).queryByRole('link', { name: 'Facility settings' })).toBeNull()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search' })
    fireEvent.change(within(search).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: 'Facility setup' } })
    expect(within(search).getByRole('link', { name: /Facility setup/ })).toBeDefined()
  })

  it.each([
    ['a governed facility', membership({ review: null }), NOT_SELF_SIGNED_UP],
    ['a member without workforce.manage', membership({ permissions: ['identity.patient.read'] }),
      `Only ${RIVERSIDE}’s administrator can set it up.`],
  ])('leaves it out at %s, and its address says so, reading nothing', async (_case, current, sentence) => {
    const sent = serve({ [SESSION]: [sessionWith(current)] })
    await openStaffApp('/provider/onboarding')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav()).queryByRole('link', { name: 'Facility setup' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Facility setup')
    expect(screen.getByText(sentence)).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Setup steps' })).toBeNull()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search' })
    fireEvent.change(within(search).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: 'Facility setup' } })
    expect(within(search).queryByRole('link', { name: /Facility setup/ })).toBeNull()
    // Only the session was asked for: nothing about the staff or the facility's setup.
    expect(pageRoutes(sent)).toEqual([SESSION])
  })

  it('says the same at a demo facility that did not sign itself up', async () => {
    const demo = membership({ id: DEMO_HOSPITAL, name: 'Demo Hospital', review: null })
    const sent = serve({ [SESSION]: [sessionWith(demo)] })
    await openStaffApp('/provider/onboarding/staff')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav()).queryByRole('link', { name: 'Facility setup' })).toBeNull()
    expect(screen.getByText(NOT_SELF_SIGNED_UP)).toBeDefined()
    expect(sent.filter(request => request.route === STAFF)).toHaveLength(0)
  })
})
