import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, PackageCheck, Printer, ReceiptText, RotateCcw, Search, Wallet } from 'lucide-react'
import { ConfirmSheet, FormActions, PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Field, FilterTabs, Input, PageHeader, Textarea, cx, timeAgo, type Tone } from '../../../kasuwa/ui'
import { useToast } from '../../../kasuwa/toast'
import { useBluePage } from '../../frame/pageContext'
import { commerce, METHOD_LABEL, type Bill, type ListPage, type Payment, type PaymentSettings, type ReceiptData } from '../commerce/api'
import { naira } from '../commerce/money'
import { NOT_SWITCHED_ON } from '../commerce/NotSwitchedOn'
import { Receipt } from '../commerce/Receipt'
import { TakePayment } from '../commerce/TakePayment'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { useDeptAccess } from '../parts/access'
import { canGiveHealthId, GiveHealthId } from './saleAfter'

const LIST = '/provider/pharmacy/sales'
type When = 'today' | 'all'

/** The facility's day, as `GET bills?date=` takes it: today on this device. */
function localDay(at = new Date()): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}
const clock = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Money given back on a sale: its payments taken back (each recorded with the reason). */
const refundedOf = (bill: Bill) => bill.payments.filter(payment => payment.voided).reduce((sum, payment) => sum + payment.amountKobo, 0)

/** A sale's state in a word: Paid, Unpaid ₦x, Part paid, Bill follows, Refunded. */
function saleState(bill: Bill): { word: string; tone: Tone } {
  if (refundedOf(bill) > 0 && bill.paidKobo === 0) return { word: 'Refunded', tone: 'neutral' }
  switch (bill.status) {
    case 'paid': return { word: 'Paid', tone: 'success' }
    case 'part_paid': return { word: `Part paid · ${naira(bill.dueKobo)} due`, tone: 'warn' }
    case 'deferred': return { word: 'Bill follows', tone: 'info' }
    case 'void': return { word: 'Cancelled', tone: 'neutral' }
    default: return { word: `Unpaid · ${naira(bill.dueKobo)}`, tone: 'warn' }
  }
}

/**
 * Sales & receipts (POINT_OF_CARE_SPEC §3): the pharmacy's bills, today's first, as cards; search by name, bill or
 * receipt number; a sale opens (pharmacy/sales/:billId) to print its receipt again, take what is still due, give a refund
 * (a payment taken back with the reason) or give the customer a Health ID. The list's tab and search live on while a sale
 * is open.
 */
export function Sales() {
  const { rest } = useBluePage()
  const billId = decodeURIComponent(rest.replace(/\/+$/, ''))
  const [when, setWhen] = useState<When>('today')
  const [query, setQuery] = useState('')
  return billId ? <SaleRecord billId={billId} /> : <SalesList when={when} onWhen={setWhen} query={query} onQuery={setQuery} />
}

