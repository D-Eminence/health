import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
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
  // Opened by its address without the permission: today's own words (staff/routes/Operations.tsx Document OCR), and nothing is read.
  refusal: <DeptUnavailable title="Document OCR unavailable" message="This facility membership needs OCR job read permission." />,
}
