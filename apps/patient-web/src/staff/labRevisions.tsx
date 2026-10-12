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
 * says so.
 */
export function RevisionList({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return <div className="staff-list">{revisions.map(revision => <div className="staff-list-item" key={revision.version}>
    <div className="staff-row"><strong>Version {revision.version}</strong><Badge tone={revision.releaseStatus === 'released' ? 'success' : 'warning'}>{revision.releaseStatus.replaceAll('_', ' ')}</Badge>
      {revision.verificationStatus === 'entered_in_error' && <Badge tone="danger">Entered in error</Badge>}</div>
    <p>{revisionValue(revision)} · {revision.abnormalFlag.replaceAll('_', ' ')}</p>
    <p>Entered {dateText(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</p>
    {revision.releasedAt && <p>Released {dateText(revision.releasedAt)}</p>}
    {revision.referenceRange && <p>Reference range: {revision.referenceRange}</p>}
    {revision.correctionReason && <p>Reason: {revision.correctionReason}</p>}
  </div>)}</div>
}
