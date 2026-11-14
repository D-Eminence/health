import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Check, CircleCheck, FileText, PackageCheck, Pencil, Plus, Printer, Search, ShoppingBag, Trash2, UserRound, Wallet, X } from 'lucide-react'
import { Modal } from '../../../kasuwa/interactive'
import { FormActions, PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type Bill, type CatalogueItem, type ListPage, type PaymentSettings, type ReceiptData, type StockLine as StockRow, type WalkInOrder } from '../commerce/api'
import { naira } from '../commerce/money'
import { NOT_SET_UP_UNSAVED, NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useOrderPhotoUpload } from '../commerce/orderPhoto'
import { Receipt } from '../commerce/Receipt'
import { BillSummary, TakePayment } from '../commerce/TakePayment'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { useDeptAccess } from '../parts/access'
import { ItemCover, PaymentStep, usePaymentSettings } from './pointOfCare'
import { Breakable } from './PharmacyQueue'
import { drugFormFromCatalogue, paysFirst, summaryOf } from './pocFields'
import { canGiveHealthId, GiveHealthId } from './saleAfter'
import {
  checkOutside, EMPTY_OUTSIDE, normalizeHealthId, normalizePhone, OutsideFields, outsideOrder, PickCard, Stepper, useAttemptKey,
  type OutsideDraft, type OutsideErrors, type PickItem,
} from './walkIn'

const SEARCH_ID = 'sell-search'
const BASKET_ID = 'sell-basket-title'
const HEALTH_ID = /^HID-[A-Z0-9]{4,}$/

interface Line {
  readonly item: CatalogueItem
  readonly onHand: number | null
  readonly unit: string | null
  quantity: number
  dose: string
  frequency: string
}
interface Customer { name: string; phone: string; healthId: string }
const NO_CUSTOMER: Customer = { name: '', phone: '', healthId: '' }
type Stage = 'basket' | 'pay' | 'handover' | 'done'

const label = (item: Pick<CatalogueItem, 'name' | 'strength'>) => `${item.name}${item.strength ? ` ${item.strength}` : ''}`
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Sell, at the counter (POINT_OF_CARE_SPEC §4, the owner's order of 2026-10-31: work first, identity optional). The
 * search is focused as the page opens; results are big cards (picture or drawn form, price, stock) and a tap adds one to
 * the basket; Enter adds the one exact match, so a barcode scanner works. The basket keeps a running total, sticky at
 * the bottom on a phone and in the right column on a wide screen, and ends in one main action: Take payment (or Send to
 * cashier, by the payment setup). A prescription-only drug asks for the doctor's prescription as it is added. The
 * customer's name, phone or Health ID are optional. Then: pay → hand over → receipt, and only then "Give them a Health
 * ID". The sale is made once (POST walk-in-orders, `counter: true`, one Idempotency-Key per basket as typed).
 */
export function Sell() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('pharmacy.walk-in.create')) return <div className="flex flex-col gap-6">
    <PageHeader title="Sell" />
    <EmptyState icon={ShoppingBag} title="You can’t sell here" description="Your role needs permission to sell at the counter. Ask the pharmacist in charge." />
  </div>
  return <Counter key={facilityId} facilityId={facilityId} permissions={permissions} />
}

/** The price list's drugs and other items (never lab tests), searched as typed, with stock joined in where it is read. */
function useSellSearch(facilityId: string, query: string, withStock: boolean) {
  const [q, setQ] = useState(query.trim())
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 150); return () => clearTimeout(timer) }, [query])
  const items = useCommerceRead<ListPage<CatalogueItem>>(`sell:${facilityId}:${q}`, signal => commerce.catalogueItems(facilityId, { q }, signal))
  const stock = useCommerceRead<ListPage<StockRow>>(withStock ? `stock:${facilityId}:${q}` : null, signal => commerce.stock(facilityId, { q }, signal))
  const byId = new Map((stock.data?.items ?? []).map(line => [line.catalogueItemId, line]))
  const list: PickItem[] = (items.data?.items ?? []).filter(item => item.active && item.kind !== 'lab_test')
    .map(item => ({ item, stock: byId.get(item.id) ?? null }))
  return { q, list, status: items.status, error: items.error, reload: items.reload, settled: q === query.trim() && items.status !== 'loading' }
}

