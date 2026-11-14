import type { EnrollmentAvailability } from '../../api'

/**
 * The routes that prove a person holds the NIN (hid-system #84, ADR-062; #85,
 * ADR-063): `online`, a code texted to the phone on the NIN record; `facility`,
 * an in-person check at a participating facility. Only `true` opens a route.
 */
export interface OwnershipRoutes {
  online: boolean
  facility: boolean
}

/**
 * The routes an availability answer names, or null from an Identity before the
 * holder step, which sends `{ open }` only and so has neither route. Whether a
 * start may be made is `open` alone (Health-id alignment row 14).
 */
export function routesOf(answer: EnrollmentAvailability | null | undefined): OwnershipRoutes | null {
  if (!answer || typeof answer !== 'object') return null
  if (!('online' in answer) && !('facility' in answer)) return null
  return { online: answer.online === true, facility: answer.facility === true }
}

/** The public list of participating facilities and what to bring (routes/ParticipatingFacilities.tsx). */
export const FACILITY_LIST_PATH = '/enroll/facilities'
