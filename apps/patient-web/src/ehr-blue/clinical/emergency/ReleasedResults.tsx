import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { staffApi, type LabOrderReleasedResults, type LabResultRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { revisionValue, skipsVersions } from '../../../staff/labRevisions'
import { ErrorBox } from '../parts/Notices'
import { formatWhen } from '../parts/format'
import { StatusBadge } from '../parts/StatusBadge'

/** A code from Lab as EHR reports it (Clinical.tsx labCode), or nothing. */
function labCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined
}

/** Today's words for a refused released-results read (Clinical.tsx releasedResultsRefusal). */
export function releasedResultsRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return refusalText(caught, 'Released results could not be loaded.')
  if (caught.status === 404) return caught.code === 'LAB_WORK_ITEM_NOT_FOUND'
    ? 'Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.'
    : 'Released results are not available from this Lab service.'
  if (caught.status === 403) return `Access denied: you may not read this request's Lab results here${labCode(caught.code) ? ` (${caught.code})` : ''}.`
  return refusalText(caught, 'Released results could not be loaded.')
}

function when(value: string | null | undefined) {
  return formatWhen(value) || 'Not available'
}

/** A Lab result's released revisions, as today's RevisionList (labRevisions.tsx) words them. */
function Revisions({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return (
    <ul className="hid-ehr-clinical-emergency-entries">
      {revisions.map(revision => (
        <li key={revision.version} className="hid-ehr-clinical-emergency-entry">
          <div className="hid-ehr-clinical-emergency-entry-head">
            <strong>Version {revision.version}</strong>
            <StatusBadge status={revision.releaseStatus} />
            {revision.verificationStatus === 'entered_in_error' ? <EhrBadge tone="critical" className="hid-ehr-clinical-badge">Entered in error</EhrBadge> : null}
          </div>
          <p>{revisionValue(revision)} · {revision.abnormalFlag.replaceAll('_', ' ')}</p>
          <p>Entered {when(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</p>
          {revision.releasedAt ? <p>Released {when(revision.releasedAt)}</p> : null}
          {revision.referenceRange ? <p>Reference range: {revision.referenceRange}</p> : null}
          {revision.correctionReason ? <p>Reason: {revision.correctionReason}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * The released Lab results of one lab request, read under the emergency purpose. Lab audits every read, so it is read
 * only when opened or refreshed, never on its own (today's ReleasedResults, Clinical.tsx). Reading only: nothing here
 * changes a record.
 */
export function ReleasedResults({ facilityId, requestId }: { facilityId: string; requestId: string }) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [released, setReleased] = useState<LabOrderReleasedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    // What was shown is hidden while it is read again: a refused read leaves nothing of it.
    setReleased(null)
    setLoading(true)
    setError('')
    staffApi.labReleasedResultsForOrder(facilityId, requestId, 'emergency')
      .then(value => { if (active) setReleased(value) })
      .catch((caught: unknown) => { if (active) setError(releasedResultsRefusal(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, revision, facilityId, requestId])

  return (
    <div className="hid-ehr-clinical-emergency-results">
      <EhrButton variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? 'Hide released results' : 'View released results'}
      </EhrButton>
      {open ? (
        <>
          <EhrButton variant="quiet" size="sm" busy={loading} onClick={() => setRevision(value => value + 1)}>
            Refresh released results
          </EhrButton>
          <div role="status">{loading ? <p>Loading released results…</p> : null}</div>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {released ? released.results.length === 0 ? <p>No result released yet.</p> : (
            <>
              <p>{released.test.name} · {released.test.codeSystem} {released.test.code} · accepted by Lab {when(released.acceptedAt)}</p>
              <ul className="hid-ehr-clinical-emergency-entries">
                {released.results.map((result, index) => (
                  <li key={result.id} className="hid-ehr-clinical-emergency-entry">
                    <div className="hid-ehr-clinical-emergency-entry-head">
                      <strong>Result {index + 1}</strong>
                      {result.status === 'entered_in_error'
                        ? <EhrBadge tone="critical" className="hid-ehr-clinical-badge">Entered in error</EhrBadge>
                        : <StatusBadge status="Released" />}
                    </div>
                    {result.status === 'entered_in_error' ? <p>The latest released version was marked entered in error: do not use it.</p> : null}
                    {skipsVersions(result.revisions) ? <p className="hid-ehr-clinical-emergency-muted">Version numbers skip revisions that were never released; those are not shown.</p> : null}
                    <Revisions revisions={result.revisions} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
