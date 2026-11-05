import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves Outreach follow-up visits, member names and linking by Health ID (hid-system 0115, behind
 * OUTREACH_VISITS_ENABLED), as this page has learned it from the backend's own answers. The website ships before that
 * backend is switched on and stays dormant until it: every Outreach screen sends exactly today's requests and shows
 * exactly today's words.
 *
 * What says so: a registration case answer (the list, a case made, a case linked) carrying a numeric `visitCount`, which
 * only 0115 with the switch on sends. Nothing says it is not: a backend without it simply never says so. Held in memory
 * for the page's life, as the other served flags (patientEntriesServed.ts) are; never in browser storage.
 *
 * Once served, it stays served for the page's life.
 */
let served = false
const listeners = new Set<() => void>()

/** Learns from case answers: served once any carries a numeric visitCount. */
export function learnOutreachVisitsServed(answers: ReadonlyArray<unknown> | null | undefined): void {
  if (served || !answers) return
  if (!answers.some(answer => typeof (answer as { visitCount?: unknown } | null)?.visitCount === 'number')) return
  served = true
  for (const listener of listeners) listener()
}

export function outreachVisitsServed(): boolean { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useOutreachVisitsServed(): boolean {
  return useSyncExternalStore(subscribe, outreachVisitsServed, outreachVisitsServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetOutreachVisitsServed(): void {
  served = false
  for (const listener of listeners) listener()
}