const available = (entry: PickItem) => !(entry.stock && entry.stock.onHand <= 0)

/** What Enter adds: the one item whose name (with or without strength) or id is the text, else the only item listed. */
function exactMatch(list: readonly PickItem[], text: string): PickItem | null {
  const typed = text.trim().toLowerCase()
  if (!typed) return null
  const open = list.filter(available)
  const exact = open.filter(({ item }) => [item.id, item.name, label(item)].some(value => value.toLowerCase() === typed))
  return exact.length === 1 ? exact[0]! : open.length === 1 && list.length === 1 ? open[0]! : null
}

function Counter({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const focus = useFocusById()
  const settingsRead = usePaymentSettings(facilityId)
  const settings = settingsRead.status === 'ready' ? settingsRead.data : null
  const [query, setQuery] = useState('')
  const search = useSellSearch(facilityId, query, permissions.includes('pharmacy.stock.read'))
  const [said, setSaid] = useState('')
  const enterFor = useRef<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [customer, setCustomer] = useState<Customer>(NO_CUSTOMER)
  const [customerOpen, setCustomerOpen] = useState<'none' | 'details' | 'hid'>('none')
  const [hidError, setHidError] = useState('')
  // The doctor's prescription for this sale's prescription-only drugs, asked for as the first one is added.
  const [prescription, setPrescription] = useState<OutsideDraft | null>(null)
  const [asking, setAsking] = useState<{ entry: PickItem | null } | null>(null)
  const [stage, setStage] = useState<Stage>('basket')
  const [sale, setSale] = useState<Bill | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [off, setOff] = useState(false)
  const [paying, setPaying] = useState(false)
  const keyFor = useAttemptKey()
  const photoUpload = useOrderPhotoUpload(facilityId)

  // The search has focus as the counter opens, before the frame's own page-change focus looks.
  useLayoutEffect(() => { document.getElementById(SEARCH_ID)?.focus() }, [])

  const count = lines.reduce((sum, line) => sum + line.quantity, 0)
  const total = lines.reduce((sum, line) => sum + line.item.prices.cashKobo * line.quantity, 0)
  const cashier = settings?.wherePaid === 'cashier' || !permissions.includes('billing.payment.record')
  const payWord = cashier ? 'Send to cashier' : 'Take payment'

  function addLine(entry: PickItem) {
    setSaid('')
    setLines(current => {
      const found = current.find(line => line.item.id === entry.item.id)
      if (found) return current.map(line => line.item.id === entry.item.id ? { ...line, quantity: Math.min(line.quantity + 1, line.onHand ?? 9999) } : line)
      return [...current, { item: entry.item, onHand: entry.stock?.onHand ?? null, unit: entry.stock?.unit ?? null, quantity: 1, dose: '', frequency: '' }]
    })
    setSaid(`Added ${label(entry.item)}.`)
  }
  /** A tap on a result: a prescription-only drug asks for the prescription first, once per sale. */
  function pick(entry: PickItem) {
    if (!available(entry)) return
    if (entry.item.prescriptionOnly && !prescription) { setAsking({ entry }); return }
    addLine(entry)
  }
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!search.settled) { enterFor.current = query.trim(); return }
    enterExact(query)
  }
  function enterExact(text: string) {
    enterFor.current = null
    const match = exactMatch(search.list, text)
    if (!match) { setSaid(search.list.length ? `${search.list.length} found. Tap the one you want.` : 'Nothing found.'); return }
    pick(match)
    setQuery('')
  }
  // Enter pressed while the search was still being read (a scanner is quicker than the list): added once it is read.
  useEffect(() => {
    if (enterFor.current !== null && search.settled && enterFor.current === search.q) enterExact(enterFor.current)
  })

  function change(id: string, patch: Partial<Line>) {
    setLines(current => current.map(line => line.item.id === id ? { ...line, ...patch } : line))
  }
  function remove(line: Line) {
    const next = lines.filter(other => other.item.id !== line.item.id)
    setLines(next)
    // No prescription-only drug left: the prescription goes with it.
    if (!next.some(other => other.item.prescriptionOnly) && prescription) { photoUpload.release(prescription.photo); setPrescription(null) }
    focus(SEARCH_ID)
  }

  const healthId = customer.healthId.trim() ? normalizeHealthId(customer.healthId) : ''
  const order: WalkInOrder = {
    patient: healthId ? { kind: 'health_id', healthId }
      : { kind: 'anonymous', ...(customer.name.trim() ? { name: customer.name.trim() } : {}), ...(customer.phone.trim() ? { phone: normalizePhone(customer.phone) } : {}) },
    outside: prescription ? outsideOrder(prescription) : null,
    counter: true,
    items: lines.map(line => ({ catalogueItemId: line.item.id, quantity: line.quantity,
      ...(line.dose.trim() || line.frequency.trim() ? { dose: line.dose.trim() || null, frequency: line.frequency.trim() || null } : {}) })),
  }

  async function makeSale() {
    if (sending) return
    if (lines.length === 0) { setSaid('Add something first.'); focus(SEARCH_ID); return }
    if (healthId && !HEALTH_ID.test(healthId)) { setCustomerOpen('hid'); setHidError('Type the Health ID on their card, like HID-ADA2345.'); focus('sell-hid'); return }
    setSending(true); setSendError(''); setOff(false)
    const result = await commerce.pharmacyWalkIn(facilityId, order, keyFor(JSON.stringify([facilityId, order])))
    setSending(false)
    if (!result.ok) {
      if (result.notAvailable) { setOff(true); return }
      setSendError(result.error)
      return
    }
    setSale(result.data.bill)
    const cleared = result.data.bill.status === 'paid' || result.data.bill.status === 'deferred'
    setStage(cleared ? 'handover' : 'pay')
    if (!cleared && !cashier) setPaying(true)
    focus(cleared ? 'sell-handover-title' : 'sell-pay-title')
  }

  function startAgain() {
    if (prescription) photoUpload.release(prescription.photo)
    setLines([]); setCustomer(NO_CUSTOMER); setCustomerOpen('none'); setHidError(''); setPrescription(null); setSale(null)
    setStage('basket'); setSendError(''); setOff(false); setQuery(''); setSaid('')
    focus(SEARCH_ID)
  }

  if (sale && stage === 'pay') return <PayStage facilityId={facilityId} sale={sale} settings={settings} permissions={permissions}
    paying={paying} onPayingChange={setPaying} onSale={setSale} onStartAgain={startAgain}
    onCleared={() => { setStage('handover'); focus('sell-handover-title') }} />
  if (sale && stage === 'handover') return <HandOverStage facilityId={facilityId} sale={sale} lines={lines} permissions={permissions}
    onHandedOver={bill => { setSale(bill); setStage('done'); focus('sell-done-title') }} />
  if (sale && stage === 'done') return <DoneStage facilityId={facilityId} sale={sale} settings={settings} permissions={permissions}
    onSale={setSale} onNext={startAgain} />

  const primary = (where: 'side' | 'bar') => <Button variant="primary" size="lg" icon={Wallet} block={where === 'side'}
    aria-busy={sending || undefined} aria-disabled={sending || undefined} className={where === 'bar' ? 'min-w-[12rem] flex-1 whitespace-nowrap' : undefined}
    onClick={() => void makeSale()}>{sending ? 'Making the sale…' : <>{payWord} <span className="tabular">{naira(total)}</span></>}</Button>

  return <div className="flex flex-col gap-4">
    <PageHeader title="Sell" />
    <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_21rem] @4xl:items-start @6xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label="Find items" className="flex min-w-0 flex-col gap-3">
        <label htmlFor={SEARCH_ID} className="sr-only">Search drugs and items</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input id={SEARCH_ID} type="search" value={query} autoComplete="off" spellCheck={false} enterKeyHint="go"
            placeholder="Search or scan a drug" className="h-14 text-[17px]" style={{ paddingLeft: '3rem' }}
            onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
        </div>
        <div role="status" aria-live="polite" className="sr-only">{said}</div>
        <PageState loading={search.status === 'loading'} error={search.status === 'error' && search.list.length === 0 ? search.error : null}
          hasData={search.list.length > 0} onRetry={search.reload} what="the price list" rows={4}
          empty={search.status !== 'loading' && search.list.length === 0 ? (search.q
            ? { icon: Search, title: `Nothing called “${search.q}”`, description: 'Check the spelling, or try the generic name.' }
            : { icon: ShoppingBag, title: 'Nothing on the price list yet', description: 'Add drugs and prices in Products & prices.' }) : null}>
          <ul aria-label="Results" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3 p-0">
            {search.list.map(entry => <PickCard key={entry.item.id} entry={entry} blockedWhy={null}
              chosen={lines.find(line => line.item.id === entry.item.id)?.quantity ?? 0} onPick={() => pick(entry)} />)}
          </ul>
        </PageState>
      </section>

      <aside aria-labelledby={BASKET_ID} className="flex min-w-0 flex-col gap-3 @4xl:sticky @4xl:top-20">
        <Card>
          <CardHeader as="h2" titleId={BASKET_ID} title="Basket" icon={ShoppingBag}
            actions={lines.length ? <span className="text-[13px] text-ink-3 tabular">{count} {count === 1 ? 'item' : 'items'}</span> : undefined} />
          {lines.length === 0
            ? <p className="m-0 px-5 py-6 text-[15px] text-ink-2">Tap a drug to add it.</p>
            : <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {lines.map(line => <BasketLine key={line.item.id} line={line} onChange={patch => change(line.item.id, patch)} onRemove={() => remove(line)} />)}
            </ul>}
          {prescription ? <div className="flex items-start justify-between gap-3 border-t border-line px-5 py-3">
            <p className="m-0 min-w-0 text-[14px] text-ink-2 [overflow-wrap:anywhere]"><FileText className="mr-1.5 inline size-4 align-[-3px] text-ink-3" aria-hidden />
              Prescription: <span className="font-medium text-ink">{[prescription.prescriberName, prescription.facilityName, prescription.writtenOn].filter(Boolean).join(' · ')}</span></p>
            <Button variant="ghost" size="sm" icon={Pencil} aria-label="Change the prescription" className="max-sm:size-11 max-sm:px-0" onClick={() => setAsking({ entry: null })} />
          </div> : null}
          <CustomerPart customer={customer} open={customerOpen} hidError={hidError}
            onOpen={next => { setCustomerOpen(next); setHidError(''); focus(next === 'hid' ? 'sell-hid' : next === 'details' ? 'sell-name' : 'sell-customer-add') }}
            onChange={next => { setCustomer(next); setHidError('') }} />
          <div className="flex items-baseline justify-between gap-3 border-t border-line px-5 py-4">
            <span className="text-[15px] text-ink-2">Total</span>
            <span className="text-[28px] font-semibold leading-none text-ink tabular" aria-live="polite">{naira(total)}</span>
          </div>
          {off || sendError ? <div className="px-5 pb-4">
            {off ? <NotSwitchedOn message={NOT_SET_UP_UNSAVED} /> : <Alert intent="error" size="sm" title="The sale wasn’t made">{sendError} Try again: it won’t be made twice.</Alert>}
          </div> : null}
          <div className="hidden px-5 pb-5 @4xl:block">{primary('side')}</div>
        </Card>
      </aside>
    </div>

    {/* Until there is room for the basket beside the results: the total and the one main action stay at the bottom, in thumb
        reach (above the phone's quick menu), and "See basket" goes to the full basket. */}
    {count > 0 ? <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-[var(--z-sticky)] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface px-3 py-2.5 shadow-[var(--shadow-dialog)] ring-1 ring-line lg:bottom-4 @4xl:hidden">
      <a href={`#${BASKET_ID}`} onClick={event => { event.preventDefault(); document.getElementById(BASKET_ID)?.scrollIntoView({ block: 'start' }) }}
        className="inline-flex min-h-11 shrink-0 flex-col justify-center text-[13px] text-ink-2 no-underline">
        <span className="font-semibold text-ink tabular">{count} {count === 1 ? 'item' : 'items'}</span><span className="underline">See basket</span></a>
      {primary('bar')}
    </div> : null}

    <PrescriptionSheet open={asking !== null} drug={asking?.entry ? label(asking.entry.item) : null}
      start={prescription ?? EMPTY_OUTSIDE} photoUpload={photoUpload}
      onClose={() => { setAsking(null); focus(SEARCH_ID) }}
      onSave={draft => {
        const entry = asking?.entry
        setPrescription(draft); setAsking(null)
        if (entry) addLine(entry)
        focus(SEARCH_ID)
      }} />
  </div>
}

