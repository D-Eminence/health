import type { StaffProductKey } from './productHostname'

/**
 * Each Health ID product on its own site (owner, 2026-10-31: "Each product should be on their '.'"):
 * - the main site (app in production, staging on staging) is the patient portal, with the public staff pages Identity
 *   accepts only there (staff recovery, facility sign-up, a staff invitation, clinician sign-up);
 * - ehr is the hospital EHR, with the hospital's own laboratory, pharmacy, OCR, migration and outreach;
 * - lab, pharmacy, migrate and outreach each serve their own product;
 * - every staff site also serves what any facility needs: sign-in, the overview, the choice of facility, its staff and
 *   joining, its subscription, its audit, its profile and HR.
 * An address another site serves opens there. The admin site, and any host that is not a Health ID site (local,
 * preview), serve every address, as before.
 */
export type SiteKey = 'web' | StaffProductKey

type Deployment = 'production' | 'staging'

/** Each site's hostname, as the edge names them (infra/cloudflare/src/frontend-worker.mjs). */
const SITE_HOSTNAMES: Readonly<Record<Deployment, Readonly<Record<SiteKey, string>>>> = {
  production: {
    web: 'app.healthidentitydirectory.com',
    ehr: 'ehr.healthidentitydirectory.com',
    lab: 'lab.healthidentitydirectory.com',
    pharmacy: 'pharmacy.healthidentitydirectory.com',
    migrate: 'migrate.healthidentitydirectory.com',
    outreach: 'outreach.healthidentitydirectory.com',
  },
  staging: {
    web: 'staging.healthidentitydirectory.com',
    ehr: 'ehr.staging.healthidentitydirectory.com',
    lab: 'lab.staging.healthidentitydirectory.com',
    pharmacy: 'pharmacy.staging.healthidentitydirectory.com',
    migrate: 'migrate.staging.healthidentitydirectory.com',
    outreach: 'outreach.staging.healthidentitydirectory.com',
  },
}

/** The staff sites in the order a list of them shows. */
export const STAFF_SITES: readonly StaffProductKey[] = ['ehr', 'lab', 'pharmacy', 'migrate', 'outreach']

/** What each site is called where a page names it. */
export const SITE_NAMES: Readonly<Record<SiteKey, string>> = {
  web: 'Health ID',
  ehr: 'Hospital EHR',
  lab: 'Laboratory',
  pharmacy: 'Pharmacy',
  migrate: 'Migrate',
  outreach: 'Outreach',
}

