import { useEffect, useMemo, useState } from 'react'
import { Hourglass, Receipt as ReceiptIcon, Search, ShieldCheck, UserRound, Wallet } from 'lucide-react'
import { Badge, Button, Card, CardHeader, FilterTabs, Input, PageHeader, Select, timeAgo } from '../../../kasuwa/ui'
import { LoadingRows, PageState } from '../../../kasuwa/parts'
import { Drawer, Segmented } from '../../../kasuwa/interactive'
import { useDeptAccess } from '../parts/access'
import {
  commerce, DEFERRED_LABEL, SOURCE_LABEL, billName, healthIdEnding, searchTextRefused, BILLING_WORDS,
  type Bill, type BillSource, type HmoOwes, type ListPage, type OutstandingPage, type Payment, type PaymentSettings, type ReceiptData,
} from './api'
import { BillActions } from './BillActions'
import { BillBadge } from './BillBadge'
import { naira } from './money'
import { BILLING_OFF, NotSwitchedOn } from './NotSwitchedOn'
import { Receipt } from './Receipt'
import { TakePayment } from './TakePayment'
import { useCommerceRead } from './useCommerceRead'

type View = 'to_pay' | 'checking' | 'follows' | 'paid'
type Area = 'bills' | 'outstanding'
type SourceFilter = 'all' | BillSource


const pendingTransfer = (bill: Bill): Payment | undefined =>
  bill.payments.find(payment => payment.method === 'transfer' && payment.status === 'pending_check' && !payment.voided)

const inView: Readonly<Record<View, (bill: Bill) => boolean>> = {
  to_pay: bill => (bill.status === 'unpaid' || bill.status === 'part_paid') && bill.dueKobo > 0,
  checking: bill => pendingTransfer(bill) !== undefined,
  follows: bill => bill.status === 'deferred',
  paid: bill => bill.status === 'paid',
}

