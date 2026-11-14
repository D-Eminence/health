import { isHidApiError } from '@hid/http'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Card, CardHeader, Field, Input, Select, type Tone } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import {
  ALLERGY_ALREADY_ENTERED_IN_ERROR, ALLERGY_SEVERITIES, REACTION_LIMIT, REASON_LIMIT, REASON_MIN, SEVERITY_LABELS, SUBSTANCE_LIMIT,
  isNoKnownAllergy, type AllergySeverity, type RecordedAllergy,
} from '../../../staff/allergies'
import { refusalText } from '../../../staff/fieldProblem'
import { NOT_A_SUBSTANCE, isNotASubstanceRefusal } from '../parts/allergyWarning'
import type { Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'

/**
 * Each severity's badge (Ola, wording #9): severe in red; not known in amber, as moderate, never as quiet as mild (a
 * reaction nobody graded may have been severe). The severity's word is always on the badge, so colour is never alone.
 */
export const SEVERITY_TONES: Readonly<Record<AllergySeverity, Tone>> = { severe: 'danger', unknown: 'warn', moderate: 'warn', mild: 'neutral' }

/** Under Severity in the add form (Ola, wording #9). */
export const SEVERITY_HINT = 'Severe: anaphylaxis, swelling of the face, lips or throat, difficulty breathing, or a blistering skin rash. '
  + 'If you are not sure, choose “Severity not known”.'

/** The patient's own text is empty (Ola, wording #9): it says whose list is empty, never that the patient has no allergies. */
export const NOTHING_REPORTED = 'The patient has not entered any allergies in their Health ID portal.'

/** AllergyLines' words where nothing can be listed: never silence a reader could take for "no allergies". */
export const ALLERGIES_NOT_SHOWN = 'The patient’s allergies can’t be shown here. Confirm allergies with the patient.'
export const ALLERGIES_UNREAD = 'The patient’s allergies could not be loaded. Confirm allergies with the patient.'
const CONFIRM_ALLERGIES = 'Confirm allergies with the patient.'

/**
 * Marking an allergy entered in error was refused because it is no longer the allergy shown: 412 VERSION_CONFLICT (it
 * changed since the list was read) or 409 ALLERGY_ALREADY_ENTERED_IN_ERROR (someone marked it already). Sending the same
 * version again can never succeed, so the list is read again instead.
 */
export function allergyChangedSinceShown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  return (caught.code === 'VERSION_CONFLICT' && (caught.status === 412 || caught.status === 409))
    || allergyAlreadyEnteredInError(caught)
}

/** 409 ALLERGY_ALREADY_ENTERED_IN_ERROR: the allergy is marked entered in error already, by this request or another. */
export function allergyAlreadyEnteredInError(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 409 && caught.code === ALLERGY_ALREADY_ENTERED_IN_ERROR
}

/**
 * What the card says then, naming the allergy (its row may be gone once the list is read again). One already marked
 * entered in error is said to be so, never as one that "was not marked", which could read as still active.
 */
export function allergyChangedText(substance: string, alreadyEnteredInError = false): string {
  if (alreadyEnteredInError) {
    return `The allergy to ${substance} has already been marked as entered in error. The allergies have been loaded again.`
  }
  return `The allergy to ${substance} changed since it was shown, so it was not marked as entered in error. `
    + 'The allergies have been loaded again: check them before you try again.'
}

/** What the card shows: recorded allergies only when the EHR serves them (hid-system 0117; 404 before). */
export type AllergiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'hidden' }
  /** `recordedOffered` false: the read before 0117 (the patient-reported text) failed. */
  | { readonly status: 'failed'; readonly retry: () => void; readonly recordedOffered: boolean }
  | {
    readonly status: 'shown'
    /** False on a backend before 0117: the patient-reported text only, and nothing can be added. */
    readonly recordedOffered: boolean
    readonly recorded: readonly RecordedAllergy[]
    readonly patientReported: string | null
    readonly reportedAt: string | null
  }

/**
 * The patient's allergies for the chart, read afresh for each patient and facility: the recorded allergies with the
 * patient's own text (GET allergies, hid-system 0117); on a backend before 0117 (404), the patient's own text alone from
 * the reported health profile (0094). Direct care only, with ehr.note.read; 'hidden' without that permission, or when
 * the EHR refuses (403) or serves neither read (404). Any other failure, an answer that cannot be read included, is
 * 'failed', with Try again: never hidden, and never "no allergies".
 */
