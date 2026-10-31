import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, CircleCheck, TriangleAlert, Undo2 } from 'lucide-react'
import { FormActions, PatientBanner, Value } from '../../../kasuwa/parts'
import { Badge, Button, Card, CardHeader, cx } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { staffApi, type PharmacyWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { cannotCompleteOffered, handOverCheckText, routeClosedForWork, wrongPatientOffered } from '../../../staff/orderRoutes'
import { OrderEndingActions, type CannotCompleteEnding, type OrderEndingMode } from '../../../staff/routes/CannotComplete'
import type { WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { useCannotCompleteServed } from '../../../cannotCompleteServed'
import { DeptEmbedded } from '../parts/DeptEmbedded'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptFacts, type DeptFact } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { patientLabel, RoutedWorkLines, RoutedWorkPaused } from '../parts/routedWork'
import { statusTitle } from '../parts/WorkQueue'
import { DrugTile } from './DrugTile'
import { drugFormOf, FORM_WORD, nameAndStrength } from './drugForm'
import { Breakable } from './PharmacyQueue'
import { DOSE_MISSING, doseMissing, doseText, labelText, notDispensableText, queueTone, statusOf, statusWord } from './pharmacyText'

/** The design's words under a form that was refused. */
const RETRY_NOTE = 'Fix what’s marked, or try again with the same button. Nothing is saved until it says so.'
const ACTION_FAILED = 'That didn’t work. Please try again.'

/** A prescription's saved fields. The dose is always shown with its unit, a decimal with its leading zero. */
export function recordFacts(item: PharmacyWorkItem, status: string, withPatient = false): DeptFact[] {
  return [
    { label: 'Medicine', value: item.medication.display },
    ...(withPatient ? [{ label: 'Patient', value: patientLabel(item) }] : []),
    { label: 'Dose', value: item.doseQuantity == null ? 'Not recorded' : <Value value={item.doseQuantity} unit={item.doseUnit || 'unit not recorded'} /> },
    { label: 'How often', value: item.frequency || 'Not recorded' },
    { label: 'Route', value: item.routeCode || 'Not recorded' },
    ...(item.instructions ? [{ label: 'Instructions', value: item.instructions }] : []),
    { label: 'Dispensed', value: item.dispensing ? (item.dispensing.reversed ? 'Reversed' : 'Yes') : 'No' },
    ...(withPatient ? [{ label: 'Status', value: statusTitle(status) }] : []),
    { label: 'Accepted', value: dateText(item.acceptedAt) },
  ]
}

/** One field of an action form: the design's label with its asterisk, a hint, and the error a refusal names. */
function ActionField({ id, label, hint, error, full, children }: {
  readonly id: string; readonly label: string; readonly hint?: string; readonly error: ReactNode; readonly full?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className={['hid-ehr-field', full ? 'hid-ehr-dept-full' : ''].filter(Boolean).join(' ')}>
      <label className="hid-ehr-label" htmlFor={id}>{label}<span aria-hidden="true"> *</span></label>
      {children}
      {hint ? <p id={`${id}-hint`} className="hid-ehr-hint">{hint}</p> : null}
      {error !== undefined ? <p id={`${id}-error`} className="hid-ehr-error">{error}</p> : null}
    </div>
  )
}

type ActionKind = 'dispense' | 'reverse'

/** The picking checklist: each step ticked as it is done at the shelf, before the medicine is handed over. */
type CheckStep = 'picked' | 'counted' | 'label'

export interface PharmacyRecordProps {
  readonly facilityId: string
  readonly item: PharmacyWorkItem
  readonly permissions: readonly string[]
  /** Pharmacy refused to dispense this work (409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE); kept by the page. */
  readonly undispensable: boolean
  readonly onUndispensable: () => void
  /** What a refused ending form said, once the list read again no longer offers that form (useRowSaid). */
  readonly said: string | null
  readonly holds: boolean
  readonly crossFacilityWork?: boolean
  readonly onChanged: () => Promise<void>
  /** Whether a dispensing or reversal is being sent: the page holds Back to list meanwhile, so its outcome is said here. */
  readonly onBusy: (busy: boolean) => void
  readonly onEnded: (ending: WrongPatientEnding) => void
  readonly onNotCompleted: (ending: Omit<CannotCompleteEnding, 'key'>) => void
  readonly onReread: (routeId: string, mode: OrderEndingMode, said?: string) => Promise<void>
  /** The next prescription waiting to be dispensed (its medicine), or null when none is. */
  readonly next?: string | null
  readonly onNext?: () => void
  readonly onBack?: () => void
}

/** What the record says once the medicine is handed over: the end of the flow, and the way on to the next one. */
interface Done { readonly quantity: number; readonly unit: string }

/**
 * One prescription opened from the queue, as a picking view: who it is for (the patient banner), the drug large with
 * its form, a checklist ticked at the shelf, the quantity and the label in plain words, and one big Dispense at the
 * bottom, confirmed against the patient. Then a done state with "Next prescription". Reversing stays available, set
 * apart. The checks, requests and refusals are today's PharmacyAction (staff/routes/Operations.tsx), kept line for line.
 */
export function PharmacyRecord({ facilityId, item, permissions, undispensable, onUndispensable, said, holds, crossFacilityWork,
  onChanged, onBusy, onEnded, onNotCompleted, onReread, next = null, onNext, onBack }: PharmacyRecordProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  // The reversal form, opened on request: rare, and set apart from the counter's work.
  const [opened, setOpened] = useState<ActionKind | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<CheckStep>>(() => new Set())
  const focus = useFocusById()
  const problems = useFieldProblems()
  const title = `pharmacy-${item.id}-title`
  const doneId = `pharmacy-${item.id}-done`
  const checklistId = `pharmacy-checklist-${item.id}`
  // Who the medicine is for, confirmed before a dispensing is recorded (wrong-patient prevention).
  const name = item.patient?.fullName ?? patientLabel(item)
  const banner = <PatientBanner compact name={name} hid={item.patient?.healthIdLast4 ? `Health ID ending ${item.patient.healthIdLast4}` : 'Health ID not sent'}
    dateOfBirth={item.patient?.dateOfBirth} sex={item.patient?.sex} />
  const { ask, sheet } = useConfirm()
  const asking = useRef(false)
  const form = drugFormOf(item)
  const { name: drugName, strength } = nameAndStrength(item.medication.display)
  const missing = doseMissing(item)
  const label = labelText(item, form)
  const steps: ReadonlyArray<{ key: CheckStep; text: ReactNode }> = [
    { key: 'picked', text: <>Picked <strong>{item.medication.display}</strong>: the right medicine and strength</> },
    { key: 'counted', text: 'Counted the quantity to hand over' },
    { key: 'label', text: missing ? 'Dose and how often confirmed with the prescriber' : 'Label written and checked with the patient' },
  ]

  async function submit(event: FormEvent<HTMLFormElement>, reverse = false) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy || asking.current) return
    setError(''); setSuccess(''); problems.clear()
    if (!reverse) {
      const left = steps.find(step => !ticked.has(step.key))
      if (left) return problems.refuse(checklistId, 'Tick each step once it’s done.', `${checklistId}-${left.key}`)
    }
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    if (reason.length < 8) return problems.refuse(reverse ? `pharmacy-reversal-${item.id}` : `pharmacy-reason-${item.id}`, 'Enter a reason of at least 8 characters.')
    const quantity = Number(data.get('quantity'))
    const unit = String(data.get('unit') ?? '').trim()
    if (!reverse && (!Number.isFinite(quantity) || quantity <= 0 || !unit)) {
      return problems.refuse(!Number.isFinite(quantity) || quantity <= 0 ? `pharmacy-quantity-${item.id}` : `pharmacy-unit-${item.id}`, 'Enter a positive quantity and unit.')
    }
    asking.current = true
    let confirmed = false
    try {
      confirmed = await ask(reverse
        ? { subject: banner, effect: `Reverse the dispensing of ${item.medication.display} for ${name}?`, confirmLabel: 'Reverse dispensing',
          undo: 'The dispensing is marked reversed in the record. It can’t be dispensed again on this prescription.' }
        : { subject: banner, effect: `Dispense ${String(quantity).replace(/^\./, '0.')} ${unit} of ${item.medication.display} to ${name}?`, confirmLabel: 'Dispense',
          undo: 'If this was a mistake, you can reverse the dispensing afterwards.' })
    } finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    onBusy(true)
    try {
      if (reverse) {
        if (!item.dispensing) throw new Error('No dispensing is available to reverse.')
        const current = await staffApi.dispensing(facilityId, item.dispensing.id)
        await staffApi.reverseDispensing(facilityId, current.id, current.version, reason)
        setDone(null)
        setSuccess('Dispensing reversal recorded.')
        setOpened(null)
        focus(title, true)
        await onChanged()
        focus(title, true)
      } else {
        await staffApi.dispense(facilityId, item, quantity, unit, reason)
        setSuccess('Dispensing recorded.')
        // The pick view goes now, so focus goes to what was done in the same update, not once the list is read again.
        setDone({ quantity, unit })
        focus(doneId, true)
        await onChanged()
        focus([doneId, title], true)
      }
    } catch (caught) {
      if (!reverse && isHidApiError(caught) && caught.code === 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE') {
        // Its dispensing form goes, so the work continues at the prescription.
        onUndispensable()
        focus(title, true)
      } else setError(errorText(caught, ACTION_FAILED))
    }
    finally { setBusy(false); onBusy(false) }
  }

  // On work from another facility the services refuse a write once its order is closed (item 3, B3): the action goes.
  const closed = routeClosedForWork(item.orderRoute)
  const mayDispense = permissions.includes('pharmacy.dispensing.create')
  const canDispense = !closed && !item.dispensing && !undispensable && mayDispense
  const canReverse = !closed && Boolean(item.dispensing && !item.dispensing.reversed && permissions.includes('pharmacy.dispensing.reverse') && permissions.includes('pharmacy.dispensing.read'))
  const route = item.orderRoute
  const ordering = route?.orderingFacilityName ?? 'The ordering facility'
  const cannotComplete = cannotCompleteOffered(route, permissions, 'pharmacy', useCannotCompleteServed())
  const ending = wrongPatientOffered(route, permissions, 'pharmacy')
  const status = statusOf(item, undispensable)
  const reversing = opened === 'reverse' && canReverse

  function tick(step: CheckStep, on: boolean) {
    problems.clear()
    setTicked(current => {
      const nextSet = new Set(current)
      if (on) nextSet.add(step)
      else nextSet.delete(step)
      return nextSet
    })
  }

  /** A control's id, validity and descriptions while its field is refused. */
  function control(id: string, hint = false) {
    const refused = problems.error(id) !== undefined
    const describedBy = [refused ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ')
    return { id, 'aria-invalid': refused || undefined, 'aria-describedby': describedBy || undefined }
  }

  const failure = error ? <div className="flex flex-col gap-1">
    <div className="hid-ehr-dept-pharmacy-error" role="alert">{error}</div>
    <small className="hid-ehr-dept-pharmacy-footnote">{RETRY_NOTE}</small>
  </div> : null

  // The drug, large, as the picking view and the done state lead with it.
  const drug = <div className="flex items-start gap-4">
    <DrugTile form={form} size="lg" />
    <div className="flex min-w-0 flex-col gap-1">
      <Badge size="sm" tone={queueTone(status)} className="self-start">{statusWord(status)}</Badge>
      {/* The page's heading names the medicine as prescribed; this says what to look for on the shelf. */}
      <p className="m-0 text-[13px] font-medium text-ink-3">Pick</p>
      <p className="m-0 text-[20px] font-semibold leading-tight text-ink [overflow-wrap:break-word]"><Breakable text={drugName} /></p>
      <p className="m-0 text-[16px] font-medium text-ink-2">{[strength, FORM_WORD[form], item.routeCode].filter(Boolean).join(' · ')}</p>
      <p className="m-0 text-[13px] text-ink-3">Accepted {dateText(item.acceptedAt)}</p>
    </div>
  </div>

  const doneCard = done && <Card className="ring-success/40">
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-8" aria-hidden /></span>
      <h2 id={doneId} tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">Dispensed</h2>
      <p className="m-0 max-w-md text-body text-ink-2">
        <Value value={done.quantity} unit={done.unit} /> of <strong className="text-ink">{item.medication.display}</strong> handed to <strong className="text-ink">{name}</strong>.
      </p>
      <div className="mt-2 flex w-full max-w-sm flex-col gap-2">
        {next && onNext
          ? <Button variant="primary" size="lg" block iconRight={ArrowRight} onClick={onNext}>Next prescription</Button>
          : <p className="m-0 text-[13px] text-ink-3">Nothing else is waiting to dispense.</p>}
        {next ? <p className="m-0 text-[13px] text-ink-3">Next: {next}</p> : null}
        {onBack ? <Button variant={next ? 'secondary' : 'primary'} size={next ? 'md' : 'lg'} block onClick={onBack}>Back to list</Button> : null}
      </div>
    </div>
  </Card>

  const pick = canDispense && !done && <Card>
    <CardHeader as="h2" title="Pick and hand over" description="Tick each step as you do it." />
    <form id={`pharmacy-dispense-${item.id}`} aria-label="Dispense" noValidate onSubmit={event => void submit(event)} className="flex flex-col gap-5 p-5">
      <fieldset id={checklistId} className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={problems.error(checklistId) !== undefined ? `${checklistId}-error` : undefined}>
        <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">Checklist</legend>
        {steps.map(step => {
          const on = ticked.has(step.key)
          return <label key={step.key} htmlFor={`${checklistId}-${step.key}`}
            className={cx('flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset transition-colors',
              on ? 'bg-success-soft ring-success/40' : 'bg-surface ring-line-strong hover:bg-subtle')}>
            <input id={`${checklistId}-${step.key}`} type="checkbox" checked={on} onChange={event => tick(step.key, event.target.checked)}
              className="m-0 size-6 shrink-0 cursor-pointer accent-[var(--color-success)]" />
            <span className="min-w-0 text-[15px] text-ink [overflow-wrap:anywhere]">{step.text}</span>
          </label>
        })}
        {problems.error(checklistId) !== undefined ? <p id={`${checklistId}-error`} className="hid-ehr-error m-0">{problems.error(checklistId)}</p> : null}
      </fieldset>

      <div className="rounded-lg bg-subtle px-4 py-3">
        <p className="m-0 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">On the label</p>
        {label
          ? <p className="m-0 mt-1 text-[17px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{label}</p>
          : <p className="m-0 mt-1 inline-flex items-start gap-1.5 text-[15px] font-medium text-warn-ink"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {DOSE_MISSING}. Ask the prescriber for the dose with its unit and how often before you hand it over.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActionField id={`pharmacy-quantity-${item.id}`} label="Quantity to hand over" error={problems.error(`pharmacy-quantity-${item.id}`)}
          hint="The whole amount. Part of a dispensing can’t be recorded.">
          <EhrInput name="quantity" type="number" inputMode="decimal" min="0.0001" step="any" required {...control(`pharmacy-quantity-${item.id}`, true)} />
        </ActionField>
        <ActionField id={`pharmacy-unit-${item.id}`} label="Unit" error={problems.error(`pharmacy-unit-${item.id}`)}
          hint={doseText(item) ? `Dose: ${doseText(item)}` : undefined}>
          <EhrInput name="unit" maxLength={80} defaultValue={item.doseUnit ?? ''} required {...control(`pharmacy-unit-${item.id}`, Boolean(doseText(item)))} />
        </ActionField>
      </div>
      <ActionField id={`pharmacy-reason-${item.id}`} label="Reason" error={problems.error(`pharmacy-reason-${item.id}`)}
        hint="Kept in the record. Change it if anything differs from the prescription.">
        <EhrTextarea name="reason" rows={2} minLength={8} maxLength={500} required defaultValue="Dispensed as prescribed."
          {...control(`pharmacy-reason-${item.id}`, true)} />
      </ActionField>
      {route && item.patient && <p className="hid-ehr-dept-muted m-0">{handOverCheckText(item.patient.fullName)}</p>}
      {failure}
      {/* The one main action, at the bottom where the thumb is, full width on a phone. */}
      <FormActions sticky={false}>
        <Button type="submit" variant="primary" size="lg" icon={busy ? undefined : Check} aria-busy={busy || undefined} aria-disabled={busy || undefined}
          className="hid-ehr-dept-pharmacy-busy sm:min-w-56">{busy ? 'Saving…' : 'Dispense'}</Button>
      </FormActions>
    </form>
  </Card>

  const otherActions = (canReverse || ending) && <Card>
    <CardHeader as="h2" title="Other actions" titleId={`pharmacy-${item.id}-actions`} />
    <div className="flex flex-col gap-3 p-5">
      {canReverse && <Button icon={Undo2} aria-expanded={reversing} aria-controls={`pharmacy-reverse-${item.id}`} className="self-start"
        onClick={() => { setError(''); problems.clear(); setOpened(current => current === 'reverse' ? null : 'reverse') }}>Reverse dispensing</Button>}
      {reversing && <form id={`pharmacy-reverse-${item.id}`} className="flex flex-col gap-3" aria-label="Reverse dispensing" noValidate
        onSubmit={event => void submit(event, true)}>
        <ActionField id={`pharmacy-reversal-${item.id}`} label="Reason" error={problems.error(`pharmacy-reversal-${item.id}`)}
          hint="Why the dispensing is being reversed, for the record.">
          <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required {...control(`pharmacy-reversal-${item.id}`, true)} />
        </ActionField>
        {failure}
        <EhrButton type="submit" variant="secondary" busy={busy}>{busy ? 'Saving…' : 'Reverse dispensing'}</EhrButton>
      </form>}
      {ending && <DeptEmbedded className="hid-ehr-dept-pharmacy-endings"><OrderEndingActions base={`pharmacy-${item.id}`}
        service="pharmacy" facilityId={facilityId} route={{ id: route.id, version: route.version, reference: route.reference }}
        title={item.medication.display} patient={item.patient?.fullName ?? null} ordering={ordering}
        dispensed={Boolean(item.dispensing && !item.dispensing.reversed)} cannotComplete={cannotComplete ? { accession: false } : null}
        onReread={(mode, text) => onReread(route.id, mode, text)}
        onWrongPatientEnded={result => onEnded({ service: 'pharmacy', title: item.medication.display, reference: route.reference,
          patient: item.patient?.fullName ?? null, ordering, result, dateOfBirthOnly: false })}
        onNotCompleted={(result, reason) => onNotCompleted({ service: 'pharmacy', title: item.medication.display,
          reference: route.reference, patient: item.patient?.fullName ?? null, ordering, reason, priority: null, result })} /></DeptEmbedded>}
    </div>
  </Card>

  // Why nothing can be dispensed here, said where the Dispense button would be.
  const blocked = !canDispense && !done && !item.dispensing && <Card>
    <div className="flex flex-col gap-3 p-5">
      {undispensable
        ? <DeptNotice tone="critical" role="alert" title="Not dispensable">{notDispensableText(item)}</DeptNotice>
        : closed ? <DeptNotice tone="caution" title="This order is closed">No more work can be recorded on it.</DeptNotice>
          : !mayDispense ? <DeptNotice title="You can’t dispense here">Your role can see prescriptions but not dispense them. Ask a pharmacist.</DeptNotice>
            : null}
      {onBack ? <Button onClick={onBack} className="self-start">Back to list</Button> : null}
    </div>
  </Card>

  const handedOver = item.dispensing && !done && <Card>
    <div className="flex items-center gap-3 p-5">
      <CircleCheck className={cx('size-6 shrink-0', item.dispensing.reversed ? 'text-ink-3' : 'text-success-ink')} aria-hidden />
      <p className="m-0 text-body text-ink">{item.dispensing.reversed
        ? 'This dispensing was reversed. A new prescription is needed to dispense it again.'
        : 'Already dispensed. Nothing more to do unless it needs reversing.'}</p>
    </div>
  </Card>

  return <div className="flex flex-col gap-4">
    {/* Who the medicine is for, in the same place on every record. */}
    {banner}
    {said && route && <DeptNotice id={`pharmacy-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{said}</DeptNotice>}
    <RoutedWorkPaused items={[item]} crossFacilityWork={crossFacilityWork} receives={holds} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {doneCard}
        {!done && <Card className="p-5">{drug}</Card>}
        {pick}
        {blocked}
        {handedOver}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader as="h2" title="Prescription" />
          <div className="p-5"><DeptFacts facts={recordFacts(item, status)} />
            {route && <div className="hid-ehr-dept-pharmacy-route"><RoutedWorkLines route={route} /></div>}</div>
        </Card>
        {otherActions}
      </div>
    </div>
    {sheet}
    {/* Mounted throughout, so what was recorded is announced. */}
    <div id={`pharmacy-status-${item.id}`} role="status">{success && !done && <p className="hid-ehr-dept-pharmacy-success">{success}</p>}
      {done ? <span className="sr-only">{success}</span> : null}</div>
  </div>
}
