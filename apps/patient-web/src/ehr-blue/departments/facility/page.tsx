import type { EhrBluePage } from '../types'
import { BuildingIcon } from '../parts/icons'
import { FacilityProfile } from './FacilityProfile'

export const facilityPage: EhrBluePage = {
  path: 'facility',
  group: 'Settings',
  label: 'Facility profile',
  status: 'live',
  icon: <BuildingIcon />,
  element: <FacilityProfile />,
}
