import { isHidApiError } from '@hid/http'
import type {
  CorrectableOrderRoute, CorrectableOrderRouteDetails, Facility, OrderRouteDeclineReason, OrderRouteDiscoveredBy, OrderRouteKind,
  OrderRoutePatient, OrderRouteSummary, OrderRouteWithdrawReason, OrderRouteWrongPatientReason, ReceivingAnswer,
  ReceivingService, WorkItemOrderRoute,
} from './api'
import { usesNovuBackend } from '../backendContract'
import { correctableUntilOf, wrongPatientReportOf } from '../lateCorrectionServed'
import { selfServiceReview, selfServiceType } from './staffAccess'

/**
 * The words of orders between facilities (Novu, P4c, SPEC-FINAL §13): what a clinician, a laboratory scientist or a
 * pharmacist reads about a lab request or prescription sent to another facility, and what each refusal means. The
 * services decide everything; these only say it.
 */

/** Dates as Nigerian staff read them, in West Africa Time. */
const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' })
const MOMENT = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })

export function routeDay(value: string | null | undefined): string {
  if (!value) return 'an unknown date'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown date' : DAY.format(parsed)
}

export function routeMoment(value: string | null | undefined): string {
  if (!value) return 'an unknown time'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown time' : MOMENT.format(parsed)
}

/**
 * A calendar day sent as YYYY-MM-DD (a date of birth, a prescription's start or end), shown as that day wherever the
 * browser is.
 */
export function calendarDate(value: string | null | undefined): string {
  const plain = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!plain) return value ? routeDay(value) : 'Not recorded'
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))))
}

/** The stored states with a route in force (SPEC-FINAL §3.2). */
const LIVE: ReadonlySet<string> = new Set(['sent', 'accepted', 'completed'])

/**
 * Whether an order is sent to another facility, so this facility's own Lab or Pharmacy may not take it: its latest
 * route is in force, or was ever accepted (that facility then holds the order's one work item for good). The EHR
 * applies the same rule (LAB_REQUEST_ROUTED, PRESCRIPTION_ROUTED, ORDER_ROUTED).
 */
export function routedElsewhere(route: OrderRouteSummary | null | undefined): boolean {
  return Boolean(route && (LIVE.has(route.effectiveState) || route.acceptedAt))
}

/** Whether the route still waits for the receiving facility (Withdraw is offered then). */
export function routeWaiting(route: OrderRouteSummary | null | undefined): boolean {
  return route?.effectiveState === 'sent'
}

/** What is sent, in a sentence: "lab request" or "prescription". */
export function orderWord(kind: OrderRouteKind): string {
  return kind === 'lab_request' ? 'lab request' : 'prescription'
}

/** Where it goes, in a sentence: "laboratory" or "pharmacy". */
export function destinationWord(kind: OrderRouteKind): string {
  return kind === 'lab_request' ? 'laboratory' : 'pharmacy'
}

export const DECLINE_REASONS: ReadonlyArray<{ value: OrderRouteDeclineReason; label: string; kinds: readonly OrderRouteKind[] }> = [
  { value: 'test_not_offered', label: 'This test isn’t offered', kinds: ['lab_request'] },
  { value: 'medicine_unavailable', label: 'The medicine isn’t available', kinds: ['prescription'] },
  { value: 'cannot_meet_priority', label: 'It can’t be done at this priority', kinds: ['lab_request', 'prescription'] },
  { value: 'patient_not_seen', label: 'The patient didn’t come', kinds: ['lab_request', 'prescription'] },
  { value: 'other', label: 'Another reason', kinds: ['lab_request', 'prescription'] },
]

export function declineReasonLabel(reason: string | null | undefined): string {
  return DECLINE_REASONS.find(item => item.value === reason)?.label ?? 'Another reason'
}

export const WITHDRAW_REASONS: ReadonlyArray<{ value: OrderRouteWithdrawReason; label: string }> = [
  { value: 'sent_in_error', label: 'Sent in error' },
  { value: 'patient_request', label: 'The patient asked for it to be stopped' },
  { value: 'other', label: 'Another reason' },
]

/** A facility named in a sentence, or the words that stand for it when the service sent none. */
function named(name: string | null | undefined, fallback = 'the other facility'): string {
  return name?.trim() ? name.trim() : fallback
}

/**
 * The line under an order's row about its latest route (SPEC-FINAL §13.1), by its effective state and how it ended.
 * `patient` is the patient's name as the record shows it.
 */
export function routeStatusText(route: OrderRouteSummary, patient: string): { text: string; tone: 'information' | 'success' | 'warning' | 'neutral' } {
  const facility = named(route.receivingFacility.name)
  switch (route.effectiveState) {
    case 'sent':
      return route.acceptLocked
        ? { tone: 'warning', text: `${facility} could not confirm the patient’s identity, so it can’t accept this. Withdraw it and send it again or elsewhere.` }
        : { tone: 'information', text: `Sent to ${facility}: waiting for it to accept, until ${routeMoment(route.respondBy)}.` }
    case 'accepted':
      return { tone: 'success', text: `Accepted by ${facility} on ${routeDay(route.acceptedAt)}.` }
    case 'completed':
      // The receiving facility reports it accepted the order for the wrong person (item 3, §9.2): what came back is not
      // the patient's, and has been withdrawn.
      if (route.endedKind === 'wrong_patient') return { tone: 'warning', text: route.kind === 'lab_request'
        ? `${facility} reports that the results it released belong to someone else, and has ended it. Do not use them.`
        : `${facility} reports that it dispensed this to someone who was not ${patient}, and has ended it.` }
      // D17: it reported it after the order had ended another way, which it keeps (D17-4).
      if (wrongPatientReportOf(route)) return { tone: 'warning', text: route.kind === 'lab_request'
        ? `${facility} reports that the results it released belong to someone else, and has withdrawn them. Do not use them.`
        : `${facility} reports that it dispensed this to someone who was not ${patient}, and has reversed it.` }
      return { tone: 'success', text: route.kind === 'lab_request'
        ? `Results released by ${facility}${route.completedAt ? ` on ${routeDay(route.completedAt)}` : ''}.`
        : `Dispensed by ${facility}${route.completedAt ? ` on ${routeDay(route.completedAt)}` : ''}.` }
    case 'declined':
      return { tone: 'warning', text: `Declined by ${facility}: ${declineReasonLabel(route.declineReason)}. Send it elsewhere.` }
    case 'withdrawn':
      return { tone: 'neutral', text: withdrawnText(route, facility, patient) }
    case 'expired':
      return { tone: 'warning', text: route.acceptedAt
        ? `Accepted by ${facility} on ${routeDay(route.acceptedAt)}; nothing came back within 30 days.`
        : `Not accepted by ${facility} within 7 days. Send it elsewhere.` }
    case 'cancelled':
      return { tone: 'warning', text: cancelledText(route, facility, patient)
        + (route.endedKind !== 'wrong_patient' && wrongPatientReportOf(route)
          ? ` ${facility} has since reported that it accepted it for someone who was not ${patient}.` : '') }
    default:
      return { tone: 'neutral', text: `Sent to ${facility}: ${route.effectiveState.replaceAll('_', ' ')}.` }
  }
}

