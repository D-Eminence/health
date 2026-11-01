import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { HidApiError, isHidApiError } from '@hid/http'
import { CheckCheck, Droplet, FlaskConical, History, PackageCheck, Play, RotateCcw, Save, Square, X } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet, FormActions, Value } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, Field, Input, Select, Textarea, cx } from '../../../kasuwa/ui'
import {
  staffApi, type LabAbnormalFlag, type LabAccession, type LabExecution, type LabResult, type LabResultRevision, type LabResultValue, type LabSpecimen,
  type LabWorkItem,
} from '../../../staff/api'
import { sampleCheckText } from '../../../staff/orderRoutes'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { ABNORMAL_FLAGS, FLAG_WORDS, flagFromRange, flagLevel, revisionText } from './labText'

/*
 * The lab's steps on one request, each the one thing to do at its stage, in the shared parts: register the sample (the
 * accession), collect it, receive it, start and finish the test, enter the result, then check and release it. Every
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
 * What a refused sample step says. Screens never repeat the server's words, so only the refusals the page words by their
 * code (errorText: a closed order, paused work, a workspace not in service, a fault between services) keep their
 * sentence, given the error without the server's message or the fields it names; anything else says `fallback`.
 */
function sampleProblem(caught: unknown, fallback: string, routed: boolean) {
  return isHidApiError(caught) ? errorText(new HidApiError(caught.status, fallback, { code: caught.code }), fallback, routed) : fallback
}

/**
 * The sample's first steps, each its own as on today's Laboratory page (staff/routes/Operations.tsx AccessionForm and
 * SpecimenAction): on a request with no accession yet, register the sample (the accession, with its type and why the
 * test is done), which needs only the right to register it; then each sample waiting is collected, confirmed against
 * the patient, or rejected before it is taken, each with its own note and by its own permission.
 */
export function CollectStep({ facilityId, permissions, subject, routed, onDone, onRefused, item, accession, defaultType, defaultReason, onRegistered }: StepBase & {
  readonly item: LabWorkItem
  readonly accession: LabAccession | null
  /** The sample the price list names for the test ("Blood, EDTA tube"), as the first guess. */
  readonly defaultType?: string | null
  readonly defaultReason?: string | null
  /** The accession this step made: the page holds it until the record is read by its new id, so it is never made twice. */
  readonly onRegistered: (accession: LabAccession) => void
}) {
  const required = accession?.specimens.filter(specimen => specimen.status === 'required') ?? []
  const rejected = accession?.specimens.filter(specimen => specimen.status === 'rejected') ?? []
  const base = { facilityId, permissions, subject, routed, onDone, onRefused }
  const test = item.testName ?? 'Lab test'

  if (accession && required.length === 0) return rejected.length > 0
    ? <p className="m-0 text-[15px] text-ink-2">The sample was rejected. Make a new request to take another.</p>
    : <p className="m-0 text-[15px] text-ink-2">Nothing to collect.</p>
  return <div className="flex flex-col gap-4">
    {routed && item.patient ? <Alert intent="warning" size="sm">{sampleCheckText(item.patient.fullName)}</Alert> : null}
    {accession ? required.map(specimen => <SpecimenForm key={`${specimen.id}-${specimen.version}`} {...base} specimen={specimen}
      accessionId={accession.id} test={test} />)
      : <RegisterForm {...base} item={item} defaultType={defaultType} defaultReason={defaultReason} onRegistered={onRegistered} />}
  </div>
}

function RegisterForm({ facilityId, permissions, routed, onDone, onRefused, item, defaultType, defaultReason, onRegistered }: StepBase & {
  readonly item: LabWorkItem; readonly defaultType?: string | null; readonly defaultReason?: string | null
  readonly onRegistered: (accession: LabAccession) => void
}) {
  const [type, setType] = useState(defaultType ?? '')
  const [reason, setReason] = useState(defaultReason ?? '')
  const [errors, setErrors] = useState<{ type?: string; reason?: string }>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  if (!permissions.includes('lab.accession.create')) return <p className="m-0 text-[15px] text-ink-2">Your role can’t register samples. Ask a colleague who can.</p>

  async function register(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found: typeof errors = {}
    if (!type.trim()) found.type = 'Choose or type the sample, like Blood.'
    if (!reason.trim()) found.reason = 'Say why the test is done, as on the request.'
    setErrors(found); setProblem('')
    const first = found.type ? 'lab-collect-type' : found.reason ? 'lab-collect-reason' : null
    if (first) { document.getElementById(first)?.focus(); return }
    // Registering takes nothing from the person: the patient is checked when each sample is collected.
    setBusy(true)
    try {
      onRegistered(await staffApi.createLabAccession(facilityId, item.id, type.trim(), reason.trim()))
      onDone('Sample registered. Print the label, then collect the sample.')
    } catch (caught) {
      setProblem(sampleProblem(caught, 'The sample could not be registered. Try again.', routed))
      onRefused(caught)
    } finally { setBusy(false) }
  }

  return <form className="@container flex flex-col gap-4" noValidate onSubmit={event => void register(event)}>
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
    <Problem text={problem} />
    <FormActions sticky={false}><Button type="submit" variant="primary" size="lg" icon={Droplet} loading={busy}>Register sample</Button></FormActions>
  </form>
}

