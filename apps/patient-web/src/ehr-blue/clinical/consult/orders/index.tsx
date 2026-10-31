import { EhrButton } from '@hid/ui/ehr'
import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter } from '../../../../staff/api'
import { ChartGate, type Chart } from '../../parts/chart'
import { Step, SubHeading } from '../../parts/Detail'
import { ErrorBox, Loading, RecordNotFound } from '../../parts/Notices'
import { StatusBadge } from '../../parts/StatusBadge'
import { useWorkspaceHref } from '../../parts/Workspace'
import { CreateOrder } from './CreateOrder'
import { OrderPage } from './OrderPage'
import { FlashContext, KINDS, learnFrom, orderTitle, text, type Flash, type OrderKind } from './orders'
import { isDemoFacility } from '../../../blueFacilities'
import { useSampleCan } from '../../../frame/sampleAccess'

export type { OrderKind } from './orders'

/** The design's note under "Connected orders". */
export const CONNECTED_ORDERS_NOTE = 'Patient and encounter carry into each order. Sign the encounter before issuing orders; investigations retain their own lifecycle.'

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

type OrderList = { readonly items: readonly ClinicalRecord[] | null; readonly error: string }

const UNREAD: OrderList = { items: null, error: '' }

/** This encounter's orders of one kind, read as today's page first reads a records tab (no re-check: today makes none). */
function useOrderList(chart: Chart, encounterId: string, kind: OrderKind, allowed: boolean): OrderList {
  const [list, setList] = useState<OrderList>(UNREAD)
  const { facilityId, patientId } = chart
  useEffect(() => {
    if (!allowed) return
    let active = true
    setList(UNREAD)
    staffApi.records(facilityId, patientId, encounterId, KINDS[kind].record).then(
      answer => {
        learnFrom(answer)
        if (active) setList({ items: Array.isArray(answer?.items) ? answer.items : [], error: '' })
      },
      caught => { if (active) setList({ items: [], error: caught instanceof Error ? caught.message : 'Records could not be loaded.' }) },
    )
    return () => { active = false }
  }, [allowed, facilityId, patientId, encounterId, kind])
  return list
}

/**
 * The design's "Connected orders" inside an encounter's "Available actions" card: "Create pharmacy record" and
 * "Create laboratory record" (today's prescription and lab request, with today's permissions and write access),
 * "Create radiology record" and "Create referral network record" (sample workspaces: no backend, nothing of this
 * patient carried), the design's note, and this encounter's orders, each linking to its page.
 */
export function EncounterOrders({ chart, encounter }: { chart: Chart; encounter: Encounter }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const sampleCan = useSampleCan()
  const readRx = chart.can(KINDS.pharmacy.read)
  const readLab = chart.can(KINDS.laboratory.read)
  const prescriptions = useOrderList(chart, encounter.id, 'pharmacy', readRx && chart.purpose === 'direct-care')
  const labs = useOrderList(chart, encounter.id, 'laboratory', readLab && chart.purpose === 'direct-care')
  if (chart.purpose !== 'direct-care') return null

  const createRx = chart.canWrite && chart.can(KINDS.pharmacy.write)
  const createLab = chart.canWrite && chart.can(KINDS.laboratory.write)
  const lists = [
    ...(readRx ? [{ kind: 'pharmacy' as const, list: prescriptions }] : []),
    ...(readLab ? [{ kind: 'laboratory' as const, list: labs }] : []),
  ]
  const loading = lists.some(({ list }) => list.items === null)
  const rows = lists.flatMap(({ kind, list }) => (list.items ?? []).map(record => ({ kind, record })))

  return (
    <div className="hid-ehr-clinical-orders-connected">
      <SubHeading>Connected orders</SubHeading>
      {createRx ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'pharmacy'))}>Create pharmacy record</EhrButton></Step> : null}
      {createLab ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'laboratory'))}>Create laboratory record</EhrButton></Step> : null}
      {/* Radiology and referrals are samples: offered only at the demo facilities, so a live page at a real facility
          never leads into a sample; each only to a design role that may create there (sampleAccess.ts), as a role
          the sample is closed to would land on Home instead. */}
      {chart.canWrite && isDemoFacility(chart.facilityId) ? (
        <>
          {sampleCan('radiology', 'create') ? <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('radiology', 'new'))}>Create radiology record</EhrButton></Step> : null}
          {sampleCan('referrals', 'create') ? <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('referrals', 'new'))}>Create referral network record</EhrButton></Step> : null}
        </>
      ) : null}
      <p className="hid-ehr-clinical-note">{CONNECTED_ORDERS_NOTE}</p>
      {loading ? <Loading label="Loading records…" /> : null}
      {lists.map(({ kind, list }) => list.error ? <ErrorBox key={kind}>{list.error}</ErrorBox> : null)}
      {!loading && lists.map(({ kind, list }) => !list.error && list.items?.length === 0
        ? <p key={kind} className="hid-ehr-clinical-orders-muted">{KINDS[kind].empty}</p> : null)}
      {rows.length > 0 ? (
        <ul className="hid-ehr-clinical-history-list" aria-label="Orders from this encounter">
          {rows.map(({ kind, record }) => (
            <li key={`${kind}-${record.id}`} className="hid-ehr-clinical-history-row">
              <Link className="hid-ehr-clinical-link" to={href(orderPath(encounter.id, kind, record.id))}>{KINDS[kind].title} · {orderTitle(kind, record)}</Link>
              <StatusBadge status={text(record.status) || 'unknown'} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