/** One basket line: name, price each and line total, a quantity stepper, Remove, and (prescription-only) the directions. */
function BasketLine({ line, onChange, onRemove }: { readonly line: Line; readonly onChange: (patch: Partial<Line>) => void; readonly onRemove: () => void }) {
  const name = label(line.item)
  const id = `sell-line-${line.item.id}`
  const [directions, setDirections] = useState(Boolean(line.dose || line.frequency))
  return <li className="flex flex-col gap-2 px-5 py-3">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold leading-snug text-ink break-words"><Breakable text={name} /></p>
        <p className="m-0 text-[13px] text-ink-3 tabular">{naira(line.item.prices.cashKobo)} each{line.onHand !== null ? ` · ${line.onHand} ${line.unit ?? ''} in stock` : ''}</p>
        {line.item.prescriptionOnly ? <Badge size="sm" tone="violet" className="mt-1">Prescription</Badge> : null}
      </div>
      <span className="shrink-0 text-[16px] font-semibold text-ink tabular">{naira(line.item.prices.cashKobo * line.quantity)}</span>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Stepper id={`${id}-qty`} label={name} value={line.quantity} max={line.onHand ?? undefined} onChange={quantity => onChange({ quantity })} />
      <div className="flex items-center gap-1">
        {line.item.prescriptionOnly && !directions ? <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => setDirections(true)}>Directions</Button> : null}
        <Button variant="ghost" icon={Trash2} aria-label={`Remove ${name}`} className="!w-11 !px-0 text-ink-3" onClick={onRemove} />
      </div>
    </div>
    {directions ? <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
      <Field label="Dose" htmlFor={`${id}-dose`} optional>
        <Input id={`${id}-dose`} value={line.dose} maxLength={80} autoComplete="off" placeholder="1 tablet" className="h-11" onChange={event => onChange({ dose: event.target.value })} />
      </Field>
      <Field label="How often" htmlFor={`${id}-often`} optional>
        <Input id={`${id}-often`} value={line.frequency} maxLength={120} autoComplete="off" placeholder="Twice daily" className="h-11" onChange={event => onChange({ frequency: event.target.value })} />
      </Field>
    </div> : null}
  </li>
}