function withdrawnText(route: OrderRouteSummary, facility: string, patient: string): string {
  switch (route.endedKind) {
    case 'patient': return `${patient} stopped it in the Health ID app.`
    case 'order_changed': return 'Withdrawn because the order changed. Send it again.'
    case 'entered_in_error': return 'Withdrawn because the order was marked entered in error.'
    case 'receiving_released': return `Withdrawn: ${facility} is no longer on Health ID.`
    case 'ordering_released': return 'Withdrawn: this facility is no longer on Health ID.'
    case 'support': return 'Withdrawn by Health ID support.'
    case 'order_in_work': return 'Withdrawn: this order is already being worked on here.'
    default: return 'Withdrawn.'
  }
}

function cancelledText(route: OrderRouteSummary, facility: string, patient: string): string {
  switch (route.endedKind) {
    case 'wrong_patient': return `${facility} reports that it accepted this for someone who was not ${patient}, and has ended it. `
      + 'Nothing came back from it.'
    case 'order_changed': return `Cancelled at ${facility} because the order changed.`
    case 'entered_in_error': return `Cancelled at ${facility} because the order was marked entered in error.`
    case 'receiving_released': return `Cancelled: ${facility} is no longer on Health ID.`
    case 'ordering_released': return `Cancelled at ${facility}: this facility is no longer on Health ID.`
    case 'support': return `Cancelled at ${facility} by Health ID support.`
    default: return `Cancelled at ${facility}.`
  }
}

/**
 * The red notice under an order whose receiving facility reports it accepted it for someone who was not the patient
 * (item 3, §9.2): the order can't be sent again (D5), and, when something had come back, what to do about it. The words
 * say what the facility reports, never that it is so (C3).
 */
export function wrongPatientNotice(route: Pick<OrderRouteSummary, 'kind' | 'effectiveState' | 'receivingFacility'>,
  patient: string): string[] {
  const facility = named(route.receivingFacility.name)
  const lines = [`This order can’t be sent again. Write a new ${orderWord(route.kind)} if ${patient} still needs it.`]
  if (route.effectiveState === 'completed') lines.push(route.kind === 'lab_request'
    ? `Do not use any result from ${facility} on this order: ${facility} reports they are another person’s. ${patient} has `
      + `not been tested: repeat the test if it is still needed. If you acted on a result, review ${patient}’s care. Tell `
      + `${patient} that a result they may have seen was not theirs.`
    : `${facility} reports that ${patient} did not receive this medicine from it. Check with ${patient} before you prescribe it `
      + 'again, especially a controlled medicine.')
  return lines
}

/**
 * The sentence added to the red notice of an order the receiving facility reported after something had come back (D17,
 * CL1, D17-4): when, and that what the clinician recorded from it still shows until they correct it. Null for a report in
 * the window, or on an order nothing came back from.
 */
export function lateReportNotice(route: Pick<OrderRouteSummary, 'effectiveState' | 'completedAt'> & { wrongPatient?: unknown },
  patient: string): string | null {
  const report = wrongPatientReportOf(route)
  if (!report?.late || route.effectiveState !== 'completed') return null
  const came = route.completedAt ? Date.parse(route.completedAt) : Number.NaN
  const days = Number.isFinite(came) ? Math.max(0, Math.floor((Date.parse(report.reportedAt) - came) / 86_400_000)) : null
  const when = days === null ? 'This was reported after it came back.'
    : days === 0 ? 'This was reported on the day it came back.'
      : `This was reported ${days} day${days === 1 ? '' : 's'} after it came back.`
  return `${when} Anything you recorded from it (a note, a diagnosis, a prescription) still shows to ${patient} and to the `
    + `assistants until you amend it or mark it entered in error. Tell ${patient} directly: Health ID tells them only in the app.`
}

/**
 * What the ordering clinician may do about an order something came back on (D17-5, CL10, CT5; SPEC-FINAL §9.2): phone
 * the receiving facility with the reference, which can withdraw it until the date the answer carries; once it can't
 * (`correctableUntil: null`), record it in the patient's notes without repeating the value (D17-3). Only for a completed
 * route the receiving facility has not reported, from a backend that serves the late correction (`lateServed`) and says
 * the deadline: null otherwise, as before D17.
 */
export function routeGuidance(route: Pick<OrderRouteSummary, 'kind' | 'effectiveState' | 'reference' | 'receivingFacility'
  | 'endedKind'> & { wrongPatient?: unknown; correctableUntil?: unknown }, patient: string, lateServed = false): string | null {
  const until = correctableUntilOf(route)
  if (!lateServed || until === undefined || route.effectiveState !== 'completed' || route.endedKind === 'wrong_patient'
    || wrongPatientReportOf(route)) return null
  const facility = named(route.receivingFacility.name)
  const reference = route.reference ? ` and give it the reference ${route.reference}` : ' and give it the order’s reference'
  if (until === null) return route.kind === 'lab_request'
    ? `If a result from ${facility} on this order is not ${patient}’s, record that in ${patient}’s notes without repeating its `
      + 'value, and tell Health ID support.'
    : `If ${patient} did not receive this medicine from ${facility}, record that in ${patient}’s notes, and tell Health ID support.`
  return route.kind === 'lab_request'
    ? `If ${patient} says they did not give a sample at ${facility}, or you have evidence the sample was someone else’s, phone `
      + `${facility}${reference}: it can withdraw the result until ${routeDay(until)}. A result that is only unexpected is not a `
      + 'reason: repeat the test.'
    : `If ${patient} did not receive this medicine from ${facility}, and no one collected it for them, phone ${facility}`
      + `${reference}: it can reverse the dispensing until ${routeDay(until)}.`
}

/**
 * The warning where a clinician changes an order sent to another facility (Novu, P4c): its change is passed on there
 * (the EHR's mirror trigger), withdrawing it before that facility accepts it, or cancelling it there after. While that
 * facility may still work on it (accepted, or completed and not ended), changing it also stops that facility from
 * withdrawing a result or dispensing it sent back for the wrong person (item 3, C1, §9.2), so the clinician is asked to
 * have it ended there first: only from a backend that lets that facility end it (`reportServed`; until hid-system 0088
 * ships it can't, and the warning stays as it was, D15). Since D17 (`lateServed`, hid-system 0090) that facility may still
 * withdraw it after the order has changed or ended, until the date the summary carries (`correctableUntil`): the warning
 * then says so, with the reference, whether or not the order has ended; once that date is gone (null), it says only what a
 * change does.
 */
export function routedChangeWarning(route: (Pick<OrderRouteSummary, 'receivingFacility' | 'effectiveState' | 'endedAt'>
  & { reference?: string | null; correctableUntil?: unknown }) | null | undefined, patient: string, reportServed = false,
  lateServed = false): string {
  const name = route?.receivingFacility.name?.trim() || 'the other facility'
  const change = `Changing it withdraws it from ${name}, or cancels it there if ${name} has accepted it; a cancelled order can’t be resumed there.`
  const until = lateServed ? correctableUntilOf(route) : undefined
  if (route && until !== undefined) {
    if (until === null) return change
    const what = route.effectiveState === 'completed' ? 'what it sent back' : 'what it recorded on it'
    return `${change} If ${name} accepted it for someone who was not ${patient}, ask ${name} to withdraw ${what}, giving it the `
      + `reference ${route.reference || 'shown with the order'}: it can do so until ${routeDay(until)}, whether or not you `
      + 'change this order.'
  }
  const working = reportServed
    && Boolean(route && (route.effectiveState === 'accepted' || route.effectiveState === 'completed') && !route.endedAt)
  return working ? `${change} If ${name} accepted it for someone who was not ${patient}, ask ${name} to end it from its work `
    + `list first: once you change this order, ${name} can no longer withdraw a result or dispensing it sent back.` : change
}

