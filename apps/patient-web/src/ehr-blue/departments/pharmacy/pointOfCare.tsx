import { useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Clock, PackageX, RotateCcw, Wallet } from 'lucide-react'
import { ConfirmSheet, FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Card, CardHeader, cx } from '../../../kasuwa/ui'
import { commerce, type Bill, type PaymentSettings, type WorkItemBill } from '../commerce/api'
import { BillBadge } from '../commerce/BillBadge'
import { naira } from '../commerce/money'
import { NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { TakePayment } from '../commerce/TakePayment'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { DrugTile } from './DrugTile'
import type { DrugForm } from './drugForm'
import { summaryOf, type WorkItemStock } from './pocFields'

/*
 * Point of care in the pharmacy and lab flows (docs/POINT_OF_CARE_SPEC.md): what a work item carries of its bill and
 * stock, the facility's payment setup, a drug's picture, and the payment step that stands where Dispense (or Collect
 * sample) would be until the bill is paid or set to follow. The routes are proposed; a 404 says so and nothing pretends.
 */

/** The facility's payment setup (§1), read once per facility. `off` (404): payments aren't on, and nothing is gated. */
export function usePaymentSettings(facilityId: string | undefined) {
  return useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
}

/** A drug's picture when the price list has one, else its form drawn. Decorative: the name is beside it. */
export function ItemCover({ imageUrl, form, size = 'md' }: { readonly imageUrl?: string | null; readonly form: DrugForm; readonly size?: 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  if (!imageUrl || broken) return <DrugTile form={form} size={size} />
  return <img src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)}
    className={cx('shrink-0 rounded-xl bg-white object-contain ring-1 ring-inset ring-line', size === 'lg' ? 'size-24' : 'size-[72px]')} />
}

/** Stock on hand in words with an icon: "In stock: 240 capsules", "Only 4 packs left", "Out of stock". */
export function StockLine({ stock, low = 5, className }: { readonly stock: WorkItemStock; readonly low?: number; readonly className?: string }) {
  const out = stock.onHand <= 0
  const few = !out && stock.onHand <= low
  return <span className={cx('inline-flex items-center gap-1.5 text-[13px] font-medium tabular', out ? 'text-danger-ink' : few ? 'text-warn-ink' : 'text-ink-2', className)}>
    {out ? <PackageX className="size-4 shrink-0" aria-hidden /> : null}
    {out ? 'Out of stock' : few ? `Only ${stock.onHand} ${stock.unit} left` : `In stock: ${stock.onHand} ${stock.unit}`}
  </span>
}

const REASON_WORD: Readonly<Record<'emergency' | 'inpatient', string>> = { emergency: 'Emergency', inpatient: 'Inpatient (on the ward)' }

/**
 * The payment step, in place of Dispense or Collect sample while the bill is owed and payment comes first:
 * - where the counter takes payment (counter or both), "Take payment" opens the payment drawer;
 * - where a cashier does (cashier or both), "Send to cashier" with the bill's number and amount, and "Check again";
 * - "Bill follows" serves an emergency or inpatient now and bills afterwards, with billing.bill.defer, confirmed with
 *   the reason.
 * Once the bill is paid or set to follow, `onCleared` hears its summary and the work goes on.
 */
