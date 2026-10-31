import { useMemo, useState } from 'react'
import { Hourglass, Receipt as ReceiptIcon, Search, Wallet } from 'lucide-react'
import { Badge, Button, Card, FilterTabs, Input, PageHeader, timeAgo } from '../../../kasuwa/ui'
import { ConfirmSheet, PageState } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, SOURCE_LABEL, type Bill, type ListPage, type Payment, type PaymentSettings } from './api'
import { BillBadge } from './BillBadge'
import { naira } from './money'
import { NotSwitchedOn } from './NotSwitchedOn'
import { Receipt } from './Receipt'
import { TakePayment } from './TakePayment'
import { useCommerceRead } from './useCommerceRead'
import { Drawer } from '../../../kasuwa/interactive'

type View = 'to_pay' | 'checking' | 'follows' | 'paid'

const pendingTransfer = (bill: Bill): Payment | undefined =>
  bill.payments.find(payment => payment.method === 'transfer' && payment.status === 'pending_check' && !payment.voided)

const inView: Readonly<Record<View, (bill: Bill) => boolean>> = {
  to_pay: bill => bill.status === 'unpaid' || bill.status === 'part_paid',
  checking: bill => pendingTransfer(bill) !== undefined,
  follows: bill => bill.status === 'deferred',
  paid: bill => bill.status === 'paid',
}

const matches = (bill: Bill, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [bill.number, bill.receiptNumber ?? '', bill.patient?.displayName ?? 'walk-in', bill.patient?.healthId ?? '']
    .some(text => text.toLowerCase().includes(q))
}

/**
 * Payments: the cashier's queue (docs/POINT_OF_CARE_SPEC.md §3). Bills to pay come first, newest last in the queue as
 * patients arrive; each card says who, the bill number, what it is for, the amount due, and Take payment. Transfers
 * waiting for a check, bills that follow (emergency, inpatient) and paid bills sit behind their own tabs.
 */
export function Payments() {
  const { facilityId, facility, permissions } = useDeptAccess()
  const bills = useCommerceRead<ListPage<Bill>>(facilityId ? `bills:${facilityId}` : null, signal => commerce.bills(facilityId!, {}, signal))
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  const [view, setView] = useState<View>('to_pay')
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState<Bill | null>(null)
  const [viewing, setViewing] = useState<Bill | null>(null)
  const [confirming, setConfirming] = useState<{ bill: Bill; payment: Payment } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [saved, setSaved] = useState<ReadonlyMap<string, Bill>>(new Map())
  const toast = useToast()

  const canTake = permissions.includes('billing.payment.record')
  const canConfirm = permissions.includes('billing.payment.confirm')
  // The list as read, with each bill saved here since put in its place, so a card changes the moment it is paid.
  const all = useMemo(() => (bills.data?.items ?? []).map(bill => saved.get(bill.id) ?? bill), [bills.data, saved])
  const counts = useMemo(() => Object.fromEntries((Object.keys(inView) as View[]).map(key => [key, all.filter(inView[key]).length])) as Record<View, number>, [all])
  const shown = all.filter(inView[view]).filter(bill => matches(bill, query))
  const remember = (bill: Bill) => setSaved(previous => new Map(previous).set(bill.id, bill))

  async function confirmTransfer() {
    if (!confirming || !facilityId) return
    setConfirmBusy(true)
    const result = await commerce.confirmPayment(facilityId, confirming.bill.id, confirming.payment.id)
    setConfirmBusy(false)
    if (result.ok) { remember(result.data); setConfirming(null); toast.success({ title: 'Transfer confirmed', message: `Bill ${result.data.number}` }); return }
    setConfirming(null)
    if (result.notAvailable) { toast.info({ title: 'Not switched on', message: 'Payments aren’t switched on for this facility yet.' }); return }
    toast.error({ title: 'Not confirmed', message: result.error })
  }

  const off = bills.status === 'off'
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Payments" description="Bills waiting to be paid. Health ID records each payment; the money itself goes through your till, POS or bank." />
      {off ? <NotSwitchedOn /> : <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs<View> label="Bills" value={view} onChange={setView} options={[
            { value: 'to_pay', label: 'To pay', count: counts.to_pay },
            { value: 'checking', label: 'Waiting for check', count: counts.checking },
            { value: 'follows', label: 'Bill follows', count: counts.follows },
            { value: 'paid', label: 'Paid', count: counts.paid },
          ]} />
          <Input icon={Search} type="search" aria-label="Search by name or bill number" placeholder="Name or bill number"
            value={query} onChange={event => setQuery(event.target.value)} className="sm:w-72" />
        </div>
        <PageState loading={bills.status === 'loading'} error={bills.status === 'error' ? bills.error : null} hasData={bills.data !== null}
          onRetry={bills.reload} what="bills" rows={4}
          empty={shown.length === 0 ? {
            icon: ReceiptIcon,
            title: query ? 'No bill matches that' : view === 'to_pay' ? 'Nothing to pay right now' : view === 'checking' ? 'No transfers waiting' : view === 'follows' ? 'No bills to follow' : 'No paid bills yet',
            description: query ? 'Try the bill number, as on the slip (B-000412), or part of the name.' : view === 'to_pay' ? 'Bills from the pharmacy and the lab show here as they are made.' : undefined,
          } : null}>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map(bill => (
              <BillCard key={bill.id} bill={bill}
                action={view === 'checking' && canConfirm ? () => { const payment = pendingTransfer(bill); if (payment) setConfirming({ bill, payment }) } : null}
                actionLabel={view === 'checking' ? 'Confirm transfer' : null}
                onPay={canTake && (bill.status === 'unpaid' || bill.status === 'part_paid') && view !== 'checking' ? () => setPaying(bill) : null}
                onView={() => setViewing(bill)} />
            ))}
          </ul>
        </PageState>
      </>}

      <TakePayment open={paying !== null} bill={paying} onPaid={remember} onClose={() => setPaying(null)} />

      <Drawer open={viewing !== null} onClose={() => setViewing(null)} title={viewing ? `Bill ${viewing.number}` : ''}
        description={viewing?.patient?.displayName ?? 'Walk-in (no name)'}
        footer={<Button variant="primary" onClick={() => setViewing(null)}>Done</Button>}>
        {viewing ? <Receipt bill={viewing} facilityName={facility?.name} hmos={settings.data?.hmos} footer={settings.data?.receiptFooter} /> : null}
      </Drawer>

      <ConfirmSheet open={confirming !== null} onClose={() => setConfirming(null)} busy={confirmBusy}
        title="Confirm this transfer?" confirmLabel="Money arrived"
        subject={confirming ? <p className="m-0 text-sm text-ink-2">{confirming.bill.patient?.displayName ?? 'Walk-in'} · Bill {confirming.bill.number} · ref {confirming.payment.reference ?? '—'}</p> : null}
        effect={confirming ? <>You checked the facility’s account and <span className="font-semibold tabular">{naira(confirming.payment.amountKobo)}</span> arrived with this reference.</> : ''}
        undo="Only confirm money you can see in the account."
        onConfirm={() => { void confirmTransfer() }} />
    </div>
  )
}

