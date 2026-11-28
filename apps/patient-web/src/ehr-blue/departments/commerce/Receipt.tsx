import { formatDateTime, formatPhone } from '@hid/ui/display'
import { CircleCheck, Printer } from 'lucide-react'
import { Badge, Button, cx } from '../../../kasuwa/ui'
import { FormActions } from '../../../kasuwa/parts'
import { BILL_STATUS_LABEL, METHOD_LABEL, SOURCE_LABEL, billName, type Bill, type Hmo, type HmoCover, type Payment, type ReceiptData } from './api'
import { naira } from './money'
import { PrintHeader } from '../../frame/PrintHeader'
import './commerce.css'
import { printReceipt } from '../../../print/printPaper'

/** "18 Nov 2026, 14:05", Lagos time (Q181 A, Q182 A). */
const when = (iso: string) => formatDateTime(iso)

/** One payment in words: "POS · RRN 402911", "Transfer · ref 0091 · Waiting for check", "Waiver · reason". */
export function paymentLine(payment: Payment, _hmos: readonly Hmo[] = []): string {
  const parts: string[] = [METHOD_LABEL[payment.method] ?? 'Payment']
  if (payment.method === 'pos' && payment.reference) parts.push(`RRN ${payment.reference}`)
  else if (payment.method === 'transfer' && payment.reference) parts.push(`ref ${payment.reference}`)
  else if (payment.method === 'waiver' && payment.reason) parts.push(payment.reason)
  if (payment.method === 'transfer' && payment.status === 'pending_check') parts.push('Waiting for check')
  if (payment.paperReceiptNumber) parts.push(`paper receipt ${payment.paperReceiptNumber}`)
  if (payment.voided) parts.push('Cancelled')
  return parts.join(' · ')
}

/** HMO cover in words (BILL-8): "HMO to pay · Hygeia HMO · code AX-221". Owed by the HMO, never money received. */
export function coverLine(cover: HmoCover): string {
  return ['HMO to pay', cover.hmoName, cover.approvalCode ? `code ${cover.approvalCode}` : null, cover.status === 'cancelled' ? 'Cancelled' : null]
    .filter(Boolean).join(' · ')
}

/**
 * A printable receipt for a bill (docs/POINT_OF_CARE_SPEC.md §3). It draws from the receipt the server issued when given
 * one, else from the bill itself. Print prints it (printReceipt: as a PDF in Safari, so no browser adds its web address);
 * commerce.css prints the receipt alone, black on white.
 * `onDone` adds the receipt's own actions: Print, then Done (the primary, rightmost; at the bottom on a phone).
 */
