import type { StaffSession } from './api'

/**
 * Whether the working facility must be chosen before any page opens, so that no
 * facility is used that the person did not choose: 'reselect' when the facility
 * chosen for this sign-in is no longer available, 'unchosen' when none was chosen
 * and the person works at more than one facility. Null otherwise, including when
 * Identity does not report the selection (as before 0080).
 */
export function facilityChoiceNeeded(session: StaffSession): 'reselect' | 'unchosen' | null {
  if (session.facilitySelection === 'reselect') return 'reselect'
  if (session.facilitySelection === 'default' && session.actor.facilities.length > 1) return 'unchosen'
  return null
}
