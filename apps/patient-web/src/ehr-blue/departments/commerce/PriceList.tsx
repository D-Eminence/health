import { useId, useMemo, useState } from 'react'
import { FlaskConical, ImagePlus, Pencil, Plus, Search, Tag } from 'lucide-react'
import { Drawer, Segmented, Switch } from '../../../kasuwa/interactive'
import { Alert, Badge, Button, Card, Field, FilterTabs, Input, PageHeader, Select, cx } from '../../../kasuwa/ui'
import { PageState } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { DrugTile } from '../pharmacy/DrugTile'
import type { DrugForm } from '../pharmacy/drugForm'
import { commerce, type CatalogueForm, type CatalogueItem, type CatalogueItemInput, type CatalogueKind, type Hmo, type ListPage, type PaymentSettings } from './api'
import { naira, parseNaira } from './money'
import { NotSwitchedOn } from './NotSwitchedOn'
import { useCommerceRead } from './useCommerceRead'

type Kind = 'all' | CatalogueKind
const KIND_WORD: Readonly<Record<CatalogueKind, string>> = { drug: 'Drug', lab_test: 'Lab test', other: 'Other' }
const FORMS: readonly CatalogueForm[] = ['tablet', 'capsule', 'liquid', 'injection', 'cream', 'inhaler', 'drops', 'other']
const FORM_LABEL: Readonly<Record<CatalogueForm, string>> = {
  tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid (syrup, suspension)', injection: 'Injection', cream: 'Cream or ointment',
  inhaler: 'Inhaler', drops: 'Drops', other: 'Other',
}
/** The price list's form as the pharmacy's line drawing (DrugTile): a liquid is drawn as a syrup bottle. */
const drawn = (form: CatalogueForm | null | undefined): DrugForm => !form ? 'other' : form === 'liquid' ? 'syrup' : form

const matches = (item: CatalogueItem, query: string) => {
  const q = query.trim().toLowerCase()
  return !q || `${item.name} ${item.strength ?? ''} ${item.packSize ?? ''}`.toLowerCase().includes(q)
}

/** The item's picture: its own image when it has one, else the pharmacy's drawing of its form, or a tile for a test. */
export function ItemTile({ item, size = 'md' }: { readonly item: Pick<CatalogueItem, 'kind' | 'form' | 'imageUrl' | 'name'>; readonly size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-24' : 'size-[72px]'
  if (item.imageUrl) return <img src={item.imageUrl} alt="" className={cx('shrink-0 rounded-xl bg-subtle object-cover ring-1 ring-inset ring-line', box)} />
  if (item.kind === 'drug') return <DrugTile form={drawn(item.form)} size={size} />
  const I = item.kind === 'lab_test' ? FlaskConical : Tag
  return (
    <span aria-hidden="true" className={cx('flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-subtle text-ink-3 ring-1 ring-inset ring-line', box)}>
      <I className={size === 'lg' ? 'size-10' : 'size-7'} strokeWidth={1.6} />
      <span className="text-[11px] font-medium leading-none">{item.kind === 'lab_test' ? 'Test' : 'Item'}</span>
    </span>
  )
}

/**
 * Price list (docs/POINT_OF_CARE_SPEC.md §2): what this facility charges for drugs, lab tests and anything else, in cash
 * and for each HMO. Searchable cards; Add and Edit in a drawer, for staff with billing.catalogue.manage.
 */
export function PriceList() {
  const { facilityId, permissions } = useDeptAccess()
  const items = useCommerceRead<ListPage<CatalogueItem>>(facilityId ? `catalogue:${facilityId}` : null, signal => commerce.catalogueItems(facilityId!, {}, signal))
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null)
  const [saved, setSaved] = useState<ReadonlyMap<string, CatalogueItem>>(new Map())
  const canManage = permissions.includes('billing.catalogue.manage')
  const hmos = settings.data?.hmos ?? []

  const all = useMemo(() => {
    const read = items.data?.items ?? []
    const known = new Set(read.map(item => item.id))
    return [...read.map(item => saved.get(item.id) ?? item), ...[...saved.values()].filter(item => !known.has(item.id))]
  }, [items.data, saved])
  const count = (value: Kind) => all.filter(item => value === 'all' || item.kind === value).length
  const shown = all.filter(item => (kind === 'all' || item.kind === kind) && matches(item, query))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Price list" description="What you charge for each drug, test and service: the cash price and each HMO’s price."
        actions={canManage && items.status !== 'off' ? <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add item</Button> : undefined} />
      {items.status === 'off' ? <NotSwitchedOn /> : <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs<Kind> label="Kind of item" value={kind} onChange={setKind} options={[
            { value: 'all', label: 'All', count: count('all') }, { value: 'drug', label: 'Drugs', count: count('drug') },
            { value: 'lab_test', label: 'Lab tests', count: count('lab_test') }, { value: 'other', label: 'Other', count: count('other') },
          ]} />
          <Input icon={Search} type="search" aria-label="Search the price list" placeholder="Search by name" value={query}
            onChange={event => setQuery(event.target.value)} className="sm:w-72" />
        </div>
        <PageState loading={items.status === 'loading'} error={items.status === 'error' ? items.error : null} hasData={items.data !== null}
          onRetry={items.reload} what="the price list" rows={4}
          empty={shown.length === 0 ? { icon: Tag, title: query ? 'Nothing matches that name' : 'No prices yet',
            description: query ? 'Try fewer letters, or the generic name.' : canManage ? 'Add the drugs and tests you charge for.' : undefined } : null}>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map(item => <ItemCard key={item.id} item={item} hmos={hmos} onEdit={canManage ? () => setEditing(item) : null} />)}
          </ul>
        </PageState>
      </>}
      {editing !== null ? (
        <ItemDrawer key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} item={editing === 'new' ? null : editing} hmos={hmos}
          onClose={() => setEditing(null)}
          onSaved={item => { setSaved(previous => new Map(previous).set(item.id, item)); setEditing(null) }} />
      ) : null}
    </div>
  )
}

