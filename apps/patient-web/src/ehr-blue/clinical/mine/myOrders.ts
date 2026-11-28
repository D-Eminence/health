import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime } from '@hid/ui/display'
import type { MyOrder, MyOrdersKindFilter } from '../../../staff/api'
import { errorText } from '../../departments/parts/errors'
import { lagosToday } from '../../departments/waiting/waitingRules'
import { KINDS, priorityText } from '../consult/orders/orders'
import { ownProgressWords } from '../consult/orders/progress'

/*
 * "Ordered by me" (hid-system 0143, MY-1) in plain words: the member's own lab requests and prescriptions at this
 * facility, each with its own laboratory or pharmacy progress in ORD-3's words (consult/orders/progress.ts). The rules
 * are the backend's (INTERFACE_CONTRACT.md "MY-1"); these only choose what the page offers and says. EHR decides every
 * request.
 */

export const TITLE = 'Ordered by me'
export const EYEBROW = 'Care'
export const DESCRIPTION = 'The tests and medicines you ordered here, and how far each one has got in this facility’s laboratory or pharmacy.'

/**
 * Who the page is for (the overseer, hid-system#258, 26 Nov 2026, following Ola's clinical view): staff who order lab
 * tests or medicines here, not everyone who can read them. The page is offered (sidebar, search, Home's shortcuts, its
 * address) to a member who writes either kind, by the same permissions the blue EHR orders with (consult/orders/orders.ts
 * KINDS). The backend's own rule stays wider (contracts registry ehr.myOrders, my-orders.service.ts kinds(): either
 * read); only the website narrows it. The owner can overrule.
 */
export const LAB_WRITE = KINDS.laboratory.write
export const PRESCRIPTION_WRITE = KINDS.pharmacy.write
/** The backend lists each kind by its read permission, so a kind is shown only with its read as well as its write. */
export const LAB_READ = KINDS.laboratory.read
export const PRESCRIPTION_READ = KINDS.pharmacy.read

export const UNAVAILABLE_MESSAGE = 'Ordered by me shows the tests and medicines you ordered here. It is for staff who order them.'

/** Lab requests are shown to a member who orders them and can read them. */
export function showsLab(permissions: readonly string[]): boolean {
  return permissions.includes(LAB_WRITE) && permissions.includes(LAB_READ)
}
/** Prescriptions are shown to a member who writes them and can read them. */
export function showsPrescriptions(permissions: readonly string[]): boolean {
  return permissions.includes(PRESCRIPTION_WRITE) && permissions.includes(PRESCRIPTION_READ)
}
/** The page opens with at least one kind to show; a member who only reads orders, or writes without reading, is refused. */
export function canUseOrderedByMe(permissions: readonly string[]): boolean {
  return showsLab(permissions) || showsPrescriptions(permissions)
}

/** The kind the list asks for: 'all' only to a member shown both, else the one kind, so nothing else comes back. */
export function firstKind(lab: boolean, prescriptions: boolean): MyOrdersKindFilter {
  return lab && prescriptions ? 'all' : lab ? 'lab' : 'prescription'
}

/** The tabs, shown only to a member shown both kinds: one kind alone needs no choosing. */
export const KIND_TABS: readonly { readonly value: MyOrdersKindFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'lab', label: 'Lab' },
  { value: 'prescription', label: 'Prescriptions' },
]

/** How many rows to ask for at a time (the backend's default; at most 50). */
export const PAGE_SIZE = 25
/** How far back the list can look (MY_ORDERS_SINCE_TOO_OLD past it). */
export const LOOK_BACK_YEARS = 2

export const SINCE_TOO_OLD = 'You can look back up to 2 years. Choose a later date.'
export const SINCE_IN_FUTURE = 'Choose a day that is today or earlier.'
export const SINCE_MISSING = 'Choose the day to show orders from.'
export const UNAVAILABLE = 'Your orders cannot be listed right now. Please try again.'
export const RESTARTED = 'Your orders changed. Showing them again from the start.'
export const PURPOSE = 'Ordered by me is for patient care only. Reload the page and try again.'
export const LOAD_FAILED = 'Your orders could not be loaded.'
export const MORE_FAILED = 'More orders could not be loaded.'
/** VALIDATION_FAILED with no day chosen: a kind, filter, size or cursor the backend did not take, not anything the member chose. */
export const NOT_TAKEN = 'The list could not be shown as asked. Reload the page and try again.'
/** MY_ORDERS_NOT_PERMITTED: the member's place at this facility is not active (inactive or on hold), not a missing role. */
export const NOT_ACTIVE_HERE = 'Your staff account at this facility is not active right now, so your orders cannot be listed. Ask your facility administrator.'

/**
 * Every refusal the route can answer, in plain words (never its code, nor the backend's 403 text). INVALID_CURSOR is
 * the page's to handle first: it starts the list again from the top and says so (RESTARTED). A refusal about a day the
 * member chose is said at the date picker in sinceRefusalWords' words instead.
 */
