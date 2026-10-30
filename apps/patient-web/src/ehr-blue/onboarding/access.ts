import type { StaffSession } from '../../staff/api'
import { selfServiceReview } from '../../staff/staffAccess'
import { BLUE_FOR_ALL } from '../clinicSwitch'
import { listsStaff } from '../departments/staff/page'

/** The facility permission Facility setup needs: its Staff and Roles steps are today's staff management. */
export const SETUP_PERMISSION = 'workforce.manage'

/**
 * Whether Facility setup opens, and is listed, for this session: only once the clinic switch is on (clinicSwitch.ts),
 * at a facility that signed itself up to Health ID (selfServiceReview: 'pending' or 'reviewed'), for a member who
 * manages its staff. Its Staff and Roles steps are the live Staff & access page, so it also keeps that page's rule:
 * where today's sidebar lists Staff (listsStaff: Novu, a self-signed-up facility, workforce.manage). Health ID support
 * manages a governed facility's staff.
 */
export function opensFacilitySetup(session: StaffSession): boolean {
  const facility = session.actor.facility
  return BLUE_FOR_ALL
    && selfServiceReview(facility) !== null
    && (facility?.permissions.includes(SETUP_PERMISSION) ?? false)
    && listsStaff(session)
}
