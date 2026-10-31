import { EhrButton } from '@hid/ui/ehr'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter } from '../../../../staff/api'
import { refusalText } from '../../../../staff/fieldProblem'
import { ChartGate, type Chart } from '../../parts/chart'
import { Step, SubHeading } from '../../parts/Detail'
import { ErrorBox, Loading, RecordNotFound } from '../../parts/Notices'
import { Pager } from '../../parts/RecordTable'
import { StatusBadge } from '../../parts/StatusBadge'
import { useWorkspaceHref } from '../../parts/Workspace'
import { FIRST_PAGE, RESTARTED, readPage, type Cursors } from '../encounters'
import { CreateOrder } from './CreateOrder'
import { OrderPage } from './OrderPage'
import { FlashContext, KINDS, learnFrom, orderTitle, text, type Flash, type OrderKind } from './orders'
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

/** Today's notice beside a records list: the restart after a cursor EHR no longer accepts (status), or a failed page move (alert). */
type ListNotice = { readonly text: string; readonly alert: boolean }

interface OrderPage {
  /** The page shown, or null before the first read. */
  readonly items: readonly ClinicalRecord[] | null
  readonly error: string
  /** The cursors that led to the page shown, the first page's being none (FIRST_PAGE). */
  readonly cursors: Cursors
  /** The next page's cursor, or null on the last page. */
  readonly next: string | null
  readonly notice: ListNotice | null
  /** A page move is being read. */
  readonly busy: boolean
}

interface OrderList extends OrderPage {
  /** Shows the page these cursors lead to (today's "Record pages"). */
  readonly show: (cursors: Cursors) => void
}

const UNREAD: OrderPage = { items: null, error: '', cursors: FIRST_PAGE, next: null, notice: null, busy: false }

function itemsOf(answer: { items?: unknown } | null | undefined): readonly ClinicalRecord[] {
  return Array.isArray(answer?.items) ? answer.items as ClinicalRecord[] : []
}

/**
 * This encounter's orders of one kind, as today's page reads a records tab: newest first, 50 to a page, with the
 * cursors that led to the page shown (no re-check: today makes none). The first read is today's (no page argument);
 * moving between pages reads `{ cursor, fresh: false }` and keeps the page shown if it fails, saying so in `notice`;
 * a cursor EHR no longer accepts (400 INVALID_CURSOR) starts the list again with today's restart notice.
 */
function useOrderList(chart: Chart, encounterId: string, kind: OrderKind, allowed: boolean): OrderList {
  const [list, setList] = useState<OrderPage>(UNREAD)
  const { facilityId, patientId } = chart
  // Every read takes a number; only the latest may show its rows.
  const sequence = useRef(0)
  useEffect(() => {
    if (!allowed) return
    const run = ++sequence.current
    setList(UNREAD)
    staffApi.records(facilityId, patientId, encounterId, KINDS[kind].record).then(
      answer => {
        learnFrom(answer)
        if (run === sequence.current) setList({ ...UNREAD, items: itemsOf(answer), next: answer?.nextCursor ?? null })
      },
      caught => {
        if (run === sequence.current) setList({ ...UNREAD, items: [], error: caught instanceof Error ? caught.message : 'Records could not be loaded.' })
      },
    )
    return () => { sequence.current += 1 }
  }, [allowed, facilityId, patientId, encounterId, kind])

  const show = useCallback((cursors: Cursors) => {
    const run = ++sequence.current
    setList(current => ({ ...current, notice: null, busy: true }))
    readPage((cursor, fresh) => staffApi.records(facilityId, patientId, encounterId, KINDS[kind].record, { cursor, fresh }), cursors, false).then(
      result => {
        learnFrom(result.page)
        if (run !== sequence.current) return
        setList({
          items: itemsOf(result.page), error: '', cursors: result.cursors, next: result.page?.nextCursor ?? null,
          notice: result.restarted ? { text: RESTARTED, alert: false } : null, busy: false,
        })
      },
      caught => {
        if (run !== sequence.current) return
        setList(current => ({ ...current, busy: false, notice: { text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true } }))
      },
    )
  }, [facilityId, patientId, encounterId, kind])

  return useMemo(() => ({ ...list, show }), [list, show])
}

/**
 * One list's "Record pages" (today's pager, above the rows), with its notice, named by the list it pages. Shown only
 * when the list spans more than one page, or has something to say.
 */
function OrderListPages({ kind, list }: { kind: OrderKind; list: OrderList }) {
  const captionId = useId()
  const { cursors, next, notice, busy, show } = list
  const paged = cursors.length >= 2 || next !== null
  if (!paged && !notice) return null
  return (
    <div className="hid-ehr-clinical-orders-pages" role="group" aria-labelledby={captionId}>
      <p id={captionId} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{KINDS[kind].title}</p>
      {notice ? (
        notice.alert ? <ErrorBox>{notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{notice.text}</p>
      ) : null}
      {paged ? (
        <Pager
          page={cursors.length}
          busy={busy}
          onPrevious={cursors.length >= 2 ? () => show(cursors.slice(0, -1)) : undefined}
          onNext={next ? () => show([...cursors, next]) : undefined}
        />
      ) : null}
    </div>
  )
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
          never leads into a sample. */}
      {chart.canWrite && isDemoFacility(chart.facilityId) ? (
        <>
          <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('radiology', 'new'))}>Create radiology record</EhrButton></Step>
          <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('referrals', 'new'))}>Create referral network record</EhrButton></Step>
        </>
      ) : null}
      <p className="hid-ehr-clinical-note">{CONNECTED_ORDERS_NOTE}</p>
      {loading ? <Loading label="Loading records…" /> : null}
      {lists.map(({ kind, list }) => list.error ? <ErrorBox key={kind}>{list.error}</ErrorBox> : null)}
      {!loading && lists.map(({ kind, list }) => !list.error && list.items?.length === 0 && list.cursors.length < 2 && list.next === null
        ? <p key={kind} className="hid-ehr-clinical-orders-muted">{KINDS[kind].empty}</p> : null)}
      {/* Each list pages on its own, 50 to a page, as today's records tabs do. */}
      {lists.map(({ kind, list }) => <OrderListPages key={kind} kind={kind} list={list} />)}
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
