import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Banknote, BadgeCheck, CreditCard, Landmark, Printer, ShieldCheck, Wallet } from 'lucide-react'
import { Drawer } from '../../../kasuwa/interactive'
import { Alert, Button, Field, Input, Select, Textarea, cx, type Icon } from '../../../kasuwa/ui'
import { LoadingRows } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, METHOD_LABEL, SOURCE_LABEL, type Bill, type PaymentInput, type PaymentMethod, type PaymentSettings, type ReceiptData, type WorkItemBill } from './api'
import { naira, parseNaira } from './money'
import { NotSwitchedOn } from './NotSwitchedOn'
import { Receipt } from './Receipt'
import { useCommerceRead } from './useCommerceRead'

const METHOD_ICON: Readonly<Record<PaymentMethod, Icon>> = {
  cash: Banknote, pos: CreditCard, transfer: Landmark, hmo: ShieldCheck, waiver: BadgeCheck,
}
const METHOD_HINT: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Notes and coins', pos: 'Card on the terminal', transfer: 'To the facility’s account', hmo: 'HMO or NHIA', waiver: 'No charge, with a reason',
}

/** A full bill, or the summary a pharmacy or lab work item carries (then the bill is read). */
export type TakePaymentBill = Bill | NonNullable<WorkItemBill>
const billIdOf = (bill: TakePaymentBill) => 'billId' in bill ? bill.billId : bill.id

/**
 * Take payment (docs/POINT_OF_CARE_SPEC.md §3): a drawer that records cash (with the change to give), POS (the reference
 * on the slip), transfer (shows the facility's account, asks for the reference; "Waiting for check" until confirmed),
 * HMO (which HMO and the approval code) or a waiver (a reason, and billing.payment.waive) — only the methods this
 * facility's payment setup allows. After saving, the receipt with Print and Done. A 404 says payments aren't switched on,
 * and nothing pretends to save. Health ID records the payment; it never moves money.
 *
 * `onPaid` hears the bill as saved (the queue can show "Paid" at once); `onClose` closes the drawer (Done, Cancel, Esc).
 */
export function TakePayment({ bill, onPaid, onClose, open }: {
  readonly bill: TakePaymentBill | null
  readonly onPaid?: (bill: Bill) => void
  readonly onClose: () => void
  readonly open: boolean
}) {
  if (!open || !bill) return null
  return <TakePaymentDrawer key={billIdOf(bill)} bill={bill} onPaid={onPaid} onClose={onClose} />
}

type Stage = { kind: 'form' } | { kind: 'receipt'; bill: Bill; receipt: ReceiptData | null } | { kind: 'off' }

