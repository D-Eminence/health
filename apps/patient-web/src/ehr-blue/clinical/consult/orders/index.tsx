import { EhrButton } from '@hid/ui/ehr'
import { useId, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { ClinicalRecord, Encounter } from '../../../../staff/api'
import { usesNovuBackend } from '../../../../backendContract'
import { ChartGate, type Chart } from '../../parts/chart'
import { Step } from '../../parts/Detail'
import { ErrorBox, Loading, RecordNotFound } from '../../parts/Notices'
import { StatusBadge } from '../../parts/StatusBadge'
import { useWorkspaceHref } from '../../parts/Workspace'
import { ListPaging } from '../Notes'
import { pagerProps, type RecordList } from '../records'
import { CreateOrder } from './CreateOrder'
import { OrderPage } from './OrderPage'
import { FlashContext, KINDS, orderTitle, patientWord, routeOf, text, type Flash, type OrderKind } from './orders'
import { routeStatus, routeStatusClass } from './Routing'
import { isDemoFacility } from '../../../blueFacilities'
import { useSampleCan } from '../../../frame/sampleAccess'

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
 * `:recordId/orders/*`, inside its <ChartProvider>: "new/pharmacy", "new/laboratory", "pharmacy/:orderId" and
 * "laboratory/:orderId". Emergency access never reaches them (ChartGate draws its read-only notice).
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
 * One order's row: its link and status and, for an order sent to another facility, today's words under the row for
 * where it went and where it stands (the OrderRoutePanel's heading and status line, Clinical.tsx:1889-1893,
 * OrderRoutes.tsx:384-387), read from the route summary the list already carries, so it costs no read. The rest of
 * that panel (what to do next, the reason it couldn't be completed, the wrong-patient notice, details and Withdraw) is
 * on the order's page. The reference stays there too: the row says no code.
 */
function OrderRow({ kind, record, to, patient }: { kind: OrderKind; record: ClinicalRecord; to: string; patient: string }) {
  const routeId = useId()
  // As today's list and the order page (rights.novu): only a novu backend's route, well formed (routeOf), is said.
  const route = usesNovuBackend() ? routeOf(record) : null
  const status = route ? routeStatus(route, patient) : null
  return (
    <li className="hid-ehr-clinical-history-row">
      <Link className="hid-ehr-clinical-link" to={to} aria-describedby={status ? routeId : undefined}>{KINDS[kind].title} · {orderTitle(kind, record)}</Link>
      <StatusBadge status={text(record.status) || 'unknown'} />
      {status ? (
        <div id={routeId} className="hid-ehr-clinical-orders-row-route">
          <p className="hid-ehr-clinical-orders-muted">{kind === 'laboratory' ? 'Sent to another laboratory' : 'Sent to a pharmacy'}</p>
          <p className={routeStatusClass(status.tone)}>{status.text}</p>
        </div>
      ) : null}
    </li>
  )
}

/**
 * The design's "Connected orders" inside an encounter's "Available actions" card: "Create pharmacy record" and
 * "Create laboratory record" (today's prescription and lab request, with today's permissions and write access),
 * "Create radiology record" and "Create referral network record" (sample workspaces: no backend, nothing of this
 * patient carried), the design's note, and this encounter's orders, each linking to its page. The orders are the visit
 * page's own lists (`lists`), so what it reads again after a change (a cancelled or entered-in-error consultation
 * changes its orders) is what this card shows, and each list is read once.
 */
export function EncounterOrders({ chart, encounter, lists: orders }: { chart: Chart; encounter: Encounter; lists: OrderLists }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const readRx = chart.can(KINDS.pharmacy.read)
  const readLab = chart.can(KINDS.laboratory.read)
  const sampleCan = useSampleCan()
  if (chart.purpose !== 'direct-care') return null

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
      {createRx ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'pharmacy'))}>New prescription</EhrButton></Step> : null}
      {createLab ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'laboratory'))}>New lab request</EhrButton></Step> : null}
      {/* Radiology and referrals are samples: offered only at the demo facilities, so a live page at a real facility
          never leads into a sample; each only to a design role that may create there (sampleAccess.ts), as a role
          the sample is closed to would land on Home instead. */}
      {chart.canWrite && isDemoFacility(chart.facilityId) ? (
        <>
          {sampleCan('radiology', 'create') ? <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('radiology', 'new'))}>New radiology request</EhrButton></Step> : null}
          {sampleCan('referrals', 'create') ? <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('referrals', 'new'))}>New referral</EhrButton></Step> : null}
        </>
      ) : null}
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
