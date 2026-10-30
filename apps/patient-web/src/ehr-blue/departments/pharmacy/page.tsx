import type { EhrBluePage } from '../types'
import { PillIcon } from '../parts/icons'
import { Pharmacy } from './Pharmacy'

export const pharmacyPage: EhrBluePage = {
  path: 'pharmacy',
  group: 'Diagnostics',
  label: 'Pharmacy',
  permission: 'pharmacy.work-item.read',
  status: 'live',
  icon: <PillIcon />,
  element: <Pharmacy />,
}