/** Said under a route whose receiving facility is not eligible now (suspended, released or unlisted). */
export function unavailableText(route: OrderRouteSummary): string | null {
  return route.receivingFacility.available === false && LIVE.has(route.effectiveState)
    ? `${named(route.receivingFacility.name)} is not available on Health ID at the moment.` : null
}

/** The attestation as confirmed, in a sentence under the route (SPEC-FINAL §13.1). */
export function attestedText(attestedByName: string | null, attestedAt: string | null, patient: string, facility: string | null): string {
  return `${attestedByName?.trim() || 'A clinician'} confirmed on ${routeDay(attestedAt)} that ${patient} agreed to send it to ${named(facility)}.`
}

/** The names the attestation text leaves blank, filled for this patient, this facility and the one chosen. */
export interface AttestationNames { patient: string; orderingFacility: string; receivingFacility: string }

export function fillAttestation(text: string, names: AttestationNames): string {
  return text.replaceAll('{patient}', names.patient).replaceAll('{orderingFacility}', names.orderingFacility)
    .replaceAll('{receivingFacility}', names.receivingFacility)
}

/** An order's reference as the patient's app shows it: 8 characters of its id, upper-cased (C9). */
export const REFERENCE_PATTERN = /^[0-9A-F]{8}$/
export const REFERENCE_PROBLEM = 'The reference is the 8 characters shown with the order in the patient’s Health ID app, for '
  + 'example 3F2A9C1B.'

/** Said wherever orders between facilities are switched off (either switch). */
export const ORDERS_PAUSED = 'Health ID has paused orders between facilities. Try again later.'
/** Said where a new route is missing (hid-system main, or a Novu before P4c). */
export const ORDERS_NOT_AVAILABLE = 'Sending orders to other facilities is not available yet.'

function isCode(error: unknown, ...codes: string[]): boolean {
  return isHidApiError(error) && codes.includes(error.code)
}

/** A 404 that names no code of the order-route routes: the route itself is missing. */
export function routeMissing(error: unknown): boolean {
  return isHidApiError(error) && error.status === 404 && !['ORDER_NOT_FOUND', 'ORDER_ROUTE_NOT_FOUND'].includes(error.code)
}

export function paused(error: unknown): boolean {
  return isHidApiError(error) && error.status === 423
}

/** A failure of the service or the connection, after which the order may or may not have been sent. */
function unanswered(error: unknown): boolean {
  return !isHidApiError(error) || error.status === 0 || error.status === 408 || error.status >= 500
    || error.code === 'UPSTREAM_UNAVAILABLE'
}

/**
 * What a refused send means (SPEC-FINAL §10.1, §11), with the facility chosen and the patient. `outdated` says the
 * attestation text must be read again; `reload` that the order list is out of date; `unanswered` that no answer came
 * (a fault, a timeout, the gateway's 503), so the send may have gone through after all: the EHR's send activates a
 * draft and creates the route in one transaction, which can commit after the browser stops waiting.
 */
export function sendRefusal(error: unknown, kind: OrderRouteKind, facility: string, patient: string):
  { text: string; outdated?: boolean; reload?: boolean; unanswered?: boolean } {
  const where = destinationWord(kind)
  // A refusal made here before sending (the record's version unreadable, patient access ended) says itself.
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  if (isCode(error, 'ORDER_ROUTE_ATTESTATION_OUTDATED')) return { outdated: true, text: 'The wording changed. Read it again and confirm.' }
  if (isCode(error, 'ORDER_ROUTE_DESTINATION_INELIGIBLE')) return { text: `${facility} can’t receive this order on Health ID at the moment. Choose another ${where}.` }
  if (isCode(error, 'ORDER_ROUTE_DESTINATION_BUSY')) return { text: `${facility} has too many orders waiting to be accepted. Choose another ${where}, or phone them.` }
  if (isCode(error, 'ORDER_ROUTE_PATIENT_DENIED')) return { text: `${patient} has asked Health ID not to share their records with ${facility}. Choose another ${where}.` }
  if (isCode(error, 'ORDER_ROUTE_PATIENT_APP_REQUIRED')) return { text: `${patient} has no active Health ID account, so Health ID can’t tell them where the order went. Give them a paper ${orderWord(kind)} instead.` }
  if (isCode(error, 'ORDER_ROUTE_ORDER_IN_WORK')) return { reload: true, text: `This ${orderWord(kind)} is already being worked on, here or at another facility, so it can’t be sent. Write a new one if it is needed elsewhere.` }
  if (isCode(error, 'ORDER_ROUTE_ALREADY_SENT')) return { reload: true, text: `This ${orderWord(kind)} has already been sent to another facility.` }
  if (isCode(error, 'ORDER_ROUTE_RESEND_LIMIT')) return { text: `This ${orderWord(kind)} has been sent 5 times, the most allowed. Write a new one.` }
  if (isCode(error, 'ORDER_ROUTE_ORDER_NOT_ELIGIBLE')) return { reload: true, text: `Only a draft or active ${orderWord(kind)} can be sent.` }
  if (isCode(error, 'ORDER_ROUTE_SEND_LIMIT')) return { text: 'You have sent the most orders allowed today. Try again tomorrow.' }
  if (isCode(error, 'ORDER_ROUTE_PAIR_LIMIT')) return { text: `This facility has sent the most orders allowed to ${facility} today. Try again tomorrow, or choose another ${where}.` }
  if (isCode(error, 'IDEMPOTENCY_KEY_REUSED')) return { reload: true, text: 'This send was already made with other details. Check the order, then send it again.' }
  if (isCode(error, 'CONSENT_REQUIRED')) return { text: `${patient}’s approval for changes to their record has ended. Ask them to approve a read-and-write request first.` }
  if (isHidApiError(error) && error.status === 412) return { reload: true, text: `This ${orderWord(kind)} changed since it was loaded, so it was not sent. Check it, and send it again if it is still needed.` }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role at this facility can’t send orders to other facilities.' }
  if (isCode(error, 'ORDER_NOT_FOUND')) return { reload: true, text: `This ${orderWord(kind)} was not found. Reload the list.` }
  if (routeMissing(error)) return { text: ORDERS_NOT_AVAILABLE }
  if (paused(error)) return { text: ORDERS_PAUSED }
  if (isHidApiError(error) && error.status === 400) return { reload: true, text: 'The order could not be sent as it is. Reload the page and try again.' }
  if (unanswered(error)) return { reload: true, unanswered: true, text: 'Health ID did not answer, so the order may or may not have been sent. Check the list before sending it again.' }
  return { text: 'The order could not be sent. Try again.' }
}

/** Whether this member, at this facility, holds the permission to receive this service's orders (Novu, P4c). */
export function holdsReceivePermission(facility: Pick<Facility, 'permissions'> | undefined | null, service: ReceivingService): boolean {
  return Boolean(facility) && usesNovuBackend()
    && facility!.permissions.includes(service === 'lab' ? 'lab.order-route.receive' : 'pharmacy.order-route.receive')
}

