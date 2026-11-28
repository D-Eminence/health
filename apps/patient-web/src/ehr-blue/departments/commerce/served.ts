import { useEffect, useSyncExternalStore } from 'react'
import type { StaffSession } from '../../../staff/api'
import { isDemoFacility } from '../../blueFacilities'

/*
 * Where the patient billing pages show (hid-system BILL-1, migrations 0162-0167, docs/EHR_PLANNED_CONTRACT.md "BILL-1"):
 * Payments, Price list, End of day, Payment setup, and the pharmacy's Sell, Sales & receipts, Stock and Receive stock.
 *
 * The backend answers every billing route 404 BILLING_NOT_AVAILABLE at a real facility until the owner's go-live
 * (COMMERCIAL_BILLING_ENABLED), and serves them at the four demo facilities and the sealed QA facility. A backend before
 * 0162 has no such routes, and its gateway answers 404 too. So the pages always show at the four demo facilities, and
 * at any other facility once a billing route there has answered anything but 404 (the contract: "served.ts opens the
 * pages at a facility when the bills route answers anything but 404"). What a facility answered is kept in memory for
 * the page's life, never in the browser. Until a facility has answered, its pages are left out of the menu, search and
 * Home, and their address says they are part of the demo, sending nothing.
 *
 * The frame asks once per facility (useBillingProbe: GET commercial/bills/summary, numbers only, no patient), and every
 * billing answer a page gets teaches the same (api.ts). Lab walk-ins and results sent to outside doctors are not part of
 * BILL-1 (they come with the lab stream): they stay at the demo facilities only (labCounterOpen).
 */

const served = new Map<string, boolean>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version += 1; for (const listener of listeners) listener() }
const keyOf = (facilityId: string) => facilityId.toLowerCase()

/**
 * Records what a billing answer at a facility said: `true` (any answer but 404) once and for all for the page's life;
 * `false` (404: the routes are not served, or not switched on there) only while nothing has said otherwise.
 */
export function learnBillingServed(facilityId: string | null | undefined, value: boolean): void {
  if (!facilityId) return
  const key = keyOf(facilityId)
  const now = served.get(key)
  if (now === true || now === value) return
  served.set(key, value)
  changed()
}

/** What a facility has answered: true, false, or null while it has not answered yet. */
export function billingServed(facilityId: string | null | undefined): boolean | null {
  if (!facilityId) return null
  return served.get(keyOf(facilityId)) ?? null
}

/** Hears each change of what was learned (as useSyncExternalStore's subscribe), as a page entry's listedChanges. */
export function subscribeBillingServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A number that changes whenever anything was learned: the frame works its pages out again when it does. */
export function billingServedVersion(): number { return version }

/** For tests: forget what was learned and which facilities were asked, as a new page would. */
export function forgetBillingServed(): void {
  served.clear()
  asked.clear()
  changed()
}

/** Whether the billing pages show at this facility: a demo facility, or one whose billing routes have answered. */
export function pointOfCareOpen(facilityId: string | null | undefined): boolean {
  return isDemoFacility(facilityId) || billingServed(facilityId) === true
}

/** The same, re-rendering the caller when it is learned. */
export function usePointOfCareOpen(facilityId: string | null | undefined): boolean {
  useSyncExternalStore(subscribeBillingServed, billingServedVersion, billingServedVersion)
  return pointOfCareOpen(facilityId)
}

/** A billing page's `visible`: shown only where its routes answer. */
export const pointOfCareShown = (session: StaffSession): boolean => pointOfCareOpen(session.actor.facility?.id)

/**
 * The lab's walk-in requests and results sent to outside doctors (POINT_OF_CARE_SPEC §4 and §6): not in BILL-1, served by
 * no Health ID release yet, so at the four demo facilities only, as before.
 */
export function labCounterOpen(facilityId: string | null | undefined): boolean {
  return isDemoFacility(facilityId)
}
export const labCounterShown = (session: StaffSession): boolean => labCounterOpen(session.actor.facility?.id)

/**
 * A paper prescription queued for the pharmacy to pick (a walk-in that is not a counter sale): release 1 refuses it 409
 * WALK_IN_QUEUE_NOT_AVAILABLE (BILL-13: it comes with the pharmacy and lab stream). Its page stays at the demo facilities
 * only, as a design to review, and says so instead of sending it.
 */
export function walkInQueueOpen(facilityId: string | null | undefined): boolean {
  return isDemoFacility(facilityId)
}

/** The codes that open a billing page: a session holding none of them has no billing page to show, so is not asked. */
const BILLING_READS: readonly string[] = ['billing.bill.read', 'pharmacy.stock.read']
const asked = new Set<string>()

/**
 * Asks once per facility per page life whether billing is served there, for a session that could open a billing page
 * at a facility that is not a demo facility and has not answered yet: GET commercial/bills/summary (or, for someone
 * who keeps stock but reads no bills, GET pharmacy/stock). Numbers only, no patient. The answer teaches
 * learnBillingServed through api.ts. Returns the version of what was learned, so the frame works its pages out again.
 */
export function useBillingProbe(session: StaffSession | null): number {
  const facilityId = session?.actor.facility?.id ?? null
  const reads = (session?.actor.facility?.permissions ?? []).filter(code => BILLING_READS.includes(code)).join(',')
  const learned = useSyncExternalStore(subscribeBillingServed, billingServedVersion, billingServedVersion)
  useEffect(() => {
    if (!facilityId || !reads || isDemoFacility(facilityId) || billingServed(facilityId) !== null) return
    const key = keyOf(facilityId)
    if (asked.has(key)) return
    asked.add(key)
    void import('./api').then(async ({ commerce }): Promise<unknown> => reads.includes('billing.bill.read')
      ? commerce.billSummary(facilityId) : commerce.stock(facilityId, {}))
      .catch(() => { asked.delete(key) })
  }, [facilityId, reads])
  return learned
}

/** Whether the backend takes a queued (not counter) walk-in: not in release 1 (BILL-13). The pages say so and send nothing. */
export function walkInQueueServed(): boolean {
  return false
}
