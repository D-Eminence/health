import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type RefObject, type SetStateAction } from 'react'
import {
  orderRoutesApi, type OrderDestination, type OrderRouteKind, type OrderRouteSummary, type OrderRouteView, type OrderRouteWithdrawReason,
} from '../../../../staff/api'
import { destinationLine } from '../../../../staff/components/OrderDestinationPicker'
import {
  attestedText, controlledMedicineNote, destinationWord, fillAttestation, lateReportNotice, notCompletedText, routeGuidance,
  routeStatusText, routeWaiting, searchRefusal, sendRefusal, sensitiveTestNote, unavailableText, urgentNote, WITHDRAW_REASONS,
  withdrawRefusal, wrongPatientNotice,
} from '../../../../staff/orderRoutes'
import { choiceProblem, NO_DESTINATION, sendLabel, type DestinationChoice, type RouteContext } from '../../../../staff/routes/OrderRoutes'
import { learnLateCorrectionFrom, useLateCorrectionServed, wrongPatientReportOf } from '../../../../lateCorrectionServed'
import { ErrorBox } from '../../parts/Notices'
import { attestationProblem, dispensingLines, resultLines, viewProblem, withdrawnResultLines, type WithdrawnLine } from './routeLines'

/**
 * Sending a saved order to a laboratory or pharmacy at another facility, and what became of it: today's
 * OrderDestinationPicker, OrderDestinationFields, SendToFacility and OrderRoutePanel (staff/routes/OrderRoutes.tsx),
 * drawn in the design's form and card style with today's words, calls and rules.
 */

export type RouteErrors = { destination?: string; attested?: string }

