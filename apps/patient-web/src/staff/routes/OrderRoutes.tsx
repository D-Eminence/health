import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Field, Select } from '@hid/ui'
import {
  orderRoutesApi, type OrderDestination, type OrderRouteAttestation, type OrderRouteDispensing, type OrderRouteKind,
  type OrderRouteResult, type OrderRouteSummary, type OrderRouteView, type OrderRouteWithdrawReason,
} from '../api'
import { OrderDestinationPicker } from '../components/OrderDestinationPicker'
import {
  attestedText, controlledMedicineNote, destinationWord, fillAttestation, ORDERS_NOT_AVAILABLE, ORDERS_PAUSED, orderWord,
  paused, routeDay, routeMissing, routeStatusText, routeWaiting, sendRefusal, sensitiveTestNote, unavailableText, urgentNote,
  WITHDRAW_REASONS, withdrawRefusal, wrongPatientNotice,
} from '../orderRoutes'
import { UNAVAILABLE } from '../focus'

/**
 * Sending a lab request or prescription to a laboratory or pharmacy at another facility, from the clinical record
 * (Novu, P4c, SPEC-FINAL §3.5, §13.1): the facility from the directory, the clinician's attestation that the patient
 * agreed (Health ID's current text, with the names filled), and the notes the order needs. Then the order's row says
 * where it went, what became of it and what came back.
 */

/** What the send form holds: the facility chosen, the attestation text read, and whether it was ticked. */
export interface DestinationChoice {
  destination: OrderDestination | null
  attestation: OrderRouteAttestation | null
  attested: boolean
}

export const NO_DESTINATION: DestinationChoice = { destination: null, attestation: null, attested: false }

/** The names the attestation is filled with, and what the notes need. */
export interface RouteContext {
  facilityId: string
  /** The working facility, which sends. */
  orderingFacility: string
  /** The patient as the record names them. */
  patient: string
}

/** Why a send can't go yet, at the field to fix: the facility, then the tick. */
export function choiceProblem(choice: DestinationChoice, kind: OrderRouteKind): { field: 'destination' | 'attested'; text: string } | null {
  if (!choice.destination) return { field: 'destination', text: `Choose the ${destinationWord(kind)} the patient will use.` }
  if (!choice.attestation) return { field: 'attested', text: 'The confirmation could not be loaded yet. Wait for it, or try again.' }
  if (!choice.attested) return { field: 'attested', text: 'Tick the box to confirm that the patient agreed.' }
  return null
}

/** Why the attestation text could not be read. */
function attestationProblem(error: unknown): string {
  if (paused(error)) return ORDERS_PAUSED
  if (routeMissing(error)) return ORDERS_NOT_AVAILABLE
  if (isHidApiError(error) && error.status === 403) return 'Your role at this facility can’t send orders to other facilities.'
  return 'The confirmation could not be loaded. Try again.'
}

/**
 * The facility and the attestation. The attestation text is read when the fields open, and again after
 * `reloadAttestation` changes (the EHR refused an outdated one): the tick is cleared each time, so what is confirmed is
 * the text shown.
 */
