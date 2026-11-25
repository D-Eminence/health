import { useId, useState, type ReactNode } from 'react'
import { Ban, CircleCheck, Clock, Plus, Printer, Undo2, X } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet } from '../../../kasuwa/parts'
import { Alert, Button, Field, Input, Select, Textarea } from '../../../kasuwa/ui'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, KIND_LABEL, METHOD_LABEL, billName, lagosTime, type Bill, type BillLine, type CatalogueItem, type CommerceResult, type HmoCover, type ListPage, type Payment } from './api'
import { naira } from './money'
import { NOT_SET_UP_UNSAVED } from './NotSwitchedOn'
import { useCommerceRead } from './useCommerceRead'

/**
 * What can be done to one bill (hid-system BILL-1), each behind the code the backend checks and through a confirmation
 * that says what it does: confirm a transfer arrived, cancel a payment (a refund is a cancelled payment with "Refund:
 * …", BILL-4), cancel HMO cover, add or cancel a line, "Bill follows" for an emergency, cancel a bill with nothing paid,
 * and print a payment's receipt. The backend refuses the person who took a payment from cancelling or confirming it
 * (SECOND_PERSON_REQUIRED); its words are shown as they come.
 */

type Sheet =
  | { kind: 'confirm'; payment: Payment }
  | { kind: 'void-payment'; payment: Payment }
  | { kind: 'cancel-cover'; cover: HmoCover }
  | { kind: 'cancel-line'; line: BillLine }
  | { kind: 'void-bill' }
  | { kind: 'defer' }
  | { kind: 'add-line' }

const REASON_MIN = 8
const REASON_MAX = 500

