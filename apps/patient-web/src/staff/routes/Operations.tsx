import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@hid/ui'
import { staffApi, type LabAbnormalFlag, type LabAccession, type LabExecution, type LabResult, type LabResultValue, type LabImport, type LabSpecimen, type LabWorkItem, type OcrExtraction, type OcrJob, type OcrPublication, type OcrTargetDomain, type OcrValidation, type OcrValidationInput, type OutreachCampaign, type OutreachCase, type PharmacyImport, type PharmacyWorkItem } from '../api'
import { useStaff } from '../App'
import { describedBy } from '../../authSteps'
import { FieldInputError, problemProps, problemText, refusal, refusalText, type FieldProblem } from '../fieldProblem'
import { BUSY, focusIsLost, UNAVAILABLE, useFocusById } from '../focus'
import { useFieldProblems } from '../useFieldProblems'
import { RevisionList } from '../labRevisions'

/**
 * OCR's answer when EHR, Lab or Pharmacy refused OCR's own workload identity
 * (hid-system #60, ocr-api owning-service-auth.ts): a fault between services, not
 * a refusal of the user, which a publication stores as the retryable
 * OWNING_SERVICE_UNAVAILABLE. Its detail is technical, so it is said plainly.
 */
const SERVICE_AUTH_UNAVAILABLE: ReadonlySet<string> = new Set(['EHR_SERVICE_AUTH_UNAVAILABLE', 'LAB_SERVICE_AUTH_UNAVAILABLE', 'PHARMACY_SERVICE_AUTH_UNAVAILABLE'])

// A refusal's message, with each field a 400 VALIDATION_FAILED names.
function errorText(error: unknown, fallback: string) {
  if (isHidApiError(error) && SERVICE_AUTH_UNAVAILABLE.has(error.code)) return 'A connection between Health ID services failed; retry in about 15 seconds.'
  return refusalText(error, fallback)
}

// OCR takes document and patient IDs only as version 4 UUIDs (ocr-api DTOs, @IsUUID('4')).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function shortId(value: string) { return `••••${value.slice(-6)}` }

function dateText(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'Not available'
}

function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="staff-page-head"><p className="staff-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></div>
}

function useFacilityAccess() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  return { facilityId: facility?.id, membershipId: facility?.membershipId, permissions: facility?.permissions ?? [] }
}

function useFacilityList<T>(facilityId: string | undefined, enabled: boolean, loader: (id: string) => Promise<T[]>) {
  const [result, setResult] = useState<{ facilityId: string; items: T[] | null; loading: boolean; error: string }>({ facilityId: '', items: null, loading: false, error: '' })
  const epoch = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++epoch.current
    if (!facilityId || !enabled) return
    setResult(previous => ({ facilityId, items: previous.facilityId === facilityId ? previous.items : null, loading: true, error: '' }))
    try {
      const items = await loader(facilityId)
      if (epoch.current === request) setResult({ facilityId, items, loading: false, error: '' })
    } catch (error) {
      if (epoch.current === request) setResult(previous => ({ facilityId, items: previous.facilityId === facilityId ? previous.items : null, loading: false, error: errorText(error, 'Work could not be loaded.') }))
    }
  }, [facilityId, enabled, loader])
  useEffect(() => {
    if (enabled && facilityId) void refresh()
    return () => { epoch.current += 1 }
  }, [facilityId, enabled, refresh])
  return { items: result.facilityId === facilityId ? result.items : null, loading: result.facilityId !== facilityId || result.loading, error: result.facilityId === facilityId ? result.error : '', refresh }
}

// Lab and Pharmacy list at most this many work items, oldest accepted first, and
// offer no further page (lab-work-items.service.ts list, pharmacy.service.ts listWorkItems).
// Neither filters by status, so a completed or dispensed item stays in the list:
// once a facility has this many, a newer one cannot be reached from here.
const WORK_LIST_CAP = 200

function WorkListCap({ count, children }: { count: number; children?: ReactNode }) {
  if (count < WORK_LIST_CAP) return null
  return <><p className="staff-notice">This list can show only the {WORK_LIST_CAP} oldest accepted work items. Any item accepted after them is not shown and cannot be reached from this page: completing work or refreshing the list does not bring it into view. Contact your facility administrator about orders not listed here.</p>
    {children}</>
}

/** A list's refresh: focusable while its read runs (UNAVAILABLE), when a second press does nothing. */
function RefreshButton({ loading, onRefresh, children }: { loading: boolean; onRefresh: () => Promise<void>; children: ReactNode }) {
  return <Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (!loading) void onRefresh() }}>{children}</Button>
}

function ListState({ loading, error, empty, retry, hasItems }: { loading: boolean; error: string; empty: string; retry: () => void; hasItems: boolean }) {
  return <>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {loading && !hasItems && <p className="staff-muted" role="status">Loading…</p>}
    {!loading && !error && !hasItems && <EmptyState title={empty} description="Refresh to check for new work at this facility." action={<Button tone="secondary" onClick={retry}>Refresh</Button>} />}
  </>
}

function AccessionForm({ facilityId, item, onCreated }: { facilityId: string; item: LabWorkItem; onCreated: (accession: LabAccession) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy) return
    const form = new FormData(event.currentTarget)
    const specimenType = String(form.get('specimenType') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError(''); problems.clear()
    if (!specimenType || !reason) return problems.refuse(!specimenType ? 'lab-specimen-type' : 'lab-accession-reason', 'Enter a specimen type and clinical reason.')
    setBusy(true)
    try { onCreated(await staffApi.createLabAccession(facilityId, item.id, specimenType, reason)) }
    catch (caught) { setError(errorText(caught, 'Accession could not be created.')) }
    finally { setBusy(false) }
  }
  return <Card className="staff-card"><h2>Create specimen accession</h2><p>{item.testName ?? 'Accepted lab order'} · Patient {shortId(item.patientId)}</p><form className="staff-form" onSubmit={event => void submit(event)}>
    <Field label="Specimen type" htmlFor="lab-specimen-type" error={problems.error('lab-specimen-type')} required><Input id="lab-specimen-type" name="specimenType" maxLength={240} placeholder="Blood, urine, swab…" required {...problems.control('lab-specimen-type')} /></Field>
    <Field label="Reason" htmlFor="lab-accession-reason" error={problems.error('lab-accession-reason')} required><Textarea id="lab-accession-reason" name="reason" maxLength={500} required {...problems.control('lab-accession-reason')} /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Creating…' : 'Create accession'}</Button>
  </form></Card>
}

type SpecimenActionKind = 'collect' | 'receive' | 'reject'

const SPECIMEN_STEP_DONE: Record<SpecimenActionKind, string> = {
  collect: 'Specimen marked collected.', receive: 'Specimen marked received.', reject: 'Specimen rejected.',
}

