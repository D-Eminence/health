import type { StaffSession } from './api'

/**
 * Why the working facility must be chosen before any page opens: 'reselect' when
 * the facility chosen for this sign-in is no longer available, 'unchosen' when
 * none was chosen and the person works at more than one facility, 'unconfirmed'
 * when Identity reports a selection this portal does not know (a later
 * contract), which is not taken as a choice made.
 */
export type FacilityChoiceReason = 'reselect' | 'unchosen' | 'unconfirmed'

/**
 * Whether the working facility must be chosen before any page opens, so that no
 * facility is used that the person did not choose. Null when it was chosen
 * ('selected'), when there is nothing to choose ('default' with one facility),
 * and when Identity does not report the selection (as before 0080).
 */
export function facilityChoiceNeeded(session: StaffSession): FacilityChoiceReason | null {
  // Read as it arrives: a later Identity may send a value the type does not name.
  const selection: unknown = session.facilitySelection
  if (selection == null || selection === 'selected') return null
  if (selection === 'default') return session.actor.facilities.length > 1 ? 'unchosen' : null
  if (selection === 'reselect') return 'reselect'
  return 'unconfirmed'
}
