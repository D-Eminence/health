import { useId, useState } from 'react'
import { Banknote, BadgeCheck, CreditCard, Landmark, ShieldCheck, Store } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, SectionHeader, StatCard, StatGroup, Textarea, cx, type Icon } from '../../../kasuwa/ui'
import { ConfirmSheet, FormActions, LoadingRows } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, METHOD_LABEL, PAYMENT_METHODS, type DayCloseBy, type ListPage, type PaymentMethod, type PaymentSettings, type Shift, type Till } from './api'
import { naira, parseNaira } from './money'
import { NOT_SWITCHED_ON } from './NotSwitchedOn'
import { useCommerceRead } from './useCommerceRead'

const METHOD_ICON: Readonly<Record<PaymentMethod, Icon>> = {
  cash: Banknote, pos: CreditCard, transfer: Landmark, hmo: ShieldCheck, waiver: BadgeCheck,
}
const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** "₦500.00 over", "₦200.00 short", "Matches". */
export function differenceText(kobo: number): string {
  if (kobo === 0) return 'Matches'
  return kobo > 0 ? `${naira(kobo)} over` : `${naira(-kobo)} short`
}

/** Payments recorded, waivers left out. */
function takenOf(shift: Shift): number {
  return shift.totals.filter(total => total.method !== 'waiver').reduce((sum, total) => sum + total.amountKobo, 0)
}
const today = () => new Date().toISOString().slice(0, 10)

/** Whose day a panel shows: the facility's, the signed-in cashier's, or one till's. */
type DayOf = { kind: 'facility' } | { kind: 'cashier' } | { kind: 'till'; till: Till }
const dayName = (of: DayOf) => of.kind === 'till' ? `${of.till.name}’s day` : of.kind === 'cashier' ? 'your day' : 'the day'

/**
 * End of day (docs/POINT_OF_CARE_SPEC.md §7): open the day with the cash in the drawer; through the day, totals by way of
 * paying; at close, count the cash, see the difference, and close through a confirmation. Payment setup says whose day it
 * is: the whole facility's (one day for everyone), each cashier's (their own, with an overview of all cashiers for those
 * who manage the days), or each till's (pick the till; every till's state is shown). Nothing here counts money for
 * anyone: the totals are what was recorded on Health ID.
 */
export function EndOfDay() {
  const { facilityId, permissions } = useDeptAccess()
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  // A setup saved before this was asked has no `dayCloseBy`: one day for the whole facility, as before.
  const closeBy: DayCloseBy = settings.status === 'ready' ? settings.data.dayCloseBy ?? 'facility' : 'facility'
  const canManage = permissions.includes('billing.shift.manage')
  const description = closeBy === 'cashier' ? 'Your day: what you took, by way of paying, and your cash count before you close.'
    : closeBy === 'till' ? 'Each till has its own day. Pick a till to open it, or to count its cash and close it.'
      : 'What was taken today, by way of paying, and the cash count before you close.'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="End of day" description={settings.status === 'loading' ? undefined : description} />
      {settings.status === 'loading' && settings.data === null ? <LoadingRows rows={3} label="Loading today" />
        : settings.status === 'error' && settings.data === null
          ? <Alert intent="error" title="Couldn’t load today" action={<Button size="sm" onClick={settings.reload}>Try again</Button>}>{settings.error}</Alert>
          : closeBy === 'cashier' ? <CashierDays canManage={canManage} />
            : closeBy === 'till' && settings.data ? <TillDays tills={settings.data.tills ?? []} />
              : <DayPanel of={{ kind: 'facility' }} />}
    </div>
  )
}

/** One day: open it, or see its totals, count the cash and close it. */
function DayPanel({ of, onChanged }: { readonly of: DayOf; readonly onChanged?: () => void }) {
  const { facilityId } = useDeptAccess()
  const tillId = of.kind === 'till' ? of.till.id : undefined
  const shift = useCommerceRead<Shift | null>(facilityId ? `shift:${facilityId}:${tillId ?? of.kind}` : null,
    signal => commerce.currentShift(facilityId!, tillId ? { tillId } : {}, signal))
  const [closed, setClosed] = useState<Shift | null>(null)
  // A day that answers 404 reads as no day open; opening it then says so (NOT_SWITCHED_ON).
  return shift.status === 'loading' && shift.data === null ? <LoadingRows rows={3} label="Loading today" />
      : shift.status === 'error' ? <Alert intent="error" title="Couldn’t load today" action={<Button size="sm" onClick={shift.reload}>Try again</Button>}>{shift.error}</Alert>
        : shift.data ? <OpenDay of={of} shift={shift.data} onClosed={done => { setClosed(done); shift.replace(null); onChanged?.() }} />
          : <>
            {closed ? <ClosedSummary shift={closed} /> : null}
            <OpenTheDay of={of} onOpened={opened => { setClosed(null); shift.replace(opened); onChanged?.() }} />
          </>
}