function ItemCard({ item, hmos, onEdit }: { readonly item: CatalogueItem; readonly hmos: readonly Hmo[]; readonly onEdit: (() => void) | null }) {
  const hmoPrices = (item.prices.hmo ?? []).map(price => ({ ...price, name: hmos.find(hmo => hmo.id === price.hmoId)?.name ?? 'HMO' }))
  return (
    <Card as="li" className={cx('flex gap-4 p-4', !item.active && 'opacity-70')}>
      <ItemTile item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 text-title-3 text-ink">{item.name}{item.strength ? <span className="font-normal text-ink-2"> {item.strength}</span> : null}</p>
            <p className="m-0 text-caption text-ink-3">{KIND_WORD[item.kind]}{item.packSize ? ` · ${item.packSize}` : ''}</p>
          </div>
          {onEdit ? <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit} aria-label={`Edit ${item.name}`} className="max-sm:size-11 max-sm:px-0" /> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.kind === 'drug' ? <Badge size="sm" tone={item.prescriptionOnly ? 'neutral' : 'info'}>{item.prescriptionOnly ? 'Prescription only' : 'Over the counter'}</Badge> : null}
          {!item.active ? <Badge size="sm" tone="warn">Not offered now</Badge> : null}
        </div>
        <dl className="m-0 mt-auto grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[13px]">
          <dt className="text-ink-2">Cash</dt><dd className="m-0 text-right text-title-3 text-ink tabular">{naira(item.prices.cashKobo)}</dd>
          {hmoPrices.map(price => <HmoPrice key={price.hmoId} name={price.name} kobo={price.amountKobo} />)}
        </dl>
      </div>
    </Card>
  )
}

function HmoPrice({ name, kobo }: { readonly name: string; readonly kobo: number }) {
  return <><dt className="truncate text-ink-3">{name}</dt><dd className="m-0 text-right text-ink-2 tabular">{naira(kobo)}</dd></>
}

const kobo = (value: number | undefined) => value === undefined ? '' : (value / 100).toFixed(2)

