import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { CheckCheck, Droplet, FlaskConical, History, PackageCheck, Play, RotateCcw, Save, Square, X } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet, FormActions, Value } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, Field, Input, Select, Textarea, cx } from '../../../kasuwa/ui'
import {
  staffApi, type LabAbnormalFlag, type LabAccession, type LabExecution, type LabResult, type LabResultRevision, type LabResultValue, type LabSpecimen,
  type LabWorkItem,
} from '../../../staff/api'
import { sampleCheckText } from '../../../staff/orderRoutes'
import { refusalText } from '../../../staff/fieldProblem'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { ABNORMAL_FLAGS, FLAG_WORDS, flagFromRange, flagLevel, revisionText } from './labText'

/*
 * The lab's steps on one request, each the one thing to do at its stage, in the shared parts: collect the sample (the
 * accession is made with it), receive it, start and finish the test, enter the result, then check and release it. Every
 * request and permission is the Laboratory page's (staffApi); a save that names the patient is confirmed against them
 * first (wrong-patient prevention). A refusal is said where the step is, and one that leaves access in doubt reads the
 * record again (`onRefused`).
 */

/** Who the request is for: their name, and their banner for the confirm before a save. */
export interface LabSubject { readonly name: string; readonly banner: ReactNode }

interface StepBase {
  readonly facilityId: string
  readonly permissions: readonly string[]
  readonly subject: LabSubject
  /** Work from an order another facility sent: a write it refuses as not found means the order closed. */
  readonly routed: boolean
  /** A step was saved: what to say, and the record is read again. */
  readonly onDone: (message: string) => void
  readonly onRefused: (caught: unknown) => void
}

const SAMPLE_TYPES = ['Blood', 'Urine', 'Stool', 'Swab', 'Sputum'] as const

function Problem({ text }: { readonly text: string }) {
  return text ? <Alert intent="error" size="sm">{text}</Alert> : null
}

// ------------------------------------------------------------- collect --
/**
 * Collect the sample: on a request with no accession yet, the accession is made with the sample type (one sample per
 * test), then the sample is marked collected. Confirmed against the patient first.
 */
