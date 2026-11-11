import { useStaff } from '../../../staff/App'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { ReadingQualityView } from './ReadingQuality'
import { managesAwaitingReview, qualityReader } from './readingQualityApi'

/*
 * Reading quality as a page of its own (/provider/ocr/quality), for a facility's own manager who has no Document OCR
 * (Migrate's page needs ocr.job.read, and the frame refuses it without), and for a platform administrator. The same
 * rule as hid-system #236 (readingQualityApi.ts qualityReader): workforce.manage on the membership at the working
 * facility, the one the read sends as X-Facility-ID, not while that facility awaits Health ID support's review; or the
 * two platform permissions. The page entry (page.tsx) shows only to such an actor; this checks again, so a change of
 * facility never reads another facility's figures.
 */

export const READING_QUALITY_REFUSED = 'Reading quality isn’t open to you at this facility.'
export const READING_QUALITY_AWAITS_REVIEW = 'Reading quality opens here once Health ID support has reviewed this facility.'

function useReader() {
  const { state } = useStaff()
  const { facilityId } = useDeptAccess()
  const actor = state.status === 'ready' ? state.session.actor : undefined
  return { facilityId, reader: qualityReader(actor, facilityId), awaitsReview: managesAwaitingReview(actor, facilityId) }
}

/** The page's own refusal: nothing is read. A manager whose facility awaits review is told it opens after the review. */
export function ReadingQualityRefusal() {
  const { awaitsReview } = useReader()
  return <DeptUnavailable title="Reading quality" message={awaitsReview ? READING_QUALITY_AWAITS_REVIEW : READING_QUALITY_REFUSED} />
}

export function ReadingQualityPage() {
  const { facilityId, reader } = useReader()
  if (!reader || !facilityId) return <ReadingQualityRefusal />
  return <DeptPage title="Reading quality">
    {/* Keyed by facility: a switch reads the new facility afresh, never showing the last one's figures. */}
    <ReadingQualityView key={facilityId} facilityId={facilityId} finishedWeeksOnly={reader === 'facility_manager'} />
  </DeptPage>
}