/** The customer, optional: a name and phone, or their Health ID ("Find by Health ID"), never needed to sell. */
function CustomerPart({ customer, open, hidError, onOpen, onChange }: {
  readonly customer: Customer; readonly open: 'none' | 'details' | 'hid'; readonly hidError: string
  readonly onOpen: (next: 'none' | 'details' | 'hid') => void; readonly onChange: (next: Customer) => void
}) {
  const set = (patch: Partial<Customer>) => onChange({ ...customer, ...patch })
  if (open === 'none') return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-2">
    <Button id="sell-customer-add" variant="ghost" icon={UserRound} className="-ml-3" onClick={() => onOpen('details')}>Add customer</Button>
    <Button variant="link" className="min-h-11" onClick={() => onOpen('hid')}>Find by Health ID</Button>
  </div>
  return <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
    <div className="flex items-center justify-between gap-2">
      <p className="m-0 text-[13px] font-medium text-ink-2">{open === 'hid' ? 'Their Health ID' : 'Customer'} <span className="font-normal text-ink-3">(optional)</span></p>
      <Button variant="ghost" size="sm" icon={X} aria-label="No customer details" className="max-sm:size-11 max-sm:px-0"
        onClick={() => { onChange(NO_CUSTOMER); onOpen('none') }} />
    </div>
    {open === 'hid' ? <Field label="Health ID" htmlFor="sell-hid" error={hidError} errorId="sell-hid-error">
      <Input id="sell-hid" value={customer.healthId} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="HID-ADA2345"
        className="h-11 tracking-[.04em]" aria-invalid={hidError ? true : undefined} aria-describedby={hidError ? 'sell-hid-error' : undefined}
        onChange={event => set({ healthId: event.target.value, name: '', phone: '' })}
        onBlur={() => { if (customer.healthId.trim()) set({ healthId: normalizeHealthId(customer.healthId) }) }} />
    </Field> : <>
      <Field label="Name" htmlFor="sell-name">
        <Input id="sell-name" value={customer.name} maxLength={120} autoComplete="off" className="h-11" onChange={event => set({ name: event.target.value })} />
      </Field>
      <Field label="Phone" htmlFor="sell-phone">
        <Input id="sell-phone" type="tel" inputMode="tel" value={customer.phone} maxLength={32} autoComplete="off" placeholder="0803 123 4567" className="h-11"
          onChange={event => set({ phone: event.target.value })} />
      </Field>
      <Button variant="link" className="self-start" onClick={() => { onChange(NO_CUSTOMER); onOpen('hid') }}>Find by Health ID instead</Button>
    </>}
  </div>
}

