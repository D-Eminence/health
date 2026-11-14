import { useSyncExternalStore } from 'react'

/**
 * Whether Identity serves "Notifications on this device", as this page has learned it from Identity's own answers
 * (contract b6-contract.md §11.4): GET identity/me/web-push answering 200 says served; its 404 says not, only while
 * nothing has said otherwise. hid-system 0097 serves it on Novu, and only once the owner has configured the push keys:
 * before that, and on any backend before 0097, it answers 404 and the Notifications page shows no device section and says
 * nothing. Held in memory for the page's life, as accountDeletionServed.ts holds its own.
 *
 * `null` until an answer has said either (treated as not served).
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnWebPushServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function webPushServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useWebPushServed(): Served {
  return useSyncExternalStore(subscribe, webPushServed, webPushServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetWebPushServed(): void {
  served = null
  changed()
}
