import { UserPlus } from 'lucide-react'
import type { EhrBluePage } from '../types'
import { FlaskIcon } from '../parts/icons'
import { Laboratory } from './Laboratory'
import { NewWalkIn } from './NewWalkIn'

export const laboratoryPage: EhrBluePage = {
  path: 'laboratory',
  group: 'Diagnostics',
  label: 'Laboratory',
  // Its name beside New walk-in, as a tab in a hospital and in a lab's own menu.
  tabLabel: 'Work list',
  permission: 'lab.work-item.read',
  status: 'live',
  icon: <FlaskIcon />,
  element: <Laboratory />,
}

/**
 * A walk-in lab request (docs/POINT_OF_CARE_SPEC.md §4), built against a proposed route: it says so when it answers 404,
 * and saves nothing. A tab of Laboratory in a hospital; listed in a lab's own menu.
 */
export const labWalkInPage: EhrBluePage = {
  path: 'laboratory/new-walk-in',
  group: 'Diagnostics',
  label: 'New walk-in',
  tabOf: 'laboratory',
  permission: 'lab.walk-in.create',
  status: 'live',
  icon: <UserPlus aria-hidden strokeWidth={1.8} />,
  element: <NewWalkIn />,
}
