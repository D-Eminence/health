import { isHidApiError } from '@hid/http'
import type { Facility, OrderRouteDeclineReason, OrderRouteKind, OrderRouteSummary, OrderRouteWithdrawReason, ReceivingService } from './api'
import { usesNovuBackend } from '../backendContract'
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
      return { tone: 'warning', text: cancelledText(route, facility) }
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

function cancelledText(route: OrderRouteSummary, facility: string): string {
  switch (route.endedKind) {
    case 'order_changed': return `Cancelled at ${facility} because the order changed.`
    case 'entered_in_error': return `Cancelled at ${facility} because the order was marked entered in error.`
    case 'receiving_released': return `Cancelled: ${facility} is no longer on Health ID.`
    case 'ordering_released': return `Cancelled at ${facility}: this facility is no longer on Health ID.`
    case 'support': return `Cancelled at ${facility} by Health ID support.`
    default: return `Cancelled at ${facility}.`
  }
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

/**
 * Whether the working facility receives this kind of order from other facilities, as far as the session can tell
 * (Novu, P4c). The receive permission comes with the lab and pharmacist roles at every facility, but only a laboratory
 * (lab requests) or a pharmacy (prescriptions) can be found and sent orders (owner decision Q4;
 * identity.order_route_destination_eligible): a hospital's or clinic's own laboratory or pharmacy is not a receiver. No
 * answer says whether this facility receives, so the session's facility type decides what the portal says:
 * - 'no': no receive permission, a main-v1 build, or a facility that signed itself up as anything but this kind;
 * - 'yes': a laboratory (pharmacy) that signed itself up and that Health ID support has checked;
 * - 'unknown': a governed or legacy facility, whose type the session does not carry. The pages then claim nothing
 *   about other facilities until there is work from one to show (see IncomingOrders' `probe`).
 * Copy only: Lab and Pharmacy decide every request.
 */
export function receivingHere(facility: Pick<Facility, 'permissions' | 'selfService'> | undefined | null,
  service: ReceivingService): 'yes' | 'no' | 'unknown' {
  if (!facility || !usesNovuBackend()) return 'no'
  if (!facility.permissions.includes(service === 'lab' ? 'lab.order-route.receive' : 'pharmacy.order-route.receive')) return 'no'
  const type = selfServiceType(facility)
  if (type === null) return 'unknown'
  return type === (service === 'lab' ? 'laboratory' : 'pharmacy') && selfServiceReview(facility) === 'reviewed' ? 'yes' : 'no'
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
