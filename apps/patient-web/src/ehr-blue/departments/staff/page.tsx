import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { visibleNavigation } from '../../../staff/navigation'
import { UsersIcon } from '../parts/icons'
import { StaffAccess, StaffRefusal } from './StaffAccess'

/**
 * Where today's sidebar lists Staff: a facility that signed itself up, on Novu, for its administrator. Health ID support
 * manages a governed facility's staff. Staff & access and HR & Credentials both show only here.
 */
export function listsStaff(session: StaffSession): boolean {
  return visibleNavigation(session.actor.facility).some(item => item.to === '/provider/staff')
}

export const staffAccessPage: EhrBluePage = {
  path: 'staff',
  group: 'People',
  label: 'Staff & access',
  permission: 'workforce.manage',
  // Partial, not live: it works on Health ID, but not yet with today's words and steps throughout.
  status: 'partial',
  icon: <UsersIcon />,
  element: <StaffAccess />,
  // Listed where today's sidebar lists Staff: a facility that signed itself up, on Novu. Health ID support manages a
  // governed facility's staff, so there the page is left out of the sidebar, search and Home, and its address says so.
  visible: listsStaff,
  refusal: <StaffRefusal />,
}
