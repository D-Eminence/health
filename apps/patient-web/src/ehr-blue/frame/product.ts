import type { LucideIcon } from 'lucide-react'
import { FlaskConical, Hospital, Pill, ScanText, Users } from 'lucide-react'
import { resolveStaffProductHostname } from '../../productHostname'
import { PUBLIC_ENVIRONMENT } from '../../publicEnvironment'
import type { StaffSession } from '../../staff/api'
import type { EhrBluePage } from './types'
import { basePath, pageHrefOf } from './pageHref'

/**
 * Which Health ID product this workspace is (the owner's decision of 2026-10-31). A hospital may run everything: the
 * EHR with its laboratory, pharmacy and outreach inside it. A pharmacy, a laboratory or an outreach team may run only
 * its own product. Then it gets a focused workspace: its own name, its queue as home, and none of the hospital's
 * clinical places but finding a patient and asking for their record.
 *
 * Decided from what the backend already gives:
 *  - The product's own address (lab., pharmacy., outreach., migrate.: productHostname.ts) is that product.
 *  - On the EHR's address, a facility whose staff hold only one product's permissions, and no clinical one, is that
 *    product.
 *  - Anything else is the EHR.
 * The preview can pretend with ?product= (read by its in-page mock, never by a real deployment).
 */
export type Product = 'ehr' | 'lab' | 'pharmacy' | 'outreach' | 'migrate'

interface ProductInfo { name: string; icon: LucideIcon; home: string; prefix: string }
export const PRODUCTS: Readonly<Record<Product, ProductInfo>> = {
  ehr: { name: 'EHR', icon: Hospital, home: '', prefix: 'ehr.' },
  lab: { name: 'Lab', icon: FlaskConical, home: 'laboratory', prefix: 'lab.' },
  pharmacy: { name: 'Pharmacy', icon: Pill, home: 'pharmacy', prefix: 'pharmacy.' },
  outreach: { name: 'Outreach', icon: Users, home: 'outreach', prefix: 'outreach.' },
  migrate: { name: 'Migrate', icon: ScanText, home: 'ocr', prefix: 'ocr.' },
}

/**
 * Pages every product keeps: running the facility itself (its people, its audit trail, its profile), and Patients and
 * Access requests. A lab scientist or a pharmacist reaches a patient's record only through a request the patient
 * approves, and the classic portal listed both pages on every site, by permission (staff/navigation.ts). Each still
 * needs its own permission; the EHR's other clinical pages, registration among them, stay out.
 */
const SHARED: ReadonlySet<string> = new Set(['staff', 'audit', 'facility', 'hr', 'institutions', 'patients', 'requests'])

const SINGLE: readonly Exclude<Product, 'ehr'>[] = ['lab', 'pharmacy', 'outreach', 'migrate']

/**
 * The money pages a pharmacy or a lab on its own keeps (docs/POINT_OF_CARE_SPEC.md: departments/commerce): it takes
 * payment at its own counter, keeps its price list and closes its day. Each still needs its own permission.
 */
const COUNTER_PAGES: ReadonlySet<string> = new Set(['payments', 'price-list', 'end-of-day', 'payment-setup'])
// A pharmacy's menu has its own Sales & receipts, Products & prices, Till / End of day and Settings (pharmacy/page.tsx),
// so it lists none of these.
// A lab's menu has its own Tests & prices, Till / End of day and Settings (laboratory/page.tsx), so it lists none either.
const SELLS: ReadonlySet<Product> = new Set<Product>([])

declare global { interface Window { __HID_PREVIEW_PRODUCT__?: string } }

export function productOf(hostname: string, permissions: readonly string[]): Product {
  // The local preview's product picker only; a production build never reads it.
  const pretend = PUBLIC_ENVIRONMENT.VITE_HID_ENVIRONMENT === 'local' && typeof window !== 'undefined' ? window.__HID_PREVIEW_PRODUCT__ : undefined
  if (pretend && pretend in PRODUCTS) return pretend as Product
  const host = resolveStaffProductHostname(hostname)?.key
  if (host) return host
  const clinical = permissions.some(p => p.startsWith('ehr.') || p === 'identity.patient.read')
  if (clinical) return 'ehr'
  const held = SINGLE.filter(product => permissions.some(p => p.startsWith(PRODUCTS[product].prefix)))
  return held.length === 1 ? held[0]! : 'ehr'
}

/**
 * The product this workspace is for this session, here: by this page's address and the current facility's permissions.
 * The frame and What's left both ask this way, so its sidebar and What's left never disagree about which site this is.
 */
export function productHere(session: StaffSession | null): Product {
  return productOf(window.location.hostname, session?.actor.facility?.permissions ?? [])
}