// ------------------------------------------------------------- testing --
/** One sample in testing: receive it (or reject it), start its test, or finish the test running on it. */
export function TestingStep({ facilityId, permissions, subject, routed, onDone, onRefused, specimen, accessionId, executions, executionsRead }: StepBase & {
  readonly specimen: LabSpecimen; readonly accessionId: string
  readonly executions: readonly LabExecution[]; readonly executionsRead: boolean
}) {
  const running = executions.find(execution => execution.status === 'in_progress')
  const header = <SpecimenLine specimen={specimen} status={specimen.status === 'collected' ? 'Collected' : running ? 'Testing' : 'Received'} />
  const base = { facilityId, permissions, subject, routed, onDone, onRefused }
  if (specimen.status === 'collected') return <SpecimenForm {...base} specimen={specimen} accessionId={accessionId} />
  if (running) return <div className="flex flex-col gap-3">{header}<FinishForm {...base} execution={running} /></div>
  if (specimen.status === 'received' && (executions.length === 0 || !executionsRead)) return <div className="flex flex-col gap-3">{header}<StartForm {...base} specimen={specimen} /></div>
  return header
}

/** A sample's type, number and where it is. `labelId`: its type and number name the sample's own step (`${labelId}-type`, `-number`). */
function SpecimenLine({ specimen, status, labelId }: { readonly specimen: LabSpecimen; readonly status: string; readonly labelId?: string }) {
  return <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] text-ink">
    <FlaskConical className="size-4 text-ink-3" aria-hidden />
    <span id={labelId && `${labelId}-type`} className="font-medium">{specimen.specimenType}{labelId ? <span className="sr-only">,</span> : null}</span>
    <span id={labelId && `${labelId}-number`} className="text-ink-3 tabular">{specimen.specimenIdentifier}</span>
    <Badge size="sm">{status}</Badge>
  </p>
}

/**
 * Each sample's custody step, by its status, as on today's Laboratory page (SpecimenAction): one waiting is collected,
 * confirmed against the patient, and one collected is received. Either may be rejected instead, with why. Each action
 * has its own permission and its own note, so one sample's note is never sent for another.
 */
const CUSTODY_STEP = {
  required: {
    action: 'collect', permission: 'lab.specimen.collect', badge: 'To collect', field: 'Collection notes', fieldId: 'lab-collect-notes', placeholder: undefined,
    maxLength: 1000, button: 'Collect sample', icon: Droplet, done: 'Sample collected. Print the label.',
    cant: 'Your role can’t collect samples. Ask a colleague who can.',
  },
  collected: {
    action: 'receive', permission: 'lab.specimen.receive', badge: 'Collected', field: 'Condition on arrival', fieldId: 'lab-receive', placeholder: 'Good',
    maxLength: 500, button: 'Receive sample', icon: PackageCheck, done: 'Sample received. Start the test.', cant: 'Your role can’t receive samples.',
  },
} as const