export function BillActions({ bill, onChanged, onPrint }: {
  readonly bill: Bill
  /** The bill as saved, put in its place at once. */
  readonly onChanged: (bill: Bill) => void
  /** Print one payment's receipt. */
  readonly onPrint?: (payment: Payment) => void
}) {
  const { permissions } = useDeptAccess()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const can = (code: string) => permissions.includes(code)
  const open = bill.status !== 'void'
  const payments = bill.payments.filter(payment => !payment.voided)
  const covers = (bill.hmoCovers ?? []).filter(cover => cover.status === 'pending_claim')
  const lines = bill.lines.filter(line => !line.cancelled)
  const reversed = lines.filter(line => line.dispensingReversed)
  const nothingTaken = payments.length === 0 && covers.length === 0

  return <section aria-labelledby={`bill-actions-${bill.id}`} className="flex flex-col gap-4">
    <h3 id={`bill-actions-${bill.id}`} className="m-0 text-title-3 text-ink">On this bill</h3>
    {bill.deferred ? <Alert size="sm" intent="info" title="Bill follows">
      {bill.deferred.reason === 'unknown_patient' ? 'An unknown patient: served first, billed when they are identified.'
        : bill.deferred.reason === 'emergency' ? 'An emergency: served first, billed later. It can still be paid.' : 'Admitted: billed at discharge.'}
    </Alert> : null}
    {open && reversed.length > 0 ? <Alert size="sm" intent="warning" live={false} title="Refund due">
      The dispensing of {reversed.map(line => line.name).join(', ')} was reversed after it was paid for. Refund the payment,
      then cancel the line.
    </Alert> : null}

    {payments.length > 0 ? <ul aria-label="Payments" className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
      {payments.map(payment => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <span className="min-w-0 text-sm">
          <span className="block font-medium text-ink">{METHOD_LABEL[payment.method] ?? 'Payment'} <span className="tabular">{naira(payment.amountKobo)}</span>
            {payment.status === 'pending_check' ? <span className="font-normal text-ink-2"> · Waiting for check</span> : null}</span>
          <span className="block text-caption text-ink-3">{payment.receiptNumber ? `${payment.receiptNumber} · ` : ''}{payment.receivedBy} · {lagosTime(payment.receivedAt)}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          {payment.status === 'pending_check' && can('billing.payment.confirm') && open
            ? <Button size="sm" variant="soft" icon={CircleCheck} onClick={() => setSheet({ kind: 'confirm', payment })}>Confirm transfer</Button> : null}
          {onPrint && payment.receiptNumber ? <Button size="sm" icon={Printer} onClick={() => onPrint(payment)}>Receipt</Button> : null}
          {can('billing.payment.void') ? <Button size="sm" icon={Undo2} onClick={() => setSheet({ kind: 'void-payment', payment })}>Cancel or refund</Button> : null}
        </span>
      </li>)}
    </ul> : null}

    {covers.length > 0 ? <ul aria-label="HMO to pay" className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
      {covers.map(cover => <li key={cover.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <span className="min-w-0 text-sm">
          <span className="block font-medium text-ink">HMO to pay · {cover.hmoName} <span className="tabular">{naira(cover.amountKobo)}</span></span>
          <span className="block text-caption text-ink-3">Owed by the HMO, not paid · code {cover.approvalCode} · {cover.recordedBy}</span>
        </span>
        {can('billing.payment.void') ? <Button size="sm" icon={X} onClick={() => setSheet({ kind: 'cancel-cover', cover })}>Cancel HMO cover</Button> : null}
      </li>)}
    </ul> : null}

    {open && can('billing.bill.adjust') && lines.length > 0 ? <ul aria-label="Lines" className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
      {lines.map(line => <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 text-sm text-ink">{line.quantity > 1 ? `${line.quantity} × ` : ''}{line.name} · <span className="tabular">{naira(line.totalKobo)}</span>
          {line.dispensingReversed ? <span className="text-warn-ink"> · dispensing reversed</span> : null}</span>
        <Button size="sm" variant="ghost" icon={X} aria-label={`Cancel the line ${line.name}`} onClick={() => setSheet({ kind: 'cancel-line', line })}>Cancel line</Button>
      </li>)}
    </ul> : null}

    {open ? <div className="flex flex-wrap gap-2">
      {can('billing.bill.create') ? <Button icon={Plus} onClick={() => setSheet({ kind: 'add-line' })}>Add an item</Button> : null}
      {can('billing.bill.defer') && !bill.deferred && bill.dueKobo > 0
        ? <Button icon={Clock} onClick={() => setSheet({ kind: 'defer' })}>Emergency: bill follows</Button> : null}
      {can('billing.bill.adjust') && nothingTaken ? <Button icon={Ban} onClick={() => setSheet({ kind: 'void-bill' })}>Cancel bill</Button> : null}
    </div> : <p className="m-0 text-sm text-ink-2">This bill was cancelled. It keeps its number.</p>}

    {sheet ? <ActionSheet bill={bill} sheet={sheet} onClose={() => setSheet(null)} onDone={next => { setSheet(null); onChanged(next) }} /> : null}
  </section>
}

/** One action's confirmation, with its reason where it needs one, sent once (one Idempotency-Key per sheet). */
function ActionSheet({ bill, sheet, onClose, onDone }: {
  readonly bill: Bill; readonly sheet: Sheet; readonly onClose: () => void; readonly onDone: (bill: Bill) => void
}) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const toast = useToast()
  const [key] = useState(() => crypto.randomUUID())
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState<'refund' | 'cancel'>('refund')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [item, setItem] = useState<CatalogueItem | null>(null)
  const [quantity, setQuantity] = useState('1')
  const needsReason = sheet.kind === 'void-payment' || sheet.kind === 'cancel-cover' || sheet.kind === 'cancel-line' || sheet.kind === 'void-bill'
  const reasonError = needsReason && (reason.trim().length < REASON_MIN || reason.trim().length > REASON_MAX)
    ? `Say why, in ${REASON_MIN} to ${REASON_MAX} characters.` : null
  const count = Number(quantity)
  const lineError = sheet.kind === 'add-line' ? !item ? 'Choose an item from the price list.'
    : !Number.isInteger(count) || count < 1 || count > 10_000 ? 'Type how many, a whole number from 1 to 10,000.' : null : null

  async function run() {
    setTried(true)
    if (!facilityId || reasonError || lineError || busy) return
    setBusy(true); setProblem(null)
    const why = reason.trim()
    let result: CommerceResult<Bill>
    switch (sheet.kind) {
      case 'confirm': result = await commerce.confirmPayment(facilityId, bill.id, sheet.payment.id, bill.version, key); break
      case 'void-payment': result = await commerce.voidPayment(facilityId, bill.id, sheet.payment.id, refund === 'refund' ? `Refund: ${why}` : why, bill.version, key); break
      case 'cancel-cover': result = await commerce.cancelHmoCover(facilityId, bill.id, sheet.cover.id, why, bill.version, key); break
      case 'cancel-line': result = await commerce.cancelLine(facilityId, bill.id, sheet.line.id, why, bill.version, key); break
      case 'void-bill': result = await commerce.voidBill(facilityId, bill.id, why, bill.version, key); break
      case 'defer': result = await commerce.deferBill(facilityId, bill.id, 'emergency', key); break
      case 'add-line': result = await commerce.addLine(facilityId, bill.id, { catalogueItemId: item!.id, quantity: count, expectedVersion: bill.version }, key); break
    }
    setBusy(false)
    if (result.ok) { toast.success({ title: DONE[sheet.kind], message: `Bill ${result.data.number}` }); onDone(result.data); return }
    setProblem(result.notAvailable ? NOT_SET_UP_UNSAVED : result.error)
  }

  const words = SHEET_WORDS[sheet.kind]
  let subject: ReactNode = <p className="m-0 text-sm text-ink-2">{billName(bill)} · Bill {bill.number}</p>
  if (sheet.kind === 'confirm' || sheet.kind === 'void-payment') subject = <p className="m-0 text-sm text-ink-2">{billName(bill)} · Bill {bill.number} · {METHOD_LABEL[sheet.payment.method] ?? 'Payment'} <span className="tabular">{naira(sheet.payment.amountKobo)}</span>{sheet.payment.reference ? ` · ref ${sheet.payment.reference}` : ''}</p>
  if (sheet.kind === 'cancel-cover') subject = <p className="m-0 text-sm text-ink-2">{sheet.cover.hmoName} · <span className="tabular">{naira(sheet.cover.amountKobo)}</span> · code {sheet.cover.approvalCode}</p>
  if (sheet.kind === 'cancel-line') subject = <p className="m-0 text-sm text-ink-2">{sheet.line.name} · <span className="tabular">{naira(sheet.line.totalKobo)}</span></p>

  return <ConfirmSheet open onClose={() => { if (!busy) onClose() }} busy={busy} title={words.title} confirmLabel={words.confirm}
    destructive={sheet.kind === 'void-bill' || sheet.kind === 'void-payment'} subject={subject} effect={words.effect} undo={words.undo}
    onConfirm={() => { void run() }}>
    <div className="flex flex-col gap-4">
      {sheet.kind === 'void-payment' ? <Segmented ariaLabel="Why is it cancelled?" value={refund} onChange={setRefund} className="self-start"
        options={[{ value: 'refund', label: 'Money given back' }, { value: 'cancel', label: 'Recorded by mistake' }]} /> : null}
      {needsReason ? <Field label={sheet.kind === 'void-payment' && refund === 'refund' ? 'Why is it refunded?' : 'Why?'} htmlFor={`${ids}-reason`}
        error={tried ? reasonError : null} errorId={`${ids}-reason-error`}>
        <Textarea id={`${ids}-reason`} rows={3} maxLength={REASON_MAX} value={reason} onChange={event => setReason(event.target.value)}
          aria-invalid={Boolean(tried && reasonError)} aria-describedby={tried && reasonError ? `${ids}-reason-error` : undefined} />
      </Field> : null}
      {sheet.kind === 'add-line' ? <AddLineFields item={item} onItem={setItem} quantity={quantity} onQuantity={setQuantity} error={tried ? lineError : null} /> : null}
      {problem ? <Alert intent="error" size="sm" title="Not saved">{problem}</Alert> : null}
    </div>
  </ConfirmSheet>
}

