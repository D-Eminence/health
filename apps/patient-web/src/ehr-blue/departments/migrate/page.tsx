import type { EhrBluePage } from '../types'
import { UploadIcon } from '../parts/icons'
import { Migrate } from './Migrate'

export const migratePage: EhrBluePage = {
  path: 'migrate',
  group: 'Operations',
  label: 'Migrate',
  permission: 'ehr.document.read',
  status: 'live',
  icon: <UploadIcon />,
  element: <Migrate />,
}
