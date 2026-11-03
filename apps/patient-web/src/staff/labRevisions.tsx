import { Badge } from '@hid/ui'
import type { LabResultRevision } from './api'

function dateText(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available'
}

/** A revision's value as entered: a number with its unit, or text. */
export function revisionValue(revision: LabResultRevision) {
  return revision.resultType === 'numeric'
    ? revision.numericValue == null ? 'Not recorded' : `${revision.numericValue} ${revision.unit ?? ''}`
    : revision.textValue ?? 'Not recorded'
}

/**
 * A revision checked by the scientist who entered it, at a one-person lab (owner decision 33.3, hid-system 0111): Lab
 * marks it checkedBySamePerson, on Lab staff reads and on released-only reads, so the ordering clinician sees it too.
 */
export const SAME_SCIENTIST = 'Checked by the same scientist who entered it'

/** The self-check's mark and, where the reader is sent it (Lab staff reads only), its typed reason; null otherwise. */
export function sameScientistCheck(revision: LabResultRevision): { readonly text: string; readonly reason: string | null } | null {
  if (revision.checkedBySamePerson !== true) return null
  const reason = typeof revision.selfCheckReason === 'string' && revision.selfCheckReason.trim() ? revision.selfCheckReason.trim() : null
  return { text: SAME_SCIENTIST, reason }
}

/**
 * Whether the versions shown skip a number. A released view keeps each
 * revision's stored version (hid-system lab-executions.service.ts releasedView),
 * so a gap is a revision that was never released, whose value is not returned.
 */
export function skipsVersions(revisions: readonly LabResultRevision[]) {
  return revisions.some((revision, index) => revision.version !== (index === 0 ? 1 : revisions[index - 1]!.version + 1))
}

/**
 * A Lab result's revisions in version order: value and flag, entry, release
 * (`releasedAt`, sent since hid-system #51 and null until released), reference
 * range and the reason for a correction. A revision marked entered in error
 * says so, and one checked by the scientist who entered it says that (with their reason where it is sent).
 */
export function RevisionList({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return <div className="staff-list">{revisions.map(revision => { const same = sameScientistCheck(revision); return <div className="staff-list-item" key={revision.version}>
    <div className="staff-row"><strong>Version {revision.version}</strong><Badge tone={revision.releaseStatus === 'released' ? 'success' : 'warning'}>{revision.releaseStatus.replaceAll('_', ' ')}</Badge>
      {revision.verificationStatus === 'entered_in_error' && <Badge tone="danger">Entered in error</Badge>}</div>
    <p>{revisionValue(revision)} · {revision.abnormalFlag.replaceAll('_', ' ')}</p>
    <p>Entered {dateText(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</p>
    {revision.releasedAt && <p>Released {dateText(revision.releasedAt)}</p>}
    {revision.referenceRange && <p>Reference range: {revision.referenceRange}</p>}
    {revision.correctionReason && <p>Reason: {revision.correctionReason}</p>}
    {same && <p>{same.text}{same.reason ? `. Their reason: ${same.reason}` : ''}</p>}
  </div> })}</div>
}
