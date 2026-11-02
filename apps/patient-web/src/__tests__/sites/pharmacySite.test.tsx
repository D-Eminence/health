import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { offeredHere, rightSiteHref, servedHere } from '../../productSites'
import { facility, serve, sessionAt } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectNoHostnameShown, expectOpenedElsewhere, onSite,
  openBlueOn, openClassicOn, openPortalOn, openPortalSignedInOn, OUTREACH_DEMO, PHARMACY_DEMO, REAL_CLINIC, SESSION, signInActionOn, siteLinks,
} from './siteHarness'

/**
 * pharmacy.: the Pharmacy product, which works on its own (owner, 2026-11-02). It serves every page the Pharmacy opens
 * (ehr-blue/frame/product.ts opensInProduct) and its own sign-up, sign-in, recovery and invitations. Another product's own
 * page opens on that product's site; a page of the hospital EHR's stays here, where the frame opens the Pharmacy's Home.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); clinic.switchedOn = false; trail = []; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SITE = 'pharmacy.healthidentitydirectory.com'
const SITE_STAGING = 'pharmacy.staging.healthidentitydirectory.com'

describe(SITE, () => {
  it.each(['/provider/pharmacy', '/provider/pharmacy/item-1', '/provider', '/provider/sign-in', '/provider/recover', '/provider/enroll',
    '/provider/invitation', '/provider/join', '/provider/audit', '/provider/billing', '/provider/staff', '/provider/staff/join',
    '/provider/institutions', '/provider/patients', '/provider/patients/5a020001', '/provider/requests', '/provider/whats-left',
    '/provider/onboarding', '/provider/payments', '/provider/price-list', '/provider/end-of-day', '/provider/payment-setup',
    '/provider/registration', '/provider/clinical', '/'])('serves %s', path => {
    expect(servedHere(path, SITE)).toBe(true)
    expect(servedHere(path, SITE_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/ocr', 'https://migrate.healthidentitydirectory.com/provider/ocr'],
    ['/provider/outreach', 'https://outreach.healthidentitydirectory.com/provider/outreach'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (pathname, href) => {
    expect(rightSiteHref({ pathname, search: '', hash: '' }, SITE)).toBe(href)
  })

  it('keeps the Hospital EHR’s pages here, behind its own sign-in: nothing opens the EHR site', async () => {
    await openPortalOn(SITE, '/provider/clinical')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fclinical')
    expect(opened).not.toHaveBeenCalled()
  })

  it.each(['/provider/registration', '/provider/clinical'])('opens the Pharmacy’s Home in place of the Hospital EHR’s %s, signed in, on this site', async path => {
    await openPortalSignedInOn(SITE, path, { id: PHARMACY_DEMO, name: 'Demo Pharmacy' }, EVERY_PERMISSION)
    await waitFor(() => expect(address()).toMatch(/^\/provider\/pharmacy(\/|$)/))
    expect(screen.queryByText(/Opening it there/)).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })

  it.each(['/provider/payments', '/provider/whats-left'])('keeps %s open here, signed in, a page the Pharmacy opens unlisted', async path => {
    await openPortalSignedInOn(SITE, path, { id: PHARMACY_DEMO, name: 'Demo Pharmacy' }, [...EVERY_PERMISSION, 'billing.bill.read'])
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(address()).toBe(path)
    expect(opened).not.toHaveBeenCalled()
  })

  it('sends Laboratory to its own site', async () => {
    await openPortalOn(SITE, '/provider/laboratory')
    await expectOpenedElsewhere(opened, 'https://lab.healthidentitydirectory.com/provider/laboratory')
  })

  it('opens its own page at its address, behind its own sign-in', async () => {
    await openPortalOn(SITE, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpharmacy')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with pharmacy-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(SITE)).toBe('pharmacy-login')
  })

  it('lists its own pages in today’s sidebar, and links to the other products’ sites, never the EHR’s', async () => {
    const sidebar = await openClassicOn(SITE)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Patient access', 'Access requests', 'Facility audit', 'Pharmacy', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
    expectNoHostnameShown(sidebar)
  })

  it('serves Patients and Access requests here, behind its own sign-in, and offers no Patient registration', async () => {
    await openPortalOn(SITE, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(opened).not.toHaveBeenCalled()
    expect(offeredHere('/provider/requests', SITE)).toBe(true)
    expect(offeredHere('/provider/registration', SITE)).toBe(false)
  })

  it('offers Patients and Access requests only to a role holding their own permissions', async () => {
    const sidebar = await openClassicOn(SITE, '/provider', [], ['pharmacy.work-item.read'])
    expect(classicPages(sidebar)).toEqual(['Overview', 'Pharmacy'])
  })

  it('opens the blue EHR at Demo Pharmacy as the Pharmacy, with this site’s pages only', async () => {

    const nav = await openBlueOn(SITE, { id: PHARMACY_DEMO, name: 'Demo Pharmacy' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Pharmacy')
    expect(blueAddresses(nav).some(address => address === '/provider/pharmacy' || address.startsWith('/provider/pharmacy/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !offeredHere(address, SITE))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens nothing of Demo Outreach here: it works on its own site', async () => {
    const other = facility(PHARMACY_DEMO, 'Another facility', ['audit.read'])
    await openBlueOn(SITE, { id: OUTREACH_DEMO, name: 'Demo Outreach' }, EVERY_PERMISSION, [other])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Outreach works on Outreach' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Outreach' }).getAttribute('href')).toBe('https://outreach.healthidentitydirectory.com/')
    expect(page.getByText(/^Demo Outreach is on Health ID Outreach, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()
  })
})

/** Every address the staff app went to on this site, in order. */
let trail: string[] = []

