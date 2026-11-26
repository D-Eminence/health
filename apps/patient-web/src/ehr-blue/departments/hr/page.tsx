import type { EhrBluePage } from '../types'
import { BadgeIcon } from '../parts/icons'
import { HrCredentialsPage } from './LicenceRenewals'
import { listsStaff } from '../staff/page'
import { StaffRefusal } from '../staff/StaffAccess'

/**
 * HR & Credentials: today's staff and licence list with the design's sample half (HrCredentials.tsx), or, where Health
 * ID serves licence renewals (hid-system ROS-1 routes 1-5, behind HR_CREDENTIALS_ENABLED), each licence's status, the
 * expiry banner, the CSV export and the renewals (LicenceRenewals.tsx). Partial either way: ROS-1 is not live yet.
 */
export const hrPage: EhrBluePage = {
  // '/*': the frame's record links (/provider/hr/<id>) open the list, which puts the address back at /provider/hr.
  path: 'hr/*',
  group: 'People',
  label: 'HR & Credentials',
  permission: 'workforce.manage',
  status: 'partial',
  icon: <BadgeIcon />,
  element: <HrCredentialsPage />,
  // Its live part is the facility's own staff, which Health ID support manages at a governed facility: shown only where
  // today's sidebar lists Staff, and its address says so elsewhere, reading no staff.
  visible: listsStaff,
  refusal: <StaffRefusal title="HR & Credentials" />,
}
