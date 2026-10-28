import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves account deletion, as this page has learned it from the backend's own answers (contract
 * b45-contract.md §1 "Served detection" and §3.4): GET identity/me/account-deletion answering 200 says served; its 404
 * says not served, only while nothing has said otherwise. hid-system main serves it (0064); on Novu it is served from
 * hid-system 0096, and a backend before 0096, or one with ACCOUNT_DELETION_ENABLED off, answers 404: Settings then shows
 * no "Delete account" card and says nothing. Held in memory for the page's life, as shareServed.ts holds its own.
 *
 * `null` until an answer has said either (treated as not served on Novu).
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnAccountDeletionServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function accountDeletionServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useAccountDeletionServed(): Served {
  return useSyncExternalStore(subscribe, accountDeletionServed, accountDeletionServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetAccountDeletionServed(): void {
  served = null
  changed()
}
