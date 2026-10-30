import type { EhrBluePage } from '../types'
import { visibleNavigation } from '../../../staff/navigation'
import { UsersIcon } from '../parts/icons'
import { StaffAccess, StaffRefusal } from './StaffAccess'

export const staffAccessPage: EhrBluePage = {
  path: 'staff',
  group: 'People',
  label: 'Staff & access',
  permission: 'workforce.manage',
  status: 'live',
  icon: <UsersIcon />,
  element: <StaffAccess />,
  // Listed where today's sidebar lists Staff: a facility that signed itself up, on Novu. Health ID support manages a
  // governed facility's staff, so there the page is left out of the sidebar, search and Home, and its address says so.
  visible: session => visibleNavigation(session.actor.facility).some(item => item.to === '/provider/staff'),
  refusal: <StaffRefusal />,
}
