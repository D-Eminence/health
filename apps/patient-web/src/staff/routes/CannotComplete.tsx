import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Button } from '@hid/ui'
import {
  orderRoutesApi, type OrderRouteCannotCompleteReason, type OrderRouteNotCompleted, type OrderRouteWrongPatientEnded,
  type ReceivingService,
} from '../api'
import { cannotCompleteEndedLines, cannotCompleteMustPhone, cannotCompleteReasons, cannotCompleteRefusal } from '../orderRoutes'
import { BUSY, QUIET_UNAVAILABLE, UNAVAILABLE } from '../focus'
import { learnCannotCompleteServed, useCannotCompleteServed } from '../../cannotCompleteServed'
import { ItemName } from '../../ItemName'
import { WrongPatientForm } from './WrongPatient'

/**
 * "We can't complete this order" (D18, owner decisions D18-1 to D18-15; SPEC-FINAL §9.1): a laboratory or pharmacy that
 * accepted an order from another facility and can't finish it ends it with one fixed reason of its kind (D18-5, no free
 * text, D18-6), stating that the person it accepted it for was the order's patient (sent as `confirmedPatient: true`).
 * Anyone who may receive that kind of order may use it (D18-10), only while the order is accepted, inside its 30 days
 * and before anything came back (D18-1). Nothing is withdrawn: on an accepted order nothing has gone back.
 *
 * The form says first that it is not for the wrong person (that is "This isn't the order's patient"), then what will
 * happen, asks why, and needs the identity statement, plus "We will phone {ordering} about this now" for an urgent, asap or
 * stat lab request and for the must-phone reasons (D18-8), plus, once Lab says a recorded value is possibly critical,
 * "We have phoned {ordering} about the possibly critical value" (D18-15); nothing is sent until all are given. One
 * Idempotency-Key is kept per identical request; a refusal frees it, and no answer (5xx, 408, none) keeps it and the form,
 * so the same request sent again answers what happened. On 412 the caller reads the list again and the form stays at the
 * new version; a refusal that says the list is out of date is handed to the caller, which keeps the words in the row if
 * the new list no longer offers the action (D17's UX-2). Opening it moves focus to its title; Cancel returns it to the
 * button that opened it.
 *
 * Shown only once the backend serves D18 (cannotCompleteServed, D18-13): until then no row offers it.
 */

/** The route ended, at the version the ending is checked against. */
export interface CannotCompleteRoute { id: string; version: number; reference: string | null }

/** What the success entry needs once the order has ended. */
export interface CannotCompleteEnding {
  /** Unique per ending shown, for the page's list. */
  key: string
  service: ReceivingService
  title: string
  reference: string | null
  patient: string | null
  ordering: string
  reason: OrderRouteCannotCompleteReason
  /** Lab: the request's priority, for whom to phone and when. */
  priority: string | null
  result: OrderRouteNotCompleted
}

interface Problems { reason?: string; phone?: string; confirmed?: string; critical?: string }

let endings = 0
/** A key for a success entry, unique for the page's life. */
export function endingKey(routeId: string): string {
  endings += 1
  return `${routeId}-${endings}`
}