export function PaymentStep({ facilityId, summary, settings, permissions, subject, verb, headingId, onCleared }: {
  readonly facilityId: string
  readonly summary: NonNullable<WorkItemBill>
  readonly settings: PaymentSettings
  readonly permissions: readonly string[]
  /** Who the bill is for (the compact patient banner), for the Bill follows confirm. */
  readonly subject: ReactNode
  /** What waits for payment, as a verb: "dispense", "take the sample". */
  readonly verb: string
  readonly headingId: string
  readonly onCleared: (summary: NonNullable<WorkItemBill>) => void
}) {
  const read = useCommerceRead<Bill>(`bill:${facilityId}:${summary.billId}`, signal => commerce.bill(facilityId, summary.billId, signal))
  const bill = read.data
  const [paying, setPaying] = useState(false)
  const [checking, setChecking] = useState(false)
  const [said, setSaid] = useState('')
  const [deferring, setDeferring] = useState(false)
  const [deferBusy, setDeferBusy] = useState(false)
  const [deferError, setDeferError] = useState('')
  const [deferOff, setDeferOff] = useState(false)
  const allowedReasons = settings.allowDeferredFor
  const [reason, setReason] = useState<'emergency' | 'inpatient' | ''>('')
  // One key per Bill follows sheet opened: a retry after a lost answer sends the same request again.
  const deferKey = useRef('')
  // The bill as the payment drawer saved it, until the drawer closes.
  const paid = useRef<Bill | null>(null)

  const counter = settings.wherePaid !== 'cashier'
  const cashier = settings.wherePaid !== 'counter'
  const canTake = counter && permissions.includes('billing.payment.record')
  const canDefer = allowedReasons.length > 0 && permissions.includes('billing.bill.defer')
  const due = bill?.dueKobo ?? summary.dueKobo
  const number = bill?.number

  function cleared(next: Bill) {
    if (next.status === 'paid' || next.status === 'deferred' || next.status === 'void') onCleared(summaryOf(next))
    else setSaid(next.status === 'part_paid' ? `Part paid. ${naira(next.dueKobo)} still due.` : `Not paid yet. ${naira(next.dueKobo)} still due.`)
  }

  async function checkAgain() {
    if (checking) return
    setChecking(true); setSaid('')
    const result = await commerce.bill(facilityId, summary.billId)
    setChecking(false)
    if (result.ok) { read.replace(result.data); cleared(result.data) }
    else if (result.notAvailable) setSaid('Payments aren’t switched on for this facility yet.')
    else setSaid(result.error)
  }

  function openDefer() {
    deferKey.current = crypto.randomUUID()
    setReason(allowedReasons.length === 1 ? allowedReasons[0]! : '')
    setDeferError(''); setDeferring(true)
  }
  async function defer() {
    if (deferBusy) return
    if (!reason) { setDeferError('Choose why it is served now.'); return }
    setDeferBusy(true); setDeferError('')
    const result = await commerce.deferBill(facilityId, summary.billId, reason, deferKey.current)
    setDeferBusy(false)
    if (result.ok) { setDeferring(false); read.replace(result.data); onCleared(summaryOf(result.data)); return }
    if (result.notAvailable) { setDeferring(false); setDeferOff(true); return }
    setDeferError(result.error)
  }

  if (read.status === 'off') return <Card><div className="p-5"><NotSwitchedOn /></div></Card>

  const take = canTake ? <Button variant="primary" size="lg" icon={Wallet} onClick={() => { setSaid(''); setPaying(true) }}>Take payment</Button> : null
  const check = cashier || !canTake ? <Button variant={take ? 'secondary' : 'primary'} size={take ? 'md' : 'lg'} icon={RotateCcw}
    aria-busy={checking || undefined} aria-disabled={checking || undefined} onClick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</Button> : null
  const follows = canDefer && !deferOff ? <Button icon={Clock} onClick={openDefer}>Bill follows</Button> : null

  return <Card>
    <CardHeader as="h2" titleId={headingId} title="Payment first" icon={Wallet} iconTone="warn"
      description={`Paid bills only. Take payment, then ${verb}.`} actions={<BillBadge bill={summary} />} />
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-ink-3">Amount due</p>
          <p className="m-0 text-[28px] font-semibold leading-tight text-ink tabular">{naira(due)}</p>
        </div>
        {number && !cashier ? <p className="m-0 text-[15px] font-medium text-ink-2 tabular">Bill {number}</p> : null}
      </div>
      {read.status === 'error' && !bill ? <Alert intent="error" title="Couldn’t load the bill" size="sm"
        action={<Button size="sm" icon={RotateCcw} onClick={read.reload}>Try again</Button>}>{read.error}</Alert> : null}
      {cashier ? <div className="rounded-lg bg-subtle px-4 py-3 ring-1 ring-inset ring-line">
        <p className="m-0 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">{take ? 'Or send to cashier' : 'Send to cashier'}</p>
        <p className="m-0 mt-1 text-[19px] font-semibold text-ink tabular">Bill {number ?? '…'} · {naira(due)}</p>
        <p className="m-0 mt-1 text-[14px] text-ink-2">Ask the patient to pay at the cashier with this bill number. Then check again.</p>
      </div> : null}
      {!counter || canTake ? null : <p className="m-0 text-[14px] text-ink-2">Your role can’t take payments. Ask a colleague who can, then check again.</p>}
      {deferOff ? <NotSwitchedOn compact message="Bill follows isn’t switched on for this facility yet." /> : null}
      <div role="status" aria-live="polite">{said ? <p className="m-0 text-[14px] font-medium text-warn-ink">{said}</p> : null}</div>
      <FormActions sticky={false}>{follows}{take ? check : null}{take ?? check}</FormActions>
    </div>
    {/* The drawer shows the receipt after saving: the work goes on once it is closed (Done), not under it. */}
    <TakePayment open={paying} bill={bill ?? summary} onPaid={next => { paid.current = next; read.replace(next) }}
      onClose={() => { setPaying(false); const next = paid.current; paid.current = null; if (next) cleared(next) }} />
    <ConfirmSheet open={deferring} onClose={() => setDeferring(false)} title="Serve now, bill follows" subject={subject}
      effect={<>Serve now and bill afterwards? Bill {number ?? ''} for <strong className="tabular">{naira(due)}</strong> stays open.</>}
      undo="The bill stays on the patient’s account and shows under Bill follows until it is paid."
      confirmLabel="Serve now" busy={deferBusy} onConfirm={() => void defer()}>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={deferError ? 'poc-defer-error' : undefined}>
        <legend className="mb-1 p-0 text-[13px] font-medium text-ink-2">Why now?</legend>
        {allowedReasons.map(option => <label key={option} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset',
          reason === option ? 'bg-brand-soft ring-brand-line' : 'ring-line-strong hover:bg-subtle')}>
          <input type="radio" name="poc-defer-reason" value={option} checked={reason === option} onChange={() => { setReason(option); setDeferError('') }}
            className="m-0 size-5 shrink-0 accent-[var(--color-brand)]" />
          <span className="text-[15px] text-ink">{REASON_WORD[option]}</span>
        </label>)}
        {deferError ? <p id="poc-defer-error" role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{deferError}</p> : null}
      </fieldset>
    </ConfirmSheet>
  </Card>
}

/** After the payment step: said once, where the step stood. */
export function PaidLine({ summary }: { readonly summary: NonNullable<WorkItemBill> }) {
  return <p className="m-0 inline-flex items-center gap-2 text-[14px] font-medium text-success-ink">
    <CircleCheck className="size-4" aria-hidden />
    {summary.status === 'deferred' ? 'Bill follows. You can go on.' : `Paid${summary.receiptNumber ? `, receipt ${summary.receiptNumber}` : ''}. You can go on.`}
  </p>
}
