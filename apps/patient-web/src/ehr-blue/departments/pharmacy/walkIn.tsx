import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, FlaskConical, Minus, Plus, Search, X } from 'lucide-react'
import { Step } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Field, Input, cx } from '../../../kasuwa/ui'
import { commerce, type CatalogueItem, type CatalogueKind, type StockLine as StockRow } from '../commerce/api'
import { naira } from '../commerce/money'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { ItemCover } from './pointOfCare'
import { Breakable } from './PharmacyQueue'
import { drugFormFromCatalogue } from './pocFields'
import type { OrderPhotoUpload, UploadedPhoto } from '../commerce/orderPhoto'

/*
 * The parts the pharmacy's counter (Sell), its paper prescriptions and stock share (POINT_OF_CARE_SPEC §4): a Health ID or
 * phone as typed, the outside order the customer brought, and a fast picker over the price list. Nothing here is saved
 * on its own; the page sends one order at the end. Who the customer is is never asked first (the owner, 2026-10-31).
 */

// ------------------------------------------------------------------- who --
/** A Health ID made here for a customer, after a sale (§4): the facility registration flow, then sent to their email. */
export interface MadeHealthId { readonly hid: string; readonly name: string; readonly email: string | null }

/** "hid-ada 2345", "HIDADA2345" → "HID-ADA2345" (Postel: take it messy, send it clean). */
export function normalizeHealthId(text: string): string {
  const compact = text.toUpperCase().replace(/[\s_-]+/g, '')
  return compact.startsWith('HID') ? `HID-${compact.slice(3)}` : compact
}