const daysWord = (days: number) => days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`

/**
 * Payments: the cashier's queue (hid-system BILL-1 bills, on docs/POINT_OF_CARE_SPEC.md §3). Bills to pay come first;
 * each card says who (the name and the last four of the Health ID, never the whole one), the bill number, what it is
 * for, the amount due, what an HMO is to pay, and Take payment. Transfers waiting for a check, bills that follow
 * (emergency, unknown patient) and paid bills sit behind their own tabs; a source filter (Visit, Pharmacy, Lab) and a
 * search by bill number, receipt number or name (never a Health ID or NIN) narrow it. A bill opens with what can be done
 * to it (BillActions). For billing officers, Outstanding balances: patients who owe and HMOs that owe.
 */
export function Payments() {
  const { facilityId, permissions } = useDeptAccess()
  const [area, setArea] = useState<Area>('bills')
  const canReport = permissions.includes('billing.report.read')
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Payments" description={area === 'bills' ? 'Bills waiting to be paid.' : 'Money still owed, oldest first.'} />
      {canReport ? <Segmented<Area> ariaLabel="Show" value={area} onChange={setArea} className="self-start"
        options={[{ value: 'bills', label: 'Bills' }, { value: 'outstanding', label: 'Outstanding balances' }]} /> : null}
      {facilityId ? area === 'outstanding' && canReport ? <Outstanding facilityId={facilityId} /> : <Bills facilityId={facilityId} /> : null}
    </div>
  )
}

function Bills({ facilityId }: { readonly facilityId: string }) {
  const { facility, permissions } = useDeptAccess()
  const [view, setView] = useState<View>('to_pay')
  const [source, setSource] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  // A Health ID or NIN is never searched for: said here, and nothing is sent.
  const refused = searchTextRefused(query)
  const searched = q.length >= 2 && !refused ? q : ''
  const [page, setPage] = useState(1)
  const [earlier, setEarlier] = useState<readonly Bill[]>([])
  useEffect(() => { setPage(1); setEarlier([]) }, [source, searched])
  const read = useCommerceRead<ListPage<Bill>>(`bills:${facilityId}:${source}:${searched}:${page}`,
    signal => commerce.bills(facilityId, { ...(source === 'all' ? {} : { source }), ...(searched ? { q: searched } : {}), page }, signal))
  const settings = useCommerceRead<PaymentSettings>(`settings:${facilityId}`, signal => commerce.paymentSettings(facilityId, signal))
  const [paying, setPaying] = useState<Bill | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [saved, setSaved] = useState<ReadonlyMap<string, Bill>>(new Map())

  const canTake = permissions.includes('billing.payment.record')
  // The list as read (with the pages before it), with each bill saved here since put in its place, so a card changes the
  // moment it is paid.
  const all = useMemo(() => {
    const seen = new Set<string>()
    return [...earlier, ...(read.data?.items ?? [])].filter(bill => !seen.has(bill.id) && Boolean(seen.add(bill.id)))
      .map(bill => saved.get(bill.id) ?? bill)
  }, [earlier, read.data, saved])
  const counts = useMemo(() => Object.fromEntries((Object.keys(inView) as View[]).map(key => [key, all.filter(inView[key]).length])) as Record<View, number>, [all])
  const shown = all.filter(inView[view])
  const remember = (bill: Bill) => setSaved(previous => new Map(previous).set(bill.id, bill))
  const viewing = viewingId ? all.find(bill => bill.id === viewingId) ?? saved.get(viewingId) ?? null : null

  if (read.status === 'off') return <NotSwitchedOn message={BILLING_OFF} />
  return <>
    <div className="flex flex-col gap-3 @3xl:flex-row @3xl:flex-wrap @3xl:items-center @3xl:justify-between">
      <FilterTabs<View> label="Bills" value={view} onChange={setView} options={[
        { value: 'to_pay', label: 'To pay', count: counts.to_pay },
        { value: 'checking', label: 'Waiting for check', count: counts.checking },
        { value: 'follows', label: 'Bill follows', count: counts.follows },
        { value: 'paid', label: 'Paid', count: counts.paid },
      ]} />
      <div className="flex flex-wrap gap-2">
        <Select aria-label="From" value={source} onChange={event => setSource(event.target.value as SourceFilter)} className="w-40">
          <option value="all">Every source</option>
          <option value="visit">{SOURCE_LABEL.visit}</option>
          <option value="pharmacy">{SOURCE_LABEL.pharmacy}</option>
          <option value="lab">{SOURCE_LABEL.lab}</option>
        </Select>
        <Input icon={Search} type="search" aria-label="Search by bill number, receipt number or name" placeholder="Bill, receipt or name"
          value={query} onChange={event => setQuery(event.target.value)} className="@3xl:w-72"
          aria-invalid={refused || undefined} aria-describedby={refused ? 'payments-search-refused' : undefined} />
      </div>
    </div>
    {refused ? <p id="payments-search-refused" role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{BILLING_WORDS.BILLING_SEARCH_TEXT_NOT_ALLOWED}</p> : null}
    <PageState loading={read.status === 'loading' && all.length === 0} error={read.status === 'error' && all.length === 0 ? read.error : null}
      hasData={all.length > 0 || read.data !== null} onRetry={read.reload} what="bills" rows={4}
      empty={shown.length === 0 ? {
        icon: ReceiptIcon,
        title: searched ? 'No bill matches that' : view === 'to_pay' ? 'Nothing to pay right now' : view === 'checking' ? 'No transfers waiting' : view === 'follows' ? 'No bills to follow' : 'No paid bills yet',
        description: searched ? 'Try the bill number, as on the slip (B-000412), the receipt number, or the start of the name.'
          : view === 'to_pay' ? 'Bills from check-in, the pharmacy and the lab show here as they are made.' : undefined,
      } : null}>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
        {shown.map(bill => (
          <BillCard key={bill.id} bill={bill}
            onPay={canTake && bill.dueKobo > 0 && bill.status !== 'void' && view !== 'checking' ? () => setPaying(bill) : null}
            onView={() => setViewingId(bill.id)} />
        ))}
      </ul>
    </PageState>
    {read.status === 'error' && all.length > 0 ? <p role="alert" className="m-0 text-[13px] text-danger-ink">{read.error}</p> : null}
    {read.data?.nextPage ? <Button className="self-center" loading={read.status === 'loading'}
      onClick={() => { setEarlier(all); setPage(read.data!.nextPage!) }}>Show older bills</Button> : null}

    <TakePayment open={paying !== null} bill={paying} onPaid={remember} onClose={() => setPaying(null)} />
    <BillDrawer facilityId={facilityId} bill={viewing} facilityName={facility?.name} settings={settings.data}
      onChanged={remember} onClose={() => setViewingId(null)} onPay={canTake ? bill => { setViewingId(null); setPaying(bill) } : null} />
  </>
}

/** One bill: the receipt-shaped bill, what can be done to it, and a payment's receipt to print. */
function BillDrawer({ facilityId, bill, facilityName, settings, onChanged, onClose, onPay }: {
  readonly facilityId: string; readonly bill: Bill | null; readonly facilityName?: string; readonly settings: PaymentSettings | null
  readonly onChanged: (bill: Bill) => void; readonly onClose: () => void; readonly onPay: ((bill: Bill) => void) | null
}) {
  const [printing, setPrinting] = useState<Payment | null>(null)
  const receipt = useCommerceRead<ReceiptData>(bill && printing ? `receipt:${facilityId}:${bill.id}:${printing.id}` : null,
    signal => commerce.receipt(facilityId, bill!.id, signal, printing!.id))
  const billId = bill?.id
  useEffect(() => { setPrinting(null) }, [billId])
  if (!bill) return null
  return <Drawer open onClose={onClose} title={`Bill ${bill.number}`} description={[billName(bill), healthIdEnding(bill.patient)].filter(Boolean).join(' · ')}
    footer={<>
      {onPay && bill.dueKobo > 0 && bill.status !== 'void' ? <Button variant="soft" icon={Wallet} onClick={() => onPay(bill)}>Take payment</Button> : null}
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
    <div className="flex flex-col gap-6">
      {printing ? receipt.status === 'loading' ? <LoadingRows rows={3} label="Loading the receipt" />
        : <>
          {receipt.status === 'error' ? <p role="alert" className="m-0 text-sm text-danger-ink">{receipt.error}</p> : null}
          <Receipt bill={bill} receipt={receipt.data} facilityName={facilityName} hmos={settings?.hmos} footer={settings?.receiptFooter} onDone={() => setPrinting(null)} />
        </>
        : <Receipt bill={bill} facilityName={facilityName} hmos={settings?.hmos} footer={settings?.receiptFooter} />}
      <BillActions bill={bill} onChanged={onChanged} onPrint={setPrinting} />
    </div>
  </Drawer>
}

function BillCard({ bill, onPay, onView }: {
  readonly bill: Bill; readonly onPay: (() => void) | null; readonly onView: () => void
}) {
  const lines = bill.lines.filter(line => !line.cancelled)
  const what = lines.map(line => line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name).join(', ')
  const waiting = pendingTransfer(bill)
  const ending = healthIdEnding(bill.patient)
  return (
    <Card as="li" className="flex min-w-0 flex-col">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-[1_1_10rem]">
            <p className="m-0 text-title-3 text-ink break-words">{billName(bill)}</p>
            <p className="m-0 text-caption text-ink-3">
              <span className="tabular">{bill.number}</span>
              {ending ? <> · <span className="whitespace-nowrap">{ending}</span></> : null}
              {' · '}{timeAgo(bill.createdAt)}
            </p>
          </div>
          <Badge size="sm" tone="neutral" className="max-w-full">{SOURCE_LABEL[bill.source] ?? 'Bill'}</Badge>
        </div>
        <p className="m-0 line-clamp-2 text-[13px] text-ink-2">{what || 'No items'}</p>
        {(bill.hmoCoveredKobo ?? 0) > 0 ? <p className="m-0 text-[13px] text-ink-2"><ShieldCheck className="mr-1 inline size-4 align-[-3px] text-ink-3" aria-hidden />
          HMO to pay <span className="font-medium text-ink tabular">{naira(bill.hmoCoveredKobo!)}</span></p> : null}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="m-0 text-caption text-ink-3">{bill.status === 'paid' ? 'Paid' : bill.status === 'deferred' ? 'To follow' : 'Due'}</p>
            <p className="m-0 text-[22px] leading-8 font-semibold tracking-[-0.01em] text-ink tabular">{naira(bill.status === 'paid' ? bill.paidKobo : bill.dueKobo)}</p>
          </div>
          {waiting ? <Badge size="sm" tone="info" icon={Hourglass}>Waiting for check</Badge>
            : bill.deferred ? <Badge size="sm" tone="info">Bill follows · {DEFERRED_LABEL[bill.deferred.reason] ?? 'Later'}</Badge>
              : <BillBadge bill={{ billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber ?? null }} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 [&>*]:flex-[1_1_auto] [&>*]:whitespace-nowrap">
        <Button onClick={onView}>Open bill</Button>
        {onPay ? <Button variant="soft" icon={Wallet} onClick={onPay}>Take payment</Button> : null}
      </div>
    </Card>
  )
}

/** Outstanding balances (BILL-1 §5): two tables, "Patients who owe" and "HMOs that owe". */
function Outstanding({ facilityId }: { readonly facilityId: string }) {
  const patients = useCommerceRead<OutstandingPage>(`outstanding:${facilityId}`, signal => commerce.outstanding(facilityId, {}, signal))
  const hmos = useCommerceRead<{ items: HmoOwes[] }>(`hmo-owes:${facilityId}`, signal => commerce.hmoReceivables(facilityId, signal))
  if (patients.status === 'off' || hmos.status === 'off') return <NotSwitchedOn message={BILLING_OFF} />
  return <div className="flex flex-col gap-5">
    <Card>
      <CardHeader as="h2" title="Patients who owe" icon={UserRound}
        description={patients.data ? <>Total still owed: <span className="font-semibold text-ink tabular">{naira(patients.data.totalDueKobo)}</span></> : undefined} />
      <PageState loading={patients.status === 'loading'} error={patients.status === 'error' ? patients.error : null} hasData={patients.data !== null}
        onRetry={patients.reload} what="what patients owe" rows={3}
        empty={patients.data && patients.data.items.length === 0 ? { icon: UserRound, title: 'Nobody owes anything' } : null}>
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead><tr className="text-caption text-ink-3">
              <th scope="col" className="py-2 pr-3 font-medium">Patient</th><th scope="col" className="py-2 pr-3 font-medium">Bills</th>
              <th scope="col" className="py-2 pr-3 font-medium">Oldest</th><th scope="col" className="py-2 text-right font-medium">Owed</th>
            </tr></thead>
            <tbody>
              {patients.data?.items.map((entry, index) => <tr key={entry.patient?.patientId ?? `counter-${index}`} className="border-t border-line align-top">
                <td className="py-2.5 pr-3 text-ink">{entry.patient?.displayName ?? 'Counter sales'}
                  {healthIdEnding(entry.patient) ? <span className="block text-caption text-ink-3">{healthIdEnding(entry.patient)}</span> : null}</td>
                <td className="py-2.5 pr-3 text-ink-2">{entry.bills.map(bill => bill.number).join(', ')}
                  {entry.bills.some(bill => bill.deferred) ? <span className="block text-caption text-ink-3">Bill follows</span> : null}</td>
                <td className="py-2.5 pr-3 text-ink-2 tabular">{daysWord(entry.oldestDays)}</td>
                <td className="py-2.5 text-right font-semibold text-ink tabular">{naira(entry.dueKobo)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </PageState>
    </Card>
    <Card>
      <CardHeader as="h2" title="HMOs that owe" icon={ShieldCheck} description="HMO cover waiting for a claim. Not money received." />
      <PageState loading={hmos.status === 'loading'} error={hmos.status === 'error' ? hmos.error : null} hasData={hmos.data !== null}
        onRetry={hmos.reload} what="what HMOs owe" rows={2}
        empty={hmos.data && hmos.data.items.length === 0 ? { icon: ShieldCheck, title: 'No HMO owes anything' } : null}>
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
            <thead><tr className="text-caption text-ink-3">
              <th scope="col" className="py-2 pr-3 font-medium">HMO</th><th scope="col" className="py-2 pr-3 font-medium">Covers</th>
              <th scope="col" className="py-2 pr-3 font-medium">Oldest</th><th scope="col" className="py-2 text-right font-medium">Owed</th>
            </tr></thead>
            <tbody>
              {hmos.data?.items.map(entry => <tr key={entry.hmoId} className="border-t border-line">
                <td className="py-2.5 pr-3 text-ink">{entry.hmoName}</td>
                <td className="py-2.5 pr-3 text-ink-2 tabular">{entry.count}</td>
                <td className="py-2.5 pr-3 text-ink-2 tabular">{daysWord(entry.oldestDays)}</td>
                <td className="py-2.5 text-right font-semibold text-ink tabular">{naira(entry.amountKobo)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </PageState>
    </Card>
  </div>
}