export function OrderDestinationFields({ id, context, kind, priority, value, onChange, reloadAttestation = 0, errors = {} }: {
  id: string; context: RouteContext; kind: OrderRouteKind; priority?: string
  value: DestinationChoice; onChange: Dispatch<SetStateAction<DestinationChoice>>; reloadAttestation?: number
  errors?: { destination?: string; attested?: string }
}) {
  const [loadError, setLoadError] = useState('')
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let active = true
    setLoadError('')
    onChange(current => ({ ...current, attestation: null, attested: false }))
    void orderRoutesApi.attestation(context.facilityId, kind)
      .then(attestation => {
        if (!active) return
        if (typeof attestation?.version !== 'string' || typeof attestation.text !== 'string') {
          setLoadError('The confirmation could not be loaded. Try again.')
          return
        }
        onChange(current => ({ ...current, attestation, attested: false }))
      })
      .catch(caught => { if (active) setLoadError(attestationProblem(caught)) })
    return () => { active = false }
  }, [context.facilityId, kind, reloadAttestation, asked, onChange])

  const facility = value.destination?.facilityName ?? ''
  const where = destinationWord(kind)
  return <div className="staff-stack staff-order-send">
    <OrderDestinationPicker id={`${id}-destination`} facilityId={context.facilityId} kind={kind === 'lab_request' ? 'laboratory' : 'pharmacy'}
      value={value.destination} error={errors.destination}
      onChange={destination => onChange(current => ({ ...current, destination, attested: false }))} />
    {loadError && <div className="staff-stack"><p className="staff-error" role="alert">{loadError}</p>
      <div className="staff-row"><Button tone="secondary" size="sm" onClick={() => setAsked(count => count + 1)}>Load the confirmation again</Button></div></div>}
    {!loadError && !value.attestation && <p className="staff-muted" role="status">Loading the confirmation…</p>}
    {value.attestation && !value.destination && <p className="staff-muted">Choose the {where}, then confirm that the patient agreed.</p>}
    {value.attestation && value.destination && <>
      <label className="staff-choice staff-attestation"><input id={`${id}-attested`} type="checkbox" checked={value.attested}
        aria-describedby={[errors.attested ? `${id}-attested-error` : '', `${id}-attested-note`].filter(Boolean).join(' ')}
        aria-invalid={errors.attested ? true : undefined}
        onChange={event => { const attested = event.target.checked; onChange(current => ({ ...current, attested })) }} />
        <span>{fillAttestation(value.attestation.text, { patient: context.patient, orderingFacility: context.orderingFacility,
          receivingFacility: facility })}</span></label>
      {errors.attested && <p id={`${id}-attested-error`} className="staff-error">{errors.attested}</p>}
      <p id={`${id}-attested-note`} className="staff-muted">Health ID records that you confirmed this, with your name and the time.
        {' '}{context.patient} is told in the Health ID app and can stop it until {facility} accepts it.</p>
      {kind === 'lab_request'
        ? <ul className="staff-order-notes">
          <li>{facility} sees the clinical information only after it accepts. Write only what the laboratory needs.</li>
          <li>{sensitiveTestNote(facility, context.patient)}</li>
          {(priority === 'asap' || priority === 'stat') && <li>{urgentNote(facility)}</li>}
        </ul>
        : <ul className="staff-order-notes">
          <li>{facility} sees your instructions only after it accepts.</li>
          <li>{controlledMedicineNote(facility)}</li>
        </ul>}
    </>}
    {errors.attested && !(value.attestation && value.destination) && <p id={`${id}-attested-error`} className="staff-error">{errors.attested}</p>}
  </div>
}

/** One Idempotency-Key per send attempt: pressed again after no answer, it is the same send. */
interface SendAttempt { readonly signature: string; readonly key: string }

/**
 * "Send to another laboratory" / "Send to a pharmacy" under a saved order. `onSend` sends at the order's version and
 * answers what to say; a refusal that means the wording changed reloads it, cleared, to be confirmed again.
 */
