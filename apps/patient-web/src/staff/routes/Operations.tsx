import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@hid/ui'
import { staffApi, type LabAbnormalFlag, type LabAccession, type LabExecution, type LabResult, type LabResultRevision, type LabResultValue, type LabSpecimen, type LabWorkItem, type OcrExtraction, type OcrJob, type OcrPublication, type OcrTargetDomain, type OcrValidation, type OutreachCampaign, type OutreachCampaignMember, type OutreachCase, type PharmacyWorkItem } from '../api'
import { useStaff } from '../App'

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const specimenType = String(form.get('specimenType') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    if (!specimenType || !reason) return setError('Enter a specimen type and clinical reason.')
    setBusy(true); setError('')
    try { onCreated(await staffApi.createLabAccession(facilityId, item.id, specimenType, reason)) }
    catch (caught) { setError(errorText(caught, 'Accession could not be created.')) }
    finally { setBusy(false) }
  }
  return <Card className="staff-card"><h2>Create specimen accession</h2><p>{item.testName ?? 'Accepted lab order'} · Patient {shortId(item.patientId)}</p><form className="staff-form" onSubmit={event => void submit(event)}>
    <Field label="Specimen type" htmlFor="lab-specimen-type" required><Input id="lab-specimen-type" name="specimenType" maxLength={240} placeholder="Blood, urine, swab…" required /></Field>
    <Field label="Reason" htmlFor="lab-accession-reason" required><Textarea id="lab-accession-reason" name="reason" maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create accession'}</Button>
  </form></Card>
}

type SpecimenActionKind = 'collect' | 'receive' | 'reject'

