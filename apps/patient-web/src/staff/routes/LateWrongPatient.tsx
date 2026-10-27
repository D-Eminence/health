import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Button, Field, Input, Textarea } from '@hid/ui'
import {
  orderRoutesApi, type CorrectableOrderRoute, type OrderRouteDiscoveredBy, type OrderRouteWrongPatientCorrected,
  type OrderRouteWrongPatientReason, type ReceivingService,
} from '../api'
import {
  correctableFindRefusal, correctableRoutes, DISCOVERED_BY, lagosDay, lateCorrectionLines, lateCorrectionRowLines,
  lateWrongPatientRefusal, REFERENCE_PATTERN, REFERENCE_PROBLEM, returnedDays, routeDay, WRONG_PATIENT_REASONS,
} from '../orderRoutes'
import { BUSY, QUIET_UNAVAILABLE, UNAVAILABLE } from '../focus'
import { learnLateCorrectionServed } from '../../lateCorrectionServed'
import { useCannotCompleteServed } from '../../cannotCompleteServed'
import { ItemName } from '../../ItemName'
import { WrongPatientForm, type WrongPatientEnding } from './WrongPatient'
import { CannotCompleteAction, CannotCompleteForm, type CannotCompleteEnding } from './CannotComplete'

/**
 * "Correct an order that has ended" (D17, owner decisions D17-1 to D17-10; SPEC-FINAL §9.1): a laboratory or pharmacy
 * that finds out after an order from another facility has ended that it accepted it for someone who was not its patient
 * finds it by its 8-character reference and withdraws what it recorded on it, until the date the answer carries. Every
 * result it recorded is marked entered in error (or the dispensing reversed), the patient's record stops showing it, the
 * ordering facility sees "do not use: another person's", the patient gets an inbox notice and support a report flagged
 * "reported after the order had ended". It can't be undone.
 *
 * The lookup answers only orders this facility accepted, by exact reference, with this facility's own facts about each
 * (D17-8): the test or medicine, who here accepted it and how identity was checked, and what went back and when; never
 * the patient. Each lookup is audited, so it is read only when Find is pressed, and again only after a refusal that says
 * the order moved on (412) or is still open. An order still open is reported with item 3's own form (C25) after reading
 * it, which names the patient while it is open (CL5, S2).
 *
 * Shown, collapsed, right after the work list's toolbar, to a member holding the kind's receive permission, once the
 * backend has said it serves the late correction (lateCorrectionServed); a facility that no longer receives may still
 * hold past orders, so it is not tied to Incoming. What follows a withdrawal is said at page level, in the slot item 3's
 * message uses, until it is closed.
 *
 * Once "We can't complete this order" is served (D18), an order found still open and accepted can also be ended here
 * because it can't be completed (a row past the work list's cap can be reached only here): after its own read of the
 * order (C8, audited), which names the patient and the request's priority, D18's form opens on the row; one form at a
 * time. What follows is said at page level, with the page's other D18 endings.
 */

/** What the page says once an ended order is withdrawn here. */
export interface LateCorrection {
  service: ReceivingService
  title: string
  reference: string | null
  ordering: string
  result: OrderRouteWrongPatientCorrected
  /** The lookup said something had gone back (a result released or a dispensing recorded), whatever is left of it. */
  returned: boolean
}

function titleOf(route: CorrectableOrderRoute): string {
  return route.details?.what?.trim() || (route.kind === 'lab_request' ? 'Lab request' : 'Prescription')
}

function orderingOf(route: CorrectableOrderRoute): string {
  return route.orderingFacilityName?.trim() || 'the ordering facility'
}

interface Problems { discoveredBy?: string; discoveredOn?: string; reason?: string; note?: string; confirmed?: string }

/**
 * The late form ("Withdraw what you recorded: accepted for the wrong person"): how and when this facility found out, what
 * happened (item 3's four reasons), a note for Health ID support only, and the attestation that it checked its own
 * records (CL2). One Idempotency-Key per identical request, kept only after no answer (5xx, 408, none): the form then
 * stays open and the order is not found again, so the same request sent again answers what happened (replayed, and what
 * follows, if it had gone through). On 412 the caller finds the order again, and the form stays open at its new version.
 */
