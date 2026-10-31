import type { EhrBadgeTone } from '@hid/ui/ehr'
import type { Tone } from '../../../kasuwa/ui'
import type { PharmacyWorkItem, WorkItemOrderRoute } from '../../../staff/api'
import { routedWorkEndedText } from '../../../staff/orderRoutes'
import { matchesSearch } from '../parts/format'
import { patientLabel } from '../parts/routedWork'

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
 * Whether the prescription lacks what a dispenser needs to hand it over safely: the dose with its unit, and how often.
 * Said on the row and the record as "Can't dispense: dose missing" (the prescriber needs to complete it).
 */
export function doseMissing(item: PharmacyWorkItem): boolean {
  return item.doseQuantity == null || !item.doseUnit?.trim() || !item.frequency?.trim()
}

export const DOSE_MISSING = 'Can’t dispense: dose missing'

/** The dose and frequency under the medicine in the list. */
export function doseLine(item: PharmacyWorkItem): string {
  return `${doseText(item) ?? 'Dose not recorded'} · ${item.frequency || 'How often not recorded'}`
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

/** Whether a row matches the list's search: its medication, patient, dose, route and the order it came from. */
export function matchesItem(query: string, item: PharmacyWorkItem, status: PharmacyStatus): boolean {
  return matchesSearch(query, [item.medication.display, patientLabel(item), doseLine(item), item.routeCode, item.instructions,
    status, item.orderRoute?.orderingFacilityName, item.orderRoute?.reference, item.orderRoute?.ordererName, item.id.slice(0, 8)])
}

/** The "Not dispensable" banner's words: who changed the prescription when another facility sent it. */
export function notDispensableText(item: PharmacyWorkItem): string {
  return item.orderRoute
    ? `${item.orderRoute.orderingFacilityName ?? 'The prescribing facility'} changed or cancelled this prescription, or its time `
      + 'for dispensing has ended. A new prescription is needed.'
    : 'This prescription is no longer active as Pharmacy accepted it, or it could not be checked. A new prescription and '
      + 'handoff are needed.'
}
