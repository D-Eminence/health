import { useState } from 'react'
import { CircleCheck, PackagePlus, Plus, Search, Trash2 } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Alert, Button, Card, EmptyState, Field, Input } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type CatalogueItem, type StockReceipt } from '../commerce/api'
import { naira, parseNaira } from '../commerce/money'
import { NOT_SET_UP_UNSAVED, NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useDeptAccess } from '../parts/access'
import { ItemCover } from './pointOfCare'
import { drugFormFromCatalogue } from './pocFields'
import { useAttemptKey, useCatalogueSearch } from './walkIn'

const BACK = { to: '/provider/pharmacy/stock', label: 'Back to stock' }

interface LineDraft { key: string; item: CatalogueItem | null; batch: string; expires: string; quantity: string; cost: string }
type LineErrors = Partial<Record<'item' | 'batch' | 'expires' | 'quantity' | 'cost', string>>

const newLine = (): LineDraft => ({ key: crypto.randomUUID(), item: null, batch: '', expires: '', quantity: '', cost: '' })

function checkLine(line: LineDraft, today: string): LineErrors {
  const errors: LineErrors = {}
  if (!line.item) errors.item = 'Choose the item from the price list.'
  if (!line.batch.trim()) errors.batch = 'Type the batch number on the pack.'
  if (!line.expires) errors.expires = 'Type the expiry date on the pack.'
  else if (line.expires <= today) errors.expires = 'This batch has expired. Don’t put it on the shelf.'
  if (!/^\d+$/.test(line.quantity.trim()) || Number(line.quantity) <= 0) errors.quantity = 'Type how many, as a whole number.'
  if (line.cost.trim() && parseNaira(line.cost) === null) errors.cost = 'Type an amount like 1,250 or 1250.00.'
  return errors
}

/**
 * Receive stock (POINT_OF_CARE_SPEC §5, POST stock/receipts): a delivery from a supplier, line by line: the item from
 * the price list, its batch and expiry from the pack, how many, and what each cost. Sent once, with one Idempotency-Key
 * for the delivery as typed. A 404 says stock isn't switched on: nothing is pretended saved.
 */
export function ReceiveStock() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('pharmacy.stock.manage')) return <FormPage title="Receive stock" back={BACK}>
    <EmptyState icon={PackagePlus} title="You can’t receive stock here" description="Your role needs permission to manage the pharmacy’s stock." />
  </FormPage>
  return <ReceiveForm key={facilityId} facilityId={facilityId} />
}

