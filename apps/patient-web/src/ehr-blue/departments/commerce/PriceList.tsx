import { useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FlaskConical, Pencil, Plus, Search, Tag } from 'lucide-react'
import { Drawer, Segmented, Switch } from '../../../kasuwa/interactive'
import { Alert, Badge, Button, Card, CardHeader, Field, FilterTabs, Input, PageHeader, Select, cx } from '../../../kasuwa/ui'
import { PageState } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { DrugTile } from '../pharmacy/DrugTile'
import type { DrugForm } from '../pharmacy/drugForm'
import {
  ITEM_SEARCH_REFUSED, KIND_LABEL, commerce, searchTextRefused,
  type CatalogueForm, type CatalogueItem, type CatalogueItemInput, type CatalogueItemPatch, type CatalogueKind, type Hmo, type ListPage,
  type NationalCodeSystem, type PaymentSettings, type UnpricedCode,
} from './api'
import { naira, parseNaira } from './money'
import { BILLING_OFF, NOT_SET_UP_UNSAVED, NotSwitchedOn } from './NotSwitchedOn'
import { useCommerceRead } from './useCommerceRead'

type Kind = 'all' | CatalogueKind
const ALL_KINDS: readonly CatalogueKind[] = ['drug', 'lab_test', 'other']
const KIND_TABS: readonly { value: CatalogueKind; label: string }[] = [{ value: 'drug', label: 'Drugs' }, { value: 'lab_test', label: 'Lab tests' }, { value: 'other', label: 'Services' }]
const FORMS: readonly CatalogueForm[] = ['tablet', 'capsule', 'liquid', 'injection', 'cream', 'inhaler', 'drops', 'other']
const FORM_LABEL: Readonly<Record<CatalogueForm, string>> = {
  tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid (syrup, suspension)', injection: 'Injection', cream: 'Cream or ointment',
  inhaler: 'Inhaler', drops: 'Drops', other: 'Other',
}
/**
 * The lists an item of each kind can be linked to by a fixed code: ORD-7's national lists, or for a drug or a test one of
 * this facility's own items (HID-FACILITY, by its id: hid-system #336, 0163).
 */
const CODE_SYSTEMS: Readonly<Record<CatalogueKind, readonly NationalCodeSystem[]>> = {
  drug: ['HID-MED', 'HID-FACILITY'], lab_test: ['LOINC', 'HID-LAB', 'HID-FACILITY'], other: [],
}
const CODE_HINT: Readonly<Record<NationalCodeSystem, string>> = {
  'HID-MED': 'The national medicine code, like MED-00042.', LOINC: 'The test’s LOINC code, like 718-7.', 'HID-LAB': 'The national lab code.',
  'HID-FACILITY': 'One of this facility’s own medicines or tests, by its id.',
}
/** A list's name where it is chosen: the national lists by their own names, a facility item in words. */
const SYSTEM_LABEL: Readonly<Record<NationalCodeSystem, string>> = {
  'HID-MED': 'HID-MED', LOINC: 'LOINC', 'HID-LAB': 'HID-LAB', 'HID-FACILITY': 'This facility’s item',
}
/** A facility item's id as the backend takes it (lower case). */
const FACILITY_ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A linked code in words: "HID-MED MED-00042", or "This facility’s item" (its id means nothing to staff). */
const codeText = (system: string, code: string) => system === 'HID-FACILITY' ? SYSTEM_LABEL['HID-FACILITY'] : `${system} ${code}`
/**
 * The kinds an unpriced code can be priced as: a national medicine code a drug, a national test code a test, and one of
 * this facility's own items either, as the answer does not say which (the backend refuses the wrong one).
 */
const kindsOfCode = (system: string): readonly CatalogueKind[] =>
  system === 'HID-MED' ? ['drug'] : system === 'HID-FACILITY' ? ['drug', 'lab_test'] : ['lab_test']