export function LateWrongPatientForm({ id, service, facilityId, route, onCorrected, onStale, onReload, onCancel }: {
  id: string; service: ReceivingService; facilityId: string; route: CorrectableOrderRoute
  onCorrected: (result: OrderRouteWrongPatientCorrected) => void
  /** The order moved on (412): find it again; the form takes the new version from its props. Given what was said. */
  onStale: (said: string) => Promise<void> | void
  /**
   * The order is not as the row said (still open, past its date, not found, a key used with other details): find it
   * again. Given what was said, which the section keeps in the row if the form closes.
   */
  onReload: (said: string) => Promise<void> | void
  onCancel: () => void
}) {
  const [discoveredBy, setDiscoveredBy] = useState<OrderRouteDiscoveredBy | ''>('')
  const today = lagosDay(new Date()) ?? ''
  const [discoveredOn, setDiscoveredOn] = useState(today)
  const [reason, setReason] = useState<OrderRouteWrongPatientReason | ''>('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  // The button that opened the form is gone: focus moves to the form's title.
  const title = useRef<HTMLElement>(null)
  // In the commit that shows it, not an effect a task later: a check made as soon as it is shown finds the focus moved.
  useLayoutEffect(() => { title.current?.focus() }, [])
  const lab = service === 'lab'
  const ordering = orderingOf(route)
  const accepted = lagosDay(route.acceptedAt)
  const returned = route.details?.returned ?? []
  const standing = returned.filter(item => !item.withdrawn)

  function refuse(field: keyof Problems, text: string, target: string) {
    setProblems({ [field]: text })
    document.getElementById(target)?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setProblems({})
    const written = note.trim()
    if (!discoveredBy) return refuse('discoveredBy', 'Choose how you found out.', `${id}-found-${DISCOVERED_BY[0]!.value}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(discoveredOn) || (today && discoveredOn > today) || (accepted && discoveredOn < accepted)) {
      return refuse('discoveredOn', `Enter the day you found out: not after today${accepted ? `, and not before the order was `
        + `accepted (${routeDay(route.acceptedAt)})` : ''}.`, `${id}-found-on`)
    }
    if (!reason) return refuse('reason', 'Choose what happened.', `${id}-reason-${WRONG_PATIENT_REASONS[0]!.value}`)
    if (written.length < 8 || written.length > 500) {
      return refuse('note', 'Describe what happened in 8 to 500 characters.', `${id}-note`)
    }
    if (!confirmed) return refuse('confirmed', 'Tick the box to confirm that you checked your own records.', `${id}-confirmed`)
    if (!Number.isSafeInteger(route.version) || route.version < 1) {
      setError('Find the order again before withdrawing it.')
      return
    }
    // The same request sent again after no answer is the same one; a changed request, or a new version, is a new one.
    const signature = JSON.stringify([route.id, route.version, reason, discoveredBy, discoveredOn, written])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const result = await orderRoutesApi.correctWrongPatient(facilityId, service, { id: route.id, version: route.version },
        { reason, discoveredBy, discoveredOn, note: written }, attempt.current.key)
      attempt.current = null
      onCorrected(result)
    } catch (caught) {
      // A refusal settles the request and frees its key; only an unanswered one keeps it for the same request.
      if (isHidApiError(caught) && caught.status > 0 && caught.status < 500 && caught.status !== 408) attempt.current = null
      const refusal = lateWrongPatientRefusal(caught, service, ordering, route.correctableUntil)
      setError(refusal.text)
      if (refusal.stale) await onStale(refusal.text)
      else if (refusal.reload) await onReload(refusal.text)
    } finally { setBusy(false) }
  }

  const days = returnedDays(standing.map(item => item.at))
  return <form className="staff-form staff-wrong-patient" onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>Withdraw what you recorded: accepted for the wrong person</strong>
    <p>This order has already ended. Use this only if the person you accepted it for was not its patient.</p>
    {!lab && <p>Someone collecting for the patient with their agreement is not the wrong person: don’t use this for them.</p>}
    <p>{lab
      ? `If you just couldn’t do the test, don’t use this. If a result was wrong but it was the patient’s, don’t use this either: `
        + `correct it under your laboratory’s procedure, and phone ${ordering}.`
      : `If you just couldn’t supply the medicine, don’t use this. If the dispensing was wrong but it was the patient’s, don’t `
        + `use this either: follow your incident procedure, and phone ${ordering}.`}</p>
    <fieldset className="staff-order-choices" aria-describedby={problems.discoveredBy ? `${id}-found-error` : undefined}
      aria-invalid={problems.discoveredBy ? true : undefined}>
      <legend>How did you find out?</legend>
      {DISCOVERED_BY.map(item => <label key={item.value} className="staff-choice">
        <input id={`${id}-found-${item.value}`} type="radio" name={`${id}-found`} value={item.value} checked={discoveredBy === item.value}
          onChange={() => { setDiscoveredBy(item.value); setProblems(current => ({ ...current, discoveredBy: undefined })) }} /> {item.label}</label>)}
    </fieldset>
    {problems.discoveredBy && <p id={`${id}-found-error`} className="staff-error">{problems.discoveredBy}</p>}
    {discoveredBy && discoveredBy !== 'own_check' && <p className="staff-notice">{lab
      ? `Before you withdraw it, confirm with ${ordering} and against your own records. A result that is only unexpected is not `
        + 'a reason to use this.'
      : `Before you withdraw it, confirm with ${ordering} and against your own records.`}</p>}
    <Field label="When did you find out?" htmlFor={`${id}-found-on`} error={problems.discoveredOn}
      hint={`The day this facility found out${accepted ? `, from ${routeDay(route.acceptedAt)} to today` : ', not after today'}.`}>
      <Input id={`${id}-found-on`} type="date" value={discoveredOn} max={today || undefined} min={accepted ?? undefined}
        onChange={event => { setDiscoveredOn(event.target.value); setProblems(current => ({ ...current, discoveredOn: undefined })) }} />
    </Field>
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
    <p><strong>What will happen</strong></p>
    <ul className="staff-order-notes">
      {lab && <li>Every result you recorded on it is marked entered in error.</li>}
      {lab && standing.length > 0 && <li>{standing.length === 1
        ? `The result that went back to ${ordering} on ${days} is shown to ${ordering} as not to be used, and no longer shows in `
          + `the patient’s health record. Anything ${ordering} wrote down from it stays until ${ordering} corrects it.`
        : `The ${standing.length} results that went back to ${ordering} on ${days} are shown to ${ordering} as not to be used, and `
          + `no longer show in the patient’s health record. Anything ${ordering} wrote down from them stays until ${ordering} `
          + 'corrects it.'}</li>}
      {!lab && <li>{standing.length > 0 ? `The dispensing you recorded on ${days} is reversed in the record.`
        : returned.length > 0 ? 'The dispensing you recorded was already reversed. The report is still made.'
          : 'Nothing was dispensed on it.'}</li>}
      {!route.endedAt && <li>The order is also ended as accepted for the wrong person.</li>}
      <li>The patient is told in the Health ID app. {ordering} sees it on the order, but Health ID does not alert them: you must
        phone them.</li>
      <li>Health ID support reviews every report. This can’t be undone.</li>
    </ul>
    <label className="staff-choice"><input id={`${id}-confirmed`} type="checkbox" checked={confirmed}
      aria-describedby={problems.confirmed ? `${id}-confirmed-error` : undefined} aria-invalid={problems.confirmed ? true : undefined}
      onChange={event => { setConfirmed(event.target.checked); setProblems(current => ({ ...current, confirmed: undefined })) }} />
      <span>{lab
        ? 'We accepted this order for someone who was not its patient. I have checked our own records of it: who accepted it, '
          + 'the identity they were shown, and the specimen record.'
        : 'We accepted this order for someone who was not its patient, and it was not collected for them. I have checked our '
          + 'own records of it: who accepted it, the identity they were shown, and the collection record.'}</span></label>
    {problems.confirmed && <p id={`${id}-confirmed-error`} className="staff-error">{problems.confirmed}</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    <div className="staff-row">
      <Button id={`${id}-withdraw`} type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Withdrawing…' : 'Withdraw it'}</Button>
      <Button tone="quiet" size="sm" aria-disabled={busy || undefined} className={QUIET_UNAVAILABLE}
        onClick={() => { if (!busy) onCancel() }}>Cancel</Button>
    </div>
  </form>
}

/**
 * Which form a row has open: the late one, or, for an order still open, item 3's or D18's, once it has been read (each
 * with its own read: the patient, and for D18 the lab request's priority).
 */
type Opened = { routeId: string; mode: 'late' } | { routeId: string; mode: 'report'; patient: string | null }
  | { routeId: string; mode: 'cannot_complete'; patient: string | null; priority: string | null }

/** Whether a row still allows the form a row has open (D18's needs the order still accepted, too). */
function allows(row: CorrectableOrderRoute | undefined, mode: Opened['mode']): boolean {
  if (!row) return false
  if (mode === 'late') return row.correction === 'correctable'
  return row.correction === 'open' && (mode === 'report' || row.effectiveState === 'accepted')
}

/**
 * What a form said before the section found its order again (a refusal that says the row is out of date), and the
 * correction state that keeps the form open. If the new answer closes it, what was said moves into the row (role
 * "alert") with focus on the row's first line, or to the section when the order is gone (UX-2).
 */
interface Said { routeId: string; keeps: Opened['mode']; text: string }

/**
 * "Correct an order that has ended", for one service. `onEnded` takes item 3's ending of an order found still open;
 * `onCorrected` a late withdrawal. Both are said by the page.
 */
export function LateWrongPatient({ service, facilityId, onEnded, onCorrected, onNotCompleted }: {
  service: ReceivingService; facilityId: string
  onEnded: (ending: WrongPatientEnding) => void
  onCorrected: (correction: LateCorrection) => void
  /** D18: an order still open ended here because it can't be completed. */
  onNotCompleted?: (ending: Omit<CannotCompleteEnding, 'key'>) => void
}) {
  const id = `${service}-late-correction`
  const [input, setInput] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<{ reference: string; items: CorrectableOrderRoute[] } | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [reading, setReading] = useState<{ routeId: string; mode: 'report' | 'cannot_complete' } | null>(null)
  // D18 (§9.0): an open, accepted order can also be ended here because it can't be completed.
  const cannotServed = useCannotCompleteServed() === true && Boolean(onNotCompleted)
  const [rowError, setRowError] = useState<{ routeId: string; text: string } | null>(null)

  /** Focus, once rendered, on an element of this section (a row's first line, or what the section says). */
  const focusSoon = (target: string) => { window.setTimeout(() => document.getElementById(target)?.focus(), 0) }

  /**
   * Reads the lookup for a reference (audited): on Find, and again after a refusal that says the order moved on. `said` is
   * that refusal: when the new answer closes its form, it stays in the row, or at the section if the order is gone.
   */
  async function find(reference: string, said?: Said): Promise<void> {
    setBusy(true); setError(''); setRowError(null)
    try {
      const answer = await orderRoutesApi.findCorrectable(facilityId, service, reference)
      // Any answer from the lookup says the backend serves the late correction.
      learnLateCorrectionServed(true)
      const items = correctableRoutes(answer)
      setFound({ reference, items })
      // A form stays open only on a row that still allows it.
      setOpened(current => current && allows(items.find(item => item.id === current.routeId), current.mode) ? current : null)
      const row = said ? items.find(item => item.id === said.routeId) : undefined
      if (said && !allows(row, said.keeps)) {
        if (row) {
          setRowError({ routeId: row.id, text: said.text })
          focusSoon(`${id}-${row.id}-title`)
        } else {
          setError(said.text)
          focusSoon(`${id}-error`)
        }
      }
    } catch (caught) {
      const refusal = correctableFindRefusal(caught)
      if (refusal.missing) learnLateCorrectionServed(false)
      setFound(null); setOpened(null)
      setError(said ? `${said.text} ${refusal.text}` : refusal.text)
      if (said) focusSoon(`${id}-error`)
    } finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const reference = input.trim().toUpperCase()
    if (!REFERENCE_PATTERN.test(reference)) {
      setProblem(REFERENCE_PROBLEM)
      document.getElementById(`${id}-reference`)?.focus()
      return
    }
    setProblem(''); setOpened(null)
    void find(reference)
  }

  /**
   * An order still open: read it first (C8, audited), which names the patient while it is open, then item 3's form, or,
   * for D18's, also the lab request's priority (whether the phone statement is required).
   */
  async function report(route: CorrectableOrderRoute, mode: 'report' | 'cannot_complete' = 'report') {
    if (reading) return
    setReading({ routeId: route.id, mode }); setRowError(null)
    try {
      const read = await orderRoutesApi.get(facilityId, service, route.id)
      const patient = typeof read?.patient?.fullName === 'string' && read.patient.fullName.trim() ? read.patient.fullName.trim() : null
      setOpened(mode === 'report' ? { routeId: route.id, mode, patient }
        : { routeId: route.id, mode, patient, priority: typeof read?.priority === 'string' ? read.priority : null })
    } catch {
      setRowError({ routeId: route.id, text: 'This order could not be read. Find it again, then try again.' })
    } finally { setReading(null) }
  }

  const again = async (said?: Said) => { if (found) await find(found.reference, said) }
  const close = (routeId: string, opener = 'open') => {
    setOpened(null)
    window.setTimeout(() => document.getElementById(`${id}-${routeId}-${opener}`)?.focus(), 0)
  }

  return <details className="staff-late-correction" id={id}>
    <summary>Correct an order that has ended</summary>
    <div className="staff-stack">
      <p>If you find out after an order from another facility has ended that you accepted it for someone who was not its
        patient, you can still withdraw what you recorded on it, until the date shown for that order. Find it by its
        reference: the ordering facility, the patient or Health ID support can give it to you.</p>
      <form className="staff-form" role="search" aria-label="Find an order that has ended" noValidate onSubmit={submit}>
        <Field label="Order reference" htmlFor={`${id}-reference`} error={problem || undefined} hint="8 characters, for example 3F2A9C1B.">
          <Input id={`${id}-reference`} value={input} autoComplete="off" spellCheck={false} maxLength={16}
            onChange={event => { setInput(event.target.value); setProblem('') }} />
        </Field>
        <div className="staff-row"><Button id={`${id}-find`} type="submit" tone="secondary" size="sm" aria-disabled={busy || undefined}
          className={UNAVAILABLE}>{busy ? 'Finding…' : 'Find'}</Button></div>
      </form>
      {error && <p id={`${id}-error`} className="staff-error" role="alert" tabIndex={-1}>{error}</p>}
      <div role="status">{found && found.items.length === 0 && <p>No order with that reference was accepted here. Check it with
        whoever gave it to you.</p>}</div>
      {found && found.items.length > 0 && <ul className="staff-list">{found.items.map(route => {
        const rowId = `${id}-${route.id}`
        const open = opened?.routeId === route.id ? opened : null
        const ordering = orderingOf(route)
        const offersCannotComplete = cannotServed && route.correction === 'open' && route.effectiveState === 'accepted'
        return <li key={route.id} className="staff-list-item staff-stack">
          {lateCorrectionRowLines(route, service, cannotServed).map((line, index) => index === 0
            ? <strong key={index} id={`${rowId}-title`} tabIndex={-1}>{line}</strong> : <p key={index}>{line}</p>)}
          {rowError?.routeId === route.id && <p className="staff-error" role="alert">{rowError.text}</p>}
          {route.correction === 'correctable' && (open?.mode === 'late'
            ? <LateWrongPatientForm id={`${rowId}-form`} service={service} facilityId={facilityId} route={route}
              onStale={said => again({ routeId: route.id, keeps: 'late', text: said })}
              onReload={said => again({ routeId: route.id, keeps: 'late', text: said })} onCancel={() => close(route.id)}
              onCorrected={result => {
                setOpened(null); setFound(null)
                onCorrected({ service, title: titleOf(route), reference: route.reference, ordering, result,
                  returned: route.returned || (route.details?.returned.length ?? 0) > 0 })
              }} />
            : <div className="staff-row"><Button id={`${rowId}-open`} tone="secondary" size="sm" aria-expanded={false}
              onClick={() => setOpened({ routeId: route.id, mode: 'late' })}>This wasn’t the order’s patient</Button></div>)}
          {route.correction === 'open' && (open?.mode === 'report'
            ? <WrongPatientForm id={`${rowId}-form`} service={service} facilityId={facilityId}
              route={{ id: route.id, version: route.version, reference: route.reference }} patient={open.patient} ordering={ordering}
              dispensed={service === 'pharmacy' && route.details
                ? route.details.returned.some(item => !item.withdrawn) : undefined}
              cannotComplete={offersCannotComplete ? 'lookup' : undefined}
              onStale={said => again(said ? { routeId: route.id, keeps: 'report', text: said } : undefined)}
              onReload={said => void again(said ? { routeId: route.id, keeps: 'report', text: said } : undefined)}
              onCancel={() => close(route.id)}
              onEnded={result => {
                setOpened(null); setFound(null)
                onEnded({ service, title: titleOf(route), reference: route.reference, patient: open.patient, ordering, result,
                  dateOfBirthOnly: route.details?.acceptedWith === 'date_of_birth' })
              }} />
            : open?.mode === 'cannot_complete' && offersCannotComplete
              ? <CannotCompleteForm id={`${rowId}-cannot-complete`} service={service} facilityId={facilityId}
                route={{ id: route.id, version: route.version, reference: route.reference }} patient={open.patient}
                ordering={ordering} priority={open.priority} acceptedAt={route.acceptedAt}
                onStale={said => again({ routeId: route.id, keeps: 'cannot_complete', text: said })}
                onReload={said => again({ routeId: route.id, keeps: 'cannot_complete', text: said })}
                onCancel={() => close(route.id, 'cannot-complete-open')}
                onEnded={(result, reason) => {
                  setOpened(null); setFound(null)
                  onNotCompleted?.({ service, title: titleOf(route), reference: route.reference, patient: open.patient, ordering,
                    reason, priority: open.priority, result })
                }} />
              : <><div className="staff-row"><Button id={`${rowId}-open`} tone="secondary" size="sm" aria-expanded={false}
                aria-disabled={reading?.routeId === route.id || undefined} className={UNAVAILABLE}
                onClick={() => void report(route)}>{reading?.routeId === route.id && reading.mode === 'report' ? 'Reading the order…'
                  : 'This isn’t the order’s patient'}
                {offersCannotComplete && <ItemName>: {titleOf(route)}{route.reference ? `, Ref ${route.reference}` : ''}</ItemName>}</Button></div>
              {offersCannotComplete && <CannotCompleteAction id={`${rowId}-cannot-complete-open`} title={titleOf(route)}
                reference={route.reference} reading={reading?.routeId === route.id && reading.mode === 'cannot_complete'}
                onOpen={() => void report(route, 'cannot_complete')} />}</>)}
        </li>
      })}</ul>}
    </div>
  </details>
}

/**
 * Said once an ended order is withdrawn here (SPEC-FINAL §9.1; CT7, CL1, CL9): it stays until closed, and says to phone
 * the ordering facility, which Health ID does not alert.
 */
export function LateCorrectionDone({ id, correction, onClose }: { id: string; correction: LateCorrection; onClose: () => void }) {
  const returned = correction.returned || correction.result.resultReportsMarked > 0 || correction.result.dispensingReversed
  const [first, ...rest] = lateCorrectionLines({ service: correction.service, title: correction.title,
    reference: correction.reference, ordering: correction.ordering, returned })
  const title = useRef<HTMLElement>(null)
  useLayoutEffect(() => { title.current?.focus() }, [correction])
  return <div className="staff-notice staff-danger staff-stack" aria-labelledby={`${id}-title`}>
    <strong id={`${id}-title`} ref={title} tabIndex={-1}>{first}</strong>
    {rest.map((line, index) => <p key={index}>{line}</p>)}
    <div className="staff-row"><Button tone="quiet" size="sm" onClick={onClose}>Close</Button></div>
  </div>
}