const DONE: Readonly<Record<Sheet['kind'], string>> = {
  confirm: 'Transfer confirmed', 'void-payment': 'Payment cancelled', 'cancel-cover': 'HMO cover cancelled',
  'cancel-line': 'Line cancelled', 'void-bill': 'Bill cancelled', defer: 'Bill follows', 'add-line': 'Item added',
}
const SHEET_WORDS: Readonly<Record<Sheet['kind'], { title: string; confirm: string; effect: string; undo: string }>> = {
  confirm: { title: 'Confirm this transfer?', confirm: 'Money arrived',
    effect: 'You checked the facility’s account and the money arrived with this reference.', undo: 'Only confirm money you can see in the account. The person who recorded it can’t confirm it.' },
  'void-payment': { title: 'Cancel this payment?', confirm: 'Cancel payment',
    effect: 'The payment stays on the bill as cancelled, with your name and the reason, and its receipt prints “Cancelled”. What it paid goes back on what is owed.',
    undo: 'It can’t be undone: take the payment again if it was right. The person who took it can’t cancel it.' },
  'cancel-cover': { title: 'Cancel this HMO cover?', confirm: 'Cancel HMO cover',
    effect: 'The amount goes back on what the patient owes.', undo: 'It can’t be undone: record the HMO cover again if it was right.' },
  'cancel-line': { title: 'Cancel this line?', confirm: 'Cancel line',
    effect: 'The line stays on the bill as cancelled and no longer counts. A pharmacy or lab item then shows “Not billed”.', undo: 'Add the item again if it was right.' },
  'void-bill': { title: 'Cancel this bill?', confirm: 'Cancel bill',
    effect: 'Nothing is paid on it. It keeps its number and shows as cancelled.', undo: 'A cancelled bill can’t be opened again.' },
  defer: { title: 'Serve now, bill follows?', confirm: 'Bill follows',
    effect: 'An emergency is served first and billed later. The bill can still be paid at any time.', undo: 'It stays “Bill follows” until it is paid.' },
  'add-line': { title: 'Add an item to this bill', confirm: 'Add to bill',
    effect: 'At today’s cash price from the price list.', undo: 'A billing officer can cancel a line added by mistake.' },
}

