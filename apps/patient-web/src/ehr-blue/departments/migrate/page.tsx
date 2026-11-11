import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
import { ChartIcon, UploadIcon } from '../parts/icons'
import { readingQualityServed } from '../../../readingLearningServed'
import { Migrate, NO_DOCUMENT_OCR } from './Migrate'
import { qualityReader } from './readingQualityApi'
import { ReadingQualityPage, ReadingQualityRefusal } from './ReadingQualityPage'

export const migratePage: EhrBluePage = {
  path: 'ocr',
  group: 'Network & Services',
  label: 'Document OCR',
  permission: 'ocr.job.read',
  // Partial, not live: it works on Health ID, but not yet with today's words and steps throughout.
  status: 'partial',
  icon: <UploadIcon />,
  element: <Migrate />,
  // Opened by its address without the permission: the page's own refusal, in the same words as on the page, and nothing is read.
  refusal: <DeptUnavailable title="Document OCR unavailable" message={NO_DOCUMENT_OCR} />,
}

/**
 * Reading quality (Migrate learning), its own page, so a facility's manager without Document OCR reaches it too. No
 * permission of its own: hid-system #236 decides by workforce.manage at the X-Facility-ID facility (not while it awaits
 * support's review) or the platform permissions, which `visible` mirrors (readingQualityApi.ts qualityReader). Below
 * Migrate's address, so the Migrate site lists and opens it too. Once its read answers 404 (not served yet), the sidebar
 * stops listing it for the page's life, as Migrate stops offering its button; its address still opens and says so.
 */
export const readingQualityPage: EhrBluePage = {
  path: 'ocr/quality',
  group: 'Network & Services',
  label: 'Reading quality',
  status: 'partial',
  icon: <ChartIcon />,
  element: <ReadingQualityPage />,
  visible: session => qualityReader(session.actor, session.actor.facility?.id) !== null,
  listed: () => readingQualityServed() !== false,
  refusal: <ReadingQualityRefusal />,
}
