import type { EhrBluePage } from '../types'
import { UsersIcon } from '../parts/icons'
import { StaffAccess } from './StaffAccess'

export const staffAccessPage: EhrBluePage = {
  path: 'staff',
  group: 'People',
  label: 'Staff & access',
  permission: 'workforce.manage',
  status: 'live',
  icon: <UsersIcon />,
  element: <StaffAccess />,
}