function TakePaymentDrawer({ bill: given, onPaid, onClose }: {
  readonly bill: TakePaymentBill; readonly onPaid?: (bill: Bill) => void; readonly onClose: () => void
}) {
  const { facilityId, facility, permissions } = useDeptAccess()
  const billId = billIdOf(given)
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null,
    signal => commerce.paymentSettings(facilityId!, signal))
  // A summary is read in full; a full bill is read again so the amount due is today's.
  const read = useCommerceRead<Bill>(facilityId ? `bill:${facilityId}:${billId}` : null, signal => commerce.bill(facilityId!, billId, signal))
  const bill: Bill | null = read.data ?? ('billId' in given ? null : given)
  const [stage, setStage] = useState<Stage>({ kind: 'form' })
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const toast = useToast()

  const canWaive = permissions.includes('billing.payment.waive')
  const allowed = useMemo(() => (settings.data?.methods ?? []).filter(method => method !== 'waiver' || canWaive), [settings.data, canWaive])
  const [picked, setPicked] = useState<PaymentMethod | null>(null)
  const method: PaymentMethod | null = picked && allowed.includes(picked) ? picked : allowed[0] ?? null

  const due = bill?.dueKobo ?? 0
  const [amountText, setAmountText] = useState('')
  const [givenText, setGivenText] = useState('')
  const [reference, setReference] = useState('')
  const [hmoId, setHmoId] = useState('')
  const [reason, setReason] = useState('')
  const amount = amountText.trim() === '' ? due : parseNaira(amountText)
  const cashGiven = givenText.trim() === '' ? null : parseNaira(givenText)
  const hmos = settings.data?.hmos ?? []
  const chosenHmo = hmos.find(entry => entry.id === hmoId) ?? (hmos.length === 1 ? hmos[0]! : null)

  const ids = useId()
  const errors = {
    amount: amount === null ? 'Type an amount like 12,500 or 12500.00.'
      : amount <= 0 ? 'The amount must be more than ₦0.00.'
        : amount > due ? `That is more than the ${naira(due)} due.` : null,
    given: method === 'cash' && cashGiven !== null && amount !== null && cashGiven < amount ? `That is ${naira(amount - cashGiven)} short.`
      : method === 'cash' && givenText.trim() !== '' && cashGiven === null ? 'Type an amount like 5,000.' : null,
    reference: (method === 'pos' || method === 'transfer' || method === 'hmo') && reference.trim().length < 3
      ? method === 'pos' ? 'Type the reference (RRN) printed on the POS slip.'
        : method === 'transfer' ? 'Type the transfer reference from the bank alert or the patient’s phone.'
          : 'Type the approval code the HMO gave.' : null,
    hmo: method === 'hmo' && !chosenHmo ? 'Choose the HMO.' : null,
    reason: method === 'waiver' && reason.trim().length < 5 ? 'Say why this is waived (at least 5 letters).' : null,
  }
  const blocked = Object.values(errors).some(Boolean)

  // The receipt's heading takes focus as it replaces the form, so a screen reader hears it and a key lands in it.
  const receiptRef = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { if (stage.kind === 'receipt') receiptRef.current?.focus() }, [stage.kind])

  async function save() {
    setTried(true)
    if (!facilityId || !bill || !method || blocked || amount === null) return
    setSaving(true); setProblem(null)
    const payment: PaymentInput = {
      method, amountKobo: method === 'waiver' ? due : amount,
      ...(method === 'pos' || method === 'transfer' || method === 'hmo' ? { reference: reference.trim() } : {}),
      ...(method === 'hmo' && chosenHmo ? { hmoId: chosenHmo.id } : {}),
      ...(method === 'waiver' ? { reason: reason.trim() } : {}),
    }
    const result = await commerce.recordPayment(facilityId, bill.id, payment, idempotencyKey)
    if (!result.ok) {
      setSaving(false)
      if (result.notAvailable) { setStage({ kind: 'off' }); return }
      setProblem(result.error)
      return
    }
    onPaid?.(result.data)
    const receipt = await commerce.receipt(facilityId, bill.id).catch(() => null)
    setSaving(false)
    setStage({ kind: 'receipt', bill: result.data, receipt: receipt?.ok ? receipt.data : null })
    toast.success({ title: method === 'transfer' ? 'Transfer recorded' : method === 'waiver' ? 'Waiver recorded' : 'Payment recorded',
      message: method === 'transfer' ? 'It shows “Waiting for check” until someone confirms the money arrived.' : undefined })
  }

  const off = stage.kind === 'off' || settings.status === 'off' || read.status === 'off'
  const loading = !off && (settings.status === 'loading' || (!bill && read.status === 'loading'))
  const readError = settings.status === 'error' ? settings.error : !bill && read.status === 'error' ? read.error : null
  const title = stage.kind === 'receipt' ? 'Paid' : 'Take payment'
  const description = bill ? `${bill.patient?.displayName ?? 'Walk-in (no name)'} · Bill ${bill.number}` : undefined

  let footer
  if (stage.kind === 'receipt') footer = <>
    <Button icon={Printer} onClick={() => window.print()}>Print</Button>
    <Button variant="primary" onClick={onClose}>Done</Button>
  </>
  else if (off || loading || readError || !bill || !method || due <= 0) footer = <Button onClick={onClose}>Close</Button>
  else footer = <>
    <Button onClick={onClose} disabled={saving}>Cancel</Button>
    <Button variant="primary" loading={saving} onClick={() => { void save() }}>
      {method === 'waiver' ? 'Record waiver' : amount !== null && amount > 0 ? <>Take payment <span className="tabular">{naira(amount)}</span></> : 'Take payment'}
    </Button>
  </>

  return (
    <Drawer open onClose={() => { if (!saving) onClose() }} title={title} description={description}
      icon={<span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2 ring-1 ring-line"><Wallet className="size-5" /></span>}
      footer={footer}>
      {off ? <NotSwitchedOn />
        : loading ? <LoadingRows rows={3} label="Loading the bill" />
          : readError ? <Alert intent="error" title="Couldn’t load the bill" action={<Button size="sm" onClick={() => { settings.reload(); read.reload() }}>Try again</Button>}>{readError}</Alert>
            : !bill ? null
              : stage.kind === 'receipt' ? (
                <div className="flex flex-col gap-4">
                  <h3 ref={receiptRef} tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">
                    {stage.bill.status === 'paid' ? 'Paid in full' : stage.bill.dueKobo > 0 ? <>Recorded. <span className="tabular">{naira(stage.bill.dueKobo)}</span> still to pay.</> : 'Recorded'}
                  </h3>
                  {method === 'cash' && cashGiven !== null && amount !== null && cashGiven > amount
                    ? <p className="m-0 rounded-lg bg-subtle px-4 py-3 text-title-3 text-ink ring-1 ring-inset ring-line">Change to give: <span className="tabular">{naira(cashGiven - amount)}</span></p> : null}
                  <Receipt bill={stage.bill} receipt={stage.receipt} facilityName={facility?.name} hmos={hmos} footer={settings.data?.receiptFooter} />
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <BillSummary bill={bill} />
                  {due <= 0 ? <Alert intent="success" title="Nothing to pay">This bill is already paid.</Alert>
                    : allowed.length === 0 ? <Alert intent="info" title="No way to pay is set up">Choose how people pay here in Payment setup.</Alert>
                      : <>
                        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                          <legend className="mb-2 text-[13px] font-medium text-ink-2">How are they paying?</legend>
                          <div role="radiogroup" aria-label="How are they paying?" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
                            {allowed.map(option => {
                              const I = METHOD_ICON[option]
                              const on = option === method
                              return (
                                <button key={option} type="button" role="radio" aria-checked={on} data-autofocus={on ? '' : undefined}
                                  onClick={() => { setPicked(option); setTried(false); setProblem(null) }}
                                  className={cx('flex min-h-[64px] cursor-pointer flex-col items-start justify-center gap-0.5 rounded-lg border-0 px-3 py-2.5 text-left ring-1 ring-inset transition-shadow',
                                    on ? 'bg-surface text-ink ring-2 ring-brand shadow-[var(--shadow-xs)]' : 'bg-surface text-ink-2 ring-line hover:ring-line-strong')}>
                                  <span className="flex items-center gap-2 text-sm font-semibold"><I className={cx('size-[18px]', on ? 'text-brand' : 'text-ink-3')} aria-hidden />{METHOD_LABEL[option]}</span>
                                  <span className="text-[12px] text-ink-3">{METHOD_HINT[option]}</span>
                                </button>
                              )
                            })}
                          </div>
                        </fieldset>

                        {method && method !== 'waiver' ? (
                          <Field label="Amount to pay" htmlFor={`${ids}-amount`} errorId={`${ids}-amount-error`}
                            error={tried || amountText ? errors.amount : null} hint={`Due: ${naira(due)}. Less is a part payment.`} hintId={`${ids}-amount-hint`}>
                            <Input id={`${ids}-amount`} prefix="₦" inputMode="decimal" autoComplete="off" className="tabular"
                              placeholder={(due / 100).toFixed(2)} value={amountText} onChange={event => setAmountText(event.target.value)}
                              aria-invalid={Boolean((tried || amountText) && errors.amount)} aria-describedby={errors.amount ? `${ids}-amount-error` : `${ids}-amount-hint`} />
                          </Field>
                        ) : null}

                        {method === 'cash' ? <>
                          <Field label="Amount given" optional htmlFor={`${ids}-given`} error={errors.given} errorId={`${ids}-given-error`} hint="What the patient handed over, to work out the change.">
                            <Input id={`${ids}-given`} prefix="₦" inputMode="decimal" autoComplete="off" value={givenText} onChange={event => setGivenText(event.target.value)}
                              aria-invalid={Boolean(errors.given)} aria-describedby={errors.given ? `${ids}-given-error` : undefined} />
                          </Field>
                          {cashGiven !== null && amount !== null && cashGiven >= amount
                            ? <p aria-live="polite" className="m-0 rounded-lg bg-subtle px-4 py-3 text-title-3 text-ink ring-1 ring-inset ring-line">
                              {cashGiven === amount ? 'No change to give' : <>Change to give: <span className="tabular">{naira(cashGiven - amount)}</span></>}
                            </p> : null}
                        </> : null}

                        {method === 'pos' ? (
                          <Field label="Reference on the POS slip (RRN)" htmlFor={`${ids}-ref`} error={tried ? errors.reference : null} errorId={`${ids}-ref-error`}
                            hint="Printed on the customer’s slip, usually 12 digits.">
                            <Input id={`${ids}-ref`} inputMode="numeric" autoComplete="off" value={reference} onChange={event => setReference(event.target.value)}
                              aria-invalid={Boolean(tried && errors.reference)} aria-describedby={tried && errors.reference ? `${ids}-ref-error` : undefined} />
                          </Field>
                        ) : null}

                        {method === 'transfer' ? <>
                          {settings.data?.transferAccount ? (
                            <div className="rounded-lg bg-subtle px-4 py-3 ring-1 ring-inset ring-line">
                              <p className="m-0 text-caption text-ink-3">Pay into</p>
                              <p className="m-0 text-title-2 text-ink tabular tracking-[.04em]">{settings.data.transferAccount.accountNumber}</p>
                              <p className="m-0 text-sm text-ink">{settings.data.transferAccount.accountName}</p>
                              <p className="m-0 text-[13px] text-ink-2">{settings.data.transferAccount.bankName}</p>
                            </div>
                          ) : <Alert size="sm" intent="info">No account is set up for transfers yet. Add it in Payment setup.</Alert>}
                          <Field label="Transfer reference" htmlFor={`${ids}-ref`} error={tried ? errors.reference : null} errorId={`${ids}-ref-error`}
                            hint="From the bank alert or the patient’s banking app.">
                            <Input id={`${ids}-ref`} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)}
                              aria-invalid={Boolean(tried && errors.reference)} aria-describedby={tried && errors.reference ? `${ids}-ref-error` : undefined} />
                          </Field>
                          <p className="m-0 text-[13px] text-ink-2">It will show “Waiting for check” until someone confirms the money arrived.</p>
                        </> : null}

                        {method === 'hmo' ? <>
                          {hmos.length === 0 ? <Alert size="sm" intent="info">No HMOs are set up yet. Add them in Payment setup.</Alert>
                            : <Field label="HMO" htmlFor={`${ids}-hmo`} error={tried ? errors.hmo : null}>
                              <Select id={`${ids}-hmo`} value={chosenHmo?.id ?? ''} onChange={event => setHmoId(event.target.value)} aria-invalid={Boolean(tried && errors.hmo)}>
                                {hmos.length > 1 ? <option value="">Choose the HMO</option> : null}
                                {hmos.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                              </Select>
                            </Field>}
                          <Field label="Approval code" htmlFor={`${ids}-ref`} error={tried ? errors.reference : null} errorId={`${ids}-ref-error`} hint="The code the HMO gave for this visit.">
                            <Input id={`${ids}-ref`} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)}
                              aria-invalid={Boolean(tried && errors.reference)} aria-describedby={tried && errors.reference ? `${ids}-ref-error` : undefined} />
                          </Field>
                        </> : null}

                        {method === 'waiver' ? <>
                          <p className="m-0 text-sm text-ink">Waives <span className="font-semibold tabular">{naira(due)}</span>. It is recorded with your name.</p>
                          <Field label="Why is this waived?" htmlFor={`${ids}-reason`} error={tried ? errors.reason : null} errorId={`${ids}-reason-error`}>
                            <Textarea id={`${ids}-reason`} rows={3} value={reason} onChange={event => setReason(event.target.value)}
                              aria-invalid={Boolean(tried && errors.reason)} aria-describedby={tried && errors.reason ? `${ids}-reason-error` : undefined} />
                          </Field>
                        </> : null}

                        {problem ? <Alert intent="error" title="Not saved">{problem}</Alert> : null}
                      </>}
                </div>
              )}
    </Drawer>
  )
}

/** The bill in short: what for, its lines, and the amount due as the screen's one large number. */
export function BillSummary({ bill }: { readonly bill: Bill }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-line">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-2">{SOURCE_LABEL[bill.source]} · {bill.lines.length} {bill.lines.length === 1 ? 'item' : 'items'}</span>
        <span className="text-caption text-ink-3 tabular">{bill.number}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {bill.lines.map(line => (
          <li key={line.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink">{line.quantity > 1 ? `${line.quantity} × ` : ''}{line.name}</span>
            <span className="shrink-0 text-ink-2 tabular">{naira(line.totalKobo)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-ink-2">{bill.paidKobo > 0 ? <>Due <span className="text-caption text-ink-3">(of <span className="tabular">{naira(bill.totalKobo)}</span>)</span></> : 'Amount due'}</span>
        <span className="text-[22px] leading-8 font-semibold tracking-[-0.01em] text-ink tabular">{naira(bill.dueKobo)}</span>
      </div>
    </div>
  )
}
