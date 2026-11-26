import { formatDateTime, formatTimeOrDateTime } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type { Tone } from '../../../kasuwa/ui'
import { routeLabel } from '../../../plainLabels'
import type {
  Facility, PharmacistAcceptance, PharmacyChangeAfterDispensing, PharmacyStep, PharmacyWorkItem, WorkItemOrderRoute,
} from '../../../staff/api'
import { priorityLabel, routedWorkEndedText } from '../../../staff/orderRoutes'
import { PHARMACY_WORK, refusedWorkText } from '../../../staff/refusedWork'
import { matchesSearch } from '../parts/format'
import { patientLabel } from '../parts/routedWork'
import { urgencyRank } from '../parts/WorkQueue'
import { billOf, billOwing } from './pocFields'

/** A work item's status as the design writes it: one lowercase word on its badge. */
export type PharmacyStatus = 'accepted' | 'dispensed' | 'reversed' | 'not dispensable'

/**
 * Why this hospital's own item was withdrawn by the prescribing team before it was dispensed (hid-system 0133 and
 * ORD-2, pharmacy-api at 06f98040): `changed` (the prescribing team put it on hold, cancelled, corrected, edited or
 * resumed it after it was sent), `sent_elsewhere` (sent to another facility's pharmacy instead), or `other` for any
 * other reason, or none, this page does not know.
 */
export type WithdrawnReason = 'changed' | 'sent_elsewhere' | 'other'

/** A `withdrawnReason` code (the item's own, ORD-2, or a 409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE's, ORD-4) as a reason. */
export function withdrawnReasonFrom(code: string | null | undefined): WithdrawnReason {
  return code === 'changed' || code === 'sent_elsewhere' ? code : 'other'
}

/**
 * The one reading of an item's `withdrawn` and `withdrawnReason`: its reason when it is withdrawn, else null. The
 * reason counts only with `withdrawn: true`, and an item already dispensed is never withdrawn.
 */
export function withdrawnReasonOf(item: Pick<PharmacyWorkItem, 'withdrawn' | 'withdrawnReason' | 'dispensing'>): WithdrawnReason | null {
  return item.withdrawn === true && !item.dispensing ? withdrawnReasonFrom(item.withdrawnReason) : null
}

/**
 * Today's order of precedence (staff/routes/Operations.tsx PharmacyAction): a reversed dispensing, then a dispensing,
 * then work that can't be dispensed (withdrawn by the prescribing team, ORD-2, or refused by Pharmacy once a dispensing
 * was), else accepted. A withdrawn item is "not dispensable", as any other is: there is one such status.
 */
export function statusOf(item: PharmacyWorkItem, undispensable: boolean): PharmacyStatus {
  return item.dispensing?.reversed ? 'reversed' : item.dispensing ? 'dispensed'
    : undispensable || withdrawnReasonOf(item) ? 'not dispensable' : 'accepted'
}

/** hid-system ORD-4: who may accept a prescription (the pharmacist role only). */
export const ACCEPT_PERMISSION = 'pharmacy.work-item.accept'

/**
 * A step as a pharmacist says it (ORD-4). Only "Received" and "Accepted" add to the status badge: a dispensed or reversed
 * item already says so there, in the same words the page used before the step existed.
 */
const STEP_WORD: Readonly<Record<PharmacyStep, string>> = {
  received: 'Received', accepted: 'Accepted', dispensed: 'Dispensed', dispensing_reversed: 'Dispensing reversed',
}

/* Lagos is where the pharmacy works, so a time is said on its clock whatever the device's own zone (Q181 A). */

/** "10:52" today, else "12 Nov 2026, 10:52" (ORD-4 screen notes write the time alone); empty when it is not a time. */
export function clockText(value: string, now = Date.now()): string {
  return formatTimeOrDateTime(value, now)
}

/**
 * Who accepted it, as SX-9 answered: a name; null for a member whose login was deleted (SX-9's "Former staff member");
 * undefined when not known (not asked, not answered, or no row), and then no one is named and no id is ever shown.
 */
export type AcceptorName = string | null | undefined

