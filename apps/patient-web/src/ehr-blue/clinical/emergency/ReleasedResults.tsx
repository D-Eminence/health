import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LoadingRows } from '../../../kasuwa/parts'
import { Alert, Badge, Button } from '../../../kasuwa/ui'
import { staffApi, type LabOrderReleasedResults, type LabResultRevision } from '../../../staff/api'
import { revisionValue, skipsVersions } from '../../../staff/labRevisions'
// Today's words for a refused released-results read (Clinical.tsx:893-901), as Consultation's released results say them.
import { releasedResultsRefusal } from '../consult/orders/words'
import { formatWhen } from '../parts/format'

function when(value: string | null | undefined) {
  return formatWhen(value) || 'Not available'
}

/**
 * A Lab result's released revisions in today's words (staff/labRevisions.tsx:30-40): the value with its unit, then its
 * flag as Lab says it, every flag ("normal", "unknown" and "critical candidate" too); when it was entered and its
 * verification, when it was released, the reference range and the reason for a correction.
 */
function Revisions({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {revisions.map(revision => (
        <li key={revision.version} className="flex flex-col gap-1 rounded-lg bg-subtle px-3 py-2.5 text-[13px] text-ink-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">Version {revision.version}</span>
            <Badge size="sm" tone={revision.releaseStatus === 'released' ? 'success' : 'warn'}>{revision.releaseStatus.replaceAll('_', ' ')}</Badge>
            {revision.verificationStatus === 'entered_in_error' ? <Badge size="sm" tone="danger" solid>Entered in error</Badge> : null}
          </div>
          {/* "{value} · {flag}" (labRevisions.tsx:34). */}
          <span><span className="font-semibold text-ink">{revisionValue(revision)}</span> · {revision.abnormalFlag.replaceAll('_', ' ')}</span>
          {/* Whether the value was verified (labRevisions.tsx:35). */}
          <span>Entered {when(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</span>
          {revision.releasedAt ? <span>Released {when(revision.releasedAt)}</span> : null}
          {revision.referenceRange ? <span>Reference range: {revision.referenceRange}</span> : null}
          {revision.correctionReason ? <span>Reason: {revision.correctionReason}</span> : null}
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
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide released results' : 'View released results'}</Button>
        {/* Busy, it stays focusable (aria-disabled, not disabled), so focus stays on it; a press while it reads does nothing
            (Clinical.tsx:930-931). */}
        {open ? <Button size="sm" variant="ghost" icon={RotateCcw} aria-disabled={loading || undefined}
          onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh released results</Button> : null}
      </div>
      {open ? (
        <>
          <div role="status" className="empty:hidden">{loading ? <LoadingRows rows={1} label="Loading released results" /> : null}</div>
          {error ? <Alert intent="error" size="sm" title="Couldn’t load results">{error}</Alert> : null}
          {released ? released.results.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No result released yet.</p> : (
            <>
              {/* The test with its code system and code (Clinical.tsx:935). */}
              <p className="m-0 text-[13px] text-ink-3">{released.test.name} · {released.test.codeSystem} {released.test.code} · accepted by Lab {when(released.acceptedAt)}</p>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {released.results.map((result, index) => (
                  <li key={result.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">Result {index + 1}</span>
                      {/* Each result says whether it is released or entered in error (Clinical.tsx:938). */}
                      {result.status === 'entered_in_error' ? <Badge size="sm" tone="danger" solid>Entered in error</Badge>
                        : <Badge size="sm" tone="success">Released</Badge>}
                    </div>
                    {result.status === 'entered_in_error' ? <p className="m-0 text-[13px] font-medium text-danger-ink">The latest released version was marked entered in error: do not use it.</p> : null}
                    {skipsVersions(result.revisions) ? <p className="m-0 text-[12px] text-ink-3">Version numbers skip revisions that were never released; those are not shown.</p> : null}
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
