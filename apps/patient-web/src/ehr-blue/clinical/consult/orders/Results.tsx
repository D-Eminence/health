import { EhrBadge, EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { staffApi, type LabOrderReleasedResults, type LabResultRevision } from '../../../../staff/api'
import { revisionValue, skipsVersions } from '../../../../staff/labRevisions'
import { ErrorBox } from '../../parts/Notices'
import { releasedResultsRefusal } from './words'

function dateText(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available'
}

/** Today's RevisionList (staff/labRevisions.tsx) in the design's list style, with its words. */
function Revisions({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return (
    <ul className="hid-ehr-clinical-orders-revisions">
      {revisions.map(revision => (
        <li key={revision.version} className="hid-ehr-clinical-orders-revision">
          <div className="hid-ehr-clinical-orders-row">
            <strong>Version {revision.version}</strong>
            <EhrBadge tone={revision.releaseStatus === 'released' ? 'positive' : 'caution'}>{revision.releaseStatus.replaceAll('_', ' ')}</EhrBadge>
            {revision.verificationStatus === 'entered_in_error' ? <EhrBadge tone="critical">Entered in error</EhrBadge> : null}
          </div>
          <p>{revisionValue(revision)} · {revision.abnormalFlag.replaceAll('_', ' ')}</p>
          <p>Entered {dateText(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</p>
          {revision.releasedAt ? <p>Released {dateText(revision.releasedAt)}</p> : null}
          {revision.referenceRange ? <p>Reference range: {revision.referenceRange}</p> : null}
          {revision.correctionReason ? <p>Reason: {revision.correctionReason}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Today's ReleasedResults (Clinical.tsx) as a card under the lab request: read only when opened or refreshed, since
 * Lab audits every read; what was shown is hidden while it is read again.
 */
export function ReleasedResults({ facilityId, requestId, revision, onRefresh }: {
  facilityId: string
  requestId: string
  revision: number
  onRefresh: () => void
}) {
  const [released, setReleased] = useState<LabOrderReleasedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setReleased(null)
    setLoading(true)
    setError('')
    void staffApi.labReleasedResultsForOrder(facilityId, requestId, 'direct-care')
      .then(value => { if (active) setReleased(value) })
      .catch(caught => { if (active) setError(releasedResultsRefusal(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, facilityId, requestId])

  return (
    <EhrCard title="Released results">
      <p>
        <EhrButton variant="quiet" size="sm" busy={loading} onClick={() => { if (!loading) onRefresh() }}>Refresh released results</EhrButton>
      </p>
      <div role="status">{loading ? <p>Loading released results…</p> : null}</div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {released ? released.results.length === 0 ? <p>No result released yet.</p> : (
        <>
          <p>{released.test.name} · {released.test.codeSystem} {released.test.code} · accepted by Lab {new Date(released.acceptedAt).toLocaleString()}</p>
          {released.results.map((result, index) => (
            <div key={result.id} className="hid-ehr-clinical-orders-result">
              <div className="hid-ehr-clinical-orders-row">
                <strong>Result {index + 1}</strong>
                <EhrBadge tone={result.status === 'entered_in_error' ? 'critical' : 'positive'}>{result.status === 'entered_in_error' ? 'Entered in error' : 'Released'}</EhrBadge>
              </div>
              {result.status === 'entered_in_error' ? <p>The latest released version was marked entered in error: do not use it.</p> : null}
              {skipsVersions(result.revisions) ? <p className="hid-ehr-clinical-orders-muted">Version numbers skip revisions that were never released; those are not shown.</p> : null}
              <Revisions revisions={result.revisions} />
            </div>
          ))}
        </>
      ) : null}
    </EhrCard>
  )
}
