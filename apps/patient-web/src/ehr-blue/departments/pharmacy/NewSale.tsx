import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleCheck, Pill, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { FormActions, FormPage } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type CatalogueItem, type WalkInAnswer, type WalkInOrder, type WorkItemBill } from '../commerce/api'
import { naira } from '../commerce/money'
import { NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useDeptAccess } from '../parts/access'
import { ItemCover, PaymentStep, PaidLine, usePaymentSettings } from './pointOfCare'
import { drugFormFromCatalogue, paysFirst, summaryOf } from './pocFields'
import {
  CataloguePicker, checkOutside, StepCard, checkWho, EMPTY_OUTSIDE, EMPTY_WHO, OutsideFields, outsideOrder, outsideUsed, StepSummary, Stepper,
  useAttemptKey, walkInPatient, whoCanContinue, whoFieldId, whoLine, WhoFields, type OutsideDraft, type OutsideErrors, type PickItem, type WhoDraft, type WhoErrors,
} from './walkIn'

const BACK = { to: '/provider/pharmacy', label: 'Back to pharmacy' }
const SEARCH_ID = 'sale-search'

interface CartLine {
  readonly item: CatalogueItem
  readonly onHand: number | null
  readonly unit: string | null
  quantity: number
  dose: string
  frequency: string
}

type StepNo = 1 | 2 | 3 | 4

/**
 * New sale at the pharmacy counter (POINT_OF_CARE_SPEC §4): a walk-in, with or without an outside prescription, in four
 * short steps made for a busy counter: who (a Health ID, a new Health ID made here, or no details for over-the-counter items), the
 * outside prescription (optional), the items (search the price list, tap to add), and check and pay. The order is made
 * once (POST walk-in-orders, one Idempotency-Key per order as typed); then payment at the counter or the cashier, and on
 * to dispensing in the queue's picking view, which keeps its own checks. A 404 says it isn't switched on: nothing is
 * pretended saved.
 */
export function NewSale() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('pharmacy.walk-in.create')) return <FormPage title="New sale" back={BACK}>
    <EmptyState icon={ShoppingBag} title="You can’t make sales here" description="Your role needs permission to sell to walk-in patients. Ask the pharmacist in charge." />
  </FormPage>
  return <NewSaleForm key={facilityId} facilityId={facilityId} permissions={permissions} />
}

