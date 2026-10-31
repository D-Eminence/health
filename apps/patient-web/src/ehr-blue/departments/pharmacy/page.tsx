import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
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
  // Opened by its address without the permission: today's own words (staff/routes/Operations.tsx Pharmacy), and nothing is read.
  refusal: <DeptUnavailable title="Pharmacy unavailable" message="This facility membership needs pharmacy work-item read permission." />,
}