export function useAllergies(chart: Chart): { state: AllergiesState; reload: () => void } {
  const { facilityId, patientId, purpose } = chart
  const reads = purpose === 'direct-care' && chart.can('ehr.note.read')
  const [revision, setRevision] = useState(0)
  // Keyed on the patient and facility: an answer for another is never shown. A reload (revision) keeps showing the
  // last answer until the new one arrives, so the card does not blink away after a change.
  const scope = JSON.stringify([facilityId, patientId, purpose])
  const [answer, setAnswer] = useState<{ scope: string; state: AllergiesState } | null>(null)
  const reload = () => setRevision(value => value + 1)

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    const setState = (state: AllergiesState) => setAnswer({ scope, state })
    const failed = (recordedOffered: boolean) => (caught: unknown) => {
      if (controller.signal.aborted) return
      const hidden = isHidApiError(caught) && (caught.status === 403 || caught.status === 404)
      setState(hidden ? { status: 'hidden' } : { status: 'failed', recordedOffered, retry: () => setRevision(value => value + 1) })
    }
    void Promise.resolve().then(() => staffApi.allergies(facilityId, patientId, controller.signal)).then(
      list => {
        if (controller.signal.aborted) return
        // A missing or malformed answer is treated like any unexpected failure, never as "no allergies".
        if (!list || !Array.isArray(list.recorded) || !list.patientReported) return failed(true)(new Error('malformed allergies answer'))
        setState({ status: 'shown', recordedOffered: true, recorded: list.recorded,
          patientReported: list.patientReported.allergies, reportedAt: list.patientReported.updatedAt })
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        if (!isHidApiError(caught) || caught.status !== 404) return failed(true)(caught)
        // Before 0117: the patient's own text only.
        void Promise.resolve().then(() => staffApi.reportedHealthProfile(facilityId, patientId, controller.signal)).then(
          profile => {
            if (controller.signal.aborted) return
            setState({ status: 'shown', recordedOffered: false, recorded: [],
              patientReported: profile?.allergies ?? null, reportedAt: profile?.updatedAt ?? null })
          },
          failed(false),
        )
      },
    )
    return () => controller.abort()
  }, [reads, scope, facilityId, patientId, revision])

  if (!reads) return { state: { status: 'hidden' }, reload }
  if (answer?.scope !== scope) return { state: { status: 'loading' }, reload }
  return { state: answer.state, reload }
}

/** One recorded allergy in a line (Ola, wording #0): "Penicillin (severe: Anaphylaxis)", "Latex (severity not known)". */
export function recordedAllergyLine(item: RecordedAllergy): string {
  return `${item.substance} (${SEVERITY_LABELS[item.severity].toLowerCase()}${item.reaction ? `: ${item.reaction}` : ''})`
}

/**
 * The patient's allergies in a line or two, for a page where a clinician acts on them (triage, a new consultation): the
 * active allergies clinicians recorded, in the EHR's order (most serious first, never sorted again here), then what the
 * patient entered in their Health ID portal, labelled as theirs. On a backend before 0117 only the patient's text is
 * read, so nothing is said about recorded allergies. Nothing while it loads; otherwise always a line. A read that failed,
 * was refused or is not served says so and asks to confirm with the patient: an empty answer is the only "none".
 * `allergies` is useAllergies(chart).state.
 */
