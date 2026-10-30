import { EhrButton } from '@hid/ui/ehr'
import { useMemo, useState } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { Encounter } from '../../../../staff/api'
import { ChartGate, type Chart } from '../../parts/chart'
import { Step, SubHeading } from '../../parts/Detail'
import { RecordNotFound } from '../../parts/Notices'
import { useWorkspaceHref } from '../../parts/Workspace'
import { CreateOrder } from './CreateOrder'
import { OrderPage } from './OrderPage'
import { FlashContext, KINDS, type Flash, type OrderKind } from './orders'
import { isDemoFacility } from '../../../blueFacilities'

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

/**
 * The design's "Connected orders" inside an encounter's "Available actions" card: "Create pharmacy record" and
 * "Create laboratory record" (today's prescription and lab request, with today's permissions and write access),
 * "Create radiology record" and "Create referral network record" (sample workspaces: no backend, nothing of this
 * patient carried), and the design's note. The encounter's orders are listed in its Connected hospital history (with
 * their record pages past 50), each linking to its page, as the design lists them.
 */
export function EncounterOrders({ chart, encounter }: { chart: Chart; encounter: Encounter }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  if (chart.purpose !== 'direct-care') return null

  const createRx = chart.canWrite && chart.can(KINDS.pharmacy.write)
  const createLab = chart.canWrite && chart.can(KINDS.laboratory.write)

  return (
    <div className="hid-ehr-clinical-orders-connected">
      <SubHeading>Connected orders</SubHeading>
      {createRx ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'pharmacy'))}>Create pharmacy record</EhrButton></Step> : null}
      {createLab ? <Step><EhrButton variant="secondary" onClick={() => navigate(href(encounter.id, 'orders', 'new', 'laboratory'))}>Create laboratory record</EhrButton></Step> : null}
      {/* Radiology and referrals are samples: offered only at the demo facilities, so a live page at a real facility
          never leads into a sample. */}
      {chart.canWrite && isDemoFacility(chart.facilityId) ? (
        <>
          <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('radiology', 'new'))}>Create radiology record</EhrButton></Step>
          <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('referrals', 'new'))}>Create referral network record</EhrButton></Step>
        </>
      ) : null}
      <p className="hid-ehr-clinical-note">{CONNECTED_ORDERS_NOTE}</p>
    </div>
  )
}