/**
 * Whether the working facility receives this kind of order from other facilities (Novu, P4c). The receive permission
 * comes with the lab and pharmacist roles at every facility, but only a laboratory (lab requests) or a pharmacy
 * (prescriptions) can be found and sent orders (owner decision Q4; identity.order_route_destination_eligible): a
 * hospital's or clinic's own laboratory or pharmacy is not a receiver.
 * - 'no' first, whatever else is known: no receive permission, or a main-v1 build. `receives` describes the facility
 *   (any active member holding the permission), never the viewer, so it is read only after this check;
 * - then the backend's `receives` when it sent one (Novu since item 4, hid-system 0089): 'yes' or 'no';
 * - otherwise the session's facility type: 'yes' for a laboratory (pharmacy) that signed itself up and that Health ID
 *   support has checked, 'no' for one that signed itself up as anything else, and 'unknown' for a governed or legacy
 *   facility, whose type the session does not carry. The pages then claim nothing about other facilities until there is
 *   work from one to show (see IncomingOrders' `probe`).
 * Called without `receives`, it is the session's own opinion. Copy only: Lab and Pharmacy decide every request.
 */
export function receivingHere(facility: Pick<Facility, 'permissions' | 'selfService'> | undefined | null,
  service: ReceivingService, receives?: boolean): 'yes' | 'no' | 'unknown' {
  if (!holdsReceivePermission(facility, service)) return 'no'
  if (typeof receives === 'boolean') return receives ? 'yes' : 'no'
  const type = selfServiceType(facility!)
  if (type === null) return 'unknown'
  return type === (service === 'lab' ? 'laboratory' : 'pharmacy') && selfServiceReview(facility!) === 'reviewed' ? 'yes' : 'no'
}

/**
 * What a Lab or Pharmacy work list, or Incoming, said about the working facility (item 4, hid-system 0089), each field
 * only when its type is right: `receives` a boolean, `routesHere` an object of two booleans. A field that is missing or of
 * another type is left out, never made up. `null` when neither was said (an earlier backend, a member without the receive
 * permission, a failed read).
 */
export function receivingAnswer(answer: unknown): ReceivingAnswer | null {
  if (!answer || typeof answer !== 'object') return null
  const { receives, routesHere } = answer as { receives?: unknown; routesHere?: unknown }
  const here = routesHere && typeof routesHere === 'object' && !Array.isArray(routesHere)
    ? routesHere as { waiting?: unknown; held?: unknown } : null
  const known: ReceivingAnswer = {
    ...(typeof receives === 'boolean' ? { receives } : {}),
    ...(here && typeof here.waiting === 'boolean' && typeof here.held === 'boolean'
      ? { routesHere: { waiting: here.waiting, held: here.held } } : {}),
  }
  return known.receives === undefined && known.routesHere === undefined ? null : known
}

/** How long the website remembers what an answer said about the working facility (owner decision D3). */
export const RECEIVING_MEMORY_MS = 10 * 60 * 1000

/**
 * The last thing a work list, Incoming or the Overview's read said about the working facility, per membership, facility
 * and service, for 10 minutes (owner decision D3): it lets the Overview skip an audited Incoming read at a facility that
 * does not receive, and keeps a page's rule when a later read fails or answers without it. Keyed by the membership, so
 * another sign-in in the tab never reuses it; held in memory only, for the page's life.
 */
const receivingMemory = new Map<string, { known: ReceivingAnswer; at: number }>()

function receivingKey(facility: Pick<Facility, 'id' | 'membershipId'>, service: ReceivingService): string {
  return `${facility.membershipId}:${facility.id}:${service}`
}

/** Remembers what an answer said, replacing what was remembered; an answer that said neither field changes nothing. */
export function rememberReceiving(facility: Pick<Facility, 'id' | 'membershipId'> | undefined | null, service: ReceivingService,
  answer: unknown, now = Date.now()): void {
  const known = receivingAnswer(answer)
  if (!facility || !known) return
  receivingMemory.set(receivingKey(facility, service), { known, at: now })
}

/** What was remembered for this membership, facility and service in the last 10 minutes, if anything. */
export function rememberedReceiving(facility: Pick<Facility, 'id' | 'membershipId'> | undefined | null, service: ReceivingService,
  now = Date.now()): ReceivingAnswer | null {
  if (!facility) return null
  const key = receivingKey(facility, service)
  const entry = receivingMemory.get(key)
  if (!entry) return null
  if (now - entry.at >= RECEIVING_MEMORY_MS || now < entry.at) { receivingMemory.delete(key); return null }
  return entry.known
}

/** For tests: forget everything remembered, as a new page would. */
export function forgetReceiving(): void {
  receivingMemory.clear()
}

/** What a refused withdrawal means. */
export function withdrawRefusal(error: unknown): { text: string; reload?: boolean } {
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  if (isCode(error, 'ORDER_ROUTE_NOT_PENDING') || (isHidApiError(error) && error.status === 412)) return { reload: true,
    text: 'It is no longer waiting to be accepted, so it was not withdrawn. The list has been reloaded.' }
  if (isCode(error, 'ORDER_ROUTE_NOT_FOUND')) return { reload: true, text: 'This order route was not found. The list has been reloaded.' }
  if (routeMissing(error)) return { text: ORDERS_NOT_AVAILABLE }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role at this facility can’t withdraw orders sent to other facilities.' }
  if (unanswered(error)) return { reload: true, text: 'Health ID did not answer, so it may or may not have been withdrawn. Check the list.' }
  return { text: 'It could not be withdrawn. Try again.' }
}

/** What a refused directory search means. */
export function searchRefusal(error: unknown): string {
  if (isCode(error, 'ORDER_DESTINATION_SEARCH_LIMITED')) return 'Too many searches: try again in an hour.'
  if (isCode(error, 'ORDER_DESTINATION_QUERY_INVALID') || (isHidApiError(error) && error.status === 400)) {
    return 'Type 3 to 80 letters of the facility’s name.'
  }
  if (paused(error)) return ORDERS_PAUSED
  if (routeMissing(error)) return ORDERS_NOT_AVAILABLE
  if (isHidApiError(error) && error.status === 403) return 'Your role at this facility can’t send orders to other facilities.'
  return 'The search did not work. Try again.'
}

/** The note for an order sent at asap or stat priority: the receiver is not alerted (PRIV P15.3). */
export function urgentNote(facility: string): string {
  return `${facility} is not alerted when it arrives: phone them.`
}

/** The warning for a controlled medicine (owner decision Q9: a warning now, a block list later). */
export function controlledMedicineNote(facility: string): string {
  return `If this is a controlled medicine, ${facility} may ask the patient for a paper prescription.`
}

/** The warning for a sensitive test (owner decision Q9). */
export function sensitiveTestNote(facility: string, patient: string): string {
  return `If this is a sensitive test, such as an HIV or pregnancy test, check that ${patient} is happy for ${facility} to do it: ${facility} sees the test and its result.`
}

/** The receiving service a work list belongs to, and its order word. */
export function receivedWord(service: 'lab' | 'pharmacy'): string {
  return service === 'lab' ? 'lab request' : 'prescription'
}