export function CollectStep({ facilityId, permissions, subject, routed, onDone, onRefused, item, accession, defaultType, defaultReason, onCollected }: StepBase & {
  readonly item: LabWorkItem
  readonly accession: LabAccession | null
  /** The sample the price list names for the test ("Blood, EDTA tube"), as the first guess. */
  readonly defaultType?: string | null
  readonly defaultReason?: string | null
  readonly onCollected: (accession: LabAccession) => void
}) {
  const required = accession?.specimens.filter(specimen => specimen.status === 'required') ?? []
  const rejected = accession?.specimens.filter(specimen => specimen.status === 'rejected') ?? []
  const canCreate = permissions.includes('lab.accession.create')
  const canCollect = permissions.includes('lab.specimen.collect')
  const [type, setType] = useState(defaultType ?? '')
  const [reason, setReason] = useState(defaultReason ?? '')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ type?: string; reason?: string }>({})
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // An accession made by this step whose collect then failed: the retry collects on it, and makes no second one.
  const [made, setMade] = useState<LabAccession | null>(null)
  const current = accession ?? made
  const needsAccession = !current
  const test = item.testName ?? 'Lab test'

  if (accession && required.length === 0) return rejected.length > 0
    ? <p className="m-0 text-[15px] text-ink-2">The sample was rejected. Make a new request to take another.</p>
    : <p className="m-0 text-[15px] text-ink-2">Nothing to collect.</p>
  if ((needsAccession && !canCreate) || !canCollect) return <p className="m-0 text-[15px] text-ink-2">Your role can’t collect samples. Ask a colleague who can.</p>

  function check(event: FormEvent) {
    event.preventDefault()
    const found: typeof errors = {}
    if (needsAccession && !type.trim()) found.type = 'Choose or type the sample, like Blood.'
    if (needsAccession && !reason.trim()) found.reason = 'Say why the test is done, as on the request.'
    setErrors(found); setProblem('')
    const first = found.type ? 'lab-collect-type' : found.reason ? 'lab-collect-reason' : null
    if (first) { document.getElementById(first)?.focus(); return }
    setAsking(true)
  }
  async function collect() {
    if (busy) return
    setBusy(true); setProblem('')
    let target = current
    try {
      if (!target) { target = await staffApi.createLabAccession(facilityId, item.id, type.trim(), reason.trim()); setMade(target) }
      const waiting = target.specimens.filter(specimen => specimen.status === 'required')
      for (const specimen of waiting) await staffApi.transitionSpecimen(facilityId, target.id, specimen, 'collect', notes.trim())
      setAsking(false)
      onCollected(target)
      onDone(waiting.length > 1 ? 'Samples collected. Print the labels.' : 'Sample collected. Print the label.')
    } catch (caught) {
      setAsking(false)
      setProblem(errorText(caught, target ? 'The sample could not be marked collected. Try again: nothing is made twice.' : 'The sample could not be recorded. Try again.', routed))
      onRefused(caught)
    } finally { setBusy(false) }
  }

  return <form className="@container flex flex-col gap-4" noValidate onSubmit={check}>
    {routed && item.patient ? <Alert intent="warning" size="sm">{sampleCheckText(item.patient.fullName)}</Alert> : null}
    {needsAccession ? <>
      <Field label="Sample" htmlFor="lab-collect-type" error={errors.type} errorId="lab-collect-type-error">
        <Input id="lab-collect-type" value={type} maxLength={240} autoComplete="off" className="h-11" placeholder="Blood, urine, swab…"
          aria-invalid={errors.type ? true : undefined} aria-describedby={errors.type ? 'lab-collect-type-error' : undefined}
          onChange={event => { setType(event.target.value); setErrors({}) }} />
      </Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Common samples">
        {SAMPLE_TYPES.map(option => <button key={option} type="button" aria-pressed={type === option}
          onClick={() => { setType(option); setErrors({}) }}
          className={cx('inline-flex min-h-11 cursor-pointer items-center rounded-full border-0 px-4 text-[14px] font-medium ring-1 ring-inset',
            type === option ? 'bg-brand-soft text-brand-ink ring-brand-line' : 'bg-surface text-ink ring-line-strong hover:bg-subtle')}>{option}</button>)}
      </div>
      <Field label="Why the test" htmlFor="lab-collect-reason" error={errors.reason} errorId="lab-collect-reason-error">
        <Textarea id="lab-collect-reason" rows={2} maxLength={500} value={reason}
          aria-invalid={errors.reason ? true : undefined} aria-describedby={errors.reason ? 'lab-collect-reason-error' : undefined}
          onChange={event => { setReason(event.target.value); setErrors({}) }} />
      </Field>
    </> : <p className="m-0 text-[15px] text-ink-2">{required.map(specimen => `${specimen.specimenType}, ${specimen.specimenIdentifier}`).join(' · ')}</p>}
    <Field label="Collection notes" htmlFor="lab-collect-notes" optional>
      <Input id="lab-collect-notes" value={notes} maxLength={1000} autoComplete="off" className="h-11" onChange={event => setNotes(event.target.value)} />
    </Field>
    <Problem text={problem} />
    <FormActions sticky={false}><Button type="submit" variant="primary" size="lg" icon={Droplet}>Collect sample</Button></FormActions>
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Collect the sample" subject={subject.banner} busy={busy}
      effect={<>Collect the <strong>{test}</strong> sample from <strong>{subject.name}</strong>?</>}
      undo="Check the name with the person before you take it." confirmLabel="Collect sample" onConfirm={() => void collect()} />
  </form>
}

