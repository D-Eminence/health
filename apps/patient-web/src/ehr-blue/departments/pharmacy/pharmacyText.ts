import type { EhrBadgeTone } from '@hid/ui/ehr'
import type { Tone } from '../../../kasuwa/ui'
import { usesNovuBackend } from '../../../backendContract'
import type { Facility, PharmacyWorkItem, WorkItemOrderRoute } from '../../../staff/api'
import { priorityLabel, routedWorkEndedText } from '../../../staff/orderRoutes'
import { selfServiceReview, selfServiceType } from '../../../staff/staffAccess'
import { matchesSearch } from '../parts/format'
import { patientLabel } from '../parts/routedWork'
import { urgencyRank } from '../parts/WorkQueue'
import { billOf, billOwing } from './pocFields'

/** A work item's status as the design writes it: one lowercase word on its badge. */
export type PharmacyStatus = 'accepted' | 'dispensed' | 'reversed' | 'not dispensable'

/**
 * Today's order of precedence (staff/routes/Operations.tsx PharmacyAction): a reversed dispensing, then a dispensing,
 * then work Pharmacy refused to dispense (known only once a dispensing was refused), else accepted.
 */
export function statusOf(item: PharmacyWorkItem, undispensable: boolean): PharmacyStatus {
  return item.dispensing?.reversed ? 'reversed' : item.dispensing ? 'dispensed' : undispensable ? 'not dispensable' : 'accepted'
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

/** Whether a row matches the list's search: its medication, patient, dose, route, priority and the order it came from. */
export function matchesItem(query: string, item: PharmacyWorkItem, status: PharmacyStatus): boolean {
  return matchesSearch(query, [item.medication.display, patientLabel(item), doseLine(item), item.routeCode, item.instructions,
    status, priorityLabel(item.priority), item.orderRoute?.orderingFacilityName, item.orderRoute?.reference, item.orderRoute?.ordererName,
    item.id.slice(0, 8)])
}

/** The "Not dispensable" banner's words: who changed the prescription when another facility sent it. */
export function notDispensableText(item: PharmacyWorkItem): string {
  return item.orderRoute
    ? `${item.orderRoute.orderingFacilityName ?? 'The prescribing facility'} changed or cancelled this prescription, or its time `
      + 'for dispensing has ended. A new prescription is needed.'
    : 'This prescription is no longer active as Pharmacy accepted it, or it could not be checked. A new prescription and '
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
  const rank = (item: PharmacyWorkItem) => item.dispensing ? 2 : doseMissing(item) || undispensable(item.id) ? 1 : 0
  const time = (item: PharmacyWorkItem) => Date.parse(item.acceptedAt) || 0
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || urgencyRank(a.item.priority) - urgencyRank(b.item.priority)
      || time(a.item) - time(b.item) || a.index - b.index).map(entry => entry.item)
}

const ROUTE_WORDS: Readonly<Record<string, string>> = {
  oral: 'by mouth', po: 'by mouth', 'by mouth': 'by mouth', sublingual: 'under the tongue', sl: 'under the tongue',
  iv: 'into a vein', intravenous: 'into a vein', im: 'into a muscle', intramuscular: 'into a muscle',
  sc: 'under the skin', subcut: 'under the skin', subcutaneous: 'under the skin', topical: 'on the skin',
  inhaled: 'by breathing in', inhalation: 'by breathing in', nasal: 'into the nose', rectal: 'into the back passage', pr: 'into the back passage',
  ophthalmic: 'into the eye', eye: 'into the eye', otic: 'into the ear', ear: 'into the ear', vaginal: 'into the vagina', pv: 'into the vagina',
}

const VERB: Readonly<Record<string, string>> = { cream: 'Apply', inhaler: 'Inhale', drops: 'Use', injection: 'Give' }

/**
 * What the label says, in plain words: "Take 1 tablet by mouth twice daily." and the prescriber's instructions. Only
 * what the prescription says: no part is guessed, so a prescription with no dose has none on its label ("Apply on the
 * skin twice daily."). Null when how often, or half of a dose, is missing (it can't be labelled).
 */
export function labelText(item: PharmacyWorkItem, form: string): string | null {
  if (doseMissing(item)) return null
  const route = item.routeCode ? ROUTE_WORDS[item.routeCode.trim().toLowerCase()] ?? item.routeCode.trim() : ''
  const main = [VERB[form] ?? 'Take', doseText(item), route, item.frequency?.trim()].filter(Boolean).join(' ')
  const extra = item.instructions?.trim()
  return `${main}.${extra ? ` ${extra.replace(/^./, c => c.toUpperCase())}${/[.!?]$/.test(extra) ? '' : '.'}` : ''}`
}

/** A status as a dispenser says it, on the badge: work waiting is "To dispense". Never colour alone. */
export function statusWord(status: PharmacyStatus): string {
  return status === 'accepted' ? 'To dispense' : status === 'not dispensable' ? 'Not dispensable' : status === 'dispensed' ? 'Dispensed' : 'Reversed'
}

/**
 * The kinds of self-signed-up facility that get Pharmacy once Health ID support has checked them: the ones whose locked
 * list names it (staff/routes/ReviewBanner.tsx LOCKED). A laboratory, or another kind, is never promised it.
 */
const GETS_PHARMACY: ReadonlySet<string> = new Set(['pharmacy', 'hospital', 'clinic'])

/**
 * Pharmacy's refusal to a member whose role doesn't include `work` ("pharmacy work", "prescriptions", "dispensing
 * medicines"…): today's refusal (staff/routes/Operations.tsx) in plain words, and the step that is the member's. Said by
 * the Prescriptions page opened without the permission (page.tsx) and by a dispensing or reversal refused for the role
 * (PharmacyRecord.tsx), so both say the same. The administrator of a facility that signed itself up (the only role there
 * that manages staff) is never told to ask the facility administrator, which they are. While Health ID support checks a
 * facility that will get Pharmacy, Pharmacy is locked for them too (the banner above says so): it opens after the check.
 * Once the facility is checked, they add a pharmacist on the Staff page. A facility that will not get Pharmacy has no step.
 */
export function pharmacyRefusalText(work: string, facility: Pick<Facility, 'selfService'> | undefined,
  permissions: readonly string[]): string {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const getsPharmacy = GETS_PHARMACY.has(selfServiceType(facility) ?? '')
  if (review === 'pending' && getsPharmacy) return 'Pharmacy opens once Health ID support has checked your facility.'
  const administrator = review !== null && permissions.includes('workforce.manage')
  const next = !administrator ? ' Ask your facility administrator.' : review === 'reviewed' && getsPharmacy ? ' Add a pharmacist on the Staff page.' : ''
  return `Your role at this facility doesn’t include ${work}.${next}`
}