/**
 * What a refused acceptance means (SPEC-FINAL §10.2, §13.3). `attemptsLeft` comes with a mismatch; `reload` says the
 * Incoming list is out of date; `locked` that the order can't be accepted here any more. `named` is false when the
 * identifier did not name the order (a date of birth without its reference): a mismatch then says to ask for the
 * reference, and no countdown.
 */
export function acceptRefusal(error: unknown, orderingFacility: string, facility: string, named = true):
  { text: string; reload?: boolean; field?: 'identifier' | 'reason' | 'reference' } {
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  if (isCode(error, 'ORDER_ROUTE_PATIENT_MISMATCH')) {
    // A date of birth given without the order's reference does not name the order (P4c review): the counter may have
    // picked another patient's order, and that wrong date does not count against this order's five tries.
    if (!named) return { reload: true, field: 'identifier', text: 'That doesn’t match this order’s patient. Check that '
      + 'this is their order: ask for the reference shown with it in their Health ID app, and enter it with the date of birth.' }
    const left = isHidApiError(error) ? error.attemptsLeft : null
    return { reload: true, field: 'identifier', text: left === null
      ? 'That doesn’t match this order’s patient. Check it with the patient and try again.'
      : `That doesn’t match this order’s patient. ${left} ${left === 1 ? 'try' : 'tries'} left.` }
  }
  // Another order's reference: nothing is counted, and the order is unchanged.
  if (isCode(error, 'ORDER_ROUTE_REFERENCE_MISMATCH')) return { field: 'reference',
    text: 'That reference is not this order’s. Check that you picked the patient’s own order: their Health ID app shows its reference.' }
  if (isCode(error, 'ORDER_ROUTE_ACCEPT_LOCKED')) return { reload: true,
    text: `Too many wrong tries: this order can’t be accepted here. ${orderingFacility} can send it again.` }
  if (isCode(error, 'ORDER_ROUTE_HEALTH_ID_REQUIRED')) return { field: 'identifier',
    text: 'No date of birth is on record for this patient: ask for their Health ID instead.' }
  if (isCode(error, 'ORDER_ROUTE_ACCEPT_LIMITED')) return {
    text: 'You have entered too many details that didn’t match today. Try again tomorrow, or ask a colleague.' }
  if (isCode(error, 'ORDER_ROUTE_ORDER_IN_WORK')) return { reload: true,
    text: `This order is already being worked on at ${orderingFacility}, so it can’t be accepted here. It has been withdrawn.` }
  if (isCode(error, 'ORDER_ROUTE_NOT_PENDING')) return { reload: true,
    text: 'This order is no longer waiting: it was withdrawn, declined or accepted already. The list has been reloaded.' }
  if (isCode(error, 'ORDER_ROUTE_EXPIRED')) return { reload: true,
    text: `This order was not accepted within 7 days of sending, so it has expired. ${orderingFacility} can send it again.` }
  if (isCode(error, 'ORDER_ROUTE_DESTINATION_INELIGIBLE')) return {
    text: `${facility} can’t receive orders from other facilities at the moment. Contact Health ID support.` }
  if (isCode(error, 'ORDER_ROUTE_ORDERING_FACILITY_UNAVAILABLE')) return {
    text: `${orderingFacility} is not available on Health ID at the moment, so this order can’t be accepted.` }
  if (isCode(error, 'ORDER_ROUTE_PATIENT_DENIED')) return {
    text: `The patient has asked Health ID not to share their records with ${facility}, so this order can’t be accepted here.` }
  if (isCode(error, 'IDEMPOTENCY_KEY_REUSED')) return { text: 'This acceptance was already sent with other details. Try again.' }
  if (isCode(error, 'ORDER_ROUTE_INVALID') || isCode(error, 'VALIDATION_FAILED')) return { field: 'identifier',
    text: 'Check what you entered: a Health ID starts with HID-, a date of birth needs the day, month and year, and a '
      + 'reference has 8 characters.' }
  if (isHidApiError(error) && error.status === 412) return { reload: true, text: 'This order changed since it was loaded. The list has been reloaded: try again.' }
  if (isHidApiError(error) && error.status === 404) return routeMissing(error) && !isCode(error, 'ORDER_ROUTE_NOT_FOUND')
    ? { text: 'Receiving orders from other facilities is not available yet.' }
    : { reload: true, text: 'This order is no longer here. The list has been reloaded.' }
  if (paused(error)) return { text: ORDERS_PAUSED }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role at this facility can’t accept orders from other facilities.' }
  if (unanswered(error)) return { reload: true, text: 'Health ID did not answer, so the order may or may not have been accepted. The list has been reloaded: check it before trying again.' }
  return { text: 'The order could not be accepted. Try again.' }
}

/** What happened, in the receiving facility's words (item 3, §9.1; D6, and D18's "another reason"). */
export const WRONG_PATIENT_REASONS: ReadonlyArray<{ value: OrderRouteWrongPatientReason; label: string }> = [
  { value: 'wrong_order_chosen', label: 'I picked another patient’s order from the list' },
  { value: 'someone_elses_details', label: 'The person gave someone else’s Health ID or date of birth' },
  { value: 'suspected_misuse', label: 'I think the person was pretending to be the patient' },
  { value: 'other', label: 'The person was not the patient for another reason' },
]

/**
 * The Accepted panel's first line (item 3, C8, §9.1): the patient the order names, to check against the person at the
 * counter before any work, now that the receiver first sees who it is. "If they are not, end this order now" only from a
 * backend that lets the receiver end it (`reportServed`; until hid-system 0088 ships nobody can, D15).
 */
export function acceptedCheckText(patient: Pick<OrderRoutePatient, 'fullName' | 'dateOfBirth'> | null | undefined,
  reportServed = false): string {
  const who = patient?.fullName?.trim()
    ? `${patient.fullName.trim()}${patient.dateOfBirth ? `, born ${calendarDate(patient.dateOfBirth)}` : ''}`
    : 'the order’s patient, named in the work list below'
  return `Check that the person in front of you is ${who}, before you take a sample or hand over any medicine.`
    + (reportServed ? ' If they are not, end this order now.' : '')
}

/** Beside Prepare accession on work from another facility (item 3, C8). */
export function sampleCheckText(patient: string): string {
  return `Check that the person is ${patient} before you take a sample.`
}

/** Above Record full dispensing on work from another facility (item 3, C8). */
export function handOverCheckText(patient: string): string {
  return `Check that the person is ${patient}, or is collecting for them, before you hand anything over.`
}

/**
 * What the receiving facility is told once it has ended an order it accepted for the wrong person (item 3, §9.1; C2,
 * C10): kept on screen until closed. `returned` says whether a result or dispensing had already gone back to the ordering
 * facility; `dateOfBirthOnly` that it was accepted with a date of birth and no reference.
 */
