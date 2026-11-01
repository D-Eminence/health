import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { facility, homeHeading, openStaffApp, serve, sessionAt, where } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, EVERY_PERMISSION, onSite, siteLinks } from './siteHarness'

/**
 * Moving between the staff sites with single sign-on on (VITE_HID_SSO=1, siteSwitch.ts), in the blue EHR: the links
 * to the other sites say which site and page they leave, the site arrived on offers the way back, and an account its
 * facility gives nothing of a site's product is told so, never shown a sign-in. Off, every one of these is today's.
 * The site hostnames are productSites.ts's fixed table, used as strings: fetch answers from the test, and the browser
 * goes nowhere. Every account and facility here is fictional.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const PHARMACY = 'pharmacy.healthidentitydirectory.com'
const CLINIC = 'f0000000-0000-4000-8000-00000000c11c'
const ANNEX = 'f0000000-0000-4000-8000-00000000a22e'
const WORK_ITEM = 'b1000000-0000-4000-8000-00000000a7c3'
const CLINICAL = ['identity.patient.read', 'ehr.encounter.read', 'audit.read']
const LABORATORY = ['lab.work-item.read', 'audit.read']

const on = () => vi.stubEnv('VITE_HID_SSO', '1')
const CANNOT_USE = /^Your account can't use .+ at this facility\.$/

/**
 * The portal loading `url` on `hostname`, signed in at a fictional clinic: main.tsx reads the switch before the router,
 * then the router opens what is left of the address. Returns the address the browser shows after that first read.
 */
async function arrive(hostname: string, url: string, permissions: readonly string[], { annex = false } = {}) {
  const clinic = facility(CLINIC, 'Fictional Clinic', permissions)
  const facilities = annex ? [clinic, facility(ANNEX, 'Fictional Annex', permissions)] : [clinic]
  serve({ 'GET /api/v1/auth/session': [sessionAt(clinic, facilities, 'selected')] })
  onSite(hostname, url)
  const { takeSwitchArrival } = await import('../../siteSwitch')
  takeSwitchArrival()
  const shown = window.location.pathname + window.location.search + window.location.hash
  await openStaffApp(window.location.pathname + window.location.search)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return shown
}

/** The blue sidebar's links to the other Health ID sites, as [name, address]. */
function otherSites(): [string, string][] {
  return siteLinks(screen.getByRole('navigation', { name: 'Main navigation' }))
}

/** The page itself, below the frame's header and sidebar. */
const thePage = () => within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)

const signInShown = () => screen.queryByRole('heading', { name: 'Welcome back.' }) !== null || document.querySelector('input[type="password"]') !== null

describe('off (VITE_HID_SSO unset): exactly today', () => {
  it('leaves from and back in the address, offers no way back, and links to the other sites’ roots', async () => {
    const shown = await arrive(LAB, '/provider/laboratory/work?from=ehr&back=%2Fprovider%2Fpatients', LABORATORY)
    expect(shown).toBe('/provider/laboratory/work?from=ehr&back=%2Fprovider%2Fpatients')
    expect(screen.queryByRole('link', { name: /^Back to / })).toBeNull()
    // The sites the session may open pages on (#68), each at its root: the address this page had stays here.
    expect(otherSites().length).toBeGreaterThan(0)
    for (const [name, href] of otherSites()) expect(href, name).toMatch(/^https:\/\/[a-z]+\.healthidentitydirectory\.com\/$/)
  })

  it('refuses a product the facility does not give in the page’s own words, as today', async () => {
    await arrive(LAB, '/provider/laboratory/work?from=ehr', CLINICAL)
    expect(await screen.findByRole('heading', { name: 'Laboratory unavailable' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: CANNOT_USE })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Back to / })).toBeNull()
  })

  it('shows Home on ehr. to an account with nothing of the EHR, as today', async () => {
    await arrive(EHR, '/provider', ['audit.read'])
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: CANNOT_USE })).toBeNull()
  })
})