/** SX-9's words for a member with no name, as they read inside a sentence. */
export const FORMER_STAFF_MEMBER = 'a former staff member'

/**
 * What the step adds beside the status, or null: nothing with no step (today's backend, ORD-4 "show no step"), nor for a
 * dispensed or reversed item (its status says it). An acceptance says "Accepted by <name> 10:52" when the name is known
 * (`who`, from SX-9), else "Accepted 10:52".
 */
export function stepText(item: Pick<PharmacyWorkItem, 'pharmacyStep' | 'pharmacistAcceptance'>, now = Date.now(), who?: AcceptorName): string | null {
  if (item.pharmacyStep === 'received') return STEP_WORD.received
  if (item.pharmacyStep !== 'accepted') return null
  return item.pharmacistAcceptance ? acceptedText(item.pharmacistAcceptance, false, now, who) : STEP_WORD.accepted
}

/**
 * "Accepted by <name> 10:52", or "Already accepted by <name> 10:52" when someone had accepted it first (ORD-4 screen
 * notes). With no name known, "Accepted 10:52"; a member with no name is "a former staff member" (SX-9).
 */
export function acceptedText(acceptance: PharmacistAcceptance | null | undefined, already: boolean, now = Date.now(), who?: AcceptorName): string {
  const said = already ? 'Already accepted' : 'Accepted'
  const by = !acceptance || who === undefined ? '' : ` by ${who === null ? FORMER_STAFF_MEMBER : who}`
  const time = acceptance ? clockText(acceptance.acceptedAt, now) : ''
  return `${said}${by}${time ? ` ${time}` : ''}`
}

/**
 * Whether Accept is offered (ORD-4 screen notes): on a received item that is not withdrawn (ORD-2), not refused by
 * Pharmacy since it was opened, and not dispensed. Who may press it is checked by the record (ACCEPT_PERMISSION).
 */
export function acceptable(item: PharmacyWorkItem, undispensable: boolean): boolean {
  return item.pharmacyStep === 'received' && !isWithdrawn(item) && !undispensable && !item.dispensing
}

/** ORD-2's and 0133's words for who withdrew it and why, on the card and in the record's "Not dispensable" notice. */
export const WITHDRAWN_WORDS: Readonly<Record<WithdrawnReason, string>> = {
  changed: 'Changed or stopped by the prescribing team',
  sent_elsewhere: 'Sent to another pharmacy by the prescribing team',
  other: 'Withdrawn by the prescribing team',
}

/** Why Pharmacy will not take on a withdrawn prescription, by its reason (never by any text the server sent). */
export function withdrawnText(reason: WithdrawnReason): string {
  return `${WITHDRAWN_WORDS[reason]}. It can no longer be dispensed here.`
}

/**
 * Q132 A (hid-system 0148, INTERFACE_CONTRACT "Screen change"): what the prescribing team did to a prescription after it
 * was dispensed, as it reads after "Changed after dispensing:". Never the code itself.
 */
export const CHANGE_WORDS: Readonly<Record<PharmacyChangeAfterDispensing, string>> = {
  on_hold: 'put on hold', cancelled: 'cancelled', entered_in_error: 'entered in error', edited: 'edited', resumed: 'resumed',
}

/** The next step after a change to a dispensed prescription (Q132 A). There is no Dismiss or Seen. */
export const CONTACT_PATIENT = 'Contact the patient.'

/** What the record and the card say of a change after dispensing (Q132 A): the change, when it was made, and what to do. */
export interface ChangedAfterNotice {
  /** "Changed after dispensing: cancelled by the prescribing team (changed 2 times)". */
  readonly text: string
  /** "Last change: 20 Nov 2026, 09:15", on Lagos time; empty when it is not a time. */
  readonly when: string
}

/**
 * "Last change: 20 Nov 2026, 09:15" on Lagos time, whatever the device's own zone: always with the day, as the contract's
 * example writes it (a pharmacist reads it days later). Empty when it is not a time.
 */
export function lastChangeText(changedAt: string): string {
  const when = formatDateTime(changedAt)
  return when ? `Last change: ${when}` : ''
}

