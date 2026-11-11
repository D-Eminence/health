import { isHidApiError } from '@hid/http'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import {
  ALLERGY_SEVERITIES, REACTION_LIMIT, REASON_LIMIT, REASON_MIN, SEVERITY_LABELS, SUBSTANCE_LIMIT,
  type AllergySeverity, type RecordedAllergy,
} from '../../../staff/allergies'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'

/** What the card shows: recorded allergies only when the EHR serves them (hid-system 0124; 404 before). */
export type AllergiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'hidden' }
  /** `recordedOffered` false: the read before 0124 (the patient-reported text) failed. */
  | { readonly status: 'failed'; readonly retry: () => void; readonly recordedOffered: boolean }
  | {
    readonly status: 'shown'
    /** False on a backend before 0124: the patient-reported text only, and nothing can be added. */
    readonly recordedOffered: boolean
    readonly recorded: readonly RecordedAllergy[]
    readonly patientReported: string | null
    readonly reportedAt: string | null
  }

/**
 * The patient's allergies for the chart, read afresh for each patient and facility: the recorded allergies with the
 * patient's own text (GET allergies, hid-system 0124); on a backend before 0124 (404), the patient's own text alone from
 * the reported health profile (0094). Direct care only, with ehr.note.read; nothing is shown while it loads, without that
 * permission, or when the EHR refuses (403) or serves neither read (404).
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
      const hidden = !isHidApiError(caught) || caught.status === 403 || caught.status === 404
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
        // Before 0124: the patient's own text only.
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

/** The patient's allergies on the chart: recorded by clinicians, then reported by the patient, each labelled. */
export function AllergiesCard({ chart }: { chart: Chart }) {
  const { state: allergies, reload } = useAllergies(chart)
  if (allergies.status === 'hidden' || allergies.status === 'loading') return null
  return (
    <Card aria-labelledby="allergies-card-title">
      <CardHeader as="h2" titleId="allergies-card-title" title="Allergies" icon={AlertTriangle} iconTone="danger" />
      {allergies.status === 'failed' ? (
        <p className="m-0 px-5 pb-4 text-sm text-ink">
          The patient’s allergies could not be loaded. Confirm allergies with the patient.{' '}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-ink underline underline-offset-2" onClick={allergies.retry}>
            Try again
          </button>
        </p>
      ) : <AllergyLists chart={chart} allergies={allergies} reload={reload} />}
    </Card>
  )
}

function AllergyLists({ chart, allergies, reload }: {
  chart: Chart; allergies: Extract<AllergiesState, { status: 'shown' }>; reload: () => void
}) {
  // Adding and marking are offered only where the EHR serves them, to a role that records notes, with access to add.
  const records = allergies.recordedOffered && chart.canWrite && chart.can('ehr.note.write')
  const active = allergies.recorded.filter(item => item.status === 'active')
  const reportedWhen = formatWhen(allergies.reportedAt)
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      {allergies.recordedOffered ? (
        <section aria-labelledby="allergies-recorded-title">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="allergies-recorded-title" className="m-0 text-[13px] font-semibold text-ink">Recorded by clinicians</h3>
            <Badge size="sm" tone="info">Clinician-recorded</Badge>
          </div>
          {active.length === 0
            ? <p className="m-0 mt-1 text-sm text-ink-3">No allergies recorded by clinicians.</p>
            : <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {active.map(item => <RecordedRow key={item.id} chart={chart} item={item} canMark={records && item.recordedHere} onChanged={reload} />)}
            </ul>}
        </section>
      ) : null}
      <section aria-labelledby="allergies-reported-title">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="allergies-reported-title" className="m-0 text-[13px] font-semibold text-ink">Reported by the patient</h3>
          <Badge size="sm" tone="warn">Patient-reported</Badge>
        </div>
        <p className="m-0 mt-1 text-[12px] text-ink-3">Entered by the patient in their Health ID portal, not clinically verified.{reportedWhen ? ` Last updated ${reportedWhen}.` : ''}</p>
        <p className="m-0 mt-1 text-sm break-words whitespace-pre-line text-ink">{allergies.patientReported ?? 'Nothing reported.'}</p>
      </section>
      {records ? <AddAllergy chart={chart} onAdded={reload} /> : null}
    </div>
  )
}

function RecordedRow({ chart, item, canMark, onChanged }: { chart: Chart; item: RecordedAllergy; canMark: boolean; onChanged: () => void }) {
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
      setError(refusalText(caught, 'The allergy could not be marked as entered in error. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-md border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{item.substance}</span>
        <Badge size="sm" tone={item.severity === 'severe' ? 'danger' : item.severity === 'moderate' ? 'warn' : 'neutral'}>{SEVERITY_LABELS[item.severity]}</Badge>
      </div>
      {item.reaction ? <p className="m-0 mt-0.5 text-sm text-ink">Reaction: {item.reaction}</p> : null}
      <p className="m-0 mt-0.5 text-[12px] text-ink-3">
        {item.recordedHere ? 'Recorded at this facility' : 'Recorded at another facility'}{item.createdAt ? ` on ${formatWhen(item.createdAt)}` : ''}.
      </p>
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
  const substanceId = useId()
  const reactionId = useId()
  const severityId = useId()

  async function add(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const input = { substance: substance.trim(), reaction: reaction.trim() || undefined, severity }
    const problems: typeof errors = {}
    if (!input.substance) problems.substance = 'Enter the medicine or substance.'
    if (!input.severity) problems.severity = 'Choose how severe the reaction is, or “Severity not known”.'
    setErrors(problems)
    if (problems.substance || problems.severity) return
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
      setErrors({ form: refusalText(caught, 'The allergy could not be recorded. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div role="status">{added ? <p className="m-0 text-sm text-success-ink">{added}</p> : null}</div>
      {!open ? <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setAdded('') }}>Add allergy</Button> : (
        <form className="flex flex-col gap-3" onSubmit={event => void add(event)} aria-label="Add allergy">
          <Field label="Medicine or substance" htmlFor={substanceId} error={errors.substance}>
            <Input id={substanceId} value={substance} maxLength={SUBSTANCE_LIMIT} onChange={event => setSubstance(event.target.value)} />
          </Field>
          <Field label="Reaction" optional htmlFor={reactionId} hint="For example: rash, swelling, difficulty breathing.">
            <Input id={reactionId} value={reaction} maxLength={REACTION_LIMIT} onChange={event => setReaction(event.target.value)} />
          </Field>
          <Field label="Severity" htmlFor={severityId} error={errors.severity}>
            <Select id={severityId} value={severity} onChange={event => setSeverity(event.target.value as AllergySeverity | '')}>
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