export function SendToFacility({ id, kind, context, priority, onSend }: {
  id: string; kind: OrderRouteKind; context: RouteContext; priority?: string
  onSend: (destination: OrderDestination, attestationTextVersion: string, key: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<DestinationChoice>(NO_DESTINATION)
  const [errors, setErrors] = useState<{ destination?: string; attested?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const attempt = useRef<SendAttempt | null>(null)
  const label = kind === 'lab_request' ? 'Send to another laboratory' : 'Send to a pharmacy'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setErrors({})
    const problem = choiceProblem(choice, kind)
    if (problem) {
      setErrors({ [problem.field]: problem.text })
      document.getElementById(problem.field === 'destination' ? `${id}-destination-query` : `${id}-attested`)?.focus()
      return
    }
    const destination = choice.destination!
    const version = choice.attestation!.version
    const signature = JSON.stringify([destination.facilityId, version])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      await onSend(destination, version, attempt.current.key)
      attempt.current = null
    } catch (caught) {
      const refusal = sendRefusal(caught, kind, destination.facilityName, context.patient)
      // A refusal that settles the attempt frees its key; only an unanswered one keeps it for the same send.
      if (isHidApiError(caught) && caught.status < 500 && caught.status !== 0 && caught.status !== 408) attempt.current = null
      if (refusal.outdated) setReload(count => count + 1)
      setError(refusal.text)
    } finally { setBusy(false) }
  }

  if (!open) return <div className="staff-row"><Button id={`${id}-open`} tone="secondary" size="sm" aria-expanded={false}
    onClick={() => setOpen(true)}>{label}</Button></div>
  return <form className="staff-form staff-order-route-form" onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`}>{label}</strong>
    <OrderDestinationFields id={id} context={context} kind={kind} priority={priority} value={choice} onChange={setChoice}
      reloadAttestation={reload} errors={errors} />
    {error && <p className="staff-error" role="alert">{error}</p>}
    <div className="staff-row">
      <Button id={`${id}-send`} type="submit" size="sm" aria-disabled={busy || undefined} className={UNAVAILABLE}>
        {busy ? 'Sending…' : choice.destination ? `Send to ${choice.destination.facilityName}` : 'Send'}</Button>
      <Button tone="quiet" size="sm" onClick={() => { setOpen(false); setChoice(NO_DESTINATION); setError(''); setErrors({}) }}>Cancel</Button>
    </div>
  </form>
}

/** "120 mmol/L, flagged high, reference 70-110" from a result copied back. */
function resultValue(result: OrderRouteResult): string {
  const value = result.resultType === 'text' ? result.textValue ?? '' : result.numericValue === null ? '' : String(result.numericValue)
  const flag = result.abnormalFlag && !['normal', 'unknown'].includes(result.abnormalFlag)
    ? `, flagged ${result.abnormalFlag === 'critical_candidate' ? 'possibly critical' : result.abnormalFlag}` : ''
  return `${[value, result.unit ?? ''].filter(Boolean).join(' ')}${flag}${result.referenceRange ? `, reference ${result.referenceRange}` : ''}`
}

/** A result's versions in the order the laboratory made them. */
function byVersion(first: OrderRouteResult, second: OrderRouteResult): number {
  const versions = (first.resultVersion ?? 0) - (second.resultVersion ?? 0)
  return versions !== 0 ? versions : (first.occurredAt ?? '').localeCompare(second.occurredAt ?? '')
}

/** When a result first came back, to put results in the order they arrived. */
function firstReturned(reports: readonly OrderRouteResult[]): string {
  return reports.map(report => report.occurredAt ?? '').sort()[0] ?? ''
}

/**
 * One result's lines (C3 reports one row per released version, and one per version marked entered in error, each with
 * its resultId and resultVersion). The value to use is said first: the latest version, or, when that version was marked
 * entered in error, that no value of the result stands and which value is void. Each earlier version follows, newest
 * first, marked as replaced by the correction that followed it, so a superseded value never reads as a plain release.
 */
function resultGroupLines(reports: readonly OrderRouteResult[], facility: string): string[] {
  const named = reports.find(report => report.test.name)?.test.name
  const releases = reports.filter(report => report.kind !== 'entered_in_error').sort(byVersion)
  const voids = reports.filter(report => report.kind === 'entered_in_error')
  // An invalidation that names no version is taken to void the whole result: never a reason to trust a value.
  const voidsAll = voids.find(report => report.resultVersion === null)
  const voidOf = (release: OrderRouteResult) => voidsAll
    ?? voids.find(report => report.resultVersion !== null && report.resultVersion === release.resultVersion)
  // "Haemoglobin (replaced): …", or "Replaced: …" for a result whose test has no name.
  const label = (state: string) => named ? `${named}${state ? ` (${state})` : ''}: `
    : state ? `${state.charAt(0).toUpperCase()}${state.slice(1)}: ` : ''
  const released = (release: OrderRouteResult) => `Released by ${facility} on ${routeDay(release.occurredAt)}: ${resultValue(release)}`
  if (releases.length === 0) {
    // A version marked entered in error whose release never came back here: there is no value to name.
    return voids.map(report => `${label('do not use')}Marked entered in error by ${facility} on ${routeDay(report.occurredAt)}: do not use it.`)
  }
  const latest = releases[releases.length - 1]!
  const latestVoid = voidOf(latest)
  const corrected = latest.revisionKind !== null && latest.revisionKind !== 'original'
  const lines: string[] = []
  if (latestVoid) {
    lines.push(`${label('do not use')}Marked entered in error by ${facility} on ${routeDay(latestVoid.occurredAt)}: the value released on `
      + `${routeDay(latest.occurredAt)}, ${resultValue(latest)}. No value of this result stands: contact ${facility}.`)
  } else if (releases.length === 1) {
    lines.push(`${label('')}${released(latest)}${corrected && latest.correctionReason
      ? `. Corrected on ${routeDay(latest.occurredAt)}: ${latest.correctionReason}` : ''}`)
  } else {
    lines.push(`${label('current result')}${released(latest)}. Corrected on ${routeDay(latest.occurredAt)}`
      + `${latest.correctionReason ? `: ${latest.correctionReason}` : '.'}`)
  }
  for (let index = releases.length - 2; index >= 0; index -= 1) {
    const earlier = releases[index]!
    const voided = voidOf(earlier)
    lines.push(`${label('replaced')}${released(earlier)}. Replaced by the correction of ${routeDay(releases[index + 1]!.occurredAt)}`
      + `${voided && voided !== latestVoid ? `, and marked entered in error on ${routeDay(voided.occurredAt)}` : ''}: do not use it.`)
  }
  return lines
}

/** The reports of each result, result by result in the order they first came back. */
function resultGroups(results: readonly OrderRouteResult[]): OrderRouteResult[][] {
  const groups = new Map<string, OrderRouteResult[]>()
  results.forEach((result, index) => {
    const key = result.resultId ?? `unidentified-${index}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  })
  return [...groups.values()].sort((first, second) => firstReturned(first).localeCompare(firstReturned(second)))
}