function SpecimenAction({ facilityId, accessionId, specimen, permissions, onChanged, onRefused }: { facilityId: string; accessionId: string; specimen: LabSpecimen; permissions: string[]; onChanged: () => void; onRefused: (error: unknown) => void }) {
  const actions: SpecimenActionKind[] = specimen.status === 'required'
    ? ['collect', 'reject'] : specimen.status === 'collected' ? ['receive', 'reject'] : []
  const allowed = actions.filter(action => permissions.includes(`lab.specimen.${action}`))
  const [action, setAction] = useState<SpecimenActionKind>(allowed[0] ?? 'collect')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const detail = String(new FormData(event.currentTarget).get('detail') ?? '').trim()
    if (action === 'reject' && !detail) return setError('Enter a rejection reason.')
    setBusy(true); setError('')
    try { await staffApi.transitionSpecimen(facilityId, accessionId, specimen, action, detail); onChanged() }
    catch (caught) { setError(errorText(caught, 'Specimen could not be updated. Refresh and try again.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong>{specimen.specimenType} · {specimen.specimenIdentifier}</strong><Badge tone={specimen.status === 'received' ? 'success' : specimen.status === 'rejected' ? 'danger' : 'warning'}>{specimen.status}</Badge></div>
    {allowed.length > 0 && <form className="staff-form" onSubmit={event => void submit(event)}>
      <Field label="Next step" htmlFor={`lab-action-${specimen.id}`}><Select id={`lab-action-${specimen.id}`} value={action} onChange={event => setAction(event.target.value as SpecimenActionKind)}>{allowed.map(value => <option key={value} value={value}>{value === 'collect' ? 'Mark collected' : value === 'receive' ? 'Mark received' : 'Reject specimen'}</option>)}</Select></Field>
      <Field label={action === 'reject' ? 'Rejection reason' : 'Notes or condition'} htmlFor={`lab-detail-${specimen.id}`} required={action === 'reject'}><Input id={`lab-detail-${specimen.id}`} name="detail" maxLength={action === 'collect' ? 1000 : 500} required={action === 'reject'} /></Field>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Record step'}</Button>
    </form>}
  </div>
}

const abnormalFlags: readonly LabAbnormalFlag[] = ['unknown', 'normal', 'high', 'low', 'abnormal', 'critical_candidate']

function resultValue(form: FormData, resultType: 'numeric' | 'text'): LabResultValue {
  const unit = String(form.get('unit') ?? '').trim()
  const referenceRange = String(form.get('referenceRange') ?? '').trim()
  const flag = String(form.get('abnormalFlag') ?? 'unknown')
  if (!abnormalFlags.includes(flag as LabAbnormalFlag)) throw new Error('Choose a valid result flag.')
  const shared = {
    ...(unit ? { unit } : {}), ...(referenceRange ? { referenceRange } : {}),
    abnormalFlag: flag as LabAbnormalFlag,
  }
  if (resultType === 'numeric') {
    const raw = String(form.get('numericValue') ?? '').trim()
    if (!raw || !Number.isFinite(Number(raw))) throw new Error('Enter a valid numeric result.')
    return { resultType, numericValue: Number(raw), ...shared }
  }
  const textValue = String(form.get('textValue') ?? '').trim()
  if (!textValue) throw new Error('Enter the text result.')
  return { resultType, textValue, ...shared }
}

function ResultEntry({ facilityId, execution, result, onChanged, onRefused }: {
  facilityId: string; execution: LabExecution; result: LabResult | null;
  onChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  const [resultType, setResultType] = useState<'numeric' | 'text'>(current?.resultType ?? 'numeric')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    let value: LabResultValue
    try { value = resultValue(form, resultType) }
    catch (caught) { setError(errorText(caught, 'Enter a valid result.')); return }
    const reason = String(form.get('reason') ?? '').trim()
    if (result && !reason) return setError('Explain the correction or amendment.')
    setBusy(true)
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
        ? <Field label="Numeric value" htmlFor={`lab-numeric-${execution.id}`} required><Input id={`lab-numeric-${execution.id}`} name="numericValue" type="number" step="any" defaultValue={current?.resultType === 'numeric' ? current.numericValue ?? '' : ''} required /></Field>
        : <Field label="Text value" htmlFor={`lab-text-${execution.id}`} required><Textarea id={`lab-text-${execution.id}`} name="textValue" maxLength={4000} defaultValue={current?.resultType === 'text' ? current.textValue ?? '' : ''} required /></Field>}
      <div className="staff-form-row">
        <Field label="Unit" htmlFor={`lab-unit-${execution.id}`}><Input id={`lab-unit-${execution.id}`} name="unit" maxLength={80} defaultValue={current?.unit ?? ''} /></Field>
        <Field label="Reference range" htmlFor={`lab-range-${execution.id}`}><Input id={`lab-range-${execution.id}`} name="referenceRange" maxLength={240} defaultValue={current?.referenceRange ?? ''} /></Field>
      </div>
      <Field label="Abnormal flag" htmlFor={`lab-flag-${execution.id}`}><Select id={`lab-flag-${execution.id}`} name="abnormalFlag" defaultValue={current?.abnormalFlag ?? 'unknown'}>{abnormalFlags.map(flag => <option key={flag} value={flag}>{flag.replaceAll('_', ' ')}</option>)}</Select></Field>
      {result && <><Field label="Revision type" htmlFor={`lab-revision-kind-${execution.id}`}><Select id={`lab-revision-kind-${execution.id}`} name="revisionKind"><option value="correction">Correction</option><option value="amendment">Amendment</option></Select></Field><Field label="Reason" htmlFor={`lab-result-reason-${execution.id}`} required><Textarea id={`lab-result-reason-${execution.id}`} name="reason" maxLength={500} required /></Field></>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Recording…' : result ? 'Record new revision' : 'Record unverified result'}</Button>
    </form>
  </details>
}

function ResultGovernance({ facilityId, result, action, onChanged, onRefused }: {
  facilityId: string; result: LabResult; action: 'verify' | 'release';
  onChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (!reason) return setError('Enter a reason for this decision.')
    setBusy(true); setError('')
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
    <Field label={`${action === 'verify' ? 'Verification' : 'Release'} reason`} htmlFor={`lab-${action}-reason-${result.id}`} required><Textarea id={`lab-${action}-reason-${result.id}`} name="reason" maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" size="sm" disabled={busy}>{busy ? 'Recording…' : action === 'verify' ? 'Verify result version' : 'Release result version'}</Button>
  </form>
}

function RevisionList({ revisions }: { revisions: LabResultRevision[] }) {
  return <div className="staff-list">{revisions.map(revision => <div className="staff-list-item" key={revision.version}>
    <div className="staff-row"><strong>Version {revision.version}</strong><Badge tone={revision.releaseStatus === 'released' ? 'success' : 'warning'}>{revision.releaseStatus.replaceAll('_', ' ')}</Badge></div>
    <p>{revision.resultType === 'numeric' ? revision.numericValue == null ? 'Not recorded' : `${revision.numericValue} ${revision.unit ?? ''}` : revision.textValue ?? 'Not recorded'} · {revision.abnormalFlag.replaceAll('_', ' ')}</p>
    <p>Entered {dateText(revision.enteredAt)} · {revision.verificationStatus.replaceAll('_', ' ')}</p>
    {revision.referenceRange && <p>Reference range: {revision.referenceRange}</p>}
    {revision.correctionReason && <p>Reason: {revision.correctionReason}</p>}
  </div>)}</div>
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
  return <div className="staff-stack"><Button tone="secondary" size="sm" onClick={() => setOpen(value => !value)}>{open ? 'Hide result history' : 'View result history'}</Button>
    {open && <><Button tone="secondary" size="sm" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh history</Button>
      {loading && <p role="status">Loading result history…</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {!loading && !error && history && <RevisionList revisions={history.revisions} />}
    </>}
  </div>
}

function ExecutionCard({ facilityId, execution, permissions, onExecutionChanged, onResultChanged, onRefused }: {
  facilityId: string; execution: LabExecution; permissions: string[];
  onExecutionChanged: (value: LabExecution, message: string) => void;
  onResultChanged: (value: LabResult, message: string) => void; onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = execution.result
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim()
    setBusy(true); setError('')
    try { onExecutionChanged(await staffApi.completeLabExecution(facilityId, execution, notes), 'Analytical execution was completed.') }
    catch (caught) { setError(errorText(caught, 'Execution could not be completed. Refresh before retrying.')); onRefused(caught) }
    finally { setBusy(false) }
  }
  const canCorrect = Boolean(result && permissions.includes('lab.result.correct') &&
    (result.currentReleasedVersion !== result.currentVersion || permissions.includes('lab.result.revise-released')))
  return <div className="staff-list-item staff-stack">
    <div className="staff-row"><strong>{execution.test.name} · {execution.test.codeSystem} {execution.test.code}</strong><Badge tone={execution.status === 'completed' ? 'success' : 'information'}>{execution.status.replaceAll('_', ' ')}</Badge></div>
    <p>Started {dateText(execution.startedAt)}{execution.completedAt ? ` · Completed ${dateText(execution.completedAt)}` : ''} · Version {execution.version}</p>
    {execution.method && <p>Method: {execution.method}</p>}
    {execution.status === 'in_progress' && permissions.includes('lab.execution.complete') && <form className="staff-form" onSubmit={event => void complete(event)}><Field label="Completion notes" htmlFor={`lab-completion-${execution.id}`}><Textarea id={`lab-completion-${execution.id}`} name="notes" maxLength={1000} /></Field><Button type="submit" size="sm" disabled={busy}>{busy ? 'Completing…' : 'Complete execution'}</Button></form>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {execution.status === 'completed' && !result && permissions.includes('lab.result.enter') && <ResultEntry facilityId={facilityId} execution={execution} result={null} onChanged={onResultChanged} onRefused={onRefused} />}
    {result && <><div className="staff-row"><strong>Manual result · version {result.currentVersion}</strong><Badge tone={result.status === 'released' ? 'success' : 'warning'}>{result.status.replaceAll('_', ' ')}</Badge></div>
      {current && <p>{current.resultType === 'numeric' ? current.numericValue == null ? 'Not recorded' : `${current.numericValue} ${current.unit ?? ''}` : current.textValue ?? 'Not recorded'} · {current.abnormalFlag.replaceAll('_', ' ')}</p>}
      {canCorrect && <ResultEntry key={`${result.id}-${result.currentVersion}`} facilityId={facilityId} execution={execution} result={result} onChanged={onResultChanged} onRefused={onRefused} />}
      {result.status === 'entered_unverified' && permissions.includes('lab.result.verify') && <ResultGovernance facilityId={facilityId} result={result} action="verify" onChanged={onResultChanged} onRefused={onRefused} />}
      {result.status === 'verified_not_released' && permissions.includes('lab.result.release') && <ResultGovernance facilityId={facilityId} result={result} action="release" onChanged={onResultChanged} onRefused={onRefused} />}
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

function ExecutionPanel({ facilityId, specimen, permissions, recheck, resultsHidden, onResultsHidden }: {
  facilityId: string; specimen: LabSpecimen; permissions: string[];
  recheck: LabResultsSignal | null; resultsHidden: LabResultsSignal | null; onResultsHidden: (reason: LabResultsHiddenReason) => void
}) {
  const canRead = permissions.includes('lab.execution.read')
  const canStart = permissions.includes('lab.execution.start')
  const [items, setItems] = useState<LabExecution[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [startError, setStartError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  // Each execution-list request is numbered. Hiding the results retires every request
  // already in flight, so an answer that arrives later cannot bring values back.
  const request = useRef(0)
  const hidden = useRef(false)
  const hideResults = useCallback((reason: LabResultsHiddenReason) => {
    request.current += 1; hidden.current = true
    setItems(null); setNotice(''); setStartError(''); setLoading(false); setError(LAB_RESULTS_HIDDEN[reason])
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
    setLoading(true); setError('')
    void staffApi.labExecutions(facilityId, specimen.id)
      .then(value => {
        if (request.current !== current) return
        hidden.current = false; setItems(value.items); setLoading(false)
      })
      // Only a successful read confirms access, so any failure hides what is on screen.
      .catch(caught => { if (request.current === current) endAccess(labResultsReadDoubt(caught) ?? 'unverified') })
    return () => { request.current += 1 }
  }, [canRead, facilityId, specimen.id, revision, recheck, endAccess])
  // A failed action may only refuse that write (for example under break-glass), or may
  // mean read access ended or cannot be confirmed. Reload to find out: a failed reload
  // hides the values. Without lab.execution.read there is no reload, so hide at once.
  const recheckAccess = useCallback((caught: unknown) => {
    const doubt = labResultsReadDoubt(caught)
    if (!doubt) return
    if (canRead) setRevision(current => current + 1)
    else endAccess(doubt)
  }, [canRead, endAccess])
  // An action that answers after the results were hidden must not bring them back.
  function changedExecution(value: LabExecution, message: string) {
    if (hidden.current) return
    setItems(previous => [...(previous ?? []).filter(item => item.id !== value.id), value])
    setNotice(message)
    if (canRead) setRevision(current => current + 1)
  }
  function changedResult(executionId: string, value: LabResult, message: string) {
    if (hidden.current) return
    setItems(previous => previous?.map(item => item.id === executionId ? { ...item, result: value } : item) ?? null)
    setNotice(message)
    if (canRead) setRevision(current => current + 1)
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    const method = String(form.get('method') ?? '').trim()
    if (!reason) return setStartError('Enter a reason to begin execution.')
    setBusy(true); setStartError(''); setNotice('')
    try { changedExecution(await staffApi.startLabExecution(facilityId, specimen, reason, method), 'Analytical execution started.') }
    catch (caught) { setStartError(errorText(caught, 'Execution could not be started. Refresh the specimen first.')); recheckAccess(caught) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item staff-stack"><h3>Analytical execution</h3>
    {loading && <p role="status">Loading executions…</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {notice && <p className="staff-success" role="status">{notice}</p>}
    {canRead && <Button tone="secondary" size="sm" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh executions</Button>}
    {items?.map(execution => <ExecutionCard key={execution.id} facilityId={facilityId} execution={execution} permissions={permissions}
      onExecutionChanged={changedExecution} onResultChanged={(value, message) => changedResult(execution.id, value, message)} onRefused={recheckAccess} />)}
    {canStart && !loading && !error && (items?.length === 0 || (!canRead && !items)) && <form className="staff-form" onSubmit={event => void start(event)}>
      <p className="staff-muted">Begin analysis for this received specimen. The backend checks the exact specimen version and patient authorization.</p>
      <Field label="Method" htmlFor={`lab-method-${specimen.id}`}><Input id={`lab-method-${specimen.id}`} name="method" maxLength={240} /></Field>
      <Field label="Reason" htmlFor={`lab-start-reason-${specimen.id}`} required><Textarea id={`lab-start-reason-${specimen.id}`} name="reason" maxLength={500} required /></Field>
      {startError && <p className="staff-error" role="alert">{startError}</p>}
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Starting…' : 'Start execution'}</Button>
    </form>}
    {canRead && !loading && !error && items?.length === 0 && !canStart && <p className="staff-muted">No execution has started for this specimen.</p>}
  </div>
}

function AccessionView({ facilityId, id, permissions, onChanged }: { facilityId: string; id: string; permissions: string[]; onChanged: () => void }) {
  // An accession is shown only for the reload it came from, so a reload removes every
  // specimen row at once and each panel reads its results once, when it mounts again.
  const [loaded, setLoaded] = useState<{ revision: number; accession: LabAccession } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [recheck, setRecheck] = useState<LabResultsSignal | null>(null)
  const [resultsHidden, setResultsHidden] = useState<LabResultsSignal | null>(null)
  const accession = loaded?.revision === revision ? loaded.accession : null
  const reload = useCallback(() => { setRevision(value => value + 1); setRecheck(null); setResultsHidden(null) }, [])
  // A new signal for every hide, so a panel restored by its own refresh hides again.
  const hideResults = useCallback((reason: LabResultsHiddenReason) =>
    setResultsHidden(previous => ({ reason, seq: (previous?.seq ?? 0) + 1 })), [])
  // A specimen step that fails with a doubt re-checks in place: the accession is read
  // again and every panel re-reads its results, while the step keeps its error and input.
  // A failed read hides the results as usual; a failed accession read removes it all.
  const specimenRefused = useCallback((caught: unknown) => {
    const doubt = labResultsReadDoubt(caught)
    if (doubt) setRecheck(previous => ({ reason: doubt, seq: (previous?.seq ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    let active = true
    setError(''); setLoading(true)
    void staffApi.labAccession(facilityId, id).then(value => { if (active) setLoaded({ revision, accession: value }) })
      .catch(caught => { if (active) { setLoaded(null); setError(errorText(caught, 'Accession could not be loaded.')) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, id, revision, recheck])
  return <Card className="staff-card"><h2>Specimen accession</h2>
    {loading && <p role="status">Loading accession…</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {accession && <><p>Accession {accession.accessionNumber}</p><div className="staff-list">{accession.specimens.map(specimen => <div className="staff-stack" key={`${specimen.id}-${specimen.status}`}><SpecimenAction facilityId={facilityId} accessionId={id} specimen={specimen} permissions={permissions} onChanged={() => { reload(); onChanged() }} onRefused={specimenRefused} />{specimen.status === 'received' && (permissions.includes('lab.execution.read') || permissions.includes('lab.execution.start')) && <ExecutionPanel facilityId={facilityId} specimen={specimen} permissions={permissions} recheck={recheck} resultsHidden={resultsHidden} onResultsHidden={hideResults} />}</div>)}</div></>}
    <div className="staff-row"><Button tone="secondary" size="sm" onClick={reload} disabled={loading}>Refresh accession</Button></div>
  </Card>
}

export function Laboratory() {
  const { facilityId, permissions } = useFacilityAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const list = useFacilityList(facilityId, canRead, useCallback(async id => (await staffApi.labWorkItems(id)).items, []))
  const [selection, setSelection] = useState<{ facilityId: string; item: LabWorkItem } | null>(null)
  const selected = selection && selection.facilityId === facilityId ? selection.item : null
  if (!facilityId || !canRead) return <EmptyState title="Laboratory unavailable" description="This facility membership needs lab work-item read permission." />
  return <>
    <PageHead eyebrow="Provider workspace" title="Laboratory">Accepted EHR test orders at this facility. A separate accession records the specimen chain of custody.</PageHead>
    <div className="staff-row staff-toolbar"><Button tone="secondary" size="sm" onClick={() => void list.refresh()} disabled={list.loading}>Refresh work</Button></div>
    <ListState loading={list.loading} error={list.error} empty="No accepted lab work" retry={() => void list.refresh()} hasItems={Boolean(list.items?.length)} />
    {list.items && list.items.length > 0 && <div className="staff-two-col"><div className="staff-list">{list.items.map(item => <div className="staff-list-item" key={item.id}><div className="staff-row"><strong>{item.testName ?? 'Lab test'}</strong><Badge tone={item.accessionId ? 'information' : 'warning'}>{item.accessionId ? 'Accessioned' : item.status}</Badge></div><p>Patient {shortId(item.patientId)} · Accepted {dateText(item.acceptedAt)}</p>{item.accessionNumber && <p>Accession {item.accessionNumber}</p>}{(item.accessionId ? permissions.includes('lab.accession.read') : permissions.includes('lab.accession.create')) && <Button tone="secondary" size="sm" onClick={() => setSelection({ facilityId, item })}>{item.accessionId ? 'Open accession' : 'Prepare accession'}</Button>}</div>)}</div>
      {selected?.accessionId && permissions.includes('lab.accession.read') ? <AccessionView key={`${facilityId}-${selected.accessionId}`} facilityId={facilityId} id={selected.accessionId} permissions={permissions} onChanged={() => void list.refresh()} /> : selected && permissions.includes('lab.accession.create') ? <AccessionForm facilityId={facilityId} item={selected} onCreated={accession => { setSelection({ facilityId, item: { ...selected, accessionId: accession.id, accessionNumber: accession.accessionNumber } }); void list.refresh() }} /> : <Card className="staff-card"><h2>Choose work</h2><p>Open an accession or prepare a specimen for an accepted order.</p></Card>}
    </div>}
  </>
}

function PharmacyAction({ facilityId, item, permissions, onChanged }: { facilityId: string; item: PharmacyWorkItem; permissions: string[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>, reverse = false) {
    event.preventDefault(); setError(''); setSuccess('')
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) return setError('Enter a reason of at least 8 characters.')
    setBusy(true)
    try {
      if (reverse) {
        if (!item.dispensing) throw new Error('No dispensing is available to reverse.')
        const current = await staffApi.dispensing(facilityId, item.dispensing.id)
        await staffApi.reverseDispensing(facilityId, current.id, current.version, reason)
        setSuccess('Dispensing reversal recorded.')
      } else {
        const quantity = Number(form.get('quantity'))
        const unit = String(form.get('unit') ?? '').trim()
        if (!Number.isFinite(quantity) || quantity <= 0 || !unit) throw new Error('Enter a positive quantity and unit.')
        await staffApi.dispense(facilityId, item, quantity, unit, reason)
        setSuccess('Dispensing recorded.')
      }
      onChanged()
    } catch (caught) { setError(errorText(caught, 'Pharmacy action could not be recorded.')) }
    finally { setBusy(false) }
  }
  const canDispense = !item.dispensing && permissions.includes('pharmacy.dispensing.create')
  const canReverse = Boolean(item.dispensing && !item.dispensing.reversed && permissions.includes('pharmacy.dispensing.reverse') && permissions.includes('pharmacy.dispensing.read'))
  return <div className="staff-list-item"><div className="staff-row"><strong>{item.medication.display}</strong><Badge tone={item.dispensing?.reversed ? 'warning' : item.dispensing ? 'success' : 'information'}>{item.dispensing?.reversed ? 'Reversed' : item.dispensing ? 'Dispensed' : 'Accepted'}</Badge></div><p>Patient {shortId(item.patientId)} · {item.doseQuantity == null ? 'Dose not recorded' : `${item.doseQuantity} ${item.doseUnit ?? ''}`} · {item.frequency ?? 'Frequency not recorded'}</p>
    {canDispense && <form className="staff-form" onSubmit={event => void submit(event)}><div className="staff-form-row"><Field label="Quantity dispensed" htmlFor={`pharmacy-quantity-${item.id}`} required><Input id={`pharmacy-quantity-${item.id}`} name="quantity" type="number" min="0.0001" step="0.0001" required /></Field><Field label="Unit" htmlFor={`pharmacy-unit-${item.id}`} required><Input id={`pharmacy-unit-${item.id}`} name="unit" maxLength={80} defaultValue={item.doseUnit ?? ''} required /></Field></div><Field label="Reason" htmlFor={`pharmacy-reason-${item.id}`} required><Textarea id={`pharmacy-reason-${item.id}`} name="reason" minLength={8} maxLength={500} required /></Field><Button type="submit" size="sm" disabled={busy}>{busy ? 'Recording…' : 'Record full dispensing'}</Button></form>}
    {canReverse && <form className="staff-form" onSubmit={event => void submit(event, true)}><Field label="Reversal reason" htmlFor={`pharmacy-reversal-${item.id}`} required><Textarea id={`pharmacy-reversal-${item.id}`} name="reason" minLength={8} maxLength={500} required /></Field><Button type="submit" tone="secondary" size="sm" disabled={busy}>{busy ? 'Recording…' : 'Reverse dispensing'}</Button></form>}
    {error && <p className="staff-error" role="alert">{error}</p>}{success && <p className="staff-success" role="status">{success}</p>}
  </div>
}

export function Pharmacy() {
  const { facilityId, permissions } = useFacilityAccess()
  const canRead = permissions.includes('pharmacy.work-item.read')
  const list = useFacilityList(facilityId, canRead, useCallback(async id => (await staffApi.pharmacyWorkItems(id)).items, []))
  if (!facilityId || !canRead) return <EmptyState title="Pharmacy unavailable" description="This facility membership needs pharmacy work-item read permission." />
  return <>
    <PageHead eyebrow="Provider workspace" title="Pharmacy">Accepted prescriptions and full dispensing records for the active facility. The server checks patient authorization before dispensing or reversal.</PageHead>
    <div className="staff-row staff-toolbar"><Button tone="secondary" size="sm" onClick={() => void list.refresh()} disabled={list.loading}>Refresh work</Button></div>
    <ListState loading={list.loading} error={list.error} empty="No accepted prescriptions" retry={() => void list.refresh()} hasItems={Boolean(list.items?.length)} />
    {list.items && list.items.length > 0 && <div className="staff-list">{list.items.map(item => <PharmacyAction key={item.id} facilityId={facilityId} item={item} permissions={permissions} onChanged={() => void list.refresh()} />)}</div>}
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

function jsonObject(value: FormDataEntryValue | null, label: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new Error(`${label} must be valid JSON.`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

function jsonObjectArray(value: FormDataEntryValue | null, label: string): Record<string, unknown>[] {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new Error(`${label} must be valid JSON.`) }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`${label} must be a JSON array of objects.`)
  return parsed as Record<string, unknown>[]
}

function OcrReview({ facilityId, job, extractions, onChanged }: { facilityId: string; job: OcrJob; extractions: OcrExtraction[]; onChanged: () => Promise<void> }) {
  const [extractionId, setExtractionId] = useState(extractions.at(-1)?.id ?? '')
  const [disposition, setDisposition] = useState<'validated' | 'rejected'>('validated')
  const [domain, setDomain] = useState<OcrTargetDomain>('DOCUMENT_ONLY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = extractions.find(item => item.id === extractionId)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) return setError('Enter a review reason of at least 8 characters.')
    if (!selected) return setError('Choose an extraction to review.')
    setBusy(true); setError('')
    try {
      const targetDomain = disposition === 'rejected' ? 'UNCLASSIFIED' : domain
      await staffApi.validateOcrJob(facilityId, job, {
        extractionId: selected.id,
        validatedPayload: jsonObject(form.get('validatedPayload'), 'Reviewed payload'),
        acceptedFields: jsonObject(form.get('acceptedFields'), 'Accepted fields'),
        rejectedFields: jsonObjectArray(form.get('rejectedFields'), 'Rejected fields'),
        corrections: jsonObjectArray(form.get('corrections'), 'Corrections'),
        disposition, targetDomain, candidateType: candidateTypes[targetDomain], reason,
      })
      await onChanged()
    } catch (caught) { setError(errorText(caught, 'Review could not be recorded. Refresh the job and try again.')) }
    finally { setBusy(false) }
  }
  if (!extractions.length) return <p className="staff-muted">An extraction must be available before review.</p>
  return <Card className="staff-card"><h2>Review extraction</h2><p>Inspect the source text and explicitly classify the candidate. Only validated evidence can be published.</p><form className="staff-form" onSubmit={event => void submit(event)}>
    <Field label="Extraction" htmlFor="ocr-review-extraction"><Select id="ocr-review-extraction" value={extractionId} onChange={event => setExtractionId(event.target.value)}>{extractions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.provider}</option>)}</Select></Field>
    <Field label="Review decision" htmlFor="ocr-review-decision"><Select id="ocr-review-decision" value={disposition} onChange={event => setDisposition(event.target.value as 'validated' | 'rejected')}><option value="validated">Validate candidate</option><option value="rejected">Reject candidate</option></Select></Field>
    {disposition === 'validated' && <Field label="Owning domain" htmlFor="ocr-review-domain"><Select id="ocr-review-domain" value={domain} onChange={event => setDomain(event.target.value as OcrTargetDomain)}><option value="DOCUMENT_ONLY">Retain validated document</option><option value="EHR">Clinical note</option><option value="LAB">Historical lab evidence</option><option value="PHARMACY">Historical medication evidence</option></Select></Field>}
    <Field label="Reviewed payload (JSON object)" htmlFor="ocr-reviewed-payload" required><Textarea key={`payload-${selected?.id}`} id="ocr-reviewed-payload" name="validatedPayload" rows={7} spellCheck={false} defaultValue={JSON.stringify(selected?.structuredPayload && typeof selected.structuredPayload === 'object' && !Array.isArray(selected.structuredPayload) ? selected.structuredPayload : {}, null, 2)} required /></Field>
    <Field label="Accepted fields (JSON object)" htmlFor="ocr-accepted-fields" required><Textarea id="ocr-accepted-fields" name="acceptedFields" rows={6} spellCheck={false} defaultValue="{}" required /></Field>
    <p className="staff-muted">EHR requires encounterId, noteType, title, and content. Lab requires observations. Pharmacy requires medicationText. Document retention can use an empty object.</p>
    <div className="staff-form-row"><Field label="Rejected fields (JSON array)" htmlFor="ocr-rejected-fields" required><Textarea id="ocr-rejected-fields" name="rejectedFields" spellCheck={false} defaultValue="[]" required /></Field><Field label="Corrections (JSON array)" htmlFor="ocr-corrections" required><Textarea id="ocr-corrections" name="corrections" spellCheck={false} defaultValue="[]" required /></Field></div>
    <Field label="Review reason" htmlFor="ocr-review-reason" required><Textarea id="ocr-review-reason" name="reason" minLength={8} maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Recording review…' : disposition === 'rejected' ? 'Reject extraction' : 'Validate extraction'}</Button>
  </form></Card>
}

function OcrConfirmation({ facilityId, job, onChanged }: { facilityId: string; job: OcrJob; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const patientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) return setError('Enter a patient confirmation reason of at least 8 characters.')
    setBusy(true); setError('')
    try { await staffApi.confirmOcrPatient(facilityId, job, patientId, reason); await onChanged() }
    catch (caught) { setError(errorText(caught, 'Patient confirmation could not be recorded.')) }
    finally { setBusy(false) }
  }
  return <Card className="staff-card"><h2>Confirm source patient</h2><p>Confirm the canonical patient against the clinical source document before publication. The backend verifies an exact match and write authorization.</p><form className="staff-form" onSubmit={event => void submit(event)}><Field label="Canonical patient ID" htmlFor="ocr-confirm-patient" required><Input id="ocr-confirm-patient" name="patientId" defaultValue={job.patientId ?? ''} required /></Field><Field label="Confirmation reason" htmlFor="ocr-confirm-reason" required><Textarea id="ocr-confirm-reason" name="reason" minLength={8} maxLength={500} required /></Field>{error && <p className="staff-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Confirming…' : 'Confirm source patient'}</Button></form></Card>
}

function OcrPublicationCard({ facilityId, validation, confirmationId, canPublish, onChanged }: { facilityId: string; validation: OcrValidation; confirmationId: string | undefined; canPublish: boolean; onChanged: () => Promise<void> }) {
  const [publications, setPublications] = useState<OcrPublication[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void staffApi.ocrPublications(facilityId, validation.id).then(result => { if (active) setPublications(result.items) })
      .catch(caught => { if (active) setError(errorText(caught, 'Publication history could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, validation.id, revision])
  async function publish() {
    if (!confirmationId || validation.targetDomain === 'UNCLASSIFIED') return
    setBusy(true); setError('')
    try {
      await staffApi.publishOcrValidation(facilityId, validation, confirmationId, publicationOperations[validation.targetDomain])
      setRevision(value => value + 1)
      await onChanged()
    } catch (caught) { setError(errorText(caught, 'Validated evidence could not be published.')) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong>Review {validation.version} · {validation.targetDomain}</strong><Badge tone={validation.disposition === 'validated' ? 'success' : 'danger'}>{validation.disposition}</Badge></div><p>{validation.reason} · {dateText(validation.reviewedAt)}</p>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {publications === null && !error && <p className="staff-muted" role="status">Loading publication history…</p>}
    {publications?.map(publication => <div key={publication.id} className="staff-stack">
      <p>Publication: <Badge tone={publication.status === 'published' ? 'success' : publication.status === 'failed' ? 'danger' : 'information'}>{publication.status}</Badge>{publication.failureCode ? ` · ${publication.failureCode}` : ''}</p>
      {publication.targetResourceId && <p>Published {publication.targetResourceType ?? publication.targetDomain.toLowerCase()} record: <code>{publication.targetResourceId}</code></p>}
    </div>)}
    {canPublish && confirmationId && validation.disposition === 'validated' && validation.targetDomain !== 'UNCLASSIFIED' && publications?.length === 0 && <Button size="sm" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : `Publish to ${validation.targetDomain.replace('_', ' ')}`}</Button>}
  </div>
}

export function Ocr() {
  const { facilityId, permissions } = useFacilityAccess()
  const canRead = permissions.includes('ocr.job.read')
  const [documentId, setDocumentId] = useState('')
  const [patientId, setPatientId] = useState('')
  const [job, setJob] = useState<OcrJob | null>(null)
  const [jobFacilityId, setJobFacilityId] = useState('')
  const [extractions, setExtractions] = useState<OcrExtraction[] | null>(null)
  const [validations, setValidations] = useState<OcrValidation[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lookupRevision, setLookupRevision] = useState(0)
  const visibleJob = jobFacilityId === facilityId ? job : null
  const canRetryJob = visibleJob?.status === 'failed' &&
    (visibleJob.attemptCount === undefined || visibleJob.maxAttempts === undefined || visibleJob.attemptCount < visibleJob.maxAttempts)
  useEffect(() => { setJob(null); setExtractions(null); setValidations(null); setSearched(false); setError('') }, [facilityId])
  useEffect(() => {
    if (!facilityId || !visibleJob?.id || !canRead) return
    let active = true
    void Promise.all([staffApi.ocrExtractions(facilityId, visibleJob.id), staffApi.ocrValidations(facilityId, visibleJob.id)])
      .then(([extractionResult, validationResult]) => { if (active) { setExtractions(extractionResult.items); setValidations(validationResult.items) } })
      .catch(caught => { if (active) setError(errorText(caught, 'OCR review evidence could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, visibleJob?.id, canRead, lookupRevision])

  async function lookup(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!facilityId) return
    if (!documentId.trim()) return setError('Enter a document ID.')
    setBusy(true); setError(''); setSearched(false); setExtractions(null); setValidations(null)
    try { const result = await staffApi.findOcrJob(facilityId, documentId.trim()); setJob(result.job); setJobFacilityId(facilityId); setSearched(true); setLookupRevision(value => value + 1) }
    catch (caught) { setJob(null); setError(errorText(caught, 'OCR job could not be found.')) }
    finally { setBusy(false) }
  }

  async function create() {
    if (!facilityId) return
    if (!documentId.trim() || !patientId.trim()) return setError('Enter both the document and patient IDs.')
    setBusy(true); setError(''); setExtractions(null); setValidations(null)
    try { const created = await staffApi.createOcrJob(facilityId, documentId.trim(), patientId.trim()); setJob(created); setJobFacilityId(facilityId); setSearched(true); setLookupRevision(value => value + 1) }
    catch (caught) { setError(errorText(caught, 'OCR job could not be created.')) }
    finally { setBusy(false) }
  }

  async function retry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !visibleJob) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (reason.length < 8) return setError('Enter a reason of at least 8 characters.')
    setBusy(true); setError('')
    try { setJob(await staffApi.retryOcrJob(facilityId, visibleJob, reason)); setLookupRevision(value => value + 1) }
    catch (caught) { setError(errorText(caught, 'OCR job could not be retried.')) }
    finally { setBusy(false) }
  }

  if (!facilityId || !canRead) return <EmptyState title="Document OCR unavailable" description="This facility membership needs OCR job read permission." />
  return <>
    <PageHead eyebrow="Governed document processing" title="Document OCR">Find a job by its clinical document ID. The document must be available and virus scan clean before extraction can begin.</PageHead>
    <div className="staff-two-col"><Card className="staff-card"><h2>Find document job</h2><form className="staff-form" onSubmit={event => void lookup(event)}><Field label="Document ID" htmlFor="ocr-document" required><Input id="ocr-document" value={documentId} onChange={event => { setDocumentId(event.target.value); setSearched(false); setJob(null) }} placeholder="Document UUID" required /></Field><Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Find job'}</Button></form>
      {searched && !visibleJob && <p className="staff-muted">No OCR job exists for this document.</p>}
      {!visibleJob && permissions.includes('ocr.job.write') && <div className="staff-stack"><p>Create an extraction job for a verified patient document.</p><Field label="Patient ID" htmlFor="ocr-patient" required><Input id="ocr-patient" value={patientId} onChange={event => setPatientId(event.target.value)} placeholder="Patient UUID" /></Field><Button onClick={() => void create()} disabled={busy || !documentId.trim() || !patientId.trim()}>{busy ? 'Creating…' : 'Create extraction job'}</Button></div>}
      {error && <p className="staff-error" role="alert">{error}</p>}
    </Card>
      {visibleJob ? <Card className="staff-card"><h2>Job status</h2><div className="staff-row"><Badge tone={visibleJob.status === 'failed' ? 'danger' : visibleJob.status === 'validated' ? 'success' : 'information'}>{visibleJob.status.replaceAll('_', ' ')}</Badge><span className="staff-muted">Version {visibleJob.version ?? 'unknown'}</span></div><p>Provider {visibleJob.provider} · Document {shortId(visibleJob.documentId)}</p><Button tone="secondary" size="sm" onClick={() => void lookup()} disabled={busy}>Refresh status</Button>
        {canRetryJob && permissions.includes('ocr.job.write') && <form className="staff-form" onSubmit={event => void retry(event)}><Field label="Retry reason" htmlFor="ocr-retry-reason" required><Textarea id="ocr-retry-reason" name="reason" minLength={8} maxLength={500} required /></Field><Button size="sm" type="submit" disabled={busy || !visibleJob.version}>{busy ? 'Retrying…' : 'Retry job'}</Button></form>}
        {visibleJob.status === 'failed' && !canRetryJob && <p className="staff-muted">The extraction attempt limit has been reached. This job cannot be retried.</p>}
        {extractions === null && <p className="staff-muted" role="status">Loading extractions…</p>}
        {extractions?.length === 0 && <p className="staff-muted">No extraction is available yet.</p>}
        {extractions?.map(extraction => <div className="staff-list-item" key={extraction.id}><div className="staff-row"><strong>Extraction {extraction.version}</strong><Badge tone="neutral">{extraction.provider}</Badge></div>{extraction.confidence != null && <p>Confidence {Math.round(extraction.confidence * 100)}%</p>}{extraction.rawText && <details><summary>Review extracted text</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflowY: 'auto', fontSize: 12 }}>{extraction.rawText}</pre></details>}</div>)}
      </Card> : <Card className="staff-card"><h2>Document review</h2><p>Use the document ID from an authorized clinical record. OCR jobs are scoped to that source; this backend has no facility-wide OCR job list.</p></Card>}
    </div>
    {visibleJob?.status === 'awaiting_validation' && permissions.includes('ocr.validation.write') && extractions && <div className="staff-section"><OcrReview key={`${visibleJob.id}-${visibleJob.version}`} facilityId={facilityId} job={visibleJob} extractions={extractions} onChanged={() => lookup()} /></div>}
    {visibleJob?.status === 'validated' && !visibleJob.patientConfirmation && permissions.includes('ocr.patient.confirm') && <div className="staff-section"><OcrConfirmation key={`${visibleJob.id}-${visibleJob.version}`} facilityId={facilityId} job={visibleJob} onChanged={() => lookup()} /></div>}
    {visibleJob && validations && validations.length > 0 && <div className="staff-section"><h2>Review and publication history</h2><div className="staff-list">{validations.map(validation => <OcrPublicationCard key={validation.id} facilityId={facilityId} validation={validation} confirmationId={visibleJob.patientConfirmation?.id} canPublish={permissions.includes('ocr.publication.write')} onChanged={() => lookup()} />)}</div></div>}
  </>
}

const outreachServices = [
  ['registration', 'Registration'], ['vitals', 'Vitals'], ['vaccination', 'Vaccination'], ['lab_sample', 'Lab sample'], ['referral', 'Referral'],
] as const

function CampaignCard({ facilityId, membershipId, campaign, permissions, onChanged, onMembershipChange }: {
  facilityId: string; membershipId: string | undefined; campaign: OutreachCampaign; permissions: string[];
  onChanged: () => Promise<void>; onMembershipChange: (campaignId: string, isMember: boolean) => void
}) {
  const canRead = permissions.includes('outreach.campaign.read')
  const canWrite = permissions.includes('outreach.campaign.write')
  const members = useFacilityList(facilityId, canRead, useCallback(id => staffApi.outreachCampaignMembers(id, campaign.id), [campaign.id]))
  useEffect(() => {
    if (members.items) onMembershipChange(campaign.id, members.items.some(member => member.membershipId === membershipId))
  }, [campaign.id, membershipId, members.items, onMembershipChange])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const startsInFuture = campaign.status === 'planned' && new Date(campaign.startsAt).getTime() > Date.now()
  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    const status = campaign.status === 'planned' ? 'active' : 'closed'
    if (reason.length < 8) return setError('Enter a status reason of at least 8 characters.')
    setBusy(true); setError(''); setSuccess('')
    try { await staffApi.updateOutreachCampaignStatus(facilityId, campaign, status, reason); setSuccess(`Campaign ${status}.`); await onChanged() }
    catch (caught) { setError(errorText(caught, 'Campaign status could not be updated. Refresh and try again.')) }
    finally { setBusy(false) }
  }
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const membershipId = String(form.get('membershipId') ?? '').trim()
    const role = String(form.get('role') ?? 'enumerator') as OutreachCampaignMember['role']
    if (!membershipId) return setError('Enter a facility membership ID.')
    setBusy(true); setError(''); setSuccess('')
    try { await staffApi.addOutreachCampaignMember(facilityId, campaign.id, membershipId, role); setSuccess('Campaign member added.'); element.reset(); await members.refresh() }
    catch (caught) { setError(errorText(caught, 'Campaign member could not be added.')) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong>{campaign.name}</strong><Badge tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaign.status}</Badge></div><p>{campaign.services.join(', ')} · Starts {dateText(campaign.startsAt)}</p>
    {canRead && <details><summary>Members</summary><ListState loading={members.loading} error={members.error} empty="No members" retry={() => void members.refresh()} hasItems={Boolean(members.items?.length)} />{members.items?.map(member => <p key={member.id}>{member.role.replaceAll('_', ' ')} · Membership {shortId(member.membershipId)}</p>)}</details>}
    {canWrite && campaign.status !== 'closed' && <form className="staff-form" onSubmit={event => void transition(event)}><Field label={campaign.status === 'planned' ? 'Activation reason' : 'Closure reason'} htmlFor={`campaign-reason-${campaign.id}`} required><Input id={`campaign-reason-${campaign.id}`} name="reason" minLength={8} maxLength={500} required /></Field>{startsInFuture && <p className="staff-muted">Activation is available after the start time. Refresh the campaign then.</p>}<Button type="submit" tone="secondary" size="sm" disabled={busy || startsInFuture}>{busy ? 'Updating…' : campaign.status === 'planned' ? 'Activate campaign' : 'Close campaign'}</Button></form>}
    {canWrite && <details><summary>Add campaign member</summary><form className="staff-form" onSubmit={event => void addMember(event)}><Field label="Facility membership ID" htmlFor={`campaign-member-${campaign.id}`} required><Input id={`campaign-member-${campaign.id}`} name="membershipId" placeholder="Membership UUID" required /></Field><Field label="Campaign role" htmlFor={`campaign-role-${campaign.id}`}><Select id={`campaign-role-${campaign.id}`} name="role"><option value="enumerator">Enumerator</option><option value="health_worker">Health worker</option><option value="admin">Admin</option></Select></Field><Button type="submit" size="sm" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</Button></form></details>}
    {error && <p className="staff-error" role="alert">{error}</p>}{success && <p className="staff-success" role="status">{success}</p>}
  </div>
}

function OutreachCaseCard({ facilityId, item, canLink, onChanged }: { facilityId: string; item: OutreachCase; canLink: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function linkExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const patientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    if (!patientId || reason.length < 8) return setError('Enter a canonical patient ID and a reason of at least 8 characters.')
    setBusy(true); setError(''); setSuccess('')
    try { await staffApi.linkExistingOutreachCase(facilityId, item, patientId, reason); setSuccess('Existing patient linked.'); await onChanged() }
    catch (caught) { setError(errorText(caught, 'Patient could not be linked. Verify access and refresh the case.')) }
    finally { setBusy(false) }
  }
  return <div className="staff-list-item"><div className="staff-row"><strong>{item.fullName ?? 'Registrant'}</strong><Badge tone={item.status === 'identity_resolved' ? 'success' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge></div><p>Case {shortId(item.id)} · {item.ageYears == null ? 'Age not recorded' : `${item.ageYears} years`} · {item.sex ?? 'Unknown'} · {dateText(item.createdAt)}</p>{item.temporaryPatientId && <p>Temporary ID {shortId(item.temporaryPatientId)}</p>}
    {canLink && item.status === 'identity_resolution_pending' && <details><summary>Link verified existing patient</summary><form className="staff-form" onSubmit={event => void linkExisting(event)}><Field label="Canonical patient ID" htmlFor={`outreach-patient-${item.id}`} required><Input id={`outreach-patient-${item.id}`} name="patientId" placeholder="Patient UUID" required /></Field><Field label="Resolution reason" htmlFor={`outreach-reason-${item.id}`} required><Textarea id={`outreach-reason-${item.id}`} name="reason" minLength={8} maxLength={1000} required /></Field><p className="staff-muted">The server checks your exact patient authorization and the case version.</p><Button type="submit" size="sm" disabled={busy}>{busy ? 'Linking…' : 'Link existing patient'}</Button></form></details>}
    {error && <p className="staff-error" role="alert">{error}</p>}{success && <p className="staff-success" role="status">{success}</p>}
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

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId) return
    const element = event.currentTarget
    const form = new FormData(element)
    const name = String(form.get('name') ?? '').trim()
    const services = form.getAll('services').map(String)
    const startTime = new Date(String(form.get('startsAt') ?? ''))
    if (name.length < 2 || services.length === 0) return setError('Enter a campaign name and choose at least one service.')
    if (Number.isNaN(startTime.getTime())) return setError('Enter a valid campaign start date.')
    setBusy(true); setError(''); setSuccess('')
    try { await staffApi.createOutreachCampaign(facilityId, { name, services, startsAt: startTime.toISOString() }); setSuccess('Campaign created.'); element.reset(); await campaigns.refresh() }
    catch (caught) { setError(errorText(caught, 'Campaign could not be created.')) }
    finally { setBusy(false) }
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId) return
    const element = event.currentTarget
    const form = new FormData(element)
    const campaignId = String(form.get('campaignId') ?? '') || undefined
    const fullName = String(form.get('fullName') ?? '').trim()
    const sex = String(form.get('sex') ?? 'unknown')
    const ageYears = Number(form.get('ageYears'))
    const phone = String(form.get('phone') ?? '').trim() || undefined
    const operationalNotes = String(form.get('operationalNotes') ?? '').trim() || undefined
    if (!fullName || !Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) return setError('Enter a name and a valid age.')
    setBusy(true); setError(''); setSuccess('')
    try { await staffApi.createOutreachCase(facilityId, { campaignId, fullName, sex, ageYears, phone, operationalNotes }); setSuccess('Registration case created for identity resolution.'); element.reset(); await cases.refresh() }
    catch (caught) { setError(errorText(caught, 'Registration case could not be created.')) }
    finally { setBusy(false) }
  }

  if (!facilityId || (!canReadCases && !canReadCampaigns)) return <EmptyState title="Outreach unavailable" description="This facility membership needs outreach campaign or registration read permission." />
  return <>
    <PageHead eyebrow="Community care" title="Outreach">Manage facility campaigns and registration cases. A temporary registration is pending identity resolution until the backend links it to a verified patient.</PageHead>
    {error && <p className="staff-error" role="alert">{error}</p>}{success && <p className="staff-success" role="status">{success}</p>}
    <div className="staff-two-col"><div className="staff-stack">
      {canReadCampaigns && <Card className="staff-card"><div className="staff-row"><h2>Campaigns</h2><Button tone="secondary" size="sm" onClick={() => void campaigns.refresh()} disabled={campaigns.loading}>Refresh</Button></div><ListState loading={campaigns.loading} error={campaigns.error} empty="No campaigns" retry={() => void campaigns.refresh()} hasItems={Boolean(campaigns.items?.length)} />{campaigns.items?.map((campaign: OutreachCampaign) => <CampaignCard key={campaign.id} facilityId={facilityId} membershipId={membershipId} campaign={campaign} permissions={permissions} onChanged={campaigns.refresh} onMembershipChange={recordMembership} />)}</Card>}
      {permissions.includes('outreach.campaign.write') && <Card className="staff-card"><h2>New campaign</h2><form className="staff-form" onSubmit={event => void createCampaign(event)}><Field label="Campaign name" htmlFor="outreach-campaign-name" required><Input id="outreach-campaign-name" name="name" minLength={2} maxLength={200} required /></Field><Field label="Starts" htmlFor="outreach-campaign-start" required><Input id="outreach-campaign-start" name="startsAt" type="datetime-local" required /></Field><fieldset><legend>Services</legend>{outreachServices.map(([code, label]) => <label key={code} className="staff-row"><input type="checkbox" name="services" value={code} />{label}</label>)}</fieldset><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create campaign'}</Button></form></Card>}
    </div><div className="staff-stack">
      {canReadCases && <Card className="staff-card"><div className="staff-row"><h2>Registration cases</h2><Button tone="secondary" size="sm" onClick={() => void cases.refresh()} disabled={cases.loading}>Refresh</Button></div><ListState loading={cases.loading} error={cases.error} empty="No registration cases" retry={() => void cases.refresh()} hasItems={Boolean(cases.items?.length)} />{cases.items?.map((item: OutreachCase) => <OutreachCaseCard key={item.id} facilityId={facilityId} item={item} canLink={permissions.includes('outreach.registration.write')} onChanged={cases.refresh} />)}</Card>}
      {permissions.includes('outreach.registration.write') && <Card className="staff-card"><h2>New registration case</h2><form className="staff-form" onSubmit={event => void createCase(event)}>{canReadCampaigns && <Field label="Campaign" htmlFor="outreach-case-campaign" hint="Only active registration campaigns containing your facility membership appear here. A case may also be created without a campaign."><Select id="outreach-case-campaign" name="campaignId"><option value="">No campaign</option>{campaigns.items?.filter(campaign => campaign.status === 'active' && campaign.services.includes('registration') && eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id)).map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>}<Field label="Full name" htmlFor="outreach-case-name" required><Input id="outreach-case-name" name="fullName" maxLength={200} required /></Field><div className="staff-form-row"><Field label="Sex" htmlFor="outreach-case-sex" required><Select id="outreach-case-sex" name="sex"><option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></Field><Field label="Age (years)" htmlFor="outreach-case-age" required><Input id="outreach-case-age" name="ageYears" type="number" min="0" max="130" required /></Field></div><Field label="Phone (optional)" htmlFor="outreach-case-phone"><Input id="outreach-case-phone" name="phone" minLength={3} maxLength={32} /></Field><Field label="Operational notes" htmlFor="outreach-case-notes"><Textarea id="outreach-case-notes" name="operationalNotes" maxLength={2000} /></Field><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create case'}</Button></form></Card>}
    </div></div>
  </>
}

export function MigrateGap() {
  return <>
    <PageHead eyebrow="HID Migrate" title="Migration workspace">The approved backend snapshot supports document OCR jobs tied to authorized clinical documents. It does not yet expose a project, bulk import, matching queue, or completed migration index.</PageHead>
    <EmptyState title="Project migration requires backend support" description="You can process an eligible clinical document in Document OCR. Bulk migration needs governed project and reconciliation APIs before its controls can safely be enabled." action={<Link className="staff-text-link" to="/provider/ocr">Open document OCR →</Link>} />
  </>
}
