import { EhrBadge, EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { staffApi, type LabOrderReleasedResults, type LabResultRevision } from '../../../../staff/api'
import { revisionValue, skipsVersions } from '../../../../staff/labRevisions'
import { labPaperLines, type LabPaperLine } from '../../parts/clinicalPrint'
import { codeText, MoreDetails } from '../../parts/MoreDetails'
import { ErrorBox } from '../../parts/Notices'
import { releasedResultsRefusal } from './words'
import { Flag, type FlagLevel } from '../../../../kasuwa/parts'
import { formatWhen } from '../../parts/format'

function dateText(value: string | null | undefined) {
  return formatWhen(value) || 'Not available'
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
          <p>{revisionValue(revision)}<FlagAfter flag={revision.abnormalFlag} /></p>
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
export function ReleasedResults({ facilityId, requestId, revision, onRefresh, onPrint }: {
  facilityId: string
  requestId: string
  revision: number
  onRefresh: () => void
  /** Prints the released results shown (their latest released versions, none entered in error). */
  onPrint?: (test: string, lines: readonly LabPaperLine[]) => void
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

  const printable = released ? labPaperLines(released.results) : []
  // The test by its name, or by its code when it was released with no name; the printed result names it the same way.
  const named = released?.test.name?.trim() ?? ''
  const code = released ? codeText(released.test.codeSystem, released.test.code) : ''
  const testName = named || code
  return (
    <EhrCard title="Released results">
      <p>
        <EhrButton variant="quiet" size="sm" busy={loading} onClick={() => { if (!loading) onRefresh() }}>Refresh released results</EhrButton>
        {onPrint && released && printable.length > 0 && !loading ? (
          <EhrButton variant="secondary" size="sm" onClick={() => onPrint(testName, printable)}>Print result</EhrButton>
        ) : null}
      </p>
      <div role="status">{loading ? <p>Loading released results…</p> : null}</div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {released ? released.results.length === 0 ? <p>No result released yet.</p> : (
        <>
          {/* The test by name; a test released with no name shows its code (it is all there is). */}
          <p>{testName} · accepted by Lab {dateText(released.acceptedAt)}</p>
          {/* The test's code under More details, not inline (owner decision 33.4). */}
          {named && code ? <MoreDetails about={named}><span>Code: {code}</span></MoreDetails> : null}
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

/*
 * Dates are in the app's own format ("11 Nov 2026, 02:31": formatWhen), never the browser's ("11/11/2026, 2:31:20 AM").
 * A flag worth calling out is drawn as the emergency view draws it: its word, an icon and its tone, never colour alone.
 */
const FLAGS: Partial<Record<LabResultRevision['abnormalFlag'], FlagLevel>> = { high: 'high', low: 'low', abnormal: 'abnormal' }

/**
 * After the value: the flag called out, "Normal" in words, and nothing for a flag the lab did not set. Lab's
 * critical_candidate is not confirmed, so it has the critical icon and tone but Lab's own words, "Possibly critical"
 * (labText FLAG_WORDS), as the printed result from this card says it.
 */
function FlagAfter({ flag }: { flag: LabResultRevision['abnormalFlag'] }) {
  if (flag === 'critical_candidate') return <> <Flag level="critical" text="Possibly critical" /></>
  const level = FLAGS[flag]
  if (level) return <> <Flag level={level} /></>
  return flag === 'normal' ? <> · Normal</> : null
}
