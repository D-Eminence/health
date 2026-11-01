import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { parse } from '../../cssRules'
import { contrast, token } from '../../ehr-ui/ehrCss'
import { security } from './signupFakes'
import { combobox, next, open, step, TabChannel, textbox } from './signupHarness'

/**
 * Which facility sign-up /provider/enroll opens: the blue registration only once the clinic switch is on
 * (clinicSwitch.ts BLUE_FOR_ALL), and only on Novu; today's page otherwise. Each product site has its own, starting
 * with its own product; the production patient portal and the admin sites open the EHR site's at once and ask nothing.
 * No new address exists.
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

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com'])('on %s, the registration is the site’s own, and every way in under it stays there', async hostname => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    clinic.switchedOn = true
    await openPortal()
    expect(await screen.findByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 2, name: 'Your account' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Health ID provider sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Recover access' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Accept invitation' }).getAttribute('href')).toBe('/provider/invitation')
    expect(api.availability).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('on the production patient portal, opens the EHR site’s registration at once, with its address', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com', replace })
    clinic.switchedOn = true
    await openPortal('/provider/enroll?product=laboratory')
    expect(screen.getByRole('status').textContent).toBe('Opening Health ID EHR…')
    expect(replace).toHaveBeenCalledWith('https://ehr.healthidentitydirectory.com/provider/enroll?product=laboratory')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(api.availability).not.toHaveBeenCalled()
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

/** Each product site has its own facility sign-up, which hid-system accepts there (productHostname.ts providerEnrollmentHref). */
describe('the blue registration on a product site, and where it is not', () => {
  const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
  const servedFrom = window.location.href
  afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

  /** The facility type and product the form holds: Facility details, then Platform setup. */
  async function startingChoice() {
    fireEvent.change(textbox('Full name'), { target: { value: 'Demo Administrator' } })
    fireEvent.change(textbox('Email'), { target: { value: 'admin@demo-facility.example.test' } })
    next()
    await step('Facility details')
    const type = combobox('Facility type').value
    next()
    await step('Regulatory identity')
    fireEvent.change(textbox('CAC registration number'), { target: { value: 'RC123456' } })
    next()
    await step('Platform setup')
    return { type, product: combobox('Product to start with').value }
  }

  it.each([
    ['lab.healthidentitydirectory.com', '/provider/enroll', { type: 'laboratory', product: 'laboratory' }],
    ['pharmacy.healthidentitydirectory.com', '/provider/enroll', { type: 'pharmacy', product: 'pharmacy' }],
    ['lab.staging.healthidentitydirectory.com', '/provider/enroll', { type: 'laboratory', product: 'laboratory' }],
    ['migrate.healthidentitydirectory.com', '/provider/enroll', { type: 'hospital', product: 'migrate' }],
    ['ehr.healthidentitydirectory.com', '/provider/enroll', { type: 'hospital', product: 'ehr' }],
    ['outreach.healthidentitydirectory.com', '/provider/enroll', { type: 'hospital', product: 'ehr' }],
    // A product the address names wins over the site's own, as the public site's links ask.
    ['lab.healthidentitydirectory.com', '/provider/enroll?product=ehr', { type: 'hospital', product: 'ehr' }],
    ['pharmacy.healthidentitydirectory.com', '/provider/enroll?type=clinic', { type: 'clinic', product: 'ehr' }],
    // An address naming nothing the form knows is the site's own again.
    ['lab.healthidentitydirectory.com', '/provider/enroll?product=https://evil.example', { type: 'laboratory', product: 'laboratory' }],
  ])('on %s (%s), signs up there, starting with %o', async (hostname, entry, choice) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    jsdom.reconfigure({ url: `https://${hostname}${entry}` })
    open(entry)
    expect(await step('Your account')).toBeTruthy()
    expect(screen.queryByText(/main Health ID site/)).toBeNull()
    expect(await startingChoice()).toEqual(choice)
    expect(api.availability).toHaveBeenCalled()
  })

  it.each([
    ['admin.healthidentitydirectory.com', '/provider/enroll', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['admin.staging.healthidentitydirectory.com', '/provider/enroll?product=pharmacy',
      'https://ehr.staging.healthidentitydirectory.com/provider/enroll?product=pharmacy'],
    ['app.healthidentitydirectory.com', '/provider/enroll?product=laboratory',
      'https://ehr.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['app.healthidentitydirectory.com', '/provider/enroll?product=https://evil.example', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
  ])('on %s (%s), which serves no staff pages, opens %s at once and sends nothing', async (hostname, entry, href) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    open(entry)
    expect(replace).toHaveBeenCalledWith(href)
    expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(href)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/continue|main site/i)).toBeNull()
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
