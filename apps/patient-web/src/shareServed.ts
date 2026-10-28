import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves sharing (hid-1.0 parity B4, hid-system 0095 on Novu), as this page has learned it from the
 * backend's own answers (contract b45-contract.md §1, "Served detection"): GET identity/me/share-invitations answering
 * 200 says served; its 404 says not served, only while nothing has said otherwise. Today's backend, and one with
 * PATIENT_SHARES_ENABLED off, answers 404: the share flow, the "Share my records" button and the invitations card are then
 * not offered, and Overview's "Share Records" opens Access and consent as before. Held in memory for the page's life,
 * as cannotCompleteServed.ts holds its own.
 *
 * `null` until an answer has said either (treated as not served).
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnShareServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function shareServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useShareServed(): Served {
  return useSyncExternalStore(subscribe, shareServed, shareServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetShareServed(): void {
  served = null
  changed()
}
