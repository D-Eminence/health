import { formatDate, lagosDay } from '@hid/ui/display'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronRight, ListPlus, PackagePlus, PackageX, Search, Settings2, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { Drawer, Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet, PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Field, FilterTabs, Input, PageHeader, Select, Textarea, cx } from '../../../kasuwa/ui'
import { useBluePage } from '../../frame/pageContext'
import { commerce, ITEM_SEARCH_REFUSED, searchForName, searchTextRefused, type CatalogueItem, type ListPage, type StockAdjustment, type StockBatch, type StockLine, type StockMovement } from '../commerce/api'
import { BILLING_OFF, NOT_SET_UP_UNSAVED, NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { useDeptAccess } from '../parts/access'
import { ItemCover } from './pointOfCare'
import { drugFormFromCatalogue } from './pocFields'
import { ReceiveStock } from './ReceiveStock'

/** Batches expiring within this many days are flagged "Expiring soon". */
const SOON_DAYS = 90
const DAY = 86_400_000

type StockTab = 'all' | 'low' | 'expiring'

const dayText = (iso: string) => formatDate(iso, iso)
/** Midnight UTC of a calendar day ("2026-12-01"), to count whole days between two of them. */
const dayStart = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
/**
 * Whole Lagos days from today to a batch's expiry day: 0 on the expiry day itself, which the backend still gives out
 * (0166: a batch is expired only once its day is before today's in Lagos), and below 0 after it.
 */
export const daysLeft = (expiresOn: string, now: number = Date.now()) => Math.round((dayStart(expiresOn) - dayStart(lagosDay(now))) / DAY)
/** Whether a batch is expired, never given out: the server says so; a copy without its word counts Lagos days. */
export const batchExpired = (batch: Pick<StockBatch, 'expiresOn' | 'expired'>, now: number = Date.now()) => batch.expired ?? daysLeft(batch.expiresOn, now) < 0

/** What a line's batches say about expiry: the first batch that has expired or expires soon, if any. */
export function expiryOf(line: Pick<StockLine, 'batches'>, now: number = Date.now()) {
  const batches = line.batches.filter(batch => batch.quantity > 0).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
  const first = batches[0]
  if (!first) return null
  return batchExpired(first, now) ? { kind: 'expired' as const, batch: first }
    : daysLeft(first.expiresOn, now) <= SOON_DAYS ? { kind: 'soon' as const, batch: first } : null
}
/** On hand in expired batches: never given out (BILL-12), waiting for an "Expired" adjustment. */
const expiredOf = (line: StockLine) => line.expiredOnHand ?? line.batches.filter(batch => batch.expired).reduce((sum, batch) => sum + batch.quantity, 0)

/**
 * Stock (POINT_OF_CARE_SPEC §5) at a pharmacy: every item on hand as a card (its picture or drawn form, name, strength,
 * the count with its unit, and low stock or expiring soon in words with an icon), with All, Low and Expiring tabs and a
 * search. A card opens its batches and movements, where a batch can be adjusted with a reason. "Receive stock" records a
 * delivery (pharmacy/stock/receive). A 404 says stock isn't switched on.
 */
export function StockPage() {
  const { rest } = useBluePage()
  return rest.replace(/\/+$/, '') === 'receive' ? <ReceiveStock /> : <StockList />
}

function StockList() {
  const { facilityId, permissions } = useDeptAccess()
  const canRead = permissions.includes('pharmacy.stock.read')
  const canManage = permissions.includes('pharmacy.stock.manage')
  const [tab, setTab] = useState<StockTab>('all')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  // 50 items a page (0166 stock_list): Show more reads the next, and keeps those read before it.
  const [page, setPage] = useState(1)
  const [earlier, setEarlier] = useState<readonly StockLine[]>([])
  const [listed, setListed] = useState(`${tab}:${q}`)
  if (listed !== `${tab}:${q}`) { setListed(`${tab}:${q}`); setPage(1); setEarlier([]) }
  const read = useCommerceRead<ListPage<StockLine>>(facilityId && canRead ? `stock:${facilityId}:${tab}:${q}:${page}` : null,
    signal => commerce.stock(facilityId!, { q, ...(tab === 'all' ? {} : { filter: tab }), page }, signal))
  const [counting, setCounting] = useState(false)
  const lines = useMemo(() => {
    const seen = new Set<string>()
    return [...earlier, ...(read.data?.items ?? [])].filter(line => !seen.has(line.catalogueItemId) && Boolean(seen.add(line.catalogueItemId)))
  }, [earlier, read.data])
  const more = Boolean(read.data?.nextPage)
  // The item open: the list's copy, or (once it is off the pages read) the copy it was opened with or last saved as.
  const [openedCopy, setOpenedCopy] = useState<StockLine | null>(null)
  const opened = openedCopy ? lines.find(line => line.catalogueItemId === openedCopy.catalogueItemId) ?? openedCopy : null
  /** An item as saved or read again, put in its place on every page read, then the page read again. */
  function putInPlace(line: StockLine) {
    const swap = (list: readonly StockLine[]) => list.map(entry => entry.catalogueItemId === line.catalogueItemId ? line : entry)
    setEarlier(swap)
    if (read.data?.items.some(entry => entry.catalogueItemId === line.catalogueItemId)) read.replace({ ...read.data, items: swap(read.data.items) })
    setOpenedCopy(current => current?.catalogueItemId === line.catalogueItemId ? line : current)
    read.reload()
  }
  /** Refused because someone changed the item meanwhile: no route reads one item, so it is found again by its name. */
  async function readAgain(line: StockLine) {
    if (!facilityId) return
    const fresh = await readStockLineAgain(facilityId, line)
    if (fresh) putInPlace(fresh)
    else read.reload()
  }

  if (!facilityId || !canRead) return <div className="flex flex-col gap-6">
    <PageHeader title="Stock" />
    <Alert intent="info" title="You can’t see stock here">Your role here does not include the pharmacy’s stock.</Alert>
  </div>
  if (read.status === 'off') return <div className="flex flex-col gap-6"><PageHeader title="Stock" /><NotSwitchedOn message={BILLING_OFF} /></div>

  return <div className="flex flex-col gap-5">
    <PageHeader title="Stock" description="What is on the shelf, by item. Tap an item for its batches. The batch that expires first is given out first; an expired batch never is."
      actions={canManage ? <>
        <Button icon={ListPlus} onClick={() => setCounting(true)}>Count stock for an item</Button>
        <Button variant="primary" icon={PackagePlus} to="/provider/pharmacy/stock/receive">Receive stock</Button>
      </> : undefined} />
    {/* Stock that answers 404 shows the normal empty state. */}
    <>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:flex-wrap @3xl:items-center @3xl:justify-between">
        <FilterTabs label="Show stock" value={tab} onChange={setTab} options={[
          { value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'expiring', label: 'Expiring' },
        ]} />
        <div className="relative min-w-0 @3xl:w-80">
          <label htmlFor="stock-search" className="sr-only">Search stock</label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
          <Input id="stock-search" type="search" value={query} autoComplete="off" placeholder="Search by name" className="h-11"
            style={{ paddingLeft: '2.5rem' }} onChange={event => setQuery(event.target.value)} />
        </div>
      </div>
      {read.status === 'error' && lines.length > 0 ? <Alert intent="error" title="Couldn’t refresh stock" size="sm"
        action={<Button size="sm" onClick={read.reload}>Try again</Button>}>{read.error} What is shown may be out of date.</Alert> : null}
      <PageState loading={read.status === 'loading' && lines.length === 0} error={lines.length ? null : read.error} hasData={lines.length > 0} onRetry={read.reload}
        what="stock" rows={4} empty={read.status === 'ready' && lines.length === 0 ? (q
          ? { icon: Search, title: 'Nothing matches', description: 'Check the spelling, or search by another name.' }
          : tab === 'low' ? { icon: PackagePlus, title: 'Nothing is running low', description: 'Items at or below their reorder level show here.' }
            : tab === 'expiring' ? { icon: CalendarClock, title: 'Nothing expiring soon', description: `Batches expiring in the next ${SOON_DAYS} days show here.` }
              : { icon: PackagePlus, title: 'No stock yet', description: 'Receive a delivery to start counting what is on the shelf.' }) : null}>
        <ul aria-label="Stock" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
          {lines.map(line => <StockCard key={line.catalogueItemId} line={line} onOpen={() => setOpenedCopy(line)} />)}
        </ul>
      </PageState>
      {more ? <Button className="self-center" loading={read.status === 'loading'}
        onClick={() => { setEarlier(lines); setPage(read.data!.nextPage!) }}>Show more</Button> : null}
    </>
    <StockDrawer facilityId={facilityId} line={opened} canManage={canManage} onClose={() => setOpenedCopy(null)} onChanged={putInPlace}
      onStale={line => { void readAgain(line) }} />
    {counting ? <StockSettingsSheet facilityId={facilityId} line={null} onClose={() => setCounting(false)} onSaved={() => { setCounting(false); read.reload() }}
      onStale={read.reload} /> : null}
  </div>
}

/** One stock line read again: no route reads one, so it is found by its name, on the first few pages of that search. */
async function readStockLineAgain(facilityId: string, line: StockLine): Promise<StockLine | null> {
  const q = searchForName(line.name)
  if (!q) return null
  for (let page = 1; page <= 5; page += 1) {
    const result = await commerce.stock(facilityId, { q, page })
    if (!result.ok) return null
    const found = result.data.items.find(entry => entry.catalogueItemId === line.catalogueItemId)
    if (found || !result.data.nextPage) return found ?? null
  }
  return null
}

function StockCard({ line, onOpen }: { readonly line: StockLine; readonly onOpen: () => void }) {
  const out = line.onHand <= 0
  const low = !out && line.onHand <= line.reorderLevel
  const expiry = expiryOf(line)
  return <li className="min-w-0">
    <button type="button" id={`stock-${line.catalogueItemId}`} onClick={onOpen}
      className={cx('flex w-full cursor-pointer items-start gap-4 rounded-2xl border-0 bg-surface p-4 text-left shadow-[var(--shadow-card)] ring-1 transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
        out ? 'ring-danger/50' : low || expiry ? 'ring-warn/50' : 'ring-line')}>
      <ItemCover imageUrl={line.imageUrl} form={drugFormFromCatalogue(line.form)} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[17px] font-semibold leading-tight text-ink break-words">{line.name}</span>
        {line.strength ? <span className="text-[14px] text-ink-2">{line.strength}</span> : null}
        <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[24px] font-semibold text-ink tabular">{line.onHand}</span>
          <span className="text-[14px] text-ink-2">{line.unit} on hand</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {out ? <Badge size="sm" tone="danger" icon={PackageX}>Out of stock</Badge>
            : low ? <Badge size="sm" tone="warn" icon={TriangleAlert}>Low stock · reorder at {line.reorderLevel}</Badge> : null}
          {expiry ? <Badge size="sm" tone={expiry.kind === 'expired' ? 'danger' : 'warn'} icon={CalendarClock}>
            {expiry.kind === 'expired' ? `Expired ${dayText(expiry.batch.expiresOn)}` : `Expiring soon · ${dayText(expiry.batch.expiresOn)}`}</Badge> : null}
          {expiredOf(line) > 0 ? <Badge size="sm" tone="danger" icon={PackageX}>{expiredOf(line)} {line.unit} expired, not given out</Badge> : null}
        </span>
      </span>
      <ChevronRight className="mt-1 size-5 shrink-0 text-ink-3" aria-hidden />
    </button>
  </li>
}

/** Each kind of stock movement in a word, as the spec names it and in its past tense; any other kind is a stock change. */
const MOVEMENT_WORD: Readonly<Record<string, string>> = {
  receipt: 'Received', received: 'Received', adjustment: 'Adjusted', adjusted: 'Adjusted', dispensing: 'Dispensed', dispensed: 'Dispensed',
  // A reversal corrects the record only: the medicine may never have come back, so it is not "returned".
  sale: 'Sold', sold: 'Sold', counter_sale: 'Sold at the counter', reversal: 'Dispensing reversed', reversed: 'Dispensing reversed',
  dispensing_reversal: 'Dispensing reversed',
}
const REASON_WORD: Readonly<Record<StockAdjustment['reason'], string>> = {
  damaged: 'Damaged', expired: 'Expired', count: 'Count correction', returned: 'Returned to supplier',
}

/** One item's batches and movements, and the Adjust step on a batch. */
function StockDrawer({ facilityId, line, canManage, onClose, onChanged, onStale }: {
  readonly facilityId: string; readonly line: StockLine | null; readonly canManage: boolean
  /** The item as saved: put in its place. */
  readonly onClose: () => void; readonly onChanged: (line: StockLine) => void
  /** A save refused because someone changed the item meanwhile: read it again. */
  readonly onStale: (line: StockLine) => void
}) {
  const movements = useCommerceRead<ListPage<StockMovement>>(line ? `movements:${facilityId}:${line.catalogueItemId}` : null,
    signal => commerce.stockMovements(facilityId, line!.catalogueItemId, signal))
  const [adjusting, setAdjusting] = useState<StockLine['batches'][number] | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [said, setSaid] = useState('')
  useEffect(() => { setSaid('') }, [line?.catalogueItemId])
  if (!line) return null
  const batches = [...line.batches].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
  return <Drawer open onClose={onClose} title={line.name} description={[line.strength, `${line.onHand} ${line.unit} on hand`].filter(Boolean).join(' · ')}
    icon={<ItemCover imageUrl={line.imageUrl} form={drugFormFromCatalogue(line.form)} />}>
    <div className="flex flex-col gap-6">
      <div role="status">{said ? <Alert intent="success" size="sm">{said}</Alert> : null}</div>
      <p className="m-0 text-[14px] text-ink-2">Counted in {line.unit}. Reorder at {line.reorderLevel}.{expiredOf(line) > 0 ? ` ${expiredOf(line)} ${line.unit} in expired batches: never given out.` : ''}</p>
      {canManage ? <Button size="sm" icon={Settings2} className="self-start" onClick={() => setSettingUp(true)}>Stock settings</Button> : null}
      <section aria-labelledby="stock-batches" className="flex flex-col gap-2">
        <h3 id="stock-batches" className="m-0 text-title-3 text-ink">Batches</h3>
        {batches.length === 0 ? <p className="m-0 text-[14px] text-ink-3">No batches on the shelf.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {batches.map(batch => {
            const expired = batchExpired(batch)
            const soon = !expired && daysLeft(batch.expiresOn) <= SOON_DAYS
            return <li key={batch.batchId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset ring-line">
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">Batch {batch.batchNumber}</span>
                <span className={cx('block text-[13px]', expired ? 'font-medium text-danger-ink' : soon ? 'font-medium text-warn-ink' : 'text-ink-3')}>
                  {expired ? 'Expired' : soon ? 'Expiring soon:' : 'Expires'} {dayText(batch.expiresOn)}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-[16px] font-semibold text-ink tabular">{batch.quantity} <span className="text-[13px] font-normal text-ink-2">{line.unit}</span></span>
                {canManage ? <Button size="sm" icon={SlidersHorizontal} aria-label={`Adjust batch ${batch.batchNumber}`} onClick={() => setAdjusting(batch)}>Adjust</Button> : null}
              </span>
            </li>
          })}
        </ul>
      </section>
      <section aria-labelledby="stock-movements" className="flex flex-col gap-2">
        <h3 id="stock-movements" className="m-0 text-title-3 text-ink">Movements</h3>
        <PageState loading={movements.status === 'loading'} error={movements.error} hasData={Boolean(movements.data?.items.length)} onRetry={movements.reload}
            what="movements" rows={2} empty={(movements.status === 'ready' || movements.status === 'off') && !movements.data?.items.length ? { title: 'No movements yet' } : null}>
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {movements.data?.items.map(entry => <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{Object.hasOwn(MOVEMENT_WORD, entry.kind) ? MOVEMENT_WORD[entry.kind] : 'Stock change'}{entry.batchNumber ? ` · Batch ${entry.batchNumber}` : ''}{entry.reason && Object.hasOwn(REASON_WORD, entry.reason) ? ` · ${REASON_WORD[entry.reason as StockAdjustment['reason']]}` : ''}</span>
                  <span className="block text-[13px] text-ink-3">{dayText(entry.at)}{entry.by ? ` · ${entry.by}` : ''}</span>
                </span>
                <span className={cx('shrink-0 text-[15px] font-semibold tabular', entry.change < 0 ? 'text-ink' : 'text-success-ink')}>{entry.change > 0 ? `+${entry.change}` : entry.change}</span>
              </li>)}
            </ul>
          </PageState>
      </section>
    </div>
    <AdjustSheet facilityId={facilityId} line={line} batch={adjusting} onClose={() => setAdjusting(null)}
      onDone={(text, next) => { setAdjusting(null); setSaid(text); movements.reload(); onChanged(next) }} />
    {settingUp ? <StockSettingsSheet facilityId={facilityId} line={line} onClose={() => setSettingUp(false)} onStale={() => onStale(line)}
      onSaved={next => { setSettingUp(false); setSaid(`Counted in ${next.unit}, reorder at ${next.reorderLevel}.`); onChanged(next) }} /> : null}
  </Drawer>
}

/** Adjust one batch, with a reason: what changes, by how much, and why, confirmed before it is saved. */
function AdjustSheet({ facilityId, line, batch, onClose, onDone }: {
  readonly facilityId: string; readonly line: StockLine; readonly batch: StockLine['batches'][number] | null
  readonly onClose: () => void; readonly onDone: (said: string, line: StockLine) => void
}) {
  const [direction, setDirection] = useState<'remove' | 'add'>('remove')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<StockAdjustment['reason'] | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false)
  const key = useRef('')
  const batchId = batch?.batchId
  useEffect(() => {
    if (!batchId) return
    key.current = crypto.randomUUID()
    setDirection('remove'); setAmount(''); setReason(''); setNote(''); setError(''); setOff(false)
  }, [batchId])
  if (!batch) return null
  const quantity = Number(amount)
  async function save() {
    if (busy || !batch) return
    if (!Number.isInteger(quantity) || quantity <= 0) { setError('Type how many, as a whole number.'); return }
    if (direction === 'remove' && quantity > batch.quantity) { setError(`This batch has ${batch.quantity} ${line.unit}. You can’t remove more.`); return }
    if (!reason) { setError('Choose why.'); return }
    if (reason === 'count' && note.trim().length < 3) { setError('Say what the count found.'); return }
    setBusy(true); setError('')
    const change = direction === 'remove' ? -quantity : quantity
    const result = await commerce.adjustStock(facilityId, { catalogueItemId: line.catalogueItemId, batchId: batch.batchId, change, reason, note: note.trim() || null }, key.current)
    setBusy(false)
    if (result.ok) { onDone(`Batch ${batch.batchNumber}: ${change > 0 ? `+${change}` : change} ${line.unit}, ${REASON_WORD[reason].toLowerCase()}.`, result.data); return }
    if (result.notAvailable) { setOff(true); return }
    setError(result.error)
  }
  return <ConfirmSheet open onClose={onClose} title="Adjust stock" busy={busy} confirmLabel="Save adjustment" onConfirm={() => void save()}
    subject={<p className="m-0 text-[15px] font-medium text-ink">{line.name}{line.strength ? ` ${line.strength}` : ''} · Batch {batch.batchNumber} · {batch.quantity} {line.unit}</p>}
    effect="Change the count on the shelf for this batch. Every change is kept, with who made it and why."
    undo="To undo, make another adjustment the other way.">
    <div className="flex flex-col gap-4">
      <Segmented ariaLabel="Add or remove" value={direction} onChange={setDirection} options={[{ value: 'remove', label: 'Remove' }, { value: 'add', label: 'Add' }]} className="self-start" />
      <Field label={`How many ${line.unit}`} htmlFor="adjust-amount">
        <Input id="adjust-amount" type="number" inputMode="numeric" min={1} value={amount} className="h-11" onChange={event => { setAmount(event.target.value); setError('') }} />
      </Field>
      <Field label="Why" htmlFor="adjust-reason">
        <Select id="adjust-reason" value={reason} onChange={event => { setReason(event.target.value as StockAdjustment['reason']); setError('') }}>
          <option value="">Choose a reason</option>
          {(Object.keys(REASON_WORD) as StockAdjustment['reason'][]).map(value => <option key={value} value={value}>{REASON_WORD[value]}</option>)}
        </Select>
      </Field>
      <Field label="Note" htmlFor="adjust-note" optional={reason !== 'count'} hint={reason === 'count' ? 'What the count found.' : undefined}>
        <Textarea id="adjust-note" rows={2} maxLength={500} value={note} onChange={event => { setNote(event.target.value); setError('') }} />
      </Field>
      {off ? <NotSwitchedOn compact message={NOT_SET_UP_UNSAVED} /> : null}
      {error ? <p role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{error}</p> : null}
    </div>
  </ConfirmSheet>
}

/** Stock settings refused because someone changed them meanwhile: read again at once, so the words say so. */
const SETTINGS_CHANGED = 'Someone else changed this item’s stock settings meanwhile. They have been read again: check them, then save again.'
/** Counting started by someone else meanwhile: the drug is on the Stock list now, so it is no longer offered here. */
const COUNTED_MEANWHILE = 'Someone else started counting this drug meanwhile, so it is on the Stock list now. Choose another, or close this.'

/**
 * Stock settings (BILL-1 §7): the unit an item is counted in and its reorder level. For an item already counted, change
 * them (the unit can't change while any batch holds stock: STOCK_UNIT_LOCKED). With no item, choose a drug on the price
 * list whose stock is not counted yet, and start counting it.
 */
function StockSettingsSheet({ facilityId, line, onClose, onSaved, onStale }: {
  readonly facilityId: string; readonly line: StockLine | null; readonly onClose: () => void; readonly onSaved: (line: StockLine) => void
  /** Refused because someone changed the item's stock meanwhile: read it again (nothing was saved). */
  readonly onStale: () => void
}) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  const found = useCommerceRead<ListPage<CatalogueItem>>(!line && q.length >= 2 ? `stock-setup:${facilityId}:${q}` : null,
    signal => commerce.catalogueItems(facilityId, { kind: 'drug', q, active: true }, signal))
  const choices = (found.data?.items ?? []).filter(item => !item.stockKept)
  const [itemId, setItemId] = useState('')
  const [unit, setUnit] = useState(line?.unit ?? '')
  const [reorder, setReorder] = useState(line ? String(line.reorderLevel) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const hasStock = Boolean(line && (line.onHand > 0 || (line.expiredOnHand ?? 0) > 0))
  // The item read again after someone changed it meanwhile: the form shows what they saved, to check before saving again.
  const [shownVersion, setShownVersion] = useState(line?.version)
  if (line && line.version !== shownVersion) { setShownVersion(line.version); setUnit(line.unit); setReorder(String(line.reorderLevel)) }
  async function save() {
    if (busy) return
    const target = line?.catalogueItemId ?? itemId
    const level = Number(reorder)
    if (!target) { setError('Choose the drug.'); return }
    if (unit.trim().length < 1 || unit.trim().length > 40) { setError('Type the unit it is counted in, like tablet or bottle (up to 40 characters).'); return }
    if (!/^\d+$/.test(reorder.trim()) || level > 1_000_000) { setError('Type the reorder level as a whole number, 0 to 1,000,000.'); return }
    setBusy(true); setError('')
    const result = await commerce.stockSettings(facilityId, target, { unit: unit.trim(), reorderLevel: level, expectedVersion: line?.version ?? 0 }, key)
    setBusy(false)
    if (result.ok) { onSaved(result.data); return }
    if (result.notAvailable) { setOff(true); return }
    if (result.code === 'VERSION_CONFLICT' || result.code === 'PRECONDITION_FAILED') {
      // Nothing was saved: the item is read again, and the next press is a new request with the version read.
      setKey(crypto.randomUUID())
      if (line) setError(SETTINGS_CHANGED)
      else { setItemId(''); found.reload(); setError(COUNTED_MEANWHILE) }
      onStale()
      return
    }
    setError(result.error)
  }
  return <ConfirmSheet open onClose={() => { if (!busy) onClose() }} title={line ? 'Stock settings' : 'Count stock for an item'} busy={busy}
    confirmLabel={line ? 'Save settings' : 'Start counting'} onConfirm={() => void save()}
    subject={line ? <p className="m-0 text-[15px] font-medium text-ink">{line.name}{line.strength ? ` ${line.strength}` : ''}</p> : null}
    effect={line ? 'The unit stock is counted and dispensed in, and when it shows as low.' : 'Stock is then counted for this drug: receive it, and dispensing and counter sales take from it.'}
    undo="Change these again at any time. The unit can’t change while there is stock.">
    <div className="flex flex-col gap-4">
      {!line ? <>
        <Field label="Drug" htmlFor="stock-setup-q" hint="Type at least 2 letters of its name.">
          <Input id="stock-setup-q" type="search" autoComplete="off" value={query} className="h-11" onChange={event => { setQuery(event.target.value); setItemId(''); setError('') }} />
        </Field>
        {q.length < 2 ? null
          // A search refused (a Health ID or NIN typed) or failed says so, never "no drug matches"; a failed one with Try again.
          : searchTextRefused(q) ? <p role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{ITEM_SEARCH_REFUSED}</p>
          : found.status === 'error' ? <Alert size="sm" intent="error" title="Couldn’t search the price list"
            action={<Button size="sm" onClick={found.reload}>Try again</Button>}>{found.error}</Alert>
            : <Select aria-label="Choose the drug" value={itemId} onChange={event => { setItemId(event.target.value); setError('') }}>
              <option value="">{found.status === 'loading' ? 'Searching…' : choices.length ? 'Choose the drug' : 'No drug without stock counting matches'}</option>
              {choices.map(item => <option key={item.id} value={item.id}>{item.name}{item.strength ? ` ${item.strength}` : ''}</option>)}
            </Select>}
      </> : null}
      <Field label="Counted in" htmlFor="stock-setup-unit" hint={hasStock ? 'It has stock, so the unit can’t change now.' : 'The smallest unit given out: tablet, capsule, bottle, vial.'}>
        <Input id="stock-setup-unit" autoComplete="off" maxLength={40} value={unit} disabled={hasStock} className="h-11" onChange={event => { setUnit(event.target.value); setError('') }} />
      </Field>
      <Field label="Reorder level" htmlFor="stock-setup-reorder" hint="It shows as low at or below this.">
        <Input id="stock-setup-reorder" type="number" inputMode="numeric" min={0} value={reorder} className="h-11" onChange={event => { setReorder(event.target.value); setError('') }} />
      </Field>
      {off ? <NotSwitchedOn compact message={NOT_SET_UP_UNSAVED} /> : null}
      {error ? <p role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{error}</p> : null}
    </div>
  </ConfirmSheet>
}
