import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { EhrButton, EhrEmptyState, EhrSkeleton } from '@hid/ui/ehr'
import type { Facility, LabWorkItem, ReceivingAnswer, WorkItemOrderRoute } from '../../../staff/api'
import { BETWEEN_FACILITIES } from '../../../staff/betweenFacilities'
import { selfServiceReview, selfServiceType } from '../../../staff/staffAccess'
import {
  holdsReceivePermission, licenceLine, receivingAnswer, receivingHere, rememberedReceiving, rememberReceiving, routedWorkEndedText,
} from '../../../staff/orderRoutes'
import { patientCard } from '../../../staff/routes/IncomingOrders'
import { WrongPatientEnded, type WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { LateCorrectionDone, type LateCorrection } from '../../../staff/routes/LateWrongPatient'
import { endingKey, type CannotCompleteEnding, type OrderEndingMode } from '../../../staff/routes/CannotComplete'
import { usesNovuBackend } from '../../../backendContract'
import { learnWrongPatientServed } from '../../../wrongPatientServed'
import { learnLateCorrectionServed, saysLateCorrection, useLateCorrectionServed } from '../../../lateCorrectionServed'
import { learnCannotCompleteFrom } from '../../../cannotCompleteServed'
import { DeptEmbedded } from './DeptEmbedded'
import { DeptNotice } from './DeptNotice'
import { shortId } from './format'

/*
 * Work from orders other facilities sent, as today's Laboratory and Pharmacy pages
 * handle it (staff/routes/Operations.tsx): the same rules, words and endings, in the
 * blue look. Logic is ported line for line; only the markup differs.
 */

/** Who the patient is on a work row: named once an order from another facility is accepted, else masked. */
export function patientLabel(item: { patientId: string; patient?: LabWorkItem['patient'] }): string {
  return item.patient ? patientCard(item.patient) : `Patient ${shortId(item.patientId)}`
}

/**
 * Where work from another facility came from, and whether it may still be worked: the ordering facility and the
 * order's reference, who ordered it with their licence, and an ended or closed order.
 */
export function RoutedWorkLines({ route }: { readonly route: LabWorkItem['orderRoute'] }) {
  const late = useLateCorrectionServed() === true
  if (!route) return null
  const facility = route.orderingFacilityName ?? 'the ordering facility'
  const ended = routedWorkEndedText(route, late)
  return <>
    <p className="hid-ehr-dept-routed-from">From {facility}{route.reference ? ` · Ref ${route.reference}` : ''}{route.ordererName ? ` · Ordered by ${route.ordererName}` : ''}
      {route.ordererLicence ? ` · ${licenceLine(route.ordererLicence.body, route.ordererLicence.number)}` : ''}</p>
    {ended && <DeptNotice tone="critical">{ended}</DeptNotice>}
    {!ended && route.effectiveState === 'expired' && <DeptNotice tone="critical">Nothing was released within 30 days of accepting it, so this order has lapsed: no more work can be recorded on it.</DeptNotice>}
    {!ended && route.effectiveState !== 'expired' && route.access === 'read' && <p className="hid-ehr-dept-muted">The time for work on this order has ended: you can read it, but not record more.</p>}
    {!ended && route.effectiveState !== 'expired' && route.access === 'none' && <p className="hid-ehr-dept-muted">This order from {facility} is closed.</p>}
  </>
}

/**
 * Lab and Pharmacy list at most this many work items, oldest accepted first, and offer no further page. Neither filters
 * by status, so once a facility has this many, a newer one cannot be reached from here.
 */
export const WORK_LIST_CAP = 200

export function WorkListCap({ count, children }: { readonly count: number; readonly children?: ReactNode }) {
  if (count < WORK_LIST_CAP) return null
  return <><DeptNotice>This list can show only the {WORK_LIST_CAP} oldest accepted work items. Any item accepted after them is not shown and cannot be reached from this page: completing work or refreshing the list does not bring it into view. Contact your facility administrator about orders not listed here.</DeptNotice>
    {children}</>
}

/** A list's refresh: focusable while its read runs (aria-busy), when a second press does nothing. */
export function RefreshButton({ loading, onRefresh, children }: { readonly loading: boolean; readonly onRefresh: () => Promise<void>; readonly children: ReactNode }) {
  return <EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void onRefresh() }}>{children}</EhrButton>
}

/** A work list's loading, refusal and empty states, with today's words. */
export function ListState({ loading, error, empty, retry, hasItems }: {
  readonly loading: boolean; readonly error: string; readonly empty: string; readonly retry: () => void; readonly hasItems: boolean
}) {
  return <>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    {loading && !hasItems && <EhrSkeleton label="Loading…" />}
    {!loading && !error && !hasItems && <EhrEmptyState title={empty} message="Refresh to check for new work at this facility."
      action={<EhrButton variant="secondary" onClick={retry}>Refresh</EhrButton>} />}
  </>
}

