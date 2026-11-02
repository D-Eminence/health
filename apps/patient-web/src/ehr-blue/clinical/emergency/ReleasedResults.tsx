import { isHidApiError } from '@hid/http'
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Flag, LoadingRows, Value, type FlagLevel } from '../../../kasuwa/parts'
import { Alert, Badge, Button } from '../../../kasuwa/ui'
import { staffApi, type LabAbnormalFlag, type LabOrderReleasedResults, type LabResultRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { revisionValue, skipsVersions } from '../../../staff/labRevisions'
import { formatWhen } from '../parts/format'

/** A code from Lab as EHR reports it (Clinical.tsx labCode), or nothing. */
function labCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined
}

/** Today's words for a refused released-results read (Clinical.tsx releasedResultsRefusal). */
export function releasedResultsRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return refusalText(caught, 'Please try again.')
  if (caught.status === 404) return caught.code === 'LAB_WORK_ITEM_NOT_FOUND'
    ? 'The lab hasn’t taken this test here yet, or your access doesn’t cover it.'
    : 'This lab doesn’t share results yet.'
  if (caught.status === 403) return `You can’t see this test’s results here${labCode(caught.code) ? ` (${caught.code})` : ''}.`
  return refusalText(caught, 'Please try again.')
}

function when(value: string | null | undefined) {
  return formatWhen(value) || 'Not available'
}

const FLAGS: Partial<Record<LabAbnormalFlag, FlagLevel>> = { high: 'high', low: 'low', abnormal: 'abnormal', critical_candidate: 'critical' }
const RELEASE: Record<LabResultRevision['releaseStatus'], string> = { released: 'Released', verified_not_released: 'Checked, not released', not_released: 'Not released' }

/** A Lab result's released revisions: the value with its unit and flag, then when it was entered and released. */
function Revisions({ revisions }: { revisions: readonly LabResultRevision[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {revisions.map(revision => (
        <li key={revision.version} className="flex flex-col gap-1 rounded-lg bg-subtle px-3 py-2.5 text-[13px] text-ink-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">Version {revision.version}</span>
            <Badge size="sm" tone={revision.releaseStatus === 'released' ? 'success' : 'warn'}>{RELEASE[revision.releaseStatus] ?? revision.releaseStatus}</Badge>
            {revision.verificationStatus === 'entered_in_error' ? <Badge size="sm" tone="danger" solid>Entered in error</Badge> : null}
          </div>
          {revision.resultType === 'numeric'
            ? <Value value={revision.numericValue} unit={revision.unit} flag={FLAGS[revision.abnormalFlag] ?? null} />
            : <span className="inline-flex flex-wrap items-baseline gap-1.5"><span className="font-semibold text-ink">{revisionValue(revision)}</span>{FLAGS[revision.abnormalFlag] ? <Flag level={FLAGS[revision.abnormalFlag]!} /> : null}</span>}
          {revision.referenceRange ? <span>Normal range: {revision.referenceRange}</span> : null}
          <span>Entered {when(revision.enteredAt)}{revision.releasedAt ? ` · released ${when(revision.releasedAt)}` : ''}</span>
          {revision.correctionReason ? <span>Why it changed: {revision.correctionReason}</span> : null}
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
        <Button size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide results' : 'Show results'}</Button>
        {/* Busy, it stays focusable (aria-disabled, not disabled), so focus stays on it; a press while it reads does nothing
            (Clinical.tsx:930-931). */}
        {open ? <Button size="sm" variant="ghost" icon={RotateCcw} aria-disabled={loading || undefined}
          onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh</Button> : null}
      </div>
      {open ? (
        <>
          <div role="status" className="empty:hidden">{loading ? <LoadingRows rows={1} label="Loading results" /> : null}</div>
          {error ? <Alert intent="error" size="sm" title="Couldn’t load results">{error}</Alert> : null}
          {released ? released.results.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No results released yet.</p> : (
            <>
              <p className="m-0 text-[13px] text-ink-3">{released.test.name} · accepted by the lab {when(released.acceptedAt)}</p>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {released.results.map((result, index) => (
                  <li key={result.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">Result {index + 1}</span>
                      {result.status === 'entered_in_error' ? <Badge size="sm" tone="danger" solid>Entered in error</Badge> : null}
                    </div>
                    {result.status === 'entered_in_error' ? <p className="m-0 text-[13px] font-medium text-danger-ink">The latest version was marked entered in error. Don’t use it.</p> : null}
                    {skipsVersions(result.revisions) ? <p className="m-0 text-[12px] text-ink-3">Versions that were never released are not shown.</p> : null}
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
