import type { EhrBluePage } from '../types'
import { BadgeIcon } from '../parts/icons'
import { HrCredentials } from './HrCredentials'

export const hrPage: EhrBluePage = {
  // '/*': the frame's record links (/provider/hr/<id>) open the list, which puts the address back at /provider/hr.
  path: 'hr/*',
  group: 'People',
  label: 'HR & Credentials',
  permission: 'workforce.manage',
  status: 'partial',
  icon: <BadgeIcon />,
  element: <HrCredentials />,
}
