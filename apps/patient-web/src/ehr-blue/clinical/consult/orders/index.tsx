import { EhrButton } from '@hid/ui/ehr'
import { useId, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { ClinicalRecord, Encounter } from '../../../../staff/api'
import { usesNovuBackend } from '../../../../backendContract'
import { ChartGate, type Chart } from '../../parts/chart'
import { ErrorBox, Loading, RecordNotFound } from '../../parts/Notices'
import { StatusBadge } from '../../parts/StatusBadge'
import { useWorkspaceHref } from '../../parts/Workspace'
import { ListPaging } from '../Notes'
import { pagerProps, type RecordList } from '../records'
import { CreateOrder } from './CreateOrder'
import { OrderPage } from './OrderPage'
import { formatWhen } from '../../parts/format'
import { FlashContext, KINDS, orderDetail, orderTitle, patientWord, routeOf, text, type Flash, type OrderKind } from './orders'
import { ownProgressText } from './progress'
import { RouteNotices, routeStatus, routeStatusClass } from './Routing'
import { isDemoFacility } from '../../../blueFacilities'
import { useSampleCan } from '../../../frame/sampleAccess'
import { NewReferral } from '../../../departments/referrals/NewReferral'
import { ENCOUNTER_WRITE, REFERRAL_SEND, useReferralsServed } from '../../../departments/referrals/referralRules'

export type { OrderKind } from './orders'

/** The note under the order buttons. */
export const CONNECTED_ORDERS_NOTE = 'Each order is for this patient and this consultation. Sign the note before you send orders.'

/** The address of one order's page, below the consultation workspace: `{encounterId}/orders/{kind}/{orderId}` (record ids only). */
export function orderPath(encounterId: string, kind: OrderKind, orderId: string): string {
  return `${encounterId}/orders/${kind}/${orderId}`
}

/**
 * Orders raised from an encounter: prescriptions and lab requests, sending them to Pharmacy, Lab or a pharmacy or
 * laboratory at another facility, and what the receiving facility reported. Mounted by the consultation workspace at
 * `:recordId/orders/*`, inside its <ChartProvider>: "new/pharmacy", "new/laboratory", "new/referral" (hid-system REF-1),
 * "pharmacy/:orderId" and "laboratory/:orderId". Emergency access never reaches them (ChartGate draws its read-only notice).
 */
export function EncounterOrderPages() {
  const { recordId = '' } = useParams()
  return <ChartGate>{chart => <OrderPages chart={chart} encounterId={recordId} />}</ChartGate>
}

function OrderPages({ chart, encounterId }: { chart: Chart; encounterId: string }) {
  const href = useWorkspaceHref()
  const [flash, setFlash] = useState<Flash | null>(null)
  const value = useMemo(() => ({ flash, setFlash }), [flash])
  return (
    <FlashContext.Provider value={value}>
      <Routes>
        <Route path="new/pharmacy" element={<CreateOrder kind="pharmacy" chart={chart} encounterId={encounterId} />} />
        <Route path="new/laboratory" element={<CreateOrder kind="laboratory" chart={chart} encounterId={encounterId} />} />
        {/* A referral to another facility, or a printed letter (hid-system REF-1): it opens on the Referrals page once sent. */}
        <Route path="new/referral" element={<NewReferral chart={chart} encounterId={encounterId} />} />
        <Route path="pharmacy/:orderId" element={<OrderRoute kind="pharmacy" chart={chart} encounterId={encounterId} />} />
        <Route path="laboratory/:orderId" element={<OrderRoute kind="laboratory" chart={chart} encounterId={encounterId} />} />
        <Route path="*" element={<RecordNotFound backHref={href(encounterId)} />} />
      </Routes>
    </FlashContext.Provider>
  )
}

function OrderRoute({ kind, chart, encounterId }: { kind: OrderKind; chart: Chart; encounterId: string }) {
  const { orderId = '' } = useParams()
  return <OrderPage key={orderId} kind={kind} chart={chart} encounterId={encounterId} orderId={orderId} />
}

/** This visit's orders of each kind, as the visit page reads them (consult/records.ts useRecordList). */
export type OrderLists = Readonly<Record<OrderKind, RecordList<ClinicalRecord>>>

/**
 * One list's "Record pages" (today's pager, above the rows), with its notice, named by the list it pages. Shown only
 * when the list spans more than one page, or has something to say.
 */
function OrderListPages({ kind, list }: { kind: OrderKind; list: RecordList<ClinicalRecord> }) {
  const captionId = useId()
  if (!pagerProps(list) && !list.notice) return null
  return (
    <div className="hid-ehr-clinical-orders-pages" role="group" aria-labelledby={captionId}>
      <p id={captionId} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{KINDS[kind].title}</p>
      <ListPaging list={list} />
    </div>
  )
}

/**
 * One order's row, as classic's list row (staff/routes/Clinical.tsx:1818-1852): its link and status, classic's detail
 * line (frequency; priority, with no test code: the row says no code) and when it was recorded, and, for an order sent to another facility,
 * classic's OrderRoutePanel words under it (OrderRoutes.tsx:384-393): where it went and where it stands, what to do
 * next, why it couldn't be completed, and the wrong-patient and late reports (RouteNotices), all read from the route
 * summary the list already carries, so it costs no read. Its own pharmacy or laboratory progress (ORD-3) is a line
 * under it, from the same list read. The details, Withdraw and the order's other changes are on the order's page; the
 * reference stays there too.
 */
function OrderRow({ kind, record, to, patient }: { kind: OrderKind; record: ClinicalRecord; to: string; patient: string }) {
  const routeId = useId()
  const progressId = useId()
  // As today's list and the order page (rights.novu): only a novu backend's route, well formed (routeOf), is said.
  const route = usesNovuBackend() ? routeOf(record) : null
  const status = route ? routeStatus(route, patient) : null
  const detail = orderDetail(kind, record)
  const recorded = formatWhen(text(record.createdAt))
  // Where it is in this facility's own pharmacy or laboratory (ORD-3), on a line of its own; nothing when not sent here.
  const progress = ownProgressText(kind, record)
  const describedBy = [status ? routeId : '', progress ? progressId : ''].filter(Boolean).join(' ')
  return (
    <li className="hid-ehr-clinical-history-row">
      <span>
        <Link className="hid-ehr-clinical-link" to={to} aria-describedby={describedBy || undefined}>{KINDS[kind].title} · {orderTitle(kind, record)}</Link>
        {detail ? <span className="hid-ehr-clinical-cell-sub">{detail}</span> : null}
        {recorded ? <span className="hid-ehr-clinical-cell-sub">Recorded: {recorded}</span> : null}
      </span>
      <StatusBadge status={text(record.status) || 'unknown'} />
      {progress ? <p id={progressId} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-row-progress">{progress}</p> : null}
      {route && status ? (
        <div id={routeId} className="hid-ehr-clinical-orders-row-route">
          <p className="hid-ehr-clinical-orders-muted">{kind === 'laboratory' ? 'Sent to another laboratory' : 'Sent to a pharmacy'}</p>
          <p className={routeStatusClass(status.tone)}>{status.text}</p>
          <RouteNotices route={route} patient={patient} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * The design's "Connected orders" inside an encounter's "Available actions" card: "Create pharmacy record" and
 * "Create laboratory record" (today's prescription and lab request, with today's permissions and write access),
 * "Create radiology record" (a sample workspace: no backend, nothing of this patient carried), "New referral" (hid-system
 * REF-1; the sample's at the demo facilities while Health ID does not serve referrals), the design's note, and this
 * encounter's orders, each linking to its page. The orders are the visit
 * page's own lists (`lists`), so what it reads again after a change (a cancelled or entered-in-error consultation
 * changes its orders) is what this card shows, and each list is read once.
 */
export function EncounterOrders({ chart, encounter, lists: orders }: { chart: Chart; encounter: Encounter; lists: OrderLists }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const readRx = chart.can(KINDS.pharmacy.read)
  const readLab = chart.can(KINDS.laboratory.read)
  const sampleCan = useSampleCan()
  const referralsServed = useReferralsServed()
  if (chart.purpose !== 'direct-care') return null
  // Referrals (hid-system REF-1): offered at every facility to doctors and clinicians while Health ID serves them; where it
  // does not (or for a role without the code), the demo facilities keep today's sample step.
  const liveReferral = chart.canWrite && chart.can(REFERRAL_SEND, ENCOUNTER_WRITE) && referralsServed !== false
  const sampleReferral = !liveReferral && chart.canWrite && isDemoFacility(chart.facilityId) && sampleCan('referrals', 'create')

  // As in classic, each create sits with its list: offered only where the saved order can be read back.
  const createRx = chart.canWrite && readRx && chart.can(KINDS.pharmacy.write)
  const createLab = chart.canWrite && readLab && chart.can(KINDS.laboratory.write)
  const lists = [
    ...(readRx ? [{ kind: 'pharmacy' as const, list: orders.pharmacy }] : []),
    ...(readLab ? [{ kind: 'laboratory' as const, list: orders.laboratory }] : []),
  ]
  // A first read under way; one that failed says so in its error box, not as loading.
  const loading = lists.some(({ list }) => list.items === null && list.loading)
  const rows = lists.flatMap(({ kind, list }) => (list.items ?? []).map(record => ({ kind, record })))
  // The patient as the order page and today's list name them in a route's words (Clinical.tsx:1431-1432).
  const patient = patientWord(chart)

  return (
    <div className="hid-ehr-clinical-orders-connected">
      {/* The ways to order, side by side, each with its icon (owner, 18 Nov 2026): one row, not a stack of boxes. */}
      <div className="hid-ehr-clinical-action-list">
        {createRx ? <EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'pharmacy'))}>New prescription</EhrButton> : null}
        {createLab ? <EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'laboratory'))}>New lab request</EhrButton> : null}
        {/* Radiology is a sample, and so is a referral where Health ID does not serve referrals yet: offered only at the
            demo facilities, so a live page at a real facility never leads into a sample; each only to a design role
            that may create there (sampleAccess.ts), as a role the sample is closed to would land on Home instead. */}
        {chart.canWrite && isDemoFacility(chart.facilityId) && sampleCan('radiology', 'create')
          ? <EhrButton variant="secondary" onClick={() => navigate(href.to('radiology', 'new'))}>New radiology request</EhrButton> : null}
        {liveReferral ? <EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'referral'))}>New referral</EhrButton>
          : sampleReferral ? <EhrButton variant="secondary" onClick={() => navigate(href.to('referrals', 'new'))}>New referral</EhrButton> : null}
      </div>
      {createRx || createLab ? <p className="hid-ehr-clinical-note">{CONNECTED_ORDERS_NOTE}</p> : null}
      {loading ? <Loading label="Loading records…" /> : null}
      {lists.map(({ kind, list }) => list.error ? <ErrorBox key={kind}>{list.error}</ErrorBox> : null)}
      {!loading && lists.map(({ kind, list }) => !list.error && list.items?.length === 0 && list.cursors.length < 2 && list.next === null
        ? <p key={kind} className="hid-ehr-clinical-orders-muted">{KINDS[kind].empty}</p> : null)}
      {/* Each list pages on its own, 50 to a page, as today's records tabs do. */}
      {lists.map(({ kind, list }) => <OrderListPages key={kind} kind={kind} list={list} />)}
      {rows.length > 0 ? (
        <ul className="hid-ehr-clinical-history-list" aria-label="Orders from this consultation">
          {rows.map(({ kind, record }) => (
            <OrderRow key={`${kind}-${record.id}`} kind={kind} record={record} to={href(orderPath(encounter.id, kind, record.id))} patient={patient} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
