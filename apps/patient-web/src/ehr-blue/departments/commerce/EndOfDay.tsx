import { useId, useState } from 'react'
import { Banknote, BadgeCheck, CreditCard, Landmark, ShieldCheck } from 'lucide-react'
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, StatCard, StatGroup, Textarea, type Icon } from '../../../kasuwa/ui'
import { ConfirmSheet, FormActions, LoadingRows } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod, type Shift } from './api'
import { naira, parseNaira } from './money'
import { NotSwitchedOn } from './NotSwitchedOn'
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

/**
 * End of day (docs/POINT_OF_CARE_SPEC.md §7): open the day with the cash in the drawer; through the day, totals by way of
 * paying; at close, count the cash, see the difference, and close through a confirmation. Nothing here counts money for
 * anyone: the totals are what was recorded on Health ID.
 */
export function EndOfDay() {
  const { facilityId } = useDeptAccess()
  const shift = useCommerceRead<Shift | null>(facilityId ? `shift:${facilityId}` : null, signal => commerce.currentShift(facilityId!, signal))
  const [closed, setClosed] = useState<Shift | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="End of day" description="What was taken today, by way of paying, and the cash count before you close." />
      {shift.status === 'off' ? <NotSwitchedOn />
        : shift.status === 'loading' && shift.data === null ? <LoadingRows rows={3} label="Loading today" />
          : shift.status === 'error' ? <Alert intent="error" title="Couldn’t load today" action={<Button size="sm" onClick={shift.reload}>Try again</Button>}>{shift.error}</Alert>
            : shift.data ? <OpenDay shift={shift.data} onClosed={done => { setClosed(done); shift.replace(null) }} onOff={() => shift.reload()} />
              : <>
                {closed ? <ClosedSummary shift={closed} /> : null}
                <OpenTheDay onOpened={opened => { setClosed(null); shift.replace(opened) }} onOff={() => shift.reload()} />
              </>}
    </div>
  )
}

function OpenTheDay({ onOpened, onOff }: { readonly onOpened: (shift: Shift) => void; readonly onOff: () => void }) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState(false)
  const [key] = useState(() => crypto.randomUUID())
  const toast = useToast()
  const opening = text.trim() === '' ? 0 : parseNaira(text)
  const error = opening === null ? 'Type an amount like 20,000 or 0.' : null

  async function open() {
    setTried(true)
    if (!facilityId || opening === null) return
    setBusy(true); setProblem(null)
    const result = await commerce.openShift(facilityId, opening, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: 'Day opened', message: `Opening cash ${naira(opening)}` }); onOpened(result.data); return }
    if (result.notAvailable) { setOff(true); onOff(); return }
    setProblem(result.error)
  }

  if (off) return <NotSwitchedOn />
  return (
    <Card className="max-w-xl">
      <CardHeader title="Open the day" description="Count the cash in the drawer before the first payment." />
      <form className="flex flex-col gap-4 p-5" onSubmit={event => { event.preventDefault(); void open() }}>
        <Field label="Cash in the drawer now" htmlFor={`${ids}-open`} error={tried ? error : null} errorId={`${ids}-open-error`} hint="Float or change kept from yesterday. ₦0.00 if empty.">
          <Input id={`${ids}-open`} prefix="₦" inputMode="decimal" autoComplete="off" value={text} placeholder="0.00"
            onChange={event => setText(event.target.value)} aria-invalid={Boolean(tried && error)} aria-describedby={tried && error ? `${ids}-open-error` : undefined} />
        </Field>
        {problem ? <Alert intent="error" title="Not opened">{problem}</Alert> : null}
        <FormActions sticky={false}><Button type="submit" variant="primary" loading={busy}>Open day</Button></FormActions>
      </form>
    </Card>
  )
}

function OpenDay({ shift, onClosed, onOff }: { readonly shift: Shift; readonly onClosed: (shift: Shift) => void; readonly onOff: () => void }) {
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
  const taken = totals.filter(total => total.method !== 'waiver').reduce((sum, total) => sum + total.amountKobo, 0)

  async function close() {
    if (!facilityId || counted === null) return
    setBusy(true); setProblem(null)
    const result = await commerce.closeShift(facilityId, shift.id, counted, note.trim() || null, key)
    setBusy(false); setAsking(false)
    if (result.ok) { toast.success({ title: 'Day closed', message: difference !== null ? differenceText(difference) : undefined }); onClosed(result.data); return }
    if (result.notAvailable) { onOff(); return }
    setProblem(result.error)
  }

  return <>
    <p className="m-0 text-sm text-ink-2">Opened {clock(shift.openedAt)} by {shift.openedBy} with <span className="tabular">{naira(shift.openingCashKobo)}</span> in the drawer.</p>
    <StatGroup cols={totals.length >= 4 ? 4 : 3} label="Taken today by way of paying">
      {totals.map(total => (
        <StatCard key={total.method} icon={METHOD_ICON[total.method]} label={METHOD_LABEL[total.method]} value={naira(total.amountKobo)}
          hint={`${total.count} ${total.count === 1 ? 'payment' : 'payments'}`} />
      ))}
    </StatGroup>
    <div className="grid gap-3 md:grid-cols-3">
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

    <ConfirmSheet open={asking} onClose={() => setAsking(false)} busy={busy} title="Close the day?" confirmLabel="Close day"
      subject={counted !== null && difference !== null ? <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-ink-2">Expected</dt><dd className="m-0 text-right text-ink tabular">{naira(shift.expectedCashKobo)}</dd>
        <dt className="text-ink-2">Counted</dt><dd className="m-0 text-right text-ink tabular">{naira(counted)}</dd>
        <dt className="font-semibold text-ink">Difference</dt><dd className="m-0 text-right font-semibold text-ink tabular">{differenceText(difference)}</dd>
      </dl> : null}
      effect="Today’s totals and your count are saved with your name. Payments after this go into the next day."
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
