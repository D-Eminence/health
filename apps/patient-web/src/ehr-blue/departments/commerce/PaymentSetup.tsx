import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Switch } from '../../../kasuwa/interactive'
import { Alert, Button, Field, Input, PageHeader, Select, Textarea, cx } from '../../../kasuwa/ui'
import { naira } from './money'
import { useCommerceRead } from './useCommerceRead'
import { FormActions, FormPage, LoadingRows, Step } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, METHOD_LABEL, PAYMENT_METHODS, type CatalogueItem, type DayCloseBy, type ListPage, type PaymentMethod, type PaymentSettings } from './api'
import { BILLING_OFF, NOT_SWITCHED_ON, NotSwitchedOn } from './NotSwitchedOn'

const WHERE: readonly { value: PaymentSettings['wherePaid']; title: string; hint: string }[] = [
  { value: 'cashier', title: 'At the cashier', hint: 'Patients pay at one desk, then bring the receipt to the pharmacy or lab.' },
  { value: 'counter', title: 'At the counter', hint: 'The pharmacy and the lab take payment themselves.' },
  { value: 'both', title: 'Either', hint: 'The cashier, or the pharmacy or lab counter.' },
]
const CLOSE_BY: readonly { value: DayCloseBy; title: string; hint: string }[] = [
  { value: 'facility', title: 'Whole facility', hint: 'One day for everyone.' },
  { value: 'cashier', title: 'Each cashier', hint: 'Every staff member opens and closes their own.' },
  { value: 'till', title: 'Each till', hint: 'Pick the till when opening.' },
]
const METHOD_HINT: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Notes and coins. The screen works out the change.',
  pos: 'Card on your POS terminal. Staff type the reference (RRN) on the slip.',
  transfer: 'To the facility’s bank account. Shows “Waiting for check” until someone confirms it arrived.',
  hmo: 'HMO or NHIA cover. Staff choose the HMO and type the approval code. Recorded as owed by the HMO, not as money paid.',
  waiver: 'No charge, with a reason. Only staff allowed to waive can use it.',
}

/** What a facility with no setup answers (BILL-1 §1): pay at the cashier, cash, POS and transfer, nothing waits for payment. */
const DEFAULTS: PaymentSettings = {
  wherePaid: 'cashier', methods: ['cash', 'pos', 'transfer'], payBefore: { pharmacy: false, lab: false }, allowDeferredFor: ['emergency'],
  transferAccount: null, hmos: [], receiptFooter: null, dayCloseBy: 'facility', tills: [], checkInChargeItemId: null,
  payBeforeAvailable: false, onlinePaymentAvailable: false, version: 0,
}

/** An HMO or till as the form keeps it: one already saved keeps its id; a new one has none until it is saved. */
interface Entry { key: string; id?: string; name: string; active: boolean }
const entriesOf = (list: readonly { id: string; name: string; active?: boolean }[]): Entry[] =>
  list.map(entry => ({ key: entry.id, id: entry.id, name: entry.name, active: entry.active !== false }))

/**
 * Payment setup (docs/POINT_OF_CARE_SPEC.md §1): where people pay, the ways this facility takes, whether the pharmacy and
 * the lab wait for payment, the account for transfers, and the HMOs it accepts. Health ID records payments; it never
 * moves money, so the account is only shown to patients paying by transfer.
 */
export function PaymentSetup() {
  const { facilityId } = useDeptAccess()
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  // Payment setup that answers 404: billing is not switched on here.
  if (settings.status === 'off') return <div className="flex flex-col gap-5"><PageHeader title="Payment setup" /><NotSwitchedOn message={BILLING_OFF} /></div>
  if (settings.status === 'loading' && settings.data === null) return <div className="flex flex-col gap-5"><PageHeader title="Payment setup" /><LoadingRows rows={4} label="Loading payment setup" /></div>
  if (settings.status === 'error' && settings.data === null) return <div className="flex flex-col gap-5">
    <PageHeader title="Payment setup" />
    <Alert intent="error" title="Couldn’t load payment setup" action={<Button size="sm" onClick={settings.reload}>Try again</Button>}>{settings.error}</Alert>
  </div>
  const initial = settings.data ?? DEFAULTS
  return <SetupForm key={initial.version} initial={initial} onSaved={settings.replace} />
}

