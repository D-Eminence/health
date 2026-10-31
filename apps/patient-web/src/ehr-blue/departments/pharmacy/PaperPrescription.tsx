import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Trash2 } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Alert, Badge, Button, EmptyState, Field, Input } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type CatalogueItem, type WalkInOrder } from '../commerce/api'
import { naira } from '../commerce/money'
import { NOT_SET_UP_UNSAVED, NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useOrderPhotoUpload } from '../commerce/orderPhoto'
import { useDeptAccess } from '../parts/access'
import { ItemCover } from './pointOfCare'
import { drugFormFromCatalogue } from './pocFields'
import {
  CataloguePicker, checkOutside, EMPTY_OUTSIDE, normalizeHealthId, normalizePhone, OutsideFields, outsideOrder, Stepper, useAttemptKey,
  type OutsideDraft, type OutsideErrors, type PickItem,
} from './walkIn'

const LIST = '/provider/pharmacy/prescriptions'
const BACK = { to: LIST, label: 'Back to prescriptions' }
const SEARCH_ID = 'paper-search'

interface Line { readonly item: CatalogueItem; readonly onHand: number | null; quantity: number; dose: string; frequency: string }
type LineErrors = Readonly<Record<string, 'dose' | 'frequency'>>

/**
 * A paper prescription brought to the counter (POINT_OF_CARE_SPEC §4): the doctor's details and a photo of the paper,
 * the drugs with how much and the directions for the label, and who it is for if they say (a name and phone, or their
 * Health ID: never needed). "Add to prescriptions" makes it once (POST walk-in-orders, one Idempotency-Key per order as
 * typed) and opens it to pick, pay and dispense, as any prescription from a doctor in Health ID.
 */
export function PaperPrescription() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('pharmacy.walk-in.create')) return <FormPage title="Paper prescription" back={BACK}>
    <EmptyState icon={FileText} title="You can’t add prescriptions here" description="Your role needs permission to serve walk-in customers. Ask the pharmacist in charge." />
  </FormPage>
  return <PaperForm key={facilityId} facilityId={facilityId} withStock={permissions.includes('pharmacy.stock.read')} />
}