// ------------------------------------------------------------- testing --
/** One sample in testing: receive it (or reject it), start its test, or finish the test running on it. */
export function TestingStep({ facilityId, permissions, subject, routed, onDone, onRefused, specimen, accessionId, executions, executionsRead }: StepBase & {
  readonly specimen: LabSpecimen; readonly accessionId: string
  readonly executions: readonly LabExecution[]; readonly executionsRead: boolean
}) {
  const running = executions.find(execution => execution.status === 'in_progress')
  const header = <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] text-ink">
    <FlaskConical className="size-4 text-ink-3" aria-hidden /><span className="font-medium">{specimen.specimenType}</span>
    <span className="text-ink-3 tabular">{specimen.specimenIdentifier}</span>
    <Badge size="sm">{specimen.status === 'collected' ? 'Collected' : running ? 'Testing' : 'Received'}</Badge>
  </p>
  const base = { facilityId, permissions, subject, routed, onDone, onRefused }
  if (specimen.status === 'collected') return <div className="flex flex-col gap-3">{header}<ReceiveForm {...base} specimen={specimen} accessionId={accessionId} /></div>
  if (running) return <div className="flex flex-col gap-3">{header}<FinishForm {...base} execution={running} /></div>
  if (specimen.status === 'received' && (executions.length === 0 || !executionsRead)) return <div className="flex flex-col gap-3">{header}<StartForm {...base} specimen={specimen} /></div>
  return header
}

