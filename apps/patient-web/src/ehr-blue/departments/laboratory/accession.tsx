import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode,
  type RefObject,
} from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  staffApi, type LabAbnormalFlag, type LabAccession, type LabExecution, type LabResult, type LabResultRevision, type LabResultValue,
  type LabSpecimen, type LabWorkItem,
} from '../../../staff/api'
import { FieldInputError } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { revisionValue } from '../../../staff/labRevisions'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { DeptFacts, DeptRecordLayout, type DeptFact } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { patientLabel } from '../parts/routedWork'
import { useConfirm } from '../../clinical/parts/confirm'
import { LabActionButton, LabActions, statusWord } from './labParts'

/*
 * An accession and everything recorded on it: its samples' custody, their processing (analytical executions) and
 * manual results with their verification, publication (release), correction and history. The logic is today's
 * Laboratory page's (staff/routes/Operations.tsx AccessionView and the parts it uses), unchanged: the same requests,
 * permissions, re-checks of read access and refusals. Only the look and the words follow the target.
 */

/** Whether the accession shown is work from an order another facility sent: its writes may be refused as closed. */
const RoutedAccession = createContext(false)

/** Who the lab work is for: their name, and their banner for the confirm sheet before a save (wrong-patient prevention). */
export interface LabSubject { readonly name: string; readonly banner: ReactNode }
const LabSubjectContext = createContext<LabSubject | null>(null)

/** Before saving: the patient (compact banner) and what saving does, Confirm or Cancel. Resolves true with no subject. */
function useConfirmLabPatient() {
  const subject = useContext(LabSubjectContext)
  const { ask, sheet } = useConfirm()
  const confirm = (effect: (name: string) => string, confirmLabel: string) =>
    subject ? ask({ subject: subject.banner, effect: effect(subject.name), confirmLabel }) : Promise.resolve(true)
  return { confirm, sheet }
}

/**
 * A reference range as a lab writes it ("12-16", "12 – 16", "<5", "≤ 5", ">10"), as its bounds; null when it can't be
 * read as numbers (then no flag is set from it).
 */
export function parseRange(range: string): { low?: number; high?: number } | null {
  const text = range.trim().replace(/,/g, '.')
  const between = /^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i.exec(text)
  if (between) return { low: Number(between[1]), high: Number(between[2]) }
  const below = /^(?:<|≤|<=)\s*(-?\d+(?:\.\d+)?)/.exec(text)
  if (below) return { high: Number(below[1]) }
  const above = /^(?:>|≥|>=)\s*(-?\d+(?:\.\d+)?)/.exec(text)
  if (above) return { low: Number(above[1]) }
  return null
}

/** The flag a number earns against its reference range, or null when either is missing or unreadable. */
export function flagFromRange(value: string, range: string): LabAbnormalFlag | null {
  const number = value.trim() === '' ? NaN : Number(value)
  const bounds = parseRange(range)
  if (!Number.isFinite(number) || !bounds) return null
  if (bounds.low !== undefined && number < bounds.low) return 'low'
  if (bounds.high !== undefined && number > bounds.high) return 'high'
  return 'normal'
}

/** A result's status in the target's words. */
const RESULT_STATUS: Record<LabResult['status'], string> = {
  entered_unverified: 'draft result', verified_not_released: 'verified', released: 'published', entered_in_error: 'entered in error',
}

/** A revision's release state in the target's words. */
const RELEASE_STATUS: Record<LabResultRevision['releaseStatus'], string> = {
  not_released: 'not published', verified_not_released: 'verified, not published', released: 'published',
}

function executionStatus(status: LabExecution['status']) {
  return status === 'in_progress' ? 'processing' : statusWord(status)
}

/** The value of a result revision with its flag: "7.1 g/dL · low". */
function valueLine(revision: LabResultRevision) {
  return `${revisionValue(revision).trim()} · ${FLAG_WORDS[revision.abnormalFlag] ?? statusWord(revision.abnormalFlag)}`
}

export function AccessionForm({ facilityId, item, subject, onCreated }: {
  readonly facilityId: string; readonly item: LabWorkItem; readonly subject?: LabSubject; readonly onCreated: (accession: LabAccession) => void
}) {
  return <LabSubjectContext.Provider value={subject ?? null}><AccessionFormFields facilityId={facilityId} item={item} onCreated={onCreated} /></LabSubjectContext.Provider>
}