function SetupForm({ initial, onSaved }: { readonly initial: PaymentSettings; readonly onSaved: (settings: PaymentSettings) => void }) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const toast = useToast()
  const [wherePaid, setWherePaid] = useState(initial.wherePaid)
  const [methods, setMethods] = useState<readonly PaymentMethod[]>(initial.methods)
  const [payBefore, setPayBefore] = useState(initial.payBefore)
  // Pay before waits for the clinical lead's sign-off (BILL-3): built, and switched off until then.
  const payBeforeOn = initial.payBeforeAvailable === true
  // Emergencies are always served first: always ticked, and it can't be changed (BILL-3).
  const [deferred, setDeferred] = useState<readonly ('emergency' | 'inpatient')[]>(() => ['emergency', ...initial.allowDeferredFor.filter(reason => reason === 'inpatient')])
  const [checkInItem, setCheckInItem] = useState(initial.checkInChargeItemId ?? '')
  const [bankName, setBankName] = useState(initial.transferAccount?.bankName ?? '')
  const [accountName, setAccountName] = useState(initial.transferAccount?.accountName ?? '')
  const [accountNumber, setAccountNumber] = useState(initial.transferAccount?.accountNumber ?? '')
  const [hmos, setHmos] = useState<readonly Entry[]>(() => entriesOf(initial.hmos))
  const [newHmo, setNewHmo] = useState('')
  const [footer, setFooter] = useState(initial.receiptFooter ?? '')
  // A setup saved before these were asked has neither: one day for the whole facility, as before.
  const [closeBy, setCloseBy] = useState<DayCloseBy>(initial.dayCloseBy ?? 'facility')
  const [tills, setTills] = useState<readonly Entry[]>(() => entriesOf(initial.tills ?? []))
  const [newTill, setNewTill] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key] = useState(() => crypto.randomUUID())

  const has = (method: PaymentMethod) => methods.includes(method)
  const services = useCommerceRead<ListPage<CatalogueItem>>(facilityId ? `services:${facilityId}` : null,
    signal => commerce.catalogueItems(facilityId!, { kind: 'other', active: true }, signal))
  const toggle = (method: PaymentMethod, on: boolean) => setMethods(previous => PAYMENT_METHODS.filter(m => m === method ? on : previous.includes(m)))
  const toggleDeferred = (reason: 'emergency' | 'inpatient', on: boolean) =>
    setDeferred(previous => (['emergency', 'inpatient'] as const).filter(r => r === reason ? on : previous.includes(r)))
  const transferStarted = bankName.trim() !== '' || accountName.trim() !== '' || accountNumber.trim() !== ''
  const errors = {
    methods: methods.length === 0 ? 'Choose at least one way to pay.' : null,
    bankName: (has('transfer') || transferStarted) && bankName.trim().length < 2 ? 'Type the bank’s name.' : null,
    accountName: (has('transfer') || transferStarted) && accountName.trim().length < 2 ? 'Type the name on the account.' : null,
    accountNumber: (has('transfer') || transferStarted) && !/^\d{10}$/.test(accountNumber.replace(/\s/g, '')) ? 'Type the 10-digit account number (NUBAN).' : null,
    hmos: has('hmo') && !hmos.some(hmo => hmo.active) ? 'Add at least one HMO, or turn HMO off above.' : null,
    tills: closeBy === 'till' && !tills.some(till => till.active) ? 'Add at least one till, or pick another way above.' : null,
    footer: footer.trim().length > 300 ? 'Keep the line to 300 characters.' : null,
  }
  const blocked = Object.values(errors).some(Boolean)

  function addHmo() {
    const name = newHmo.trim()
    if (name.length < 2 || name.length > 120) return
    const same = hmos.find(hmo => hmo.name.toLowerCase() === name.toLowerCase())
    // One switched off comes back on; a new one has no id until it is saved.
    setHmos(previous => same ? previous.map(hmo => hmo === same ? { ...hmo, active: true } : hmo) : [...previous, { key: crypto.randomUUID(), name, active: true }])
    setNewHmo('')
  }

  function addTill() {
    const name = newTill.trim()
    if (name.length < 2 || name.length > 120) return
    const same = tills.find(till => till.name.toLowerCase() === name.toLowerCase())
    setTills(previous => same ? previous.map(till => till === same ? { ...till, active: true } : till) : [...previous, { key: crypto.randomUUID(), name, active: true }])
    setNewTill('')
  }

  async function save() {
    setTried(true)
    if (!facilityId || blocked) return
    setBusy(true); setProblem(null)
    // An HMO or till is never deleted: one taken off is sent as not active, and keeps its history (BILL-1 §1).
    const entry = ({ id, name, active }: Entry) => ({ ...(id ? { id } : {}), name, active })
    const next = {
      wherePaid, methods: [...methods], payBefore: payBeforeOn ? payBefore : { pharmacy: false, lab: false },
      allowDeferredFor: [...deferred],
      transferAccount: has('transfer') || transferStarted
        ? { bankName: bankName.trim(), accountName: accountName.trim(), accountNumber: accountNumber.replace(/\s/g, '') } : null,
      hmos: hmos.map(entry), receiptFooter: footer.trim() || null, dayCloseBy: closeBy, tills: tills.map(entry),
      checkInChargeItemId: checkInItem || null, expectedVersion: initial.version,
    }
    const result = await commerce.savePaymentSettings(facilityId, next, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: 'Payment setup saved' }); onSaved(result.data); return }
    if (result.notAvailable) { setProblem(NOT_SWITCHED_ON); return }
    setProblem(result.error)
  }

  return (
    <FormPage title="Payment setup" description="How this facility takes payment.">
      <form className="flex flex-col gap-4" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
        <Step n={1} title="Where people pay">
          <div role="radiogroup" aria-label="Where people pay" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
            {WHERE.map(option => {
              const on = option.value === wherePaid
              return (
                <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => setWherePaid(option.value)}
                  className={cx('flex min-h-[44px] cursor-pointer flex-col items-start gap-1 rounded-lg border-0 bg-surface px-3.5 py-3 text-left ring-1 ring-inset',
                    on ? 'ring-2 ring-brand' : 'ring-line hover:ring-line-strong')}>
                  <span className="text-sm font-semibold text-ink">{option.title}</span>
                  <span className="text-[12.5px] text-ink-3">{option.hint}</span>
                </button>
              )
            })}
          </div>
        </Step>

        <Step n={2} title="Ways to pay" hint="Only these show when someone takes payment.">
          {PAYMENT_METHODS.map(method => <Switch key={method} checked={has(method)} onChange={on => toggle(method, on)} label={METHOD_LABEL[method]} description={METHOD_HINT[method]} />)}
          {tried && errors.methods ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.methods}</p> : null}
        </Step>

        <Step n={3} title="Pay before" hint="Whether work waits for payment.">
          {!payBeforeOn ? <p className="m-0 text-[13px] text-ink-2">Not switched on yet. It waits for the clinical lead’s sign-off; until then the pharmacy and the lab never wait for payment.</p> : null}
          <Switch checked={payBeforeOn && payBefore.pharmacy} disabled={!payBeforeOn} onChange={on => setPayBefore(previous => ({ ...previous, pharmacy: on }))}
            label="Pharmacy dispenses only when paid" description={!payBeforeOn ? 'Not switched on yet.' : payBefore.pharmacy ? 'Drugs are handed over once the bill is paid.' : 'Drugs can be handed over before payment.'} />
          <Switch checked={payBeforeOn && payBefore.lab} disabled={!payBeforeOn} onChange={on => setPayBefore(previous => ({ ...previous, lab: on }))}
            label="Lab takes the sample only when paid" description={!payBeforeOn ? 'Not switched on yet.' : payBefore.lab ? 'The sample is taken once the bill is paid.' : 'The sample can be taken before payment.'} />
          <div className="border-t border-line pt-4">
            <p className="m-0 mb-3 text-[13px] font-medium text-ink-2">Serve now, bill follows</p>
            <div className="flex flex-col gap-4">
              <Switch checked disabled onChange={() => undefined} label="Emergencies"
                description="Always: emergency and unknown patients are served first, and their bill follows. This can’t be switched off." />
              <Switch checked={deferred.includes('inpatient')} onChange={on => toggleDeferred('inpatient', on)} label="Admitted patients" description="Added to the bill paid at discharge." />
            </div>
          </div>
        </Step>

        <Step n={4} title="Transfer account" hint={has('transfer') ? 'Shown to staff when a patient pays by transfer.' : 'Only needed when you take transfers.'}>
          <Field label="Bank" htmlFor={`${ids}-bank`} error={tried ? errors.bankName : null} optional={!has('transfer')}>
            <Input id={`${ids}-bank`} autoComplete="off" value={bankName} onChange={event => setBankName(event.target.value)} placeholder="Zenith Bank" aria-invalid={Boolean(tried && errors.bankName)} />
          </Field>
          <Field label="Account name" htmlFor={`${ids}-acname`} error={tried ? errors.accountName : null} optional={!has('transfer')}>
            <Input id={`${ids}-acname`} autoComplete="off" value={accountName} onChange={event => setAccountName(event.target.value)} aria-invalid={Boolean(tried && errors.accountName)} />
          </Field>
          <Field label="Account number" htmlFor={`${ids}-acno`} error={tried ? errors.accountNumber : null} optional={!has('transfer')} hint="10 digits">
            <Input id={`${ids}-acno`} inputMode="numeric" autoComplete="off" maxLength={13} className="tabular" value={accountNumber}
              onChange={event => setAccountNumber(event.target.value)} aria-invalid={Boolean(tried && errors.accountNumber)} />
          </Field>
        </Step>

        <Step n={5} title="HMOs" hint="HMOs and insurers you accept, NHIA included.">
          {hmos.some(hmo => hmo.active) ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
              {hmos.filter(hmo => hmo.active).map(hmo => (
                <li key={hmo.key} className="flex items-center justify-between gap-3 py-1 pr-1 pl-3.5">
                  <span className="min-w-0 break-words text-sm text-ink">{hmo.name}</span>
                  <Button variant="ghost" size="sm" icon={X} aria-label={`Stop accepting ${hmo.name}`} className="size-11 px-0 sm:size-9"
                    onClick={() => setHmos(previous => hmo.id ? previous.map(entry => entry === hmo ? { ...entry, active: false } : entry) : previous.filter(entry => entry !== hmo))} />
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[13px] text-ink-3">No HMOs yet.</p>}
          {hmos.some(hmo => !hmo.active) ? <p className="m-0 text-[13px] text-ink-3">No longer accepted (kept for past bills): {hmos.filter(hmo => !hmo.active).map(hmo => hmo.name).join(', ')}. Add one again to accept it.</p> : null}
          <div className="flex gap-2">
            <Input aria-label="HMO name" placeholder="NHIA, Hygeia HMO…" autoComplete="off" value={newHmo} className="flex-1"
              onChange={event => setNewHmo(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addHmo() } }} />
            <Button icon={Plus} onClick={addHmo} disabled={newHmo.trim().length < 2}>Add HMO</Button>
          </div>
          {tried && errors.hmos ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.hmos}</p> : null}
          <Field label="Line at the foot of each receipt" optional htmlFor={`${ids}-footer`} className="border-t border-line pt-4" error={errors.footer}>
            <Textarea id={`${ids}-footer`} rows={2} value={footer} onChange={event => setFooter(event.target.value)} placeholder="Thank you. Keep this receipt for the pharmacy or lab." />
          </Field>
        </Step>

        <Step n={6} title="Closing the day" hint="Who counts the cash and closes the day.">
          <div role="radiogroup" aria-label="Closing the day" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
            {CLOSE_BY.map(option => {
              const on = option.value === closeBy
              return (
                <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => setCloseBy(option.value)}
                  className={cx('flex min-h-[44px] cursor-pointer flex-col items-start gap-1 rounded-lg border-0 bg-surface px-3.5 py-3 text-left ring-1 ring-inset',
                    on ? 'ring-2 ring-brand' : 'ring-line hover:ring-line-strong')}>
                  <span className="text-sm font-semibold text-ink">{option.title}</span>
                  <span className="text-[12.5px] text-ink-3">{option.hint}</span>
                </button>
              )
            })}
          </div>
          {closeBy === 'till' ? <div className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="m-0 text-[13px] font-medium text-ink-2">Tills</p>
            {tills.some(till => till.active) ? (
              <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
                {tills.filter(till => till.active).map(till => (
                  <li key={till.key} className="flex items-center justify-between gap-3 py-1 pr-1 pl-3.5">
                    <span className="min-w-0 break-words text-sm text-ink">{till.name}</span>
                    <Button variant="ghost" size="sm" icon={X} aria-label={`Stop using ${till.name}`} className="size-11 px-0 sm:size-9"
                      onClick={() => setTills(previous => till.id ? previous.map(entry => entry === till ? { ...entry, active: false } : entry) : previous.filter(entry => entry !== till))} />
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[13px] text-ink-3">No tills yet.</p>}
            <div className="flex gap-2">
              <Input aria-label="Till name" placeholder="Pharmacy till, Lab till…" autoComplete="off" value={newTill} className="flex-1"
                onChange={event => setNewTill(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTill() } }} />
              <Button icon={Plus} onClick={addTill} disabled={newTill.trim().length < 2}>Add till</Button>
            </div>
            {tried && errors.tills ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.tills}</p> : null}
          </div> : null}
        </Step>

        <Step n={7} title="Charge at check-in" hint="Optional: a service every visit's bill starts with, such as the consultation fee.">
          <Field label="Service" htmlFor={`${ids}-checkin`} optional
            hint={services.status === 'off' ? undefined : 'From the price list’s services. Choose none to add nothing at check-in.'}>
            <Select id={`${ids}-checkin`} value={checkInItem} onChange={event => setCheckInItem(event.target.value)}>
              <option value="">None</option>
              {(services.data?.items ?? []).map(item => <option key={item.id} value={item.id}>{item.name} · {naira(item.prices.cashKobo)}</option>)}
              {checkInItem && !(services.data?.items ?? []).some(item => item.id === checkInItem) ? <option value={checkInItem}>The service chosen before</option> : null}
            </Select>
          </Field>
        </Step>

        {tried && blocked ? <Alert intent="error" title="Not saved yet">Check the steps marked above.</Alert> : null}
        {problem ? <Alert intent="error" title="Not saved">{problem}</Alert> : null}
        <FormActions><Button type="submit" variant="primary" loading={busy}>Save setup</Button></FormActions>
      </form>
    </FormPage>
  )
}