/** A Nigerian phone number with or without +234, as digits with its country code: "0803 123 4567" → "+2348031234567". */
export function normalizePhone(text: string): string {
  const digits = text.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('234')) return `+${digits}`
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`
  return digits
}

const fieldProps = (id: string, error?: string, hint = false) => ({
  id, 'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
})

// --------------------------------------------------------- outside order --
export interface OutsideDraft {
  prescriberName: string; facilityName: string; writtenOn: string; email: string; phone: string
  /** The photo of the paper, uploaded when chosen: its preview, and the file id sent as `photoFileId`. */
  photo: UploadedPhoto | null
}
export const EMPTY_OUTSIDE: OutsideDraft = { prescriberName: '', facilityName: '', writtenOn: '', email: '', phone: '', photo: null }
export type OutsideErrors = Partial<Record<'prescriberName' | 'email' | 'writtenOn', string>>

export function checkOutside(outside: OutsideDraft, used: boolean, today = new Date().toISOString().slice(0, 10)): OutsideErrors {
  if (!used) return {}
  const errors: OutsideErrors = {}
  if (!outside.prescriberName.trim()) errors.prescriberName = 'Type the doctor’s name as written.'
  if (outside.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outside.email.trim())) errors.email = 'Type an email like dr.bello@clinic.ng.'
  if (outside.writtenOn && outside.writtenOn > today) errors.writtenOn = 'The date can’t be after today.'
  return errors
}

/** Whether anything of the outside order was filled in. */
export function outsideUsed(outside: OutsideDraft): boolean {
  return Boolean(outside.prescriberName.trim() || outside.facilityName.trim() || outside.writtenOn || outside.email.trim() || outside.phone.trim() || outside.photo)
}

export function outsideOrder(outside: OutsideDraft) {
  return outsideUsed(outside) ? {
    prescriberName: outside.prescriberName.trim(), facilityName: outside.facilityName.trim() || null, writtenOn: outside.writtenOn || null,
    prescriberEmail: outside.email.trim() || null, prescriberPhone: outside.phone.trim() ? normalizePhone(outside.phone) : null, photoFileId: outside.photo?.fileId ?? null,
  } : null
}

export function OutsideFields({ idBase, outside, errors, contact, paper, photoUpload, onChange, onPhoto }: {
  readonly idBase: string; readonly outside: OutsideDraft; readonly errors: OutsideErrors
  /** The page's photo upload (useOrderPhotoUpload), so an upload outlives this step. */
  readonly photoUpload: OrderPhotoUpload
  /** Puts the uploaded photo (or none) in the latest draft. */
  readonly onPhoto: (photo: UploadedPhoto | null) => void
  /** Whether to ask for the doctor's email and phone (the lab sends the result back). */
  readonly contact: boolean
  /** The paper's name: "prescription", "request form". */
  readonly paper: string
  readonly onChange: (next: OutsideDraft) => void
}) {
  const set = (patch: Partial<OutsideDraft>) => onChange({ ...outside, ...patch })
  const today = new Date().toISOString().slice(0, 10)
  // Its own container: two fields side by side by the room it has (in a dialog too), not by the window.
  return <div className="@container flex flex-col gap-4">
    <Field label={contact ? 'Doctor’s name' : 'Prescriber’s name'} htmlFor={`${idBase}-prescriber`} error={errors.prescriberName} errorId={`${idBase}-prescriber-error`}>
      <Input {...fieldProps(`${idBase}-prescriber`, errors.prescriberName)} value={outside.prescriberName} maxLength={200} autoComplete="off" className="h-11"
        placeholder="Dr Funmi Adeyemi" onChange={event => set({ prescriberName: event.target.value })} />
    </Field>
    <div className="grid gap-4 @md:grid-cols-2">
      <Field label="Hospital or clinic" htmlFor={`${idBase}-facility`} optional>
        <Input id={`${idBase}-facility`} value={outside.facilityName} maxLength={200} autoComplete="off" className="h-11" onChange={event => set({ facilityName: event.target.value })} />
      </Field>
      <Field label="Date written" htmlFor={`${idBase}-written`} optional error={errors.writtenOn} errorId={`${idBase}-written-error`}>
        <Input {...fieldProps(`${idBase}-written`, errors.writtenOn)} type="date" max={today} value={outside.writtenOn} className="h-11"
          onChange={event => set({ writtenOn: event.target.value })} />
      </Field>
    </div>
    {contact ? <div className="grid gap-4 @md:grid-cols-2">
      <Field label="Doctor’s email" htmlFor={`${idBase}-email`} optional error={errors.email} errorId={`${idBase}-email-error`}
        hint="To send the result when it is ready." hintId={`${idBase}-email-hint`}>
        <Input {...fieldProps(`${idBase}-email`, errors.email, true)} type="email" inputMode="email" value={outside.email} maxLength={254} autoComplete="off" className="h-11"
          onChange={event => set({ email: event.target.value })} />
      </Field>
      <Field label="Doctor’s phone" htmlFor={`${idBase}-dphone`} optional>
        <Input id={`${idBase}-dphone`} type="tel" inputMode="tel" value={outside.phone} maxLength={32} autoComplete="off" className="h-11" onChange={event => set({ phone: event.target.value })} />
      </Field>
    </div> : null}
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink-2">Photo of the {paper} <span className="font-normal text-ink-3">(optional)</span></span>
      {outside.photo
        ? <div className="flex flex-wrap items-start gap-3">
          <img src={outside.photo.preview} alt={`The ${paper}, as photographed`} className="max-h-48 max-w-[60%] rounded-lg object-contain ring-1 ring-line" />
          <Button icon={X} onClick={() => { photoUpload.release(outside.photo); onPhoto(null) }}>Remove photo</Button>
        </div>
        : <label className={cx('inline-flex min-h-11 items-center gap-2 self-start rounded-md bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong shadow-[var(--shadow-xs)] focus-within:shadow-[var(--shadow-focus)]',
          photoUpload.uploading ? 'cursor-progress' : 'cursor-pointer hover:bg-subtle')}>
          <Camera className="size-4" aria-hidden />{photoUpload.uploading ? 'Uploading the photo…' : 'Take or choose a photo'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoUpload.uploading}
            aria-invalid={photoUpload.error ? true : undefined} aria-describedby={photoUpload.error ? `${idBase}-photo-error` : undefined}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void photoUpload.upload(file).then(photo => { if (photo) onPhoto(photo) })
            }} />
        </label>}
      {photoUpload.error ? <p id={`${idBase}-photo-error`} role="alert" className="m-0 text-xs font-medium text-danger-ink">{photoUpload.error}</p> : null}
    </div>
  </div>
}

// ---------------------------------------------------------------- picker --
/** A price-list item with its stock on hand, when Pharmacy sends stock. */
export interface PickItem { readonly item: CatalogueItem; readonly stock: StockRow | null }

/**
 * The price list, searched as typed (kind: drugs or lab tests), with stock joined in for drugs where it is read. A price
 * list that answers 404 reads as an empty one.
 */
export function useCatalogueSearch(facilityId: string, kind: CatalogueKind, query: string, withStock: boolean) {
  const [q, setQ] = useState(query)
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 200); return () => clearTimeout(timer) }, [query])
  const items = useCommerceRead(`catalogue:${facilityId}:${kind}:${q}`, signal => commerce.catalogueItems(facilityId, { kind, q }, signal))
  const stock = useCommerceRead(withStock ? `stock:${facilityId}:${q}` : null, signal => commerce.stock(facilityId, { q }, signal))
  const byId = new Map((stock.data?.items ?? []).map(line => [line.catalogueItemId, line]))
  const list: PickItem[] = (items.data?.items ?? []).filter(item => item.active).map(item => ({ item, stock: byId.get(item.id) ?? null }))
  const status = items.status === 'off' ? 'ready' as const : items.status
  return { status, error: items.error, list, reload: items.reload, searching: q !== query.trim() || items.status === 'loading' }
}

/** One result: a big card, the whole card a button that adds it (or says why it can't). */
export function PickCard({ entry, chosen, blockedWhy, onPick }: {
  readonly entry: PickItem; readonly chosen: number; readonly blockedWhy: string | null; readonly onPick: () => void
}) {
  const { item, stock } = entry
  const out = stock !== null && stock.onHand <= 0
  const why = blockedWhy ?? (out ? 'Out of stock' : null)
  const label = `${item.name}${item.strength ? ` ${item.strength}` : ''}`
  return <li className="@container min-w-0">
    <button type="button" onClick={onPick} aria-disabled={why ? true : undefined}
      aria-label={`${chosen ? (item.kind === 'drug' ? 'Add one more' : 'Remove') : 'Add'}: ${label}, ${naira(item.prices.cashKobo)}${why ? `. ${why}` : ''}`}
      className={cx('relative flex min-h-24 w-full cursor-pointer flex-col items-start gap-3 rounded-2xl border-0 bg-surface p-3 text-left ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
        chosen ? 'ring-2 ring-brand' : 'ring-line hover:bg-subtle', why && 'cursor-not-allowed opacity-70 hover:bg-surface', '@[15rem]:flex-row')}>
      {item.kind === 'lab_test'
        ? <span aria-hidden="true" className="flex size-[72px] shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-3 ring-1 ring-inset ring-line"><FlaskConical className="size-8" strokeWidth={1.6} /></span>
        : <ItemCover imageUrl={item.imageUrl} form={drugFormFromCatalogue(item.form)} />}
      <span className="flex w-full min-w-0 flex-1 flex-col gap-0.5 pr-7">
        <span className="text-[16px] font-semibold leading-snug text-ink break-words"><Breakable text={item.name} /></span>
        {item.strength || item.packSize ? <span className="text-[13px] text-ink-2">{[item.strength, item.packSize].filter(Boolean).join(' · ')}</span> : null}
        <span className="mt-1 text-[17px] font-semibold text-ink tabular">{naira(item.prices.cashKobo)}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {item.kind === 'drug' && item.prescriptionOnly ? <Badge size="sm" tone="violet" className="max-w-full">Prescription only</Badge> : null}
          {stock ? <span className={cx('text-[13px] font-medium tabular', out ? 'text-danger-ink' : stock.onHand <= stock.reorderLevel ? 'text-warn-ink' : 'text-ink-3')}>
            {out ? 'Out of stock' : `${stock.onHand} ${stock.unit} in stock${stock.onHand <= stock.reorderLevel ? ', running low' : ''}`}</span> : null}
          {chosen ? <Badge size="sm" tone="brand" icon={Check}>{item.kind === 'drug' ? `${chosen} added` : 'Added'}</Badge> : null}
        </span>
        {blockedWhy ? <span className="text-[13px] font-medium text-warn-ink">{blockedWhy}</span> : null}
      </span>
      <Plus className="absolute top-4 right-3 size-5 shrink-0 text-ink-3" aria-hidden />
    </button>
  </li>
}

/** The picker: a large search box (focused as the step opens) and the results as cards. */
export function CataloguePicker({ facilityId, kind, searchId, withStock, chosen, blockedWhy, onPick, emptyWord }: {
  readonly facilityId: string; readonly kind: CatalogueKind; readonly searchId: string; readonly withStock: boolean
  readonly chosen: (itemId: string) => number
  readonly blockedWhy: (item: CatalogueItem) => string | null
  readonly onPick: (entry: PickItem) => void
  /** "medicines", "tests". */
  readonly emptyWord: string
}) {
  const [query, setQuery] = useState('')
  const search = useCatalogueSearch(facilityId, kind, query, withStock)
  return <div className="flex flex-col gap-3">
    <label htmlFor={searchId} className="sr-only">Search the price list</label>
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input id={searchId} type="search" value={query} autoComplete="off" placeholder={`Search ${emptyWord} by name`}
        className="h-12 text-base" style={{ paddingLeft: '2.75rem' }} onChange={event => setQuery(event.target.value)} />
    </div>
    <div role="status" aria-live="polite" className="sr-only">{search.searching ? 'Searching' : `${search.list.length} found`}</div>
    {search.status === 'error' && search.list.length === 0 ? <Alert intent="error" title="Couldn’t search the price list"
      action={<Button size="sm" onClick={search.reload}>Try again</Button>}>{search.error}</Alert> : null}
    {search.status === 'loading' && search.list.length === 0 ? <p className="m-0 text-[14px] text-ink-3">Loading the price list…</p> : null}
    {search.status === 'ready' && search.list.length === 0
      ? <p className="m-0 text-[14px] text-ink-2">{query.trim() ? `No ${emptyWord} match “${query.trim()}”. Check the spelling.` : `No ${emptyWord} on the price list yet.`}</p> : null}
    {search.list.length > 0 ? <ul aria-label="Price list" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3 p-0">
      {search.list.map(entry => <PickCard key={entry.item.id} entry={entry} chosen={chosen(entry.item.id)} blockedWhy={blockedWhy(entry.item)}
        onPick={() => { if (!blockedWhy(entry.item) && !(entry.stock && entry.stock.onHand <= 0)) onPick(entry) }} />)}
    </ul> : null}
  </div>
}

/** A quantity stepper: big − and + either side of the number, which can also be typed. */
export function Stepper({ id, label, value, max, onChange }: {
  readonly id: string; readonly label: string; readonly value: number; readonly max?: number; readonly onChange: (next: number) => void
}) {
  const top = max ?? 9999
  return <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
    <Button size="md" icon={Minus} aria-label={`One less: ${label}`} className="!px-0 w-11" onClick={() => onChange(Math.max(1, value - 1))} />
    <input id={id} type="number" inputMode="numeric" min={1} max={top} value={value} aria-label={`Quantity: ${label}`}
      onChange={event => { const next = Math.floor(Number(event.target.value)); if (Number.isFinite(next) && next >= 1) onChange(Math.min(next, top)) }}
      className="h-11 w-16 rounded-md border-0 bg-surface text-center text-[17px] font-semibold text-ink tabular ring-1 ring-inset ring-line-control focus:outline-none focus:ring-brand" />
    <Button size="md" icon={Plus} aria-label={`One more: ${label}`} className="!px-0 w-11" onClick={() => onChange(Math.min(top, value + 1))} />
  </div>
}

/**
 * One Idempotency-Key per order as typed: sending the same order again (after a lost answer, a refusal) reuses it, so
 * nothing is made twice; a changed order gets a new one. In memory only.
 */
export function useAttemptKey() {
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  return (signature: string) => {
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    return attempt.current.key
  }
}

/** A finished step, folded to one line with a way back into it. */
export function StepSummary({ children, onChange, label }: { readonly children: ReactNode; readonly onChange?: () => void; readonly label: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <p className="m-0 min-w-0 text-[15px] text-ink [overflow-wrap:anywhere]">{children}</p>
    {onChange ? <Button variant="ghost" onClick={onChange} aria-label={label}>Change</Button> : null}
  </div>
}

/**
 * One step of a walk-in: open while it is the step being done, folded to one line once done, and not yet shown before
 * it is reached. The step's heading takes focus as it opens.
 */
export function StepCard({ anchor, n, title, hint, current, done, summary, children }: {
  readonly anchor: string; readonly n: number; readonly title: string; readonly hint?: string; readonly current: boolean; readonly done: boolean
  readonly summary?: ReactNode; readonly children: ReactNode
}) {
  if (!current && !done) return null
  return <Step n={n} title={title} hint={current ? hint : undefined} done={done && !current}>
    <span id={anchor} tabIndex={-1} className="sr-only">Step {n}: {title}</span>
    {current ? children : summary}
  </Step>
}