function NewSaleForm({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const navigate = useNavigate()
  const focus = useFocusById()
  const settingsRead = usePaymentSettings(facilityId)
  const settings = settingsRead.status === 'ready' ? settingsRead.data : null
  const [step, setStep] = useState<StepNo>(1)
  const [who, setWho] = useState<WhoDraft>(EMPTY_WHO)
  const [whoErrors, setWhoErrors] = useState<WhoErrors>({})
  const [outside, setOutside] = useState<OutsideDraft>(EMPTY_OUTSIDE)
  const [outsideErrors, setOutsideErrors] = useState<OutsideErrors>({})
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartError, setCartError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [off, setOff] = useState(false)
  const [created, setCreated] = useState<WalkInAnswer | null>(null)
  const [cleared, setCleared] = useState<NonNullable<WorkItemBill> | null>(null)
  const keyFor = useAttemptKey()
  const anonymous = who.mode === 'anonymous'
  const total = cart.reduce((sum, line) => sum + line.item.prices.cashKobo * line.quantity, 0)

  function go(next: StepNo) {
    setStep(next)
    focus(next === 3 ? SEARCH_ID : `sale-step-${next}`)
  }
  function doneWho() {
    const errors = checkWho(who)
    setWhoErrors(errors)
    const first = Object.keys(errors)[0]
    if (first) return focus(whoFieldId('sale-who', first as keyof WhoErrors))
    // Over the counter: items that need a prescription can't stay in the sale.
    if (anonymous && cart.some(line => line.item.prescriptionOnly)) setCart(current => current.filter(line => !line.item.prescriptionOnly))
    go(anonymous ? 3 : 2)
  }
  function doneOutside() {
    const errors = checkOutside(outside, outsideUsed(outside))
    setOutsideErrors(errors)
    const first = Object.keys(errors)[0]
    if (first) return focus(first === 'prescriberName' ? 'sale-rx-prescriber' : first === 'writtenOn' ? 'sale-rx-written' : `sale-rx-${first}`)
    go(3)
  }
  function add(entry: PickItem) {
    setCartError('')
    setCart(current => {
      const found = current.find(line => line.item.id === entry.item.id)
      if (found) return current.map(line => line.item.id === entry.item.id ? { ...line, quantity: Math.min(line.quantity + 1, line.onHand ?? 9999) } : line)
      return [...current, { item: entry.item, onHand: entry.stock?.onHand ?? null, unit: entry.stock?.unit ?? null, quantity: 1, dose: '', frequency: '' }]
    })
  }
  function change(id: string, patch: Partial<CartLine>) {
    setCartError('')
    setCart(current => current.map(line => line.item.id === id ? { ...line, ...patch } : line))
  }
  function doneItems() {
    if (cart.length === 0) { setCartError('Add at least one item.'); return focus(SEARCH_ID) }
    const missing = cart.find(line => line.item.prescriptionOnly && (!line.dose.trim() || !line.frequency.trim()))
    if (missing) {
      setCartError(`Add the dose and how often for ${missing.item.name}: it goes on the label.`)
      return focus(`sale-line-${missing.item.id}-${missing.dose.trim() ? 'often' : 'dose'}`)
    }
    go(4)
  }

  const order: WalkInOrder = {
    patient: walkInPatient(who),
    outside: anonymous ? null : outsideOrder(outside),
    items: cart.map(line => ({ catalogueItemId: line.item.id, quantity: line.quantity,
      ...(line.item.prescriptionOnly || line.dose.trim() ? { dose: line.dose.trim() || null, frequency: line.frequency.trim() || null } : {}) })),
  }
  async function send() {
    if (sending || created) return
    setSending(true); setSendError('')
    const result = await commerce.pharmacyWalkIn(facilityId, order, keyFor(JSON.stringify([facilityId, order])))
    setSending(false)
    if (result.ok) {
      setCreated(result.data)
      if (result.data.bill.status === 'paid' || result.data.bill.status === 'deferred') setCleared(summaryOf(result.data.bill))
      focus('sale-made')
      return
    }
    if (result.notAvailable) { setOff(true); focus('sale-off'); return }
    setSendError(result.error)
  }
  function again() {
    setStep(1); setWho(EMPTY_WHO); setOutside(EMPTY_OUTSIDE); setCart([]); setCreated(null); setCleared(null); setSendError(''); setOff(false)
    focus('sale-step-1')
  }

  const dispenseHref = created ? `/provider/pharmacy?rx=${encodeURIComponent(created.workItemIds[0] ?? '')}` : '/provider/pharmacy'
  const payFirst = paysFirst(settings, 'pharmacy')

  return <FormPage title="New sale" back={BACK} wide
    description={created ? undefined : `Step ${anonymous && step > 2 ? step - 1 : step} of ${anonymous ? 3 : 4}. A walk-in patient, with or without a prescription from outside.`}>
    {/* 1. Who */}
    <StepCard anchor="sale-step-1" n={1} title="Who is it for?" current={step === 1} done={step > 1}
      summary={<StepSummary label="Change who it is for" onChange={created ? undefined : () => go(1)}>{whoLine(who)}</StepSummary>}>
      <WhoFields idBase="sale-who" facilityId={facilityId} place="pharmacy" who={who} errors={whoErrors} anonymous
        onChange={next => { if (next.made && !who.made) focus('sale-who-made'); setWho(next); setWhoErrors({}) }} />
      {whoCanContinue(who) ? <FormActions sticky={false}><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneWho}>Continue</Button></FormActions> : null}
    </StepCard>

    {/* 2. Outside prescription */}
    {!anonymous ? <StepCard anchor="sale-step-2" n={2} title="Prescription from outside" hint="Optional. Skip if there’s no paper prescription." current={step === 2} done={step > 2}
      summary={<StepSummary label="Change the outside prescription" onChange={created ? undefined : () => go(2)}>
        {outsideUsed(outside) ? [outside.prescriberName, outside.facilityName, outside.writtenOn].filter(Boolean).join(' · ') : 'None'}</StepSummary>}>
      <OutsideFields idBase="sale-rx" outside={outside} errors={outsideErrors} contact={false} paper="prescription"
        onChange={next => { setOutside(next); setOutsideErrors({}) }} />
      <FormActions sticky={false}>
        {!outsideUsed(outside) ? <Button onClick={() => go(3)}>Skip</Button> : null}
        <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneOutside}>Continue</Button>
      </FormActions>
    </StepCard> : null}

    {/* 3. Items */}
    <StepCard anchor="sale-step-3" n={anonymous ? 2 : 3} title="Items" hint="Search, then tap to add." current={step === 3} done={step > 3}
      summary={<StepSummary label="Change the items" onChange={created ? undefined : () => go(3)}>
        {cart.length} {cart.length === 1 ? 'item' : 'items'} · <strong className="tabular">{naira(total)}</strong></StepSummary>}>
      <CataloguePicker facilityId={facilityId} kind="drug" searchId={SEARCH_ID} withStock={permissions.includes('pharmacy.stock.read')} emptyWord="medicines"
        chosen={id => cart.find(line => line.item.id === id)?.quantity ?? 0}
        blockedWhy={item => anonymous && item.prescriptionOnly ? 'Needs the patient’s name: prescription only.' : null} onPick={add} />
      {cart.length > 0 ? <section aria-labelledby="sale-cart-title" className="flex flex-col gap-3">
        <h4 id="sale-cart-title" className="m-0 text-title-3 text-ink">In this sale</h4>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {cart.map(line => <CartRow key={line.item.id} line={line} onChange={patch => change(line.item.id, patch)}
            onRemove={() => { setCart(current => current.filter(other => other.item.id !== line.item.id)); focus(SEARCH_ID) }} />)}
        </ul>
      </section> : null}
      {cartError ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{cartError}</p> : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="text-[24px] font-semibold text-ink tabular" aria-live="polite">{naira(total)}</span>
      </div>
      <FormActions><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneItems}>Check the sale{cart.length ? <span className="tabular"> · {naira(total)}</span> : null}</Button></FormActions>
    </StepCard>

    {/* 4. Check & pay */}
    <StepCard anchor="sale-step-4" n={anonymous ? 3 : 4} title="Check and pay" current={step === 4} done={Boolean(cleared)}>
      <dl className="m-0 grid gap-x-4 gap-y-2 text-[15px] sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-ink-3">For</dt><dd className="m-0 text-ink">{whoLine(who)}</dd>
        {!anonymous && outsideUsed(outside) ? <><dt className="text-ink-3">Prescribed by</dt>
          <dd className="m-0 text-ink">{[outside.prescriberName, outside.facilityName].filter(Boolean).join(', ')}</dd></> : null}
      </dl>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {cart.map(line => <li key={line.item.id} className="flex items-start justify-between gap-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-ink">{line.quantity} × {line.item.name}{line.item.strength ? ` ${line.item.strength}` : ''}</span>
            {line.dose.trim() ? <span className="block text-[13px] text-ink-2">{line.dose.trim()} · {line.frequency.trim()}</span> : null}
          </span>
          <span className="shrink-0 text-[15px] font-medium text-ink tabular">{naira(line.item.prices.cashKobo * line.quantity)}</span>
        </li>)}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] font-medium text-ink">Total</span>
        <span className="text-[28px] font-semibold text-ink tabular">{naira(created?.bill.totalKobo ?? total)}</span>
      </div>
      {off ? <div id="sale-off" tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <NotSwitchedOn message="New sales aren’t switched on for this facility yet. Nothing was saved." />
      </div> : null}
      {sendError ? <Alert intent="error" title="The sale wasn’t made">{sendError} Check it and try again: the same sale won’t be made twice.</Alert> : null}
      {!created && !off ? <FormActions>
        <Button onClick={() => go(3)}>Back to items</Button>
        <Button variant="primary" size="lg" aria-busy={sending || undefined} aria-disabled={sending || undefined} onClick={() => void send()}>
          {sending ? 'Making the sale…' : settings?.wherePaid === 'cashier' ? 'Make sale and send to cashier' : 'Make sale and take payment'}</Button>
      </FormActions> : null}
    </StepCard>

    {created ? <div className="flex flex-col gap-4">
      <p id="sale-made" tabIndex={-1} className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-ink outline-none">
        <CircleCheck className="size-5 text-success-ink" aria-hidden />Sale made · Bill {created.bill.number}</p>
      {!cleared && settings ? <PaymentStep facilityId={facilityId} summary={summaryOf(created.bill)} settings={settings}
        permissions={permissions} subject={null} verb="dispense" headingId="sale-pay"
        onCleared={summary => { setCleared(summary); focus('sale-ready') }} /> : null}
      {cleared || !settings || !payFirst ? <Card className={cleared ? 'ring-success/40' : undefined}>
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><Pill className="size-7" aria-hidden /></span>
          <h2 id="sale-ready" tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">{cleared ? 'Ready to dispense' : 'Dispense now'}</h2>
          {cleared ? <PaidLine summary={cleared} /> : <p className="m-0 text-body text-ink-2">Payment isn’t needed before dispensing here.</p>}
          <div className="mt-2 flex w-full max-w-sm flex-col gap-2">
            <Button variant={cleared || !settings ? 'primary' : 'secondary'} size="lg" block iconRight={ArrowRight} onClick={() => navigate(dispenseHref)}>Dispense</Button>
            <Button block icon={Plus} onClick={again}>New sale</Button>
          </div>
        </div>
      </Card> : null}
    </div> : null}
  </FormPage>
}