/** Whether a page belongs in this product's workspace. The EHR has them all. */
export function inProduct(product: Product, path: string): boolean {
  if (product === 'ehr') return true
  const base = basePath(path)
  // The product's own pages below its home too: pharmacy/sell … pharmacy/settings, laboratory/new … laboratory/settings.
  return base === PRODUCTS[product].home || base.startsWith(`${PRODUCTS[product].home}/`) || SHARED.has(base)
    || (SELLS.has(product) && COUNTER_PAGES.has(base))
}

/**
 * Whether this product's workspace offers a page: the frame lists only these (each still under its own permission), and
 * What's left shows only these, so a lab's, pharmacy's, outreach team's or migration site never offers the hospital's
 * pages (Patient registration is the EHR's alone). A single product has no Home: its first page is its own. (The frame
 * lists Home there only to a session that may not open that page, as /provider stays on Home for it: BlueFrame.tsx.)
 */
export function productLists(product: Product, path: string): boolean {
  if (ONLY_OWN.has(product)) return ownPath(product, path)
  return inProduct(product, path) && (product === 'ehr' || path !== '')
}

/**
 * The products whose workspace lists only their own pages (owner, 13 November 2026): Outreach on its own is Outreach
 * only. Its menu, tab bar and search offer its campaigns and nothing of a hospital's (no Patients, Access requests,
 * Network & Services, Insight or Settings) and no other product's. Outreach inside a hospital's EHR is unchanged.
 */
const ONLY_OWN: ReadonlySet<Product> = new Set<Product>(['outreach'])

/** Whether a page is the product's own: its home page or one below it. */
function ownPath(product: Product, path: string): boolean {
  const base = basePath(path)
  return base === PRODUCTS[product].home || base.startsWith(`${PRODUCTS[product].home}/`)
}

/** Whether this product's workspace lists only its own pages (ONLY_OWN). */
export function listsOnlyOwn(product: Product): boolean {
  return ONLY_OWN.has(product)
}

/**
 * Pages a single product opens at their address but does not list, because something on every product's screens
 * leads there, or because its staff need them:
 *  - Facility subscription: the billing banner above every page leads there ("Choose a plan", "Pay now":
 *    staff/routes/Billing.tsx).
 *  - What's left: the Demo chip in the header leads there ("See what's left": TopBarParts.tsx). Its own `visible`
 *    keeps it to the demo facilities.
 *  - Facility setup: a facility that signed itself up works on its product's site (signup/AfterSubmit.tsx). Its own
 *    `visible` keeps it to those facilities' staff managers.
 *  - Patients and Access requests: a lab scientist or a pharmacist reaches a record only through a request the patient
 *    approves (parity report 3.1 #7), and the Notifications drawer's "access requests waiting" leads there.
 */
const OPENED_UNLISTED: ReadonlySet<string> = new Set(['billing', 'whats-left', 'onboarding', 'patients', 'requests'])

/**
 * The products with a till of their own (Till / End of day). It leads to the money pages at their own addresses
 * ("No tills yet" → Payment setup: commerce/EndOfDay.tsx), so those open there, unlisted, as commerce/page.tsx says.
 */
const TILLS: ReadonlySet<Product> = new Set<Product>(['lab', 'pharmacy'])

/**
 * Whether this product's workspace opens a page at its address; the frame sends any other to the product's Home. Home
 * itself opens (it goes on to the product's own page, or stays Home where this session may not open that page), as do
 * the pages the product lists and those above. Every other page is the hospital EHR's: Patient registration (the EHR's only, owner rule), In-person check, Consultation,
 * Emergency, the samples.
 */
export function opensInProduct(product: Product, path: string): boolean {
  const base = basePath(path)
  return base === '' || inProduct(product, path) || OPENED_UNLISTED.has(base) || (TILLS.has(product) && COUNTER_PAGES.has(base))
}

/**
 * Whether this product's workspace lists a page: productLists for its address, or any page but Home that says it is on
 * every product's site (EhrBluePage.everyProduct) and whose address this host serves (`served`, productSites.ts
 * servedHere). A product site sends an address another product's site owns there before the frame loads (App.tsx
 * ProductHostnameGate), so a link to it would leave the site: such a page is listed only where its address stays.
 * Its own permission and `visible` are the caller's, as before.
 */
export function pageListedInProduct(product: Product, page: Pick<EhrBluePage, 'path' | 'everyProduct'>,
  served: (href: string) => boolean): boolean {
  if (ONLY_OWN.has(product)) return productLists(product, page.path)
  return (page.everyProduct === true && basePath(page.path) !== '' && served(pageHrefOf(page))) || productLists(product, page.path)
}

/**
 * Whether this product's workspace opens a page: opensInProduct for its address, or a page on every product's site
 * whose address this host serves (`served`, as pageListedInProduct).
 */
export function pageOpensInProduct(product: Product, page: Pick<EhrBluePage, 'path' | 'everyProduct'>,
  served: (href: string) => boolean): boolean {
  return (page.everyProduct === true && served(pageHrefOf(page))) || opensInProduct(product, page.path)
}
