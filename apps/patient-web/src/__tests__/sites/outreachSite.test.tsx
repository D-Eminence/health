import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { facility } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectNoHostnameShown, expectOpenedElsewhere, openBlueOn,
  openClassicOn, openPortalOn, OUTREACH_DEMO, PHARMACY_DEMO, signInActionOn, siteLinks,
} from './siteHarness'

/** outreach.: the Outreach product, with the pages every staff site serves. Everything else opens on its own site. */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); clinic.switchedOn = false; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SITE = 'outreach.healthidentitydirectory.com'
const SITE_STAGING = 'outreach.staging.healthidentitydirectory.com'

describe(SITE, () => {
  it.each(['/provider/outreach', '/provider', '/provider/sign-in', '/provider/audit', '/provider/billing', '/provider/staff',
    '/provider/staff/join', '/provider/institutions', '/provider/patients', '/provider/patients/5a020001', '/provider/requests',
    '/'])('serves %s', path => {
    expect(servedHere(path, SITE)).toBe(true)
    expect(servedHere(path, SITE_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/registration', 'https://ehr.healthidentitydirectory.com/provider/registration'],
    ['/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
    ['/provider/migrate', 'https://migrate.healthidentitydirectory.com/provider/migrate'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (pathname, href) => {
    expect(rightSiteHref({ pathname, search: '', hash: '' }, SITE)).toBe(href)
  })

  it('sends the Hospital EHR’s pages there, in place of this address', async () => {
    await openPortalOn(SITE, '/provider/clinical')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/clinical')
  })

  it('sends Document OCR to its own site', async () => {
    await openPortalOn(SITE, '/provider/ocr')
    await expectOpenedElsewhere(opened, 'https://migrate.healthidentitydirectory.com/provider/ocr')
  })

  it('opens its own page at its address, behind its own sign-in', async () => {
    await openPortalOn(SITE, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Foutreach')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with outreach-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(SITE)).toBe('outreach-login')
  })

  it('lists its own pages in today’s sidebar, and links to the sites that serve the rest', async () => {
    const sidebar = await openClassicOn(SITE)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Patient access', 'Access requests', 'Facility audit', 'Outreach', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
    ])
    expectNoHostnameShown(sidebar)
  })

  it('serves Patients and Access requests here, behind its own sign-in, and leaves Patient registration to the Hospital EHR', async () => {
    await openPortalOn(SITE, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(opened).not.toHaveBeenCalled()
    expect(servedHere('/provider/requests', SITE)).toBe(true)
    expect(servedHere('/provider/registration', SITE)).toBe(false)
  })

  it('offers Patients and Access requests only to a role holding their own permissions', async () => {
    const sidebar = await openClassicOn(SITE, '/provider', [], ['outreach.registration.read'])
    expect(classicPages(sidebar)).toEqual(['Overview', 'Outreach'])
  })

  it('opens the blue EHR at Demo Outreach as Outreach, with this site’s pages only', async () => {

    const nav = await openBlueOn(SITE, { id: OUTREACH_DEMO, name: 'Demo Outreach' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Outreach')
    expect(blueAddresses(nav).some(address => address === '/provider/outreach' || address.startsWith('/provider/outreach/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !servedHere(address, SITE))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
    ])
  })

  it('opens nothing of Demo Pharmacy here: it works on its own site', async () => {
    const other = facility(OUTREACH_DEMO, 'Another facility', ['audit.read'])
    await openBlueOn(SITE, { id: PHARMACY_DEMO, name: 'Demo Pharmacy' }, EVERY_PERMISSION, [other])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Pharmacy works on Pharmacy' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Pharmacy' }).getAttribute('href')).toBe('https://pharmacy.healthidentitydirectory.com/')
    expect(page.getByText(/^Demo Pharmacy is on Health ID Pharmacy, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()
  })
})

describe(SITE_STAGING, () => {
  it('signs in with outreach-login', async () => {
    expect(await signInActionOn(SITE_STAGING)).toBe('outreach-login')
  })

  it('sends the Hospital EHR’s pages to the staging EHR site', async () => {
    await openPortalOn(SITE_STAGING, '/provider/registration')
    await expectOpenedElsewhere(opened, 'https://ehr.staging.healthidentitydirectory.com/provider/registration')
  })
})