/** A loop goes round without a pause: past this many addresses the app is stopped, so the test fails instead of hanging. */
const ROUND = 25

function Trail() {
  const { pathname } = useLocation()
  useEffect(() => {
    trail.push(pathname)
    if (trail.length > ROUND) throw new Error(`The address went round: ${trail.slice(0, 6).join(' → ')} …`)
  }, [pathname])
  return null
}

/** The staff app at `path` on this site, signed in at `at`, with the address trail recorded. */
async function openStaffAt(path: string, at: ReturnType<typeof facility>) {
  serve({ [SESSION]: [sessionAt(at, [at])] })
  onSite(SITE, path)
  const { App } = await import('../../staff/App')
  render(<MemoryRouter initialEntries={[path]}><Trail /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

/**
 * #104 stopped this site sending a role that can open neither Sell nor Prescriptions round /provider, Pharmacy and
 * Sell for ever: it lands on Prescriptions, which says plainly why it is not open. This site's own redirects (an
 * address another site serves, the product's home in place of Home or of a page of the hospital EHR's) must not bring
 * the loop back.
 */
describe(`${SITE}, for a role without the pharmacy page’s permission`, () => {
  const NONE = 'Your role at this facility doesn’t include pharmacy work. Ask your facility administrator.'
  const NO_PRESCRIPTIONS = 'Your role at this facility doesn’t include prescriptions. Ask your facility administrator.'

  it.each([
    ['/provider', 'Demo Pharmacy', ['audit.read'], NONE],
    ['/provider/pharmacy', 'Demo Pharmacy', ['audit.read'], NONE],
    // A page of the hospital EHR's stays on this site now, where the frame opens the Pharmacy's Home in its place.
    ['/provider/registration', 'Demo Pharmacy', ['audit.read'], NONE],
    ['/provider', 'Demo Pharmacy', ['billing.bill.read'], NO_PRESCRIPTIONS],
    ['/provider', 'a fictional pharmacy, with the clinic switch on', ['audit.read'], NONE],
  ])('opened at %s at %s holding %j, settles on Pharmacy’s plain refusal here, without going round', async (path, at, permissions, message) => {
    clinic.switchedOn = at !== 'Demo Pharmacy'
    await openStaffAt(path, facility(at === 'Demo Pharmacy' ? PHARMACY_DEMO : REAL_CLINIC, 'Corner Pharmacy (fictional)', permissions))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Pharmacy unavailable' })
    // The blue EHR's own refusal, in plain words.
    expect(heading.closest('.hid-ehr-blue-page')).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
    // Give a loop the time to show itself: the address stays where it landed, on this site.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(trail.at(-1)).toBe('/provider/pharmacy/prescriptions')
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy unavailable' })).toBe(heading)
    expect(trail.filter(address => address === '/provider').length).toBeLessThanOrEqual(1)
    expect(trail.filter(address => address === '/provider/pharmacy/prescriptions').length).toBe(1)
    expect(opened).not.toHaveBeenCalled()
  })
})

describe(SITE_STAGING, () => {
  it('signs in with pharmacy-login', async () => {
    expect(await signInActionOn(SITE_STAGING)).toBe('pharmacy-login')
  })

  it('keeps the Hospital EHR’s pages here, and sends Laboratory to the staging lab site', async () => {
    expect(rightSiteHref({ pathname: '/provider/registration', search: '', hash: '' }, SITE_STAGING)).toBeNull()
    await openPortalOn(SITE_STAGING, '/provider/laboratory')
    await expectOpenedElsewhere(opened, 'https://lab.staging.healthidentitydirectory.com/provider/laboratory')
  })
})
