import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { DEMO_HOSPITAL, facility, REAL_FACILITY } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectOpenedElsewhere, openBlueOn, openClassicOn, openPortalOn,
  signInActionOn, siteLinks,
} from './siteHarness'

/** migrate.: the Migrate product, with the pages every staff site serves. Everything else opens on its own site. */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); clinic.switchedOn = false; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SITE = 'migrate.healthidentitydirectory.com'
const SITE_STAGING = 'migrate.staging.healthidentitydirectory.com'

describe(SITE, () => {
  it.each(['/provider/ocr', '/provider/migrate', '/provider', '/provider/sign-in', '/provider/audit', '/provider/billing', '/provider/staff',
    '/provider/staff/join', '/provider/institutions', '/'])('serves %s', path => {
    expect(servedHere(path, SITE)).toBe(true)
    expect(servedHere(path, SITE_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/patients', 'https://ehr.healthidentitydirectory.com/provider/patients'],
    ['/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
    ['/provider/outreach', 'https://outreach.healthidentitydirectory.com/provider/outreach'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (pathname, href) => {
    expect(rightSiteHref({ pathname, search: '', hash: '' }, SITE)).toBe(href)
  })

  it('sends the Hospital EHR’s pages there, in place of this address', async () => {
    await openPortalOn(SITE, '/provider/clinical')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/clinical')
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

  it('lists its own pages in today’s sidebar, and links to the sites that serve the rest', async () => {
    const sidebar = await openClassicOn(SITE)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Facility audit', 'Document OCR', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens the blue EHR, once the clinic switch is on, as Migrate, with this site’s pages only', async () => {
    clinic.switchedOn = true
    const nav = await openBlueOn(SITE, { id: REAL_FACILITY, name: 'Fictional Records Office' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Migrate')
    expect(blueAddresses(nav).some(address => address === '/provider/ocr' || address.startsWith('/provider/ocr/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !servedHere(address, SITE))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens nothing of Demo Hospital here: it works on its own site', async () => {
    const other = facility(REAL_FACILITY, 'Another facility', ['audit.read'])
    await openBlueOn(SITE, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION, [other])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Hospital works on Hospital EHR' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Hospital EHR' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/')
  })
})

describe(SITE_STAGING, () => {
  it('signs in with ocr-login', async () => {
    expect(await signInActionOn(SITE_STAGING)).toBe('ocr-login')
  })

  it('sends the Hospital EHR’s pages to the staging EHR site', async () => {
    await openPortalOn(SITE_STAGING, '/provider/patients')
    await expectOpenedElsewhere(opened, 'https://ehr.staging.healthidentitydirectory.com/provider/patients')
  })
})
