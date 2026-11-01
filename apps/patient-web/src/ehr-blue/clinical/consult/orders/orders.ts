import { createContext, useContext } from 'react'
import { staffApi, type ClinicalRecord, type OrderRouteKind, type Page } from '../../../../staff/api'
import { usesNovuBackend } from '../../../../backendContract'
import { learnLateCorrectionFrom } from '../../../../lateCorrectionServed'
import { learnWrongPatientServed } from '../../../../wrongPatientServed'
import { priorityLabel } from '../../../../staff/orderRoutes'
import type { Chart } from '../../parts/chart'
import { readOrderRoute } from './words'

/** The two kinds of order raised from an encounter, as the design's workspaces name them. */
export type OrderKind = 'pharmacy' | 'laboratory'

export interface KindInfo {
  readonly record: 'prescriptions' | 'lab-requests'
  readonly route: OrderRouteKind
  readonly read: string
  readonly write: string
  /** The design's workspace title. */
  readonly title: string
  /** Today's word for one order. */
  readonly what: string
  /** Today's empty list sentence (Clinical.tsx:1808). */
  readonly empty: string
}

export const KINDS: Readonly<Record<OrderKind, KindInfo>> = {
  pharmacy: {
    record: 'prescriptions', route: 'prescription', read: 'ehr.prescription.read', write: 'ehr.prescription.write',
    title: 'Pharmacy', what: 'prescription', empty: 'No prescriptions for this encounter.',
  },
  laboratory: {
    record: 'lab-requests', route: 'lab_request', read: 'ehr.lab-request.read', write: 'ehr.lab-request.write',
    title: 'Laboratory', what: 'lab request', empty: 'No lab requests for this encounter.',
  },
}

/** Today's record title (Clinical.tsx recordTitle). */
export function orderTitle(kind: OrderKind, record: ClinicalRecord): string {
  const name = kind === 'pharmacy' ? record.medicationDisplay : record.testDisplay
  return typeof name === 'string' && name.trim() ? name : kind === 'pharmacy' ? 'Prescription' : 'Lab request'
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/** "Routine", "As soon as possible": today's priority words. */
export function priorityText(value: unknown): string {
  return priorityLabel(text(value)) ?? ''
}

/** What today's page learns from a records answer: the served receiving-side reports, and whether orders may be sent elsewhere. */
export function learnFrom(answer: Page<ClinicalRecord> & { crossFacilityOrders?: boolean; wrongPatientReports?: boolean }) {
  if (answer?.wrongPatientReports === true) learnWrongPatientServed(true)
  learnLateCorrectionFrom(answer, (Array.isArray(answer?.items) ? answer.items : []).map(item => item.orderRoute))
  return answer?.crossFacilityOrders === true
}

export interface OrderRead {
  readonly record: ClinicalRecord | null
  readonly crossFacilityOrders: boolean
}

/**
 * One order of this encounter, found in today's records list (there is no single-record read): the newest page
 * first, then older pages until it is found. `fresh` re-reads past the client's de-duplication, as today's page
 * does after a change.
 */
export async function readOrder(chart: Chart, encounterId: string, kind: OrderKind, orderId: string, fresh: boolean): Promise<OrderRead> {
  const recordKind = KINDS[kind].record
  let answer = fresh
    ? await staffApi.records(chart.facilityId, chart.patientId, encounterId, recordKind, { cursor: undefined, fresh: true })
    : await staffApi.records(chart.facilityId, chart.patientId, encounterId, recordKind)
  const crossFacilityOrders = learnFrom(answer)
  for (let pages = 1; ; pages += 1) {
    const found = (Array.isArray(answer?.items) ? answer.items : []).find(item => item.id === orderId)
    if (found) return { record: found, crossFacilityOrders }
    if (!answer?.nextCursor || pages >= 40) return { record: null, crossFacilityOrders }
    answer = await staffApi.records(chart.facilityId, chart.patientId, encounterId, recordKind, { cursor: answer.nextCursor, fresh })
  }
}

/** What this member may do with orders, by today's rules (Clinical.tsx `Clinical()` gates). */
export function orderRights(chart: Chart, crossFacilityOrders: boolean) {
  const novu = usesNovuBackend()
  const canRouteOrders = novu && crossFacilityOrders && chart.canWrite && chart.can('ehr.order-route.send')
  return {
    novu,
    canSendToLab: chart.can('lab.work-item.accept'),
    canRoute: (kind: OrderKind) => canRouteOrders && chart.can(KINDS[kind].write),
    canWithdraw: novu && chart.purpose === 'direct-care' && chart.can('ehr.order-route.send'),
  }
}

/** The patient as today's order wording names them: the lookup's full name, else the Health ID. */
export function patientWord(chart: Chart): string {
  return chart.patient.lookup.patient.fullName ?? chart.patient.hid
}

export function routeOf(record: ClinicalRecord) {
  return readOrderRoute(record.orderRoute)
}

/** A draft or active order with no route in force (or one that may be sent again): Clinical.tsx `mayBeSent`. */
export function mayBeSent(record: ClinicalRecord): boolean {
  const route = routeOf(record)
  return (record.status === 'draft' || record.status === 'active') && route !== undefined && (route === null || route.resendAllowed)
}

/** A message one order page leaves for the next (after a create): held in memory only, never in the URL or router state. */
export interface Flash {
  readonly orderId: string
  readonly success?: string
  readonly error?: string
}

export const FlashContext = createContext<{ flash: Flash | null; setFlash: (flash: Flash | null) => void }>({
  flash: null,
  setFlash: () => {},
})

export function useFlash() {
  return useContext(FlashContext)
}