export function wrongPatientEndedLines({ service, title, reference, patient, ordering, returned, dateOfBirthOnly = false }: {
  service: ReceivingService; title: string; reference: string | null | undefined; patient: string | null | undefined
  ordering: string; returned: boolean; dateOfBirthOnly?: boolean
}): string[] {
  const lab = service === 'lab'
  const who = patient?.trim() || 'The patient'
  const theirs = patient?.trim() || 'the patient'
  const lines = [`Ended: ${title}${reference ? `, reference ${reference}` : ''}. ${who} is told in the Health ID app.`,
    returned
      ? `Health ID shows this to ${ordering} on the order but does not alert them. Phone ${ordering} now: a `
        + `${lab ? 'result' : 'dispensing'} had already gone back to them.`
      : `Health ID shows this to ${ordering} on the order but does not alert them. Phone ${ordering} if the `
        + `${lab ? 'test' : 'medicine'} is urgent, so they can send a new order.`]
  if (lab) lines.push(
    `Set aside any specimen taken for it, following your laboratory’s procedure: it is not ${theirs}’s.`,
    'If any value was critical, tell the person or their clinician directly, following your laboratory’s procedure.',
    'The test can’t be reported to the other person through this order. If they have their own order, find it under '
      + 'Incoming with their Health ID.')
  else lines.push(
    'If medicine was handed over, try to get it back and follow your pharmacy’s incident procedure.',
    'If the person may have taken it, advise them to get medical advice.',
    'If they have their own prescription, find it under Incoming with their Health ID.')
  if (dateOfBirthOnly) lines.push('Next time, ask for the order’s reference with the date of birth: it shows in the patient’s '
    + 'Health ID app.')
  lines.push('This order leaves your work list when it refreshes.')
  return lines
}

/**
 * What a work row says of an order from another facility that has ended, by how it ended (item 3, §8.1; B1): seen only
 * by a member who still holds the patient's own consent here. It no longer says the ordering facility cancelled an order
 * that support, a release or this facility ended. Null while the route is live, and for an ending the row says otherwise.
 */
export function routedWorkEndedText(route: Pick<WorkItemOrderRoute, 'effectiveState' | 'endedKind' | 'orderingFacilityName'>): string | null {
  const facility = named(route.orderingFacilityName, 'the ordering facility')
  switch (route.endedKind) {
    case 'wrong_patient': return 'You ended this order: it was accepted for someone who is not its patient. Nothing more can be '
      + 'recorded on it.'
    case 'support': return 'Closed by Health ID support: stop work.'
    case 'order_changed': case 'entered_in_error': return `Cancelled by ${facility}: stop work.`
    case 'receiving_released': case 'ordering_released':
      return `${facility.charAt(0).toUpperCase()}${facility.slice(1)} or this facility is no longer on Health ID: stop work.`
    default: return route.effectiveState === 'cancelled' ? 'This order was cancelled: stop work.' : null
  }
}

/**
 * Whether the services would refuse a write on a work row's order as closed (item 3, B3): cancelled or lapsed, or
 * ended as accepted for the wrong person, whatever its state. Only then are the row's write actions hidden; reading
 * (Open accession) never is.
 */
export function routeClosedForWork(route: Pick<WorkItemOrderRoute, 'effectiveState' | 'endedKind'> | null | undefined): boolean {
  return Boolean(route && (route.effectiveState === 'cancelled' || route.effectiveState === 'expired'
    || route.endedKind === 'wrong_patient'))
}

/**
 * Whether a work row offers "This isn't the order's patient" (item 3, §8.1): work the route still allows, from a backend
 * that sends the route's version (hid-system 0088; an earlier one sends none, so the row stays as it was), not ended, for
 * a member holding the kind's receive permission.
 */
export function wrongPatientOffered(route: WorkItemOrderRoute | null | undefined, permissions: readonly string[],
  service: ReceivingService): route is WorkItemOrderRoute & { version: number } {
  return Boolean(route && route.access === 'work' && typeof route.version === 'number' && Number.isSafeInteger(route.version)
    && route.version >= 1 && !route.endedKind
    && permissions.includes(service === 'lab' ? 'lab.order-route.receive' : 'pharmacy.order-route.receive'))
}

/**
 * What a refused wrong-patient report means (item 3, §9.1). `reload` says the list is out of date; `stale` that the
 * route moved on (412): read it again and show the form refreshed; `unanswered` that no answer came, so the order may or
 * may not have ended.
 */
