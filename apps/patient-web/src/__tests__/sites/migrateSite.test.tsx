import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type * as BlueFacilities from '../../ehr-blue/blueFacilities'
import { offeredHere, rightSiteHref, servedHere } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY, facility, REAL_FACILITY } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectNoHostnameShown, expectOpenedElsewhere, openBlueOn,
  openClassicOn, openPortalOn, openPortalSignedInOn, signInActionOn, siteLinks,
} from './siteHarness'

/**
 * migrate.: the Migrate product, which works on its own (owner, 2026-11-02). It serves every page Migrate opens
 * (ehr-blue/frame/product.ts opensInProduct) and its own sign-up, sign-in, recovery and invitations. Another product's own
 * page opens on that product's site; a page of the hospital EHR's stays here, where the frame opens Migrate's Home.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))
// The classic EHR is gone (#104): nothing in the app sets the flag staff/App.tsx still reads for today's workspace. This
// file sets it, to see today's workspace with Demo Hospital as a tab that chose the classic EHR had it.
const classicTab = vi.hoisted(() => ({ on: false, listeners: new Set<() => void>() }))
vi.mock('../../ehr-blue/blueFacilities', async importOriginal => {
  const subscribe = (listener: () => void) => { classicTab.listeners.add(listener); return () => { classicTab.listeners.delete(listener) } }
  const chosen = () => classicTab.on
  return { ...await importOriginal<typeof BlueFacilities>(), useClassicEhrChosen: () => useSyncExternalStore(subscribe, chosen, chosen) }
})
function chooseClassicEhr() {
  classicTab.on = true
  classicTab.listeners.forEach(listener => listener())
}

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); clinic.switchedOn = false; classicTab.on = false; classicTab.listeners.clear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SITE = 'migrate.healthidentitydirectory.com'
const SITE_STAGING = 'migrate.staging.healthidentitydirectory.com'

describe(SITE, () => {
  it.each(['/provider/ocr', '/provider/migrate', '/provider', '/provider/sign-in', '/provider/recover', '/provider/enroll', '/provider/invitation',
    '/provider/join', '/provider/audit', '/provider/billing', '/provider/staff', '/provider/staff/join', '/provider/institutions',
    '/provider/patients', '/provider/patients/5a020001', '/provider/requests', '/provider/whats-left', '/provider/onboarding',
    '/provider/registration', '/provider/clinical', '/provider/payments', '/'])('serves %s', path => {
    expect(servedHere(path, SITE)).toBe(true)
    expect(servedHere(path, SITE_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
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

  it('opens Migrate’s Home in place of Patient registration, signed in once the clinic switch is on, on this site', async () => {
    clinic.switchedOn = true
    await openPortalSignedInOn(SITE, '/provider/registration', { id: REAL_FACILITY, name: 'Fictional Records Office' }, EVERY_PERMISSION)
    await waitFor(() => expect(address()).toBe('/provider/ocr'))
    expect(screen.queryByText(/Opening it there/)).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })

  it('sends Outreach to its own site', async () => {
    await openPortalOn(SITE, '/provider/outreach')
    await expectOpenedElsewhere(opened, 'https://outreach.healthidentitydirectory.com/provider/outreach')
  })

  it('opens its own page at its address, behind its own sign-in', async () => {
    await openPortalOn(SITE, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Focr')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with ocr-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(SITE)).toBe('ocr-login')
  })

  it('lists its own pages in today’s sidebar, and links to the other products’ sites, never the EHR’s', async () => {
    const sidebar = await openClassicOn(SITE)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Patient access', 'Access requests', 'Facility audit', 'Document OCR', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
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
    const sidebar = await openClassicOn(SITE, '/provider', [], ['ocr.job.read'])
    expect(classicPages(sidebar)).toEqual(['Overview', 'Document OCR'])
  })

  it('opens the blue EHR, once the clinic switch is on, as Migrate, with this site’s pages only', async () => {
    clinic.switchedOn = true
    const nav = await openBlueOn(SITE, { id: REAL_FACILITY, name: 'Fictional Records Office' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Migrate')
    expect(blueAddresses(nav).some(address => address === '/provider/ocr' || address.startsWith('/provider/ocr/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !offeredHere(address, SITE))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens Demo Hospital here as Migrate: the sealed demo hospital works on this site too', async () => {
    const other = facility(REAL_FACILITY, 'Another facility', ['audit.read'])
    const nav = await openBlueOn(SITE, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION, [other], '/provider/ocr')
    expect(blueProduct()).toBe('Migrate')
    expect(blueAddresses(nav).filter(address => !offeredHere(address, SITE))).toEqual([])
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(await page.findByRole('heading', { level: 1, name: 'Document OCR' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /works on/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open Hospital EHR' })).toBeNull()

    // Today's workspace, as a tab that chose the classic EHR had it (nothing offers a way there now: the flag is set above).
    act(() => chooseClassicEhr())
    const sidebar = await screen.findByRole('complementary', { name: 'Provider navigation' })
    expect(within(sidebar).getByRole('link', { name: 'Document OCR' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /works on/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Open Hospital EHR/ })).toBeNull()
  })

  it('opens nothing of Demo Laboratory here: it works on the Laboratory’s site only', async () => {
    const other = facility(REAL_FACILITY, 'Another facility', ['audit.read'])
    await openBlueOn(SITE, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, EVERY_PERMISSION, [other])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Laboratory works on Laboratory' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Laboratory' }).getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/')
    expect(page.getByText(/^Demo Laboratory is on Health ID Lab, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()
  })
})

describe(SITE_STAGING, () => {
  it('signs in with ocr-login', async () => {
    expect(await signInActionOn(SITE_STAGING)).toBe('ocr-login')
  })

  it('keeps the Hospital EHR’s pages here, and sends another product’s own page to its staging site', async () => {
    expect(rightSiteHref({ pathname: '/provider/registration', search: '', hash: '' }, SITE_STAGING)).toBeNull()
    await openPortalOn(SITE_STAGING, '/provider/outreach')
    await expectOpenedElsewhere(opened, 'https://outreach.staging.healthidentitydirectory.com/provider/outreach')
  })
})
