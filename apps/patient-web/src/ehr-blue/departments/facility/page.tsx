import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { BuildingIcon } from '../parts/icons'
import { FacilityProfile } from './FacilityProfile'

/**
 * Facility profile is the facility's own administration (presence policy, licence, registration numbers): listed only
 * for those who manage the facility's staff, or who hold its administrator role. A doctor, nurse, lab or pharmacy role
 * no longer sees it in the menu or search (QA P1-5); its address still opens, read-only, as before.
 */
export function facilityProfileListed(session: StaffSession): boolean {
  const facility = session.actor.facility
  if (!facility) return false
  return facility.permissions.includes('workforce.manage') || facility.roles.some(role => role.startsWith('org_admin'))
}

export const facilityPage: EhrBluePage = {
  path: 'facility',
  group: 'Settings',
  label: 'Facility profile',
  status: 'live',
  icon: <BuildingIcon />,
  element: <FacilityProfile />,
  listed: facilityProfileListed,
}