export function wrongPatientRefusal(error: unknown, service: ReceivingService, ordering: string,
  late: { reference: string | null } | null = null):
  { text: string; reload?: boolean; stale?: boolean; unanswered?: boolean } {
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  // With the late correction served (D17, `late`), an order that has ended can still be withdrawn from "Correct an order
  // that has ended" until its date; until then, today's words (D15).
  if (isCode(error, 'ORDER_ROUTE_ALREADY_ENDED')) return { reload: true, text: 'This order has already ended, so it can’t be '
    + (late ? `ended here. If a result or dispensing had gone back, use “Correct an order that has ended” above the work list, `
      + `with reference ${late.reference || 'shown with the order'}.`
      : `ended here. If a result or dispensing had gone back, phone ${ordering} and tell Health ID support.`) }
  if (isCode(error, 'ORDER_ROUTE_NOT_ACCEPTED')) return { reload: true,
    text: 'This order hasn’t been accepted, so there is nothing to end: decline it instead.' }
  if (isHidApiError(error) && error.status === 412) return { stale: true,
    text: 'Something was recorded on this order a moment ago. It has been reloaded: check what will happen and try again.' }
  if (isCode(error, 'ORDER_ROUTE_CHANGED_CONCURRENTLY')) return { text: 'Someone changed this order at the same moment. Try again.' }
  if (isCode(error, 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED')) return { text: service === 'lab'
    ? 'Results were recorded on this order, and your role can’t mark results entered in error. Ask a laboratory scientist to end it.'
    : 'A dispensing was recorded on this order, and your role can’t reverse dispensings. Ask a pharmacist to end it.' }
  if (isCode(error, 'IDEMPOTENCY_KEY_REUSED')) return { reload: true,
    text: 'This report was already sent with other details. Refresh the list and check whether the order has ended.' }
  if (routeMissing(error)) return { text: 'Ending an order for the wrong person isn’t available yet. Tell Health ID support, '
    + `and phone ${ordering}.` }
  if (isHidApiError(error) && error.status === 404) return { reload: true, text: 'This order was not found here. Refresh the list.' }
  if (paused(error)) return { text: 'Health ID has paused work on orders from other facilities, so this can’t be done now. Try '
    + 'again when it resumes, and tell Health ID support now. ' + (late
    ? 'If the order is closed meanwhile, you can still withdraw it under “Correct an order that has ended”, until the date '
      + 'shown there.'
    : 'Don’t ask support to close the order: closing it stops you withdrawing anything you sent back.') }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role can’t end orders from other facilities.' }
  if (isHidApiError(error) && error.status === 400) return { text: 'Check what you entered: choose what happened, and describe '
    + 'it for Health ID support in 8 to 500 characters.' }
  if (unanswered(error)) return { reload: true, unanswered: true,
    text: 'Health ID did not answer, so it may or may not have ended. Refresh the list and check.' }
  return { text: 'The order could not be ended. Try again.' }
}

/** What a refused decline means. */
export function declineRefusal(error: unknown): { text: string; reload?: boolean } {
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  if (isCode(error, 'ORDER_ROUTE_NOT_PENDING') || (isHidApiError(error) && (error.status === 412 || error.status === 404))) {
    return { reload: true, text: 'This order is no longer waiting, so it was not declined. The list has been reloaded.' }
  }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role at this facility can’t decline orders from other facilities.' }
  if (unanswered(error)) return { reload: true, text: 'Health ID did not answer, so it may or may not have been declined. The list has been reloaded.' }
  return { text: 'The order could not be declined. Try again.' }
}

/** Why the Incoming list could not be read; null for a missing route (hid-system main, a Novu before P4c). */
export function incomingProblem(error: unknown): string | null {
  if (routeMissing(error)) return null
  if (paused(error)) return ORDERS_PAUSED
  if (isCode(error, 'ORDER_ROUTE_INVALID')) return 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
  if (isHidApiError(error) && error.status === 403) return 'Your role at this facility can’t receive orders from other facilities.'
  return 'Orders from other facilities could not be loaded. Refresh to try again.'
}

/** What is said of a priority. */
export function priorityLabel(priority: string | null | undefined): string | null {
  if (!priority) return null
  return ({ routine: 'Routine', urgent: 'Urgent', asap: 'As soon as possible', stat: 'Stat' } as Record<string, string>)[priority] ?? priority
}

/** "Licence on record: MDCN" / "Licence not on record", with the number once it may be read. */
export function licenceLine(body: string | null | undefined, number?: string | null): string {
  if (!body) return 'Licence not on record'
  return number ? `Licence on record: ${body} ${number}` : `Licence on record: ${body}`
}

/** The receiving pharmacy's warning for a controlled medicine (owner decision Q9). */
export const CONTROLLED_MEDICINE_CHECK = 'If this is a controlled medicine, check the prescription as you would a paper one before you dispense it.'

/** How the receiving facility found out (D17, CL11), as the late form offers it. */
export const DISCOVERED_BY: ReadonlyArray<{ value: OrderRouteDiscoveredBy; label: string }> = [
  { value: 'patient', label: 'The patient told us' },
  { value: 'ordering_facility', label: 'The ordering facility told us' },
  { value: 'own_check', label: 'We found it ourselves' },
  { value: 'support', label: 'Health ID support told us' },
  { value: 'other', label: 'Another way' },
]

const LAGOS_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The day in Lagos (YYYY-MM-DD) of a time, as the services check the day a facility found out (D17); null when unreadable. */
export function lagosDay(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const parts = Object.fromEntries(LAGOS_PARTS.formatToParts(parsed).map(part => [part.type, part.value]))
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null
}

/** "21 Oct 2026", "21 Oct 2026 and 3 Nov 2026", "a, b and c": the days of these times, each once, in order. */
export function returnedDays(times: readonly string[]): string {
  const days = [...new Set([...times].sort().map(time => routeDay(time)))]
  if (days.length <= 1) return days[0] ?? 'an unknown date'
  return `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`
}

const CORRECTIONS: ReadonlySet<string> = new Set(['open', 'correctable', 'reported', 'too_late'])

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function timeOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function correctableDetails(value: unknown): CorrectableOrderRouteDetails | null {
  if (!value || typeof value !== 'object') return null
  const details = value as { what?: unknown; acceptedBy?: unknown; acceptedWith?: unknown; returned?: unknown }
  const returned = Array.isArray(details.returned) ? details.returned.flatMap(item => {
    const entry = item && typeof item === 'object' ? item as { at?: unknown; withdrawn?: unknown } : null
    const at = timeOrNull(entry?.at)
    return at && typeof entry?.withdrawn === 'boolean' ? [{ at, withdrawn: entry.withdrawn }] : []
  }).slice(0, 20) : []
  return { what: stringOrNull(details.what), acceptedBy: stringOrNull(details.acceptedBy),
    acceptedWith: stringOrNull(details.acceptedWith), returned }
}

/**
 * The lookup's rows (D17, C30), each only when its id, version and correction read as they should; every other field is
 * read when its type is right and left empty otherwise, never made up. No patient is ever read from it.
 */
export function correctableRoutes(answer: unknown): CorrectableOrderRoute[] {
  const items = answer && typeof answer === 'object' ? (answer as { items?: unknown }).items : null
  if (!Array.isArray(items)) return []
  return items.flatMap((item): CorrectableOrderRoute[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id || typeof row.version !== 'number' || !Number.isSafeInteger(row.version)
      || row.version < 1 || typeof row.correction !== 'string' || !CORRECTIONS.has(row.correction)) return []
    const kind = row.kind === 'prescription' ? 'prescription' : 'lab_request'
    return [{ id: row.id, reference: stringOrNull(row.reference), kind, version: row.version,
      effectiveState: typeof row.effectiveState === 'string' ? row.effectiveState : '',
      orderingFacilityName: stringOrNull(row.orderingFacilityName), acceptedAt: timeOrNull(row.acceptedAt),
      completedAt: timeOrNull(row.completedAt), endedAt: timeOrNull(row.endedAt), endedKind: stringOrNull(row.endedKind),
      returned: row.returned === true, correction: row.correction, correctableUntil: timeOrNull(row.correctableUntil),
      wrongPatient: wrongPatientReportOf(row),
      details: row.correction === 'open' || row.correction === 'correctable' ? correctableDetails(row.details) : null }]
  })
}

/**
 * How an order this facility accepted ended, in the late section's words (D17, SPEC-FINAL §9.1; CT10): by its ending, or
 * for one whose time simply ran out, by whether anything came back.
 */
export function lateEndedText(route: Pick<CorrectableOrderRoute, 'effectiveState' | 'endedKind' | 'orderingFacilityName'>,
  service: ReceivingService): string {
  const ordering = named(route.orderingFacilityName, 'the ordering facility')
  switch (route.endedKind) {
    case 'wrong_patient': return 'ended as accepted for the wrong person'
    case 'support': return 'closed by Health ID support'
    case 'order_changed': return `cancelled by ${ordering}`
    case 'entered_in_error': return route.effectiveState === 'completed'
      ? `${ordering} has since marked the order entered in error` : `cancelled by ${ordering}`
    case 'ordering_released': return `${ordering} is no longer on Health ID`
    case 'receiving_released': return 'this facility was released from Health ID'
    case null: case undefined: case '':
      if (route.effectiveState === 'completed') return 'its time for work ended'
      if (route.effectiveState === 'expired') return service === 'lab' ? 'nothing was released within 30 days'
        : 'nothing was dispensed within 30 days'
      return route.effectiveState === 'cancelled' ? 'cancelled' : 'it is still open'
    default: return 'it has ended'
  }
}