/**
 * Who changed a dispensed prescription (Q132 A): "the prescribing team" on this facility's own work, which carries the
 * prescription it came from; on work another facility sent, that facility by name, else "the ordering facility",
 * including work with neither the prescription nor a route card (sent from another facility, its card not read).
 */
function changedByText(item: Pick<PharmacyWorkItem, 'orderRoute' | 'sourceEhrPrescriptionId'>): string {
  if (item.orderRoute) return item.orderRoute.orderingFacilityName?.trim() || 'the ordering facility'
  return item.sourceEhrPrescriptionId?.trim() ? 'the prescribing team' : 'the ordering facility'
}

/**
 * Q132 A's notice on a dispensed item (reversed or not) whose prescription the prescribing team changed afterwards, or
 * null: with no `changedAfterDispensing` nothing is said, as before 0148. Who changed it is said by changedByText. A
 * change this page does not know reads "Changed after dispensing by ...". With more than one change, " (changed n
 * times)". An item not dispensed never says it; a dispensed item is never withdrawn (withdrawnReasonOf), so the notice
 * is never hidden by a `withdrawn` sent with it.
 */
export function changedAfterOf(
  item: Pick<PharmacyWorkItem, 'changedAfterDispensing' | 'dispensing' | 'orderRoute' | 'sourceEhrPrescriptionId'>,
): ChangedAfterNotice | null {
  const changed = item.changedAfterDispensing
  if (!changed || !item.dispensing) return null
  const who = changedByText(item)
  const what = changed.change && Object.hasOwn(CHANGE_WORDS, changed.change) ? `: ${CHANGE_WORDS[changed.change]}` : ''
  const times = changed.changeCount > 1 ? ` (changed ${changed.changeCount} times)` : ''
  return { text: `Changed after dispensing${what} by ${who}${times}`, when: lastChangeText(changed.changedAt) }
}

/** A withdrawn item (ORD-2) can be neither accepted nor dispensed, whatever else it says. */
export function isWithdrawn(item: Pick<PharmacyWorkItem, 'withdrawn' | 'withdrawnReason' | 'dispensing'>): boolean {
  return withdrawnReasonOf(item) !== null
}

/** The design has one badge; only work that can't be dispensed is marked apart. */
export function statusTone(status: PharmacyStatus): EhrBadgeTone {
  return status === 'not dispensable' ? 'critical' : 'brand'
}

/** A status's tone in the shared map: dispensed done, reversed ended, not dispensable stopped, accepted waiting. */
export function queueTone(status: PharmacyStatus): Tone {
  return status === 'not dispensable' ? 'danger' : status === 'dispensed' ? 'success' : status === 'reversed' ? 'neutral' : 'brand'
}

/** A dose's number as written on a label: a leading zero before a decimal point ("0.5", never ".5"). */
function doseNumber(value: number): string {
  return String(value).replace(/^(-?)\./, '$10.')
}

export function doseText(item: PharmacyWorkItem): string | null {
  return item.doseQuantity == null ? null : `${doseNumber(item.doseQuantity)} ${item.doseUnit ?? ''}`.trim()
}

/**
 * Whether the prescription lacks what a dispenser needs to hand it over safely: how often, and a dose given with its
 * unit (or neither). A prescription with no dose and no unit (a cream, or "as directed") is complete, as in classic,
 * which said only "Dose not recorded". Said on the row and the record as "Can't dispense: dose missing" (the prescriber
 * needs to complete it).
 */
export function doseMissing(item: PharmacyWorkItem): boolean {
  return !item.frequency?.trim() || (item.doseQuantity == null) !== !item.doseUnit?.trim()
}

export const DOSE_MISSING = 'Can’t dispense: dose missing'

/** The dose and frequency under the medicine in the list. */
export function doseLine(item: PharmacyWorkItem): string {
  return `${doseText(item) ?? 'Dose not recorded'} · ${item.frequency || 'How often not recorded'}`
}

const DURATION_UNIT: Readonly<Record<string, readonly [string, string]>> = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] }

/**
 * How long the medicine is for, in words ("7 days", "1 week"), when the prescriber said (proposed hid-system 0107); null
 * when not, or when what was sent can't be said plainly (a unit not on the list, a number that isn't a whole one above 0).
 */
