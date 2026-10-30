import type { EhrBluePage } from '../types'
import { OutreachIcon } from '../parts/icons'
import { Outreach } from './Outreach'

export const outreachPage: EhrBluePage = {
  path: 'outreach',
  group: 'Network & Services',
  label: 'Outreach',
  permission: 'outreach.registration.read',
  status: 'live',
  icon: <OutreachIcon />,
  element: <Outreach />,
}