export function RoutedWorkPaused({ items, crossFacilityWork, receives }: {
  readonly items: ReadonlyArray<{ orderRoute?: unknown }> | null; readonly crossFacilityWork?: boolean; readonly receives: boolean
}) {
  const listed = Boolean(items?.some(item => item.orderRoute))
  if (crossFacilityWork !== false || !(receives || listed)) return null
  return <DeptNotice tone="critical">{listed ? 'Work on orders from other facilities is paused by Health ID.'
    : 'Work on orders from other facilities is paused by Health ID: any you accepted are hidden from this list until it resumes. '
      + 'They are not cancelled.'}</DeptNotice>
}

/**
 * At a laboratory or pharmacy that signed itself up, where its work comes from: one message per case, kept in
 * betweenFacilities.ts.
 */
export function StandaloneWorkNote({ facility, kind, ordersOn, receives }: {
  readonly facility: Facility | undefined; readonly kind: 'laboratory' | 'pharmacy'; readonly ordersOn: boolean; readonly receives: boolean | undefined
}) {
  if (!usesNovuBackend() || !facility || selfServiceReview(facility) !== 'reviewed' || selfServiceType(facility) !== kind) return null
  return <DeptNotice>{BETWEEN_FACILITIES[kind].workspace(facility.name, ordersOn, receives)}</DeptNotice>
}

/**
 * Whether the page treats the working facility as receiving orders of this kind from other facilities, from the whole
 * work-list read and what Incoming answers. Ported unchanged from today's page (see its useReceiving for each case):
 * `mounted`/`probe` decide whether Incoming shows and whether only to show orders already waiting; `watch` keeps it
 * read where the facility does not receive now; `holds` decides the header and the paused notice; `receives` is the
 * backend's answer as known.
 */
export function useReceiving(facility: Facility | undefined, service: 'lab' | 'pharmacy',
  read: { value: (ReceivingAnswer & { items: ReadonlyArray<{ orderRoute?: unknown }> }) | null; loading: boolean }) {
  const session = receivingHere(facility, service)
  const permitted = holdsReceivePermission(facility, service)
  const facilityId = facility?.id
  const membershipId = facility?.membershipId
  const page = `${membershipId ?? ''}:${facilityId ?? ''}`
  useEffect(() => {
    if (permitted && facilityId && membershipId) rememberReceiving({ id: facilityId, membershipId }, service, read.value)
  }, [permitted, facilityId, membershipId, service, read.value])
  const [incoming, setIncoming] = useState<{ page: string; after: unknown; known: ReceivingAnswer } | null>(null)
  const listAnswer = read.value
  const onAnswer = useCallback((answer: unknown) => {
    const said = receivingAnswer(answer)
    if (said) setIncoming({ page, after: listAnswer, known: said })
  }, [page, listAnswer])
  const fromList = permitted ? receivingAnswer(read.value) : null
  const fromIncoming = permitted && incoming?.page === page && incoming.after === read.value ? incoming.known : null
  const answered = fromIncoming ? { ...(fromList ?? {}), ...fromIncoming } : fromList
  const known = answered ?? (permitted ? rememberedReceiving(facility, service) : null)
  const flag = known?.receives
  const here = known?.routesHere
  const [found, setFound] = useState<string | null>(null)
  const onFound = useCallback(() => setFound(facility?.id ?? null), [facility?.id])
  const [received, setReceived] = useState<string | null>(null)
  useEffect(() => { if (flag === true) setReceived(page) }, [flag, page])
  const listed = Boolean(read.value?.items.some(item => item.orderRoute))
  const foundHere = found !== null && found === facility?.id
  const evidence = listed || foundHere
  const watching = session === 'yes' || received === page
  const accepting = flag !== undefined ? receivingHere(facility, service, flag) === 'yes'
    : session === 'yes' || (session === 'unknown' && evidence)
  const holds = here ? accepting || here.held || listed : accepting || (flag === false && (session === 'yes' || listed))
  const mounted = permitted && (flag === true || (flag === false
    ? (here ? here.waiting || foundHere : evidence) || watching
    : Boolean(here?.waiting) || (session !== 'no' && !(session === 'unknown' && read.value === null && read.loading))))
  return { mounted, probe: !accepting, watch: !accepting && watching, accepting, holds, receives: flag, onFound, onAnswer }
}

/** A work list whose cards carry the route's version comes from a backend that lets this facility end an order it accepted for the wrong person. */
export function useLearnWrongPatientServed(items: ReadonlyArray<{ orderRoute?: { version?: unknown } }> | null) {
  useEffect(() => {
    if (items?.some(item => typeof item.orderRoute?.version === 'number')) learnWrongPatientServed(true)
  }, [items])
}

/** A work list that answers `lateCorrection: true` lets "Correct an order that has ended" show. */
export function useLearnLateCorrectionServed(answer: unknown) {
  useEffect(() => {
    if (saysLateCorrection(answer)) learnLateCorrectionServed(true)
  }, [answer])
}

/** A work list that answers `cannotComplete: true` lets rows offer "We can't complete this order". */
export function useLearnCannotCompleteServed(answer: unknown) {
  useEffect(() => { learnCannotCompleteFrom(answer) }, [answer])
}