function BillCard({ bill, onPay, onView, action, actionLabel }: {
  readonly bill: Bill; readonly onPay: (() => void) | null; readonly onView: () => void
  readonly action: (() => void) | null; readonly actionLabel: string | null
}) {
  const what = bill.lines.map(line => line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name).join(', ')
  const waiting = pendingTransfer(bill)
  return (
    <Card as="li" className="flex flex-col">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-title-3 text-ink">{bill.patient?.displayName ?? 'Walk-in (no name)'}</p>
            <p className="m-0 text-caption text-ink-3">
              <span className="tabular">{bill.number}</span>
              {bill.patient?.healthId ? <> · <span className="tracking-[.04em]">{bill.patient.healthId}</span></> : null}
              {' · '}{timeAgo(bill.createdAt)}
            </p>
          </div>
          <Badge size="sm" tone="neutral">{SOURCE_LABEL[bill.source]}</Badge>
        </div>
        <p className="m-0 line-clamp-2 text-[13px] text-ink-2">{what || 'No items'}</p>
        <div className="mt-auto flex items-end justify-between gap-3">
          <div>
            <p className="m-0 text-caption text-ink-3">{bill.status === 'paid' ? 'Paid' : bill.status === 'deferred' ? 'To follow' : 'Due'}</p>
            <p className="m-0 text-[22px] leading-8 font-semibold tracking-[-0.01em] text-ink tabular">{naira(bill.status === 'paid' ? bill.paidKobo : bill.dueKobo)}</p>
          </div>
          {waiting ? <Badge size="sm" tone="info" icon={Hourglass}>Waiting for check</Badge>
            : <BillBadge bill={{ billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber ?? null }} />}
        </div>
      </div>
      <div className="flex gap-2 border-t border-line px-4 py-3 [&>*]:flex-1">
        <Button onClick={onView}>{bill.receiptNumber ? 'Receipt' : 'View bill'}</Button>
        {action && actionLabel ? <Button variant="soft" onClick={action}>{actionLabel}</Button>
          : onPay ? <Button variant="soft" icon={Wallet} onClick={onPay}>Take payment</Button> : null}
      </div>
    </Card>
  )
}