/**
 * The doctor's prescription, asked for as a prescription-only drug is added: who wrote it (needed), the hospital or
 * clinic, the date, and a photo of the paper (uploaded as chosen). Kept for the whole sale.
 */
function PrescriptionSheet({ open, drug, start, photoUpload, onClose, onSave }: {
  readonly open: boolean; readonly drug: string | null; readonly start: OutsideDraft
  readonly photoUpload: ReturnType<typeof useOrderPhotoUpload>
  readonly onClose: () => void; readonly onSave: (draft: OutsideDraft) => void
}) {
  if (!open) return null
  return <PrescriptionForm drug={drug} start={start} photoUpload={photoUpload} onClose={onClose} onSave={onSave} />
}

function PrescriptionForm({ drug, start, photoUpload, onClose, onSave }: {
  readonly drug: string | null; readonly start: OutsideDraft; readonly photoUpload: ReturnType<typeof useOrderPhotoUpload>
  readonly onClose: () => void; readonly onSave: (draft: OutsideDraft) => void
}) {
  const [draft, setDraft] = useState<OutsideDraft>(start)
  const [errors, setErrors] = useState<OutsideErrors>({})
  const focus = useFocusById()
  function save() {
    if (photoUpload.uploading) return
    const found = checkOutside(draft, true, today())
    setErrors(found)
    if (found.prescriberName) return focus('sell-rx-prescriber')
    if (found.writtenOn) return focus('sell-rx-written')
    onSave(draft)
  }
  return <Modal open onClose={() => { if (!photoUpload.uploading) onClose() }} title="Doctor’s prescription"
    description={drug ? `${drug} needs a prescription.` : undefined}
    footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={drug ? Plus : Check} aria-disabled={photoUpload.uploading || undefined} onClick={save}>{drug ? 'Add to basket' : 'Save'}</Button></>}>
    <OutsideFields idBase="sell-rx" outside={draft} errors={errors} contact={false} paper="prescription" photoUpload={photoUpload}
      onPhoto={photo => { setDraft(current => ({ ...current, photo })); setErrors({}) }}
      onChange={next => { setDraft(next); setErrors({}) }} />
  </Modal>
}