export function AllergyLines({ allergies, lineClassName }: { allergies: AllergiesState; lineClassName?: string }) {
  const className = lineClassName ? `hid-ehr-clinical-allergy-line ${lineClassName}` : 'hid-ehr-clinical-allergy-line'
  if (allergies.status === 'loading') return null
  if (allergies.status === 'hidden') return <p className={className}>{ALLERGIES_NOT_SHOWN}</p>
  if (allergies.status === 'failed') {
    return (
      <p className={className}>
        {ALLERGIES_UNREAD}{' '}
        <button type="button" className="hid-ehr-clinical-link hid-ehr-clinical-link-button" onClick={allergies.retry}>Try again</button>
      </p>
    )
  }
  const reported = allergies.patientReported
    ? `Allergies reported by the patient: ${allergies.patientReported} (entered by the patient in their Health ID portal, not clinically verified).`
    : NOTHING_REPORTED
  if (!allergies.recordedOffered) {
    return <p className={className}>{allergies.patientReported ? reported : `${reported} ${CONFIRM_ALLERGIES}`}</p>
  }
  const recorded = allergies.recorded.filter(item => item.status === 'active').map(recordedAllergyLine)
  const none = recorded.length === 0 && !allergies.patientReported
  return (
    <>
      <p className={className}>{recorded.length > 0 ? `Allergies recorded by clinicians: ${recorded.join('; ')}.` : 'Allergies recorded by clinicians: none.'}</p>
      <p className={className}>{none ? `${reported} ${CONFIRM_ALLERGIES}` : reported}</p>
    </>
  )
}

/** The patient's allergies on the chart: recorded by clinicians, then reported by the patient, each labelled. */
export function AllergiesCard({ chart }: { chart: Chart }) {
  const { state: allergies, reload } = useAllergies(chart)
  // Said when a change was refused because the allergy changed since it was shown: above the list, since the row it is
  // about may be gone once the list is read again, and only for the patient and facility it was said for. It takes focus
  // (the form it came from has closed), each time it is said.
  const scope = JSON.stringify([chart.facilityId, chart.patientId])
  const [changed, setChanged] = useState<{ text: string; scope: string; seq: number } | null>(null)
  const changedRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => { if (changed) changedRef.current?.focus() }, [changed])
  /** After a change: the list read again; `said`, the allergy changed since it was shown, else nothing to say. */
  const onChanged = (said?: string) => {
    setChanged(current => said ? { text: said, scope, seq: (current?.seq ?? 0) + 1 } : null)
    reload()
  }
  if (allergies.status === 'hidden' || allergies.status === 'loading') return null
  return (
    <Card aria-labelledby="allergies-card-title">
      <CardHeader as="h2" titleId="allergies-card-title" title="Allergies" icon={AlertTriangle} iconTone="danger" />
      {changed && changed.scope === scope ? (
        <p key={changed.seq} ref={changedRef} tabIndex={-1} className="m-0 px-5 pb-3 text-sm font-medium text-danger-ink">{changed.text}</p>
      ) : null}
      {allergies.status === 'failed' ? (
        <p className="m-0 px-5 pb-4 text-sm text-ink">
          The patient’s allergies could not be loaded. Confirm allergies with the patient.{' '}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-ink underline underline-offset-2" onClick={allergies.retry}>
            Try again
          </button>
        </p>
      ) : <AllergyLists chart={chart} allergies={allergies} onChanged={onChanged} />}
    </Card>
  )
}

function AllergyLists({ chart, allergies, onChanged }: {
  chart: Chart; allergies: Extract<AllergiesState, { status: 'shown' }>; onChanged: (said?: string) => void
}) {
  // Adding and marking are offered only where the EHR serves them, to a role that records notes, with access to add.
  const records = allergies.recordedOffered && chart.canWrite && chart.can('ehr.note.write')
  // In the EHR's order: active first, then severe, not known, moderate, mild, then newest first. Never sorted again here.
  const active = allergies.recorded.filter(item => item.status === 'active')
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      {allergies.recordedOffered ? (
        <section aria-labelledby="allergies-recorded-title">
          <RecordedHeading id="allergies-recorded-title" />
          {active.length === 0
            ? <p className="m-0 mt-1 text-sm text-ink-3">No allergies recorded by clinicians.</p>
            : <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {active.map(item => <RecordedRow key={item.id} chart={chart} item={item} canMark={records && item.recordedHere} onChanged={onChanged} />)}
            </ul>}
        </section>
      ) : null}
      <section aria-labelledby="allergies-reported-title">
        <ReportedHeading id="allergies-reported-title" />
        <p className="m-0 mt-1 text-[12px] text-ink-3">Entered by the patient in their Health ID portal, not clinically verified.{profileUpdated(allergies.reportedAt)}</p>
        <p className="m-0 mt-1 text-sm break-words whitespace-pre-line text-ink">{allergies.patientReported ?? NOTHING_REPORTED}</p>
      </section>
      {records ? <AddAllergy chart={chart} onAdded={() => onChanged()} /> : null}
    </div>
  )
}

