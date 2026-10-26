import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { ItemName } from '../ItemName'
import { useSession } from '../session'
import type { PatientOrderRoute } from '../api'
import {
  carriesCorrectableUntil, correctableUntilOf, learnLateCorrectionServed, useLateCorrectionServed, wrongPatientReportOf,
} from '../lateCorrectionServed'
import { usePatientResource } from './usePatientResource'
import { useActionFocus } from './actionFocus'

/**
 * Orders a clinician sent to a laboratory or pharmacy at another facility (Novu, P4c, SPEC-FINAL §5, §13.4): the
 * patient sees each one, the clinician's confirmation that they agreed, exactly what the other facility received or
 * will receive, and can stop it until that facility accepts it. An order its clinician marked entered in error (it may
 * have been written in another patient's chart) stays listed by reference, state and facilities only, with no content,
 * confirmation or Stop (`enteredInError`, P4c review). hid-system main, and a Novu before P4c, have no such list (404):
 * then the card is not shown.
 */

const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' })
const MOMENT = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })

function day(value: string | null | undefined): string {
  if (!value) return 'an unknown date'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown date' : DAY.format(parsed)
}

/** A deadline, which is a moment and not the whole day: its day and time in Lagos. */
function moment(value: string | null | undefined): string {
  if (!value) return 'an unknown time'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown time' : MOMENT.format(parsed)
}

/** A calendar day sent as YYYY-MM-DD, shown as that day wherever the browser is. */
function calendarDay(value: string | number | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!plain) return day(value)
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))))
}

function named(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback
}