/**
 * What came back from the laboratory (SPEC-FINAL §13.1 "Returns"), result by result in the order they first came back.
 * A correction is a new version of the same result, so the reports are grouped by result: see resultGroupLines.
 */
function resultLines(results: readonly OrderRouteResult[], facility: string): string[] {
  return resultGroups(results).flatMap(reports => resultGroupLines(reports, facility))
}

/** A result line of an order the laboratory ended as accepted for the wrong person, and the value it withdrew. */
interface WithdrawnLine { readonly key: string; readonly text: string; readonly value: string | null }

/**
 * The results of a route the laboratory ended as accepted for someone who was not the patient (item 3, D19, §9.2): each
 * version it released reads "{test} (do not use): another person's result, withdrawn by {B} on {date}", newest first. The
 * value is another person's, so it is not shown unless asked for (WithdrawnResults); a version withdrawn before it came
 * back has no value to show.
 */
function withdrawnResultLines(results: readonly OrderRouteResult[], facility: string, endedAt: string | null): WithdrawnLine[] {
  return resultGroups(results).flatMap((reports, group): WithdrawnLine[] => {
    const named = reports.find(report => report.test.name)?.test.name
    const label = named ? `${named} (do not use)` : 'Do not use'
    const releases = reports.filter(report => report.kind !== 'entered_in_error').sort(byVersion).reverse()
    const voids = reports.filter(report => report.kind === 'entered_in_error')
    const voidOf = (release: OrderRouteResult) => voids.find(report => report.resultVersion === null)
      ?? voids.find(report => report.resultVersion !== null && report.resultVersion === release.resultVersion)
    const withdrawn = (on: string | null | undefined) => `${label}: another person’s result, withdrawn by ${facility} on `
      + `${routeDay(on ?? endedAt)}.`
    if (releases.length === 0) {
      return voids.map((report, index) => ({ key: `${group}-void-${index}`, text: withdrawn(report.occurredAt), value: null }))
    }
    return releases.map((release, index) => ({ key: `${group}-${release.resultVersion ?? index}`,
      text: withdrawn(voidOf(release)?.occurredAt),
      value: `Released by ${facility} on ${routeDay(release.occurredAt)}: ${resultValue(release)}` }))
  })
}