function SpecimenAction({ facilityId, accessionId, specimen, permissions, onStarted, onChanged, onRefused }: { facilityId: string; accessionId: string; specimen: LabSpecimen; permissions: string[]; onStarted: () => void; onChanged: (message: string) => void; onRefused: (error: unknown) => void }) {
  const actions: SpecimenActionKind[] = specimen.status === 'required'
    ? ['collect', 'reject'] : specimen.status === 'collected' ? ['receive', 'reject'] : []
  const allowed = actions.filter(action => permissions.includes(`lab.specimen.${action}`))
  const [action, setAction] = useState<SpecimenActionKind>(allowed[0] ?? 'collect')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const detail = String(new FormData(event.currentTarget).get('detail') ?? '').trim()
    setError(''); problems.clear()
    if (action === 'reject' && !detail) return problems.refuse(`lab-detail-${specimen.id}`, 'Enter a rejection reason.')
    setBusy(true); onStarted()
    try { await staffApi.transitionSpecimen(facilityId, accessionId, specimen, action, detail); onChanged(SPECIMEN_STEP_DONE[action]) }
    catch (caught) { setError(errorText(caught, 'Specimen could not be updated. Refresh and try again.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong id={`lab-specimen-${specimen.id}-title`} tabIndex={-1}>{specimen.specimenType} · {specimen.specimenIdentifier}</strong><Badge tone={specimen.status === 'received' ? 'success' : specimen.status === 'rejected' ? 'danger' : 'warning'}>{specimen.status}</Badge></div>
    {allowed.length > 0 && <form className="staff-form" onSubmit={event => void submit(event)}>
      <Field label="Next step" htmlFor={`lab-action-${specimen.id}`}><Select id={`lab-action-${specimen.id}`} value={action} onChange={event => setAction(event.target.value as SpecimenActionKind)}>{allowed.map(value => <option key={value} value={value}>{value === 'collect' ? 'Mark collected' : value === 'receive' ? 'Mark received' : 'Reject specimen'}</option>)}</Select></Field>
      <Field label={action === 'reject' ? 'Rejection reason' : 'Notes or condition'} htmlFor={`lab-detail-${specimen.id}`} error={problems.error(`lab-detail-${specimen.id}`)} required={action === 'reject'}><Input id={`lab-detail-${specimen.id}`} name="detail" maxLength={action === 'collect' ? 1000 : 500} required={action === 'reject'} {...problems.control(`lab-detail-${specimen.id}`)} /></Field>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Record step'}</Button>
    </form>}
  </div>
}

const abnormalFlags: readonly LabAbnormalFlag[] = ['unknown', 'normal', 'high', 'low', 'abnormal', 'critical_candidate']

/** The result entered under `id` (an execution's), or a FieldInputError naming the field refused. */
function resultValue(form: FormData, resultType: 'numeric' | 'text', id: string): LabResultValue {
  const unit = String(form.get('unit') ?? '').trim()
  const referenceRange = String(form.get('referenceRange') ?? '').trim()
  const flag = String(form.get('abnormalFlag') ?? 'unknown')
  if (!abnormalFlags.includes(flag as LabAbnormalFlag)) throw new FieldInputError(`lab-flag-${id}`, 'Choose a valid result flag.')
  const shared = {
    ...(unit ? { unit } : {}), ...(referenceRange ? { referenceRange } : {}),
    abnormalFlag: flag as LabAbnormalFlag,
  }
  if (resultType === 'numeric') {
    const raw = String(form.get('numericValue') ?? '').trim()
    if (!raw || !Number.isFinite(Number(raw))) throw new FieldInputError(`lab-numeric-${id}`, 'Enter a valid numeric result.')
    return { resultType, numericValue: Number(raw), ...shared }
  }
  const textValue = String(form.get('textValue') ?? '').trim()
  if (!textValue) throw new FieldInputError(`lab-text-${id}`, 'Enter the text result.')
  return { resultType, textValue, ...shared }
}

function ResultEntry({ facilityId, execution, result, onStarted, onChanged, onRefused }: {
  facilityId: string; execution: LabExecution; result: LabResult | null; onStarted: () => void;
  onChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  const [resultType, setResultType] = useState<'numeric' | 'text'>(current?.resultType ?? 'numeric')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setError(''); problems.clear()
    let value: LabResultValue
    try { value = resultValue(form, resultType, execution.id) }
    catch (caught) {
      if (caught instanceof FieldInputError) problems.refuse(caught.field, caught.message)
      else setError(errorText(caught, 'Enter a valid result.'))
      return
    }
    const reason = String(form.get('reason') ?? '').trim()
    if (result && !reason) return problems.refuse(`lab-result-reason-${execution.id}`, 'Explain the correction or amendment.')
    setBusy(true); onStarted()
    try {
      const updated = result
        ? await staffApi.correctLabResult(facilityId, execution, result, value, reason,
          String(form.get('revisionKind')) === 'amendment' ? 'amendment' : 'correction')
        : await staffApi.enterLabResult(facilityId, execution, value)
      onChanged(updated, result ? 'A new unverified result revision was recorded.' : 'An unverified result was recorded.')
    } catch (caught) { setError(errorText(caught, 'Result could not be recorded. Refresh before retrying.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <details className="staff-list-item"><summary>{result ? 'Correct or amend result' : 'Enter manual result'}</summary>
    <p className="staff-muted">{result ? 'A correction creates a new unverified version. Released history remains.' : 'Entry is unverified until an independent reviewer verifies it.'}</p>
    <form className="staff-form" onSubmit={event => void submit(event)}>
      <Field label="Result type" htmlFor={`lab-result-type-${execution.id}`}><Select id={`lab-result-type-${execution.id}`} value={resultType} onChange={event => setResultType(event.target.value as 'numeric' | 'text')}><option value="numeric">Numeric</option><option value="text">Text</option></Select></Field>
      {resultType === 'numeric'
        ? <Field label="Numeric value" htmlFor={`lab-numeric-${execution.id}`} error={problems.error(`lab-numeric-${execution.id}`)} required><Input id={`lab-numeric-${execution.id}`} name="numericValue" type="number" step="any" defaultValue={current?.resultType === 'numeric' ? current.numericValue ?? '' : ''} required {...problems.control(`lab-numeric-${execution.id}`)} /></Field>
        : <Field label="Text value" htmlFor={`lab-text-${execution.id}`} error={problems.error(`lab-text-${execution.id}`)} required><Textarea id={`lab-text-${execution.id}`} name="textValue" maxLength={4000} defaultValue={current?.resultType === 'text' ? current.textValue ?? '' : ''} required {...problems.control(`lab-text-${execution.id}`)} /></Field>}
      <div className="staff-form-row">
        <Field label="Unit" htmlFor={`lab-unit-${execution.id}`}><Input id={`lab-unit-${execution.id}`} name="unit" maxLength={80} defaultValue={current?.unit ?? ''} /></Field>
        <Field label="Reference range" htmlFor={`lab-range-${execution.id}`}><Input id={`lab-range-${execution.id}`} name="referenceRange" maxLength={240} defaultValue={current?.referenceRange ?? ''} /></Field>
      </div>
      <Field label="Abnormal flag" htmlFor={`lab-flag-${execution.id}`} error={problems.error(`lab-flag-${execution.id}`)}><Select id={`lab-flag-${execution.id}`} name="abnormalFlag" defaultValue={current?.abnormalFlag ?? 'unknown'} {...problems.control(`lab-flag-${execution.id}`)}>{abnormalFlags.map(flag => <option key={flag} value={flag}>{flag.replaceAll('_', ' ')}</option>)}</Select></Field>
      {result && <><Field label="Revision type" htmlFor={`lab-revision-kind-${execution.id}`}><Select id={`lab-revision-kind-${execution.id}`} name="revisionKind"><option value="correction">Correction</option><option value="amendment">Amendment</option></Select></Field><Field label="Reason" htmlFor={`lab-result-reason-${execution.id}`} error={problems.error(`lab-result-reason-${execution.id}`)} required><Textarea id={`lab-result-reason-${execution.id}`} name="reason" maxLength={500} required {...problems.control(`lab-result-reason-${execution.id}`)} /></Field></>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Recording…' : result ? 'Record new revision' : 'Record unverified result'}</Button>
    </form>
  </details>
}

function ResultGovernance({ facilityId, result, action, onStarted, onChanged, onRefused }: {
  facilityId: string; result: LabResult; action: 'verify' | 'release'; onStarted: () => void;
  onChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const reasonId = `lab-${action}-reason-${result.id}`
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setError(''); problems.clear()
    if (!reason) return problems.refuse(reasonId, 'Enter a reason for this decision.')
    setBusy(true); onStarted()
    try {
      const value = action === 'verify'
        ? await staffApi.verifyLabResult(facilityId, result, reason)
        : await staffApi.releaseLabResult(facilityId, result, reason)
      onChanged(value, action === 'verify' ? 'This exact result version was verified.' : 'This exact verified result version was released.')
    } catch (caught) { setError(errorText(caught, 'Decision could not be recorded. Refresh before retrying.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <p className="staff-muted">{action === 'verify' ? 'Verify version ' + result.currentVersion + ' after independent review. The person who entered it cannot verify it.' : 'Release verified version ' + result.currentVersion + ' to authorized readers.'}</p>
    <Field label={`${action === 'verify' ? 'Verification' : 'Release'} reason`} htmlFor={reasonId} error={problems.error(reasonId)} required><Textarea id={reasonId} name="reason" maxLength={500} required {...problems.control(reasonId)} /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Recording…' : action === 'verify' ? 'Verify result version' : 'Release result version'}</Button>
  </form>
}

function ResultHistory({ facilityId, result, onRefused }: { facilityId: string; result: LabResult; onRefused: (error: unknown) => void }) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [history, setHistory] = useState<LabResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Released-result readers get 404 until a version is released; that is not a refusal.
  const unreleased = result.currentReleasedVersion == null
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError('')
    void staffApi.labResultHistory(facilityId, result.id)
      .then(value => { if (active) setHistory(value) })
      .catch(caught => {
        if (active) setError(errorText(caught, 'Result history could not be loaded.'))
        // Even after the history was closed, a refusal says something about read access.
        if (!(unreleased && isHidApiError(caught) && caught.status === 404)) onRefused(caught)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, result.id, result.currentVersion, unreleased, open, revision, onRefused])
  return <div className="staff-stack"><Button tone="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide result history' : 'View result history'}</Button>
    {open && <><Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh history</Button>
      {loading && <p role="status">Loading result history…</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {!loading && !error && history && <RevisionList revisions={history.revisions} />}
    </>}
  </div>
}

function ExecutionCard({ facilityId, execution, permissions, onStarted, onExecutionChanged, onResultChanged, onRefused }: {
  facilityId: string; execution: LabExecution; permissions: string[]; onStarted: () => void;
  onExecutionChanged: (value: LabExecution, message: string) => void;
  onResultChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = execution.result
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim()
    setBusy(true); setError(''); onStarted()
    try { onExecutionChanged(await staffApi.completeLabExecution(facilityId, execution, notes), 'Analytical execution was completed.') }
    catch (caught) { setError(errorText(caught, 'Execution could not be completed. Refresh before retrying.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  const canCorrect = Boolean(result && permissions.includes('lab.result.correct') &&
    (result.currentReleasedVersion !== result.currentVersion || permissions.includes('lab.result.revise-released')))
  return <div className="staff-list-item staff-stack">
    <div className="staff-row"><strong id={`lab-execution-${execution.id}-title`} tabIndex={-1}>{execution.test.name} · {execution.test.codeSystem} {execution.test.code}</strong><Badge tone={execution.status === 'completed' ? 'success' : 'information'}>{execution.status.replaceAll('_', ' ')}</Badge></div>
    <p>Started {dateText(execution.startedAt)}{execution.completedAt ? ` · Completed ${dateText(execution.completedAt)}` : ''} · Version {execution.version}</p>
    {execution.method && <p>Method: {execution.method}</p>}
    {execution.status === 'in_progress' && permissions.includes('lab.execution.complete') && <form className="staff-form" onSubmit={event => void complete(event)}><Field label="Completion notes" htmlFor={`lab-completion-${execution.id}`}><Textarea id={`lab-completion-${execution.id}`} name="notes" maxLength={1000} /></Field><Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Completing…' : 'Complete execution'}</Button></form>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {execution.status === 'completed' && !result && permissions.includes('lab.result.enter') && <ResultEntry facilityId={facilityId} execution={execution} result={null} onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />}
    {result && <><div className="staff-row"><strong>Manual result · version {result.currentVersion}</strong><Badge tone={result.status === 'released' ? 'success' : 'warning'}>{result.status.replaceAll('_', ' ')}</Badge></div>
      {current && <p>{current.resultType === 'numeric' ? current.numericValue == null ? 'Not recorded' : `${current.numericValue} ${current.unit ?? ''}` : current.textValue ?? 'Not recorded'} · {current.abnormalFlag.replaceAll('_', ' ')}</p>}
      {canCorrect && <ResultEntry key={`${result.id}-${result.currentVersion}`} facilityId={facilityId} execution={execution} result={result} onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />}
      {result.status === 'entered_unverified' && permissions.includes('lab.result.verify') && <ResultGovernance facilityId={facilityId} result={result} action="verify" onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />}
      {result.status === 'verified_not_released' && permissions.includes('lab.result.release') && <ResultGovernance facilityId={facilityId} result={result} action="release" onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />}
      {permissions.includes('lab.result.released.read') && <ResultHistory facilityId={facilityId} result={result} onRefused={onRefused} />}
    </>}
  </div>
}

type LabResultsHiddenReason = 'denied' | 'unverified' | 'signedOut'

// Whether an error leaves read access to these results in doubt. A refusal, or a
// record that is no longer visible, means access ended. No answer at all (outage,
// network failure, timeout, server error) means it could not be confirmed, and an
// ended session (401, after the client's own refresh failed) means the person must
// sign in again. A request answered on its merits (400, 409, 412, 422, 429) means none of these.
function labResultsReadDoubt(error: unknown): LabResultsHiddenReason | null {
  if (!isHidApiError(error)) return 'unverified'
  if (error.status === 403 || error.status === 404) return 'denied'
  if (error.status === 401) return 'signedOut'
  if (error.status === 0 || error.status === 408 || error.status >= 500) return 'unverified'
  return null
}

const LAB_RESULTS_HIDDEN: Record<LabResultsHiddenReason, string> = {
  denied: 'Access denied. You are not authorized to view lab results for this patient. Results stay hidden until access is granted again.',
  unverified: 'Lab results are hidden because access to them could not be verified right now. Refresh to check again.',
  signedOut: 'Lab results are hidden because your session has ended. Sign in again to view them.',
}

/** Sent to every specimen panel of the accession; `seq` makes each raise a new signal. */
interface LabResultsSignal { reason: LabResultsHiddenReason; seq: number }

function ExecutionPanel({ facilityId, specimen, permissions, generation, recheck, resultsHidden, onResultsHidden }: {
  facilityId: string; specimen: LabSpecimen; permissions: string[]; generation: RefObject<number>;
  recheck: LabResultsSignal | null; resultsHidden: LabResultsSignal | null; onResultsHidden: (reason: LabResultsHiddenReason) => void
}) {
  const canRead = permissions.includes('lab.execution.read')
  const canStart = permissions.includes('lab.execution.start')
  // Results are kept with the accession generation they were confirmed in and shown only while
  // it is current. A hide anywhere in the accession starts a new generation at once, so these
  // values leave in the same render as the hide, before this panel's own effects have run.
  // Reading the ref here is sound: each new generation comes with a new hide signal, which
  // re-renders every panel, and a value newer than the last commit can only hide more.
  const [results, setResults] = useState<{ items: LabExecution[]; generation: number } | null>(null)
  const items = results && results.generation === generation.current ? results.items : null
  // The generation in which this panel's values were last confirmed: by its own successful
  // read, or, for a member who cannot read, when it mounted.
  const confirmed = useRef(generation.current)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [startError, setStartError] = useState('')
  const startProblems = useFieldProblems()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  // A step removes the form that made it; focus goes to its execution, if it was lost.
  const focus = useFocusById()
  // Each execution-list request is numbered. Hiding the results retires every request
  // already in flight, so an answer that arrives later cannot bring values back.
  const request = useRef(0)
  const hidden = useRef(false)
  const hideResults = useCallback((reason: LabResultsHiddenReason) => {
    request.current += 1; hidden.current = true
    setResults(null); setNotice(''); setStartError(''); setLoading(false); setError(LAB_RESULTS_HIDDEN[reason])
  }, [])
  // Every specimen in the accession belongs to the same patient, so the others hide too.
  const endAccess = useCallback((reason: LabResultsHiddenReason) => { hideResults(reason); onResultsHidden(reason) }, [hideResults, onResultsHidden])
  useEffect(() => { if (resultsHidden) hideResults(resultsHidden.reason) }, [resultsHidden, hideResults])
  // A specimen step failed with a doubt. A reader re-reads below; without
  // lab.execution.read there is nothing to confirm access with, so hide at once.
  useEffect(() => { if (recheck && !canRead) hideResults(recheck.reason) }, [recheck, canRead, hideResults])
  useEffect(() => {
    if (!canRead) return
    const current = ++request.current
    const sent = generation.current
    setLoading(true); setError('')
    void staffApi.labExecutions(facilityId, specimen.id)
      .then(value => {
        // A newer request, or a hide anywhere in the accession since this one was sent, voids it.
        if (request.current !== current || generation.current !== sent) return
        hidden.current = false; confirmed.current = sent
        setResults({ items: value.items, generation: sent }); setLoading(false)
      })
      // Only a successful read confirms access, so any failure hides what is on screen.
      .catch(caught => { if (request.current === current) endAccess(labResultsReadDoubt(caught) ?? 'unverified') })
    return () => { request.current += 1 }
  }, [canRead, facilityId, specimen.id, generation, revision, recheck, endAccess])
  // A failed action may only refuse that write (for example under break-glass), or may
  // mean read access ended or cannot be confirmed. Reload to find out: a failed reload
  // hides the values. Without lab.execution.read there is no reload, so hide at once.
  const recheckAccess = useCallback((caught: unknown) => {
    const doubt = labResultsReadDoubt(caught)
    if (!doubt) return
    if (canRead) setRevision(current => current + 1)
    else endAccess(doubt)
  }, [canRead, endAccess])
  // An action that answers after the results were hidden, here or anywhere in the accession,
  // must not bring them back.
  const stale = () => hidden.current || generation.current !== confirmed.current
  // A step clears what the last one said, so the region changes even when the next
  // records the same thing (a second execution completed, a second result verified).
  const stepStarted = useCallback(() => setNotice(''), [])
  function changedExecution(value: LabExecution, message: string) {
    if (stale()) return
    const confirmedIn = confirmed.current
    setResults(previous => ({ items: [...(previous?.items ?? []).filter(item => item.id !== value.id), value], generation: confirmedIn }))
    setNotice(message)
    focus(`lab-execution-${value.id}-title`, true)
    if (canRead) setRevision(current => current + 1)
  }
  function changedResult(executionId: string, value: LabResult, message: string) {
    if (stale()) return
    const confirmedIn = confirmed.current
    setResults(previous => previous && { items: previous.items.map(item => item.id === executionId ? { ...item, result: value } : item), generation: confirmedIn })
    setNotice(message)
    focus(`lab-execution-${executionId}-title`, true)
    if (canRead) setRevision(current => current + 1)
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    const method = String(form.get('method') ?? '').trim()
    setStartError(''); startProblems.clear()
    if (!reason) return startProblems.refuse(`lab-start-reason-${specimen.id}`, 'Enter a reason to begin execution.')
    setBusy(true); setNotice('')
    try { changedExecution(await staffApi.startLabExecution(facilityId, specimen, reason, method), 'Analytical execution started.') }
    catch (caught) { setStartError(errorText(caught, 'Execution could not be started. Refresh the specimen first.')); recheckAccess(caught) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item staff-stack"><h3>Analytical execution</h3>
    {/* Mounted throughout, so what a step records is announced; it says so through the read that follows. */}
    <div id={`lab-executions-status-${specimen.id}`} role="status">{notice ? <p className="staff-success">{notice}</p> : loading && <p>Loading executions…</p>}</div>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {canRead && <Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (loading) return; setNotice(''); setRevision(value => value + 1) }}>Refresh executions</Button>}
    {items?.map(execution => <ExecutionCard key={execution.id} facilityId={facilityId} execution={execution} permissions={permissions}
      onStarted={stepStarted} onExecutionChanged={changedExecution} onResultChanged={(value, message) => changedResult(execution.id, value, message)} onRefused={recheckAccess} />)}
    {canStart && !loading && !error && (items?.length === 0 || (!canRead && !items)) && <form className="staff-form" onSubmit={event => void start(event)}>
      <p className="staff-muted">Begin analysis for this received specimen. The backend checks the exact specimen version and patient authorization.</p>
      <Field label="Method" htmlFor={`lab-method-${specimen.id}`}><Input id={`lab-method-${specimen.id}`} name="method" maxLength={240} /></Field>
      <Field label="Reason" htmlFor={`lab-start-reason-${specimen.id}`} error={startProblems.error(`lab-start-reason-${specimen.id}`)} required><Textarea id={`lab-start-reason-${specimen.id}`} name="reason" maxLength={500} required {...startProblems.control(`lab-start-reason-${specimen.id}`)} /></Field>
      {startError && <p className="staff-error" role="alert">{startError}</p>}
      <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Starting…' : 'Start execution'}</Button>
    </form>}
    {canRead && !loading && !error && items?.length === 0 && !canStart && <p className="staff-muted">No execution has started for this specimen.</p>}
  </div>
}

function AccessionView({ facilityId, id, permissions, created, onChanged }: { facilityId: string; id: string; permissions: string[]; created?: string; onChanged: () => void }) {
  // An accession is shown only for the reload it came from, so a reload removes every
  // specimen row at once and each panel reads its results once, when it mounts again.
  const [loaded, setLoaded] = useState<{ revision: number; accession: LabAccession } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  // What the last step recorded, said in a region mounted throughout. A step clears
  // it when it starts, so a second step that records the same thing is said again.
  const [notice, setNotice] = useState('')
  // The region comes with the accession, which replaces the form that created it, and
  // one inserted already holding its text may not be announced: the creation is said
  // once the accession's first read has settled, whether or not that read succeeded.
  const creation = useRef(created)
  // A specimen step reloads the accession, which removes every specimen row until it is
  // read again; focus goes to the specimen's next step, or the specimen, once it is shown.
  const [focusAfterRead, setFocusAfterRead] = useState<readonly string[] | null>(null)
  const focus = useFocusById()
  const [recheck, setRecheck] = useState<LabResultsSignal | null>(null)
  const [resultsHidden, setResultsHidden] = useState<LabResultsSignal | null>(null)
  // The generation of this accession's results, shared with its own panels only. A hide starts
  // a new one synchronously, so every read or write a sibling still has in flight is void
  // before it can answer, and values from an earlier generation no longer render.
  const generation = useRef(0)
  const accession = loaded?.revision === revision ? loaded.accession : null
  const reload = useCallback(() => { setRevision(value => value + 1); setRecheck(null); setResultsHidden(null) }, [])
  // A new signal for every hide, so a panel restored by its own refresh hides again.
  const hideResults = useCallback((reason: LabResultsHiddenReason) => {
    generation.current += 1
    setResultsHidden(previous => ({ reason, seq: (previous?.seq ?? 0) + 1 }))
  }, [])
  // A specimen step that fails with a doubt re-checks in place: the accession is read
  // again and every panel re-reads its results, while the step keeps its error and input.
  // A failed read hides the results as usual; a failed accession read removes it all.
  const specimenRefused = useCallback((caught: unknown) => {
    const doubt = labResultsReadDoubt(caught)
    if (doubt) setRecheck(previous => ({ reason: doubt, seq: (previous?.seq ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!focusAfterRead || (!accession && !error)) return
    setFocusAfterRead(null)
    focus(accession ? focusAfterRead : 'lab-accession-refresh', true)
  }, [focusAfterRead, accession, error, focus])
  function specimenChanged(specimen: LabSpecimen, message: string) {
    setNotice(message)
    setFocusAfterRead([`lab-action-${specimen.id}`, `lab-specimen-${specimen.id}-title`, 'lab-accession-title'])
    reload()
  }
  useEffect(() => {
    let active = true
    setError(''); setLoading(true)
    void staffApi.labAccession(facilityId, id).then(value => { if (active) setLoaded({ revision, accession: value }) })
      .catch(caught => { if (active) { setLoaded(null); setError(errorText(caught, 'Accession could not be loaded.')) } })
      .finally(() => {
        if (!active) return
        setLoading(false)
        if (creation.current) { setNotice(creation.current); creation.current = undefined }
      })
    return () => { active = false }
  }, [facilityId, id, revision, recheck])
  return <Card className="staff-card"><h2 id="lab-accession-title" tabIndex={-1}>Specimen accession</h2>
    {/* Mounted throughout, so what a step records is announced; it says so through the read that follows. */}
    <div id="lab-accession-status" role="status">{notice ? <p className="staff-success">{notice}</p> : loading && <p>Loading accession…</p>}</div>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {accession && <><p>Accession {accession.accessionNumber}</p><div className="staff-list">{accession.specimens.map(specimen => <div className="staff-stack" key={`${specimen.id}-${specimen.status}`}><SpecimenAction facilityId={facilityId} accessionId={id} specimen={specimen} permissions={permissions} onStarted={() => setNotice('')} onChanged={message => { specimenChanged(specimen, message); onChanged() }} onRefused={specimenRefused} />{specimen.status === 'received' && (permissions.includes('lab.execution.read') || permissions.includes('lab.execution.start')) && <ExecutionPanel facilityId={facilityId} specimen={specimen} permissions={permissions} generation={generation} recheck={recheck} resultsHidden={resultsHidden} onResultsHidden={hideResults} />}</div>)}</div></>}
    <div className="staff-row"><Button id="lab-accession-refresh" tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (loading) return; setNotice(''); reload() }}>Refresh accession</Button></div>
  </Card>
}

export function Laboratory() {
  const { facilityId, permissions } = useFacilityAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const list = useFacilityList(facilityId, canRead, useCallback(async id => (await staffApi.labWorkItems(id)).items, []))
  const [selection, setSelection] = useState<{ facilityId: string; item: LabWorkItem; created?: string } | null>(null)
  const selected = selection && selection.facilityId === facilityId ? selection.item : null
  // A created accession replaces the form that made it: focus goes to the accession.
  const focus = useFocusById()
  if (!facilityId || !canRead) return <EmptyState titleAs="h1" title="Laboratory unavailable" description="This facility membership needs lab work-item read permission." />
  return <>
    <PageHead eyebrow="Provider workspace" title="Laboratory">Accepted EHR test orders at this facility. A separate accession records the specimen chain of custody.</PageHead>
    <div className="staff-row staff-toolbar"><RefreshButton loading={list.loading} onRefresh={list.refresh}>Refresh work</RefreshButton></div>
    <ListState loading={list.loading} error={list.error} empty="No accepted lab work" retry={() => void list.refresh()} hasItems={Boolean(list.items?.length)} />
    <WorkListCap count={list.items?.length ?? 0} />
    {list.items && list.items.length > 0 && <div className="staff-two-col"><div className="staff-list">{list.items.map(item => <div className="staff-list-item" key={item.id}><div className="staff-row"><strong>{item.testName ?? 'Lab test'}</strong><Badge tone={item.accessionId ? 'information' : 'warning'}>{item.accessionId ? 'Accessioned' : item.status}</Badge></div><p>Patient {shortId(item.patientId)} · Accepted {dateText(item.acceptedAt)}</p>{item.accessionNumber && <p>Accession {item.accessionNumber}</p>}{(item.accessionId ? permissions.includes('lab.accession.read') : permissions.includes('lab.accession.create')) && <Button tone="secondary" size="sm" onClick={() => setSelection({ facilityId, item })}>{item.accessionId ? 'Open accession' : 'Prepare accession'}</Button>}</div>)}</div>
      {selected?.accessionId && permissions.includes('lab.accession.read') ? <AccessionView key={`${facilityId}-${selected.accessionId}`} facilityId={facilityId} id={selected.accessionId} permissions={permissions} created={selection?.created} onChanged={() => void list.refresh()} /> : selected && permissions.includes('lab.accession.create') ? <AccessionForm facilityId={facilityId} item={selected} onCreated={accession => { setSelection({ facilityId, item: { ...selected, accessionId: accession.id, accessionNumber: accession.accessionNumber }, created: `Accession ${accession.accessionNumber} created.` }); focus('lab-accession-title', true); void list.refresh() }} /> : <Card className="staff-card"><h2>Choose work</h2><p>Open an accession or prepare a specimen for an accepted order.</p></Card>}
    </div>}
  </>
}

function PharmacyAction({ facilityId, item, permissions, onChanged }: { facilityId: string; item: PharmacyWorkItem; permissions: string[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // hid-system #48 (migration 0080): work whose EHR prescription changed after Pharmacy
  // accepted it stays listed as accepted, but can never be dispensed. The list cannot
  // tell, so it is known only once a dispensing is refused (409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE).
  const [undispensable, setUndispensable] = useState(false)
  // Recording removes the form once the work list is read again: focus goes to the prescription.
  const focus = useFocusById()
  const problems = useFieldProblems()
  async function submit(event: FormEvent<HTMLFormElement>, reverse = false) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy) return
    setError(''); setSuccess(''); problems.clear()
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) return problems.refuse(reverse ? `pharmacy-reversal-${item.id}` : `pharmacy-reason-${item.id}`, 'Enter a reason of at least 8 characters.')
    const quantity = Number(form.get('quantity'))
    const unit = String(form.get('unit') ?? '').trim()
    if (!reverse && (!Number.isFinite(quantity) || quantity <= 0 || !unit)) {
      return problems.refuse(!Number.isFinite(quantity) || quantity <= 0 ? `pharmacy-quantity-${item.id}` : `pharmacy-unit-${item.id}`, 'Enter a positive quantity and unit.')
    }
    setBusy(true)
    try {
      if (reverse) {
        if (!item.dispensing) throw new Error('No dispensing is available to reverse.')
        const current = await staffApi.dispensing(facilityId, item.dispensing.id)
        await staffApi.reverseDispensing(facilityId, current.id, current.version, reason)
        setSuccess('Dispensing reversal recorded.')
      } else {
        await staffApi.dispense(facilityId, item, quantity, unit, reason)
        setSuccess('Dispensing recorded.')
      }
      await onChanged()
      focus(`pharmacy-${item.id}-title`, true)
    } catch (caught) {
      if (!reverse && isHidApiError(caught) && caught.code === 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE') {
        // Its dispensing form goes, so the work continues at the prescription.
        setUndispensable(true)
        focus(`pharmacy-${item.id}-title`, true)
      } else setError(errorText(caught, 'Pharmacy action could not be recorded.'))
    }
    finally { setBusy(false) }
  }
  const canDispense = !item.dispensing && !undispensable && permissions.includes('pharmacy.dispensing.create')
  const canReverse = Boolean(item.dispensing && !item.dispensing.reversed && permissions.includes('pharmacy.dispensing.reverse') && permissions.includes('pharmacy.dispensing.read'))
  return <div className="staff-list-item"><div className="staff-row"><strong id={`pharmacy-${item.id}-title`} tabIndex={-1}>{item.medication.display}</strong><Badge tone={item.dispensing?.reversed ? 'warning' : item.dispensing ? 'success' : undispensable ? 'danger' : 'information'}>{item.dispensing?.reversed ? 'Reversed' : item.dispensing ? 'Dispensed' : undispensable ? 'Not dispensable' : 'Accepted'}</Badge></div><p>Patient {shortId(item.patientId)} · {item.doseQuantity == null ? 'Dose not recorded' : `${item.doseQuantity} ${item.doseUnit ?? ''}`} · {item.frequency ?? 'Frequency not recorded'}</p>
    <p>{item.routeCode ? `Route: ${item.routeCode}` : 'Route not recorded'}</p>
    {item.instructions && <p className="staff-note-content">{item.instructions}</p>}
    {canDispense && <form className="staff-form" onSubmit={event => void submit(event)}><div className="staff-form-row"><Field label="Quantity dispensed" htmlFor={`pharmacy-quantity-${item.id}`} error={problems.error(`pharmacy-quantity-${item.id}`)} required><Input id={`pharmacy-quantity-${item.id}`} name="quantity" type="number" min="0.0001" step="0.0001" required {...problems.control(`pharmacy-quantity-${item.id}`)} /></Field><Field label="Unit" htmlFor={`pharmacy-unit-${item.id}`} error={problems.error(`pharmacy-unit-${item.id}`)} required><Input id={`pharmacy-unit-${item.id}`} name="unit" maxLength={80} defaultValue={item.doseUnit ?? ''} required {...problems.control(`pharmacy-unit-${item.id}`)} /></Field></div><Field label="Reason" htmlFor={`pharmacy-reason-${item.id}`} error={problems.error(`pharmacy-reason-${item.id}`)} required><Textarea id={`pharmacy-reason-${item.id}`} name="reason" minLength={8} maxLength={500} required {...problems.control(`pharmacy-reason-${item.id}`)} /></Field><Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Recording…' : 'Record full dispensing'}</Button></form>}
    {canReverse && <form className="staff-form" onSubmit={event => void submit(event, true)}><Field label="Reversal reason" htmlFor={`pharmacy-reversal-${item.id}`} error={problems.error(`pharmacy-reversal-${item.id}`)} required><Textarea id={`pharmacy-reversal-${item.id}`} name="reason" minLength={8} maxLength={500} required {...problems.control(`pharmacy-reversal-${item.id}`)} /></Field><Button type="submit" tone="secondary" size="sm" aria-disabled={busy || undefined} className={UNAVAILABLE}>{busy ? 'Recording…' : 'Reverse dispensing'}</Button></form>}
    {undispensable && !item.dispensing && <p className="staff-error" role="alert">Not dispensable: the prescription changed after Pharmacy accepted it; a new prescription and handoff are needed.</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {/* Mounted throughout, so what was recorded is announced. */}
    <div id={`pharmacy-status-${item.id}`} role="status">{success && <p className="staff-success">{success}</p>}</div>
  </div>
}

export function Pharmacy() {
  const { facilityId, permissions } = useFacilityAccess()
  const canRead = permissions.includes('pharmacy.work-item.read')
  const list = useFacilityList(facilityId, canRead, useCallback(async id => (await staffApi.pharmacyWorkItems(id)).items, []))
  if (!facilityId || !canRead) return <EmptyState titleAs="h1" title="Pharmacy unavailable" description="This facility membership needs pharmacy work-item read permission." />
  return <>
    <PageHead eyebrow="Provider workspace" title="Pharmacy">Accepted prescriptions and full dispensing records for the active facility. The server checks patient authorization before dispensing or reversal.</PageHead>
    <div className="staff-row staff-toolbar"><RefreshButton loading={list.loading} onRefresh={list.refresh}>Refresh work</RefreshButton></div>
    <ListState loading={list.loading} error={list.error} empty="No accepted prescriptions" retry={() => void list.refresh()} hasItems={Boolean(list.items?.length)} />
    {/* hid-system #48: work whose prescription changed stays listed as accepted (INTERFACE_CONTRACT.md, Pharmacy). */}
    <WorkListCap count={list.items?.length ?? 0}><p className="staff-notice">Work whose prescription changed after Pharmacy accepted it cannot be dispensed, but it stays listed and counts toward these {WORK_LIST_CAP}.</p></WorkListCap>
    {list.items && list.items.length > 0 && <div className="staff-list">{list.items.map(item => <PharmacyAction key={item.id} facilityId={facilityId} item={item} permissions={permissions} onChanged={list.refresh} />)}</div>}
  </>
}

const candidateTypes = {
  EHR: 'clinical_note', LAB: 'lab_document', PHARMACY: 'historical_medication_evidence',
  DOCUMENT_ONLY: 'document_only', UNCLASSIFIED: 'unclassified',
} as const

const publicationOperations = {
  EHR: 'create_imported_clinical_note', LAB: 'create_imported_lab_evidence',
  PHARMACY: 'create_imported_medication_evidence', DOCUMENT_ONLY: 'retain_validated_document',
} as const

function jsonObject(value: FormDataEntryValue | null, label: string, field: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new FieldInputError(field, `${label} must be valid JSON.`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new FieldInputError(field, `${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

function jsonObjectArray(value: FormDataEntryValue | null, label: string, field: string): Record<string, unknown>[] {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new FieldInputError(field, `${label} must be valid JSON.`) }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new FieldInputError(field, `${label} must be a JSON array of objects.`)
  return parsed as Record<string, unknown>[]
}

function OcrReview({ facilityId, job, extractions, onChanged }: { facilityId: string; job: OcrJob; extractions: OcrExtraction[]; onChanged: (disposition: 'validated' | 'rejected') => Promise<void> }) {
  const [extractionId, setExtractionId] = useState(extractions.at(-1)?.id ?? '')
  const [disposition, setDisposition] = useState<'validated' | 'rejected'>('validated')
  const [domain, setDomain] = useState<OcrTargetDomain>('DOCUMENT_ONLY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const selected = extractions.find(item => item.id === extractionId)
  // A JSON field is described by its error, when refused, and by what the owning domains require.
  const jsonFieldProps = (id: string) => ({ ...problemProps(problem, id), 'aria-describedby': describedBy(problem?.field === id && `${id}-error`, 'ocr-review-requirements') })
  // Read in the order the fields appear, so the first refused one is the one focused.
  function read(form: FormData): OcrValidationInput {
    if (!selected) throw new FieldInputError('ocr-review-extraction', 'Choose an extraction to review.')
    const validatedPayload = jsonObject(form.get('validatedPayload'), 'Reviewed payload', 'ocr-reviewed-payload')
    const acceptedFields = jsonObject(form.get('acceptedFields'), 'Accepted fields', 'ocr-accepted-fields')
    const rejectedFields = jsonObjectArray(form.get('rejectedFields'), 'Rejected fields', 'ocr-rejected-fields')
    const corrections = jsonObjectArray(form.get('corrections'), 'Corrections', 'ocr-corrections')
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) throw new FieldInputError('ocr-review-reason', 'Enter a review reason of at least 8 characters.')
    const targetDomain = disposition === 'rejected' ? 'UNCLASSIFIED' : domain
    return { extractionId: selected.id, validatedPayload, acceptedFields, rejectedFields, corrections,
      disposition, targetDomain, candidateType: candidateTypes[targetDomain], reason }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setProblem(null)
    let input: OcrValidationInput
    try { input = read(new FormData(event.currentTarget)) }
    catch (caught) {
      if (!(caught instanceof FieldInputError)) throw caught
      setProblem(refusal({ field: caught.field, message: caught.message })); focus(caught.field); return
    }
    setBusy(true)
    try {
      await staffApi.validateOcrJob(facilityId, job, input)
      await onChanged(input.disposition)
    } catch (caught) { setError(errorText(caught, 'Review could not be recorded. Refresh the job and try again.')); focus('ocr-review-submit', true) }
    finally { setBusy(false) }
  }
  if (!extractions.length) return <p className="staff-muted">An extraction must be available before review.</p>
  return <Card className="staff-card"><h2>Review extraction</h2><p>Inspect the source text and explicitly classify the candidate. Only validated evidence can be published.</p><form className="staff-form" noValidate onSubmit={event => void submit(event)}>
    <Field label="Extraction" htmlFor="ocr-review-extraction" error={problemText(problem, 'ocr-review-extraction')}><Select id="ocr-review-extraction" value={extractionId} onChange={event => setExtractionId(event.target.value)} {...problemProps(problem, 'ocr-review-extraction')}>{extractions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.provider}</option>)}</Select></Field>
    <Field label="Review decision" htmlFor="ocr-review-decision"><Select id="ocr-review-decision" value={disposition} onChange={event => setDisposition(event.target.value as 'validated' | 'rejected')}><option value="validated">Validate candidate</option><option value="rejected">Reject candidate</option></Select></Field>
    {disposition === 'validated' && <Field label="Owning domain" htmlFor="ocr-review-domain"><Select id="ocr-review-domain" value={domain} onChange={event => setDomain(event.target.value as OcrTargetDomain)}><option value="DOCUMENT_ONLY">Retain validated document</option><option value="EHR">Clinical note</option><option value="LAB">Historical lab evidence</option><option value="PHARMACY">Historical medication evidence</option></Select></Field>}
    <Field label="Reviewed payload (JSON object)" htmlFor="ocr-reviewed-payload" error={problemText(problem, 'ocr-reviewed-payload')} required><Textarea key={`payload-${selected?.id}`} id="ocr-reviewed-payload" name="validatedPayload" rows={7} spellCheck={false} defaultValue={JSON.stringify(selected?.structuredPayload && typeof selected.structuredPayload === 'object' && !Array.isArray(selected.structuredPayload) ? selected.structuredPayload : {}, null, 2)} required {...jsonFieldProps('ocr-reviewed-payload')} /></Field>
    <Field label="Accepted fields (JSON object)" htmlFor="ocr-accepted-fields" error={problemText(problem, 'ocr-accepted-fields')} required><Textarea id="ocr-accepted-fields" name="acceptedFields" rows={6} spellCheck={false} defaultValue="{}" required {...jsonFieldProps('ocr-accepted-fields')} /></Field>
    <p id="ocr-review-requirements" className="staff-muted">EHR requires encounterId, noteType, title, and content. Lab requires observations. Pharmacy requires medicationText. Document retention can use an empty object.</p>
    <div className="staff-form-row"><Field label="Rejected fields (JSON array)" htmlFor="ocr-rejected-fields" error={problemText(problem, 'ocr-rejected-fields')} required><Textarea id="ocr-rejected-fields" name="rejectedFields" spellCheck={false} defaultValue="[]" required {...problemProps(problem, 'ocr-rejected-fields')} /></Field><Field label="Corrections (JSON array)" htmlFor="ocr-corrections" error={problemText(problem, 'ocr-corrections')} required><Textarea id="ocr-corrections" name="corrections" spellCheck={false} defaultValue="[]" required {...problemProps(problem, 'ocr-corrections')} /></Field></div>
    <Field label="Review reason" htmlFor="ocr-review-reason" error={problemText(problem, 'ocr-review-reason')} required><Textarea id="ocr-review-reason" name="reason" minLength={8} maxLength={500} required {...problemProps(problem, 'ocr-review-reason')} /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button id="ocr-review-submit" type="submit" disabled={busy}>{busy ? 'Recording review…' : disposition === 'rejected' ? 'Reject extraction' : 'Validate extraction'}</Button>
  </form></Card>
}

// OCR takes one patient confirmation per job version. A retry of the same
// confirmation reuses its key, so OCR answers with the one it recorded; if the
// job was confirmed already, it is reloaded rather than left with a dead form.
function OcrConfirmation({ facilityId, job, onChanged }: { facilityId: string; job: OcrJob; onChanged: (notice?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const patientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError(''); setProblem(null)
    const refused = !patientId ? { field: 'ocr-confirm-patient', message: 'Enter the canonical patient ID.' }
      : !UUID_V4.test(patientId) ? { field: 'ocr-confirm-patient', message: 'Enter a valid canonical patient ID (a UUID).' }
      : reason.length < 8 ? { field: 'ocr-confirm-reason', message: 'Enter a patient confirmation reason of at least 8 characters.' } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    const signature = JSON.stringify([patientId, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try { await staffApi.confirmOcrPatient(facilityId, job, patientId, reason, attempt.current.key); attempt.current = null; await onChanged() }
    catch (caught) {
      if (isHidApiError(caught) && caught.code === 'OCR_PATIENT_ALREADY_CONFIRMED') {
        await onChanged('The source patient of this job was already confirmed, so the job was reloaded.')
        return
      }
      setError(errorText(caught, 'Patient confirmation could not be recorded.'))
      focus('ocr-confirm-submit', true)
    }
    finally { setBusy(false) }
  }
  return <Card className="staff-card"><h2 id="ocr-confirm-title" tabIndex={-1}>Confirm source patient</h2><p>Confirm the canonical patient against the clinical source document before publication. The backend verifies an exact match and write authorization.</p><form className="staff-form" noValidate onSubmit={event => void submit(event)}><Field label="Canonical patient ID" htmlFor="ocr-confirm-patient" error={problemText(problem, 'ocr-confirm-patient')} required><Input id="ocr-confirm-patient" name="patientId" defaultValue={job.patientId ?? ''} required {...problemProps(problem, 'ocr-confirm-patient')} /></Field><Field label="Confirmation reason" htmlFor="ocr-confirm-reason" error={problemText(problem, 'ocr-confirm-reason')} required><Textarea id="ocr-confirm-reason" name="reason" minLength={8} maxLength={500} required {...problemProps(problem, 'ocr-confirm-reason')} /></Field>{error && <p className="staff-error" role="alert">{error}</p>}<Button id="ocr-confirm-submit" type="submit" disabled={busy}>{busy ? 'Confirming…' : 'Confirm source patient'}</Button></form></Card>
}

/** Publication failures OCR attempts again; any other failure is final (hid-system ocr.service.ts RETRYABLE_PUBLICATION_FAILURES). */
const RETRYABLE_PUBLICATION_FAILURES: readonly string[] = ['OWNING_SERVICE_UNAVAILABLE', 'REQUEST_IN_PROGRESS']

function attemptsLeft(publication: OcrPublication) {
  return publication.attemptCount == null || publication.maxAttempts == null || publication.attemptCount < publication.maxAttempts
}

/**
 * A publication OCR takes further, but only for the request that started it, sent again with its key: one
 * not finished (pending, or processing, which OCR takes back once its claim expires) or one that failed for a
 * reason OCR attempts again, while attempts remain. Nothing else does: no worker runs publications
 * (hid-system ocr.service.ts executePublication).
 */
function resumable(publication: OcrPublication) {
  return (publication.status === 'pending' || publication.status === 'processing'
    || (publication.status === 'failed' && RETRYABLE_PUBLICATION_FAILURES.includes(publication.failureCode ?? ''))) && attemptsLeft(publication)
}

/** OCR's wait after a failed attempt before it takes the publication again (hid-system ocr.service.ts executePublication, next_attempt_at). */
const PUBLICATION_RETRY_WAIT_MS = 15_000
const PUBLICATION_RETRY_WAIT = 'OCR allows another attempt about 15 seconds after a failure.'

/** A publication request this page sent: the Idempotency-Key it goes with, and when OCR takes a failed one again. */
interface PublicationAttempt { readonly key: string; retryAt: number }

function publicationRefusal(caught: unknown) {
  // OCR answers it also after the last attempt (INTERFACE_CONTRACT.md, OCR publication).
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_IN_PROGRESS') return 'OCR did not start another attempt: one is still running, it is too soon after the last one, or no attempts remain.'
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_TERMINAL') return 'The owning service refused this publication, so it cannot be retried.'
  return errorText(caught, 'Validated evidence could not be published.')
}

const publishedAs: Partial<Record<OcrTargetDomain, string>> = {
  EHR: 'Published as a clinical note in the patient\'s record.',
  LAB: 'Published as imported lab evidence in the patient\'s record.',
  PHARMACY: 'Published as imported medication evidence in the patient\'s record.',
  DOCUMENT_ONLY: 'Kept as a validated document in the patient\'s record.',
}

function observationText(item: LabImport['observations'][number]) {
  const result = [item.value && `${item.value}${item.unit ? ` ${item.unit}` : ''}`, item.valueText].filter(Boolean).join(' · ')
  const flag = item.abnormalFlag && item.abnormalFlag !== 'normal' && item.abnormalFlag !== 'unknown' ? `flagged ${item.abnormalFlag}` : ''
  // Defensive: Lab stores every imported observation as 'reported' today (hid-system ehr-api migration
  // 0017, lab.imported_observations), but a status it may add later is said, never hidden.
  const status = item.status && item.status !== 'reported' ? item.status.replaceAll('_', ' ') : ''
  return [result ? `${item.testName}: ${result}` : item.testName, item.referenceRange && `reference ${item.referenceRange}`, flag, status].filter(Boolean).join(' · ')
}

/**
 * Evidence a Lab or Pharmacy publication imported, read from its owning domain only when asked: each read
 * is audited. What was imported does not change, so a read that succeeded is kept; one that failed is made
 * again on the next opening.
 */
function ImportedEvidence({ facilityId, domain, importId }: { facilityId: string; domain: 'lab' | 'medication'; importId: string }) {
  const [open, setOpen] = useState(false)
  const [evidence, setEvidence] = useState<{ lab?: LabImport; medication?: PharmacyImport; error?: string } | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!reads) return
    let active = true
    const read = domain === 'lab' ? staffApi.labImport(facilityId, importId).then(lab => ({ lab }))
      : staffApi.pharmacyImport(facilityId, importId).then(medication => ({ medication }))
    void read.then(found => { if (active) setEvidence(found) })
      .catch(caught => { if (active) setEvidence({ error: errorText(caught, 'Imported evidence could not be read.') }) })
    return () => { active = false }
  }, [facilityId, domain, importId, reads])
  function toggle() {
    // Cleared here, with the opening, so a refusal is never shown over the read that follows it.
    if (!open && (reads === 0 || evidence?.error)) { setEvidence(null); setReads(value => value + 1) }
    setOpen(!open)
  }
  const lab = open ? evidence?.lab : undefined
  const medication = open ? evidence?.medication : undefined
  const status = !open ? '' : !evidence ? 'Loading imported evidence…'
    : lab ? `Imported lab evidence loaded: ${lab.observations.length} observation${lab.observations.length === 1 ? '' : 's'}.`
      : medication ? 'Imported medication evidence loaded.' : ''
  // A disclosure: its name stays the same, and aria-expanded says whether it is open.
  return <div className="staff-stack"><div><Button tone="secondary" size="sm" aria-expanded={open} onClick={toggle}>Imported {domain} evidence</Button>
    {/* Mounted throughout, so what is put in it is announced; with the button, so it takes no space while empty. */}
    <div role="status">{status && <p className="staff-muted">{status}</p>}</div></div>
    {open && evidence?.error && <p className="staff-error" role="alert">{evidence.error}</p>}
    {lab && <>{lab.status && lab.status !== 'accepted' && <p>Import status: {lab.status.replaceAll('_', ' ')}</p>}{lab.externalLabName && <p>Reported by {lab.externalLabName}</p>}<ul className="staff-stack">{lab.observations.map(item => <li key={item.id}>{observationText(item)}</li>)}</ul></>}
    {medication && <><p><strong>{medication.medicationText}</strong></p>
      {(medication.strengthText || medication.doseText || medication.frequencyText) && <p>{[medication.strengthText, medication.doseText, medication.frequencyText].filter(Boolean).join(' · ')}</p>}
      {medication.historicalContext && <p className="staff-muted">{medication.historicalContext}</p>}</>}
  </div>
}

/** What a publication made: named, and readable where its owning domain lets this role read it. Never its raw ID. */
function PublishedEvidence({ facilityId, publication, permissions }: { facilityId: string; publication: OcrPublication; permissions: readonly string[] }) {
  const importId = publication.targetResourceId
  const domain = publication.targetResourceType === 'lab-imported-evidence' && permissions.includes('lab.import.read') ? 'lab'
    : publication.targetResourceType === 'pharmacy-imported-medication-evidence' && permissions.includes('pharmacy.import.read') ? 'medication' : null
  return <>
    <p>{publishedAs[publication.targetDomain] ?? 'Published.'}</p>
    {domain && importId && <ImportedEvidence facilityId={facilityId} domain={domain} importId={importId} />}
  </>
}

/**
 * A publication as OCR holds it, and what can take it further. `canPublish`: this viewer may publish this
 * review now (ocr.publication.write, with the job's current patient confirmation); `retryHere`: this page
 * holds the key of the request that made it, and offers Retry publication.
 */
function OcrPublicationStatus({ facilityId, publication, permissions, canPublish, retryHere }: {
  facilityId: string; publication: OcrPublication; permissions: readonly string[]; canPublish: boolean; retryHere: boolean
}) {
  const failed = publication.status === 'failed'
  const attempts = failed && publication.attemptCount != null && publication.maxAttempts != null ? ` · Attempt ${publication.attemptCount} of ${publication.maxAttempts}` : ''
  const unfinished = 'OCR has not finished this publication. Refresh the job status to see whether it has.'
  const failedText = !RETRYABLE_PUBLICATION_FAILURES.includes(publication.failureCode ?? '') ? 'It cannot be retried.'
    : !attemptsLeft(publication) ? 'The publication attempt limit has been reached. It cannot be retried.'
      : retryHere ? PUBLICATION_RETRY_WAIT
        : canPublish ? 'It can be retried only from the page where Publish was pressed, before that page is reloaded or left.' : ''
  // OCR claims a publication again only while attempts remain (ocr.service.ts executePublication), whichever page asks.
  const unfinishedText = !attemptsLeft(publication) ? `${unfinished} This is its last attempt: if it has stopped, it cannot be resumed.`
    : retryHere ? 'OCR has not finished this publication. If it has stopped, Retry publication resumes it; if it is still running, OCR says so.'
      : canPublish ? `${unfinished} If it has stopped, it can be resumed only from the page where Publish was pressed, before that page is reloaded or left.`
        : unfinished
  return <div className="staff-stack">
    <p>Publication: <Badge tone={publication.status === 'published' ? 'success' : failed ? 'danger' : 'information'}>{publication.status}</Badge>{publication.failureCode ? ` · ${publication.failureCode}` : ''}{attempts}</p>
    {failed && publication.failureSummary && <p>{publication.failureSummary}</p>}
    {failed && failedText && <p className="staff-muted">{failedText}</p>}
    {(publication.status === 'pending' || publication.status === 'processing') && <p className="staff-muted">{unfinishedText}</p>}
    {publication.status === 'published' && <PublishedEvidence facilityId={facilityId} publication={publication} permissions={permissions} />}
  </div>
}

// OCR keeps one publication per review. The page sends each publication request
// with one key, held in `publicationAttempts` (memory only, never browser storage), so
// a press after a lost answer or a refusal sends the same request again, and OCR
// resumes the publication it recorded under that key. A refusal reads the history
// again: the page then offers only what OCR would take, and says a publication was
// recorded when the history shows one, though its answer was lost.
function OcrPublicationCard({ actorId, facilityId, validation, confirmationId, permissions, publicationAttempts, onChanged }: {
  actorId: string | undefined; facilityId: string; validation: OcrValidation; confirmationId: string | undefined; permissions: readonly string[];
  publicationAttempts: Map<string, PublicationAttempt>; onChanged: () => Promise<void>
}) {
  const [publications, setPublications] = useState<OcrPublication[] | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Counts changes to `publicationAttempts`, which `next` reads while rendering: each change renders again.
  const [, setHeldKeys] = useState(0)
  const focus = useFocusById()
  const publishId = `ocr-publish-${validation.id}`
  const retryId = `ocr-publish-retry-${validation.id}`
  const operation = validation.disposition === 'validated' && validation.targetDomain !== 'UNCLASSIFIED' ? publicationOperations[validation.targetDomain] : undefined
  // What a press sends, and so what its key is held for. OCR finds a publication by facility, requesting
  // account and key, so the key belongs to this validation and this requester: another account signed in
  // here holds none for it.
  const request = actorId && permissions.includes('ocr.publication.write') && confirmationId && operation
    ? JSON.stringify([actorId, facilityId, validation.id, validation.version, confirmationId, operation]) : undefined
  useEffect(() => {
    let active = true
    void staffApi.ocrPublications(facilityId, validation.id).then(result => { if (active) setPublications(result.items) })
      .catch(caught => { if (active) setHistoryError(errorText(caught, 'Publication history could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, validation.id])

  /**
   * The control that takes publication further: Publish before any request, Retry publication for this
   * page's own request. OCR does not say which request made a publication, so one is taken to be this
   * page's while the page holds a key for the request. Were this page's press never to have reached OCR,
   * and another request made it, OCR answers the retry 409 OCR_ALREADY_PUBLISHED, which drops the key.
   */
  function next(items: readonly OcrPublication[] | null) {
    if (!request || !items) return null
    if (items.length === 0) return publishId
    return publicationAttempts.has(request) && items.some(resumable) ? retryId : null
  }

  /** Holds a request's key, or drops it, and renders what that changes. */
  function hold(held: string, attempt: PublicationAttempt | null) {
    if (attempt) publicationAttempts.set(held, attempt)
    else publicationAttempts.delete(held)
    setHeldKeys(value => value + 1)
  }

  // Reads the history again, keeping what it showed until the answer arrives.
  async function reload(): Promise<OcrPublication[] | null> {
    try { const { items } = await staffApi.ocrPublications(facilityId, validation.id); setPublications(items); setHistoryError(''); return items }
    catch (caught) { setHistoryError(errorText(caught, 'Publication history could not be loaded.')); return null }
  }

  /** A publication the history read again shows, whatever answer was lost on the way: said, and the job read again. */
  async function recorded(items: readonly OcrPublication[] | null) {
    if (!request || !items?.some(item => item.status === 'published')) return false
    hold(request, null)
    await onChanged()
    return true
  }

  async function publish(retrying = false) {
    if (!request || !confirmationId || !operation) return
    const held = publicationAttempts.get(request)
    // A failed publication is taken again only after OCR's wait: a press before then would be refused, so nothing is sent.
    const wait = retrying && held && publications?.some(item => item.status === 'failed') ? held.retryAt - Date.now() : 0
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000)
      setError(`${PUBLICATION_RETRY_WAIT} Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`)
      return
    }
    const attempt = held ?? { key: crypto.randomUUID(), retryAt: 0 }
    hold(request, attempt)
    setBusy(true); setError('')
    try {
      const publication = await staffApi.publishOcrValidation(facilityId, validation, confirmationId, operation, attempt.key)
      if (publication.status === 'published') { hold(request, null); await onChanged(); return }
      // Any other answer published nothing: show what OCR holds.
      const items = await reload()
      if (await recorded(items)) return
      focus(next(items ?? publications) ?? 'ocr-history-title', true)
    } catch (caught) {
      // That publication was requested with another key, so this request cannot resume it.
      const alreadyPublished = isHidApiError(caught) && caught.code === 'OCR_ALREADY_PUBLISHED'
      // The history shown is out of date then: it is not shown, nor Publish offered, until read again.
      if (alreadyPublished) { hold(request, null); setPublications(null) }
      // A failed attempt has OCR wait before the next: counted from this answer, which came after the failure.
      // Read only when Retry publication is pressed, so it needs no render.
      else attempt.retryAt = Date.now() + PUBLICATION_RETRY_WAIT_MS
      const items = await reload()
      if (await recorded(items)) return
      // Said once the history has been read again, so one alert says what happened.
      setError(alreadyPublished ? `This review already has a publication request${items ? ', shown below' : ''}.` : publicationRefusal(caught))
      // Any other history that could not be read again still shows as it was.
      focus(next(items ?? (alreadyPublished ? null : publications)) ?? 'ocr-history-title', true)
    }
    finally { setBusy(false) }
  }
  const action = next(publications)
  return <div className="staff-list-item"><div className="staff-row"><strong>Review {validation.version} · {validation.targetDomain}</strong><Badge tone={validation.disposition === 'validated' ? 'success' : 'danger'}>{validation.disposition}</Badge></div><p>{validation.reason} · {dateText(validation.reviewedAt)}</p>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {historyError && <p className="staff-error" role="alert">{historyError}</p>}
    {publications === null && !historyError && <p className="staff-muted" role="status">Loading publication history…</p>}
    {publications?.map(publication => <OcrPublicationStatus key={publication.id} facilityId={facilityId} publication={publication} permissions={permissions} canPublish={request !== undefined} retryHere={action === retryId} />)}
    {action === publishId && <Button id={publishId} size="sm" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : `Publish to ${validation.targetDomain.replace('_', ' ')}`}</Button>}
    {action === retryId && <Button id={retryId} size="sm" onClick={() => void publish(true)} disabled={busy}>{busy ? 'Retrying…' : 'Retry publication'}</Button>}
  </div>
}

/**
 * Where focus goes once a step's answer has rendered, the first of `targets`
 * shown, and what the status region then says. `confirmNext` adds the next step
 * when that step is the source patient confirmation now shown.
 */
interface StepFocus { readonly targets: readonly string[]; readonly notice?: string; readonly confirmNext?: boolean }

export function Ocr() {
  const { facilityId, permissions } = useFacilityAccess()
  const { state: staffState, lock } = useStaff()
  const actorId = staffState.status === 'ready' ? staffState.session.actor.id : undefined
  const canRead = permissions.includes('ocr.job.read')
  // A clinical document's "Extract with OCR" link hands over its IDs in router state, never in the URL.
  // The history entry holding them outlives the session and the facility that made it (Back, Forward
  // and a reload bring it back), so they count only for that account and facility, and only once.
  const location = useLocation()
  const navigate = useNavigate()
  const [handoff] = useState(() => {
    const given = location.state as { ocrDocumentId?: unknown; ocrPatientId?: unknown; actorId?: unknown; facilityId?: unknown } | null
    return given && actorId !== undefined && given.actorId === actorId && given.facilityId === facilityId ? given : null
  })
  useEffect(() => {
    if (location.state != null) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [])
  const [documentId, setDocumentId] = useState(() => typeof handoff?.ocrDocumentId === 'string' ? handoff.ocrDocumentId : '')
  const [patientId, setPatientId] = useState(() => typeof handoff?.ocrPatientId === 'string' ? handoff.ocrPatientId : '')
  const [job, setJob] = useState<OcrJob | null>(null)
  const [jobFacilityId, setJobFacilityId] = useState('')
  const [extractions, setExtractions] = useState<OcrExtraction[] | null>(null)
  const [validations, setValidations] = useState<OcrValidation[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryError, setRetryError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [notice, setNotice] = useState('')
  const [stepFocus, setStepFocus] = useState<StepFocus | null>(null)
  const focus = useFocusById()
  const [lookupRevision, setLookupRevision] = useState(0)
  // Each publication request's Idempotency-Key and OCR's wait, by request. Here, not in the
  // card, so a read of the job again (which remounts the cards) keeps them; in memory only,
  // so they last until this page is reloaded or left.
  const publicationAttempts = useRef(new Map<string, PublicationAttempt>())
  const visibleJob = jobFacilityId === facilityId ? job : null
  const canRetryJob = visibleJob?.status === 'failed' &&
    (visibleJob.attemptCount === undefined || visibleJob.maxAttempts === undefined || visibleJob.attemptCount < visibleJob.maxAttempts)
  useEffect(() => { setJob(null); setExtractions(null); setValidations(null); setSearched(false); setError(''); setRetryError(''); setProblem(null); setNotice(''); setStepFocus(null) }, [facilityId])
  useEffect(() => {
    if (!facilityId || !visibleJob?.id || !canRead) return
    let active = true
    void Promise.all([staffApi.ocrExtractions(facilityId, visibleJob.id), staffApi.ocrValidations(facilityId, visibleJob.id)])
      .then(([extractionResult, validationResult]) => { if (active) { setExtractions(extractionResult.items); setValidations(validationResult.items) } })
      .catch(caught => { if (active) setError(errorText(caught, 'OCR review evidence could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, visibleJob?.id, canRead, lookupRevision])
  // After a step, focus moves to where the work continues once it has rendered: the
  // job's review evidence is read after the job, and the next step shows only then.
  // While the workspace is locked (hidden and inert) nothing in it can take focus or
  // be heard, so the step waits for it to open. A user who has gone somewhere since
  // the step keeps focus there; the status region still says what was recorded.
  useEffect(() => {
    if (!stepFocus || lock) return
    if (visibleJob && canRead && (extractions === null || validations === null) && !error) return
    const target = stepFocus.targets.map(id => document.getElementById(id)).find(element => element !== null)
    setStepFocus(null)
    if (stepFocus.notice) setNotice(stepFocus.confirmNext && target?.id === 'ocr-confirm-title' ? `${stepFocus.notice} Confirm the source patient next.` : stepFocus.notice)
    if (target && focusIsLost(target)) target.focus()
  }, [stepFocus, lock, visibleJob, canRead, extractions, validations, error])

  // True once the job has been read again.
  async function lookup(event?: FormEvent<HTMLFormElement>): Promise<boolean> {
    event?.preventDefault()
    if (!facilityId || !documentId.trim()) return false
    // A lookup supersedes a step still waiting to move focus; one that follows a step sets it afterwards.
    setStepFocus(null)
    setBusy(true); setError(''); setRetryError(''); setNotice(''); setSearched(false); setExtractions(null); setValidations(null)
    try { const result = await staffApi.findOcrJob(facilityId, documentId.trim()); setJob(result.job); setJobFacilityId(facilityId); setSearched(true); setLookupRevision(value => value + 1); return true }
    catch (caught) { setJob(null); setError(errorText(caught, 'OCR job could not be found.')); return false }
    finally { setBusy(false) }
  }

  // Finding a job keeps focus on Find job, which is disabled while the lookup runs.
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The last answer no longer applies, nor does a field refused before.
    setProblem(null); setError(''); setNotice('')
    const refused = !documentId.trim() ? { field: 'ocr-document', message: 'Enter a document ID.' }
      : !UUID_V4.test(documentId.trim()) ? { field: 'ocr-document', message: 'Enter a valid document ID (a UUID).' } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    await lookup()
    focus('ocr-find-submit', true)
  }

  /** A step recorded, then the job read again: focus and say where the work goes on. */
  async function afterStep(targets: readonly string[], notice: string | undefined, confirmNext = false) {
    const reloaded = await lookup()
    setStepFocus(reloaded ? { targets, notice, confirmNext } : { targets: ['ocr-find-submit'], notice })
  }

  async function create() {
    if (!facilityId) return
    // The last answer no longer applies, nor does a field refused before (setProblem, below).
    setError(''); setNotice('')
    // Create extraction job stays available, so a missing ID is said at its field, which takes focus. The
    // document ID needs no check here: Create is shown only once Find job has taken it, and editing it hides Create.
    const refused = !patientId.trim() ? { field: 'ocr-patient', message: 'Enter the patient ID.' }
      : !UUID_V4.test(patientId.trim()) ? { field: 'ocr-patient', message: 'Enter a valid patient ID (a UUID).' } : null
    setProblem(refused && refusal(refused))
    if (refused) { focus(refused.field); return }
    setBusy(true); setExtractions(null); setValidations(null)
    try {
      const created = await staffApi.createOcrJob(facilityId, documentId.trim(), patientId.trim())
      setJob(created); setJobFacilityId(facilityId); setSearched(true); setLookupRevision(value => value + 1)
      setStepFocus({ targets: ['ocr-job-title'], notice: 'Extraction job created.' })
    }
    catch (caught) { setError(errorText(caught, 'OCR job could not be created.')); focus('ocr-create-submit', true) }
    finally { setBusy(false) }
  }

  async function retry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !visibleJob) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setProblem(null); setRetryError('')
    if (reason.length < 8) { setProblem(refusal({ field: 'ocr-retry-reason', message: 'Enter a reason of at least 8 characters.' })); focus('ocr-retry-reason'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      setJob(await staffApi.retryOcrJob(facilityId, visibleJob, reason)); setLookupRevision(value => value + 1)
      setStepFocus({ targets: ['ocr-job-title'], notice: 'Retry requested.' })
    }
    catch (caught) { setRetryError(errorText(caught, 'OCR job could not be retried.')); focus('ocr-retry-submit', true) }
    finally { setBusy(false) }
  }

  if (!facilityId || !canRead) return <EmptyState titleAs="h1" title="Document OCR unavailable" description="This facility membership needs OCR job read permission." />
  return <>
    <PageHead eyebrow="Governed document processing" title="Document OCR">Find a job by its clinical document ID. The document must be available and virus scan clean before extraction can begin.</PageHead>
    <div className="staff-two-col"><Card className="staff-card"><h2>Find document job</h2><form className="staff-form" noValidate onSubmit={event => void find(event)}><Field label="Document ID" htmlFor="ocr-document" error={problemText(problem, 'ocr-document')} required><Input id="ocr-document" value={documentId} onChange={event => { setDocumentId(event.target.value); setSearched(false); setJob(null); setNotice(''); setProblem(null); setStepFocus(null) }} placeholder="Document UUID" required {...problemProps(problem, 'ocr-document')} /></Field><Button id="ocr-find-submit" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Find job'}</Button></form>
      {searched && !visibleJob && <p className="staff-muted">No OCR job exists for this document.</p>}
      {/* Only after a lookup has answered that no job exists: a failed or missing lookup must not invite a duplicate job. */}
      {searched && !visibleJob && permissions.includes('ocr.job.write') && <div className="staff-stack"><p>Create an extraction job for a verified patient document.</p><Field label="Patient ID" htmlFor="ocr-patient" error={problemText(problem, 'ocr-patient')} required><Input id="ocr-patient" value={patientId} onChange={event => { setPatientId(event.target.value); setProblem(null) }} placeholder="Patient UUID" required {...problemProps(problem, 'ocr-patient')} /></Field><Button id="ocr-create-submit" onClick={() => void create()} disabled={busy}>{busy ? 'Creating…' : 'Create extraction job'}</Button></div>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {/* Mounted throughout, so a message put in it is announced. */}
      <div id="ocr-status" role="status">{notice && <p className="staff-notice">{notice}</p>}</div>
    </Card>
      {visibleJob ? <Card className="staff-card"><h2 id="ocr-job-title" tabIndex={-1}>Job status</h2><div className="staff-row"><Badge tone={visibleJob.status === 'failed' ? 'danger' : visibleJob.status === 'validated' ? 'success' : 'information'}>{visibleJob.status.replaceAll('_', ' ')}</Badge><span className="staff-muted">Version {visibleJob.version ?? 'unknown'}</span></div><p>Provider {visibleJob.provider} · Document {shortId(visibleJob.documentId)}</p>{visibleJob.patientConfirmation && <p>Source patient confirmed {dateText(visibleJob.patientConfirmation.confirmedAt)}</p>}<Button id="ocr-refresh-submit" tone="secondary" size="sm" onClick={() => void lookup().then(reloaded => focus(reloaded ? 'ocr-refresh-submit' : 'ocr-find-submit', true))} disabled={busy}>Refresh status</Button>
        {canRetryJob && permissions.includes('ocr.job.write') && <form className="staff-form" noValidate onSubmit={event => void retry(event)}><Field label="Retry reason" htmlFor="ocr-retry-reason" error={problemText(problem, 'ocr-retry-reason')} required><Textarea id="ocr-retry-reason" name="reason" minLength={8} maxLength={500} required {...problemProps(problem, 'ocr-retry-reason')} /></Field>{retryError && <p className="staff-error" role="alert">{retryError}</p>}<Button id="ocr-retry-submit" size="sm" type="submit" disabled={busy || !visibleJob.version}>{busy ? 'Retrying…' : 'Retry job'}</Button></form>}
        {visibleJob.status === 'failed' && !canRetryJob && <p className="staff-muted">The extraction attempt limit has been reached. This job cannot be retried.</p>}
        {extractions === null && <p className="staff-muted" role="status">Loading extractions…</p>}
        {extractions?.length === 0 && <p className="staff-muted">No extraction is available yet.</p>}
        {extractions?.map(extraction => <div className="staff-list-item" key={extraction.id}><div className="staff-row"><strong>Extraction {extraction.version}</strong><Badge tone="neutral">{extraction.provider}</Badge></div>{extraction.confidence != null && <p>Confidence {Math.round(extraction.confidence * 100)}%</p>}{extraction.rawText && <details><summary>Review extracted text</summary>{/* It scrolls, so it takes focus: a keyboard can then scroll it. */}<pre tabIndex={0} role="region" aria-label={`Extracted text, version ${extraction.version}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflowY: 'auto', fontSize: 12 }}>{extraction.rawText}</pre></details>}</div>)}
      </Card> : <Card className="staff-card"><h2>Document review</h2><p>Use the document ID from an authorized clinical record. OCR jobs are scoped to that source; this backend has no facility-wide OCR job list.</p></Card>}
    </div>
    {visibleJob?.status === 'awaiting_validation' && permissions.includes('ocr.validation.write') && extractions && <div className="staff-section"><OcrReview key={`${visibleJob.id}-${visibleJob.version}`} facilityId={facilityId} job={visibleJob} extractions={extractions} onChanged={disposition => disposition === 'validated'
      ? afterStep(['ocr-confirm-title', 'ocr-job-title'], 'Review recorded.', true)
      : afterStep(['ocr-job-title'], 'Rejection recorded.')} /></div>}
    {visibleJob?.status === 'validated' && !visibleJob.patientConfirmation && permissions.includes('ocr.patient.confirm') && <div className="staff-section"><OcrConfirmation key={`${visibleJob.id}-${visibleJob.version}`} facilityId={facilityId} job={visibleJob} onChanged={async message => {
      // An answer that the job was confirmed already is said only once the job has been read again.
      if (message) { const reloaded = await lookup(); setStepFocus({ targets: reloaded ? ['ocr-history-title', 'ocr-job-title'] : ['ocr-find-submit'], notice: reloaded ? message : undefined }); return }
      await afterStep(['ocr-history-title', 'ocr-job-title'], 'Source patient confirmed.')
    }} /></div>}
    {visibleJob && validations && validations.length > 0 && <div className="staff-section"><h2 id="ocr-history-title" tabIndex={-1}>Review and publication history</h2><div className="staff-list">{validations.map(validation => <OcrPublicationCard key={validation.id} actorId={actorId} facilityId={facilityId} validation={validation} confirmationId={visibleJob.patientConfirmation?.id} permissions={permissions} publicationAttempts={publicationAttempts.current} onChanged={() => afterStep(['ocr-history-title', 'ocr-job-title'], 'Publication recorded.')} />)}</div></div>}
  </>
}

// Identity does not authorize outreach.campaign.write until campaign governance is
// decided (hid-system authorize-outreach.dto.ts, ADR-045): creating a campaign,
// changing its status and adding a member all answer 400, so none is offered.
// Shown only to a role that reads campaigns, which reads their members too.
function CampaignCard({ facilityId, membershipId, campaign, onMembershipChange }: {
  facilityId: string; membershipId: string | undefined; campaign: OutreachCampaign;
  onMembershipChange: (campaignId: string, isMember: boolean) => void
}) {
  const members = useFacilityList(facilityId, true, useCallback(id => staffApi.outreachCampaignMembers(id, campaign.id), [campaign.id]))
  useEffect(() => {
    if (members.items) onMembershipChange(campaign.id, members.items.some(member => member.membershipId === membershipId))
  }, [campaign.id, membershipId, members.items, onMembershipChange])
  return <div className="staff-list-item"><div className="staff-row"><strong>{campaign.name}</strong><Badge tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaign.status}</Badge></div><p>{campaign.services.join(', ')} · Starts {dateText(campaign.startsAt)}</p>
    <details><summary>Members</summary><ListState loading={members.loading} error={members.error} empty="No members" retry={() => void members.refresh()} hasItems={Boolean(members.items?.length)} />{members.items?.map(member => <p key={member.id}>{member.role.replaceAll('_', ' ')} · Membership {shortId(member.membershipId)}</p>)}</details>
  </div>
}

function OutreachCaseCard({ facilityId, item, canLink, onChanged }: { facilityId: string; item: OutreachCase; canLink: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // A link resolves the case, which removes its form: focus goes to the case.
  const focus = useFocusById()
  const problems = useFieldProblems()
  async function linkExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const element = event.currentTarget
    const form = new FormData(element)
    const patientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError(''); problems.clear()
    if (!patientId || reason.length < 8) {
      return problems.refuse(!patientId ? `outreach-patient-${item.id}` : `outreach-reason-${item.id}`, 'Enter a canonical patient ID and a reason of at least 8 characters.')
    }
    setBusy(true); setSuccess('')
    try { await staffApi.linkExistingOutreachCase(facilityId, item, patientId, reason); setSuccess('Existing patient linked.'); await onChanged(); focus(`outreach-case-${item.id}-title`, true) }
    catch (caught) { setError(errorText(caught, 'Patient could not be linked. Verify access and refresh the case.')) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong id={`outreach-case-${item.id}-title`} tabIndex={-1}>{item.fullName ?? 'Registrant'}</strong><Badge tone={item.status === 'identity_resolved' ? 'success' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge></div><p>Case {shortId(item.id)} · {item.ageYears == null ? 'Age not recorded' : `${item.ageYears} years`} · {item.sex ?? 'Unknown'} · {dateText(item.createdAt)}</p>{item.temporaryPatientId && <p>Temporary ID {shortId(item.temporaryPatientId)}</p>}
    {canLink && item.status === 'identity_resolution_pending' && <details><summary>Link verified existing patient</summary><form className="staff-form" onSubmit={event => void linkExisting(event)}><Field label="Canonical patient ID" htmlFor={`outreach-patient-${item.id}`} error={problems.error(`outreach-patient-${item.id}`)} required><Input id={`outreach-patient-${item.id}`} name="patientId" placeholder="Patient UUID" required {...problems.control(`outreach-patient-${item.id}`)} /></Field><Field label="Resolution reason" htmlFor={`outreach-reason-${item.id}`} error={problems.error(`outreach-reason-${item.id}`)} required><Textarea id={`outreach-reason-${item.id}`} name="reason" minLength={8} maxLength={1000} required {...problems.control(`outreach-reason-${item.id}`)} /></Field><p className="staff-muted">The server checks your exact patient authorization and the case version.</p><Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Linking…' : 'Link existing patient'}</Button></form></details>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {/* Mounted throughout, so what was recorded is announced. */}
    <div id={`outreach-case-status-${item.id}`} role="status">{success && <p className="staff-success">{success}</p>}</div>
  </div>
}

export function Outreach() {
  const { facilityId, membershipId, permissions } = useFacilityAccess()
  const canReadCases = permissions.includes('outreach.registration.read')
  const canReadCampaigns = permissions.includes('outreach.campaign.read')
  const campaigns = useFacilityList(facilityId, canReadCampaigns, useCallback(id => staffApi.outreachCampaigns(id), []))
  const cases = useFacilityList(facilityId, canReadCases, useCallback(id => staffApi.outreachCases(id), []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // The case form's refusals, each at its field.
  const caseProblems = useFieldProblems()
  // The case last sent, with its command: its localCommandId (also its Idempotency-Key) and
  // temporary patient ID. Sending the same case again, after a lost answer or a refusal,
  // sends the same command, which Outreach answers with the case it made; a different case,
  // or the next one once this one is created, gets a new command. In memory only.
  const caseAttempt = useRef<{ signature: string; command: { localCommandId: string; temporaryPatientId: string } } | null>(null)
  const [eligibleCampaigns, setEligibleCampaigns] = useState<{ facilityId: string; ids: Set<string> }>({ facilityId: '', ids: new Set() })
  const recordMembership = useCallback((campaignId: string, isMember: boolean) => {
    setEligibleCampaigns(previous => {
      const ids = previous.facilityId === facilityId ? new Set(previous.ids) : new Set<string>()
      if (isMember) ids.add(campaignId)
      else ids.delete(campaignId)
      if (previous.facilityId === facilityId && ids.size === previous.ids.size && ids.has(campaignId) === previous.ids.has(campaignId)) return previous
      return { facilityId: facilityId ?? '', ids }
    })
  }, [facilityId])

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || busy) return
    const element = event.currentTarget
    const form = new FormData(element)
    const campaignId = String(form.get('campaignId') ?? '') || undefined
    const fullName = String(form.get('fullName') ?? '').trim()
    const sex = String(form.get('sex') ?? 'unknown')
    const age = String(form.get('ageYears') ?? '').trim()
    const ageYears = Number(age)
    const phone = String(form.get('phone') ?? '').trim() || undefined
    const operationalNotes = String(form.get('operationalNotes') ?? '').trim() || undefined
    // The last answer no longer applies, nor does a field refused before.
    setError(''); setSuccess(''); caseProblems.clear()
    // The form checks its own fields, in the order shown, as CreateRegistrationCaseDto does. A phone number
    // and operational notes are taken at 3 characters or more, or none, as sent: trimmed, which a native
    // minLength does not check.
    if (!fullName) return caseProblems.refuse('outreach-case-name', 'Enter the registrant\'s full name.')
    if (!age || !Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) return caseProblems.refuse('outreach-case-age', 'Enter an age in whole years, from 0 to 130.')
    if (phone !== undefined && phone.length < 3) return caseProblems.refuse('outreach-case-phone', 'Enter a phone number of at least 3 characters, or leave it blank.')
    if (operationalNotes !== undefined && operationalNotes.length < 3) return caseProblems.refuse('outreach-case-notes', 'Enter operational notes of at least 3 characters, or leave them blank.')
    const input = { campaignId, fullName, sex, ageYears, phone, operationalNotes }
    const signature = JSON.stringify([facilityId, input])
    if (caseAttempt.current?.signature !== signature) {
      caseAttempt.current = { signature, command: { localCommandId: crypto.randomUUID(), temporaryPatientId: `tmp_${crypto.randomUUID()}` } }
    }
    setBusy(true)
    try { await staffApi.createOutreachCase(facilityId, input, caseAttempt.current.command); caseAttempt.current = null; setSuccess('Registration case created for identity resolution.'); element.reset(); await cases.refresh() }
    catch (caught) { setError(errorText(caught, 'Registration case could not be created.')) }
    finally { setBusy(false) }
  }

  if (!facilityId || (!canReadCases && !canReadCampaigns)) return <EmptyState titleAs="h1" title="Outreach unavailable" description="This facility membership needs outreach campaign or registration read permission." />
  return <>
    <PageHead eyebrow="Community care" title="Outreach">View facility campaigns and manage registration cases. A temporary registration is pending identity resolution until the backend links it to a verified patient.</PageHead>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {/* Mounted throughout, so what was created is announced. */}
    <div id="outreach-status" role="status">{success && <p className="staff-success">{success}</p>}</div>
    <div className="staff-two-col"><div className="staff-stack">
      {canReadCampaigns && <Card className="staff-card"><div className="staff-row"><h2>Campaigns</h2><RefreshButton loading={campaigns.loading} onRefresh={campaigns.refresh}>Refresh</RefreshButton></div><p className="staff-notice">Campaign management is not yet available. Campaigns and their members can be viewed here, but not created, activated, closed or given members.</p><ListState loading={campaigns.loading} error={campaigns.error} empty="No campaigns" retry={() => void campaigns.refresh()} hasItems={Boolean(campaigns.items?.length)} />{campaigns.items?.map((campaign: OutreachCampaign) => <CampaignCard key={campaign.id} facilityId={facilityId} membershipId={membershipId} campaign={campaign} onMembershipChange={recordMembership} />)}</Card>}
    </div><div className="staff-stack">
      {canReadCases && <Card className="staff-card"><div className="staff-row"><h2>Registration cases</h2><RefreshButton loading={cases.loading} onRefresh={cases.refresh}>Refresh</RefreshButton></div><ListState loading={cases.loading} error={cases.error} empty="No registration cases" retry={() => void cases.refresh()} hasItems={Boolean(cases.items?.length)} />{cases.items?.map((item: OutreachCase) => <OutreachCaseCard key={item.id} facilityId={facilityId} item={item} canLink={permissions.includes('outreach.registration.write')} onChanged={cases.refresh} />)}</Card>}
      {permissions.includes('outreach.registration.write') && <Card className="staff-card"><h2>New registration case</h2><form className="staff-form" noValidate onSubmit={event => void createCase(event)}>{canReadCampaigns && <Field label="Campaign" htmlFor="outreach-case-campaign" hint="Only active registration campaigns containing your facility membership appear here. A case may also be created without a campaign."><Select id="outreach-case-campaign" name="campaignId"><option value="">No campaign</option>{campaigns.items?.filter(campaign => campaign.status === 'active' && campaign.services.includes('registration') && eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id)).map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>}<Field label="Full name" htmlFor="outreach-case-name" error={caseProblems.error('outreach-case-name')} required><Input id="outreach-case-name" name="fullName" maxLength={200} required {...caseProblems.control('outreach-case-name')} /></Field><div className="staff-form-row"><Field label="Sex" htmlFor="outreach-case-sex" required><Select id="outreach-case-sex" name="sex" required><option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></Field><Field label="Age (years)" htmlFor="outreach-case-age" error={caseProblems.error('outreach-case-age')} required><Input id="outreach-case-age" name="ageYears" type="number" min="0" max="130" required {...caseProblems.control('outreach-case-age')} /></Field></div><Field label="Phone (optional)" htmlFor="outreach-case-phone" error={caseProblems.error('outreach-case-phone')}><Input id="outreach-case-phone" name="phone" minLength={3} maxLength={32} {...caseProblems.control('outreach-case-phone')} /></Field><Field label="Operational notes" htmlFor="outreach-case-notes" error={caseProblems.error('outreach-case-notes')}><Textarea id="outreach-case-notes" name="operationalNotes" minLength={3} maxLength={2000} {...caseProblems.control('outreach-case-notes')} /></Field><Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Creating…' : 'Create case'}</Button></form></Card>}
    </div></div>
  </>
}

export function MigrateGap() {
  return <>
    <PageHead eyebrow="HID Migrate" title="Migration workspace">The approved backend snapshot supports document OCR jobs tied to authorized clinical documents. It does not yet expose a project, bulk import, matching queue, or completed migration index.</PageHead>
    <EmptyState title="Project migration requires backend support" description="You can process an eligible clinical document in Document OCR. Bulk migration needs governed project and reconciliation APIs before its controls can safely be enabled." action={<Link className="staff-text-link" to="/provider/ocr">Open document OCR →</Link>} />
  </>
}