export function CannotCompleteForm({ id, service, facilityId, route, patient, ordering, priority = null, accession, specimenStatuses,
  onEnded, onStale, onReload, onCancel }: {
  id: string; service: ReceivingService; facilityId: string; route: CannotCompleteRoute; patient: string | null; ordering: string
  /** Lab: the request's priority (routine, urgent, asap, stat): urgent ones need the phone statement whatever the reason. */
  priority?: string | null
  /** Lab: whether an accession was opened (reads kept 7 days, D18-2), none was (false), or the page can't tell (undefined). */
  accession?: boolean
  /** Lab: its specimens' statuses, for whether a rejection can still be recorded first. */
  specimenStatuses?: readonly string[]
  onEnded: (result: OrderRouteNotCompleted, reason: OrderRouteCannotCompleteReason) => void
  /** The route moved on (412): read it again; the form takes the new version from its props. Given what was said. */
  onStale: (said: string) => Promise<void> | void
  /** The list is out of date (the order ended, came back, was not found, a key reused): read it again, given what was said. */
  onReload: (said: string) => Promise<void> | void
  onCancel: () => void
}) {
  const reasons = cannotCompleteReasons(service)
  const [reason, setReason] = useState<OrderRouteCannotCompleteReason | ''>('')
  const [phone, setPhone] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  // Asked for only once Lab has said a recorded value is possibly critical (D18-15).
  const [critical, setCritical] = useState(false)
  const [told, setTold] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  // The button that opened the form is gone: focus moves to the form's title.
  const title = useRef<HTMLElement>(null)
  useEffect(() => { title.current?.focus() }, [])
  // Once asked for, the critical-value statement is where the work goes on (after the refusal that asks for it).
  useEffect(() => { if (critical) document.getElementById(`${id}-critical`)?.focus() }, [critical, id])
  const lab = service === 'lab'
  const who = patient?.trim() || 'the patient'
  const Who = patient?.trim() || 'The patient'
  const mustPhone = cannotCompleteMustPhone(service, reason, priority)
  const collected = Boolean(specimenStatuses?.includes('collected'))
  const received = Boolean(specimenStatuses?.includes('received'))

  function refuse(field: keyof Problems, text: string, target: string) {
    setProblems({ [field]: text })
    document.getElementById(target)?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy) return
    setError(''); setProblems({})
    if (!reason) return refuse('reason', 'Choose why you can’t complete it.', `${id}-reason-${reasons[0]!.value}`)
    if (mustPhone && !phone) return refuse('phone', `Tick the box to confirm that you will phone ${ordering} now.`, `${id}-phone`)
    if (!confirmed) return refuse('confirmed', 'Tick the box to confirm that the person was the order’s patient.', `${id}-confirmed`)
    if (critical && !told) {
      return refuse('critical', `Tick the box to confirm that you have phoned ${ordering} about the possibly critical value.`,
        `${id}-critical`)
    }
    if (!Number.isSafeInteger(route.version) || route.version < 1) {
      setError('Refresh the list before ending this order.')
      return
    }
    const criticalValueTold = lab && critical && told
    // The same request sent again after no answer is the same one; a changed request, or a new version, is a new one.
    const signature = JSON.stringify([route.id, route.version, reason, criticalValueTold])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const result = await orderRoutesApi.cannotComplete(facilityId, service, { id: route.id, version: route.version },
        { reason, confirmedPatient: true, ...(criticalValueTold ? { criticalValueTold: true } : {}) }, attempt.current.key)
      attempt.current = null
      onEnded(result, reason)
    } catch (caught) {
      // A refusal settles the request and frees its key; only an unanswered one keeps it for the same request.
      if (isHidApiError(caught) && caught.status > 0 && caught.status < 500 && caught.status !== 408) attempt.current = null
      const refusal = cannotCompleteRefusal(caught, service, ordering, route.reference)
      if (refusal.missing) learnCannotCompleteServed(false)
      setError(refusal.text)
      if (refusal.critical && lab) setCritical(true)
      if (refusal.stale) await onStale(refusal.text)
      else if (refusal.reload) await onReload(refusal.text)
    } finally { setBusy(false) }
  }

  return <form className="staff-form staff-wrong-patient" onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>End this order: we can’t complete it</strong>
    <p>{lab
      ? `Use this when you accepted this order but can’t finish it here: the test isn’t offered after all, something has run `
        + `out or is out of service, the sample can’t be used, or ${who} chose not to go ahead or left.`
      : `Use this when you accepted this order but can’t finish it here: the medicine is out of stock or can’t be obtained, `
        + `the prescription needs the prescriber’s review or a signed copy, or ${who} chose not to go ahead or didn’t come back.`}</p>
    <p>If the person you accepted it for was not {who}, don’t use this: use “This isn’t the order’s patient”. If you couldn’t
      confirm who they were and think someone may have used {who}’s details, use it too.</p>
    <p>If you know before accepting an order that you can’t do it, decline it: {ordering} can then send it elsewhere. Once you
      have accepted it, {ordering} has to write a new order.</p>
    {lab && collected && <p className="staff-notice">If a sample can’t be used, record its rejection first, under Open accession:
      nothing more can be recorded once the order has ended.</p>}
    {lab && !collected && received && <p className="staff-notice">This sample was already received, so its rejection can’t be
      recorded: the order’s ending records why.</p>}
    {!lab && <p className="staff-notice">If you handed over any of this medicine, phone {ordering} before you end the order and
      tell them how much: Health ID can’t record part of a dispensing.</p>}
    {lab && <p>If a result on this order has been checked, release it instead, or correct it first if it is wrong: an order
      with a checked result can’t be ended here.</p>}
    <p><strong>What will happen</strong></p>
    <ul className="staff-order-notes">
      <li>Nothing more can be recorded on this order. {lab && accession === true ? 'You can still read it for 7 days.'
        : lab && accession === undefined
          ? `If you opened an accession on it, you can still read it for 7 days; otherwise you stop seeing ${who}’s details on `
            + 'this order at once.'
          : `You stop seeing ${who}’s details on this order at once.`}</li>
      <li>{lab ? `Nothing you recorded on it is sent to ${ordering}: results you have not released stay in your records only. `
        + `Don’t discard a sample that can still be used until you have spoken to ${ordering}.` : 'Nothing was dispensed on it.'}</li>
      <li>{ordering} sees on the order that you couldn’t complete it, and why. Health ID does not alert them: phone them if it
        is urgent.</li>
      <li>{Who} is told in the Health ID app, if they use it. This can’t be undone.</li>
    </ul>
    <fieldset className="staff-order-choices" aria-describedby={problems.reason ? `${id}-reason-error` : undefined}
      aria-invalid={problems.reason ? true : undefined}>
      <legend>Why can’t you complete it?</legend>
      {reasons.map(item => <label key={item.value} className="staff-choice">
        <input id={`${id}-reason-${item.value}`} type="radio" name={`${id}-reason`} value={item.value} checked={reason === item.value}
          onChange={() => { setReason(item.value as OrderRouteCannotCompleteReason); setProblems(current => ({ ...current, reason: undefined })) }} /> {item.label}</label>)}
    </fieldset>
    {problems.reason && <p id={`${id}-reason-error`} className="staff-error">{problems.reason}</p>}
    {mustPhone && <label className="staff-choice"><input id={`${id}-phone`} type="checkbox" checked={phone}
      aria-describedby={problems.phone ? `${id}-phone-error` : undefined} aria-invalid={problems.phone ? true : undefined}
      onChange={event => { setPhone(event.target.checked); setProblems(current => ({ ...current, phone: undefined })) }} />
      <span>We will phone {ordering} about this now.</span></label>}
    {problems.phone && <p id={`${id}-phone-error`} className="staff-error">{problems.phone}</p>}
    <label className="staff-choice"><input id={`${id}-confirmed`} type="checkbox" checked={confirmed}
      aria-describedby={problems.confirmed ? `${id}-confirmed-error` : undefined} aria-invalid={problems.confirmed ? true : undefined}
      onChange={event => { setConfirmed(event.target.checked); setProblems(current => ({ ...current, confirmed: undefined })) }} />
      <span>{lab ? `The person we accepted this order for was ${who}, and we can’t complete it here.`
        : `The person we accepted this prescription for was ${who}, or was collecting it for them, and we can’t complete it here.`}</span></label>
    {problems.confirmed && <p id={`${id}-confirmed-error`} className="staff-error">{problems.confirmed}</p>}
    {critical && <label className="staff-choice"><input id={`${id}-critical`} type="checkbox" checked={told}
      aria-describedby={problems.critical ? `${id}-critical-error` : undefined} aria-invalid={problems.critical ? true : undefined}
      onChange={event => { setTold(event.target.checked); setProblems(current => ({ ...current, critical: undefined })) }} />
      <span>We have phoned {ordering} about the possibly critical value on this order.</span></label>}
    {problems.critical && <p id={`${id}-critical-error`} className="staff-error">{problems.critical}</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    <div className="staff-row">
      <Button id={`${id}-end`} type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Ending…' : 'End it: we can’t complete it'}</Button>
      <Button tone="quiet" size="sm" aria-disabled={busy || undefined} className={QUIET_UNAVAILABLE}
        onClick={() => { if (!busy) onCancel() }}>Cancel</Button>
    </div>
  </form>
}