/** The heading of the allergies clinicians recorded, with its source badge: the chart's card and the emergency summary alike. */
export function RecordedHeading({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 id={id} className="m-0 text-[13px] font-semibold text-ink">Recorded by clinicians</h3>
      <Badge size="sm" tone="info">Clinician-recorded</Badge>
    </div>
  )
}

/** The heading of the patient's own words, with its source badge: the chart's card and the emergency summary alike. */
export function ReportedHeading({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 id={id} className="m-0 text-[13px] font-semibold text-ink">Reported by the patient</h3>
      <Badge size="sm" tone="warn">Patient-reported</Badge>
    </div>
  )
}

/**
 * The date beside the patient's own words, said for what it is: " Health profile last updated 2 Oct 2026, 08:30." The EHR
 * gives the time the patient last changed any part of their health profile (blood group, medicines…), not only the
 * allergies, so it is never said as the allergies' date. Empty when there is none.
 */
export function profileUpdated(updatedAt: string | null): string {
  const when = formatWhen(updatedAt)
  return when ? ` Health profile last updated ${when}.` : ''
}

/**
 * One recorded allergy, as the chart's card and the emergency summary show it: the substance, its severity in words on
 * a badge in its tone (SEVERITY_TONES), the reaction, and where and when it was recorded. Reading only.
 */
export function RecordedAllergyFacts({ item }: {
  item: Pick<RecordedAllergy, 'substance' | 'severity' | 'reaction' | 'recordedHere'> & { readonly recordedOn: string | null }
}) {
  const when = formatWhen(item.recordedOn)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.substance}</span>
        <Badge size="sm" tone={SEVERITY_TONES[item.severity]}>{SEVERITY_LABELS[item.severity]}</Badge>
      </div>
      {item.reaction ? <p className="m-0 mt-0.5 text-sm text-ink [overflow-wrap:anywhere]">Reaction: {item.reaction}</p> : null}
      <p className="m-0 mt-0.5 text-[12px] text-ink-3">
        {item.recordedHere ? 'Recorded at this facility' : 'Recorded at another facility'}{when ? ` on ${when}` : ''}.
      </p>
    </>
  )
}

