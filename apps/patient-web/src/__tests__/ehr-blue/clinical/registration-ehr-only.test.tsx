import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, openStaffApp, serve, sessionAt } from '../frame/blueHarness'

/**
 * Registration stays in the EHR only (the owner's decision), through the real staff app and the real, merged page
 * registry at a fictional clinic. On a single product's site Find a patient opens by its address (and, with #78, from
 * the menu), and a role holding identity.registration.write sees no "Register a patient" there: not on the page, not in
 * the menu, not in a Start menu. On the EHR's own site the same role still gets it. The hosts are only set as the
 * page's address, and fetch is stubbed: nothing is sent anywhere.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const REGISTERS = ['identity.patient.read', 'identity.consent.write', 'identity.registration.write']
const SITES = [
  ['lab.healthidentitydirectory.com', 'lab.work-item.read'],
  ['pharmacy.healthidentitydirectory.com', 'pharmacy.work-item.read'],
  ['outreach.healthidentitydirectory.com', 'outreach.registration.read'],
  ['migrate.healthidentitydirectory.com', 'ocr.job.read'],
] as const

/** Opens Find a patient on `host`, at a fictional clinic whose role holds `permissions`. */
async function findAPatientOn(host: string, permissions: readonly string[]) {
  jsdom.reconfigure({ url: `https://${host}/provider/patients` })
  const current = facility(REAL_FACILITY, 'Riverside Clinic (fictional)', permissions)
  serve({ [SESSION]: [sessionAt(current, [current])] })
  await openStaffApp('/provider/patients')
  // The first case loads the real app's lazy pages cold: on a busy runner that can take longer than the ten seconds
  // vitest.setup.ts gives an element, so this one wait has most of the test's 30 s (vitest.config.ts).
  return screen.findByRole('heading', { name: 'Find a patient' }, { timeout: 25000 })
}

describe('Register a patient on a product’s site', () => {
  it.for(SITES)('is offered nowhere on %s, even with identity.registration.write', async ([host, own]) => {
    await findAPatientOn(host, [own, ...REGISTERS])
    expect(screen.getByRole('button', { name: 'Find' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Register a patient' })).toBeNull()
    expect(screen.queryByText('Register a patient')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name: 'Patient registration' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('is still offered on the EHR’s own site to the same role', async () => {
    await findAPatientOn('ehr.healthidentitydirectory.com', ['lab.work-item.read', ...REGISTERS])
    const offered = screen.getAllByRole('link', { name: 'Register a patient' })
    expect(offered.length).toBeGreaterThan(0)
    for (const link of offered) expect(link.getAttribute('href')).toBe('/provider/registration')
    // The EHR has a Start menu, so its absence on a product's site above is the product's doing.
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
  })
})