function SalesList({ when, onWhen, query, onQuery }: {
  readonly when: When; readonly onWhen: (next: When) => void; readonly query: string; readonly onQuery: (next: string) => void
}) {
  const { facilityId, permissions } = useDeptAccess()
  const canRead = permissions.includes('billing.bill.read')
  const [q, setQ] = useState(query.trim())
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  const date = when === 'today' ? localDay() : undefined
  const read = useCommerceRead<ListPage<Bill>>(facilityId && canRead ? `sales:${facilityId}:${date ?? ''}:${q}` : null,
    signal => commerce.bills(facilityId!, { source: 'pharmacy', date, q }, signal))
  const bills = useMemo(() => [...(read.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [read.data])
  const taken = bills.reduce((sum, bill) => sum + bill.paidKobo, 0)

  if (!facilityId || !canRead) return <div className="flex flex-col gap-6">
    <PageHeader title="Sales & receipts" />
    <Alert intent="info" title="You can’t see sales here">Your role needs permission to see bills.</Alert>
  </div>

  return <div className="flex flex-col gap-5">
    <PageHeader title="Sales & receipts" description={when === 'today' && read.status === 'ready'
      ? <><span className="tabular">{bills.length}</span> {bills.length === 1 ? 'sale' : 'sales'} today · <span className="font-medium text-ink tabular">{naira(taken)}</span> taken</> : undefined} />
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <FilterTabs<When> label="Which sales" value={when} onChange={onWhen} options={[{ value: 'today', label: 'Today' }, { value: 'all', label: 'All' }]} />
      <div className="relative min-w-0 sm:w-80">
        <label htmlFor="sales-search" className="sr-only">Search sales</label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
        <Input id="sales-search" type="search" value={query} autoComplete="off" placeholder="Name, bill or receipt number" className="h-11"
          style={{ paddingLeft: '2.5rem' }} onChange={event => onQuery(event.target.value)} />
      </div>
    </div>
    {read.status === 'error' && bills.length > 0 ? <Alert intent="error" size="sm" title="Couldn’t refresh sales"
      action={<Button size="sm" onClick={read.reload}>Try again</Button>}>{read.error}</Alert> : null}
    <PageState loading={read.status === 'loading'} error={bills.length ? null : read.error} hasData={bills.length > 0} onRetry={read.reload}
      what="sales" rows={4} empty={read.status !== 'loading' && bills.length === 0 ? (q
        ? { icon: Search, title: 'No sale matches that', description: 'Try the bill number as on the slip (B-000412), or part of the name.' }
        : { icon: ReceiptText, title: when === 'today' ? 'No sales yet today' : 'No sales yet', description: 'Sales from the counter and prescriptions show here.' }) : null}>
      <ul aria-label="Sales" className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">
        {bills.map(bill => <SaleCard key={bill.id} bill={bill} today={when === 'today'} />)}
      </ul>
    </PageState>
  </div>
}

function SaleCard({ bill, today }: { readonly bill: Bill; readonly today: boolean }) {
  const state = saleState(bill)
  const what = bill.lines.map(line => line.quantity > 1 ? `${line.quantity} × ${line.name}` : line.name).join(', ')
  return <li className="min-w-0">
    <Link to={`${LIST}/${encodeURIComponent(bill.id)}`}
      className="flex w-full items-start gap-3 rounded-2xl bg-surface p-4 text-left text-ink no-underline shadow-[var(--shadow-card)] ring-1 ring-line transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold text-ink">{bill.patient?.displayName ?? 'Walk-in'}</span>
            <span className="block text-[13px] font-normal text-ink-3">
              <span className="tabular">{bill.receiptNumber ?? bill.number}</span> · {today ? clock(bill.createdAt) : timeAgo(bill.createdAt)}
              {bill.patient?.healthId ? <> · <span className="tracking-[.04em]">{bill.patient.healthId}</span></> : null}
            </span>
          </span>
          <span className="shrink-0 text-[19px] font-semibold text-ink tabular">{naira(bill.totalKobo)}</span>
        </span>
        <span className="line-clamp-2 text-[14px] font-normal text-ink-2">{what || 'No items'}</span>
        <span><Badge size="sm" tone={state.tone}>{state.word}</Badge></span>
      </span>
      <ChevronRight className="mt-1 size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  </li>
}

/** One sale: its receipt, Print, Take payment while owed, Refund, and "Give them a Health ID". */
function SaleRecord({ billId }: { readonly billId: string }) {
  const { facilityId, facility, permissions } = useDeptAccess()
  const back = { to: LIST, label: 'Back to sales' }
  const read = useCommerceRead<Bill>(facilityId ? `bill:${facilityId}:${billId}` : null, signal => commerce.bill(facilityId!, billId, signal))
  const bill = read.data
  const receipt = useCommerceRead<ReceiptData>(facilityId && bill?.receiptNumber ? `receipt:${facilityId}:${billId}:${bill.version}` : null,
    signal => commerce.receipt(facilityId!, billId, signal))
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  const [paying, setPaying] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [handing, setHanding] = useState<{ busy: boolean; error: string; key: string }>({ busy: false, error: '', key: '' })
  const toast = useToast()

  if (!facilityId || !permissions.includes('billing.bill.read')) return <div className="flex flex-col gap-6">
    <PageHeader title="Sale" back={back} />
    <Alert intent="info" title="You can’t see sales here">Your role needs permission to see bills.</Alert>
  </div>
  if (!bill) return <div className="flex flex-col gap-6">
    <PageHeader title="Sale" back={back} />
    <PageState loading={read.status === 'loading'} error={read.status === 'error' ? read.error : null} hasData={false} onRetry={read.reload} what="the sale"
      empty={read.status === 'off' ? { icon: ReceiptText, title: 'No such sale', description: 'It may be at another facility.' } : null}>{null}</PageState>
  </div>

  const owed = (bill.status === 'unpaid' || bill.status === 'part_paid') && refundedOf(bill) === 0
  const canPay = owed && permissions.includes('billing.payment.record')
  // A counter sale paid (or set to follow) but not yet handed over: finish it here.
  const toHandOver = bill.handedOverAt === null && (bill.status === 'paid' || bill.status === 'deferred') && permissions.includes('pharmacy.dispensing.create')
  async function handOver() {
    if (!bill || !facilityId || handing.busy) return
    const key = handing.key || crypto.randomUUID()
    setHanding({ busy: true, error: '', key })
    const result = await commerce.handOverSale(facilityId, bill.id, key)
    if (result.ok) { read.replace(result.data.bill); setHanding({ busy: false, error: '', key: '' }); toast.success({ title: 'Handed over', message: `Bill ${bill.number}` }); return }
    setHanding({ busy: false, error: result.notAvailable ? NOT_SWITCHED_ON : result.error, key })
  }
  const refundable = bill.payments.filter(payment => !payment.voided)
  const canRefund = refundable.length > 0 && permissions.includes('billing.payment.void')
  const state = saleState(bill)

  return <div data-layout="column" className="mx-auto flex w-full max-w-2xl flex-col gap-5">
    <PageHeader back={back} title={<>{bill.patient?.displayName ?? 'Walk-in'}</>}
      description={<><span className="tabular">Bill {bill.number}</span> · {timeAgo(bill.createdAt)} · <Badge size="sm" tone={state.tone}>{state.word}</Badge></>} />
    <Receipt bill={bill} receipt={receipt.data} facilityName={facility?.name} hmos={settings.data?.hmos} footer={settings.data?.receiptFooter} />
    {refundedOf(bill) > 0 ? <ul aria-label="Refunds" className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-ink-2">
      {bill.payments.filter(payment => payment.voided).map(payment => <li key={payment.id}>
        Refunded <span className="font-medium text-ink tabular">{naira(payment.amountKobo)}</span> ({METHOD_LABEL[payment.method]}){payment.reason ? `: ${payment.reason}` : ''}</li>)}
    </ul> : null}
    {toHandOver ? <Alert intent="warning" title="Not handed over yet"
      action={<Button size="sm" icon={PackageCheck} aria-busy={handing.busy || undefined} aria-disabled={handing.busy || undefined} onClick={() => void handOver()}>
        {handing.busy ? 'Recording…' : 'Handed over'}</Button>}>{handing.error || 'Give the customer their items, then record it.'}</Alert> : null}
    {canGiveHealthId(bill, permissions) ? <GiveHealthId idBase="sale-hid" facilityId={facilityId} bill={bill} onAttached={read.replace} /> : null}
    <FormActions>
      {canRefund ? <Button variant="danger" icon={RotateCcw} onClick={() => setRefunding(true)}>Refund</Button> : null}
      <Button variant={canPay ? 'secondary' : 'primary'} size={canPay ? 'md' : 'lg'} icon={Printer} onClick={() => window.print()}>Print receipt</Button>
      {canPay ? <Button variant="primary" size="lg" icon={Wallet} onClick={() => setPaying(true)}>Take payment <span className="tabular">{naira(bill.dueKobo)}</span></Button> : null}
    </FormActions>
    <TakePayment open={paying} bill={bill} onPaid={read.replace} onClose={() => setPaying(false)} />
    {refunding ? <RefundSheet facilityId={facilityId} bill={bill} payments={refundable} onClose={() => setRefunding(false)}
      onRefunded={next => { read.replace(next); setRefunding(false) }} /> : null}
  </div>
}

/**
 * Refund: one payment on the sale taken back, with the reason (POST …/payments/:paymentId/void, billing.payment.void, as
 * POINT_OF_CARE_SPEC §3 has no refund of its own). Give the money back the way it came.
 */
function RefundSheet({ facilityId, bill, payments, onClose, onRefunded }: {
  readonly facilityId: string; readonly bill: Bill; readonly payments: readonly Payment[]
  readonly onClose: () => void; readonly onRefunded: (bill: Bill) => void
}) {
  const [paymentId, setPaymentId] = useState(payments[0]!.id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [key] = useState(() => crypto.randomUUID())
  const toast = useToast()
  const payment = payments.find(entry => entry.id === paymentId) ?? payments[0]!

  async function refund() {
    if (busy) return
    if (reason.trim().length < 5) { setError('Say why (at least 5 letters): it is kept with the sale.'); document.getElementById('refund-reason')?.focus(); return }
    setBusy(true); setError('')
    const result = await commerce.voidPayment(facilityId, bill.id, payment.id, `Refund: ${reason.trim()}`, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: 'Refund recorded', message: `${naira(payment.amountKobo)} · Bill ${bill.number}` }); onRefunded(result.data); return }
    setError(result.notAvailable ? NOT_SWITCHED_ON : result.error)
  }

  return <ConfirmSheet open onClose={onClose} title="Refund" destructive busy={busy} confirmLabel={`Refund ${naira(payment.amountKobo)}`} onConfirm={() => void refund()}
    subject={<p className="m-0 text-[14px] text-ink-2">{bill.patient?.displayName ?? 'Walk-in'} · Bill {bill.number}</p>}
    effect={<>Give back <strong className="tabular">{naira(payment.amountKobo)}</strong> paid by {METHOD_LABEL[payment.method]}.</>}
    undo="A refund can’t be undone. The sale shows it, with your name and the reason.">
    {payments.length > 1 ? <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-[13px] font-medium text-ink-2">Which payment?</legend>
      {payments.map(entry => <label key={entry.id} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset',
        entry.id === payment.id ? 'bg-brand-soft ring-brand-line' : 'ring-line-strong hover:bg-subtle')}>
        <input type="radio" name="refund-payment" checked={entry.id === payment.id} onChange={() => setPaymentId(entry.id)} className="m-0 size-5 shrink-0 accent-[var(--color-brand)]" />
        <span className="text-[15px] text-ink">{METHOD_LABEL[entry.method]} · <span className="tabular">{naira(entry.amountKobo)}</span></span>
      </label>)}
    </fieldset> : null}
    <Field label="Why?" htmlFor="refund-reason" error={error || undefined} errorId="refund-reason-error">
      <Textarea id="refund-reason" rows={2} value={reason} maxLength={300} aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'refund-reason-error' : undefined} onChange={event => { setReason(event.target.value); setError('') }} />
    </Field>
  </ConfirmSheet>
}