/** The price list's form as the pharmacy's line drawing (DrugTile): a liquid is drawn as a syrup bottle. */
const drawn = (form: CatalogueForm | null | undefined): DrugForm => !form ? 'other' : form === 'liquid' ? 'syrup' : form
const kindOf = (value: string | null): Kind => value === 'drug' || value === 'lab_test' || value === 'other' ? value : 'all'

/** The item's picture: its own image when it has one, else the pharmacy's drawing of its form, or a tile for a test. */
export function ItemTile({ item, size = 'md' }: { readonly item: Pick<CatalogueItem, 'kind' | 'form' | 'imageUrl' | 'name'>; readonly size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-24' : 'size-[72px]'
  if (item.imageUrl) return <img src={item.imageUrl} alt="" className={cx('shrink-0 rounded-xl bg-subtle object-cover ring-1 ring-inset ring-line', box)} />
  if (item.kind === 'drug') return <DrugTile form={drawn(item.form)} size={size} />
  const I = item.kind === 'lab_test' ? FlaskConical : Tag
  return (
    <span aria-hidden="true" className={cx('flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-subtle text-ink-3 ring-1 ring-inset ring-line', box)}>
      <I className={size === 'lg' ? 'size-10' : 'size-7'} strokeWidth={1.6} />
      <span className="text-[11px] font-medium leading-none">{item.kind === 'lab_test' ? 'Test' : 'Service'}</span>
    </span>
  )
}

/** A national code to price: from "Not on the price list", it opens Add item with the code filled in. */
type Prefill = { kind: CatalogueKind; name: string; system: NationalCodeSystem; code: string }

/**
 * Price list (hid-system BILL-1 §2, on docs/POINT_OF_CARE_SPEC.md §2): the facility's one list of what it charges for and
 * keeps in stock (BILL-7), drugs, lab tests and services (the consultation fee, registration, procedures: BILL-2, the
 * Service catalogue), each at a cash price and, if the facility wants, a price for each HMO it accepts. A drug or test
 * can be linked to the national list by its code, so a prescription or lab request finds its price. Searchable cards;
 * Add and Edit in a drawer, for staff with billing.catalogue.manage, who also see "Not on the price list": the national
 * codes that reached the pharmacy or lab with no price here. `?kind=other` opens it on Services.
 */
export function PriceList({ kinds = ALL_KINDS, title = 'Price list', description = 'What you charge for each drug, test and service: the cash price and each HMO’s price.' }: {
  /** The kinds of item this list shows and adds (Pharmacy's Products & prices: drugs and services). All three if left out. */
  readonly kinds?: readonly CatalogueKind[]
  readonly title?: string
  readonly description?: string
} = {}) {
  const { facilityId, permissions } = useDeptAccess()
  const [params] = useSearchParams()
  const asked = kindOf(params.get('kind'))
  const [kind, setKind] = useState<Kind>(asked !== 'all' && kinds.includes(asked) ? asked : kinds.length === 1 ? kinds[0]! : 'all')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  const refused = searchTextRefused(query)
  const searched = q.length >= 2 && !refused ? q : ''
  const [page, setPage] = useState(1)
  const [earlier, setEarlier] = useState<readonly CatalogueItem[]>([])
  useEffect(() => { setPage(1); setEarlier([]) }, [kind, searched])
  const items = useCommerceRead<ListPage<CatalogueItem>>(facilityId ? `catalogue:${facilityId}:${kind}:${searched}:${page}` : null,
    signal => commerce.catalogueItems(facilityId!, { ...(kind === 'all' ? {} : { kind }), ...(searched ? { q: searched } : {}), page }, signal))
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  const [editing, setEditing] = useState<CatalogueItem | 'new' | Prefill | null>(null)
  const [saved, setSaved] = useState<ReadonlyMap<string, CatalogueItem>>(new Map())
  const [showUnpriced, setShowUnpriced] = useState(false)
  const canManage = permissions.includes('billing.catalogue.manage')
  const hmos = settings.data?.hmos ?? []

  const all = useMemo(() => {
    const seen = new Set<string>()
    const read = [...earlier, ...(items.data?.items ?? [])].filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
    const added = [...saved.values()].filter(item => !seen.has(item.id) && (kind === 'all' || item.kind === kind))
    return [...read.map(item => saved.get(item.id) ?? item), ...added]
  }, [earlier, items.data, saved, kind])
  const shown = all.filter(item => kinds.includes(item.kind))

  if (items.status === 'off') return <div className="flex flex-col gap-5"><PageHeader title={title} /><NotSwitchedOn message={BILLING_OFF} /></div>
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} description={description}
        actions={canManage ? <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add item</Button> : undefined} />
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        {kinds.length > 1 ? <FilterTabs<Kind> label="Kind of item" value={kind} onChange={setKind} options={[
          { value: 'all', label: 'All' }, ...KIND_TABS.filter(tab => kinds.includes(tab.value)),
        ]} /> : <span />}
        <Input icon={Search} type="search" aria-label="Search the price list" placeholder="Search by name" value={query}
          onChange={event => setQuery(event.target.value)} className="@3xl:w-72"
          aria-invalid={refused || undefined} aria-describedby={refused ? 'price-search-refused' : undefined} />
      </div>
      {refused ? <p id="price-search-refused" role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{ITEM_SEARCH_REFUSED}</p> : null}
      {canManage ? <Unpriced facilityId={facilityId} kinds={kinds} open={showUnpriced} onToggle={() => setShowUnpriced(value => !value)}
        onPrice={code => setEditing(code)} /> : null}
      <PageState loading={items.status === 'loading' && all.length === 0} error={items.status === 'error' && all.length === 0 ? items.error : null}
        hasData={all.length > 0 || items.data !== null} onRetry={items.reload} what="the price list" rows={4}
        empty={shown.length === 0 ? { icon: Tag, title: searched ? 'Nothing matches that name' : 'No prices yet',
          description: searched ? 'Try the start of another word of the name, or the generic name.' : canManage ? 'Add the drugs, tests and services you charge for.' : undefined } : null}>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
          {shown.map(item => <ItemCard key={item.id} item={item} hmos={hmos} onEdit={canManage ? () => setEditing(item) : null} />)}
        </ul>
      </PageState>
      {items.data?.nextPage ? <Button className="self-center" loading={items.status === 'loading'}
        onClick={() => { setEarlier(all); setPage(items.data!.nextPage!) }}>Show more</Button> : null}
      {editing !== null ? (
        <ItemDrawer key={editing === 'new' ? 'new' : 'id' in editing ? `${editing.id}:${editing.version}` : `code:${editing.code}`}
          item={editing === 'new' || !('id' in editing) ? null : editing} prefill={editing !== 'new' && !('id' in editing) ? editing : null}
          hmos={hmos.filter(hmo => hmo.active !== false)} allHmos={hmos} kinds={kinds}
          onClose={() => setEditing(null)}
          onSaved={item => { setSaved(previous => new Map(previous).set(item.id, item)); setEditing(null) }} />
      ) : null}
    </div>
  )
}