export function durationText(item: Pick<PharmacyWorkItem, 'duration'>): string | null {
  const value = item.duration?.value
  const key = item.duration?.unit?.trim().toLowerCase() ?? ''
  const unit = Object.hasOwn(DURATION_UNIT, key) ? DURATION_UNIT[key] : undefined
  if (!unit || typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null
  return `${value} ${unit[value === 1 ? 0 : 1]}`
}

/**
 * How much to hand over as the prescriber wrote it ("21 capsules"), when sent (proposed 0107); null when not, or when it
 * isn't a positive number. The pharmacist still confirms it: the dispensing form starts with it, and nothing compares the
 * two.
 */
export function prescribedQuantity(item: Pick<PharmacyWorkItem, 'quantityToDispense' | 'quantityUnit'>): { quantity: number; unit: string | null } | null {
  const quantity = item.quantityToDispense
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null
  return { quantity, unit: item.quantityUnit?.trim() || null }
}

/**
 * What the list says beside the status of work from another facility that may no longer be worked: how its order
 * ended, or that it lapsed. The record itself says the rest (RoutedWorkLines).
 */
export function routeAlert(route: WorkItemOrderRoute | undefined, late: boolean): string | null {
  if (!route) return null
  const ended = routedWorkEndedText(route, late)
  if (ended) return ended
  return route.effectiveState === 'expired' ? 'This order has lapsed: no more work can be recorded on it.' : null
}

/**
 * Whether a row matches the list's search: its medication, patient, dose, route, priority, the order it came from and a
 * change after dispensing (so "cancelled" finds it).
 */
export function matchesItem(query: string, item: PharmacyWorkItem, status: PharmacyStatus): boolean {
  return matchesSearch(query, [item.medication.display, patientLabel(item), doseLine(item), item.routeCode, routeLabel(item.routeCode), item.instructions,
    status, priorityLabel(item.priority), item.orderRoute?.orderingFacilityName, item.orderRoute?.reference, item.orderRoute?.ordererName,
    changedAfterOf(item)?.text, item.id.slice(0, 8)])
}

/** The "Not dispensable" banner's words: who changed the prescription when another facility sent it. */
export function notDispensableText(item: PharmacyWorkItem): string {
  return item.orderRoute
    ? `${item.orderRoute.orderingFacilityName ?? 'The prescribing facility'} changed or cancelled this prescription, or its time `
      + 'for dispensing has ended. A new prescription is needed.'
    : 'This prescription is no longer active as Pharmacy received it, or it could not be checked. A new prescription and '
      + 'handoff are needed.'
}

/**
 * Which tab of the queue a prescription belongs to: waiting to be dispensed, waiting for payment (a bill owed, from a
 * backend that sends bills: POINT_OF_CARE_SPEC §3), or handed over. Reversed work is in All.
 */
export type PharmacyTab = 'todo' | 'payment' | 'dispensed' | 'all'

export function inTab(tab: PharmacyTab, item: PharmacyWorkItem): boolean {
  if (tab === 'todo') return !item.dispensing
  if (tab === 'payment') return !item.dispensing && billOwing(billOf(item))
  if (tab === 'dispensed') return Boolean(item.dispensing && !item.dispensing.reversed)
  return true
}

/**
 * The order the queue works in: what can be dispensed now first, then what can't be dispensed yet (dose missing, or
 * refused), then what is already done. Within each, stat, as soon as possible and urgent prescriptions come first, as the
 * Laboratory's do, then the oldest accepted (first come, first served). Only prescriptions written with a priority carry
 * one (proposed hid-system 0107); with none, the order is first come, first served, as before.
 */
export function queueOrder(items: readonly PharmacyWorkItem[], undispensable: (id: string) => boolean): PharmacyWorkItem[] {
  // Withdrawn work (ORD-2) is not dispensable from the start: it waits with the other work that can't be dispensed.
  const rank = (item: PharmacyWorkItem) => item.dispensing ? 2 : doseMissing(item) || undispensable(item.id) || isWithdrawn(item) ? 1 : 0
  const time = (item: PharmacyWorkItem) => Date.parse(item.acceptedAt) || 0
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || urgencyRank(a.item.priority) - urgencyRank(b.item.priority)
      || time(a.item) - time(b.item) || a.index - b.index).map(entry => entry.item)
}

