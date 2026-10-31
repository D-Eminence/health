import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
import { FlaskIcon } from '../parts/icons'
import { Laboratory } from './Laboratory'

export const laboratoryPage: EhrBluePage = {
  path: 'laboratory',
  group: 'Diagnostics',
  label: 'Laboratory',
  permission: 'lab.work-item.read',
  status: 'live',
  icon: <FlaskIcon />,
  element: <Laboratory />,
  // Opened by its address without the permission: today's own words (staff/routes/Operations.tsx Laboratory), and nothing is read.
  refusal: <DeptUnavailable title="Laboratory unavailable" message="This facility membership needs lab work-item read permission." />,
}
