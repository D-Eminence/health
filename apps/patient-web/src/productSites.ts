import type { StaffProductKey } from './productHostname'
import { opensInProduct, PRODUCTS } from './ehr-blue/frame/product'

/**
 * Each Health ID product on its own site (owner, 2026-10-31: "Each product should be on their '.'"; 2026-11-02: each
 * product works on its own, and app. is for patients only):
 * - the main site (app in production, staging on staging) is the patient portal. Its staff addresses are the portal's
 *   own rule (staffSignIn.tsx, which sends app.'s to the EHR site), not this table's, which adds no staff page there;
 * - ehr is the hospital EHR, with every staff page, the hospital's own laboratory, pharmacy, OCR, migration and
 *   outreach included;
 * - lab, pharmacy, migrate and outreach each serve what their product opens (ehr-blue/frame/product.ts opensInProduct:
 *   its own pages, the facility's, Patients and Access requests, each behind its own permission);
 * - every staff site serves its own sign-up, sign-in, password reset and invitations.
 * Another product's own page opens on that product's site. A page of the hospital EHR's stays on the product site, where
 * the frame opens the product's Home in its place: no product site sends anyone to the EHR site. Patient registration
 * stays in the hospital EHR. The admin site, and any host that is not a Health ID site (local, preview), serve every
 * address, as before.
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

/**
 * What a sentence calls each site, in place of its hostname: the product's plain name. Screens never show a hostname;
 * a link to the site keeps its address in its href only.
 */
export const SITE_PRODUCT_NAMES: Readonly<Record<SiteKey, string>> = {
  web: 'the main Health ID site',
  ehr: 'Health ID EHR',
  lab: 'Health ID Lab',
  pharmacy: 'Health ID Pharmacy',
  migrate: 'Health ID Migrate',
  outreach: 'Health ID Outreach',
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

/**
 * The public staff pages, by the first part of their address under /provider: sign-in, password reset, facility sign-up,
 * a staff invitation and clinician sign-up. Every staff site serves its own (owner, 2026-11-02); where each page's own
 * links lead is the page's (productHostname.ts), not this table's.
 */
const PUBLIC_STAFF_PAGES: ReadonlySet<string> = new Set(['sign-in', 'recover', 'enroll', 'invitation', 'join'])

type SingleProduct = Exclude<StaffProductKey, 'ehr'>
const SINGLE_PRODUCTS: readonly SingleProduct[] = ['lab', 'pharmacy', 'migrate', 'outreach']

/**
 * The single product whose own page this is: its home and the pages below it (frame/product.ts PRODUCTS), and Migrate's
 * migration workspace, today's page the migration notice links to, which no page of the frame lists (routes.tsx
 * LIVE_ONLY_TITLES). Null for every other page.
 */
function ownProductOf(page: string): SingleProduct | null {
  if (page === 'migrate') return 'migrate'
  return SINGLE_PRODUCTS.find(product => PRODUCTS[product].home === page) ?? null
}

/** The first part of an address under /provider, lower-case ('' for the overview), or null outside /provider. */
function providerPage(pathname: string): string | null {
  const match = /^\/provider(?:\/([^/]*))?(?:\/|$)/i.exec(pathname)
  return match ? (match[1] ?? '').toLowerCase() : null
}

/** The single product a site is; null for the main site and the hospital EHR's. */
function singleProductOf(site: Site): SingleProduct | null {
  return site.key === 'web' || site.key === 'ehr' ? null : site.key
}

/**
 * The site that serves `pathname`, when it is not this host: null where this host serves it. Hosts that are not a
 * Health ID site serve every address; so does any site for the admin pages, which the admin site routes itself, and the
 * main site for its staff addresses, which the portal's own rule sends on (staffSignIn.tsx). A product site sends only
 * another product's own page to that product's site: a page of the hospital EHR's stays, and the frame opens the
 * product's Home in its place (frame/BlueFrame.tsx).
 */
export function siteServing(pathname: string, hostname: string): Site | null {
  const here = siteOf(hostname)
  if (!here || /^\/admin(?:\/|$)/i.test(pathname)) return null
  const page = providerPage(pathname)
  if (page === null) {
    // The patient portal: a staff site's own address opens its product (ProductHostnameGate).
    return here.key === 'web' || pathname === '/' ? null : siteIn(here.deployment, 'web')
  }
  const product = singleProductOf(here)
  // The hospital EHR keeps the hospital's own laboratory, pharmacy, OCR, migration and outreach (owner, 2026-10-31).
  if (!product || PUBLIC_STAFF_PAGES.has(page) || opensInProduct(product, page)) return null
  const owner = ownProductOf(page)
  return owner && owner !== product ? siteIn(here.deployment, owner) : null
}

/** Whether this host serves `pathname`. */
export function servedHere(pathname: string, hostname: string = window.location.hostname): boolean {
  return siteServing(pathname, hostname) === null
}

/**
 * Whether this host offers `pathname` in its menus and Overview: a page it serves that, on a product site, the product
 * opens (frame/product.ts opensInProduct, the one list of what a product site keeps). A page of the hospital EHR's is
 * served on a product site only for the frame to open the product's Home in its place, so it is never offered there.
 */
export function offeredHere(pathname: string, hostname: string = window.location.hostname): boolean {
  if (!servedHere(pathname, hostname)) return false
  const here = siteOf(hostname)
  const product = here ? singleProductOf(here) : null
  const page = providerPage(pathname)
  return !product || page === null || opensInProduct(product, page)
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

/** The plain name of the Health ID site `href` is on (SITE_PRODUCT_NAMES), for a page that sends the browser there. */
export function siteNameOf(href: string): string {
  const site = siteOf(new URL(href).hostname)
  return site ? SITE_PRODUCT_NAMES[site.key] : 'another Health ID site'
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