/** The button that opens the form, with the order it acts on in its name (WB14). */
export function CannotCompleteAction({ id, title, reference, reading = false, onOpen }: {
  id: string; title: string; reference: string | null; reading?: boolean; onOpen: () => void
}) {
  return <div className="staff-row"><Button id={id} tone="secondary" size="sm" aria-expanded={false}
    aria-disabled={reading || undefined} className={UNAVAILABLE} onClick={() => { if (!reading) onOpen() }}>
    {reading ? 'Reading the order…' : 'We can’t complete this order'}
    <ItemName>: {title}{reference ? `, Ref ${reference}` : ''}</ItemName></Button></div>
}

/** Which ending form a work row has open: one at a time (WB2). */
export type OrderEndingMode = 'wrong_patient' | 'cannot_complete'

/**
 * A routed work row's ending actions (item 3 and D18, SPEC-FINAL §9.1): "This isn't the order's patient" while the route
 * allows work (wrongPatientOffered), and below it "We can't complete this order" while it is also accepted, from a backend
 * that serves it (cannotCompleteOffered; `cannotComplete` holds what its form needs). One form is open at a time, and
 * while it is the other button is hidden; Cancel returns focus to the button that opened it. Once D18 is served, item 3's
 * button also names the order it acts on (WB14); until then it reads exactly as before. A refusal or 412 hands the page
 * what was said (`onReread`), which reads the list again and keeps the words in the row if the form then closes.
 */