/** The price list searched by name (2 letters or more), and how many. */
function AddLineFields({ item, onItem, quantity, onQuantity, error }: {
  readonly item: CatalogueItem | null; readonly onItem: (item: CatalogueItem | null) => void
  readonly quantity: string; readonly onQuantity: (value: string) => void; readonly error: string | null
}) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const [q, setQ] = useState('')
  const term = q.trim()
  const found = useCommerceRead<ListPage<CatalogueItem>>(facilityId && term.length >= 2 ? `add-line:${facilityId}:${term}` : null,
    signal => commerce.catalogueItems(facilityId!, { q: term, active: true }, signal))
  const items = found.data?.items ?? []
  return <>
    <Field label="Item" htmlFor={`${ids}-q`} hint="Type at least 2 letters of its name.">
      <Input id={`${ids}-q`} type="search" autoComplete="off" value={q} onChange={event => { setQ(event.target.value); onItem(null) }} />
    </Field>
    {term.length >= 2 ? found.status === 'error' ? <Alert size="sm" intent="error">{found.error}</Alert>
      : <Select aria-label="Choose the item" value={item?.id ?? ''} onChange={event => onItem(items.find(entry => entry.id === event.target.value) ?? null)}>
        <option value="">{found.status === 'loading' ? 'Searching…' : items.length ? 'Choose the item' : 'Nothing on the price list matches'}</option>
        {items.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.strength ? ` ${entry.strength}` : ''} · {KIND_LABEL[entry.kind]} · {naira(entry.prices.cashKobo)}</option>)}
      </Select> : null}
    <Field label="How many" htmlFor={`${ids}-n`}>
      <Input id={`${ids}-n`} type="number" inputMode="numeric" min={1} max={10000} value={quantity} onChange={event => onQuantity(event.target.value)} />
    </Field>
    {error ? <p role="alert" className="m-0 text-xs font-medium text-danger-ink">{error}</p> : null}
  </>
}