export const MY_ORDERS_REFUSALS: Readonly<Record<string, string>> = {
  MY_ORDERS_SINCE_TOO_OLD: SINCE_TOO_OLD,
  VALIDATION_FAILED: NOT_TAKEN,
  INVALID_CURSOR: RESTARTED,
  PURPOSE_OF_USE_REQUIRED: PURPOSE,
  // The database's own codes, should one come through as it is (the service turns each into one of the above).
  MY_ORDERS_DIRECT_CARE_ONLY: PURPOSE,
  MY_ORDERS_NOT_PERMITTED: NOT_ACTIVE_HERE,
  PERMISSION_DENIED: UNAVAILABLE_MESSAGE,
  MY_ORDERS_UNAVAILABLE: UNAVAILABLE,
}

/** A refusal's words: this page's own, else the departments' plain words. */
export function refusalWords(caught: unknown, fallback: string): string {
  if (isHidApiError(caught) && Object.hasOwn(MY_ORDERS_REFUSALS, caught.code)) return MY_ORDERS_REFUSALS[caught.code]!
  if (isHidApiError(caught) && caught.status === 403) return UNAVAILABLE_MESSAGE
  return errorText(caught, fallback)
}

/** Whether a refusal is about the day chosen, so it is said at the date picker. Only asked when a day was sent. */
export function isSinceRefusal(caught: unknown): boolean {
  return isHidApiError(caught) && (caught.code === 'MY_ORDERS_SINCE_TOO_OLD' || caught.code === 'VALIDATION_FAILED')
}

/** A refused day's words at the date picker: too far back, else (VALIDATION_FAILED for a day sent) later than today. */
export function sinceRefusalWords(caught: unknown): string {
  return isHidApiError(caught) && caught.code === 'MY_ORDERS_SINCE_TOO_OLD' ? SINCE_TOO_OLD : SINCE_IN_FUTURE
}

/**
 * "20 Nov 2026, 10:15" in Lagos for the order's createdAt, as its progress words are (progress.ts), never all in
 * numbers; '' when it is missing or not a date. Lagos time comes from the one helper (@hid/ui/display, P2-4).
 */
export function orderedWhen(value: string | null | undefined): string {
  return formatDateTime(value)
}

/** The earliest day the list can start from, in Lagos: today 2 years ago (29 Feb is taken as 28 Feb). */
export function earliestSince(today: string = lagosToday()): string {
  const [year = '', month = '', day = ''] = today.split('-')
  const earlier = `${String(Number(year) - LOOK_BACK_YEARS).padStart(4, '0')}-${month}-${day}`
  return month === '02' && day === '29' ? earlier.replace(/-29$/, '-28') : earlier
}

/** What is wrong with a day typed or picked for "Look further back", or '' when it can be sent. */
export function sinceProblem(value: string, today: string = lagosToday()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return SINCE_MISSING
  if (value > today) return SINCE_IN_FUTURE
  if (value < earliestSince(today)) return SINCE_TOO_OLD
  return ''
}

/** "21 Nov 2026" for a server day ("2026-11-21"), never all in numbers. */
export function dayWords(value: string): string {
  // Only a server day is taken: the day as written, never moved by a zone (formatDate keeps a calendar day as it is).
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : ''
}

/** What the list covers: the contract's words for the first view, the day chosen after "Look further back". */
export function coverageText(openOnly: boolean, chosenSince: string | null, answeredSince: string): string {
  if (openOnly) return 'Showing every order that is still open.'
  if (!chosenSince) return 'Showing the last 90 days and everything still open.'
  const day = dayWords(answeredSince || chosenSince)
  return day ? `Showing orders from ${day} and everything still open.` : 'Showing the last 90 days and everything still open.'
}

/** "N more orders are for patients whose records you can no longer open.", "At least N more…" when it is a lower bound. */
export function hiddenText(count: number, complete: boolean): string {
  if (count <= 0) return ''
  const lead = complete ? '' : 'At least '
  return count === 1
    ? `${lead}1 more order is for a patient whose records you can no longer open.`
    : `${lead}${count} more orders are for patients whose records you can no longer open.`
}

/** The row's kind in words, and the order's own word ("the lab request"). */
export function kindWord(kind: MyOrder['kind']): string {
  return kind === 'lab_request' ? 'Lab request' : 'Prescription'
}
export function orderWord(kind: MyOrder['kind']): string {
  return kind === 'lab_request' ? 'lab request' : 'prescription'
}

/** The test or medicine, or the kind when the order stored no name. */
export function orderName(order: MyOrder): string {
  return order.display.trim() || kindWord(order.kind)
}

export function priorityWords(order: MyOrder): string {
  return priorityText(order.priority)
}

/** ORD-3's progress words for the row ("Results ready 11:05", "Progress not available right now"), or null. */
export function progressWords(order: MyOrder, now: Date = new Date()): string | null {
  return ownProgressWords(order.kind === 'lab_request' ? 'laboratory' : 'pharmacy', order, now)
}

/** The patient's name as the row says it, never their Health ID. */
export function patientName(order: MyOrder): string {
  return order.patient.fullName.trim() || 'The patient'
}

/** The empty list's words. */
export function emptyText(openOnly: boolean): { readonly title: string; readonly message: string } {
  return openOnly
    ? { title: 'No open orders', message: 'None of the tests or medicines you ordered here are still open.' }
    : { title: 'No orders', message: 'You have no orders here in this time.' }
}