function SpecimenForm({ facilityId, permissions, subject, routed, onDone, onRefused, specimen, accessionId, test = 'Lab test' }: StepBase & {
  readonly specimen: LabSpecimen; readonly accessionId: string; readonly test?: string
}) {
  const next = specimen.status === 'required' ? CUSTODY_STEP.required : CUSTODY_STEP.collected
  const [detail, setDetail] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const canStep = permissions.includes(next.permission)
  const canReject = permissions.includes('lab.specimen.reject')
  const id = specimen.id
  async function step(action: typeof next.action | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { setReasonError('Say why, like “Haemolysed” or “Not labelled”.'); document.getElementById(`lab-reject-${id}`)?.focus(); return }
    setBusy(true); setProblem('')
    try {
      await staffApi.transitionSpecimen(facilityId, accessionId, specimen, action, action === 'reject' ? reason.trim() : detail.trim())
      setAsking(false)
      onDone(action === 'reject' ? 'Sample rejected.' : next.done)
    } catch (caught) {
      setAsking(false)
      setProblem(sampleProblem(caught, 'The sample could not be updated. Refresh and try again.', routed))
      onRefused(caught)
    } finally { setBusy(false) }
  }
  // Grouped and named by its sample, so two samples' notes and buttons are told apart.
  return <div role="group" aria-labelledby={`lab-specimen-${id}-type lab-specimen-${id}-number`} className="flex flex-col gap-3">
    <SpecimenLine specimen={specimen} status={next.badge} labelId={`lab-specimen-${id}`} />
    {/* Without the step's own permission it is said plainly; rejecting, a permission of its own, may still be offered. */}
    {!canStep ? <p className="m-0 text-[15px] text-ink-2">{next.cant}</p> : null}
    {canStep || canReject ? <div className="flex flex-col gap-4">
      {canStep && !rejecting ? <Field label={next.field} htmlFor={`${next.fieldId}-${id}`} optional>
        <Input id={`${next.fieldId}-${id}`} value={detail} maxLength={next.maxLength} autoComplete="off" className="h-11" placeholder={next.placeholder}
          onChange={event => setDetail(event.target.value)} />
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
          : canStep ? <Button variant="primary" size="lg" icon={next.icon} loading={busy}
            onClick={() => { setProblem(''); if (next.action === 'collect') setAsking(true); else void step(next.action) }}>{next.button}</Button> : null}
      </FormActions>
    </div> : null}
    {next.action === 'collect' ? <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Collect the sample" subject={subject.banner} busy={busy}
      effect={<>Collect the <strong>{test}</strong> sample from <strong>{subject.name}</strong>?</>}
      undo="Check the name with the person before you take it." confirmLabel="Collect sample" onConfirm={() => void step('collect')} /> : null}
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

/**
 * Check & release: a second look at the result, then it is released to the patient's record. Verify first when it is
 * still unverified (Lab refuses a verify by the person who entered it: someone else checks), then release. Each is a
 * separate request with the review note as its reason.
 */
export function CheckStep({ facilityId, permissions, subject, routed, onDone, onRefused, execution }: StepBase & { readonly execution: LabExecution }) {
  const result = execution.result!
  const needsVerify = result.status === 'entered_unverified'
  const canVerify = permissions.includes('lab.result.verify')
  const canRelease = permissions.includes('lab.result.release')
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const id = execution.id
  const can = needsVerify ? canVerify : canRelease
  const label = needsVerify ? (canRelease ? 'Check & release' : 'Check result') : 'Release result'
  async function run() {
    if (busy) return
    if (!note.trim()) { setNoteError('Say what you checked, like “Matches the sample and the range”.'); document.getElementById(`lab-check-note-${id}`)?.focus(); return }
    setBusy(true); setProblem('')
    let current = result
    try {
      if (current.status === 'entered_unverified') current = await staffApi.verifyLabResult(facilityId, current, note.trim())
      if (current.status === 'verified_not_released' && canRelease) {
        current = await staffApi.releaseLabResult(facilityId, current, note.trim())
        setAsking(false); onDone(`${execution.test.name} released. The patient can see it on their Health ID.`)
      } else { setAsking(false); onDone(`${execution.test.name} checked. Someone who can release it does that next.`) }
    } catch (caught) {
      setProblem(errorText(caught, current !== result ? 'The result was checked but not released. Try again.' : 'The result could not be checked. Someone other than the person who entered it must check it.', routed))
      setAsking(false); onRefused(caught)
      if (current !== result) onDone('Result checked, not released yet.')
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
    {can ? <FormActions sticky={false}><Button variant="primary" size="lg" icon={CheckCheck} onClick={() => { setNote(''); setNoteError(''); setAsking(true) }}>{label}</Button></FormActions>
      : <p className="m-0 text-[14px] text-ink-2">{needsVerify ? 'Waiting for someone who can check results.' : 'Waiting for someone who can release results.'}</p>}
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title={label} subject={subject.banner} busy={busy}
      effect={<>{needsVerify ? 'Check' : 'Release'} the {execution.test.name} result for <strong>{subject.name}</strong>{needsVerify && canRelease ? ' and release it to their record' : ''}?</>}
      undo={canRelease ? 'Once released the patient sees it. A wrong result can be corrected; every version is kept.' : undefined}
      confirmLabel={label} onConfirm={() => void run()}>
      <Field label="What you checked" htmlFor={`lab-check-note-${id}`} error={noteError} errorId={`lab-check-note-${id}-error`}>
        <Textarea id={`lab-check-note-${id}`} rows={2} maxLength={500} value={note} aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? `lab-check-note-${id}-error` : undefined} onChange={event => { setNote(event.target.value); setNoteError('') }} />
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
