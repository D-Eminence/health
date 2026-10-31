import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Switch } from '../../../kasuwa/interactive'
import { Alert, Button, Field, Input, PageHeader, Textarea, cx } from '../../../kasuwa/ui'
import { FormActions, FormPage, LoadingRows, Step } from '../../../kasuwa/parts'
import { useToast } from '../../../kasuwa/toast'
import { useDeptAccess } from '../parts/access'
import { commerce, METHOD_LABEL, PAYMENT_METHODS, type Hmo, type PaymentMethod, type PaymentSettings } from './api'
import { NotSwitchedOn } from './NotSwitchedOn'
import { useCommerceRead } from './useCommerceRead'

const WHERE: readonly { value: PaymentSettings['wherePaid']; title: string; hint: string }[] = [
  { value: 'cashier', title: 'At the cashier', hint: 'Patients pay at one desk, then bring the receipt to the pharmacy or lab.' },
  { value: 'counter', title: 'At the counter', hint: 'The pharmacy and the lab take payment themselves.' },
  { value: 'both', title: 'Either', hint: 'The cashier, or the pharmacy or lab counter.' },
]
const METHOD_HINT: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Notes and coins. The screen works out the change.',
  pos: 'Card on your POS terminal. Staff type the reference (RRN) on the slip.',
  transfer: 'To the facility’s bank account. Shows “Waiting for check” until someone confirms it arrived.',
  hmo: 'HMO or NHIA cover. Staff choose the HMO and type the approval code.',
  waiver: 'No charge, with a reason. Only staff allowed to waive can use it.',
}

const DEFAULTS: PaymentSettings = {
  wherePaid: 'cashier', methods: ['cash', 'pos', 'transfer'], payBefore: { pharmacy: true, lab: true }, allowDeferredFor: ['emergency'],
  transferAccount: null, hmos: [], receiptFooter: null, version: 0,
}

/**
 * Payment setup (docs/POINT_OF_CARE_SPEC.md §1): where people pay, the ways this facility takes, whether the pharmacy and
 * the lab wait for payment, the account for transfers, and the HMOs it accepts. Health ID records payments; it never
 * moves money, so the account is only shown to patients paying by transfer.
 */
export function PaymentSetup() {
  const { facilityId } = useDeptAccess()
  const settings = useCommerceRead<PaymentSettings>(facilityId ? `settings:${facilityId}` : null, signal => commerce.paymentSettings(facilityId!, signal))
  const [off, setOff] = useState(false)
  if (off || settings.status === 'off') return <div className="flex flex-col gap-5">
    <PageHeader title="Payment setup" description="How this facility takes payment." />
    <NotSwitchedOn />
  </div>
  if (settings.status === 'loading' && settings.data === null) return <div className="flex flex-col gap-5"><PageHeader title="Payment setup" /><LoadingRows rows={4} label="Loading payment setup" /></div>
  if (settings.status === 'error' && settings.data === null) return <div className="flex flex-col gap-5">
    <PageHeader title="Payment setup" />
    <Alert intent="error" title="Couldn’t load payment setup" action={<Button size="sm" onClick={settings.reload}>Try again</Button>}>{settings.error}</Alert>
  </div>
  const initial = settings.data ?? DEFAULTS
  return <SetupForm key={initial.version} initial={initial} onSaved={settings.replace} onOff={() => setOff(true)} />
}