/** The lines of withdrawn results, each value hidden until "Show the withdrawn value" is pressed (D19). */
function WithdrawnResults({ id, lines }: { id: string; lines: readonly WithdrawnLine[] }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  return <ul className="staff-order-notes staff-withdrawn-results">{lines.map(line => {
    const open = shown.has(line.key)
    const valueId = `${id}-value-${line.key}`
    return <li key={line.key}><span>{line.text}</span>
      {line.value && <>{' '}<Button tone="quiet" size="sm" aria-expanded={open} aria-controls={open ? valueId : undefined}
        onClick={() => setShown(current => {
          const next = new Set(current)
          if (open) next.delete(line.key)
          else next.add(line.key)
          return next
        })}>{open ? 'Hide the withdrawn value' : 'Show the withdrawn value'}</Button>
        {open && <span id={valueId} className="staff-withdrawn-value"> {line.value}</span>}</>}
    </li>
  })}</ul>
}

function dispensingLines(dispensings: readonly OrderRouteDispensing[], facility: string): string[] {
  return [...dispensings].sort((first, second) => (first.occurredAt ?? '').localeCompare(second.occurredAt ?? '')).map(item =>
    item.kind === 'reversed'
      ? `Dispensing reversed on ${routeDay(item.occurredAt)}: contact ${facility}.`
      : `Dispensed by ${facility}: ${[item.quantityDispensed === null ? '' : String(item.quantityDispensed), item.quantityUnit ?? ''].filter(Boolean).join(' ') || 'quantity not recorded'} on ${routeDay(item.occurredAt)}${item.medication.display ? ` (${item.medication.display})` : ''}.`)
}

/** What a refused read of an order's routes means. */
function viewProblem(error: unknown): string {
  if (routeMissing(error)) return ORDERS_NOT_AVAILABLE
  if (isHidApiError(error) && error.status === 403) return 'Your access to this patient does not cover this order’s details.'
  if (isHidApiError(error) && error.status === 404) return 'This order was not found. Reload the list.'
  return 'The details could not be loaded. Try again.'
}

/**
 * Under an order's row: where its latest route went and what became of it, Withdraw while it waits, and, when asked
 * (each read is audited), who confirmed that the patient agreed, earlier routes and what came back.
 */
