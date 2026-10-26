import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Button, Field, Textarea } from '@hid/ui'
import {
  orderRoutesApi, type OrderRouteWrongPatientEnded, type OrderRouteWrongPatientReason, type ReceivingService,
} from '../api'
import { WRONG_PATIENT_REASONS, wrongPatientEndedLines, wrongPatientRefusal } from '../orderRoutes'
import { BUSY, QUIET_UNAVAILABLE, UNAVAILABLE } from '../focus'
import { useLateCorrectionServed } from '../../lateCorrectionServed'

/**
 * "This isn't the order's patient" (item 3, owner decisions D1-D6, D18; SPEC-FINAL §8.1, §9.1): a laboratory or pharmacy
 * that accepted an order from another facility for someone who was not its patient ends it, and in the same step every
 * result or dispensing it sent back is withdrawn. Any member who may receive that kind of order may report it (D4), alone
 * (D4b); withdrawing something needs the result-in-error or dispensing-reverse permission too, which the service checks.
 * It can't be undone, and the order can't be received again (D5).
 *
 * The form says what will happen, asks what happened (four reasons, D6) and a note for Health ID support only (D7), and
 * a confirmation; it sends nothing until all three are given. One Idempotency-Key is kept per identical report, so a
 * report sent again after no answer is the same one. On 412 the route moved on (something was returned or changed): the
 * caller reads it again, and the form stays open at the new version. A backend without the route answers 404: the form
 * says it is not available yet. Opening it moves focus to its title; Cancel returns it to the button that opened it.
 */

/** The route reported on, at the version the report is checked against. */
export interface WrongPatientRoute { id: string; version: number; reference: string | null }

/** What the success message needs once the order has ended. */
export interface WrongPatientEnding {
  service: ReceivingService
  title: string
  reference: string | null
  patient: string | null
  ordering: string
  result: OrderRouteWrongPatientEnded
  /** Accepted with a date of birth and no reference: the message suggests asking for the reference next time. */
  dateOfBirthOnly: boolean
}

interface Problems { reason?: string; note?: string; confirmed?: string }