function RecordedRow({ chart, item, canMark, onChanged }: {
  chart: Chart; item: RecordedAllergy; canMark: boolean; onChanged: (said?: string) => void
}) {
  const [marking, setMarking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reasonId = useId()

  async function mark(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const trimmed = reason.trim()
    if (trimmed.length < REASON_MIN) {
      setError('Say why this allergy was recorded in error.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await chart.verify()
      await staffApi.markAllergyEnteredInError(chart.facilityId, chart.patientId, item.id,
        { expectedRowVersion: item.rowVersion, reason: trimmed })
      setMarking(false)
      onChanged()
    } catch (caught) {
      if (allergyChangedSinceShown(caught)) {
        // Not the allergy shown any more: the same version sent again would be refused every time. The form closes (what
        // was written stays, should it still be needed), the list is read again with each allergy's current version,
        // and the card says why above it: changed since it was shown, or already marked entered in error.
        setMarking(false)
        onChanged(allergyChangedText(item.substance, allergyAlreadyEnteredInError(caught)))
        return
      }
      setError(refusalText(caught, 'The allergy could not be marked as entered in error. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-md border border-line px-3 py-2">
      <RecordedAllergyFacts item={{ ...item, recordedOn: item.createdAt }} />
      {canMark && !marking ? (
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => { setMarking(true); setError('') }}>Mark as entered in error</Button>
      ) : null}
      {canMark && marking ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={event => void mark(event)}>
          <Field label="Why was this recorded in error?" htmlFor={reasonId} error={error || undefined}>
            <Input id={reasonId} value={reason} maxLength={REASON_LIMIT} onChange={event => setReason(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" aria-busy={busy || undefined} aria-disabled={busy || undefined}>Mark as entered in error</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMarking(false); setReason(''); setError('') }}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function AddAllergy({ chart, onAdded }: { chart: Chart; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [substance, setSubstance] = useState('')
  const [reaction, setReaction] = useState('')
  const [severity, setSeverity] = useState<AllergySeverity | ''>('')
  const [errors, setErrors] = useState<{ substance?: string; severity?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState('')
  const key = useRef<{ signature: string; value: string } | null>(null)
  // The field to move focus to once its error is drawn, so it is read out with the error it points to.
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null)
  const substanceId = useId()
  const reactionId = useId()
  const severityId = useId()
  const substanceErrorId = `${substanceId}-error`
  const reactionHintId = `${reactionId}-hint`
  const severityHintId = `${severityId}-hint`
  const severityErrorId = `${severityId}-error`

  // In the commit that draws the error, so focus and the error it points to arrive together.
  useLayoutEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus()
  }, [focusRequest])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const input = { substance: substance.trim(), reaction: reaction.trim() || undefined, severity }
    const problems: typeof errors = {}
    if (!input.substance) problems.substance = 'Enter the medicine or substance.'
    // "NKDA", "No known allergies", "none" and the like: the EHR refuses them (400 ALLERGY_NOT_A_SUBSTANCE); said here first.
    else if (isNoKnownAllergy(input.substance)) problems.substance = NOT_A_SUBSTANCE
    if (!input.severity) problems.severity = 'Choose how severe the reaction is, or “Severity not known”.'
    setErrors(problems)
    if (problems.substance || problems.severity) {
      setFocusRequest({ id: problems.substance ? substanceId : severityId })
      return
    }
    // One Idempotency-Key per attempt: the same allergy sent again is the same record.
    const signature = JSON.stringify(input)
    if (key.current?.signature !== signature) key.current = { signature, value: crypto.randomUUID() }
    setBusy(true)
    setAdded('')
    try {
      await chart.verify()
      await staffApi.addAllergy(chart.facilityId, chart.patientId,
        { substance: input.substance, ...(input.reaction ? { reaction: input.reaction } : {}), severity: input.severity as AllergySeverity }, key.current.value)
      key.current = null
      setSubstance('')
      setReaction('')
      setSeverity('')
      setOpen(false)
      setAdded(`Allergy to ${input.substance} recorded.`)
      onAdded()
    } catch (caught) {
      if (isNotASubstanceRefusal(caught)) {
        // The EHR's own list may hold a phrase this page's copy does not: its words, said at the field, never its detail.
        setErrors({ substance: NOT_A_SUBSTANCE })
        setFocusRequest({ id: substanceId })
      } else {
        setErrors({ form: refusalText(caught, 'The allergy could not be recorded. Please try again.') })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div role="status">{added ? <p className="m-0 text-sm text-success-ink">{added}</p> : null}</div>
      {!open ? <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setAdded('') }}>Add allergy</Button> : (
        <form className="flex flex-col gap-3" onSubmit={event => void add(event)} aria-label="Add allergy">
          <Field label="Medicine or substance" htmlFor={substanceId} error={errors.substance} errorId={substanceErrorId}>
            <Input id={substanceId} value={substance} maxLength={SUBSTANCE_LIMIT} onChange={event => setSubstance(event.target.value)}
              aria-invalid={errors.substance ? true : undefined} aria-describedby={errors.substance ? substanceErrorId : undefined} />
          </Field>
          <Field label="Reaction" optional htmlFor={reactionId} hint="For example: rash, swelling, difficulty breathing." hintId={reactionHintId}>
            <Input id={reactionId} value={reaction} maxLength={REACTION_LIMIT} onChange={event => setReaction(event.target.value)} aria-describedby={reactionHintId} />
          </Field>
          {/* The hint says what severe means and when to choose "Severity not known"; an error takes its place. */}
          <Field label="Severity" htmlFor={severityId} error={errors.severity} errorId={severityErrorId} hint={SEVERITY_HINT} hintId={severityHintId}>
            <Select id={severityId} value={severity} onChange={event => setSeverity(event.target.value as AllergySeverity | '')}
              aria-invalid={errors.severity ? true : undefined} aria-describedby={errors.severity ? severityErrorId : severityHintId}>
              <option value="">Choose…</option>
              {ALLERGY_SEVERITIES.map(value => <option key={value} value={value}>{SEVERITY_LABELS[value]}</option>)}
            </Select>
          </Field>
          {errors.form ? <p className="m-0 text-sm font-medium text-danger-ink" role="alert">{errors.form}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" aria-busy={busy || undefined} aria-disabled={busy || undefined}>Record allergy</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setErrors({}) }}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
