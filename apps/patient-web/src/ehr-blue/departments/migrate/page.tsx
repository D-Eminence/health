import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
import { UploadIcon } from '../parts/icons'
import { Migrate, NO_DOCUMENT_OCR } from './Migrate'

export const migratePage: EhrBluePage = {
  path: 'ocr',
  group: 'Network & Services',
  label: 'Paper records',
  permission: 'ocr.job.read',
  // Partial, not live: a start page only, until bringing in paper records from the patient's page arrives.
  status: 'partial',
  icon: <UploadIcon />,
  element: <Migrate />,
  // Opened by its address without the permission: the page's own refusal, in the same words as on the page, and nothing is read.
  refusal: <DeptUnavailable title="Paper records unavailable" message={NO_DOCUMENT_OCR} />,
}