function ReceiveForm({ facilityId }: { readonly facilityId: string }) {
  const focus = useFocusById()
  const keyFor = useAttemptKey()
  const [supplier, setSupplier] = useState('')
  const [invoice, setInvoice] = useState('')
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()])
  const [errors, setErrors] = useState<Record<string, LineErrors>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [off, setOff] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const totalCost = lines.reduce((sum, line) => sum + (parseNaira(line.cost) ?? 0) * (Number(line.quantity) || 0), 0)

  const change = (key: string, patch: Partial<LineDraft>) => {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line))
    setErrors(current => ({ ...current, [key]: {} }))
  }
  function addLine() {
    const line = newLine()
    setLines(current => [...current, line])
    focus(`receive-${line.key}-search`)
  }

  async function save() {
    if (busy) return
    const found: Record<string, LineErrors> = {}
    for (const line of lines) { const lineErrors = checkLine(line, today); if (Object.keys(lineErrors).length) found[line.key] = lineErrors }
    setErrors(found); setError('')
    const firstKey = lines.find(line => found[line.key])?.key
    if (firstKey) {
      const field = Object.keys(found[firstKey]!)[0]
      return focus(field === 'item' ? `receive-${firstKey}-search` : `receive-${firstKey}-${field}`)
    }
    const receipt: StockReceipt = {
      supplier: supplier.trim() || null, invoiceNumber: invoice.trim() || null,
      lines: lines.map(line => ({ catalogueItemId: line.item!.id, batchNumber: line.batch.trim(), expiresOn: line.expires,
        quantity: Number(line.quantity), unitCostKobo: line.cost.trim() ? parseNaira(line.cost) : null })),
    }
    setBusy(true)
    const result = await commerce.receiveStock(facilityId, receipt, keyFor(JSON.stringify([facilityId, receipt])))
    setBusy(false)
    if (result.ok) { setSaved(receipt.lines.length); focus('receive-done'); return }
    if (result.notAvailable) { setOff(true); focus('receive-off'); return }
    setError(result.error)
  }
  function again() {
    setSupplier(''); setInvoice(''); setLines([newLine()]); setErrors({}); setSaved(null)
    focus('receive-supplier')
  }

  if (saved !== null) return <FormPage title="Receive stock" back={BACK}>
    <Card className="ring-success/40">
      <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-8" aria-hidden /></span>
        <h2 id="receive-done" tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">Stock received</h2>
        <p className="m-0 text-body text-ink-2">{saved} {saved === 1 ? 'line' : 'lines'} added to the shelf{supplier.trim() ? ` from ${supplier.trim()}` : ''}.</p>
        <div className="mt-2 flex w-full max-w-sm flex-col gap-2">
          <Button variant="primary" size="lg" block to="/provider/pharmacy/stock">Back to stock</Button>
          <Button block icon={Plus} onClick={again}>Receive another delivery</Button>
        </div>
      </div>
    </Card>
  </FormPage>

  return <FormPage title="Receive stock" back={BACK} wide description="A delivery, line by line, as written on the packs and the invoice.">
    <Step n={1} title="Delivery" hint="Optional, but helps find it later.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="receive-supplier" optional>
          <Input id="receive-supplier" value={supplier} maxLength={200} autoComplete="off" className="h-11" onChange={event => setSupplier(event.target.value)} />
        </Field>
        <Field label="Invoice number" htmlFor="receive-invoice" optional>
          <Input id="receive-invoice" value={invoice} maxLength={80} autoComplete="off" className="h-11" onChange={event => setInvoice(event.target.value)} />
        </Field>
      </div>
    </Step>
    <Step n={2} title="Items received">
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {lines.map((line, index) => <ReceiveLine key={line.key} n={index + 1} facilityId={facilityId} line={line} errors={errors[line.key] ?? {}} today={today}
          onChange={patch => change(line.key, patch)}
          onRemove={lines.length > 1 ? () => { setLines(current => current.filter(other => other.key !== line.key)); focus('receive-add') } : undefined} />)}
      </ol>
      <Button id="receive-add" icon={Plus} className="self-start" onClick={addLine}>Add another item</Button>
      {totalCost > 0 ? <p className="m-0 text-[15px] text-ink-2">Delivery cost: <strong className="text-ink tabular">{naira(totalCost)}</strong></p> : null}
    </Step>
    {off ? <div id="receive-off" tabIndex={-1} className="outline-none"><NotSwitchedOn message={NOT_SET_UP_UNSAVED} /></div> : null}
    {error ? <Alert intent="error" title="The stock wasn’t saved">{error} Check it and try again: the same delivery won’t be added twice.</Alert> : null}
    <FormActions>
      <Button to="/provider/pharmacy/stock">Cancel</Button>
      <Button variant="primary" size="lg" icon={PackagePlus} aria-busy={busy || undefined} aria-disabled={busy || off || undefined}
        onClick={() => { if (!off) void save() }}>{busy ? 'Saving…' : 'Save stock received'}</Button>
    </FormActions>
  </FormPage>
}