const VERB: Readonly<Record<string, string>> = { cream: 'Apply', inhaler: 'Inhale', drops: 'Use', injection: 'Give' }

/**
 * What the label says, in plain words: "Take 1 tablet by mouth twice daily." and the prescriber's instructions. Only
 * what the prescription says: no part is guessed, so a prescription with no dose has none on its label ("Apply on the
 * skin twice daily."). Null when how often, or half of a dose, is missing (it can't be labelled).
 */
export function labelText(item: PharmacyWorkItem, form: string): string | null {
  if (doseMissing(item)) return null
  const route = routeLabel(item.routeCode) ?? item.routeCode?.trim() ?? ''
  const main = [VERB[form] ?? 'Take', doseText(item), route, item.frequency?.trim()].filter(Boolean).join(' ')
  const extra = item.instructions?.trim()
  return `${main}.${extra ? ` ${extra.replace(/^./, c => c.toUpperCase())}${/[.!?]$/.test(extra) ? '' : '.'}` : ''}`
}

/** A status as a dispenser says it, on the badge: work waiting is "To dispense". Never colour alone. */
export function statusWord(status: PharmacyStatus): string {
  return status === 'accepted' ? 'To dispense' : status === 'not dispensable' ? 'Not dispensable' : status === 'dispensed' ? 'Dispensed' : 'Reversed'
}

/**
 * Pharmacy's refusal to a member whose role doesn't include `work` ("pharmacy work", "prescriptions", "dispensing
 * medicines"…), and the step that is the member's. Said by the Prescriptions page opened without the permission
 * (page.tsx) and by a dispensing or reversal refused for the role (PharmacyRecord.tsx), so both say the same. Who reads
 * which words is the rule every refusal for a role follows (staff/refusedWork.ts refusedWorkText), written once so the
 * classic Pharmacy page says the same: the administrator of a facility that signed itself up is never told to ask
 * themselves; while Health ID support checks a facility that will get Pharmacy, it opens after the check; once checked,
 * they add a pharmacist on the Staff page; a facility that will not get Pharmacy has no step.
 */
export function pharmacyRefusalText(work: string, facility: Pick<Facility, 'selfService' | 'roles'> | undefined,
  permissions: readonly string[]): string {
  return refusedWorkText(facility, permissions, { ...PHARMACY_WORK, work })
}

/*
 * The classic Pharmacy page's list words (staff/routes/Operations.tsx Pharmacy, ListState and PageHead), word for word
 * (parity row 3.3-69). The tabs, search and paging are the blue page's own; their words are kept for the owner (3.3-66).
 */
export const PRESCRIPTIONS_LOAD_FAILED = 'Work could not be loaded.'
export const PRESCRIPTIONS_REFRESH = 'Refresh work'
/** Classic's empty list: nothing accepted yet, with a Refresh. */
export const PRESCRIPTIONS_EMPTY = { title: 'No accepted prescriptions', description: 'Refresh to check for new work at this facility.', retry: 'Refresh' } as const

/** Classic's words under the page heading: `holds`, a pharmacy that is sent prescriptions from other facilities. */
export function prescriptionsIntro(holds: boolean): string {
  return holds
    ? 'Prescriptions accepted here, from this facility and from other facilities, and full dispensing records. The server checks patient authorization before dispensing or reversal.'
    : 'Accepted prescriptions and full dispensing records for the active facility. The server checks patient authorization before dispensing or reversal.'
}

/**
 * Classic Overview's incoming-orders line (staff/routes/Dashboard.tsx IncomingOrdersCard), shown at the top of
 * Prescriptions, the pharmacy. site's first page, which has no Overview (parity row 6a).
 */
export function incomingCountText(count: number, facilityName: string): string {
  return `${count} prescription${count === 1 ? '' : 's'} from other facilities waiting at ${facilityName}`
}
