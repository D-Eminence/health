import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { onboardingPage } from '../../../ehr-blue/onboarding/page'
import { DEMO_HOSPITAL, SESSION, openStaffApp, serve } from '../frame/blueHarness'
import { membership, nav, sessionWith, staffSession, withOnboardingPages } from './onboardingHarness'

/*
 * With the clinic switch off (as on main today), Facility setup is shown to nobody: not even the administrator of a
 * facility that signed itself up. Only the demo facilities open the blue EHR then, and there its address says so,
 * reading nothing.
 */
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  withOnboardingPages()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('with the clinic switch off', () => {
  it('shows Facility setup to nobody, a self-signed-up facility\'s administrator included', () => {
    expect(onboardingPage.visible?.(staffSession(membership()))).toBe(false)
    expect(onboardingPage.visible?.(staffSession(membership({ id: DEMO_HOSPITAL, name: 'Demo Hospital' })))).toBe(false)
  })

  it('leaves it out of a demo facility\'s sidebar, and its address says so, reading nothing', async () => {
    const demo = membership({ id: DEMO_HOSPITAL, name: 'Demo Hospital', review: null })
    const sent = serve({ [SESSION]: [sessionWith(demo)] })
    await openStaffApp('/provider/onboarding')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav()).queryByRole('link', { name: 'Facility setup' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Facility setup')
    expect(screen.getByText('Facility setup is for a facility that signed itself up to Health ID.')).toBeDefined()
    expect(sent.map(request => request.route)).toEqual([SESSION])
  })
})