export function WrongPatientForm({ id, service, facilityId, route, patient, ordering, dispensed, notice, onEnded, onStale,
  onReload, onCancel }: {
  id: string; service: ReceivingService; facilityId: string; route: WrongPatientRoute; patient: string | null; ordering: string
  /** Pharmacy: whether a dispensing it recorded stands (true), none does (false), or the page can't tell (undefined). */
  dispensed?: boolean
  /** Said above the actions, for example why the form was refreshed. */
  notice?: string
  onEnded: (result: OrderRouteWrongPatientEnded) => void
  /** The route moved on (412): read it again; the form takes the new version from its props. Given what was said. */
  onStale: (said?: string) => Promise<void> | void
  /**
   * The list is out of date (the order ended, was not found, or no answer came): read it again. Given what was said, for
   * a caller whose new read may close the form (D17's section keeps it in the row).
   */
  onReload?: (said?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState<OrderRouteWrongPatientReason | ''>('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  // The button that opened the form is gone: focus moves to the form's title, so a keyboard or screen-reader user goes
  // on from the form itself rather than from the top of the page (as the message that follows it does).
  const title = useRef<HTMLElement>(null)
  useEffect(() => { title.current?.focus() }, [])
  const lab = service === 'lab'
  const who = patient?.trim() || 'the patient'
  const Who = patient?.trim() || 'The patient'
  // From a backend that serves the late correction (D17), an order that has ended can still be withdrawn there.
  const late = useLateCorrectionServed() === true

  function refuse(field: keyof Problems, text: string, target: string) {
    setProblems({ [field]: text })
    document.getElementById(target)?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the report runs; a second press does nothing.
    if (busy) return
    setError(''); setProblems({})
    const written = note.trim()
    if (!reason) return refuse('reason', 'Choose what happened.', `${id}-reason-${WRONG_PATIENT_REASONS[0]!.value}`)
    if (written.length < 8 || written.length > 500) {
      return refuse('note', 'Describe what happened in 8 to 500 characters.', `${id}-note`)
    }
    if (!confirmed) return refuse('confirmed', 'Tick the box to confirm that the person was not the patient.', `${id}-confirmed`)
    if (!Number.isSafeInteger(route.version) || route.version < 1) {
      setError('Refresh the list before ending this order.')
      return
    }
    // The same report sent again after no answer is the same one; a changed report, or a new version, is a new one.
    const signature = JSON.stringify([route.id, route.version, reason, written])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const result = await orderRoutesApi.reportWrongPatient(facilityId, service, { id: route.id, version: route.version },
        { reason, note: written }, attempt.current.key)
      attempt.current = null
      onEnded(result)
    } catch (caught) {
      // A refusal settles the report and frees its key; only an unanswered one keeps it for the same report.
      if (isHidApiError(caught) && caught.status > 0 && caught.status < 500 && caught.status !== 408) attempt.current = null
      const refusal = wrongPatientRefusal(caught, service, ordering, late ? { reference: route.reference } : null)
      setError(refusal.text)
      if (refusal.stale) await onStale(refusal.text)
      else if (refusal.reload) onReload?.(refusal.text)
    } finally { setBusy(false) }
  }

  return <form className="staff-form staff-wrong-patient" onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>End this order: accepted for the wrong person</strong>
    <p>{Who} is the patient on this order. Use this only if the person you accepted it for is someone else.</p>
    {!lab && <p>Someone collecting for {who} with their agreement is not the wrong person: don’t use this for them.</p>}
    <p>If you can’t do the {lab ? 'test' : 'medicine'}, don’t use this either: phone {ordering}.</p>
    <p><strong>What will happen</strong></p>
    <ul className="staff-order-notes">
      <li>You stop seeing {who}’s details and this order at once, and nothing more can be recorded on it.</li>
      {lab && <li>Any result you released on it is marked entered in error, and {ordering} is shown not to use it.</li>}
      {!lab && dispensed === true && <li>The dispensing you recorded is reversed in the record.</li>}
      {!lab && dispensed === undefined && <li>Any dispensing you recorded on it is reversed in the record.</li>}
      <li>{Who} is told in the Health ID app. {ordering} sees it on the order, but Health ID does not alert them: you must phone them.</li>
      <li>Health ID support reviews every report. This can’t be undone.</li>
    </ul>
    <fieldset className="staff-order-choices" aria-describedby={problems.reason ? `${id}-reason-error` : undefined}
      aria-invalid={problems.reason ? true : undefined}>
      <legend>What happened</legend>
      {WRONG_PATIENT_REASONS.map(item => <label key={item.value} className="staff-choice">
        <input id={`${id}-reason-${item.value}`} type="radio" name={`${id}-reason`} value={item.value} checked={reason === item.value}
          onChange={() => { setReason(item.value); setProblems(current => ({ ...current, reason: undefined })) }} /> {item.label}</label>)}
    </fieldset>
    {problems.reason && <p id={`${id}-reason-error`} className="staff-error">{problems.reason}</p>}
    <Field label="What happened, for Health ID support" htmlFor={`${id}-note`} error={problems.note}
      hint={`8 to 500 characters. Describe what happened at the counter. Support reads this; the patient and ${ordering} don’t. `
        + 'Don’t write anyone’s name, Health ID, test, medicine or health details: the order’s reference identifies it.'}>
      <Textarea id={`${id}-note`} value={note} maxLength={500} onChange={event => setNote(event.target.value)} />
    </Field>
    <label className="staff-choice"><input id={`${id}-confirmed`} type="checkbox" checked={confirmed}
      aria-describedby={problems.confirmed ? `${id}-confirmed-error` : undefined} aria-invalid={problems.confirmed ? true : undefined}
      onChange={event => { setConfirmed(event.target.checked); setProblems(current => ({ ...current, confirmed: undefined })) }} />
      <span>{lab ? `The person I accepted this order for is not ${who}.`
        : `The person I accepted this order for is not ${who}, and was not collecting it for them.`}</span></label>
    {problems.confirmed && <p id={`${id}-confirmed-error`} className="staff-error">{problems.confirmed}</p>}
    {notice && !error && <p className="staff-notice">{notice}</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    <div className="staff-row">
      <Button id={`${id}-end`} type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Ending…' : 'End this order'}</Button>
      <Button tone="quiet" size="sm" aria-disabled={busy || undefined} className={QUIET_UNAVAILABLE}
        onClick={() => { if (!busy) onCancel() }}>Cancel</Button>
    </div>
  </form>
}

/**
 * The button that opens the form, on a routed work row (item 3, §8.1). The row offers it only while the route allows
 * work, from a backend that sends its version, with the receive permission (wrongPatientOffered). On 412 the list is
 * read again and the form stays open at the new version.
 */
export function WrongPatientAction({ id, service, facilityId, route, patient, ordering, dispensed, onEnded, onRefresh }: {
  id: string; service: ReceivingService; facilityId: string; route: WrongPatientRoute; patient: string | null; ordering: string
  dispensed?: boolean
  onEnded: (result: OrderRouteWrongPatientEnded) => void
  onRefresh: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  if (!open) return <div className="staff-row"><Button id={`${id}-open`} tone="secondary" size="sm" className={UNAVAILABLE}
    aria-expanded={false} onClick={() => setOpen(true)}>This isn’t the order’s patient</Button></div>
  return <WrongPatientForm id={id} service={service} facilityId={facilityId} route={route} patient={patient} ordering={ordering}
    dispensed={dispensed} onEnded={onEnded} onStale={onRefresh} onReload={() => void onRefresh()}
    onCancel={() => { setOpen(false); window.setTimeout(() => document.getElementById(`${id}-open`)?.focus(), 0) }} />
}

/**
 * Said once an order has ended this way (item 3, §9.1; C2, C10): it stays until closed, with the order's reference, and
 * says that Health ID does not alert the ordering facility, so the receiver must phone it.
 */
export function WrongPatientEnded({ id, ending, onClose }: { id: string; ending: WrongPatientEnding; onClose: () => void }) {
  const returned = ending.result.route.effectiveState === 'completed' || ending.result.resultReportsMarked > 0
    || ending.result.dispensingReversed
  const [first, ...rest] = wrongPatientEndedLines({ service: ending.service, title: ending.title, reference: ending.reference,
    patient: ending.patient, ordering: ending.ordering, returned, dateOfBirthOnly: ending.dateOfBirthOnly })
  // The form that ended it is gone: the work continues at what to do now.
  const title = useRef<HTMLElement>(null)
  useEffect(() => { title.current?.focus() }, [ending])
  return <div className="staff-notice staff-danger staff-stack" aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>{first}</strong>
    {rest.map((line, index) => <p key={index}>{line}</p>)}
    <div className="staff-row"><Button tone="quiet" size="sm" onClick={onClose}>Close</Button></div>
  </div>
}
