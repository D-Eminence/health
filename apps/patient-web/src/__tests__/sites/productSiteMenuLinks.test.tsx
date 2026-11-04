import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { offeredHere } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, blueAddresses, openBlueOn, OUTREACH_DEMO, PHARMACY_DEMO, REAL_CLINIC, siteLinks } from './siteHarness'

/**
 * Each product site's menu links only to what that site serves and the role can use (live report, 2026-11-02: on lab.,
 * a staff member at a real facility whose role holds only audit.read and lab.walk-in.create saw a "Pharmacy" link).
 * Pharmacy's own address (pharmacy/*) has no permission of its own: it opens for every session and sends it on to
 * Prescriptions or Sell. Counted as a page the role could use, it linked every other product site to the Pharmacy's.
 * Every host here is run with a few narrow roles, at a real facility and at a demo one. What each role can use on each
 * product's site is written out below, apart from the code that decides it. Every account and facility is fictional,
 * and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
vi.mock('../../openSite', () => ({ openSite: vi.fn() }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

type Host = 'ehr' | 'lab' | 'pharmacy' | 'migrate' | 'outreach'
type SingleProduct = Exclude<Host, 'ehr'>
const HOSTS: Readonly<Record<Host, string>> = {
  ehr: 'ehr.healthidentitydirectory.com',
  lab: 'lab.healthidentitydirectory.com',
  pharmacy: 'pharmacy.healthidentitydirectory.com',
  migrate: 'migrate.healthidentitydirectory.com',
  outreach: 'outreach.healthidentitydirectory.com',
}
/** The demo facility each host is opened at: its own, or Demo Hospital (EHR and Migrate) where none is. */
const DEMO_AT: Readonly<Record<Host, { id: string; name: string }>> = {
  ehr: { id: DEMO_HOSPITAL, name: 'Demo Hospital' },
  lab: { id: DEMO_LABORATORY, name: 'Demo Laboratory' },
  pharmacy: { id: PHARMACY_DEMO, name: 'Demo Pharmacy' },
  migrate: { id: DEMO_HOSPITAL, name: 'Demo Hospital' },
  outreach: { id: OUTREACH_DEMO, name: 'Demo Outreach' },
}
const SITE_NAME: Readonly<Record<SingleProduct, string>> = { lab: 'Laboratory', pharmacy: 'Pharmacy', migrate: 'Migrate', outreach: 'Outreach' }
/** Each single product's own pages, by address, and its site. */
const OWN_ADDRESS: Readonly<Record<SingleProduct, RegExp>> = {
  lab: /^\/provider\/laboratory(\/|$)/, pharmacy: /^\/provider\/pharmacy(\/|$)/, migrate: /^\/provider\/ocr(\/|$)/, outreach: /^\/provider\/outreach(\/|$)/,
}

/**
 * The permissions that open one of a product's own pages: at every facility, and at the demo facilities only (the
 * point-of-care pages: New request, Sell, Sales & receipts, Stock, prices, Till, Payment setup).
 */
const OPENS: Readonly<Record<SingleProduct, { everywhere: readonly string[]; demo: readonly string[] }>> = {
  lab: { everywhere: ['lab.work-item.read'], demo: ['lab.walk-in.create', 'billing.catalogue.read', 'billing.shift.own', 'billing.settings.manage'] },
  pharmacy: { everywhere: ['pharmacy.work-item.read'],
    demo: ['pharmacy.walk-in.create', 'billing.bill.read', 'pharmacy.stock.read', 'billing.catalogue.read', 'billing.shift.own', 'billing.settings.manage'] },
  migrate: { everywhere: ['ocr.job.read'], demo: [] },
  outreach: { everywhere: ['outreach.registration.read', 'outreach.campaign.read'], demo: [] },
}

function canUse(product: SingleProduct, permissions: readonly string[], demo: boolean): boolean {
  const opening = [...OPENS[product].everywhere, ...(demo ? OPENS[product].demo : [])]
  return permissions.some(permission => opening.includes(permission))
}

/** The other product sites a role is linked to from `host`: those where it can use a page, never the EHR's or its own. */
function expectedSiteLinks(host: Host, permissions: readonly string[], demo: boolean): [string, string][] {
  if (host === 'ehr') return []
  return (['lab', 'pharmacy', 'migrate', 'outreach'] as const)
    .filter(product => product !== host && canUse(product, permissions, demo))
    .map(product => [SITE_NAME[product], `https://${HOSTS[product]}/`])
}