function ItemDrawer({ item, hmos, onClose, onSaved }: {
  readonly item: CatalogueItem | null; readonly hmos: readonly Hmo[]; readonly onClose: () => void; readonly onSaved: (item: CatalogueItem) => void
}) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const toast = useToast()
  const [kind, setKind] = useState<CatalogueKind>(item?.kind ?? 'drug')
  const [name, setName] = useState(item?.name ?? '')
  const [strength, setStrength] = useState(item?.strength ?? '')
  const [form, setForm] = useState<CatalogueForm | ''>(item?.form ?? '')
  const [packSize, setPackSize] = useState(item?.packSize ?? '')
  const [prescriptionOnly, setPrescriptionOnly] = useState(item?.prescriptionOnly ?? true)
  const [active, setActive] = useState(item?.active ?? true)
  const [cash, setCash] = useState(kobo(item?.prices.cashKobo))
  const [hmoText, setHmoText] = useState<Record<string, string>>(() => Object.fromEntries((item?.prices.hmo ?? []).map(price => [price.hmoId, kobo(price.amountKobo)])))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState(false)
  const [key] = useState(() => crypto.randomUUID())

  const cashKobo = parseNaira(cash)
  const hmoPrices = hmos.flatMap(hmo => {
    const text = hmoText[hmo.id]?.trim() ?? ''
    return text === '' ? [] : [{ hmoId: hmo.id, text, amountKobo: parseNaira(text) }]
  })
  const errors = {
    name: name.trim().length < 2 ? 'Type the name people know it by.' : null,
    cash: cash.trim() === '' ? 'Type the cash price.' : cashKobo === null ? 'Type an amount like 1,500 or 1500.00.' : null,
    hmo: hmoPrices.some(price => price.amountKobo === null) ? 'Each HMO price must be an amount like 1,200, or left empty.' : null,
  }
  const blocked = Object.values(errors).some(Boolean)

  async function save() {
    setTried(true)
    if (!facilityId || blocked || cashKobo === null) return
    setBusy(true); setProblem(null)
    const input: CatalogueItemInput = {
      kind, name: name.trim(),
      strength: kind === 'drug' ? strength.trim() || null : null,
      form: kind === 'drug' && form ? form : null,
      packSize: packSize.trim() || null,
      prescriptionOnly: kind === 'drug' ? prescriptionOnly : false,
      prices: { cashKobo, hmo: hmoPrices.map(price => ({ hmoId: price.hmoId, amountKobo: price.amountKobo! })) },
      active,
    }
    const result = item
      ? await commerce.updateCatalogueItem(facilityId, item.id, { ...input, expectedVersion: item.version }, key)
      : await commerce.createCatalogueItem(facilityId, input, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: item ? 'Price saved' : 'Item added', message: result.data.name }); onSaved(result.data); return }
    if (result.notAvailable) { setOff(true); return }
    setProblem(result.error)
  }

  return (
    <Drawer open onClose={() => { if (!busy) onClose() }} title={item ? `Edit ${item.name}` : 'Add item'}
      description={item ? 'Changes apply to new bills only.' : 'A drug, a lab test or anything else you charge for.'}
      footer={off ? <Button onClick={onClose}>Close</Button> : <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => { void save() }}>{item ? 'Save' : 'Add item'}</Button>
      </>}>
      {off ? <NotSwitchedOn /> : (
        <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save() }}>
          {!item ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2" id={`${ids}-kind`}>What is it?</span>
              <Segmented<CatalogueKind> ariaLabel="What is it?" value={kind} onChange={setKind} className="self-start"
                options={[{ value: 'drug', label: 'Drug' }, { value: 'lab_test', label: 'Lab test' }, { value: 'other', label: 'Other' }]} />
            </div>
          ) : null}

          <div className="flex items-center gap-4">
            <ItemTile item={{ kind, form: form || null, imageUrl: item?.imageUrl ?? null, name }} size="lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${ids}-image`} className="inline-flex h-11 cursor-not-allowed items-center gap-2 self-start rounded-md bg-surface px-4 text-sm font-medium text-ink-3 ring-1 ring-inset ring-line-strong sm:h-10">
                <ImagePlus className="size-4" aria-hidden />Add a picture
              </label>
              <input id={`${ids}-image`} type="file" accept="image/*" disabled className="sr-only" aria-describedby={`${ids}-image-note`} />
              <p id={`${ids}-image-note`} className="m-0 text-caption text-ink-3">Pictures can’t be saved yet. Until they can, a drawing of the form shows instead.</p>
            </div>
          </div>

          <Field label="Name" htmlFor={`${ids}-name`} error={tried ? errors.name : null} errorId={`${ids}-name-error`}>
            <Input id={`${ids}-name`} autoComplete="off" value={name} onChange={event => setName(event.target.value)} data-autofocus=""
              placeholder={kind === 'drug' ? 'Amoxicillin' : kind === 'lab_test' ? 'Full blood count' : 'Wound dressing'}
              aria-invalid={Boolean(tried && errors.name)} aria-describedby={tried && errors.name ? `${ids}-name-error` : undefined} />
          </Field>

          {kind === 'drug' ? <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Strength" optional htmlFor={`${ids}-strength`}>
                <Input id={`${ids}-strength`} autoComplete="off" value={strength} onChange={event => setStrength(event.target.value)} placeholder="500 mg" />
              </Field>
              <Field label="Form" optional htmlFor={`${ids}-form`}>
                <Select id={`${ids}-form`} value={form} onChange={event => setForm(event.target.value as CatalogueForm | '')}>
                  <option value="">Choose</option>
                  {FORMS.map(value => <option key={value} value={value}>{FORM_LABEL[value]}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Pack size" optional htmlFor={`${ids}-pack`} hint="What one unit of this price is: “Strip of 10”, “100 ml bottle”.">
              <Input id={`${ids}-pack`} autoComplete="off" value={packSize} onChange={event => setPackSize(event.target.value)} />
            </Field>
            <Switch checked={prescriptionOnly} onChange={setPrescriptionOnly} label="Prescription only"
              description={prescriptionOnly ? 'Sold only against a prescription.' : 'Can be sold over the counter, without a prescription.'} />
          </> : (
            <Field label={kind === 'lab_test' ? 'Sample or note' : 'Unit'} optional htmlFor={`${ids}-pack`} hint={kind === 'lab_test' ? 'Such as “Blood, EDTA tube”.' : 'Such as “Per dressing”.'}>
              <Input id={`${ids}-pack`} autoComplete="off" value={packSize} onChange={event => setPackSize(event.target.value)} />
            </Field>
          )}

          <Field label="Cash price" htmlFor={`${ids}-cash`} error={tried ? errors.cash : null} errorId={`${ids}-cash-error`}>
            <Input id={`${ids}-cash`} prefix="₦" inputMode="decimal" autoComplete="off" value={cash} onChange={event => setCash(event.target.value)}
              aria-invalid={Boolean(tried && errors.cash)} aria-describedby={tried && errors.cash ? `${ids}-cash-error` : undefined} />
          </Field>

          {hmos.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 text-[13px] font-medium text-ink-2">HMO prices <span className="font-normal text-ink-3">(optional; empty means the cash price)</span></legend>
              {hmos.map(hmo => (
                <div key={hmo.id} className="grid grid-cols-[1fr_9rem] items-center gap-3">
                  <label htmlFor={`${ids}-hmo-${hmo.id}`} className="truncate text-sm text-ink">{hmo.name}</label>
                  <Input id={`${ids}-hmo-${hmo.id}`} prefix="₦" inputMode="decimal" autoComplete="off" value={hmoText[hmo.id] ?? ''}
                    onChange={event => setHmoText(previous => ({ ...previous, [hmo.id]: event.target.value }))} />
                </div>
              ))}
              {tried && errors.hmo ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.hmo}</p> : null}
            </fieldset>
          ) : <p className="m-0 text-caption text-ink-3">Add HMOs in Payment setup to give each its own price.</p>}

          <Switch checked={active} onChange={setActive} label="Offered now" description={active ? 'Shows when making a bill.' : 'Hidden when making a bill; past bills keep it.'} />
          {problem ? <Alert intent="error" title="Not saved">{problem}</Alert> : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Drawer>
  )
}