describe('on (VITE_HID_SSO=1): the links to the other sites', () => {
  it('say which site and page they leave, and nothing else', async () => {
    on()
    await arrive(LAB, '/provider/laboratory/tests', [...LABORATORY, 'billing.catalogue.read', 'identity.patient.read'])
    expect(otherSites()).toContainEqual(
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/provider?from=lab&back=%2Fprovider%2Flaboratory%2Ftests'])
    for (const [name, href] of otherSites()) {
      expect(href, name).toMatch(/^https:\/\/[a-z]+\.healthidentitydirectory\.com\/provider\?from=lab&back=%2Fprovider%2Flaboratory%2Ftests$/)
    }
  })

  it('leave the record a page has open here: back names the page, never what is below it', async () => {
    on()
    await arrive(LAB, `/provider/laboratory/work/${WORK_ITEM}`, [...LABORATORY, 'identity.patient.read'])
    expect(otherSites()).toContainEqual(['Hospital EHR', 'https://ehr.healthidentitydirectory.com/provider?from=lab&back=%2Fprovider%2Flaboratory%2Fwork'])
    for (const [, href] of otherSites()) expect(href).not.toContain(WORK_ITEM.slice(-12))
  })
})

describe('on (VITE_HID_SSO=1): arriving from another site', () => {
  it('takes from and back out of the address before the router reads it, and offers Back to the page left', async () => {
    on()
    const shown = await arrive(PHARMACY, '/provider/pharmacy/prescriptions?from=ehr&back=%2Fprovider%2Fpatients', ['pharmacy.work-item.read'])
    expect(shown).toBe('/provider/pharmacy/prescriptions')
    expect(where()).toBe('/provider/pharmacy/prescriptions')
    const back = screen.getByRole('link', { name: 'Back to Hospital EHR' })
    expect(back.getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/provider/patients')
  })

  it('keeps the way back in memory as the person moves around the site', async () => {
    on()
    await arrive(LAB, '/provider?from=ehr&back=%2Fprovider%2Fclinical', LABORATORY)
    // A lab's Home is its own page: the frame moves there, and the way back stays.
    await waitFor(() => expect(where()).toBe('/provider/laboratory/work'))
    expect(screen.getByRole('link', { name: 'Back to Hospital EHR' }).getAttribute('href'))
      .toBe('https://ehr.healthidentitydirectory.com/provider/clinical')
    expect(window.location.search).toBe('')
  })

  it('never opens an address it was given: a crafted back comes back to the other site’s workspace', async () => {
    on()
    await arrive(LAB, '/provider/laboratory/work?from=ehr&back=%2F%2Fevil.example%2Fprovider', LABORATORY)
    expect(screen.getByRole('link', { name: 'Back to Hospital EHR' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/provider')
    expect(document.body.innerHTML).not.toContain('evil.example')
  })

  it('offers no way back for a from that is not another staff site', async () => {
    on()
    const shown = await arrive(LAB, '/provider/laboratory/work?from=__proto__&back=%2Fprovider', LABORATORY)
    expect(shown).toBe('/provider/laboratory/work')
    expect(screen.queryByRole('link', { name: /^Back to / })).toBeNull()
  })
})

describe('on (VITE_HID_SSO=1): an account its facility gives nothing of this site’s product', () => {
  it('is told so, with the way back, and never shown a sign-in', async () => {
    on()
    await arrive(PHARMACY, '/provider/pharmacy?from=ehr&back=%2Fprovider%2Fpatients', CLINICAL)
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your account can\'t use Pharmacy at this facility.' })
    const page = thePage()
    expect(page.getByRole('heading', { level: 1 })).toBe(heading)
    expect(page.getByText('You are signed in, but your role at Fictional Clinic does not include Pharmacy. An administrator at Fictional Clinic can give you access.')).toBeTruthy()
    expect(page.getByRole('link', { name: 'Back to Hospital EHR' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/provider/patients')
    expect(signInShown()).toBe(false)
    // The page stays: no product page opens, sends the person Home or loops back here.
    expect(where()).toBe('/provider/pharmacy')
    expect(document.title).toBe('No access · Health ID Pharmacy')
    expect(opened).not.toHaveBeenCalled()
  })

  it('says so on the product’s every page, and offers another facility where there is one', async () => {
    on()
    await arrive(LAB, '/provider/laboratory/work', CLINICAL, { annex: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Your account can\'t use Laboratory at this facility.' })).toBeTruthy()
    expect(thePage().getByRole('link', { name: 'Choose workspace' }).getAttribute('href')).toBe('/provider/institutions')
    // Arrived by its address, not from another site: no way back to offer, and none made up.
    expect(screen.queryByRole('link', { name: /^Back to / })).toBeNull()
    expect(signInShown()).toBe(false)
  })

  it('still opens the pages every staff site serves, where the roles allow them', async () => {
    on()
    await arrive(LAB, '/provider/audit', CLINICAL)
    await waitFor(() => expect(where()).toBe('/provider/audit'))
    expect(screen.queryByRole('heading', { name: CANNOT_USE })).toBeNull()
  })

  it('on ehr., replaces Home for an account with nothing of the EHR', async () => {
    on()
    await arrive(EHR, '/provider?from=lab&back=%2Fprovider%2Flaboratory%2Fwork', ['audit.read'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Your account can\'t use Hospital EHR at this facility.' })).toBeTruthy()
    expect(thePage().getByRole('link', { name: 'Back to Laboratory' }).getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/provider/laboratory/work')
    expect(screen.queryByRole('heading', { name: homeHeading() })).toBeNull()
  })

  it.each([
    [EHR, '/provider', CLINICAL],
    [EHR, '/provider', ['lab.work-item.read']],
    [LAB, '/provider/laboratory/work', LABORATORY],
    [PHARMACY, '/provider/pharmacy/prescriptions', ['pharmacy.work-item.read']],
    [LAB, '/provider/laboratory/work', EVERY_PERMISSION],
  ])('is not shown on %s to an account the product is open to', async (hostname, path, permissions) => {
    on()
    await arrive(hostname, path, permissions)
    expect(screen.queryByRole('heading', { name: CANNOT_USE })).toBeNull()
    expect(document.title).not.toMatch(/^No access/)
  })
})

describe('every blue page', () => {
  it('has an address a switch may come back to', async () => {
    const { BLUE_PAGES, pageHrefOf } = await import('../../ehr-blue/routes')
    const { isSwitchBackPath } = await import('../../siteSwitch')
    expect(BLUE_PAGES.map(pageHrefOf).filter(href => !isSwitchBackPath(href))).toEqual([])
  })
})