const ROLES: readonly [string, readonly string[]][] = [
  ['audit and lab walk-ins (the live report)', ['audit.read', 'lab.walk-in.create']],
  ['audit only', ['audit.read']],
  ['the lab work list', ['lab.work-item.read']],
  ['prescriptions', ['pharmacy.work-item.read']],
  ['the pharmacy counter', ['pharmacy.walk-in.create']],
  ['pharmacy sales and receipts', ['billing.bill.read']],
  ['document OCR', ['ocr.job.read']],
  ['outreach campaigns', ['outreach.campaign.read']],
]

const CASES = (['lab', 'pharmacy', 'migrate', 'outreach', 'ehr'] as const).flatMap(host => [false, true].flatMap(demo =>
  ROLES.map(([role, permissions]) => [host, demo ? 'a demo facility' : 'a real facility', role, permissions, demo] as const)))

/** Every link on the page, by address (the sidebar, the phone tabs, the header and the page). */
const everyLink = () => [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map(link => link.getAttribute('href') ?? '')

describe('the links on each product site', () => {
  it.each(CASES)('on %s, at %s, for %s: only this site’s pages and the sites the role can use', async (host, _where, _role, permissions, demo) => {
    const at = demo ? DEMO_AT[host] : { id: REAL_CLINIC, name: 'Fictional Clinic' }
    const nav = await openBlueOn(HOSTS[host], at, permissions)
    // The other Health ID sites: exactly those where this role can use a page.
    expect(siteLinks(nav)).toEqual(expectedSiteLinks(host, permissions, demo))
    // This site's own links: pages it serves and offers.
    expect(blueAddresses(nav).filter(address => !offeredHere(address, HOSTS[host]))).toEqual([])
    // Nowhere on the page a link to another product, its pages or its site, that the role cannot use there. (A product
    // site's own home is its own: pharmacy. lands every role on Pharmacy, which says plainly why it is closed to one that
    // cannot use it: ProductSiteHome.test.tsx.)
    for (const product of ['lab', 'pharmacy', 'migrate', 'outreach'] as const) {
      if (product === host || canUse(product, permissions, demo)) continue
      const toIt = everyLink().filter(href => OWN_ADDRESS[product].test(href) || href.startsWith(`https://${HOSTS[product]}`))
      expect(toIt, product).toEqual([])
    }
  })
})

describe('pageUsable', () => {
  const at = (permissions: readonly string[], id = REAL_CLINIC) => ({ actor: { facility: { id, permissions } } }) as never

  it('counts Pharmacy’s own address only where one of the Pharmacy’s pages opens, though it opens for everyone', async () => {
    const { pageAllowed, pageUsable } = await import('../../ehr-blue/frame/pageAccess')
    const { BLUE_PAGES } = await import('../../ehr-blue/routes')
    const hub = BLUE_PAGES.find(page => page.path === 'pharmacy/*')!
    expect(pageAllowed(hub, at(['audit.read', 'lab.walk-in.create']))).toBe(true)
    expect(pageUsable(hub, BLUE_PAGES, at(['audit.read', 'lab.walk-in.create']))).toBe(false)
    expect(pageUsable(hub, BLUE_PAGES, at(['pharmacy.work-item.read']))).toBe(true)
    // Sell shows at the demo facilities only.
    expect(pageUsable(hub, BLUE_PAGES, at(['pharmacy.walk-in.create']))).toBe(false)
    expect(pageUsable(hub, BLUE_PAGES, at(['pharmacy.walk-in.create'], PHARMACY_DEMO))).toBe(true)
  })

  it('leaves every other page as it opens', async () => {
    const { pageAllowed, pageUsable } = await import('../../ehr-blue/frame/pageAccess')
    const { BLUE_PAGES } = await import('../../ehr-blue/routes')
    for (const permissions of [['audit.read'], ['lab.work-item.read'], ['outreach.campaign.read'], ['ocr.job.read']]) {
      for (const page of BLUE_PAGES.filter(candidate => candidate.path !== 'pharmacy/*')) {
        expect(pageUsable(page, BLUE_PAGES, at(permissions)), `${page.path} with ${permissions.join()}`).toBe(pageAllowed(page, at(permissions)))
      }
    }
  })
})
