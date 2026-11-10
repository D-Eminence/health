import { EhrBadge, EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { staffApi, type LabOrderReleasedResults, type LabResultRevision } from '../../../../staff/api'
import { revisionValue, skipsVersions } from '../../../../staff/labRevisions'
import { FLAG_WORDS } from '../../../departments/laboratory/labText'
import { ErrorBox } from '../../parts/Notices'
import { releasedResultsRefusal } from './words'

function dateText(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available'
}

/**
 * A result's released versions, newest first: "Latest released result", then each earlier one it replaced, with why it
 * was changed. Only released versions reach a clinician (lab-executions.service.ts releasedView), so no status is shown,
 * and the newest is never called current: a correction waiting to be checked in the lab is not sent here.
 * Each flag in the lab's plain words (labText.ts); "not set" says nothing, so it is left out.
 */
function Revisions({ revisions }: { revisions: readonly LabResultRevision[] }) {
  const newestFirst = [...revisions].sort((a, b) => b.version - a.version)
  return (
    <ul className="hid-ehr-clinical-orders-revisions">
      {newestFirst.map((revision, index) => (
        <li key={revision.version} className="hid-ehr-clinical-orders-revision">
          <div className="hid-ehr-clinical-orders-row">
            <strong>{index === 0 ? 'Latest released result' : 'Earlier released result'}</strong>
            {revision.verificationStatus === 'entered_in_error' ? <EhrBadge tone="critical">Entered in error</EhrBadge>
              : index > 0 ? <EhrBadge tone="caution">Replaced</EhrBadge> : null}
          </div>
          <p>{revisionValue(revision)}{revision.abnormalFlag !== 'unknown' && FLAG_WORDS[revision.abnormalFlag] ? ` · ${FLAG_WORDS[revision.abnormalFlag]}` : ''}</p>
          {revision.referenceRange ? <p>Normal range: {revision.referenceRange}</p> : null}
          {revision.releasedAt ? <p>Released {dateText(revision.releasedAt)}</p> : null}
          {revision.correctionReason ? <p>Why it was changed: {revision.correctionReason}</p> : null}
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
              {result.status === 'entered_in_error' ? <p>Don’t use this result: the lab marked it as entered in error.</p> : null}
              {skipsVersions(result.revisions) ? <p className="hid-ehr-clinical-orders-muted">Some versions were never released, so they aren’t shown.</p> : null}
              <Revisions revisions={result.revisions} />
            </div>
          ))}
        </>
      ) : null}
    </EhrCard>
  )
}
