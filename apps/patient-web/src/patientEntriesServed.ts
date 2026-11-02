import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'

/**
 * Whether the backend serves the records a patient adds themselves ("Add a record", BACKEND-NEEDS.md §1: the entry,
 * its photos and files through a signed link, the list in the records answer and the removal), as this page has
 * learned it from the backend's own answers. The website ships before that backend and stays dormant until it: the
 * drawer still saves as it does today, and today's backend refuses that Save, so no photo or file ever leaves the device.
 *
 * What says so: the records answer (GET ehr/me/records, the Records page's own read; there is no list read of its own)
 * carrying the key `patientEntries` as a list, or a Save (POST ehr/me/patient-entries) answering 201. What says it is
 * not: a records answer without that key (today's), or the Save answering 404 with code NOT_FOUND (ehr-api's answer for
 * a path it does not route; a 404 with no code reads the same), and only while nothing has said otherwise. A Save's 404
 * with any other code is the served route's own refusal and says nothing here, nor does a `patientEntries` that is not a
 * list. Held in memory for the page's life, as shareServed.ts holds its own.
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnPatientEntriesServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function patientEntriesServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function usePatientEntriesServed(): Served {
  return useSyncExternalStore(subscribe, patientEntriesServed, patientEntriesServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetPatientEntriesServed(): void {
  served = null
  changed()
}

/**
 * Whether a refusal of the Save says the routes are not served: a 404 whose code is NOT_FOUND. A served route's 404
 * always carries its own code (PATIENT_ENTRY_NOT_FOUND and the like), never NOT_FOUND.
 */
export function saysPatientEntriesNotServed(error: unknown): boolean {
  return isHidApiError(error) && error.status === 404 && error.code === 'NOT_FOUND'
}