function PaperForm({ facilityId, withStock }: { readonly facilityId: string; readonly withStock: boolean }) {
  const navigate = useNavigate()
  const focus = useFocusById()
  const photoUpload = useOrderPhotoUpload(facilityId)
  const [outside, setOutside] = useState<OutsideDraft>(EMPTY_OUTSIDE)
  const [outsideErrors, setOutsideErrors] = useState<OutsideErrors>({})
  const [lines, setLines] = useState<Line[]>([])
  const [lineErrors, setLineErrors] = useState<LineErrors>({})
  const [linesError, setLinesError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [byHealthId, setByHealthId] = useState(false)
  const [healthId, setHealthId] = useState('')
  const [hidError, setHidError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [off, setOff] = useState(false)
  const keyFor = useAttemptKey()
  const total = lines.reduce((sum, line) => sum + line.item.prices.cashKobo * line.quantity, 0)

  function add(entry: PickItem) {
    setLinesError('')
    setLines(current => current.some(line => line.item.id === entry.item.id)
      ? current.map(line => line.item.id === entry.item.id ? { ...line, quantity: Math.min(line.quantity + 1, line.onHand ?? 9999) } : line)
      : [...current, { item: entry.item, onHand: entry.stock?.onHand ?? null, quantity: 1, dose: '', frequency: '' }])
  }
  function change(id: string, patch: Partial<Line>) {
    setLineErrors({}); setLinesError('')
    setLines(current => current.map(line => line.item.id === id ? { ...line, ...patch } : line))
  }

  const hid = byHealthId && healthId.trim() ? normalizeHealthId(healthId) : ''
  const order: WalkInOrder = {
    patient: hid ? { kind: 'health_id', healthId: hid }
      : { kind: 'anonymous', ...(name.trim() ? { name: name.trim() } : {}), ...(phone.trim() ? { phone: normalizePhone(phone) } : {}) },
    outside: outsideOrder(outside),
    items: lines.map(line => ({ catalogueItemId: line.item.id, quantity: line.quantity, dose: line.dose.trim() || null, frequency: line.frequency.trim() || null })),
  }

  async function send() {
    if (sending || photoUpload.uploading) return
    const errors = checkOutside(outside, true, new Date().toISOString().slice(0, 10))
    setOutsideErrors(errors)
    if (errors.prescriberName) return focus('paper-rx-prescriber')
    if (errors.writtenOn) return focus('paper-rx-written')
    if (lines.length === 0) { setLinesError('Add the drugs on the prescription.'); return focus(SEARCH_ID) }
    const missing: Record<string, 'dose' | 'frequency'> = {}
    for (const line of lines) if (!line.dose.trim() || !line.frequency.trim()) missing[line.item.id] = line.dose.trim() ? 'frequency' : 'dose'
    const first = Object.entries(missing)[0]
    if (first) {
      setLineErrors(missing)
      setLinesError('Add the dose and how often for each drug: it goes on the label.')
      return focus(`paper-line-${first[0]}-${first[1] === 'dose' ? 'dose' : 'often'}`)
    }
    if (hid && !/^HID-[A-Z0-9]{4,}$/.test(hid)) { setHidError('Type the Health ID on their card, like HID-ADA2345.'); return focus('paper-hid') }
    setSending(true); setSendError(''); setOff(false)
    const result = await commerce.pharmacyWalkIn(facilityId, order, keyFor(JSON.stringify([facilityId, order])))
    setSending(false)
    if (result.ok) {
      const first = result.data.workItemIds[0]
      navigate(first ? `${LIST}/${encodeURIComponent(first)}` : LIST, { replace: true })
      return
    }
    if (result.notAvailable) { setOff(true); return }
    setSendError(result.error)
  }

  return <FormPage title="Paper prescription" back={BACK} wide>
    <Step n={1} title="Prescription" hint="As written on the paper.">
      <OutsideFields idBase="paper-rx" outside={outside} errors={outsideErrors} contact={false} paper="prescription" photoUpload={photoUpload}
        onPhoto={photo => { setOutside(current => ({ ...current, photo })); setOutsideErrors({}) }}
        onChange={next => { setOutside(next); setOutsideErrors({}) }} />
    </Step>

    <Step n={2} title="Drugs" hint="Search, then tap to add.">
      <CataloguePicker facilityId={facilityId} kind="drug" searchId={SEARCH_ID} withStock={withStock} emptyWord="drugs"
        chosen={id => lines.find(line => line.item.id === id)?.quantity ?? 0} blockedWhy={() => null} onPick={add} />
      {lines.length > 0 ? <ul aria-label="On this prescription" className="m-0 flex list-none flex-col gap-3 p-0">
        {lines.map(line => <PaperLine key={line.item.id} line={line} error={lineErrors[line.item.id]} onChange={patch => change(line.item.id, patch)}
          onRemove={() => { setLines(current => current.filter(other => other.item.id !== line.item.id)); focus(SEARCH_ID) }} />)}
      </ul> : null}
      {linesError ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{linesError}</p> : null}
      {lines.length > 0 ? <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="text-[24px] font-semibold text-ink tabular" aria-live="polite">{naira(total)}</span>
      </div> : null}
    </Step>

    <Step n={3} title="Customer" hint="Optional.">
      {byHealthId ? <>
        <Field label="Health ID" htmlFor="paper-hid" error={hidError} errorId="paper-hid-error">
          <Input id="paper-hid" value={healthId} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="HID-ADA2345" className="h-11 tracking-[.04em]"
            aria-invalid={hidError ? true : undefined} aria-describedby={hidError ? 'paper-hid-error' : undefined}
            onChange={event => { setHealthId(event.target.value); setHidError('') }}
            onBlur={() => { if (healthId.trim()) setHealthId(normalizeHealthId(healthId)) }} />
        </Field>
        <Button variant="link" className="self-start" onClick={() => { setByHealthId(false); setHealthId(''); setHidError(''); focus('paper-name') }}>Use a name instead</Button>
      </> : <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="paper-name">
            <Input id="paper-name" value={name} maxLength={120} autoComplete="off" className="h-11" onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="paper-phone">
            <Input id="paper-phone" type="tel" inputMode="tel" value={phone} maxLength={32} autoComplete="off" placeholder="0803 123 4567" className="h-11"
              onChange={event => setPhone(event.target.value)} />
          </Field>
        </div>
        <Button variant="link" className="self-start" onClick={() => { setByHealthId(true); focus('paper-hid') }}>Find by Health ID</Button>
      </>}
    </Step>

    {off ? <NotSwitchedOn message={NOT_SET_UP_UNSAVED} /> : null}
    {sendError ? <Alert intent="error" title="Not added">{sendError} Try again: it won’t be added twice.</Alert> : null}
    <FormActions>
      <Button to={LIST}>Cancel</Button>
      <Button variant="primary" size="lg" iconRight={ArrowRight} aria-busy={sending || undefined} aria-disabled={sending || photoUpload.uploading || undefined}
        onClick={() => void send()}>{sending ? 'Adding…' : 'Add and pick'}</Button>
    </FormActions>
  </FormPage>
}

function PaperLine({ line, error, onChange, onRemove }: {
  readonly line: Line; readonly error?: 'dose' | 'frequency'; readonly onChange: (patch: Partial<Line>) => void; readonly onRemove: () => void
}) {
  const id = `paper-line-${line.item.id}`
  const name = `${line.item.name}${line.item.strength ? ` ${line.item.strength}` : ''}`
  const doseError = error === 'dose' ? 'Type the dose with its unit.' : undefined
  const oftenError = error === 'frequency' ? 'Type how often.' : undefined
  return <li className="flex flex-col gap-3 rounded-xl bg-surface p-3 ring-1 ring-line">
    <div className="flex items-start gap-3">
      <ItemCover imageUrl={line.item.imageUrl} form={drugFormFromCatalogue(line.item.form)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{name}</p>
        <p className="m-0 text-[14px] text-ink-2 tabular">{naira(line.item.prices.cashKobo)} each · <strong className="text-ink">{naira(line.item.prices.cashKobo * line.quantity)}</strong></p>
        {line.item.prescriptionOnly ? <Badge size="sm" tone="violet" className="self-start">Prescription only</Badge> : null}
      </div>
      <Button variant="ghost" icon={Trash2} aria-label={`Remove ${name}`} className="!w-11 !px-0 text-ink-3" onClick={onRemove} />
    </div>
    <Stepper id={`${id}-qty`} label={name} value={line.quantity} max={line.onHand ?? undefined} onChange={quantity => onChange({ quantity })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Dose" htmlFor={`${id}-dose`} error={doseError} errorId={`${id}-dose-error`}>
        <Input id={`${id}-dose`} value={line.dose} maxLength={80} autoComplete="off" placeholder="1 tablet" className="h-11"
          aria-invalid={doseError ? true : undefined} aria-describedby={doseError ? `${id}-dose-error` : undefined} onChange={event => onChange({ dose: event.target.value })} />
      </Field>
      <Field label="How often" htmlFor={`${id}-often`} error={oftenError} errorId={`${id}-often-error`}>
        <Input id={`${id}-often`} value={line.frequency} maxLength={120} autoComplete="off" placeholder="Twice daily for 5 days" className="h-11"
          aria-invalid={oftenError ? true : undefined} aria-describedby={oftenError ? `${id}-often-error` : undefined} onChange={event => onChange({ frequency: event.target.value })} />
      </Field>
    </div>
  </li>
}
