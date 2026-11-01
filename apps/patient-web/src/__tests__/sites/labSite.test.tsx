import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { servedHere, rightSiteHref } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY, facility } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectOpenedElsewhere, openBlueOn, openClassicOn, openPortalOn,
  overviewWorkspaces, signInActionOn, siteLinks,
} from './siteHarness'
import type { Sent } from '../ehr-blue/frame/blueHarness'

/** lab.: the Laboratory product, with the pages every staff site serves. Everything else opens on its own site. */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const LAB = 'lab.healthidentitydirectory.com'
const LAB_STAGING = 'lab.staging.healthidentitydirectory.com'

describe(LAB, () => {
  it.each(['/provider', '/provider/sign-in', '/provider/laboratory', '/provider/laboratory/item-1', '/provider/audit',
    '/provider/billing', '/provider/staff', '/provider/staff/join', '/provider/institutions', '/'])('serves %s', path => {
    expect(servedHere(path, LAB)).toBe(true)
    expect(servedHere(path, LAB_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/patients', 'https://ehr.healthidentitydirectory.com/provider/patients'],
    ['/provider/clinical', 'https://ehr.healthidentitydirectory.com/provider/clinical'],
    ['/provider/appointments/5a020001?view=day', 'https://ehr.healthidentitydirectory.com/provider/appointments/5a020001?view=day'],
    ['/provider/pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
    ['/provider/ocr', 'https://migrate.healthidentitydirectory.com/provider/ocr'],
    ['/provider/migrate', 'https://migrate.healthidentitydirectory.com/provider/migrate'],
    ['/provider/outreach', 'https://outreach.healthidentitydirectory.com/provider/outreach'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (path, href) => {
    const [pathname, search = ''] = path.split('?')
    expect(rightSiteHref({ pathname: pathname!, search: search ? `?${search}` : '', hash: '' }, LAB)).toBe(href)
  })

  it('sends the Hospital EHR’s pages there, in place of this address, with their query', async () => {
    await openPortalOn(LAB, '/provider/patients?from=lab')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/patients?from=lab')
    expect(document.title).toBe('Opening another Health ID site · Health ID')
  })

  it('sends Pharmacy to the pharmacy site, and the patient portal to the main site', async () => {
    await openPortalOn(LAB, '/provider/pharmacy')
    await expectOpenedElsewhere(opened, 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy')
  })

  it('sends the patient portal to the main site', async () => {
    await openPortalOn(LAB, '/records')
    await expectOpenedElsewhere(opened, 'https://app.healthidentitydirectory.com/records')
  })

  it('opens its own staff sign-in, which comes back to the page asked for', async () => {
    await openPortalOn(LAB, '/provider/audit')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Faudit')
    expect(opened).not.toHaveBeenCalled()
  })

  it('opens its own page at its address', async () => {
    await openPortalOn(LAB, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with lab-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(LAB)).toBe('lab-login')
  })

  it('lists the laboratory’s pages in today’s sidebar, and links to the sites that serve the rest', async () => {
    const sidebar = await openClassicOn(LAB)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Facility audit', 'Laboratory', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('offers the laboratory’s own workspace on the Overview, and reads nothing for the Hospital EHR’s', async () => {
    const sent: Sent[] = []
    await openClassicOn(LAB, '/provider', sent)
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(overviewWorkspaces()).toEqual(['Laboratory'])
    expect(screen.getByText('Your other workspaces are on other Health ID sites, linked in the sidebar.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Access requests' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Health ID Migrate' })).toBeNull()
    expect(sent.map(request => request.route)).not.toContain('GET /api/v1/identity/access-requests')
  })

  it('opens the blue EHR at Demo Laboratory as the Laboratory, with this site’s pages only', async () => {
    const nav = await openBlueOn(LAB, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Lab')
    expect(blueAddresses(nav).some(address => address === '/provider/laboratory' || address.startsWith('/provider/laboratory/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !servedHere(address, LAB))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Hospital EHR', 'https://ehr.healthidentitydirectory.com/'],
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens nothing of Demo Hospital here: it works on the Hospital EHR’s site', async () => {
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    await openBlueOn(LAB, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION, [lab])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Hospital works on Hospital EHR' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByText(/^Demo Hospital is on ehr\.healthidentitydirectory\.com, where you sign in separately\./)).toBeTruthy()
    expect(page.getByRole('link', { name: 'Open Hospital EHR' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/')
    expect(page.getByRole('link', { name: 'Choose workspace' }).getAttribute('href')).toBe('/provider/institutions')
  })
})

describe(LAB_STAGING, () => {
  it('sends the Hospital EHR’s pages to the staging EHR site', async () => {
    await openPortalOn(LAB_STAGING, '/provider/requests')
    await expectOpenedElsewhere(opened, 'https://ehr.staging.healthidentitydirectory.com/provider/requests')
  })

  it('signs in with lab-login', async () => {
    expect(await signInActionOn(LAB_STAGING)).toBe('lab-login')
  })
})
