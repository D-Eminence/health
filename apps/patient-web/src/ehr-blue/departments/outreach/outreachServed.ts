import type { OutreachCase } from '../../../staff/api'

/*
 * What this Outreach serves, as its answers have shown it, remembered for the rest of the session: in this module's
 * memory only, never in browser storage, so a reload starts again from nothing. A registration list that is empty (the
 * day's first registration) or can't be read (no signal) says nothing, and what was seen before still holds.
 *
 * - Health checks (0118): registrations carry `hasScreening`. Then the form asks for the area and takes longer notes.
 * - Health ID by email (0119): registrations carry `healthId`.
 * - Health ID with no email (0120): registrations carry `healthIdStatus`, unless its route answered 404 (not served),
 *   which then holds for the session.
 *
 * Each is true once seen (served), false while only answers without it have been seen, and undefined while nothing
 * has been seen. Copy only: Outreach decides what it takes.
 */

type Known = boolean | undefined

let healthChecks: Known
let emailHealthId: Known
let unverifiedHealthId: Known
let unverifiedRefused = false

/** Learns what Outreach serves from registrations as it answered them (the list, or one just saved). */
export function noteOutreachRegistrations(items: readonly OutreachCase[] | null | undefined): void {
  if (!items?.length) return
  const carry = (key: string) => items.some(item => key in item)
  healthChecks = healthChecks || carry('hasScreening')
  emailHealthId = emailHealthId || carry('healthId')
  unverifiedHealthId = !unverifiedRefused && (unverifiedHealthId || carry('healthIdStatus'))
}

/** Outreach answered 404 (route not served) to "No email or phone": not offered again, and not promised, this session. */
export function noteUnverifiedHealthIdNotServed(): void {
  unverifiedRefused = true
  unverifiedHealthId = false
}

/** Which ways of making a Health ID at outreach are served, as far as is known this session. */
export type HealthIdRoutes = 'both' | 'email' | 'none'

export interface OutreachServed {
  /** Health checks, the area and longer notes: true once seen. */
  readonly healthChecks: boolean
  /** Health ID by email: true once seen, false when only registrations without it were seen, undefined when unknown. */
  readonly emailHealthId: Known
  /** The Health ID routes as the notice may promise them: 'none' while nothing is known. */
  readonly healthIdRoutes: HealthIdRoutes
}

/** What is known this session. */
export function outreachServed(): OutreachServed {
  return {
    healthChecks: healthChecks === true,
    emailHealthId,
    healthIdRoutes: emailHealthId ? (unverifiedHealthId ? 'both' : 'email') : 'none',
  }
}

/** Forgets what was seen (tests). */
export function forgetOutreachServed(): void {
  healthChecks = undefined
  emailHealthId = undefined
  unverifiedHealthId = undefined
  unverifiedRefused = false
}