function AccessionFormFields({ facilityId, item, onCreated }: {
  readonly facilityId: string; readonly item: LabWorkItem; readonly onCreated: (accession: LabAccession) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const asking = useRef(false)
  const { confirm, sheet } = useConfirmLabPatient()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy || asking.current) return
    const form = new FormData(event.currentTarget)
    const specimenType = String(form.get('specimenType') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError(''); problems.clear()
    if (!specimenType || !reason) return problems.refuse(!specimenType ? 'lab-specimen-type' : 'lab-accession-reason', 'Complete this field.')
    asking.current = true
    let confirmed = false
    try { confirmed = await confirm(name => `Create an accession for ${name}’s ${specimenType} sample?`, 'Create accession') }
    finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    try { onCreated(await staffApi.createLabAccession(facilityId, item.id, specimenType, reason)) }
    catch (caught) { setError(errorText(caught, 'The accession could not be created.')) }
    finally { setBusy(false) }
  }
  return <form className="hid-ehr-dept-action-form" aria-label="Create accession" noValidate onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">{item.testName ?? 'Lab test'} · {item.patient?.fullName ?? patientLabel(item)}</p>
    <EhrField label={<>Sample type<span aria-hidden="true"> *</span></>} controlId="lab-specimen-type" error={problems.error('lab-specimen-type')}>
      <EhrInput name="specimenType" maxLength={240} placeholder="Blood, urine, swab…" required />
    </EhrField>
    <EhrField label={<>Clinical reason<span aria-hidden="true"> *</span></>} controlId="lab-accession-reason" error={problems.error('lab-accession-reason')}>
      <EhrTextarea name="reason" maxLength={500} required />
    </EhrField>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Creating…' : 'Create accession'}</EhrButton></div>
    {sheet}
  </form>
}

type SpecimenActionKind = 'collect' | 'receive' | 'reject'

const SPECIMEN_STEP: Record<SpecimenActionKind, string> = { collect: 'Collect sample', receive: 'Receive sample', reject: 'Reject sample' }
const SPECIMEN_STEP_DONE: Record<SpecimenActionKind, string> = {
  collect: 'Sample collected.', receive: 'Sample received.', reject: 'Sample rejected.',
}

/** The custody steps a sample in this state takes, of those the member may record. */
function specimenSteps(specimen: LabSpecimen, permissions: readonly string[]): SpecimenActionKind[] {
  const actions: SpecimenActionKind[] = specimen.status === 'required'
    ? ['collect', 'reject'] : specimen.status === 'collected' ? ['receive', 'reject'] : []
  return actions.filter(action => permissions.includes(`lab.specimen.${action}`))
}

