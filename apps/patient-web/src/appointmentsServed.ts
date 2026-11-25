import { useSyncExternalStore } from 'react'

/**
 * Whether the backend serves "My appointments" (hid-system APPT-1 route 12, 0161), as the portal has learned it from the
 * backend's own answers (as shareServed.ts does): GET ehr/me/appointments answering says served; its 404 (an ehr-api
 * before 0161) or 503 APPOINTMENTS_NOT_AVAILABLE (switched off until the owner's go-live) says not served, only while
 * nothing has said otherwise. In memory for the page's life. `null` until an answer has said either; the menu then
 * lists "Appointments", and stops listing it once an answer says it is not served.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()
function changed() { for (const listener of listeners) listener() }

export function learnMyAppointmentsServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function myAppointmentsServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMyAppointmentsServed(): Served {
  return useSyncExternalStore(subscribe, myAppointmentsServed, myAppointmentsServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetMyAppointmentsServed(): void {
  served = null
  changed()
}