function CartRow({ line, onChange, onRemove }: {
  readonly line: CartLine; readonly onChange: (patch: Partial<CartLine>) => void; readonly onRemove: () => void
}) {
  const id = `sale-line-${line.item.id}`
  const name = `${line.item.name}${line.item.strength ? ` ${line.item.strength}` : ''}`
  return <li className="flex flex-col gap-3 rounded-xl bg-surface p-3 ring-1 ring-line">
    <div className="flex items-start gap-3">
      <ItemCover imageUrl={line.item.imageUrl} form={drugFormFromCatalogue(line.item.form)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{name}</p>
        <p className="m-0 text-[14px] text-ink-2 tabular">{naira(line.item.prices.cashKobo)} each · <strong className="text-ink">{naira(line.item.prices.cashKobo * line.quantity)}</strong></p>
        {line.item.prescriptionOnly ? <Badge size="sm" tone="violet" className="self-start">Prescription only</Badge> : null}
        {line.onHand !== null ? <p className="m-0 text-[13px] text-ink-3 tabular">{line.onHand} {line.unit ?? ''} in stock</p> : null}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Stepper id={`${id}-qty`} label={name} value={line.quantity} max={line.onHand ?? undefined} onChange={quantity => onChange({ quantity })} />
      <Button variant="danger" icon={Trash2} aria-label={`Remove ${name}`} onClick={onRemove}>Remove</Button>
    </div>
    {line.item.prescriptionOnly ? <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Dose" htmlFor={`${id}-dose`} hint="With its unit: 1 tablet, 5 ml." hintId={`${id}-dose-hint`}>
        <Input id={`${id}-dose`} aria-describedby={`${id}-dose-hint`} value={line.dose} maxLength={80} autoComplete="off" className="h-11"
          onChange={event => onChange({ dose: event.target.value })} />
      </Field>
      <Field label="How often" htmlFor={`${id}-often`} hint="Twice daily for 5 days." hintId={`${id}-often-hint`}>
        <Input id={`${id}-often`} aria-describedby={`${id}-often-hint`} value={line.frequency} maxLength={120} autoComplete="off" className="h-11"
          onChange={event => onChange({ frequency: event.target.value })} />
      </Field>
    </div> : null}
  </li>
}