export function OrderRoutePanel({ id, kind, route, context, canWithdraw, onWithdraw, loadViews }: {
  id: string; kind: OrderRouteKind; route: OrderRouteSummary; context: RouteContext; canWithdraw: boolean
  onWithdraw: (route: OrderRouteSummary, reason: OrderRouteWithdrawReason) => Promise<void>
  loadViews: () => Promise<OrderRouteView[]>
}) {
  const status = routeStatusText(route, context.patient)
  const unavailable = unavailableText(route)
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<OrderRouteView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState<OrderRouteWithdrawReason | ''>('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const facility = route.receivingFacility.name ?? 'the other facility'
  const lab = kind === 'lab_request'
  // The latest reader, without reading again on every render: only opening the details reads them.
  const reader = useRef(loadViews)
  reader.current = loadViews

  useEffect(() => {
    if (!open) return
    let active = true
    setViews(null); setLoading(true); setLoadError('')
    void reader.current().then(items => { if (active) setViews(Array.isArray(items) ? items : []) })
      .catch(caught => { if (active) setLoadError(viewProblem(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (withdrawing) return
    if (!reason) { setWithdrawError('Choose why it is being withdrawn.'); return }
    setWithdrawing(true); setWithdrawError('')
    try { await onWithdraw(route, reason) }
    catch (caught) { setWithdrawError(withdrawRefusal(caught).text) }
    finally { setWithdrawing(false) }
  }

  return <div className="staff-stack staff-order-route" aria-labelledby={`${id}-title`}>
    <div className="staff-row"><strong id={`${id}-title`}>{lab ? 'Sent to another laboratory' : 'Sent to a pharmacy'}</strong>
      {route.reference && <span className="staff-muted">Ref {route.reference}</span>}</div>
    <p><Badge tone={status.tone}>{status.text}</Badge></p>
    {route.endedKind === 'wrong_patient' && <div className="staff-notice staff-danger staff-stack">
      {wrongPatientNotice(route, context.patient).map((line, index) => <p key={index}>{line}</p>)}</div>}
    {unavailable && <p className="staff-notice">{unavailable}</p>}
    <Button tone="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide details' : lab ? 'Show details and results' : 'Show details and dispensing'}</Button>
    {open && <div className="staff-stack">
      <div role="status">{loading && <p className="staff-muted">Loading the details…</p>}</div>
      {loadError && <p className="staff-error" role="alert">{loadError}</p>}
      {views && views.length === 0 && <p className="staff-muted">No route of this order was found.</p>}
      {views?.map((view, index) => {
        const viewFacility = view.receivingFacility.name ?? view.attestation.receivingFacilityName ?? 'the other facility'
        // Results the laboratory reports are another person's (item 3): their values stay hidden until asked for.
        const withdrawn = lab && view.endedKind === 'wrong_patient' ? withdrawnResultLines(view.results ?? [], viewFacility, view.endedAt) : null
        const returns = withdrawn ? [] : lab ? resultLines(view.results ?? [], viewFacility) : dispensingLines(view.dispensings ?? [], viewFacility)
        return <div key={view.id} className="staff-list-item staff-stack">
          {index > 0 && <strong>Earlier: {routeStatusText(view, context.patient).text}</strong>}
          <p>{attestedText(view.attestation.attestedByName, view.attestation.attestedAt, context.patient,
            view.attestation.receivingFacilityName ?? viewFacility)}</p>
          {withdrawn && withdrawn.length > 0 ? <WithdrawnResults id={`${id}-${view.id}`} lines={withdrawn} />
            : returns.length > 0 ? <ul className="staff-order-notes">{returns.map((line, at) => <li key={at}>{line}</li>)}</ul>
              : view.effectiveState === 'accepted' ? <p className="staff-muted">Nothing has come back from {viewFacility} yet.</p> : null}
        </div>
      })}
    </div>}
    {canWithdraw && routeWaiting(route) && <form className="staff-form" onSubmit={event => void withdraw(event)}>
      <Field label={`Withdraw it from ${facility}`} htmlFor={`${id}-withdraw-reason`} error={withdrawError || undefined}>
        <Select id={`${id}-withdraw-reason`} value={reason} onChange={event => setReason(event.target.value as OrderRouteWithdrawReason | '')}>
          <option value="">Choose why</option>
          {WITHDRAW_REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </Field>
      <div className="staff-row"><Button id={`${id}-withdraw`} type="submit" tone="secondary" size="sm" aria-disabled={withdrawing || undefined}
        className={UNAVAILABLE}>{withdrawing ? 'Withdrawing…' : 'Withdraw'}</Button></div>
      <p className="staff-muted">{facility} can no longer accept it, and {context.patient} is told in the Health ID app.</p>
    </form>}
  </div>
}

/** The words for an order's Send button, by kind. */
export function sendLabel(kind: OrderRouteKind): string {
  return kind === 'lab_request' ? 'Send to another laboratory' : 'Send to a pharmacy'
}

/** Said when a create-and-send saved the draft but the send was refused. */
export function savedNotSent(reason: string): string {
  return `Saved as a draft. Not sent: ${reason}`
}

export { orderWord }
