import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { facility } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectOpenedElsewhere, openBlueOn, openClassicOn, openPortalOn,
  OUTREACH_DEMO, PHARMACY_DEMO, signInActionOn, siteLinks,
} from './siteHarness'

/** pharmacy.: the Pharmacy product, with the pages every staff site serves. Everything else opens on its own site. */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); clinic.switchedOn = false; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SITE = 'pharmacy.healthidentitydirectory.com'
const SITE_STAGING = 'pharmacy.staging.healthidentitydirectory.com'

describe(SITE, () => {
  it.each(['/provider/pharmacy', '/provider/pharmacy/item-1', '/provider', '/provider/sign-in', '/provider/audit', '/provider/billing', '/provider/staff',
    '/provider/staff/join', '/provider/institutions', '/'])('serves %s', path => {
    expect(servedHere(path, SITE)).toBe(true)
    expect(servedHere(path, SITE_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/patients', 'https://ehr.healthidentitydirectory.com/provider/patients'],
    ['/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/ocr', 'https://migrate.healthidentitydirectory.com/provider/ocr'],
    ['/provider/outreach', 'https://outreach.healthidentitydirectory.com/provider/outreach'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (pathname, href) => {
    expect(rightSiteHref({ pathname, search: '', hash: '' }, SITE)).toBe(href)
  })

  it('sends the Hospital EHR’s pages there, in place of this address', async () => {
    await openPortalOn(SITE, '/provider/clinical')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/clinical')
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

  it('lists its own pages in today’s sidebar, and links to the sites that serve the rest', async () => {
    const sidebar = await openClassicOn(SITE)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Facility audit', 'Pharmacy', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens the blue EHR at Demo Pharmacy as the Pharmacy, with this site’s pages only', async () => {

    const nav = await openBlueOn(SITE, { id: PHARMACY_DEMO, name: 'Demo Pharmacy' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Pharmacy')
    expect(blueAddresses(nav).some(address => address === '/provider/pharmacy' || address.startsWith('/provider/pharmacy/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !servedHere(address, SITE))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
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
  })
})

describe(SITE_STAGING, () => {
  it('signs in with pharmacy-login', async () => {
    expect(await signInActionOn(SITE_STAGING)).toBe('pharmacy-login')
  })

  it('sends the Hospital EHR’s pages to the staging EHR site', async () => {
    await openPortalOn(SITE_STAGING, '/provider/patients')
    await expectOpenedElsewhere(opened, 'https://ehr.staging.healthidentitydirectory.com/provider/patients')
  })
})