/** Said on the work-list cap once "can't complete" is served. */
export const CAP_CANNOT_COMPLETE = 'To end one you can’t complete, find it by its reference under “Correct an order that has ended”.'

interface RowSaid { routeId: string; mode: OrderEndingMode; text: string; before: unknown }

/**
 * What a row's ending form said before the list was read again, and the form it came from. If the new list no longer
 * offers that form, the words stay in the row with focus on them, or above the list when the row is gone.
 */
export function useRowSaid<T extends { id: string; orderRoute?: WorkItemOrderRoute }>(service: 'lab' | 'pharmacy',
  answer: { items: T[] } | null, refresh: () => Promise<void>, offers: (mode: OrderEndingMode, route: WorkItemOrderRoute) => boolean) {
  const [pending, setPending] = useState<RowSaid | null>(null)
  const [kept, setKept] = useState<{ routeId: string; text: string; target: string } | null>(null)
  const offering = useRef(offers)
  offering.current = offers
  useEffect(() => {
    if (!pending || answer === pending.before) return
    setPending(null)
    const item = answer?.items.find(entry => entry.orderRoute?.id === pending.routeId)
    if (item?.orderRoute && offering.current(pending.mode, item.orderRoute)) return
    setKept({ routeId: pending.routeId, text: pending.text, target: item ? `${service}-${item.id}-said` : `${service}-said` })
  }, [answer, pending, service])
  // Once said, focus moves to it in the commit that shows it: the form that said it is gone.
  useLayoutEffect(() => { if (kept) document.getElementById(kept.target)?.focus() }, [kept])
  const reread = useCallback(async (routeId: string, mode: OrderEndingMode, text?: string) => {
    setKept(null)
    if (text) setPending({ routeId, mode, text, before: answer })
    await refresh()
  }, [answer, refresh])
  const listed = Boolean(kept && answer?.items.some(entry => entry.orderRoute?.id === kept.routeId))
  return {
    rowSaid: (routeId: string | undefined) => kept && listed && kept.routeId === routeId ? kept.text : null,
    listSaid: kept && !listed ? kept.text : null,
    clear: () => setKept(null),
    reread,
  }
}

export function SaidAboveList({ id, text }: { readonly id: string; readonly text: string | null }) {
  return text ? <DeptNotice id={id} tone="critical" role="alert" tabIndex={-1}>{text}</DeptNotice> : null
}

/** Whether the ending kept this facility's reads (7 days after an accession), from its `readUntil`. */
export function readsKept(result: CannotCompleteEnding['result']): boolean {
  const until = result.readUntil ? Date.parse(result.readUntil) : Number.NaN
  return Number.isFinite(until) && until - Date.now() > 60 * 60 * 1000
}

/**
 * The orders a page ended because it couldn't complete them: each said until its own Close, newest first, for the
 * facility it was ended at; the last one's route; and the rows of such orders later withdrawn as accepted for the
 * wrong person, which the page no longer shows.
 */
export function useNotCompletedEndings(facilityId: string | undefined) {
  const [endings, setEndings] = useState<Array<CannotCompleteEnding & { facilityId: string }>>([])
  const [lastRouteId, setLastRouteId] = useState<string | null>(null)
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set())
  return {
    endings: endings.filter(ending => ending.facilityId === facilityId),
    lastRouteId,
    add: (ending: Omit<CannotCompleteEnding, 'key'>) => {
      if (!facilityId) return
      setEndings(current => [{ ...ending, key: endingKey(ending.result.route.id), facilityId }, ...current])
      setLastRouteId(ending.result.route.id)
    },
    close: (key: string) => setEndings(current => current.filter(ending => ending.key !== key)),
    corrected: (correction: LateCorrection) => {
      const before = correction.result.endedKindBefore ?? correction.result.route.endedKind
      if (before === 'receiving_unable') setDropped(current => new Set(current).add(correction.result.route.id))
    },
    shown: <T extends { orderRoute?: { id: string } }>(items: T[]) => dropped.size === 0 ? items
      : items.filter(item => !item.orderRoute || !dropped.has(item.orderRoute.id)),
  }
}

/** What the page says once an order is ended or an ended order withdrawn, until it is closed: one slot, above the list. */
export type Said = { facilityId: string; ending: WrongPatientEnding; correction?: undefined }
  | { facilityId: string; correction: LateCorrection; ending?: undefined }

export function SaidAboveTheList({ service, said, facilityId, onClose }: {
  readonly service: 'lab' | 'pharmacy'; readonly said: Said | null; readonly facilityId: string; readonly onClose: () => void
}) {
  if (said?.facilityId !== facilityId) return null
  return <DeptEmbedded>{said.correction
    ? <LateCorrectionDone id={`${service}-late-correction-done`} correction={said.correction} onClose={onClose} />
    : <WrongPatientEnded id={`${service}-wrong-patient-ended`} ending={said.ending} onClose={onClose} />}</DeptEmbedded>
}
