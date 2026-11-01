import type { LucideIcon } from 'lucide-react'
import { FlaskConical, Hospital, Pill, ScanText, Users } from 'lucide-react'
import { resolveStaffProductHostname } from '../../productHostname'
import { PUBLIC_ENVIRONMENT } from '../../publicEnvironment'
import { basePath } from './pageHref'

/**
 * Which Health ID product this workspace is (the owner's decision of 2026-10-31). A hospital may run everything: the
 * EHR with its laboratory, pharmacy and outreach inside it. A pharmacy, a laboratory or an outreach team may run only
 * its own product. Then it gets a focused workspace: its own name, its queue as home, and none of the hospital's
 * clinical places.
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

/** Pages every product keeps: running the facility itself (its people, its audit trail, its profile). */
const SHARED: ReadonlySet<string> = new Set(['staff', 'audit', 'facility', 'hr', 'institutions'])

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

/** Whether a page belongs in this product's workspace. The EHR has them all. */
export function inProduct(product: Product, path: string): boolean {
  if (product === 'ehr') return true
  const base = basePath(path)
  // The product's own pages below its home too: pharmacy/sell … pharmacy/settings, laboratory/new … laboratory/settings.
  return base === PRODUCTS[product].home || base.startsWith(`${PRODUCTS[product].home}/`) || SHARED.has(base)
    || (SELLS.has(product) && COUNTER_PAGES.has(base))
}

/**
 * Pages a single product opens at their address but does not list: the facility's subscription, where the billing
 * banner above every page leads ("Choose a plan", "Pay now": staff/routes/Billing.tsx).
 */
const OPENED_UNLISTED: ReadonlySet<string> = new Set(['billing'])

/**
 * Whether this product's workspace opens a page at its address; the frame sends any other to the product's Home. Home
 * itself opens (it goes on to the product's own page), as do the pages the product lists. Every other page is the
 * hospital EHR's: Patient registration (the EHR's only, owner rule), Consultation, the samples and demo pages.
 */
export function opensInProduct(product: Product, path: string): boolean {
  const base = basePath(path)
  return base === '' || inProduct(product, path) || OPENED_UNLISTED.has(base)
}