/** "Not on the price list": national codes that reached the pharmacy or lab in the last 30 days with no price here. */
function Unpriced({ facilityId, kinds, open, onToggle, onPrice }: {
  readonly facilityId: string | null | undefined; readonly kinds: readonly CatalogueKind[]; readonly open: boolean
  readonly onToggle: () => void; readonly onPrice: (prefill: Prefill) => void
}) {
  const read = useCommerceRead<{ items: UnpricedCode[] }>(facilityId && open ? `unpriced:${facilityId}` : null, signal => commerce.unpricedCodes(facilityId!, signal))
  const codes = (read.data?.items ?? []).filter(code => kindsOfCode(code.codeSystem).some(kind => kinds.includes(kind)))
  return <Card>
    <CardHeader as="h2" title="Not on the price list" description="Medicines and tests prescribed or requested here in the last 30 days that have no price. Their bills show “Not billed” until they do."
      actions={<Button size="sm" onClick={onToggle} aria-expanded={open}>{open ? 'Hide' : 'Show'}</Button>} />
    {open ? <div className="px-5 pb-4">
      {read.status === 'loading' ? <p className="m-0 text-sm text-ink-3">Loading…</p>
        : read.status === 'error' ? <Alert size="sm" intent="error" action={<Button size="sm" onClick={read.reload}>Try again</Button>}>{read.error}</Alert>
          : codes.length === 0 ? <p className="m-0 text-sm text-ink-3">Everything that reached the pharmacy or lab has a price.</p>
            : <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {codes.map(code => <li key={`${code.codeSystem}:${code.code}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-ink">{code.display}</span>
                  <span className="block text-caption text-ink-3">{codeText(code.codeSystem, code.code)} · {code.count} {code.count === 1 ? 'time' : 'times'}</span>
                </span>
                <Button size="sm" variant="soft" onClick={() => onPrice({ kind: kindsOfCode(code.codeSystem).find(kind => kinds.includes(kind))!,
                  name: code.display, system: code.codeSystem, code: code.code })}>Add a price</Button>
              </li>)}
            </ul>}
    </div> : null}
  </Card>
}

function ItemCard({ item, hmos, onEdit }: { readonly item: CatalogueItem; readonly hmos: readonly Hmo[]; readonly onEdit: (() => void) | null }) {
  const hmoPrices = (item.prices.hmo ?? []).map(price => ({ ...price, name: hmos.find(hmo => hmo.id === price.hmoId)?.name ?? 'HMO' }))
  return (
    <Card as="li" className={cx('@container flex min-w-0 flex-col gap-4 p-4 @[19rem]:flex-row', !item.active && 'opacity-70')}>
      <ItemTile item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-title-3 text-ink break-words">{item.name}{item.strength ? <span className="font-normal text-ink-2"> {item.strength}</span> : null}</p>
            <p className="m-0 text-caption text-ink-3">{KIND_LABEL[item.kind]}{item.packSize ? ` · ${item.packSize}` : ''}
              {item.nationalCodeSystem && item.nationalCode ? ` · ${codeText(item.nationalCodeSystem, item.nationalCode)}` : ''}</p>
          </div>
          {onEdit ? <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit} aria-label={`Edit ${item.name}`} className="max-sm:size-11 max-sm:px-0" /> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.kind === 'drug' ? <Badge size="sm" tone={item.prescriptionOnly ? 'neutral' : 'info'} className="max-w-full">{item.prescriptionOnly ? 'Prescription only' : 'Over the counter'}</Badge> : null}
          {item.kind === 'drug' && item.stockKept ? <Badge size="sm" tone="neutral">Stock counted</Badge> : null}
          {!item.active ? <Badge size="sm" tone="warn">Not offered now</Badge> : null}
        </div>
        <dl className="m-0 mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[13px]">
          <dt className="text-ink-2">Cash</dt><dd className="m-0 text-right text-title-3 text-ink tabular">{naira(item.prices.cashKobo)}</dd>
          {hmoPrices.map(price => <HmoPrice key={price.hmoId} name={price.name} kobo={price.amountKobo} />)}
        </dl>
      </div>
    </Card>
  )
}

function HmoPrice({ name, kobo }: { readonly name: string; readonly kobo: number }) {
  return <><dt className="min-w-0 break-words text-ink-3">{name}</dt><dd className="m-0 text-right text-ink-2 tabular">{naira(kobo)}</dd></>
}

const kobo = (value: number | undefined) => value === undefined ? '' : (value / 100).toFixed(2)
const MAX_PRICE = 100_000_000
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function ItemDrawer({ item, prefill, hmos, allHmos, kinds = ALL_KINDS, onClose, onSaved }: {
  readonly item: CatalogueItem | null; readonly prefill: Prefill | null; readonly hmos: readonly Hmo[]; readonly allHmos: readonly Hmo[]
  readonly kinds?: readonly CatalogueKind[]; readonly onClose: () => void; readonly onSaved: (item: CatalogueItem) => void
}) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const toast = useToast()
  const [kind, setKind] = useState<CatalogueKind>(item?.kind ?? prefill?.kind ?? kinds[0] ?? 'drug')
  const [name, setName] = useState(item?.name ?? prefill?.name ?? '')
  const [strength, setStrength] = useState(item?.strength ?? '')
  const [form, setForm] = useState<CatalogueForm | ''>(item?.form ?? '')
  const [packSize, setPackSize] = useState(item?.packSize ?? '')
  const [prescriptionOnly, setPrescriptionOnly] = useState(item?.prescriptionOnly ?? true)
  const [system, setSystem] = useState<NationalCodeSystem | ''>(item?.nationalCodeSystem ?? prefill?.system ?? '')
  const [code, setCode] = useState(item?.nationalCode ?? prefill?.code ?? '')
  const [active, setActive] = useState(item?.active ?? true)
  const [cash, setCash] = useState(kobo(item?.prices.cashKobo))
  const [hmoText, setHmoText] = useState<Record<string, string>>(() => Object.fromEntries((item?.prices.hmo ?? []).map(price => [price.hmoId, kobo(price.amountKobo)])))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState(false)
  const [key] = useState(() => crypto.randomUUID())

  const systems = CODE_SYSTEMS[kind]
  const chosenSystem = system && systems.includes(system) ? system : ''
  // A facility item's id is sent in lower case, as the backend keeps it.
  const codeSent = chosenSystem === 'HID-FACILITY' ? code.trim().toLowerCase() : code.trim()
  const cashKobo = parseNaira(cash)
  const hmoPrices = hmos.flatMap(hmo => {
    const text = hmoText[hmo.id]?.trim() ?? ''
    return text === '' ? [] : [{ hmoId: hmo.id, text, amountKobo: parseNaira(text) }]
  })
  const errors = {
    name: name.trim().length < 2 || name.trim().length > 200 ? 'Type the name people know it by (2 to 200 characters).' : null,
    cash: cash.trim() === '' ? 'Type the cash price.' : cashKobo === null ? 'Type an amount like 1,500 or 1500.00.'
      : cashKobo > MAX_PRICE ? 'The most a price can be is ₦1,000,000.00.' : null,
    hmo: hmoPrices.some(price => price.amountKobo === null || price.amountKobo > MAX_PRICE) ? 'Each HMO price must be an amount like 1,200, or left empty.' : null,
    code: chosenSystem === '' ? null : chosenSystem === 'HID-MED' ? /^MED-\d{5}$/.test(codeSent) ? null : 'Type the code like MED-00042.'
      : chosenSystem === 'HID-FACILITY' ? FACILITY_ITEM_ID.test(codeSent) ? null : 'Type the item’s id as the facility’s list gives it (36 characters).'
        : codeSent.length < 1 || codeSent.length > 100 ? 'Type the test’s code.' : null,
    text: kind === 'drug' && (strength.trim().length > 80 || packSize.trim().length > 80) ? 'Keep the strength and pack size to 80 characters each.' : null,
  }
  const blocked = Object.values(errors).some(Boolean)

  async function save() {
    setTried(true)
    if (!facilityId || blocked || cashKobo === null) return
    setBusy(true); setProblem(null)
    // Strength, form and pack size are a drug's only (BILL-1 §2); the national code is both or neither.
    const input: CatalogueItemInput = {
      kind, name: name.trim(),
      strength: kind === 'drug' ? strength.trim() || null : null,
      form: kind === 'drug' && form ? form : null,
      packSize: kind === 'drug' ? packSize.trim() || null : null,
      prescriptionOnly: kind === 'drug' ? prescriptionOnly : false,
      nationalCodeSystem: chosenSystem || null, nationalCode: chosenSystem ? codeSent : null,
      prices: { cashKobo, hmo: hmoPrices.map(price => ({ hmoId: price.hmoId, amountKobo: price.amountKobo! })) },
    }
    let result
    if (item) {
      // Only what changed, with the version read (BILL-1 §2). An HMO no longer accepted keeps no price.
      const patch: CatalogueItemPatch = { expectedVersion: item.version }
      const changed = <K extends keyof CatalogueItemInput>(field: K, before: unknown) => { if (!same(input[field], before)) (patch as Record<string, unknown>)[field] = input[field] }
      changed('name', item.name); changed('strength', item.strength); changed('form', item.form); changed('packSize', item.packSize)
      changed('prescriptionOnly', item.prescriptionOnly); changed('nationalCodeSystem', item.nationalCodeSystem); changed('nationalCode', item.nationalCode)
      const beforeHmo = (item.prices.hmo ?? []).filter(price => hmos.some(hmo => hmo.id === price.hmoId))
      if (input.prices.cashKobo !== item.prices.cashKobo || !same(input.prices.hmo, beforeHmo) || beforeHmo.length !== (item.prices.hmo ?? []).length) patch.prices = input.prices
      if (active !== item.active) patch.active = active
      if (Object.keys(patch).length === 1) { setBusy(false); onClose(); return }
      result = await commerce.updateCatalogueItem(facilityId, item.id, patch, key)
    } else {
      result = await commerce.createCatalogueItem(facilityId, input, key)
    }
    setBusy(false)
    if (result.ok) { toast.success({ title: item ? 'Price saved' : 'Item added', message: result.data.name }); onSaved(result.data); return }
    if (result.notAvailable) { setOff(true); return }
    // Not one of this facility's own items of this kind, in use: in words for a facility item, not "the national list".
    setProblem(result.code === 'NATIONAL_CODE_NOT_FOUND' && chosenSystem === 'HID-FACILITY'
      ? `This is not one of this facility’s ${kind === 'drug' ? 'medicines' : 'lab tests'} in use. Check whether it is a drug or a lab test.`
      : result.error)
  }

  return (
    <Drawer open onClose={() => { if (!busy) onClose() }} title={item ? `Edit ${item.name}` : 'Add item'}
      description={item ? 'Changes apply to lines added from now on. Bills already made keep their price.' : 'A drug, a lab test or a service you charge for.'}
      footer={off ? <Button onClick={onClose}>Close</Button> : <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => { void save() }}>{item ? 'Save' : 'Add item'}</Button>
      </>}>
      {off ? <NotSwitchedOn message={NOT_SET_UP_UNSAVED} /> : (
        <form className="@container flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save() }}>
          {!item && kinds.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2" id={`${ids}-kind`}>What is it?</span>
              <Segmented<CatalogueKind> ariaLabel="What is it?" value={kind} onChange={setKind} className="self-start"
                options={ALL_KINDS.filter(value => kinds.includes(value)).map(value => ({ value, label: KIND_LABEL[value] }))} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <ItemTile item={{ kind, form: form || null, imageUrl: item?.imageUrl ?? null, name }} size="lg" />
            <p className="m-0 min-w-0 flex-1 text-caption text-ink-3">Pictures come later: the price list shows each drug’s form for now.</p>
          </div>

          <Field label="Name" htmlFor={`${ids}-name`} error={tried ? errors.name : null} errorId={`${ids}-name-error`}>
            <Input id={`${ids}-name`} autoComplete="off" maxLength={200} value={name} onChange={event => setName(event.target.value)} data-autofocus=""
              placeholder={kind === 'drug' ? 'Amoxicillin' : kind === 'lab_test' ? 'Full blood count' : 'Consultation'}
              aria-invalid={Boolean(tried && errors.name)} aria-describedby={tried && errors.name ? `${ids}-name-error` : undefined} />
          </Field>

          {kind === 'drug' ? <>
            <div className="grid gap-4 @md:grid-cols-2">
              <Field label="Strength" optional htmlFor={`${ids}-strength`}>
                <Input id={`${ids}-strength`} autoComplete="off" maxLength={80} value={strength} onChange={event => setStrength(event.target.value)} placeholder="500 mg" />
              </Field>
              <Field label="Form" optional htmlFor={`${ids}-form`}>
                <Select id={`${ids}-form`} value={form} onChange={event => setForm(event.target.value as CatalogueForm | '')}>
                  <option value="">Choose</option>
                  {FORMS.map(value => <option key={value} value={value}>{FORM_LABEL[value]}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Pack size" optional htmlFor={`${ids}-pack`} hint="What one unit of this price is: “Strip of 10”, “100 ml bottle”." error={tried ? errors.text : null}>
              <Input id={`${ids}-pack`} autoComplete="off" maxLength={80} value={packSize} onChange={event => setPackSize(event.target.value)} />
            </Field>
            <Switch checked={prescriptionOnly} onChange={setPrescriptionOnly} label="Prescription only"
              description={prescriptionOnly ? 'Sold only against a prescription.' : 'Can be sold over the counter, without a prescription.'} />
          </> : null}

          {systems.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 text-[13px] font-medium text-ink-2">National code <span className="font-normal text-ink-3">(optional; lets a {kind === 'drug' ? 'prescription' : 'lab request'} find this price)</span></legend>
              <div className="grid gap-3 @md:grid-cols-[10rem_minmax(0,1fr)]">
                <Select aria-label="National list" value={chosenSystem} onChange={event => setSystem(event.target.value as NationalCodeSystem | '')}>
                  <option value="">None</option>
                  {systems.map(value => <option key={value} value={value}>{SYSTEM_LABEL[value]}</option>)}
                </Select>
                {chosenSystem ? <Input aria-label="Code" autoComplete="off" spellCheck={false} maxLength={100} value={code} onChange={event => setCode(event.target.value)}
                  placeholder={chosenSystem === 'HID-MED' ? 'MED-00042' : ''} aria-invalid={Boolean(tried && errors.code)}
                  aria-describedby={`${ids}-code-hint`} /> : null}
              </div>
              {chosenSystem ? <p id={`${ids}-code-hint`} className={cx('m-0 text-xs', tried && errors.code ? 'font-medium text-danger-ink' : 'text-ink-3')}>
                {tried && errors.code ? errors.code : CODE_HINT[chosenSystem]}</p> : null}
            </fieldset>
          ) : null}

          <Field label="Cash price" htmlFor={`${ids}-cash`} error={tried ? errors.cash : null} errorId={`${ids}-cash-error`}>
            <Input id={`${ids}-cash`} prefix="₦" inputMode="decimal" autoComplete="off" value={cash} onChange={event => setCash(event.target.value)}
              aria-invalid={Boolean(tried && errors.cash)} aria-describedby={tried && errors.cash ? `${ids}-cash-error` : undefined} />
          </Field>

          {hmos.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 text-[13px] font-medium text-ink-2">HMO prices <span className="font-normal text-ink-3">(optional; a guide for the cashier, bills are at the cash price)</span></legend>
              {hmos.map(hmo => (
                <div key={hmo.id} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3">
                  <label htmlFor={`${ids}-hmo-${hmo.id}`} className="min-w-0 break-words text-sm text-ink">{hmo.name}</label>
                  <Input id={`${ids}-hmo-${hmo.id}`} prefix="₦" inputMode="decimal" autoComplete="off" value={hmoText[hmo.id] ?? ''}
                    onChange={event => setHmoText(previous => ({ ...previous, [hmo.id]: event.target.value }))} />
                </div>
              ))}
              {tried && errors.hmo ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.hmo}</p> : null}
            </fieldset>
          ) : <p className="m-0 text-caption text-ink-3">{allHmos.length ? 'No HMO is accepted now.' : 'Add HMOs in Payment setup to give each its own price.'}</p>}

          {item ? <Switch checked={active} onChange={setActive} label="Offered now" description={active ? 'Shows when making a bill.' : 'Withdrawn: hidden when making a bill; past bills keep it.'} /> : null}
          {problem ? <Alert intent="error" title="Not saved">{problem}</Alert> : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Drawer>
  )
}