/** What a row of the late section says (D17, SPEC-FINAL §9.1): the order, this facility's own facts, and what may be done. */
export function lateCorrectionRowLines(route: CorrectableOrderRoute, service: ReceivingService): string[] {
  const ordering = named(route.orderingFacilityName, 'the ordering facility')
  const details = route.details
  const accepted = `Accepted ${routeDay(route.acceptedAt)}${details?.acceptedBy ? ` by ${details.acceptedBy}` : ''}`
    + (details?.acceptedWith ? `, with ${({ health_id: 'their Health ID',
      date_of_birth_with_reference: 'date of birth and the order’s reference', date_of_birth: 'date of birth only',
    } as Record<string, string>)[details.acceptedWith] ?? details.acceptedWith.replaceAll('_', ' ')}` : '')
  const parts = [`${route.kind === 'lab_request' ? 'Lab request' : 'Prescription'} from ${ordering}`,
    route.reference ? `Ref ${route.reference}` : null, details?.what ?? null, accepted,
    route.correction === 'open' ? null : lateEndedText(route, service)].filter(Boolean)
  const lines = [`${parts.join(' · ')}.`]
  if (details && (route.correction === 'correctable' || route.correction === 'open')) {
    const back = details.returned
    const withdrawn = back.filter(item => item.withdrawn).length
    if (service === 'lab') lines.push(back.length > 0
      ? `${back.length} result${back.length === 1 ? '' : 's'} went back to ${ordering}, on ${returnedDays(back.map(item => item.at))}`
        + `${withdrawn > 0 ? `; ${withdrawn} already withdrawn` : ''}.`
      : `Nothing you recorded went back to ${ordering}.`)
    else lines.push(back.length > 0
      ? `A dispensing went back to ${ordering} on ${returnedDays(back.map(item => item.at))}${withdrawn > 0 ? ', already reversed' : ''}.`
      : 'Nothing was dispensed on it.')
  }
  switch (route.correction) {
    case 'correctable': lines.push(`You can withdraw it until ${routeMoment(route.correctableUntil)}.`); break
    case 'open': lines.push('This order is still open. If you accepted it for the wrong person, report it here.'); break
    case 'reported': lines.push(`You reported on ${routeDay(route.wrongPatient?.reportedAt)} that this order was accepted for the `
      + 'wrong person.'); break
    case 'too_late': lines.push(tooLateText(route.correctableUntil, ordering)); break
  }
  return lines
}

function tooLateText(until: string | null | undefined, ordering: string): string {
  return `It is past ${routeMoment(until)}, so it can’t be corrected here. Phone ${ordering}, and tell Health ID support.`
}

/** What a refused lookup means (D17, SPEC-FINAL §9.1). `missing` says the backend has no such route (404 without a code). */
export function correctableFindRefusal(error: unknown): { text: string; missing?: boolean } {
  if (routeMissing(error)) return { missing: true, text: 'Correcting an ended order isn’t available yet. Phone the ordering '
    + 'facility, and tell Health ID support.' }
  if (isHidApiError(error) && error.status === 400) return { text: REFERENCE_PROBLEM }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role can’t correct orders from other facilities.' }
  if (paused(error)) return { text: LATE_PAUSED }
  if (unanswered(error)) return { text: 'Health ID did not answer. Try again.' }
  return { text: 'The order could not be found. Try again.' }
}

const LATE_PAUSED = 'Health ID has paused work on orders from other facilities, so this can’t be done now. Try again when it resumes.'

/**
 * What a refused late withdrawal means (D17, SPEC-FINAL §9.1; CT1, CL12). `stale` says the order moved on (412): find it
 * again and keep the form open at its new version; `reload` that the row is out of date; `unanswered` that no answer came.
 */
export function lateWrongPatientRefusal(error: unknown, service: ReceivingService, ordering: string,
  correctableUntil: string | null | undefined): { text: string; reload?: boolean; stale?: boolean; unanswered?: boolean } {
  if (!isHidApiError(error) && error instanceof Error && error.message) return { text: error.message }
  if (isCode(error, 'ORDER_ROUTE_CORRECTION_TOO_LATE')) return { reload: true, text: tooLateText(correctableUntil, ordering) }
  if (isCode(error, 'ORDER_ROUTE_STILL_OPEN')) return { reload: true,
    text: 'This order is still open. If you accepted it for the wrong person, report it here.' }
  if (isCode(error, 'ORDER_ROUTE_ALREADY_REPORTED')) return { text: 'This order has already been reported as accepted for the '
    + 'wrong person. Find it again to see when.' }
  if (isCode(error, 'ORDER_ROUTE_NOT_ACCEPTED')) return { text: 'This order was never accepted here, so there is nothing to withdraw.' }
  if (isCode(error, 'ORDER_ROUTE_CORRECTION_LIMIT') || (isHidApiError(error) && error.status === 429)) {
    const after = isHidApiError(error) ? error.retryAt : null
    return { text: `You have reached the limit for withdrawing ended orders. ${after ? `You can withdraw more from `
      + `${routeMoment(after)}.` : 'You can withdraw more later.'} If many orders are affected, phone Health ID support now so `
      + 'that they can tell the ordering facilities.' }
  }
  if (isCode(error, 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED')) return { text: service === 'lab'
    ? 'Results were recorded on this order, and your role can’t mark results entered in error. Ask a laboratory scientist to withdraw it.'
    : 'A dispensing was recorded on this order, and your role can’t reverse dispensings. Ask a pharmacist to withdraw it.' }
  if (isHidApiError(error) && error.status === 412) return { stale: true,
    text: 'Something was recorded on this order a moment ago. It has been found again: check what will happen and try again.' }
  if (isCode(error, 'ORDER_ROUTE_CHANGED_CONCURRENTLY')) return { text: 'Someone changed this order at the same moment. Try again.' }
  if (isCode(error, 'IDEMPOTENCY_KEY_REUSED')) return { reload: true,
    text: 'This report was already sent with other details. Find the order again and check whether it has been withdrawn.' }
  if (routeMissing(error)) return { text: `Withdrawing an ended order isn’t available yet. Phone ${ordering}, and tell Health ID support.` }
  if (isHidApiError(error) && error.status === 404) return { reload: true, text: 'This order was not found here. Find it again.' }
  if (paused(error)) return { text: LATE_PAUSED }
  if (isHidApiError(error) && error.status === 403) return { text: 'Your role can’t withdraw orders from other facilities.' }
  if (isHidApiError(error) && error.status === 400) return { text: 'Check what you entered: choose how and when you found out and '
    + 'what happened, and describe it for Health ID support in 8 to 500 characters. The date can’t be in the future or before '
    + 'the order was accepted.' }
  if (unanswered(error)) return { reload: true, unanswered: true,
    text: 'Health ID did not answer, so it may or may not have been withdrawn. Find the order again and check.' }
  return { text: 'It could not be withdrawn. Try again.' }
}

/**
 * What the receiving facility is told once it has withdrawn an ended order (D17, SPEC-FINAL §9.1; CT7, CL1, CL9): kept on
 * screen until closed. `returned` says whether a result or dispensing had gone back to the ordering facility.
 */
export function lateCorrectionLines({ service, title, reference, ordering, returned }: {
  service: ReceivingService; title: string; reference: string | null | undefined; ordering: string; returned: boolean
}): string[] {
  const lab = service === 'lab'
  return [`Withdrawn: ${title}${reference ? `, reference ${reference}` : ''}. The patient is told in the Health ID app.`,
    returned
      ? `Phone ${ordering} now: a ${lab ? 'result' : 'dispensing'} had gone back to them, and Health ID does not alert them. Ask `
        + 'them to correct anything they recorded from it, and to tell the patient.'
      : `Nothing had gone back to ${ordering}. Phone ${ordering} if the patient still needs the ${lab ? 'test' : 'medicine'}, so `
        + 'they can send a new order.',
    lab
      ? 'Follow your laboratory’s procedure for a misidentified specimen. If a value was critical and you can tell who the '
        + 'person was, tell them or their clinician.'
      : 'Follow your pharmacy’s incident procedure. If you can tell who received the medicine, advise them to get medical advice.']
}