/** Pay: the bill, and the payment step (Take payment, Send to cashier, Bill follows, by the payment setup). */
function PayStage({ facilityId, sale, settings, permissions, paying, onPayingChange, onSale, onCleared, onStartAgain }: {
  readonly facilityId: string; readonly sale: Bill; readonly settings: PaymentSettings | null; readonly permissions: readonly string[]
  readonly paying: boolean; readonly onPayingChange: (open: boolean) => void; readonly onSale: (bill: Bill) => void
  readonly onCleared: () => void; readonly onStartAgain: () => void
}) {
  const paid = useRef<Bill | null>(null)
  const cleared = (bill: Bill) => bill.status === 'paid' || bill.status === 'deferred'
  return <div data-layout="column" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
    <PageHeader title={<span id="sell-pay-title" tabIndex={-1} className="outline-none">Pay</span>} description={`${sale.patient?.displayName ?? 'Walk-in'} · Bill ${sale.number}`} />
    <BillSummary bill={sale} />
    {settings ? <PaymentStep key={sale.version} facilityId={facilityId} summary={summaryOf(sale)} settings={settings} permissions={permissions}
      subject={null} verb="hand over" headingId="sell-payment" onCleared={() => onCleared()} />
      : <NotSwitchedOn />}
    <FormActions sticky={false} align="start">
      {settings && !paysFirst(settings, 'pharmacy') ? <Button iconRight={ArrowRight} onClick={onCleared}>Hand over first</Button> : null}
      <Button variant="ghost" onClick={onStartAgain}>Start again</Button>
    </FormActions>
    {/* Opened at once when the counter takes payment: the quickest way through. */}
    <TakePayment open={paying} bill={sale} onPaid={bill => { paid.current = bill; onSale(bill) }}
      onClose={() => { onPayingChange(false); const bill = paid.current; paid.current = null; if (bill && cleared(bill)) onCleared() }} />
  </div>
}

