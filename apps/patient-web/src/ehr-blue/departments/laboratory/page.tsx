import type { EhrBluePage } from '../types'
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
}