/** Each cashier: your own day, and for those who manage the days, every cashier's today. */
function CashierDays({ canManage }: { readonly canManage: boolean }) {
  const { facilityId } = useDeptAccess()
  const [round, setRound] = useState(0)
  const all = useCommerceRead<ListPage<Shift>>(canManage && facilityId ? `shifts:${facilityId}:${today()}:${round}` : null,
    signal => commerce.shifts(facilityId!, { date: today() }, signal))
  return <>
    <section aria-labelledby="eod-yours" className="flex flex-col gap-4">
      <SectionHeader id="eod-yours" title="Your day" description="Opened and closed by you" />
      <DayPanel of={{ kind: 'cashier' }} onChanged={() => setRound(value => value + 1)} />
    </section>
    {canManage ? <section aria-labelledby="eod-cashiers" className="flex flex-col gap-3">
      <SectionHeader id="eod-cashiers" title="All cashiers today" count={all.data?.items.length ?? null} />
      {all.status === 'off' ? null
        : all.status === 'error' && all.data === null ? <Alert intent="error" title="Couldn’t load the cashiers" action={<Button size="sm" onClick={all.reload}>Try again</Button>}>{all.error}</Alert>
          : all.data === null ? <LoadingRows rows={2} label="Loading the cashiers" />
            : all.data.items.length === 0 ? <p className="m-0 text-sm text-ink-3">No one has opened a day yet today.</p>
              : <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3 p-0">
                {all.data.items.map(day => <DayCard key={day.id} title={day.cashierName ?? day.openedBy} shift={day} />)}
              </ul>}
    </section> : null}
  </>
}

/** Each till: every till with its state, the one picked to open or close. */
function TillDays({ tills }: { readonly tills: readonly Till[] }) {
  const { facilityId, permissions } = useDeptAccess()
  const [round, setRound] = useState(0)
  const [picked, setPicked] = useState<string | null>(tills.length === 1 ? tills[0]!.id : null)
  const open = useCommerceRead<ListPage<Shift>>(facilityId ? `shifts-open:${facilityId}:${round}` : null,
    signal => commerce.shifts(facilityId!, { status: 'open' }, signal))
  const openBy = new Map((open.data?.items ?? []).filter(day => day.tillId).map(day => [day.tillId!, day]))
  const till = tills.find(entry => entry.id === picked) ?? null
  if (tills.length === 0) return <EmptyState icon={Store} title="No tills yet" description="Add the tills in Payment setup, then open a day on one."
    action={permissions.includes('billing.settings.manage') ? <Button to="/provider/payment-setup">Payment setup</Button> : undefined} />
  return <>
    <section aria-labelledby="eod-tills" className="flex flex-col gap-3">
      <SectionHeader id="eod-tills" title="Which till?" count={tills.length} />
      {open.status === 'error' && open.data === null ? <Alert intent="error" size="sm" title="Couldn’t check which tills are open"
        action={<Button size="sm" onClick={open.reload}>Try again</Button>}>{open.error}</Alert> : null}
      <div role="radiogroup" aria-labelledby="eod-tills" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
        {tills.map(entry => {
          const day = openBy.get(entry.id)
          const on = entry.id === picked
          return <button key={entry.id} type="button" role="radio" aria-checked={on} onClick={() => setPicked(entry.id)}
            className={cx('flex min-h-[44px] cursor-pointer items-start justify-between gap-3 rounded-xl border-0 bg-surface px-4 py-3 text-left ring-1 ring-inset',
              on ? 'ring-2 ring-brand' : 'ring-line hover:ring-line-strong')}>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink break-words">{entry.name}</span>
              <span className="block text-[13px] text-ink-3">{day ? <>Opened {clock(day.openedAt)} by {day.openedBy} · <span className="tabular">{naira(takenOf(day))}</span> taken</>
                : open.data ? 'Not open' : 'Checking…'}</span>
            </span>
            {open.data ? <Badge size="sm" tone={day ? 'success' : 'neutral'}>{day ? 'Open' : 'Closed'}</Badge> : null}
          </button>
        })}
      </div>
    </section>
    {till ? <section aria-labelledby="eod-till-day" className="flex flex-col gap-4">
      <SectionHeader id="eod-till-day" title={till.name} />
      <DayPanel key={till.id} of={{ kind: 'till', till }} onChanged={() => setRound(value => value + 1)} />
    </section> : null}
  </>
}