export interface Site {
  readonly key: SiteKey
  readonly deployment: Deployment
  readonly hostname: string
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

/** The Health ID site a hostname is, or null for any other host (local, preview, the admin site). */
export function siteOf(hostname: string): Site | null {
  const normalized = normalizeHostname(hostname)
  for (const deployment of ['production', 'staging'] as const) {
    for (const key of Object.keys(SITE_HOSTNAMES[deployment]) as SiteKey[]) {
      if (SITE_HOSTNAMES[deployment][key] === normalized) return { key, deployment, hostname: normalized }
    }
  }
  return null
}

/** The site `key` of the deployment `deployment`. */
function siteIn(deployment: Deployment, key: SiteKey): Site {
  return { key, deployment, hostname: SITE_HOSTNAMES[deployment][key] }
}

/** The main site's public staff pages, by the first part of their address under /provider: each links to them itself. */
const MAIN_SITE_STAFF_PAGES: ReadonlySet<string> = new Set(['recover', 'enroll', 'invitation', 'join'])

/**
 * On every staff site: sign-in, the overview, the choice of facility, staff and joining, subscription and audit, and
 * the pages the blue EHR keeps for every product (ehr-blue/frame/product.ts): the facility's profile and HR.
 */
const SHARED_STAFF_PAGES: ReadonlySet<string> = new Set(['', 'sign-in', 'institutions', 'staff', 'billing', 'audit', 'facility', 'hr'])

/** Each product site's own pages. Every other staff page is the hospital EHR's. */
const PRODUCT_PAGES: Readonly<Record<Exclude<StaffProductKey, 'ehr'>, readonly string[]>> = {
  lab: ['laboratory'],
  pharmacy: ['pharmacy'],
  migrate: ['ocr', 'migrate'],
  outreach: ['outreach'],
}

/** The first part of an address under /provider, lower-case ('' for the overview), or null outside /provider. */
function providerPage(pathname: string): string | null {
  const match = /^\/provider(?:\/([^/]*))?(?:\/|$)/i.exec(pathname)
  return match ? (match[1] ?? '').toLowerCase() : null
}

/** The staff site a page under /provider belongs to: a product site's own page, else the hospital EHR. */
function productOf(page: string): StaffProductKey {
  const product = (Object.keys(PRODUCT_PAGES) as Exclude<StaffProductKey, 'ehr'>[])
    .find(key => PRODUCT_PAGES[key].includes(page))
  return product ?? 'ehr'
}

/**
 * The site that serves `pathname`, when it is not this host: null where this host serves it. Hosts that are not a
 * Health ID site serve every address; so does any site for the admin pages, which the admin site routes itself, and a
 * staff site for the main site's public staff pages, which link to the main site's own (staffRecoveryHref and the like).
 */
export function siteServing(pathname: string, hostname: string): Site | null {
  const here = siteOf(hostname)
  if (!here || /^\/admin(?:\/|$)/i.test(pathname)) return null
  const page = providerPage(pathname)
  if (page === null) {
    // The patient portal: a staff site's own address opens its product (ProductHostnameGate).
    return here.key === 'web' || pathname === '/' ? null : siteIn(here.deployment, 'web')
  }
  if (MAIN_SITE_STAFF_PAGES.has(page)) return null
  if (here.key === 'web') return siteIn(here.deployment, 'ehr')
  // The hospital EHR keeps the hospital's own laboratory, pharmacy, OCR, migration and outreach (owner, 2026-10-31).
  if (SHARED_STAFF_PAGES.has(page) || here.key === 'ehr') return null
  const owner = productOf(page)
  return owner === here.key ? null : siteIn(here.deployment, owner)
}

/** Whether this host serves `pathname`. */
export function servedHere(pathname: string, hostname: string = window.location.hostname): boolean {
  return siteServing(pathname, hostname) === null
}

/**
 * Whether `pathname` is one of this staff site's own product pages: a page under /provider it serves that is neither
 * one every staff site serves (the overview, sign-in, the choice of facility, staff, subscription, audit, profile, HR)
 * nor one of the main site's public staff pages. On ehr that is every other page; on lab, the laboratory's. False on
 * any host that is not a staff site.
 */
export function ownProductPage(pathname: string, hostname: string): boolean {
  const here = siteOf(hostname)
  const page = providerPage(pathname)
  if (!here || here.key === 'web' || page === null) return false
  if (SHARED_STAFF_PAGES.has(page) || MAIN_SITE_STAFF_PAGES.has(page)) return false
  return siteServing(pathname, hostname) === null
}

/**
 * The address of a page on the site that serves it, with its query and fragment, or null when this host serves it.
 * The host is one of the fixed hostnames above; nothing of the request but the page's own address is kept.
 */
export function rightSiteHref(location: { pathname: string; search: string; hash: string }, hostname: string): string | null {
  const site = siteServing(location.pathname, hostname)
  if (!site) return null
  const href = `https://${site.hostname}${location.pathname}${location.search}${location.hash}`
  return new URL(href).hostname === site.hostname ? href : `https://${site.hostname}/`
}

/** A site's own address, where it opens its product. */
export function siteHref(site: Site): string {
  return `https://${site.hostname}/`
}

/**
 * The other staff sites that serve some of `paths` (the pages a facility may open), in STAFF_SITES order: where a list
 * of this site's pages links out to the rest. None on a host that is not a Health ID site, which serves them all.
 */
export function otherStaffSites(paths: readonly string[], hostname: string = window.location.hostname): Site[] {
  const here = siteOf(hostname)
  if (!here) return []
  const elsewhere = new Set(paths.map(path => siteServing(path, hostname)?.key).filter(key => key !== undefined))
  return STAFF_SITES.filter(key => key !== here.key && elsewhere.has(key)).map(key => siteIn(here.deployment, key))
}

/** The staff site `key` when this host is another Health ID site: null on that site itself, and on any other host. */
export function siteElsewhere(key: StaffProductKey, hostname: string = window.location.hostname): Site | null {
  const here = siteOf(hostname)
  return here && here.key !== key ? siteIn(here.deployment, key) : null
}