export function OrderEndingActions({ base, service, facilityId, route, title, patient, ordering, dispensed, cannotComplete,
  onWrongPatientEnded, onNotCompleted, onReread }: {
  base: string; service: ReceivingService; facilityId: string; route: CannotCompleteRoute; title: string; patient: string | null
  ordering: string
  /** Pharmacy: whether a dispensing it recorded stands, for item 3's form. */
  dispensed?: boolean
  /** Null while the row does not offer D18; else what its form needs to know. */
  cannotComplete: null | { priority?: string | null; accession?: boolean; specimenStatuses?: readonly string[] }
  onWrongPatientEnded: (result: OrderRouteWrongPatientEnded) => void
  onNotCompleted: (result: OrderRouteNotCompleted, reason: OrderRouteCannotCompleteReason) => void
  onReread: (mode: OrderEndingMode, said?: string) => Promise<void> | void
}) {
  const served = useCannotCompleteServed() === true
  const [opened, setOpened] = useState<OrderEndingMode | null>(null)
  // A form whose action the row no longer offers (the list was read again) is gone.
  const shown = opened === 'cannot_complete' && !cannotComplete ? null : opened
  useEffect(() => { if (opened && !shown) setOpened(null) }, [opened, shown])
  const wrongPatientId = `${base}-wrong-patient`
  const cannotCompleteId = `${base}-cannot-complete`
  const back = (target: string) => { window.setTimeout(() => document.getElementById(target)?.focus(), 0) }
  if (shown === 'wrong_patient') return <WrongPatientForm id={wrongPatientId} service={service} facilityId={facilityId}
    route={route} patient={patient} ordering={ordering} dispensed={dispensed} cannotComplete={cannotComplete ? 'row' : undefined}
    onEnded={onWrongPatientEnded} onStale={said => onReread('wrong_patient', said)} onReload={said => void onReread('wrong_patient', said)}
    onCancel={() => { setOpened(null); back(`${wrongPatientId}-open`) }} />
  if (shown === 'cannot_complete' && cannotComplete) return <CannotCompleteForm id={cannotCompleteId} service={service}
    facilityId={facilityId} route={route} patient={patient} ordering={ordering} priority={cannotComplete.priority}
    accession={cannotComplete.accession} specimenStatuses={cannotComplete.specimenStatuses} onEnded={onNotCompleted}
    onStale={said => onReread('cannot_complete', said)} onReload={said => onReread('cannot_complete', said)}
    onCancel={() => { setOpened(null); back(`${cannotCompleteId}-open`) }} />
  return <>
    <div className="staff-row"><Button id={`${wrongPatientId}-open`} tone="secondary" size="sm" className={UNAVAILABLE}
      aria-expanded={false} onClick={() => setOpened('wrong_patient')}>This isn’t the order’s patient
      {served && <ItemName>: {title}{route.reference ? `, Ref ${route.reference}` : ''}</ItemName>}</Button></div>
    {cannotComplete && <CannotCompleteAction id={`${cannotCompleteId}-open`} title={title} reference={route.reference}
      onOpen={() => setOpened('cannot_complete')} />}
  </>
}

/**
 * Said once an order has ended this way (D18, SPEC-FINAL §9.1; WB4): one entry per ending, kept until its own Close, in a
 * neutral notice (nothing was withdrawn, and it is not an incident). The newest takes focus: the form that ended it is gone.
 */
export function CannotCompleteEnded({ id, ending, onClose }: { id: string; ending: CannotCompleteEnding; onClose: () => void }) {
  const [first, ...rest] = cannotCompleteEndedLines({ service: ending.service, title: ending.title, reference: ending.reference,
    patient: ending.patient, ordering: ending.ordering, reason: ending.reason, priority: ending.priority, result: ending.result })
  const title = useRef<HTMLElement>(null)
  useEffect(() => { title.current?.focus() }, [ending])
  return <div className="staff-notice staff-stack" aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>{first}</strong>
    {rest.map((line, index) => <p key={index}>{line}</p>)}
    <div className="staff-row"><Button tone="quiet" size="sm" onClick={onClose}>Close
      <ItemName>: {ending.title}{ending.reference ? `, Ref ${ending.reference}` : ''}</ItemName></Button></div>
  </div>
}

/** The page's endings, newest first, each closed on its own. */
export function CannotCompleteEndings({ service, endings, onClose }: { service: ReceivingService
  endings: readonly CannotCompleteEnding[]; onClose: (key: string) => void }) {
  if (endings.length === 0) return null
  return <div className="staff-stack">{endings.map(ending => <CannotCompleteEnded key={ending.key}
    id={`${service}-not-completed-${ending.key}`} ending={ending} onClose={() => onClose(ending.key)} />)}</div>
}
