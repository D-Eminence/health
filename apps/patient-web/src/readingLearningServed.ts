import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves Migrate learning (readingLearningContract.ts), as this page has learned it from the
 * backend's own answers, as cannotCompleteServed.ts and wrongPatientServed.ts do. In memory only, for the page's life;
 * nothing is kept in the browser. The website ships before that backend and stays dormant until it.
 *
 * - `review`: what says so is an extraction whose served flag (reviewLearning) is exactly `true`; Check and save and
 *   Reject reading then offer the optional reasons and the missed box, count the items seen, and send what was given.
 *   An answer without the flag says nothing either way.
 * - `quality`: Migrate's "Reading quality" read answering (served) or answering 404 (not served, and only while nothing
 *   has said otherwise). Migrate offers it until a 404 says otherwise.
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

function servedStore() {
  let served: Served = null
  const listeners = new Set<() => void>()
  const changed = () => { for (const listener of listeners) listener() }
  const get = (): Served => served
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    /** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
    learn(value: boolean) {
      if (served === true || served === value) return
      served = value
      changed()
    },
    get,
    subscribe,
    /** For tests: forget what was learned, as a new page would. */
    forget() { served = null; changed() },
  }
}

const review = servedStore()
const quality = servedStore()

export const learnReviewLearningServed = review.learn
export const reviewLearningServed = review.get
/** The same, re-rendering the caller when it is learned. */
export function useReviewLearningServed(): Served {
  return useSyncExternalStore(review.subscribe, review.get, review.get)
}
export const forgetReviewLearningServed = review.forget

export const learnReadingQualityServed = quality.learn
export const readingQualityServed = quality.get
/** The same, re-rendering the caller when it is learned. */
export function useReadingQualityServed(): Served {
  return useSyncExternalStore(quality.subscribe, quality.get, quality.get)
}
export const forgetReadingQualityServed = quality.forget
