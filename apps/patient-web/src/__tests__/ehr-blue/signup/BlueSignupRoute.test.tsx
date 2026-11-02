import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { parse } from '../../cssRules'
import { contrast, token } from '../../ehr-ui/ehrCss'
import { security } from './signupFakes'
import { open, TabChannel } from './signupHarness'

/**
 * Which facility sign-up /provider/enroll opens: the blue registration only once the clinic switch is on
 * (clinicSwitch.ts BLUE_FOR_ALL), and only on Novu; today's page otherwise. On a staff product host or the admin site
 * the blue page, as today's, sends the administrator to the main site and asks nothing. No new address exists.
 */
const api = vi.hoisted(() => ({ availability: vi.fn(), start: vi.fn(), verify: vi.fn(), profile: vi.fn(), activate: vi.fn(),
  withdraw: vi.fn() }))
vi.mock('../../../staff/api', () => ({ providerEnrollmentApi: api, staffApi: {} }))
const clinician = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: clinician }))
vi.mock('../../../staff/env', async () => {
  const { ENVIRONMENT } = await import('./signupFakes')
  return { getEnvironment: () => ENVIRONMENT }
})
vi.mock('../../../Turnstile', async () => ({ Turnstile: (await import('./signupFakes')).FakeTurnstile }))
// The clinic switch: as it ships (off) unless a test turns it on.
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BroadcastChannel', TabChannel)
  security.auto = true
  clinic.switchedOn = false
  api.availability.mockResolvedValue({ open: true })
  clinician.availability.mockResolvedValue({ open: false })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

/** The portal itself at `entry`, loaded afresh so its lazy page is chosen under this test's switch. */
async function openPortal(entry = '/provider/enroll') {
  const { App } = await import('../../../App')
  render(<MemoryRouter initialEntries={[entry]}><App /></MemoryRouter>)
}

describe('the clinic switch chooses the page at /provider/enroll', () => {
  it('opens the blue registration when the switch is on (Novu)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    clinic.switchedOn = true
    await openPortal()
    expect(await screen.findByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 2, name: 'Your account' })).toBeTruthy()
    expect(document.querySelector('.hid-ehr.hid-ehr-signup')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set up your facility.' })).toBeNull()
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['staging.healthidentitydirectory.com', '/provider/sign-in'],
  ])('on %s, its logo and Sign in lead to %s, while recovery and invitations stay the main site’s own', async (hostname, href) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    vi.stubGlobal('location', { ...window.location, hostname })
    clinic.switchedOn = true
    await openPortal()
    expect(await screen.findByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Health ID provider sign in' }).getAttribute('href')).toBe(href)
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(href)
    expect(screen.getByRole('link', { name: 'Recover access' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Accept invitation' }).getAttribute('href')).toBe('/provider/invitation')
  })

  it('keeps today’s page while the switch is off', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openPortal()
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up your facility.' })).toBeTruthy()
    expect(await screen.findByRole('textbox', { name: 'Administrator email' })).toBeTruthy()
    expect(document.querySelector('.hid-ehr')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Register your facility' })).toBeNull()
  })

  it('keeps today’s page on hid-system main (main-v1) even with the switch on: the blue flow is Novu only', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    clinic.switchedOn = true
    await openPortal()
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up your facility.' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Provider enrollment steps' }).textContent).toContain('Authenticator')
    expect(document.querySelector('.hid-ehr')).toBeNull()
  })
})

/** hid-system accepts the sign-up's security check only on the main site (productHostname.ts providerEnrollmentHref). */
describe('the blue registration opened on a staff product host or the admin site', () => {
  const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
  const servedFrom = window.location.href
  afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

  it.each([
    ['ehr.healthidentitydirectory.com', '/provider/enroll', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['lab.healthidentitydirectory.com', '/provider/enroll?product=laboratory', 'https://app.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['admin.healthidentitydirectory.com', '/provider/enroll', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/enroll?product=pharmacy', 'https://staging.healthidentitydirectory.com/provider/enroll?product=pharmacy'],
    ['ehr.healthidentitydirectory.com', '/provider/enroll?product=https://evil.example', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ])('on %s (%s) links to the main site with today’s link, and sends nothing', async (hostname, entry, href) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    jsdom.reconfigure({ url: `https://${hostname}${entry}` })
    open(entry)
    expect(screen.getByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    expect(screen.getByText('Facility sign-up is done on the main Health ID site.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue to facility sign-up' }).getAttribute('href')).toBe(href)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete the security check' })).toBeNull()
    expect(document.title).toBe('Provider enrollment · Health ID Provider')
    expect(api.availability).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    expect(clinician.availability).not.toHaveBeenCalled()
  })
})

describe('the registration’s stylesheet', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(resolve(here, '../../../ehr-blue/signup/signup.css'), 'utf8')

  it('styles only under .hid-ehr, with its own hid-ehr-signup class', () => {
    const selectors = parse(css).flatMap(rule => rule.selectors)
    expect(selectors.length).toBeGreaterThan(40)
    for (const selector of selectors) expect(selector).toMatch(/^\.hid-ehr(?:\.hid-ehr-signup\b| \.hid-ehr-signup-)/)
  })

  it('writes placeholder text on its tinted inputs in the muted ink, at 4.5:1 or more', () => {
    const placeholder = parse(css).find(rule => rule.selectors.includes('.hid-ehr.hid-ehr-signup .hid-ehr-control::placeholder'))
    expect(placeholder?.body).toMatch(/(?:^|;|\s)color:\s*var\(--ehr-muted\)/)
    expect(contrast(token('muted'), token('surface-tint'))).toBeGreaterThanOrEqual(4.5)
  })
})