function text(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/** "Full blood count" or "Amoxicillin 500 mg capsules": what was sent, in the card's title. */
function whatWasSent(route: PatientOrderRoute): string {
  if (route.enteredInError) return route.kind === 'lab_request' ? 'A test request' : 'A prescription'
  return route.kind === 'lab_request'
    ? text(route.content.testDisplay) ?? 'A test request'
    : text(route.content.medicationDisplay) ?? 'A prescription'
}

/**
 * Where it stands, as the patient reads it. A report the receiving facility made after the order had ended another way
 * (D17, `wrongPatient`) follows that ending's words (SPEC-FINAL §9.3).
 */
export function patientRouteState(route: PatientOrderRoute): string {
  const receiving = named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility')
  // The receiving facility reports it accepted it for someone who was not the patient (item 3, §9.4): said as its report.
  if (route.endedKind === 'wrong_patient' && (route.effectiveState === 'cancelled' || route.effectiveState === 'completed')) {
    return `ended: ${receiving} reports it accepted it for someone who was not you`
  }
  const words = stateWords(route, receiving)
  return route.endedKind !== 'wrong_patient' && wrongPatientReportOf(route)
    ? `${words}; ${receiving} has since reported it accepted it for someone who was not you` : words
}

function stateWords(route: PatientOrderRoute, receiving: string): string {
  const ordering = named(route.orderingFacilityName, 'your clinician’s facility')
  switch (route.effectiveState) {
    case 'sent': return route.acceptLocked
      ? `${receiving} could not confirm it was you, so it can’t take it. Ask your clinician to send it again`
      : `waiting for ${receiving} to accept it`
    case 'accepted': return `accepted by ${receiving}`
    case 'completed': {
      const returned = route.kind === 'lab_request' ? `${receiving} sent the result back to ${ordering}` : `dispensed by ${receiving}`
      // A completed order whose access ended another way no longer reads as a plain return (item 3, §8.3).
      switch (route.endedKind) {
        case 'support': return `${returned}; Health ID support has since closed it`
        case 'entered_in_error': return `${returned}; your clinician has since marked the order as entered in error`
        case 'receiving_released': return `${returned}; ${receiving} is no longer on Health ID`
        case 'ordering_released': return `${returned}; ${ordering} is no longer on Health ID`
        default: return returned
      }
    }
    case 'declined': return `${receiving} could not take it`
    case 'withdrawn':
      switch (route.endedKind) {
        case 'patient': return 'you stopped it'
        case 'orderer': return `withdrawn by ${ordering}`
        case 'order_changed': case 'entered_in_error': return 'withdrawn because your clinician changed the order'
        case 'support': return 'withdrawn by Health ID support'
        case 'receiving_released': return `withdrawn: ${receiving} is no longer on Health ID`
        case 'ordering_released': return `withdrawn: ${ordering} is no longer on Health ID`
        default: return 'withdrawn'
      }
    case 'expired': return route.acceptedAt ? `accepted by ${receiving}, but nothing came back within 30 days` : `not accepted by ${receiving} within 7 days`
    case 'cancelled': return route.endedKind === 'support' ? 'cancelled by Health ID support' : `cancelled at ${receiving}`
    default: return route.effectiveState.replaceAll('_', ' ')
  }
}

/**
 * Every field the other facility receives, as the patient reads it (PRIV P7.5): what it received once it accepted the
 * order, or will receive once it accepts.
 */
export function sentFields(route: PatientOrderRoute): Array<[label: string, value: string]> {
  const content = route.content
  const orderer = text(content.ordererName)
  const licence = text(content.ordererLicenceBody)
    ? `${text(content.ordererLicenceBody)}${text(content.ordererLicenceNumber) ? ` ${text(content.ordererLicenceNumber)}` : ''}` : null
  const fields: Array<[string, string | null]> = route.kind === 'lab_request' ? [
    ['Test', [text(content.testDisplay), [text(content.testCodeSystem), text(content.testCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null],
    ['Priority', text(content.priority)],
    ['Specimen type', text(content.specimenTypeCode)],
    ['What your clinician wrote about it', text(content.clinicalInformation)],
    ['Requested on', content.requestedAt ? day(String(content.requestedAt)) : null],
  ] : [
    ['Medicine', [text(content.medicationDisplay), [text(content.medicationCodeSystem), text(content.medicationCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null],
    ['Dose', [text(content.doseQuantity), text(content.doseUnit)].filter(Boolean).join(' ') || null],
    ['How it is taken', text(content.routeCode)],
    ['How often', text(content.frequency)],
    ['Instructions', text(content.instructions)],
    ['Starts', calendarDay(content.startsOn)],
    ['Ends', calendarDay(content.endsOn)],
    ['Prescribed on', content.prescribedAt ? day(String(content.prescribedAt)) : null],
  ]
  return [...fields,
    [route.kind === 'lab_request' ? 'Requested by' : 'Prescribed by', [orderer, licence ? `licence ${licence}` : null].filter(Boolean).join(', ') || null],
    ['You', `your name, sex, date of birth and the last 4 characters of your Health ID${route.acceptedAt ? '' : ', once it accepts'}`],
  ].filter((entry): entry is [string, string] => entry[1] !== null)
}

/** The clinician's confirmation as they confirmed it, with the names filled. */
function attestation(route: PatientOrderRoute, patient: string): string | null {
  if (!route.attestationText) return null
  return route.attestationText.replaceAll('{patient}', patient)
    .replaceAll('{orderingFacility}', named(route.orderingFacilityName, 'the facility'))
    .replaceAll('{receivingFacility}', named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility'))
}

/**
 * What the patient is told of an order the receiving facility ended as accepted for someone who was not them (item 3,
 * §9.4; C3, C12), or reported so after the order had ended (D17, SPEC-FINAL §9.3): what it had received, what was
 * withdrawn (only once something had come back: `completedAt`), and what to do. Its words say what the facility reported.
 * `full` is false for an order also marked entered in error, whose content is not shown: then what the facility had
 * received is said without "the details above" (CT9), and, from a backend that sends the report (`wrongPatient`), once
 * something had come back, the sentences that name no content (CL7). `served` (the late correction is served) adds
 * Health ID support to whom to tell (CL4).
 */
export function wrongPatientParagraph(route: PatientOrderRoute, full = true, served = false): string[] {
  const receiving = named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility')
  const ordering = named(route.orderingFacilityName, 'your clinician’s facility')
  const lab = route.kind === 'lab_request'
  const report = wrongPatientReportOf(route)
  const thing = lab ? 'test request' : 'prescription'
  const received = `It had received your name, sex, date of birth${full ? ',' : ' and'} the last 4 characters of your Health ID`
    + `${full ? ' and the details above' : ''}.`
  const first = report?.late
    ? `${receiving} told Health ID on ${day(report.reportedAt)} that the person it accepted this ${thing} for was not you. ${received}`
    : `${receiving} told Health ID that the person it accepted this ${thing} for was not you, so it ended it on `
      + `${day(route.endedAt)}. ${received} It can no longer see them through this order.`
  const withdrawn = route.completedAt ? lab
    ? 'A result it recorded on this order belongs to that other person. It is marked as not yours and no longer shows in your '
      + 'health record; the facilities keep it, marked, in their own records.'
    : 'It recorded the medicine as given on this order to that other person: that record has been cancelled.' : null
  const tell = served ? `${ordering} and Health ID support` : ordering
  const dispute = lab
    ? `If you did give a sample at ${receiving} for this test, tell ${tell}.`
    : `If you did collect this medicine at ${receiving}, or someone collected it for you, tell ${tell} before you get another prescription.`
  const again = `If you still need this ${lab ? 'test' : 'medicine'}, contact ${ordering}: your clinician can send a new order.`
  if (!full) return report && withdrawn ? [first, withdrawn, dispute, again] : [first]
  return [first, ...(withdrawn ? [withdrawn] : []), dispute, again,
    'If you didn’t give anyone your Health ID or date of birth and think someone used them, contact Health ID support.']
}

/**
 * "If you haven't been to {B}": while the receiving facility may still correct the order (D17: a `correctableUntil` time),
 * whom to tell, with the reference and the deadline's day and time (CT5); once it can't (null), after something came back and with no
 * report, the ordering facility. Without the field (an earlier backend) the line is shown, as before, while the facility
 * may still work on the order (`stoppable`). Null when nothing is to be said.
 */
export function haventBeenLine(route: PatientOrderRoute, stoppable: boolean): string | null {
  const receiving = named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility')
  const ordering = named(route.orderingFacilityName, 'your clinician’s facility')
  const lab = route.kind === 'lab_request'
  const until = correctableUntilOf(route)
  if (until === undefined) {
    if (!stoppable) return null
    return lab
      ? `If you haven’t been to ${receiving} for this test, tell ${receiving} or Health ID support straight away.`
      : `If you haven’t been to ${receiving} for this medicine, and no one collected it for you, tell ${receiving} or Health ID support straight away.`
  }
  if (until === null) return route.completedAt && !wrongPatientReportOf(route) && route.endedKind !== 'wrong_patient'
    ? `If you haven’t been to ${receiving} for this ${lab ? 'test' : 'medicine'}, tell ${ordering}.` : null
  const reference = route.reference ? `, with the reference ${route.reference}` : ''
  return lab
    ? `If you haven’t been to ${receiving} for this test, tell ${receiving}, ${ordering} or Health ID support straight away`
      + `${reference}: ${receiving} can correct it until ${moment(until)}.`
    : `If you haven’t been to ${receiving} for this medicine, and no one collected it for you, tell ${receiving}, ${ordering} or `
      + `Health ID support straight away${reference}: ${receiving} can correct it until ${moment(until)}.`
}

/** What a refused Stop means. */
function stopProblem(error: unknown, receiving: string): { text: string; reload: boolean } {
  if (isHidApiError(error) && (error.code === 'ORDER_ROUTE_NOT_PENDING' || error.status === 404 || error.status === 412)) {
    return { reload: true, text: `It can no longer be stopped here: ${receiving} has accepted it, or it has already ended. The list has been refreshed.` }
  }
  if (!isHidApiError(error) || error.status === 0 || error.status >= 500) return { reload: true,
    text: 'Health ID did not answer, so it may or may not have been stopped. The list has been refreshed: check it.' }
  return { reload: false, text: error.message || 'It could not be stopped. Try again.' }
}

export function SentOrdersCard() {
  const { api } = useSession()
  // A backend without the list answers 404: the card is then not shown.
  const load = useCallback((signal?: AbortSignal) => api.orderRoutes(signal).catch((caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) return null
    throw caught
  }), [api])
  const routes = usePatientResource(load)
  const profile = usePatientResource(api.profile)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  // A list whose orders carry their deadline comes from a backend that serves the late correction (D17, SPEC-FINAL §9.0).
  const served = useLateCorrectionServed() === true
  const listed = routes.data?.items
  useEffect(() => { if (carriesCorrectableUntil(listed)) learnLateCorrectionServed(true) }, [listed])

  if (routes.data === null && !routes.loading && !routes.error) return null
  const items = routes.data?.items ?? []
  const patient = profile.data?.fullName?.trim() || 'you'

  const stop = async (route: PatientOrderRoute) => {
    if (working) return
    const receiving = named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility')
    setWorking(route.id); setError(null); setNotice(null)
    try {
      await api.stopOrderRoute(route)
      setNotice(`Stopped. ${receiving} can no longer accept it, and ${named(route.orderingFacilityName, 'your clinician’s facility')} is told.`)
      await routes.reload()
      focusAfter(() => heading.current)
    } catch (cause) {
      const problem = stopProblem(cause, receiving)
      setError(problem.text)
      if (problem.reload) await routes.reload()
      focusAfter(() => document.getElementById(`stop-${route.id}`) ?? heading.current)
    } finally { setWorking(null) }
  }

  return <div className="patient-card" aria-busy={(routes.loading && routes.data !== null) || undefined}>
    <h2 ref={heading} tabIndex={-1}>Orders sent to other facilities</h2>
    <p className="patient-field-hint">Test requests and prescriptions your clinician sent to a laboratory or pharmacy at another
      facility, and exactly what that facility receives.</p>
    {routes.loading && routes.data === null && <p role="status">Loading your orders…</p>}
    {routes.error && <p role="alert">{routes.error}</p>}
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {routes.data && !routes.error && (items.length === 0 ? <p className="patient-empty">No test request or prescription has been sent to another facility.</p>
      : <ul className="patient-list">{items.map(route => {
        const receiving = named(route.receivingFacilityName ?? route.receivingFacility.name, 'the other facility')
        const ordering = named(route.orderingFacilityName, 'your clinician’s facility')
        const inError = route.enteredInError === true
        const confirmed = inError ? null : attestation(route, patient)
        const canStop = !inError && route.actions.includes('withdraw') && route.effectiveState === 'sent'
        // What the facility received, once it accepted (B5), and whether it may still be working on it: two conditions.
        const received = Boolean(route.acceptedAt)
        const stoppable = (route.effectiveState === 'accepted' || route.effectiveState === 'completed') && !route.endedAt
        // Item 3's ending, or a report made after the order had ended another way (D17).
        const wrongPatient = route.endedKind === 'wrong_patient' || wrongPatientReportOf(route)?.late === true
        const haventBeen = haventBeenLine(route, stoppable)
        return <li key={route.id} className="patient-access-item patient-order-route"><div>
          <strong>{whatWasSent(route)} from {ordering} to {receiving}: {patientRouteState(route)}</strong>
          {route.receivingRegisteredAddress && <span>{receiving}’s registered office: {route.receivingRegisteredAddress}</span>}
          <span>Sent on {day(route.createdAt)}{route.reference ? ` · Reference ${route.reference}` : ''}</span>
          {confirmed && <>
            <p>{named(route.attestedByName, 'Your clinician')} at {ordering} confirmed that you agreed:</p>
            <blockquote className="patient-quote">{confirmed}</blockquote>
          </>}
          {inError ? <>
            <p>{ordering} marked this order as entered in error, so what it contained is no longer shown here.</p>
            {wrongPatient ? wrongPatientParagraph(route, false, served).map((line, index) => <p key={index}>{line}</p>)
              : route.acceptedAt && <p>{receiving} had accepted it, so it received your name, sex, date of birth and the last
                4 characters of your Health ID.</p>}
            {correctableUntilOf(route) !== undefined && haventBeen && <p>{haventBeen}</p>}
            <p>If you have questions about it, contact {ordering}.</p>
          </> : <>
            <p><strong>{received ? `What ${receiving} received` : `What ${receiving} will receive`}</strong></p>
            <dl className="patient-details">{sentFields(route).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {wrongPatient && wrongPatientParagraph(route, true, served).map((line, index) => <p key={index}>{line}</p>)}
            {canStop && <p>If you did not agree to this, stop it now: {receiving} has not accepted it yet.</p>}
            {stoppable && route.effectiveState === 'accepted' && <p>{receiving} has accepted it. To stop it, contact {ordering}, who
              can cancel the order.</p>}
            {haventBeen && <p>{haventBeen}</p>}
          </>}
        </div>
          {canStop && <div className="patient-decision-actions"><button id={`stop-${route.id}`} type="button" className="patient-secondary-button"
            disabled={!!working || routes.loading} onClick={() => void stop(route)}>{working === route.id ? 'Stopping…' : 'Stop it'}<ItemName>: {whatWasSent(route)} to {receiving}</ItemName></button></div>}
        </li>
      })}</ul>)}
  </div>
}