function ReceiveForm({ facilityId, permissions, routed, onDone, onRefused, specimen, accessionId }: StepBase & { readonly specimen: LabSpecimen; readonly accessionId: string }) {
  const [condition, setCondition] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const canReceive = permissions.includes('lab.specimen.receive')
  const canReject = permissions.includes('lab.specimen.reject')
  const id = specimen.id
  async function step(action: 'receive' | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { setReasonError('Say why, like “Haemolysed” or “Not labelled”.'); document.getElementById(`lab-reject-${id}`)?.focus(); return }
    setBusy(true); setProblem('')
    try {
      await staffApi.transitionSpecimen(facilityId, accessionId, specimen, action, action === 'receive' ? condition.trim() : reason.trim())
      onDone(action === 'receive' ? 'Sample received. Start the test.' : 'Sample rejected.')
    } catch (caught) { setProblem(errorText(caught, 'The sample could not be updated. Refresh and try again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  if (!canReceive && !canReject) return <p className="m-0 text-[15px] text-ink-2">Your role can’t receive samples.</p>
  return <div className="flex flex-col gap-4">
    {canReceive && !rejecting ? <Field label="Condition on arrival" htmlFor={`lab-receive-${id}`} optional>
      <Input id={`lab-receive-${id}`} value={condition} maxLength={500} autoComplete="off" className="h-11" placeholder="Good" onChange={event => setCondition(event.target.value)} />
    </Field> : null}
    {rejecting ? <Field label="Why reject it" htmlFor={`lab-reject-${id}`} error={reasonError} errorId={`lab-reject-${id}-error`}>
      <Input id={`lab-reject-${id}`} value={reason} maxLength={500} autoComplete="off" className="h-11" aria-invalid={reasonError ? true : undefined}
        aria-describedby={reasonError ? `lab-reject-${id}-error` : undefined} onChange={event => { setReason(event.target.value); setReasonError('') }} />
    </Field> : null}
    <Problem text={problem} />
    <FormActions sticky={false}>
      {canReject && !rejecting ? <Button variant="danger" icon={X} onClick={() => { setRejecting(true); setProblem('') }}>Reject sample</Button> : null}
      {rejecting ? <Button onClick={() => { setRejecting(false); setReasonError('') }}>Cancel</Button> : null}
      {rejecting ? <Button variant="destructive" size="lg" loading={busy} onClick={() => void step('reject')}>Reject sample</Button>
        : canReceive ? <Button variant="primary" size="lg" icon={PackageCheck} loading={busy} onClick={() => void step('receive')}>Receive sample</Button> : null}
    </FormActions>
  </div>
}

function StartForm({ facilityId, permissions, routed, onDone, onRefused, specimen }: StepBase & { readonly specimen: LabSpecimen }) {
  const [method, setMethod] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const id = specimen.id
  if (!permissions.includes('lab.execution.start')) return <p className="m-0 text-[15px] text-ink-2">Your role can’t start tests.</p>
  async function start(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!details.trim()) { setError('Say what is being done, like “Run on the analyser”.'); document.getElementById(`lab-start-${id}`)?.focus(); return }
    setBusy(true); setProblem('')
    try { await staffApi.startLabExecution(facilityId, specimen, details.trim(), method); onDone('Test started.') }
    catch (caught) { setProblem(errorText(caught, 'The test could not be started. Refresh the sample first.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="@container flex flex-col gap-4" noValidate onSubmit={event => void start(event)}>
    <div className="grid gap-4 @md:grid-cols-2">
      <Field label="Method" htmlFor={`lab-method-${id}`} optional>
        <Input id={`lab-method-${id}`} value={method} maxLength={240} autoComplete="off" className="h-11" placeholder="Analyser, microscopy…" onChange={event => setMethod(event.target.value)} />
      </Field>
      <Field label="What is being done" htmlFor={`lab-start-${id}`} error={error} errorId={`lab-start-${id}-error`}>
        <Input id={`lab-start-${id}`} value={details} maxLength={500} autoComplete="off" className="h-11" aria-invalid={error ? true : undefined}
          aria-describedby={error ? `lab-start-${id}-error` : undefined} onChange={event => { setDetails(event.target.value); setError('') }} />
      </Field>
    </div>
    <Problem text={problem} />
    <FormActions sticky={false}><Button type="submit" variant="primary" size="lg" icon={Play} loading={busy}>Start test</Button></FormActions>
  </form>
}

function FinishForm({ facilityId, permissions, routed, onDone, onRefused, execution }: StepBase & { readonly execution: LabExecution }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  if (!permissions.includes('lab.execution.complete')) return <p className="m-0 text-[15px] text-ink-2">{execution.test.name} is running.</p>
  async function finish(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setProblem('')
    try { await staffApi.completeLabExecution(facilityId, execution, notes); onDone('Test finished. Enter the result.') }
    catch (caught) { setProblem(errorText(caught, 'The test could not be finished. Refresh before trying again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="flex flex-col gap-4" noValidate onSubmit={event => void finish(event)}>
    <p className="m-0 text-[15px] text-ink">{execution.test.name}{execution.method ? <span className="text-ink-3"> · {execution.method}</span> : null}</p>
    <Field label="Notes" htmlFor={`lab-finish-${execution.id}`} optional>
      <Input id={`lab-finish-${execution.id}`} value={notes} maxLength={1000} autoComplete="off" className="h-11" onChange={event => setNotes(event.target.value)} />
    </Field>
    <Problem text={problem} />
    <FormActions sticky={false}><Button type="submit" variant="primary" size="lg" icon={Square} loading={busy}>Finish test</Button></FormActions>
  </form>
}

// --------------------------------------------------------------- results --
type ResultErrors = Partial<Record<'value' | 'unit' | 'reason', string>>

/**
 * Enter a result, or correct one (a new, unverified version; earlier and released versions are kept). A number needs
 * its unit; the flag follows the reference range until it is chosen by hand. Confirmed against the patient.
 */
export function ResultForm({ facilityId, subject, routed, onDone, onRefused, execution, result, onCancel }: Omit<StepBase, 'permissions'> & {
  readonly execution: LabExecution; readonly result: LabResult | null; readonly onCancel?: () => void
}) {
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  const id = execution.id
  const [kind, setKind] = useState<'numeric' | 'text'>(current?.resultType ?? 'numeric')
  const [value, setValue] = useState(current ? revisionText(current) : '')
  const [unit, setUnit] = useState(current?.unit ?? '')
  const [range, setRange] = useState(current?.referenceRange ?? '')
  const [flag, setFlag] = useState<LabAbnormalFlag>(current?.abnormalFlag ?? 'unknown')
  const [chosen, setChosen] = useState(Boolean(current))
  const [revisionKind, setRevisionKind] = useState<'correction' | 'amendment'>('correction')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<ResultErrors>({})
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const follow = (nextValue: string, nextRange: string) => {
    if (chosen || kind !== 'numeric') return
    const fromRange = flagFromRange(nextValue, nextRange)
    if (fromRange) setFlag(fromRange)
  }
  const auto = !chosen && kind === 'numeric' && flagFromRange(value, range) !== null

  function check(event: FormEvent) {
    event.preventDefault()
    const found: ResultErrors = {}
    if (kind === 'numeric' && (!value.trim() || !Number.isFinite(Number(value)))) found.value = 'Enter a number.'
    if (kind === 'text' && !value.trim()) found.value = 'Type the result.'
    // A number without its unit can't be read safely (mg/dL or mmol/L?): the unit is required.
    if (kind === 'numeric' && !unit.trim()) found.unit = 'Enter the unit, like g/dL or mmol/L.'
    if (result && !reason.trim()) found.reason = 'Say why it is changed.'
    setErrors(found); setProblem('')
    const first = (['value', 'unit', 'reason'] as const).find(field => found[field])
    if (first) { document.getElementById(`lab-${first}-${id}`)?.focus(); return }
    setAsking(true)
  }
  async function save() {
    if (busy) return
    const shared = { ...(unit.trim() ? { unit: unit.trim() } : {}), ...(range.trim() ? { referenceRange: range.trim() } : {}), abnormalFlag: flag }
    const entry: LabResultValue = kind === 'numeric' ? { resultType: 'numeric', numericValue: Number(value), ...shared } : { resultType: 'text', textValue: value.trim(), ...shared }
    setBusy(true); setProblem('')
    try {
      if (result) await staffApi.correctLabResult(facilityId, execution, result, entry, reason.trim(), revisionKind)
      else await staffApi.enterLabResult(facilityId, execution, entry)
      setAsking(false)
      onDone(result ? 'Correction saved. Check and release it.' : 'Result saved. Next: check and release.')
    } catch (caught) {
      setAsking(false)
      setProblem(errorText(caught, 'The result could not be saved. Refresh before trying again.', routed)); onRefused(caught)
    } finally { setBusy(false) }
  }
  const control = (field: keyof ResultErrors) => ({
    id: `lab-${field}-${id}`, 'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `lab-${field}-${id}-error` : undefined,
  })
  return <form className="@container flex flex-col gap-4" noValidate onSubmit={check} aria-label={`${result ? 'Correct' : 'Enter'} result: ${execution.test.name}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="m-0 min-w-0 text-title-3 text-ink break-words">{execution.test.name}</p>
      <Segmented ariaLabel="Kind of result" value={kind} onChange={next => { setKind(next); setErrors({}) }}
        options={[{ value: 'numeric', label: 'Number' }, { value: 'text', label: 'Text' }]} />
    </div>
    {kind === 'numeric' ? <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-3">
      <Field label="Result" htmlFor={`lab-value-${id}`} error={errors.value} errorId={`lab-value-${id}-error`}>
        <Input {...control('value')} type="number" step="any" inputMode="decimal" value={value} className="h-12 text-[17px] font-semibold tabular"
          onChange={event => { setValue(event.target.value); setErrors({}); follow(event.target.value, range) }} />
      </Field>
      <Field label="Unit" htmlFor={`lab-unit-${id}`} error={errors.unit} errorId={`lab-unit-${id}-error`}>
        <Input {...control('unit')} value={unit} maxLength={80} autoComplete="off" placeholder="g/dL" className="h-12" onChange={event => { setUnit(event.target.value); setErrors({}) }} />
      </Field>
      <Field label="Normal range" htmlFor={`lab-range-${id}`} optional>
        <Input id={`lab-range-${id}`} value={range} maxLength={240} autoComplete="off" placeholder="12-16" className="h-12"
          onChange={event => { setRange(event.target.value); follow(value, event.target.value) }} />
      </Field>
    </div> : <>
      <Field label="Result" htmlFor={`lab-value-${id}`} error={errors.value} errorId={`lab-value-${id}-error`}>
        <Textarea {...control('value')} rows={3} maxLength={4000} value={value} onChange={event => { setValue(event.target.value); setErrors({}) }} />
      </Field>
      <div className="grid gap-4 @md:grid-cols-2">
        <Field label="Unit" htmlFor={`lab-unit-${id}`} optional>
          <Input id={`lab-unit-${id}`} value={unit} maxLength={80} autoComplete="off" className="h-11" onChange={event => setUnit(event.target.value)} />
        </Field>
        <Field label="Normal range" htmlFor={`lab-range-${id}`} optional>
          <Input id={`lab-range-${id}`} value={range} maxLength={240} autoComplete="off" className="h-11" onChange={event => setRange(event.target.value)} />
        </Field>
      </div>
    </>}
    <Field label="Flag" htmlFor={`lab-flag-${id}`} hint={auto ? 'Set from the normal range. You can change it.' : undefined} hintId={`lab-flag-${id}-hint`}>
      <Select id={`lab-flag-${id}`} value={flag} aria-describedby={auto ? `lab-flag-${id}-hint` : undefined} className="[&>select]:h-11"
        onChange={event => { setFlag(event.target.value as LabAbnormalFlag); setChosen(true) }}>
        {ABNORMAL_FLAGS.map(option => <option key={option} value={option}>{FLAG_WORDS[option]}</option>)}
      </Select>
    </Field>
    {result ? <>
      <Segmented ariaLabel="Type of change" value={revisionKind} onChange={setRevisionKind} className="self-start"
        options={[{ value: 'correction', label: 'Correction' }, { value: 'amendment', label: 'Amendment' }]} />
      <Field label="Why it is changed" htmlFor={`lab-reason-${id}`} error={errors.reason} errorId={`lab-reason-${id}-error`}>
        <Textarea {...control('reason')} rows={2} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setErrors({}) }} />
      </Field>
    </> : null}
    <Problem text={problem} />
    <FormActions sticky={false}>
      {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
      <Button type="submit" variant="primary" size="lg" icon={Save}>{result ? 'Save correction' : 'Save result'}</Button>
    </FormActions>
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title={result ? 'Save the correction' : 'Save the result'} subject={subject.banner} busy={busy}
      effect={<>Save <strong className="tabular">{value.trim()}{unit.trim() ? ` ${unit.trim()}` : ''}</strong> as the {execution.test.name} result for <strong>{subject.name}</strong>?</>}
      undo="It is checked and released in the next step; until then only the lab sees it." confirmLabel={result ? 'Save correction' : 'Save result'} onConfirm={() => void save()} />
  </form>
}

/** A result's current value with its unit and flag, and the range under it. */
export function ResultValue({ result }: { readonly result: LabResult }) {
  const current = result.revisions.find(revision => revision.version === result.currentVersion) ?? result.revisions.at(-1)
  if (!current) return <span className="text-ink-3">Not recorded</span>
  return <span className="flex flex-col gap-0.5">
    <span className="text-[17px]"><Value value={revisionText(current)} unit={current.unit} flag={flagLevel(current.abnormalFlag)} /></span>
    {current.referenceRange ? <span className="text-caption text-ink-3">Normal range {current.referenceRange}</span> : null}
  </span>
}

/** Today's Laboratory page's words when Lab refuses a verify or a release (staff/routes/Operations.tsx, ResultGovernance). */
const DECISION_FAILED = 'Decision could not be recorded. Refresh before retrying.'

/**
 * A refused verify or release in the page's own words: the sentences errorText writes itself (an order from another
 * facility that closed, a module not in service, paused work), else today's sentence. errorText otherwise ends with the
 * refusal's own message, which is the service's text, so that is never shown here.
 */
function decisionProblem(caught: unknown, routed: boolean): string {
  const said = errorText(caught, DECISION_FAILED, routed)
  return said === refusalText(caught, DECISION_FAILED) ? DECISION_FAILED : said
}

/** Each decision's permission and words, as on today's Laboratory page (Operations.tsx, ResultGovernance). */
const DECISIONS = {
  verify: {
    permission: 'lab.result.verify', action: 'Verify result version', reason: 'Verification reason',
    done: 'This exact result version was verified.',
  },
  release: {
    permission: 'lab.result.release', action: 'Release result version', reason: 'Release reason',
    // Today says "to authorized readers"; who they are is said instead: releasing is what shows it outside the lab.
    done: 'This exact verified result version was released. The patient and the ordering clinic can now see it.',
  },
} as const

/**
 * Check & release, as two separate actions, as on today's Laboratory page: verify an unverified result (Lab refuses a
 * verify by the person who entered it: someone else checks), then release the verified one, which shows it to the
 * patient and the ordering clinic. Each is its own request with its own permission and its own typed reason, so the
 * audit says why each was done; one press never does both. Confirmed against the patient first.
 */
export function CheckStep({ facilityId, permissions, subject, routed, onDone, onRefused, execution }: StepBase & { readonly execution: LabExecution }) {
  const result = execution.result!
  const needsVerify = result.status === 'entered_unverified'
  const decision = needsVerify ? 'verify' : 'release'
  const words = DECISIONS[decision]
  const can = permissions.includes(words.permission)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const reasonId = `lab-${decision}-reason-${execution.id}`
  async function run() {
    if (busy) return
    if (!reason.trim()) { setReasonError('Enter a reason for this decision.'); document.getElementById(reasonId)?.focus(); return }
    setBusy(true); setProblem('')
    try {
      if (decision === 'verify') await staffApi.verifyLabResult(facilityId, result, reason.trim())
      else await staffApi.releaseLabResult(facilityId, result, reason.trim())
      setAsking(false); onDone(words.done)
    } catch (caught) {
      setAsking(false); setProblem(decisionProblem(caught, routed)); onRefused(caught)
    } finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-inset ring-line">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-title-3 text-ink">{execution.test.name}</p>
        <ResultValue result={result} />
      </div>
      <Badge size="sm" tone={needsVerify ? 'warn' : 'info'}>{needsVerify ? 'To check' : 'Checked, not released'}</Badge>
    </div>
    <Problem text={problem} />
    {can ? <FormActions sticky={false}><Button variant="primary" size="lg" icon={CheckCheck} onClick={() => { setReason(''); setReasonError(''); setAsking(true) }}>{words.action}</Button></FormActions>
      : <p className="m-0 text-[14px] text-ink-2">{needsVerify ? 'Waiting for someone who can check results.' : 'Waiting for someone who can release results.'}</p>}
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title={words.action} subject={subject.banner} busy={busy}
      effect={needsVerify
        ? <>Verify version {result.currentVersion} of the {execution.test.name} result for <strong>{subject.name}</strong> after independent review?</>
        : <>Release verified version {result.currentVersion} of the {execution.test.name} result for <strong>{subject.name}</strong> to the patient and the ordering clinic?</>}
      undo={needsVerify
        ? 'The person who entered it cannot verify it. It is released in a separate step; until then only the lab sees it.'
        : 'A wrong result can be corrected; every version is kept.'}
      confirmLabel={words.action} onConfirm={() => void run()}>
      <Field label={words.reason} htmlFor={reasonId} error={reasonError} errorId={`${reasonId}-error`}>
        <Textarea id={reasonId} rows={2} maxLength={500} value={reason} aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonId}-error` : undefined} onChange={event => { setReason(event.target.value); setReasonError('') }} />
      </Field>
    </ConfirmSheet>
  </div>
}

const RELEASE_WORDS: Readonly<Record<LabResultRevision['releaseStatus'], string>> = {
  not_released: 'not released', verified_not_released: 'checked, not released', released: 'released',
}
const CHECK_WORDS: Readonly<Record<LabResultRevision['verificationStatus'], string>> = {
  unverified: 'Not checked', verified: 'Checked', entered_in_error: 'Entered in error',
}

/**
 * "Preserved versions & amendments": every version of a result, kept by Lab, read only when asked (today's Laboratory
 * page's history). A refusal of the read says something about access, so the record is read again (`onRefused`); a
 * result never released answers 404 to someone who reads only released results, which is not a refusal.
 */
export function ResultHistory({ facilityId, execution, onRefused }: {
  readonly facilityId: string; readonly execution: LabExecution; readonly onRefused: (caught: unknown) => void
}) {
  const result = execution.result!
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<LabResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // The read in flight: an answer to one replaced (closed, or read again) is dropped.
  const reading = useRef(0)
  const unreleased = result.currentReleasedVersion == null
  const panel = `lab-history-${execution.id}`
  async function load() {
    const mine = ++reading.current
    setLoading(true); setError('')
    try {
      const value = await staffApi.labResultHistory(facilityId, result.id)
      if (reading.current === mine) setHistory(value)
    } catch (caught) {
      if (reading.current === mine) setError(errorText(caught, 'The result history could not be loaded.'))
      // Even after the history was closed, a refusal says something about read access.
      if (!(unreleased && isHidApiError(caught) && caught.status === 404)) onRefused(caught)
    } finally { if (reading.current === mine) setLoading(false) }
  }
  function toggle() {
    if (open) { reading.current += 1; setOpen(false); setLoading(false); return }
    setOpen(true)
    void load()
  }
  return <Card>
    <CardHeader as="h2" icon={History} title={<>Preserved versions & amendments<span className="sr-only">: {execution.test.name}</span></>}
      actions={<>
        {open ? <Button size="sm" icon={RotateCcw} aria-busy={loading || undefined} aria-disabled={loading || undefined}
          onClick={() => { if (!loading) void load() }}>Refresh history</Button> : null}
        <Button size="sm" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={toggle}>{open ? 'Hide result history' : 'View result history'}</Button>
      </>} />
    <div id={panel} className="flex flex-col gap-3 p-5">
      {!open ? <p className="m-0 text-[14px] text-ink-2">Every version of this result is kept. View the history to read them.</p> : null}
      {open && loading ? <p role="status" className="m-0 text-[14px] text-ink-3">Loading result history…</p> : null}
      {open && error ? <Alert intent="error" size="sm">{error}</Alert> : null}
      {open && !loading && !error && history ? <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {history.revisions.map(entry => <li key={entry.version}><details className="rounded-lg ring-1 ring-inset ring-line">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-ink">Version {entry.version} · {RELEASE_WORDS[entry.releaseStatus]}
            {entry.verificationStatus === 'entered_in_error' ? ' · entered in error' : ''}{entry.correctionReason ? ` · ${entry.correctionReason}` : ''}</summary>
          <div className="px-4 pb-3"><DescriptionList items={[
            ['Value', `${revisionText(entry)}${entry.unit ? ` ${entry.unit}` : ''} · ${FLAG_WORDS[entry.abnormalFlag]}`],
            ['Entered', dateText(entry.enteredAt)],
            ['Checked', CHECK_WORDS[entry.verificationStatus]],
            entry.releasedAt ? ['Released', dateText(entry.releasedAt)] : null,
            entry.referenceRange ? ['Normal range', entry.referenceRange] : null,
            entry.correctionReason ? ['Reason', entry.correctionReason] : null,
          ]} /></div>
        </details></li>)}
      </ul> : null}
    </div>
  </Card>
}