/** A query as Identity takes it: spaces collapsed and trimmed, 3 to 80 characters. */
function searchQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Today's OrderDestinationPicker: a directory search, made only when asked (each counts towards 60 an hour). */
export function DestinationPicker({ facilityId, kind, value, onChange, error, queryRef }: {
  facilityId: string
  kind: 'laboratory' | 'pharmacy'
  value: OrderDestination | null
  onChange: (destination: OrderDestination | null) => void
  error?: string
  queryRef?: RefObject<HTMLInputElement | null>
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<OrderDestination[] | null>(null)
  const [refused, setRefused] = useState('')
  const [answered, setAnswered] = useState(0)
  const typed = searchQuery(query)
  const canSearch = typed.length >= 3 && typed.length <= 80
  const word = kind === 'laboratory' ? 'laboratory' : 'pharmacy'

  async function search() {
    if (searching) return
    if (!canSearch) { setRefused('Type 3 to 80 letters of the facility’s name.'); return }
    setSearching(true)
    setRefused('')
    try {
      const answer = await orderRoutesApi.destinations(facilityId, kind, typed)
      setResults(Array.isArray(answer?.items) ? answer.items : [])
      setAnswered(count => count + 1)
    } catch (caught) {
      setRefused(searchRefusal(caught))
    } finally {
      setSearching(false)
    }
  }

  function enter(event: KeyboardEvent<HTMLInputElement>) {
    // Enter searches here; it does not send the form around it.
    if (event.key !== 'Enter') return
    event.preventDefault()
    void search()
  }

  const count = results?.length ?? 0
  return (
    <div className="hid-ehr-clinical-orders-picker" role="group" aria-labelledby={`${id}-legend`}>
      <p id={`${id}-legend`} className="hid-ehr-clinical-orders-picker-title">{kind === 'laboratory' ? 'Laboratory' : 'Pharmacy'}</p>
      <p className="hid-ehr-clinical-orders-muted">Ask the patient which {word} they will use.</p>
      <div className="hid-ehr-clinical-orders-search">
        <EhrField label={`Search for the ${word}`} hint="Type at least 3 letters of its name, then search." error={error}>
          <EhrInput ref={queryRef} type="search" autoComplete="off" spellCheck={false} maxLength={80} value={query}
            onChange={event => setQuery(event.target.value)} onKeyDown={enter} />
        </EhrField>
        <EhrButton variant="secondary" busy={searching} onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</EhrButton>
      </div>
      <p role="status" className="hid-ehr-clinical-orders-muted">{searching ? 'Searching…' : results === null ? null
        : <span key={answered}>{count === 0 ? `No ${word} on Health ID matches that name.` : count === 1 ? `1 ${word} found.`
          : `${count} ${word === 'laboratory' ? 'laboratories' : 'pharmacies'} found.`}</span>}</p>
      {refused ? <p role="alert" className="hid-ehr-clinical-field-error">{refused}</p> : null}
      {results && count > 0 ? (
        <fieldset className="hid-ehr-clinical-choices">
          <legend>Choose the {word}</legend>
          <div className="hid-ehr-clinical-orders-destinations">
            {results.map(destination => (
              <label key={destination.facilityId} className="hid-ehr-clinical-choice">
                <input type="radio" name={`${id}-destination`} value={destination.facilityId}
                  checked={value?.facilityId === destination.facilityId} onChange={() => onChange(destination)} />
                <span>{destinationLine(destination)}{destination.newOnHealthId ? <> <EhrBadge tone="brand">New on Health ID</EhrBadge></> : null}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {value ? <p className="hid-ehr-clinical-orders-muted">Chosen: <strong>{destinationLine(value)}</strong>{value.newOnHealthId ? ' (new on Health ID)' : ''}</p> : null}
      <p className="hid-ehr-clinical-orders-muted">Not listed? It may not be on Health ID yet, or not checked by Health ID support. Give the patient a paper {kind === 'laboratory' ? 'request' : 'prescription'}.</p>
    </div>
  )
}

/**
 * Today's OrderDestinationFields: the facility and the attestation. The attestation text is read when the fields
 * open and again after `reloadAttestation` changes; the tick is cleared each time, so what is confirmed is the text shown.
 */
export function DestinationFields({ context, kind, priority, value, onChange, reloadAttestation = 0, errors = {}, queryRef, attestedRef }: {
  context: RouteContext
  kind: OrderRouteKind
  priority?: string
  value: DestinationChoice
  onChange: Dispatch<SetStateAction<DestinationChoice>>
  reloadAttestation?: number
  errors?: RouteErrors
  queryRef?: RefObject<HTMLInputElement | null>
  attestedRef?: RefObject<HTMLInputElement | null>
}) {
  const id = useId()
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
  const attestedError = errors.attested ? <p id={`${id}-attested-error`} className="hid-ehr-clinical-field-error">{errors.attested}</p> : null
  return (
    <div className="hid-ehr-clinical-orders-send">
      <DestinationPicker facilityId={context.facilityId} kind={kind === 'lab_request' ? 'laboratory' : 'pharmacy'}
        value={value.destination} error={errors.destination} queryRef={queryRef}
        onChange={destination => onChange(current => ({ ...current, destination, attested: false }))} />
      {loadError ? (
        <div className="hid-ehr-clinical-orders-stack">
          <p className="hid-ehr-clinical-field-error" role="alert">{loadError}</p>
          <div><EhrButton variant="secondary" size="sm" onClick={() => setAsked(count => count + 1)}>Load the confirmation again</EhrButton></div>
        </div>
      ) : null}
      {!loadError && !value.attestation ? <p className="hid-ehr-clinical-orders-muted" role="status">Loading the confirmation…</p> : null}
      {value.attestation && !value.destination ? <p className="hid-ehr-clinical-orders-muted">Choose the {where}, then confirm that the patient agreed.</p> : null}
      {value.attestation && value.destination ? (
        <>
          <label className="hid-ehr-clinical-orders-attest">
            <input ref={attestedRef} type="checkbox" checked={value.attested}
              aria-describedby={[errors.attested ? `${id}-attested-error` : '', `${id}-attested-note`].filter(Boolean).join(' ')}
              aria-invalid={errors.attested ? true : undefined}
              onChange={event => { const attested = event.target.checked; onChange(current => ({ ...current, attested })) }} />
            <span>{fillAttestation(value.attestation.text, { patient: context.patient, orderingFacility: context.orderingFacility, receivingFacility: facility })}</span>
          </label>
          {attestedError}
          <p id={`${id}-attested-note`} className="hid-ehr-clinical-orders-muted">Health ID records that you confirmed this, with your name and the time.
            {' '}{context.patient} is told in the Health ID app and can stop it until {facility} accepts it.</p>
          {kind === 'lab_request' ? (
            <ul className="hid-ehr-clinical-orders-notes">
              <li>{facility} sees the clinical information only after it accepts. Write only what the laboratory needs.</li>
              <li>{sensitiveTestNote(facility, context.patient)}</li>
              {priority === 'asap' || priority === 'stat' ? <li>{urgentNote(facility)}</li> : null}
            </ul>
          ) : (
            <ul className="hid-ehr-clinical-orders-notes">
              <li>{facility} sees your instructions only after it accepts.</li>
              <li>{controlledMedicineNote(facility)}</li>
            </ul>
          )}
        </>
      ) : attestedError}
    </div>
  )
}

/**
 * Today's SendToFacility, opened from its action button: the facility, the attestation, then "Send to {facility}".
 * `onSend` sends at the order's version; a refusal that means the wording changed reloads it, cleared.
 */
export function SendElsewhere({ kind, context, priority, onSend, onCancel }: {
  kind: OrderRouteKind
  context: RouteContext
  priority?: string
  onSend: (destination: OrderDestination, attestationTextVersion: string, key: string) => Promise<void>
  onCancel: () => void
}) {
  const titleId = useId()
  const [choice, setChoice] = useState<DestinationChoice>(NO_DESTINATION)
  const [errors, setErrors] = useState<RouteErrors>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const attestedRef = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setErrors({})
    const problem = choiceProblem(choice, kind)
    if (problem) {
      setErrors({ [problem.field]: problem.text })
      ;(problem.field === 'destination' ? queryRef.current : attestedRef.current ?? queryRef.current)?.focus()
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="hid-ehr-clinical-form hid-ehr-clinical-orders-action-form" noValidate aria-labelledby={titleId} onSubmit={event => void submit(event)}>
      <p className="hid-ehr-clinical-orders-lead"><strong id={titleId}>{sendLabel(kind)}</strong></p>
      <DestinationFields context={context} kind={kind} priority={priority} value={choice} onChange={setChoice}
        reloadAttestation={reload} errors={errors} queryRef={queryRef} attestedRef={attestedRef} />
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <div className="hid-ehr-clinical-form-footer">
        <EhrButton type="submit" busy={busy}>{busy ? 'Sending…' : choice.destination ? `Send to ${choice.destination.facilityName}` : 'Send'}</EhrButton>
        <EhrButton variant="secondary" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

/** Today's WithdrawnResults: each withdrawn value hidden until "Show the withdrawn value" is pressed. */
function WithdrawnResults({ lines }: { lines: readonly WithdrawnLine[] }) {
  const id = useId()
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  return (
    <ul className="hid-ehr-clinical-orders-notes">
      {lines.map(line => {
        const open = shown.has(line.key)
        const valueId = `${id}-${line.key}`
        return (
          <li key={line.key}>
            <span>{line.text}</span>
            {line.value ? (
              <>
                {' '}
                <EhrButton variant="quiet" size="sm" aria-expanded={open} aria-controls={open ? valueId : undefined}
                  onClick={() => setShown(current => {
                    const next = new Set(current)
                    if (open) next.delete(line.key)
                    else next.add(line.key)
                    return next
                  })}>{open ? 'Hide the withdrawn value' : 'Show the withdrawn value'}</EhrButton>
                {open ? <span id={valueId}> {line.value}</span> : null}
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

const TONES = { information: 'info', success: 'positive', warning: 'caution', neutral: 'neutral' } as const

/**
 * Today's OrderRoutePanel as a card under the order: where its latest route went and what became of it (including
 * what the receiving facility reported: the wrong-patient report, a late report, that it couldn't complete it),
 * Withdraw while it waits, and, when asked (each read is audited), who confirmed and what came back.
 */
export function RouteCard({ titleId, kind, route, context, canWithdraw, onWithdraw, loadViews }: {
  titleId: string
  kind: OrderRouteKind
  route: OrderRouteSummary
  context: RouteContext
  canWithdraw: boolean
  onWithdraw: (route: OrderRouteSummary, reason: OrderRouteWithdrawReason) => Promise<void>
  loadViews: () => Promise<OrderRouteView[]>
}) {
  const status = routeStatusText(route, context.patient)
  const unavailable = unavailableText(route)
  const report = wrongPatientReportOf(route)
  const lateServed = useLateCorrectionServed() === true
  const lateNotice = lateReportNotice(route, context.patient)
  const guidance = routeGuidance(route, context.patient, lateServed)
  const notCompleted = notCompletedText(route, context.patient)
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<OrderRouteView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState<OrderRouteWithdrawReason | ''>('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const facility = route.receivingFacility.name ?? 'the other facility'
  const lab = kind === 'lab_request'
  const reader = useRef(loadViews)
  reader.current = loadViews

  useEffect(() => {
    if (!open) return
    let active = true
    setViews(null)
    setLoading(true)
    setLoadError('')
    void reader.current().then(items => {
      learnLateCorrectionFrom(null, Array.isArray(items) ? items : null)
      if (active) setViews(Array.isArray(items) ? items : [])
    })
      .catch(caught => { if (active) setLoadError(viewProblem(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (withdrawing) return
    if (!reason) { setWithdrawError('Choose why it is being withdrawn.'); return }
    setWithdrawing(true)
    setWithdrawError('')
    try { await onWithdraw(route, reason) } catch (caught) { setWithdrawError(withdrawRefusal(caught).text) } finally { setWithdrawing(false) }
  }

  return (
    <EhrCard title={<span id={titleId} tabIndex={-1}>{lab ? 'Sent to another laboratory' : 'Sent to a pharmacy'}</span>}>
      {route.reference ? <p className="hid-ehr-clinical-orders-muted">Ref {route.reference}</p> : null}
      <p className={`hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-${TONES[status.tone]}`}>{status.text}</p>
      {guidance ? <p className="hid-ehr-clinical-orders-muted">{guidance}</p> : null}
      {notCompleted ? <p className="hid-ehr-clinical-orders-notice">{notCompleted}</p> : null}
      {route.endedKind === 'wrong_patient' || report ? (
        <div className="hid-ehr-clinical-orders-notice hid-ehr-clinical-orders-danger">
          {wrongPatientNotice(route, context.patient).map((line, index) => <p key={index}>{line}</p>)}
          {lateNotice ? <p>{lateNotice}</p> : null}
        </div>
      ) : null}
      {unavailable ? <p className="hid-ehr-clinical-orders-notice">{unavailable}</p> : null}
      <p>
        <EhrButton variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? 'Hide details' : lab ? 'Show details and results' : 'Show details and dispensing'}
        </EhrButton>
      </p>
      {open ? (
        <div className="hid-ehr-clinical-orders-stack">
          <div role="status">{loading ? <p className="hid-ehr-clinical-orders-muted">Loading the details…</p> : null}</div>
          {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}
          {views && views.length === 0 ? <p className="hid-ehr-clinical-orders-muted">No route of this order was found.</p> : null}
          {views?.map((view, index) => {
            const viewFacility = view.receivingFacility.name ?? view.attestation.receivingFacilityName ?? 'the other facility'
            const reported = wrongPatientReportOf(view)
            const withdrawn = lab && (view.endedKind === 'wrong_patient' || reported)
              ? withdrawnResultLines(view.results ?? [], viewFacility, reported?.reportedAt ?? view.endedAt) : null
            const returns = withdrawn ? [] : lab ? resultLines(view.results ?? [], viewFacility) : dispensingLines(view.dispensings ?? [], viewFacility)
            return (
              <div key={view.id} className="hid-ehr-clinical-orders-view">
                {index > 0 ? <strong>Earlier: {routeStatusText(view, context.patient).text}</strong> : null}
                <p>{attestedText(view.attestation.attestedByName, view.attestation.attestedAt, context.patient,
                  view.attestation.receivingFacilityName ?? viewFacility)}</p>
                {withdrawn && withdrawn.length > 0 ? <WithdrawnResults lines={withdrawn} />
                  : returns.length > 0 ? <ul className="hid-ehr-clinical-orders-notes">{returns.map((line, at) => <li key={at}>{line}</li>)}</ul>
                    : view.effectiveState === 'accepted' ? <p className="hid-ehr-clinical-orders-muted">Nothing has come back from {viewFacility} yet.</p> : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {canWithdraw && routeWaiting(route) ? (
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void withdraw(event)}>
          <EhrField label={`Withdraw it from ${facility}`} error={withdrawError || undefined}>
            <EhrSelect value={reason} onChange={event => setReason(event.target.value as OrderRouteWithdrawReason | '')}>
              <option value="">Choose why</option>
              {WITHDRAW_REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </EhrSelect>
          </EhrField>
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton type="submit" variant="secondary" busy={withdrawing}>{withdrawing ? 'Withdrawing…' : 'Withdraw'}</EhrButton>
          </div>
          <p className="hid-ehr-clinical-orders-muted">{facility} can no longer accept it, and {context.patient} is told in the Health ID app.</p>
        </form>
      ) : null}
    </EhrCard>
  )
}