/** Hand over: what goes across the counter, then one press records it (stock comes off the shelf). */
function HandOverStage({ facilityId, sale, lines, permissions, onHandedOver }: {
  readonly facilityId: string; readonly sale: Bill; readonly lines: readonly Line[]; readonly permissions: readonly string[]
  readonly onHandedOver: (bill: Bill) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [off, setOff] = useState(false)
  const [key] = useState(() => crypto.randomUUID())
  const may = permissions.includes('pharmacy.dispensing.create')
  async function handOver() {
    if (busy) return
    setBusy(true); setError(''); setOff(false)
    const result = await commerce.handOverSale(facilityId, sale.id, key)
    setBusy(false)
    if (result.ok) { onHandedOver(result.data.bill); return }
    if (result.notAvailable) setOff(true)
    else setError(result.error)
  }
  return <div data-layout="column" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
    <PageHeader title={<span id="sell-handover-title" tabIndex={-1} className="outline-none">Hand over</span>}
      description={`${sale.patient?.displayName ?? 'Walk-in'} · Bill ${sale.number}`} />
    <Card>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {sale.lines.map(billLine => {
          const line = lines.find(entry => entry.item.id === billLine.catalogueItemId)
          return <li key={billLine.id} className="flex items-center gap-4 px-5 py-4">
            {line ? <ItemCover imageUrl={line.item.imageUrl} form={drugFormFromCatalogue(line.item.form)} /> : null}
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[17px] font-semibold text-ink break-words"><span className="tabular">{billLine.quantity} ×</span> {billLine.name}</p>
              {line && (line.dose.trim() || line.frequency.trim()) ? <p className="m-0 text-[14px] text-ink-2">{[line.dose.trim(), line.frequency.trim()].filter(Boolean).join(' · ')}</p> : null}
            </div>
          </li>
        })}
      </ul>
    </Card>
    {off ? <NotSwitchedOn message={NOT_SET_UP_UNSAVED} /> : null}
    {error ? <Alert intent="error" title="Not recorded">{error}</Alert> : null}
    {may ? <FormActions>
      <Button variant="primary" size="lg" icon={PackageCheck} aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={() => void handOver()}>
        {busy ? 'Recording…' : 'Handed over'}</Button>
    </FormActions> : <Alert intent="info" title="A pharmacist hands it over">Your role can’t hand over medicines. Ask a pharmacist to finish this sale.</Alert>}
  </div>
}

/** Done: the receipt to print, "Give them a Health ID" when the sale has none, and the next sale. */
function DoneStage({ facilityId, sale, settings, permissions, onSale, onNext }: {
  readonly facilityId: string; readonly sale: Bill; readonly settings: PaymentSettings | null; readonly permissions: readonly string[]
  readonly onSale: (bill: Bill) => void; readonly onNext: () => void
}) {
  const { facility } = useDeptAccess()
  const receipt = useCommerceRead<ReceiptData>(`receipt:${facilityId}:${sale.id}:${sale.version}`, signal => commerce.receipt(facilityId, sale.id, signal))
  return <div data-layout="column" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
    <div className="flex items-center gap-3">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-6" aria-hidden /></span>
      <h1 id="sell-done-title" tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">Sale complete</h1>
    </div>
    <Receipt bill={sale} receipt={receipt.data} facilityName={facility?.name} hmos={settings?.hmos} footer={settings?.receiptFooter} />
    {canGiveHealthId(sale, permissions) ? <GiveHealthId idBase="sell-after" facilityId={facilityId} bill={sale} onAttached={onSale} /> : null}
    <FormActions>
      <Button icon={Printer} onClick={() => window.print()}>Print receipt</Button>
      <Button variant="primary" size="lg" icon={Plus} onClick={onNext}>New sale</Button>
    </FormActions>
  </div>
}
