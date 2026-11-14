import { CircleCheck, Printer } from 'lucide-react'
import { Badge, Button, cx } from '../../../kasuwa/ui'
import { FormActions } from '../../../kasuwa/parts'
import { BILL_STATUS_LABEL, METHOD_LABEL, SOURCE_LABEL, type Bill, type Hmo, type Payment, type ReceiptData } from './api'
import { naira } from './money'
import './commerce.css'

const when = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** One payment in words: "POS · RRN 402911", "HMO · Hygeia · code AX-221", "Transfer · ref 0091 · Waiting for check". */
export function paymentLine(payment: Payment, hmos: readonly Hmo[] = []): string {
  const parts: string[] = [METHOD_LABEL[payment.method]]
  if (payment.method === 'hmo') {
    const hmo = hmos.find(entry => entry.id === payment.hmoId)
    if (hmo) parts.push(hmo.name)
    if (payment.reference) parts.push(`code ${payment.reference}`)
  } else if (payment.method === 'pos' && payment.reference) parts.push(`RRN ${payment.reference}`)
  else if (payment.method === 'transfer' && payment.reference) parts.push(`ref ${payment.reference}`)
  else if (payment.method === 'waiver' && payment.reason) parts.push(payment.reason)
  if (payment.method === 'transfer' && payment.status === 'pending_check') parts.push('Waiting for check')
  if (payment.voided) parts.push('Cancelled')
  return parts.join(' · ')
}

/**
 * A printable receipt for a bill (docs/POINT_OF_CARE_SPEC.md §3). It draws from the receipt the server issued when given
 * one, else from the bill itself. Print uses window.print; commerce.css prints the receipt alone, black on white.
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
  const payments = shown.payments.filter(payment => !payment.voided)
  const closing = receipt?.footer ?? footer ?? null
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      <section data-receipt-print="" aria-label={number ? `Receipt ${number}` : `Bill ${shown.number}`}
        className="flex flex-col gap-4 rounded-xl bg-surface p-5 ring-1 ring-line">
        <header className="flex flex-col items-center gap-1 text-center">
          {facility ? <p className="m-0 text-title-3 text-ink">{facility}</p> : null}
          {receipt?.facility.address ? <p className="m-0 text-caption text-ink-3">{receipt.facility.address}</p> : null}
          {receipt?.facility.phone ? <p className="m-0 text-caption text-ink-3">{receipt.facility.phone}</p> : null}
          <p className="m-0 mt-2 text-[13px] font-semibold tracking-[.06em] text-ink-2 uppercase">{number ? 'Receipt' : 'Bill'}</p>
          <p className="m-0 text-title-2 text-ink tabular">{number ?? shown.number}</p>
          <p className="m-0 text-caption text-ink-3">{when(issuedAt)}{number ? ` · Bill ${shown.number}` : ''} · {SOURCE_LABEL[shown.source]}</p>
        </header>

        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px]">
          <dt className="text-ink-3">Patient</dt>
          <dd className="m-0 text-right text-ink">{shown.patient ? shown.patient.displayName : 'Walk-in (no name)'}</dd>
          {shown.patient?.healthId ? <><dt className="text-ink-3">Health ID</dt><dd className="m-0 text-right font-medium tracking-[.04em] text-ink">{shown.patient.healthId}</dd></> : null}
        </dl>

        <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3">
          {shown.lines.map(line => (
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
          <Button icon={Printer} onClick={() => window.print()}>Print</Button>
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