export function Receipt({ bill, receipt, facilityName, hmos = [], footer, onDone, className }: {
  readonly bill: Bill
  readonly receipt?: ReceiptData | null
  readonly facilityName?: string
  readonly hmos?: readonly Hmo[]
  readonly footer?: string | null
  readonly onDone?: () => void
  readonly className?: string
}) {
  const shown = receipt?.bill ?? bill
  const number = receipt?.receiptNumber ?? shown.receiptNumber ?? null
  const facility = receipt?.facility.name ?? facilityName ?? null
  const issuedAt = receipt?.issuedAt ?? shown.payments.at(-1)?.receivedAt ?? shown.createdAt
  const payments = shown.payments.filter(payment => !payment.voided && payment.method !== 'waiver')
  const waivers = shown.payments.filter(payment => !payment.voided && payment.method === 'waiver')
  const covers = (shown.hmoCovers ?? []).filter(cover => cover.status !== 'cancelled')
  const closing = receipt?.footer ?? footer ?? null
  // A voided payment's receipt keeps its number and says "Cancelled" (BILL-16); the paper book's number when there is one.
  const cancelled = receipt?.cancelled === true
  const paperNumber = receipt?.paperReceiptNumber ?? receipt?.payment?.paperReceiptNumber ?? null
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      <section data-receipt-print="" aria-label={number ? `Receipt ${number}` : `Bill ${shown.number}`}
        className="flex flex-col gap-4 rounded-xl bg-surface p-5 ring-1 ring-line">
        <header className="flex flex-col items-center gap-1 text-center">
          {/* On paper the shared print header (the Health ID logo and the facility) stands in for the facility's name. */}
          <PrintHeader facility={facility} printOnly stacked />
          {facility ? <p className="m-0 text-title-3 text-ink print:hidden">{facility}</p> : null}
          {receipt?.facility.address ? <p className="m-0 text-caption text-ink-3">{receipt.facility.address}</p> : null}
          {receipt?.facility.phone ? <p className="m-0 text-caption text-ink-3">{formatPhone(receipt.facility.phone)}</p> : null}
          <p className="m-0 mt-2 text-[13px] font-semibold tracking-[.06em] text-ink-2 uppercase">{number ? 'Receipt' : 'Bill'}</p>
          <p className="m-0 text-title-2 text-ink tabular">{number ?? shown.number}</p>
          <p className="m-0 text-caption text-ink-3">{when(issuedAt)}{number ? ` · Bill ${shown.number}` : ''} · {SOURCE_LABEL[shown.source] ?? 'Bill'}</p>
          {paperNumber ? <p className="m-0 text-caption text-ink-2">Paper receipt {paperNumber}</p> : null}
          {cancelled ? <p className="m-0 mt-1 rounded-md px-2 py-0.5 text-[13px] font-semibold tracking-[.06em] text-danger-ink uppercase ring-1 ring-inset ring-danger/40">Cancelled</p> : null}
        </header>

        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px]">
          <dt className="text-ink-3">Patient</dt>
          <dd className="m-0 text-right text-ink">{billName(shown)}</dd>
          {/* The last four characters only: a receipt never prints a whole Health ID. */}
          {shown.patient?.healthIdLast4 ? <><dt className="text-ink-3">Health ID</dt><dd className="m-0 text-right font-medium tracking-[.04em] text-ink">ending {shown.patient.healthIdLast4}</dd></> : null}
        </dl>

        <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3">
          {shown.lines.filter(line => !line.cancelled).map(line => (
            <li key={line.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 text-ink">{line.name}<span className="block text-caption text-ink-3 tabular">{line.quantity} × {naira(line.unitKobo)}</span></span>
              <span className="shrink-0 text-ink tabular">{naira(line.totalKobo)}</span>
            </li>
          ))}
        </ul>

        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-sm">
          <dt className="font-semibold text-ink">Total</dt><dd className="m-0 text-right font-semibold text-ink tabular">{naira(shown.totalKobo)}</dd>
          {payments.map(payment => (
            <PaymentRow key={payment.id} payment={payment} hmos={hmos} />
          ))}
          <dt className="text-ink-2">Paid</dt><dd className="m-0 text-right text-ink tabular">{naira(shown.paidKobo)}</dd>
          {waivers.map(payment => <PaymentRow key={payment.id} payment={payment} hmos={hmos} />)}
          {covers.map(cover => <CoverRow key={cover.id} cover={cover} />)}
          {shown.dueKobo > 0 ? <><dt className="font-semibold text-ink">{shown.status === 'deferred' ? 'Bill follows' : 'Still to pay'}</dt>
            <dd className="m-0 text-right font-semibold text-ink tabular">{naira(shown.dueKobo)}</dd></> : null}
        </dl>

        <div className="flex flex-col items-center gap-1 border-t border-line pt-3 text-center">
          <Badge size="sm" tone={shown.status === 'paid' ? 'success' : shown.status === 'deferred' ? 'info' : 'warn'} icon={shown.status === 'paid' ? CircleCheck : undefined}>
            {BILL_STATUS_LABEL[shown.status]}
          </Badge>
          {receipt?.issuedBy ? <p className="m-0 text-caption text-ink-3">Received by {receipt.issuedBy}</p> : null}
          {closing ? <p className="m-0 text-caption text-ink-3">{closing}</p> : null}
          <p className="m-0 text-[11px] text-ink-3">Recorded on Health ID</p>
        </div>
      </section>

      {onDone ? (
        <FormActions sticky={false}>
          <Button icon={Printer} onClick={event => printReceipt(event.currentTarget)}>Print</Button>
          <Button variant="primary" onClick={onDone}>Done</Button>
        </FormActions>
      ) : null}
    </div>
  )
}

function PaymentRow({ payment, hmos }: { readonly payment: Payment; readonly hmos: readonly Hmo[] }) {
  return <>
    <dt className="text-ink-2">{paymentLine(payment, hmos)}</dt>
    <dd className="m-0 text-right text-ink tabular">{naira(payment.amountKobo)}</dd>
  </>
}

/** HMO cover on a receipt: what the HMO is to pay, apart from what was paid (BILL-8). */
function CoverRow({ cover }: { readonly cover: HmoCover }) {
  return <>
    <dt className="text-ink-2">{coverLine(cover)}</dt>
    <dd className="m-0 text-right text-ink tabular">{naira(cover.amountKobo)}</dd>
  </>
}