function SetupForm({ initial, onSaved, onOff }: { readonly initial: PaymentSettings; readonly onSaved: (settings: PaymentSettings) => void; readonly onOff: () => void }) {
  const { facilityId } = useDeptAccess()
  const ids = useId()
  const toast = useToast()
  const [wherePaid, setWherePaid] = useState(initial.wherePaid)
  const [methods, setMethods] = useState<readonly PaymentMethod[]>(initial.methods)
  const [payBefore, setPayBefore] = useState(initial.payBefore)
  const [deferred, setDeferred] = useState(initial.allowDeferredFor)
  const [bankName, setBankName] = useState(initial.transferAccount?.bankName ?? '')
  const [accountName, setAccountName] = useState(initial.transferAccount?.accountName ?? '')
  const [accountNumber, setAccountNumber] = useState(initial.transferAccount?.accountNumber ?? '')
  const [hmos, setHmos] = useState<readonly Hmo[]>(initial.hmos)
  const [newHmo, setNewHmo] = useState('')
  const [footer, setFooter] = useState(initial.receiptFooter ?? '')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key] = useState(() => crypto.randomUUID())

  const has = (method: PaymentMethod) => methods.includes(method)
  const toggle = (method: PaymentMethod, on: boolean) => setMethods(previous => PAYMENT_METHODS.filter(m => m === method ? on : previous.includes(m)))
  const toggleDeferred = (reason: 'emergency' | 'inpatient', on: boolean) =>
    setDeferred(previous => (['emergency', 'inpatient'] as const).filter(r => r === reason ? on : previous.includes(r)))
  const transferStarted = bankName.trim() !== '' || accountName.trim() !== '' || accountNumber.trim() !== ''
  const errors = {
    methods: methods.length === 0 ? 'Choose at least one way to pay.' : null,
    bankName: (has('transfer') || transferStarted) && bankName.trim().length < 2 ? 'Type the bank’s name.' : null,
    accountName: (has('transfer') || transferStarted) && accountName.trim().length < 2 ? 'Type the name on the account.' : null,
    accountNumber: (has('transfer') || transferStarted) && !/^\d{10}$/.test(accountNumber.replace(/\s/g, '')) ? 'Type the 10-digit account number (NUBAN).' : null,
    hmos: has('hmo') && hmos.length === 0 ? 'Add at least one HMO, or turn HMO off above.' : null,
  }
  const blocked = Object.values(errors).some(Boolean)

  function addHmo() {
    const name = newHmo.trim()
    if (name.length < 2 || hmos.some(hmo => hmo.name.toLowerCase() === name.toLowerCase())) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setHmos(previous => [...previous, { id: `hmo-${slug || crypto.randomUUID()}`, name }])
    setNewHmo('')
  }

  async function save() {
    setTried(true)
    if (!facilityId || blocked) return
    setBusy(true); setProblem(null)
    const next: PaymentSettings = {
      wherePaid, methods: [...methods], payBefore, allowDeferredFor: [...deferred],
      transferAccount: has('transfer') || transferStarted
        ? { bankName: bankName.trim(), accountName: accountName.trim(), accountNumber: accountNumber.replace(/\s/g, '') } : null,
      hmos: [...hmos], receiptFooter: footer.trim() || null, version: initial.version,
    }
    const result = await commerce.savePaymentSettings(facilityId, next, key)
    setBusy(false)
    if (result.ok) { toast.success({ title: 'Payment setup saved' }); onSaved(result.data); return }
    if (result.notAvailable) { onOff(); return }
    setProblem(result.error)
  }

  return (
    <FormPage title="Payment setup" description="How this facility takes payment. Health ID records each payment; the money goes through your till, POS or bank.">
      <form className="flex flex-col gap-4" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
        <Step n={1} title="Where people pay">
          <div role="radiogroup" aria-label="Where people pay" className="grid gap-2 sm:grid-cols-3">
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
          <Switch checked={payBefore.pharmacy} onChange={on => setPayBefore(previous => ({ ...previous, pharmacy: on }))}
            label="Pharmacy dispenses only when paid" description={payBefore.pharmacy ? 'Drugs are handed over once the bill is paid.' : 'Drugs can be handed over before payment.'} />
          <Switch checked={payBefore.lab} onChange={on => setPayBefore(previous => ({ ...previous, lab: on }))}
            label="Lab takes the sample only when paid" description={payBefore.lab ? 'The sample is taken once the bill is paid.' : 'The sample can be taken before payment.'} />
          <div className="border-t border-line pt-4">
            <p className="m-0 mb-3 text-[13px] font-medium text-ink-2">Serve now, bill follows</p>
            <div className="flex flex-col gap-4">
              <Switch checked={deferred.includes('emergency')} onChange={on => toggleDeferred('emergency', on)} label="Emergencies" description="Care first; the bill is settled later." />
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
          {hmos.length > 0 ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg p-0 ring-1 ring-line">
              {hmos.map(hmo => (
                <li key={hmo.id} className="flex items-center justify-between gap-3 py-1 pr-1 pl-3.5">
                  <span className="text-sm text-ink">{hmo.name}</span>
                  <Button variant="ghost" size="sm" icon={X} aria-label={`Remove ${hmo.name}`} className="size-11 px-0 sm:size-9"
                    onClick={() => setHmos(previous => previous.filter(entry => entry.id !== hmo.id))} />
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[13px] text-ink-3">No HMOs yet.</p>}
          <div className="flex gap-2">
            <Input aria-label="HMO name" placeholder="NHIA, Hygeia HMO…" autoComplete="off" value={newHmo} className="flex-1"
              onChange={event => setNewHmo(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addHmo() } }} />
            <Button icon={Plus} onClick={addHmo} disabled={newHmo.trim().length < 2}>Add</Button>
          </div>
          {tried && errors.hmos ? <p className="m-0 text-xs font-medium text-danger-ink">{errors.hmos}</p> : null}
          <Field label="Line at the foot of each receipt" optional htmlFor={`${ids}-footer`} className="border-t border-line pt-4">
            <Textarea id={`${ids}-footer`} rows={2} value={footer} onChange={event => setFooter(event.target.value)} placeholder="Thank you. Keep this receipt for the pharmacy or lab." />
          </Field>
        </Step>

        {tried && blocked ? <Alert intent="error" title="Not saved yet">Check the steps marked above.</Alert> : null}
        {problem ? <Alert intent="error" title="Not saved">{problem}</Alert> : null}
        <FormActions><Button type="submit" variant="primary" loading={busy}>Save setup</Button></FormActions>
      </form>
    </FormPage>
  )
}