function SpecimenStepForm({ facilityId, accessionId, specimen, action, onStarted, onChanged, onRefused }: {
  readonly facilityId: string; readonly accessionId: string; readonly specimen: LabSpecimen; readonly action: SpecimenActionKind
  readonly onStarted: () => void; readonly onChanged: (message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const routed = useContext(RoutedAccession)
  const detailId = `lab-detail-${specimen.id}`
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const detail = String(new FormData(event.currentTarget).get('detail') ?? '').trim()
    setError(''); problems.clear()
    if (action === 'reject' && !detail) return problems.refuse(detailId, 'Complete this field.')
    setBusy(true); onStarted()
    try { await staffApi.transitionSpecimen(facilityId, accessionId, specimen, action, detail); onChanged(SPECIMEN_STEP_DONE[action]) }
    catch (caught) { setError(errorText(caught, 'The sample could not be updated. Refresh and try again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  const label = action === 'reject' ? 'Reason' : action === 'collect' ? 'Collection notes' : 'Condition on receipt'
  return <form className="hid-ehr-dept-action-form" aria-label={SPECIMEN_STEP[action]} noValidate onSubmit={event => void submit(event)}>
    <EhrField label={<>{label}{action === 'reject' ? <span aria-hidden="true"> *</span> : null}</>} controlId={detailId} error={problems.error(detailId)}>
      <EhrInput name="detail" maxLength={action === 'collect' ? 1000 : 500} required={action === 'reject'} />
    </EhrField>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : SPECIMEN_STEP[action]}</EhrButton></div>
  </form>
}

/** A sample's own card: its title (focused after a step), its status and what is known of it. */
function SpecimenCard({ specimen, actions, children }: {
  readonly specimen: LabSpecimen; readonly actions?: ReactNode; readonly children?: ReactNode
}) {
  return <DeptSection headingId={`lab-specimen-${specimen.id}-title`} title={`Sample ${specimen.specimenIdentifier}`}
    actions={<div className="hid-ehr-dept-table-actions">{actions}<EhrBadge>{statusWord(specimen.status)}</EhrBadge></div>}>
    <DeptFacts facts={[{ label: 'Sample type', value: specimen.specimenType }, { label: 'Sample identifier', value: specimen.specimenIdentifier },
      { label: 'Status', value: statusWord(specimen.status) }]} />
    {children}
  </DeptSection>
}

/** The actions card of a sample awaiting collection or receipt: collect, receive or reject it. */
function SpecimenActions({ facilityId, accessionId, specimen, permissions, onStarted, onChanged, onRefused }: {
  readonly facilityId: string; readonly accessionId: string; readonly specimen: LabSpecimen; readonly permissions: readonly string[]
  readonly onStarted: () => void; readonly onChanged: (message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const allowed = specimenSteps(specimen, permissions)
  const [open, setOpen] = useState<SpecimenActionKind | null>(null)
  const shown = open && allowed.includes(open) ? open : null
  return <LabActions none={allowed.length === 0} title={<>{'Available actions '}<span className="hid-ehr-sr-only">for sample {specimen.specimenIdentifier}</span></>}>
    {allowed.map((action, index) => <LabActionButton key={action} id={index === 0 ? `lab-action-${specimen.id}` : undefined}
      open={shown === action} onToggle={() => setOpen(current => current === action ? null : action)}>{SPECIMEN_STEP[action]}</LabActionButton>)}
    {shown && <SpecimenStepForm key={shown} facilityId={facilityId} accessionId={accessionId} specimen={specimen} action={shown}
      onStarted={onStarted} onChanged={onChanged} onRefused={onRefused} />}
  </LabActions>
}

const abnormalFlags: readonly LabAbnormalFlag[] = ['unknown', 'normal', 'high', 'low', 'abnormal', 'critical_candidate']

/** Each flag in plain words. */
const FLAG_WORDS: Readonly<Record<LabAbnormalFlag, string>> = {
  unknown: 'Not set', normal: 'Normal', high: 'High', low: 'Low', abnormal: 'Abnormal', critical_candidate: 'Possibly critical',
}

/** The result entered under `id` (an execution's), or a FieldInputError naming the field refused. */
function resultValue(form: FormData, resultType: 'numeric' | 'text', id: string): LabResultValue {
  const unit = String(form.get('unit') ?? '').trim()
  const referenceRange = String(form.get('referenceRange') ?? '').trim()
  const flag = String(form.get('abnormalFlag') ?? 'unknown')
  if (!abnormalFlags.includes(flag as LabAbnormalFlag)) throw new FieldInputError(`lab-flag-${id}`, 'Choose a flag from the list.')
  const shared = {
    ...(unit ? { unit } : {}), ...(referenceRange ? { referenceRange } : {}),
    abnormalFlag: flag as LabAbnormalFlag,
  }
  if (resultType === 'numeric') {
    const raw = String(form.get('numericValue') ?? '').trim()
    if (!raw || !Number.isFinite(Number(raw))) throw new FieldInputError(`lab-numeric-${id}`, 'Enter a number.')
    // A number without its unit can't be read safely (mg/dL or mmol/L?): the unit is required.
    if (!unit) throw new FieldInputError(`lab-unit-${id}`, 'Enter the unit, like g/dL or mmol/L.')
    return { resultType, numericValue: Number(raw), ...shared }
  }
  const textValue = String(form.get('textValue') ?? '').trim()
  if (!textValue) throw new FieldInputError(`lab-text-${id}`, 'Complete this field.')
  return { resultType, textValue, ...shared }
}

/** "Save draft result" (no result yet) or "Correct result" (a new, unverified version of the one recorded). */
function ResultEntry({ facilityId, execution, result, label, onStarted, onChanged, onRefused }: {
  readonly facilityId: string; readonly execution: LabExecution; readonly result: LabResult | null; readonly label: string
  readonly onStarted: () => void; readonly onChanged: (value: LabResult, message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  const [resultType, setResultType] = useState<'numeric' | 'text'>(current?.resultType ?? 'numeric')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const routed = useContext(RoutedAccession)
  const id = execution.id
  // The value, range and flag are held here so the flag can follow the range: set from it while it hasn't been chosen
  // by hand, and still changeable.
  const [numeric, setNumeric] = useState(current?.resultType === 'numeric' && current.numericValue != null ? String(current.numericValue) : '')
  const [range, setRange] = useState(current?.referenceRange ?? '')
  const [flag, setFlag] = useState<string>(current?.abnormalFlag ?? 'unknown')
  const [flagChosen, setFlagChosen] = useState(Boolean(current))
  const asking = useRef(false)
  const { confirm, sheet } = useConfirmLabPatient()
  const follow = (nextValue: string, nextRange: string) => {
    if (flagChosen || resultType !== 'numeric') return
    const fromRange = flagFromRange(nextValue, nextRange)
    if (fromRange) setFlag(fromRange)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || asking.current) return
    const form = new FormData(event.currentTarget)
    setError(''); problems.clear()
    let value: LabResultValue
    try { value = resultValue(form, resultType, id) }
    catch (caught) {
      if (caught instanceof FieldInputError) problems.refuse(caught.field, caught.message)
      else setError(errorText(caught, 'Enter a valid result.'))
      return
    }
    const reason = String(form.get('reason') ?? '').trim()
    if (result && !reason) return problems.refuse(`lab-result-reason-${id}`, 'Complete this field.')
    asking.current = true
    let confirmed = false
    try { confirmed = await confirm(name => result ? `Save this corrected result for ${name}?` : `Save this result for ${name}?`, result ? 'Save correction' : 'Save result') }
    finally { asking.current = false }
    if (!confirmed) return
    setBusy(true); onStarted()
    try {
      const updated = result
        ? await staffApi.correctLabResult(facilityId, execution, result, value, reason,
          String(form.get('revisionKind')) === 'amendment' ? 'amendment' : 'correction')
        : await staffApi.enterLabResult(facilityId, execution, value)
      onChanged(updated, result ? 'Corrected result saved as a new draft version.' : 'Draft result saved.')
    } catch (caught) { setError(errorText(caught, 'The result could not be saved. Refresh before trying again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="hid-ehr-dept-action-form" aria-label={label} noValidate onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">{result ? 'A correction is saved as a new draft version. Earlier and published versions are kept.'
      : 'The result stays a draft until someone else verifies it.'}</p>
    <EhrField label="Result type" controlId={`lab-result-type-${id}`}>
      <EhrSelect value={resultType} onChange={event => setResultType(event.target.value as 'numeric' | 'text')}>
        <option value="numeric">Number</option><option value="text">Text</option>
      </EhrSelect>
    </EhrField>
    {resultType === 'numeric'
      ? <EhrField label={<>Result value<span aria-hidden="true"> *</span></>} controlId={`lab-numeric-${id}`} error={problems.error(`lab-numeric-${id}`)}>
        <EhrInput name="numericValue" type="number" step="any" required value={numeric}
          onChange={event => { setNumeric(event.target.value); follow(event.target.value, range) }} />
      </EhrField>
      : <EhrField label={<>Result value<span aria-hidden="true"> *</span></>} controlId={`lab-text-${id}`} error={problems.error(`lab-text-${id}`)}>
        <EhrTextarea name="textValue" maxLength={4000} required
          defaultValue={current?.resultType === 'text' ? current.textValue ?? '' : ''} />
      </EhrField>}
    <div className="hid-ehr-dept-form-grid">
      <EhrField label={resultType === 'numeric' ? <>Unit<span aria-hidden="true"> *</span></> : 'Unit'} controlId={`lab-unit-${id}`} error={problems.error(`lab-unit-${id}`)}>
        <EhrInput name="unit" maxLength={80} placeholder="g/dL" required={resultType === 'numeric'} defaultValue={current?.unit ?? ''} />
      </EhrField>
      <EhrField label="Reference range" controlId={`lab-range-${id}`} hint="Like 12-16. The flag is set from it.">
        <EhrInput name="referenceRange" maxLength={240} value={range}
          onChange={event => { setRange(event.target.value); follow(numeric, event.target.value) }} />
      </EhrField>
    </div>
    <EhrField label="Flag" controlId={`lab-flag-${id}`} error={problems.error(`lab-flag-${id}`)}
      hint={!flagChosen && resultType === 'numeric' && flagFromRange(numeric, range) ? 'Set from the reference range. You can change it.' : undefined}>
      <EhrSelect name="abnormalFlag" value={flag} onChange={event => { setFlag(event.target.value); setFlagChosen(true) }}>
        {abnormalFlags.map(option => <option key={option} value={option}>{FLAG_WORDS[option]}</option>)}
      </EhrSelect>
    </EhrField>
    {result && <>
      <EhrField label="Type of change" controlId={`lab-revision-kind-${id}`}>
        <EhrSelect name="revisionKind"><option value="correction">Correction</option><option value="amendment">Amendment</option></EhrSelect>
      </EhrField>
      <EhrField label={<>Reason<span aria-hidden="true"> *</span></>} controlId={`lab-result-reason-${id}`} error={problems.error(`lab-result-reason-${id}`)}>
        <EhrTextarea name="reason" maxLength={500} required />
      </EhrField>
    </>}
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : label}</EhrButton></div>
    {sheet}
  </form>
}

/** "Verify result" or "Publish result" (release) of the result's current version, with a reason. */
function ResultGovernance({ facilityId, result, action, onStarted, onChanged, onRefused }: {
  readonly facilityId: string; readonly result: LabResult; readonly action: 'verify' | 'release'; readonly onStarted: () => void
  readonly onChanged: (value: LabResult, message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const routed = useContext(RoutedAccession)
  const reasonId = `lab-${action}-reason-${result.id}`
  const label = action === 'verify' ? 'Verify result' : 'Publish result'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setError(''); problems.clear()
    if (!reason) return problems.refuse(reasonId, 'Complete this field.')
    setBusy(true); onStarted()
    try {
      const value = action === 'verify'
        ? await staffApi.verifyLabResult(facilityId, result, reason)
        : await staffApi.releaseLabResult(facilityId, result, reason)
      onChanged(value, action === 'verify' ? `Version ${result.currentVersion} verified.` : `Version ${result.currentVersion} published.`)
    } catch (caught) { setError(errorText(caught, 'The decision could not be saved. Refresh before trying again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="hid-ehr-dept-action-form" aria-label={label} noValidate onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">{action === 'verify'
      ? `Verify version ${result.currentVersion} after an independent review. The person who entered it cannot verify it.`
      : `Publish verified version ${result.currentVersion} so the care team and the patient can see it.`}</p>
    <EhrField label={<>{action === 'verify' ? 'Review note' : 'Reason'}<span aria-hidden="true"> *</span></>} controlId={reasonId} error={problems.error(reasonId)}>
      <EhrTextarea name="reason" maxLength={500} required />
    </EhrField>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : label}</EhrButton></div>
  </form>
}

/** "Complete processing": completes an execution in progress, with optional notes. */
function CompleteForm({ facilityId, execution, onStarted, onChanged, onRefused }: {
  readonly facilityId: string; readonly execution: LabExecution; readonly onStarted: () => void
  readonly onChanged: (value: LabExecution, message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const routed = useContext(RoutedAccession)
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim()
    setBusy(true); setError(''); onStarted()
    try { onChanged(await staffApi.completeLabExecution(facilityId, execution, notes), 'Processing completed.') }
    catch (caught) { setError(errorText(caught, 'Processing could not be completed. Refresh before trying again.', routed)); onRefused(caught) }
    finally { setBusy(false) }
  }
  return <form className="hid-ehr-dept-action-form" aria-label="Complete processing" noValidate onSubmit={event => void complete(event)}>
    <EhrField label="Completion notes" controlId={`lab-completion-${execution.id}`}>
      <EhrTextarea name="notes" maxLength={1000} />
    </EhrField>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Completing…' : 'Complete processing'}</EhrButton></div>
  </form>
}

/** "Preserved versions & amendments": a result's history, read only when opened. */
function ResultHistory({ facilityId, result, title, onRefused }: {
  readonly facilityId: string; readonly result: LabResult; readonly title: string; readonly onRefused: (error: unknown) => void
}) {
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
        if (active) setError(errorText(caught, 'The result history could not be loaded.'))
        // Even after the history was closed, a refusal says something about read access.
        if (!(unreleased && isHidApiError(caught) && caught.status === 404)) onRefused(caught)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, result.id, result.currentVersion, unreleased, open, revision, onRefused])
  return <DeptSection title={<>Preserved versions & amendments<span className="hid-ehr-sr-only">: {title}</span></>}
    actions={<div className="hid-ehr-dept-table-actions">
      {open && <EhrButton variant="secondary" size="sm" busy={loading} onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh history</EhrButton>}
      <EhrButton variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide result history' : 'View result history'}</EhrButton>
    </div>}>
    {!open && <p className="hid-ehr-dept-muted">Every version of this result is kept. View the history to read them.</p>}
    {open && <>
      {loading && <p className="hid-ehr-dept-muted" role="status">Loading result history…</p>}
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      {!loading && !error && history && history.revisions.map(entry => <details key={entry.version} className="hid-ehr-dept-history">
        <summary>Version {entry.version} · {RELEASE_STATUS[entry.releaseStatus]}{entry.verificationStatus === 'entered_in_error' ? ' · entered in error' : ''}
          {entry.correctionReason ? ` · ${entry.correctionReason}` : ''}</summary>
        <div className="hid-ehr-dept-history-detail">
          <DeptFacts facts={[
            { label: 'Value', value: valueLine(entry) },
            { label: 'Entered', value: dateText(entry.enteredAt) },
            { label: 'Verification', value: statusWord(entry.verificationStatus) },
            ...(entry.releasedAt ? [{ label: 'Published', value: dateText(entry.releasedAt) }] : []),
            ...(entry.referenceRange ? [{ label: 'Reference range', value: entry.referenceRange }] : []),
            ...(entry.correctionReason ? [{ label: 'Reason', value: entry.correctionReason }] : []),
          ]} />
        </div>
      </details>)}
    </>}
  </DeptSection>
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

export const LAB_RESULTS_HIDDEN: Record<LabResultsHiddenReason, string> = {
  denied: 'You can’t see lab results for this patient right now. They stay hidden until your access is back.',
  unverified: 'Lab results are hidden because access to them could not be checked right now. Refresh to check again.',
  signedOut: 'Lab results are hidden because your session has ended. Sign in again to view them.',
}

/** Sent to every sample card of the accession; `seq` makes each raise a new signal. */
interface LabResultsSignal { reason: LabResultsHiddenReason; seq: number }

type ExecutionActionKind = 'complete' | 'enter' | 'verify' | 'release' | 'correct'

/** What can be done on an execution and its result, in the target's order, of what the member may do. */
function executionActions(execution: LabExecution, permissions: readonly string[]): ExecutionActionKind[] {
  const result = execution.result
  const actions: ExecutionActionKind[] = []
  if (execution.status === 'in_progress' && permissions.includes('lab.execution.complete')) actions.push('complete')
  if (execution.status === 'completed' && !result && permissions.includes('lab.result.enter')) actions.push('enter')
  if (result?.status === 'entered_unverified' && permissions.includes('lab.result.verify')) actions.push('verify')
  if (result?.status === 'verified_not_released' && permissions.includes('lab.result.release')) actions.push('release')
  if (result && permissions.includes('lab.result.correct')
    && (result.currentReleasedVersion !== result.currentVersion || permissions.includes('lab.result.revise-released'))) actions.push('correct')
  return actions
}

function executionActionLabel(action: ExecutionActionKind, result: LabResult | null) {
  if (action === 'complete') return 'Complete processing'
  if (action === 'enter') return 'Save draft result'
  if (action === 'verify') return 'Verify result'
  if (action === 'release') return 'Publish result'
  return result?.status === 'released' ? 'Correct published result' : 'Correct result'
}

/** What is known of one execution and its result, for the sample's card. */
function executionFacts(execution: LabExecution): DeptFact[] {
  const result = execution.result
  const current = result?.revisions.find(revision => revision.version === result.currentVersion)
  return [
    { label: 'Test', value: <span id={`lab-execution-${execution.id}-title`} tabIndex={-1}>{execution.test.name} · {execution.test.codeSystem} {execution.test.code}</span> },
    { label: 'Processing', value: executionStatus(execution.status) },
    { label: 'Started', value: dateText(execution.startedAt) },
    ...(execution.completedAt ? [{ label: 'Completed', value: dateText(execution.completedAt) }] : []),
    ...(execution.method ? [{ label: 'Method', value: execution.method }] : []),
    { label: 'Processing version', value: String(execution.version) },
    ...(result ? [{ label: 'Result', value: `${RESULT_STATUS[result.status]} · version ${result.currentVersion}` }] : []),
    ...(current ? [{ label: 'Value', value: valueLine(current) }] : []),
    ...(current?.referenceRange ? [{ label: 'Reference range', value: current.referenceRange }] : []),
  ]
}

/** A received sample: its processing and results, their actions, and each result's history. */
function ExecutionPanel({ facilityId, specimen, permissions, generation, recheck, resultsHidden, onResultsHidden }: {
  readonly facilityId: string; readonly specimen: LabSpecimen; readonly permissions: readonly string[]; readonly generation: RefObject<number>
  readonly recheck: LabResultsSignal | null; readonly resultsHidden: LabResultsSignal | null
  readonly onResultsHidden: (reason: LabResultsHiddenReason) => void
}) {
  const canRead = permissions.includes('lab.execution.read')
  const canStart = permissions.includes('lab.execution.start')
  const routed = useContext(RoutedAccession)
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
  // The action whose form is open in this sample's actions card.
  const [open, setOpen] = useState<string | null>(null)
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
  // Every sample in the accession belongs to the same patient, so the others hide too.
  const endAccess = useCallback((reason: LabResultsHiddenReason) => { hideResults(reason); onResultsHidden(reason) }, [hideResults, onResultsHidden])
  useEffect(() => { if (resultsHidden) hideResults(resultsHidden.reason) }, [resultsHidden, hideResults])
  // A sample step failed with a doubt. A reader re-reads below; without
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
    setNotice(message); setOpen(null)
    focus(`lab-execution-${value.id}-title`, true)
    if (canRead) setRevision(current => current + 1)
  }
  function changedResult(executionId: string, value: LabResult, message: string) {
    if (stale()) return
    const confirmedIn = confirmed.current
    setResults(previous => previous && { items: previous.items.map(item => item.id === executionId ? { ...item, result: value } : item), generation: confirmedIn })
    setNotice(message); setOpen(null)
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
    if (!reason) return startProblems.refuse(`lab-start-reason-${specimen.id}`, 'Complete this field.')
    setBusy(true); setNotice('')
    try { changedExecution(await staffApi.startLabExecution(facilityId, specimen, reason, method), 'Processing started.') }
    catch (caught) { setStartError(errorText(caught, 'Processing could not be started. Refresh the sample first.', routed)); recheckAccess(caught) }
    finally { setBusy(false) }
  }
  const offerStart = canStart && !loading && !error && (items?.length === 0 || (!canRead && !items))
  const several = (items?.length ?? 0) > 1
  const actions = (items ?? []).flatMap(execution => executionActions(execution, permissions)
    .map(action => ({ key: `${action}:${execution.id}`, action, execution })))
  const shown = open === 'start' && offerStart ? 'start' : actions.find(entry => entry.key === open) ?? null
  const toggle = (key: string) => setOpen(current => current === key ? null : key)
  const readers = (items ?? []).filter(execution => execution.result && permissions.includes('lab.result.released.read'))
  return <>
    <DeptRecordLayout
      main={<SpecimenCard specimen={specimen} actions={canRead && <EhrButton variant="secondary" size="sm" busy={loading}
        onClick={() => { if (loading) return; setNotice(''); setRevision(value => value + 1) }}>Refresh processing</EhrButton>}>
        <h3>Processing</h3>
        {/* Mounted throughout, so what a step records is announced; it says so through the read that follows. */}
        <div id={`lab-executions-status-${specimen.id}`} role="status">{notice
          ? <p className="hid-ehr-dept-laboratory-success">{notice}</p> : loading && <p className="hid-ehr-dept-muted">Loading processing…</p>}</div>
        {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
        {items?.map(execution => <DeptFacts key={execution.id} className="hid-ehr-dept-laboratory-execution" facts={executionFacts(execution)} />)}
        {canRead && !loading && !error && items?.length === 0 && !canStart && <p className="hid-ehr-dept-muted">No processing has started for this sample.</p>}
        {canStart && !canRead && !loading && !error && !items && <p className="hid-ehr-dept-muted">Start processing once this sample is ready.</p>}
      </SpecimenCard>}
      // "No further actions" only once the read has settled and access is confirmed: while it loads, or once the results
      // are hidden (which always sets `error`), the status region and the alert say what is happening instead.
      aside={<LabActions none={!loading && !error && !offerStart && actions.length === 0}
        title={<>{'Available actions '}<span className="hid-ehr-sr-only">for sample {specimen.specimenIdentifier}</span></>}>
        {offerStart && <LabActionButton id={`lab-start-${specimen.id}`} open={shown === 'start'} onToggle={() => toggle('start')}>Start processing</LabActionButton>}
        {actions.map(entry => <LabActionButton key={entry.key} open={shown !== 'start' && shown?.key === entry.key} onToggle={() => toggle(entry.key)}>
          {executionActionLabel(entry.action, entry.execution.result)}{several ? ` · ${entry.execution.test.name}` : ''}</LabActionButton>)}
        {shown === 'start' && <form className="hid-ehr-dept-action-form" aria-label="Start processing" noValidate onSubmit={event => void start(event)}>
          <p className="hid-ehr-dept-muted">Start analysis of this received sample. Health ID checks the sample’s version and the patient’s permission.</p>
          <EhrField label="Method" controlId={`lab-method-${specimen.id}`}>
            <EhrInput name="method" maxLength={240} />
          </EhrField>
          <EhrField label={<>Processing details<span aria-hidden="true"> *</span></>} controlId={`lab-start-reason-${specimen.id}`}
            error={startProblems.error(`lab-start-reason-${specimen.id}`)}>
            <EhrTextarea name="reason" maxLength={500} required />
          </EhrField>
          {startError && <DeptNotice tone="critical" role="alert">{startError}</DeptNotice>}
          <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>{busy ? 'Starting…' : 'Start processing'}</EhrButton></div>
        </form>}
        {shown && shown !== 'start' && <ExecutionActionForm key={shown.key} facilityId={facilityId} execution={shown.execution} action={shown.action}
          label={executionActionLabel(shown.action, shown.execution.result)} onStarted={stepStarted} onExecutionChanged={changedExecution}
          onResultChanged={(value, message) => changedResult(shown.execution.id, value, message)} onRefused={recheckAccess} />}
      </LabActions>}
    />
    {readers.map(execution => execution.result && <ResultHistory key={execution.id} facilityId={facilityId} result={execution.result}
      title={`${execution.test.name}, sample ${specimen.specimenIdentifier}`} onRefused={recheckAccess} />)}
  </>
}

function ExecutionActionForm({ facilityId, execution, action, label, onStarted, onExecutionChanged, onResultChanged, onRefused }: {
  readonly facilityId: string; readonly execution: LabExecution; readonly action: ExecutionActionKind; readonly label: string
  readonly onStarted: () => void; readonly onExecutionChanged: (value: LabExecution, message: string) => void
  readonly onResultChanged: (value: LabResult, message: string) => void; readonly onRefused: (error: unknown) => void
}) {
  const result = execution.result
  if (action === 'complete') return <CompleteForm facilityId={facilityId} execution={execution} onStarted={onStarted} onChanged={onExecutionChanged} onRefused={onRefused} />
  if (action === 'enter') return <ResultEntry facilityId={facilityId} execution={execution} result={null} label={label} onStarted={onStarted}
    onChanged={onResultChanged} onRefused={onRefused} />
  if (!result) return null
  if (action === 'correct') return <ResultEntry key={`${result.id}-${result.currentVersion}`} facilityId={facilityId} execution={execution}
    result={result} label={label} onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />
  return <ResultGovernance facilityId={facilityId} result={result} action={action} onStarted={onStarted} onChanged={onResultChanged} onRefused={onRefused} />
}

/** The Lab permissions that write on an accession: its samples' steps, executions and results. */
const LAB_WRITE_PERMISSIONS: ReadonlySet<string> = new Set(['lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject',
  'lab.execution.start', 'lab.execution.complete', 'lab.result.enter', 'lab.result.correct', 'lab.result.revise-released',
  'lab.result.verify', 'lab.result.release'])

/**
 * An accession. On work from an order another facility sent (`routed`) that no longer lets this laboratory record on it
 * (`closed`: routeClosedForWork), it is shown to be read: every sample step, execution and result write is left out, as
 * the services refuse them, and it says so; what was recorded can still be read while the order lets it.
 */
export function AccessionView({ facilityId, id, permissions: granted, created, routed = false, closed = false, subject, onChanged }: {
  readonly facilityId: string; readonly id: string; readonly permissions: readonly string[]; readonly created?: string
  readonly routed?: boolean; readonly closed?: boolean; readonly onChanged: () => void
  /** Who the work is for, confirmed before a result is saved. */
  readonly subject?: LabSubject
}) {
  const permissions = useMemo(() => closed ? granted.filter(permission => !LAB_WRITE_PERMISSIONS.has(permission)) : granted,
    [closed, granted])
  // An accession is shown only for the reload it came from, so a reload removes every
  // sample at once and each panel reads its results once, when it mounts again.
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
  // A sample step reloads the accession, which removes every sample until it is read
  // again; focus goes to the sample's next step, or the sample, in the commit that shows it.
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
  // A sample step that fails with a doubt re-checks in place: the accession is read
  // again and every panel re-reads its results, while the step keeps its error and input.
  // A failed read hides the results as usual; a failed accession read removes it all.
  const specimenRefused = useCallback((caught: unknown) => {
    const doubt = labResultsReadDoubt(caught)
    if (doubt) setRecheck(previous => ({ reason: doubt, seq: (previous?.seq ?? 0) + 1 }))
  }, [])
  useLayoutEffect(() => {
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
      .catch(caught => { if (active) { setLoaded(null); setError(errorText(caught, 'The accession could not be loaded.')) } })
      .finally(() => {
        if (!active) return
        setLoading(false)
        if (creation.current) { setNotice(creation.current); creation.current = undefined }
      })
    return () => { active = false }
  }, [facilityId, id, revision, recheck])
  return <LabSubjectContext.Provider value={subject ?? null}><RoutedAccession.Provider value={routed}>
    <DeptSection title="Accession" headingId="lab-accession-title" className="hid-ehr-dept-laboratory-accession"
      actions={<EhrButton id="lab-accession-refresh" variant="secondary" size="sm" busy={loading}
        onClick={() => { if (loading) return; setNotice(''); reload() }}>Refresh accession</EhrButton>}>
      {closed && <DeptNotice tone="caution">This order from another facility has ended, so nothing more can be recorded on it. You can
        still read what was recorded.</DeptNotice>}
      {/* Mounted throughout, so what a step records is announced; it says so through the read that follows. */}
      <div id="lab-accession-status" role="status">{notice
        ? <p className="hid-ehr-dept-laboratory-success">{notice}</p> : loading && <p className="hid-ehr-dept-muted">Loading accession…</p>}</div>
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      {accession && <DeptFacts facts={[{ label: 'Accession number', value: accession.accessionNumber },
        { label: 'Samples', value: String(accession.specimens.length) }]} />}
    </DeptSection>
    {accession?.specimens.map(specimen => {
      const executions = specimen.status === 'received' && (permissions.includes('lab.execution.read') || permissions.includes('lab.execution.start'))
      return <div className="hid-ehr-dept-stack" key={`${specimen.id}-${specimen.status}`}>
        {executions
          ? <ExecutionPanel facilityId={facilityId} specimen={specimen} permissions={permissions} generation={generation} recheck={recheck}
            resultsHidden={resultsHidden} onResultsHidden={hideResults} />
          : <DeptRecordLayout main={<SpecimenCard specimen={specimen} />}
            aside={<SpecimenActions facilityId={facilityId} accessionId={id} specimen={specimen} permissions={permissions}
              onStarted={() => setNotice('')} onChanged={message => { specimenChanged(specimen, message); onChanged() }}
              onRefused={specimenRefused} />} />}
      </div>
    })}
  </RoutedAccession.Provider></LabSubjectContext.Provider>
}