/** One cashier's or till's day, as a card in the overview. */
function DayCard({ title, shift }: { readonly title: string; readonly shift: Shift }) {
  const closed = Boolean(shift.closedAt)
  return <li className="flex flex-col gap-2 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{title}</span>
      <Badge size="sm" tone={closed ? 'neutral' : 'success'}>{closed ? 'Closed' : 'Open'}</Badge>
    </div>
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
      <dt className="text-ink-2">Taken</dt><dd className="m-0 text-right text-ink tabular">{naira(takenOf(shift))}</dd>
      <dt className="text-ink-2">Difference</dt><dd className="m-0 text-right font-medium text-ink tabular">
        {closed ? differenceText(shift.differenceKobo ?? 0) : 'Not counted yet'}</dd>
    </dl>
    <p className="m-0 text-caption text-ink-3">{closed && shift.closedAt ? `Closed ${clock(shift.closedAt)}` : `Opened ${clock(shift.openedAt)}`}</p>
  </li>
}

function OpenTheDay({ of, onOpened }: { readonly of: DayOf; readonly onOpened: (shift: Shift) => void }) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key] = useState(() => crypto.randomUUID())
  const toast = useToast()
  const opening = text.trim() === '' ? 0 : parseNaira(text)
  const error = opening === null ? 'Type an amount like 20,000 or 0.' : null
  const title = of.kind === 'till' ? `Open ${of.till.name}` : of.kind === 'cashier' ? 'Open your day' : 'Open the day'

  async function open() {
    setTried(true)
    if (!facilityId || opening === null) return
    setBusy(true); setProblem(null)
    const result = await commerce.openShift(facilityId, opening, of.kind === 'till' ? { tillId: of.till.id } : {}, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: of.kind === 'till' ? `${of.till.name} opened` : 'Day opened', message: `Opening cash ${naira(opening)}` }); onOpened(result.data); return }
    if (result.notAvailable) { setProblem(NOT_SWITCHED_ON); return }
    setProblem(result.error)
  }

  return (
    <Card className="max-w-xl">
      <CardHeader title={title} description={`Count the cash in ${of.kind === 'till' ? 'this till' : 'the drawer'} before the first payment.`} />
      <form className="flex flex-col gap-4 p-5" onSubmit={event => { event.preventDefault(); void open() }}>
        <Field label={of.kind === 'till' ? 'Cash in this till now' : 'Cash in the drawer now'} htmlFor={`${ids}-open`} error={tried ? error : null} errorId={`${ids}-open-error`} hint="Float or change kept from yesterday. ₦0.00 if empty.">
          <Input id={`${ids}-open`} prefix="₦" inputMode="decimal" autoComplete="off" value={text} placeholder="0.00"
            onChange={event => setText(event.target.value)} aria-invalid={Boolean(tried && error)} aria-describedby={tried && error ? `${ids}-open-error` : undefined} />
        </Field>
        {problem ? <Alert intent="error" title="Not opened">{problem}</Alert> : null}
        <FormActions sticky={false}><Button type="submit" variant="primary" loading={busy}>{of.kind === 'till' ? `Open ${of.till.name}` : 'Open day'}</Button></FormActions>
      </form>
    </Card>
  )
}