function ReceiveLine({ n, facilityId, line, errors, today, onChange, onRemove }: {
  readonly n: number; readonly facilityId: string; readonly line: LineDraft; readonly errors: LineErrors; readonly today: string
  readonly onChange: (patch: Partial<LineDraft>) => void; readonly onRemove?: () => void
}) {
  const id = `receive-${line.key}`
  const described = (field: keyof LineErrors) => errors[field] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-${field}-error` } : {}
  return <li className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-inset ring-line">
    <div className="flex items-center justify-between gap-2">
      <h4 className="m-0 text-[15px] font-semibold text-ink">Item {n}</h4>
      {onRemove ? <Button variant="danger" size="sm" icon={Trash2} aria-label={`Remove item ${n}`} onClick={onRemove}>Remove</Button> : null}
    </div>
    <ItemChooser id={id} facilityId={facilityId} item={line.item} error={errors.item} onChoose={item => onChange({ item })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Batch number" htmlFor={`${id}-batch`} error={errors.batch} errorId={`${id}-batch-error`}>
        <Input id={`${id}-batch`} {...described('batch')} value={line.batch} maxLength={80} autoComplete="off" className="h-11" onChange={event => onChange({ batch: event.target.value })} />
      </Field>
      <Field label="Expiry date" htmlFor={`${id}-expires`} error={errors.expires} errorId={`${id}-expires-error`}>
        <Input id={`${id}-expires`} {...described('expires')} type="date" min={today} value={line.expires} className="h-11" onChange={event => onChange({ expires: event.target.value })} />
      </Field>
      <Field label="Quantity" htmlFor={`${id}-quantity`} error={errors.quantity} errorId={`${id}-quantity-error`} hint="In the unit you count on the shelf." hintId={`${id}-quantity-hint`}>
        <Input id={`${id}-quantity`} {...described('quantity')} aria-describedby={errors.quantity ? `${id}-quantity-error` : `${id}-quantity-hint`} type="number" inputMode="numeric" min={1}
          value={line.quantity} className="h-11" onChange={event => onChange({ quantity: event.target.value })} />
      </Field>
      <Field label="Cost each (₦)" htmlFor={`${id}-cost`} optional error={errors.cost} errorId={`${id}-cost-error`}>
        <Input id={`${id}-cost`} {...described('cost')} inputMode="decimal" value={line.cost} placeholder="1,250.00" className="h-11" onChange={event => onChange({ cost: event.target.value })} />
      </Field>
    </div>
  </li>
}

/** Which price-list item a line is: search and tap, or the chosen one with Change. */
function ItemChooser({ id, facilityId, item, error, onChoose }: {
  readonly id: string; readonly facilityId: string; readonly item: CatalogueItem | null; readonly error?: string
  readonly onChoose: (item: CatalogueItem | null) => void
}) {
  const [query, setQuery] = useState('')
  const search = useCatalogueSearch(facilityId, 'drug', item ? '' : query, false)
  if (item) return <div className="flex items-center gap-3">
    <ItemCover imageUrl={item.imageUrl} form={drugFormFromCatalogue(item.form)} />
    <div className="min-w-0 flex-1">
      <p className="m-0 text-[16px] font-semibold text-ink">{item.name}</p>
      {item.strength || item.packSize ? <p className="m-0 text-[13px] text-ink-2">{[item.strength, item.packSize].filter(Boolean).join(' · ')}</p> : null}
    </div>
    <Button variant="ghost" aria-label={`Change item: ${item.name}`} onClick={() => onChoose(null)}>Change</Button>
  </div>
  return <Field label="Item" htmlFor={`${id}-search`} error={error} errorId={`${id}-item-error`}>
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
      <Input id={`${id}-search`} type="search" value={query} autoComplete="off" placeholder="Search the price list" className="h-11"
        style={{ paddingLeft: '2.5rem' }} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-item-error` : undefined}
        onChange={event => setQuery(event.target.value)} />
    </div>
    {query.trim() && search.list.length > 0 ? <ul aria-label="Matching items" className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
      {search.list.slice(0, 6).map(({ item: option }) => <li key={option.id}>
        <button type="button" onClick={() => onChoose(option)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border-0 bg-transparent px-3 py-2 text-left text-[15px] text-ink ring-1 ring-inset ring-line hover:bg-subtle">
          <span className="min-w-0">{option.name}{option.strength ? <span className="text-ink-2"> · {option.strength}</span> : null}</span>
          <Plus className="size-4 shrink-0 text-ink-3" aria-hidden />
        </button>
      </li>)}
    </ul> : null}
    {query.trim() && search.status === 'ready' && search.list.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing on the price list matches. Add it to the price list first.</p> : null}
  </Field>
}
