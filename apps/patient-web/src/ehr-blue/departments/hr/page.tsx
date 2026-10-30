import type { EhrBluePage } from '../types'
import { BadgeIcon } from '../parts/icons'
import { HrCredentials } from './HrCredentials'
import { listsStaff } from '../staff/page'
import { StaffRefusal } from '../staff/StaffAccess'

export const hrPage: EhrBluePage = {
  // '/*': the frame's record links (/provider/hr/<id>) open the list, which puts the address back at /provider/hr.
  path: 'hr/*',
  group: 'People',
  label: 'HR & Credentials',
  permission: 'workforce.manage',
  status: 'partial',
  icon: <BadgeIcon />,
  element: <HrCredentials />,
  // Its live part is the facility's own staff, which Health ID support manages at a governed facility: shown only where
  // today's sidebar lists Staff, and its address says so elsewhere, reading no staff.
  visible: listsStaff,
  refusal: <StaffRefusal title="HR & Credentials" />,
}
