import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves the wrong-patient report (item 3, hid-system 0088), as this page has learned it from the
 * backend's own answers. The website ships before that backend and stays dormant until it (owner decision D15): the
 * Accepted panel's "This isn't the order's patient", and the guidance that sends the ordering clinician and support to the
 * laboratory or pharmacy first, show only once an answer has said the report is there. Before then they would send
 * everyone to an action nobody can take, and away from the remedies that exist (support's Close, the clinician's change).
 *
 * What says so:
 * - a Lab or Pharmacy work list with a card carrying the route's numeric `version` (only 0088's cards do);
 * - the EHR's lab-request or prescription list, and support's order-route lookup, answering `wrongPatientReports: true`;
 * - a read of the Overview card, support's reports, the tile or a facility's count that the backend answers.
 * What says it is not: support's lookup without the field, or one of those reads answering 404 (no such route).
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnWrongPatientServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function wrongPatientServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useWrongPatientServed(): Served {
  return useSyncExternalStore(subscribe, wrongPatientServed, wrongPatientServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetWrongPatientServed(): void {
  served = null
  changed()
}