function OpenDay({ of, shift, onClosed }: { readonly of: DayOf; readonly shift: Shift; readonly onClosed: (shift: Shift) => void }) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const [countedText, setCountedText] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key] = useState(() => crypto.randomUUID())
  const toast = useToast()
  const counted = countedText.trim() === '' ? null : parseNaira(countedText)
  const difference = counted === null ? null : counted - shift.expectedCashKobo
  const error = countedText.trim() === '' ? 'Count the cash in the drawer and type the amount.' : counted === null ? 'Type an amount like 45,500.' : null
  const totals = PAYMENT_METHODS.map(method => shift.totals.find(total => total.method === method) ?? { method, count: 0, amountKobo: 0 })
    .filter(total => total.method !== 'waiver' || total.count > 0)
  const taken = takenOf(shift)

  async function close() {
    if (!facilityId || counted === null) return
    setBusy(true); setProblem(null)
    const result = await commerce.closeShift(facilityId, shift.id, counted, note.trim() || null, key)
    setBusy(false); setAsking(false)
    if (result.ok) { toast.success({ title: 'Day closed', message: difference !== null ? differenceText(difference) : undefined }); onClosed(result.data); return }
    if (result.notAvailable) { setProblem(NOT_SWITCHED_ON); return }
    setProblem(result.error)
  }

  return <>
    <p className="m-0 text-sm text-ink-2">{of.kind === 'till' ? `${of.till.name} opened` : 'Opened'} {clock(shift.openedAt)} by {of.kind === 'cashier' ? 'you' : shift.openedBy} with <span className="tabular">{naira(shift.openingCashKobo)}</span> in the drawer.</p>
    <StatGroup cols={totals.length >= 4 ? 4 : 3} label="Taken today by way of paying">
      {totals.map(total => (
        <StatCard key={total.method} icon={METHOD_ICON[total.method]} label={METHOD_LABEL[total.method]} value={naira(total.amountKobo)}
          hint={`${total.count} ${total.count === 1 ? 'payment' : 'payments'}`} />
      ))}
    </StatGroup>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
      <SummaryLine label="Recorded today" value={naira(taken)} />
      <SummaryLine label="Still unpaid" value={naira(shift.unpaidBills.amountKobo)} hint={`${shift.unpaidBills.count} ${shift.unpaidBills.count === 1 ? 'bill' : 'bills'}`} />
      <SummaryLine label="Bill follows" value={naira(shift.deferredBills.amountKobo)} hint={`${shift.deferredBills.count} ${shift.deferredBills.count === 1 ? 'bill' : 'bills'} (emergency, inpatient)`} />
    </div>

    <Card className="max-w-xl">
      <CardHeader title="Count the cash" description={<>Expected in the drawer: <span className="font-semibold text-ink tabular">{naira(shift.expectedCashKobo)}</span> (opening cash plus cash taken).</>} />
      <form className="flex flex-col gap-4 p-5" onSubmit={event => { event.preventDefault(); setTried(true); if (!error) setAsking(true) }}>
        <Field label="Cash counted" htmlFor={`${ids}-counted`} error={tried ? error : null} errorId={`${ids}-counted-error`}>
          <Input id={`${ids}-counted`} prefix="₦" inputMode="decimal" autoComplete="off" value={countedText} onChange={event => setCountedText(event.target.value)}
            aria-invalid={Boolean(tried && error)} aria-describedby={tried && error ? `${ids}-counted-error` : undefined} />
        </Field>
        {difference !== null ? (
          <p aria-live="polite" className="m-0 flex items-baseline justify-between gap-3 rounded-lg bg-subtle px-4 py-3 ring-1 ring-inset ring-line">
            <span className="text-sm text-ink-2">Difference</span>
            <span className="text-title-3 text-ink tabular">{differenceText(difference)}</span>
          </p>
        ) : null}
        <Field label="Note" optional htmlFor={`${ids}-note`} hint={difference ? 'Say why the cash is over or short, if you know.' : undefined}>
          <Textarea id={`${ids}-note`} rows={2} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
        {problem ? <Alert intent="error" title="Not closed">{problem}</Alert> : null}
        <FormActions sticky={false}><Button type="submit" variant="primary">Close day</Button></FormActions>
      </form>
    </Card>

    <ConfirmSheet open={asking} onClose={() => setAsking(false)} busy={busy} title={`Close ${dayName(of)}?`} confirmLabel={of.kind === 'till' ? `Close ${of.till.name}` : 'Close day'}
      subject={counted !== null && difference !== null ? <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-ink-2">Expected</dt><dd className="m-0 text-right text-ink tabular">{naira(shift.expectedCashKobo)}</dd>
        <dt className="text-ink-2">Counted</dt><dd className="m-0 text-right text-ink tabular">{naira(counted)}</dd>
        <dt className="font-semibold text-ink">Difference</dt><dd className="m-0 text-right font-semibold text-ink tabular">{differenceText(difference)}</dd>
      </dl> : null}
      effect={`Today’s totals and your count are saved with your name. Payments after this go into ${of.kind === 'till' ? 'this till’s' : of.kind === 'cashier' ? 'your' : 'the'} next day.`}
      undo="A closed day can’t be opened again."
      onConfirm={() => { void close() }} />
  </>
}

function SummaryLine({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
      <span className="text-sm text-ink-2">{label}{hint ? <span className="block text-caption text-ink-3">{hint}</span> : null}</span>
      <span className="text-title-3 text-ink tabular">{value}</span>
    </div>
  )
}

function ClosedSummary({ shift }: { readonly shift: Shift }) {
  return (
    <Alert intent="success" title="Day closed">
      {shift.closedAt ? <>Closed {clock(shift.closedAt)}. </> : null}
      Expected <span className="tabular">{naira(shift.expectedCashKobo)}</span>, counted <span className="tabular">{naira(shift.countedCashKobo ?? 0)}</span>: {differenceText(shift.differenceKobo ?? 0)}.
    </Alert>
  )
}
