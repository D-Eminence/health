import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves the late correction (D17, hid-system 0090), as this page has learned it from the backend's
 * own answers: a laboratory or pharmacy may then withdraw what it recorded on an order it accepted for the wrong person
 * after the order has ended ("Correct an order that has ended"), and the ordering clinician, the patient and support are
 * told so, each with the date the answer carries. The website ships before that backend and stays dormant until it (owner
 * decision D17-11, as item 3's D15): until then every screen keeps its earlier words, which send nobody to an action that
 * does not exist yet.
 *
 * What says so (SPEC-FINAL §9.0):
 * - `lateCorrection: true` on a Lab or Pharmacy work list, on an EHR lab-request or prescription list, on the ordering
 *   facility's Overview read, on support's order lookup or on support's reports list;
 * - a `correctableUntil` key on any route (an order's routes, the patient's list, support's lookup);
 * - any answer from the new lookup (`POST /{lab|pharmacy}/order-routes/correctable`).
 * What says it is not: that lookup answering a 404 that names no order code (no such route), and only while nothing has
 * said otherwise. That covers a page that has learned nothing yet; it is not a switch: D17 is switched off by rolling the
 * four services back together, and a page then opened stays dormant.
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnLateCorrectionServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function lateCorrectionServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useLateCorrectionServed(): Served {
  return useSyncExternalStore(subscribe, lateCorrectionServed, lateCorrectionServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetLateCorrectionServed(): void {
  served = null
  changed()
}

/** Whether an answer says the late correction is served: its `lateCorrection` is exactly `true`. */
export function saysLateCorrection(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as { lateCorrection?: unknown }).lateCorrection === true)
}

/**
 * Whether any of these routes carries a `correctableUntil` key (a time, or null once it can no longer be corrected): only
 * a backend that serves the late correction sends it.
 */
export function carriesCorrectableUntil(routes: ReadonlyArray<unknown> | null | undefined): boolean {
  return Array.isArray(routes) && routes.some(route => Boolean(route && typeof route === 'object'
    && Object.prototype.hasOwnProperty.call(route, 'correctableUntil')
    && ((route as { correctableUntil?: unknown }).correctableUntil === null
      || typeof (route as { correctableUntil?: unknown }).correctableUntil === 'string')))
}

/** Learns "served" from an answer that says so, or whose routes carry the deadline. Never learns "not served". */
export function learnLateCorrectionFrom(answer: unknown, routes?: ReadonlyArray<unknown> | null): void {
  if (saysLateCorrection(answer) || carriesCorrectableUntil(routes)) learnLateCorrectionServed(true)
}

/** A report on a route, read only when its type is right: `{ reportedAt, late }`, or null. */
export interface LateReport { readonly reportedAt: string; readonly late: boolean }

export function wrongPatientReportOf(route: unknown): LateReport | null {
  const value = route && typeof route === 'object' ? (route as { wrongPatient?: unknown }).wrongPatient : null
  if (!value || typeof value !== 'object') return null
  const { reportedAt, late } = value as { reportedAt?: unknown; late?: unknown }
  if (typeof reportedAt !== 'string' || !Number.isFinite(Date.parse(reportedAt)) || typeof late !== 'boolean') return null
  return { reportedAt, late }
}

/**
 * A route's `correctableUntil`, read only when its type is right: the time (a string that reads as one), `null` when the
 * backend says it can no longer be corrected, or `undefined` when the route does not carry it (an earlier backend) or it
 * does not read as a time.
 */
export function correctableUntilOf(route: unknown): string | null | undefined {
  if (!route || typeof route !== 'object' || !Object.prototype.hasOwnProperty.call(route, 'correctableUntil')) return undefined
  const value = (route as { correctableUntil?: unknown }).correctableUntil
  if (value === null) return null
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

/**
 * Until when the receiving facility can still withdraw what it recorded on a route, for the words that send someone to
 * it: its `correctableUntil` as `correctableUntilOf` reads it, but `null` once that facility was released from Health ID
 * (`endedKind` 'receiving_released'): its memberships ended, so it can no longer act, whatever date an answer carries,
 * and D17-3's stop-gap applies. Since hid-system 0090 is fixed the backend gives no date then either.
 */
export function receivingDeadlineOf(route: unknown): string | null | undefined {
  const until = correctableUntilOf(route)
  if (until === undefined) return undefined
  return (route as { endedKind?: unknown }).endedKind === 'receiving_released' ? null : until
}
