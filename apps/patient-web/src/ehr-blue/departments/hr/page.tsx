import type { EhrBluePage } from '../types'
import { BadgeIcon } from '../parts/icons'
import { HrCredentials } from './HrCredentials'

export const hrPage: EhrBluePage = {
  path: 'hr',
  group: 'People',
  label: 'HR & Credentials',
  permission: 'workforce.manage',
  status: 'partial',
  icon: <BadgeIcon />,
  element: <HrCredentials />,
}
