import type { EhrBluePage } from '../types'
import { UploadIcon } from '../parts/icons'
import { Migrate } from './Migrate'

export const migratePage: EhrBluePage = {
  path: 'ocr',
  group: 'Network & Services',
  label: 'Document OCR',
  permission: 'ocr.job.read',
  status: 'live',
  icon: <UploadIcon />,
  element: <Migrate />,
}
