import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves "We can't complete this order" (D18, hid-system 0091 on staging-novu-ci-20261005), as this
 * page has learned it from the backend's own answers: a laboratory or pharmacy may then end an order it accepted and
 * can't complete, with one fixed reason. The website ships before that backend and stays dormant until it (owner
 * decision D18-13, as item 3's D15 and D17-11): until then no screen offers the action or points to it, and every
 * screen keeps its earlier words.
 *
 * What says so (SPEC-FINAL §9.0): `cannotComplete: true` on a Lab or Pharmacy work list, on support's order lookup or on
 * support's facility summary. Only `true` is learned from those answers: an answer without the field, or with another
 * value, says nothing either way.
 * What says it is not: the command's own route answering a 404 that names no order code (no such route), and only while
 * nothing has said otherwise. That covers a page that has learned nothing yet; it is not a switch: D18 is switched off by
 * rolling the four services back together, and a page then opened stays dormant.
 *
 * Words that only a backend serving D18 can produce (an order ended `receiving_unable`, the summary's `notCompleted`,
 * support's counts, the patient's new inbox notice) need no gate: an earlier backend never sends them.
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnCannotCompleteServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function cannotCompleteServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useCannotCompleteServed(): Served {
  return useSyncExternalStore(subscribe, cannotCompleteServed, cannotCompleteServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetCannotCompleteServed(): void {
  served = null
  changed()
}

/** Whether an answer says "We can't complete this order" is served: its `cannotComplete` is exactly `true`. */
export function saysCannotComplete(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as { cannotComplete?: unknown }).cannotComplete === true)
}

/** Learns "served" from an answer that says so. Never learns "not served". */
export function learnCannotCompleteFrom(answer: unknown): void {
  if (saysCannotComplete(answer)) learnCannotCompleteServed(true)
}
