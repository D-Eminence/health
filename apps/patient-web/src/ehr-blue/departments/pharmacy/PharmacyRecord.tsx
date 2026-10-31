import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { PatientBanner, Value } from '../../../kasuwa/parts'
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
import { DeptSection } from '../parts/DeptPage'
import { DeptContextLine, DeptFacts, DeptRecordLayout, type DeptFact } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { patientLabel, RoutedWorkLines, RoutedWorkPaused } from '../parts/routedWork'
import { statusTitle } from '../parts/WorkQueue'
import { DOSE_MISSING, doseMissing, notDispensableText, statusOf, statusTone } from './pharmacyText'

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
}

/**
 * One prescription's record: its status and patient, "Saved record", and "Available actions" (Dispense quantity,
 * Reverse dispensing, and on work from another facility the order's ending actions). The checks, requests and refusals
 * are today's PharmacyAction (staff/routes/Operations.tsx), ported line for line; the look and words are the design's.
 */
export function PharmacyRecord({ facilityId, item, permissions, undispensable, onUndispensable, said, holds, crossFacilityWork,
  onChanged, onBusy, onEnded, onNotCompleted, onReread }: PharmacyRecordProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // One action form open at a time, under the actions, as on the design.
  const [opened, setOpened] = useState<ActionKind | null>(null)
  // Recording closes the form: focus goes to the prescription's title.
  const focus = useFocusById()
  const problems = useFieldProblems()
  const title = `pharmacy-${item.id}-title`
  // Who the medicine is for, confirmed before a dispensing is recorded (wrong-patient prevention).
  const name = item.patient?.fullName ?? patientLabel(item)
  const banner = <PatientBanner compact name={name} hid={item.patient?.healthIdLast4 ? `Health ID ending ${item.patient.healthIdLast4}` : 'Health ID not sent'}
    dateOfBirth={item.patient?.dateOfBirth} sex={item.patient?.sex} />
  const { ask, sheet } = useConfirm()
  const asking = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>, reverse = false) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (busy || asking.current) return
    setError(''); setSuccess(''); problems.clear()
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    if (reason.length < 8) return problems.refuse(reverse ? `pharmacy-reversal-${item.id}` : `pharmacy-reason-${item.id}`, 'Enter a reason of at least 8 characters.')
    const quantity = Number(form.get('quantity'))
    const unit = String(form.get('unit') ?? '').trim()
    if (!reverse && (!Number.isFinite(quantity) || quantity <= 0 || !unit)) {
      return problems.refuse(!Number.isFinite(quantity) || quantity <= 0 ? `pharmacy-quantity-${item.id}` : `pharmacy-unit-${item.id}`, 'Enter a positive quantity and unit.')
    }
    asking.current = true
    let confirmed = false
    try {
      confirmed = await ask(reverse
        ? { subject: banner, effect: `Reverse the dispensing of ${item.medication.display} for ${name}?`, confirmLabel: 'Reverse dispensing' }
        : { subject: banner, effect: `Dispense ${String(quantity).replace(/^\./, '0.')} ${unit} of ${item.medication.display} to ${name}?`, confirmLabel: 'Dispense' })
    } finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    onBusy(true)
    try {
      if (reverse) {
        if (!item.dispensing) throw new Error('No dispensing is available to reverse.')
        const current = await staffApi.dispensing(facilityId, item.dispensing.id)
        await staffApi.reverseDispensing(facilityId, current.id, current.version, reason)
        setSuccess('Dispensing reversal recorded.')
      } else {
        await staffApi.dispense(facilityId, item, quantity, unit, reason)
        setSuccess('Dispensing recorded.')
      }
      // The form goes now, so focus goes to the title in the same update, not once the list is read again.
      setOpened(null)
      focus(title, true)
      await onChanged()
      focus(title, true)
    } catch (caught) {
      if (!reverse && isHidApiError(caught) && caught.code === 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE') {
        // Its dispensing form goes, so the work continues at the prescription.
        onUndispensable()
        setOpened(null)
        focus(title, true)
      } else setError(errorText(caught, ACTION_FAILED))
    }
    finally { setBusy(false); onBusy(false) }
  }

  // On work from another facility the services refuse a write once its order is closed (item 3, B3): the action goes.
  const closed = routeClosedForWork(item.orderRoute)
  const canDispense = !closed && !item.dispensing && !undispensable && permissions.includes('pharmacy.dispensing.create')
  const canReverse = !closed && Boolean(item.dispensing && !item.dispensing.reversed && permissions.includes('pharmacy.dispensing.reverse') && permissions.includes('pharmacy.dispensing.read'))
  const route = item.orderRoute
  const ordering = route?.orderingFacilityName ?? 'The ordering facility'
  const cannotComplete = cannotCompleteOffered(route, permissions, 'pharmacy', useCannotCompleteServed())
  const ending = wrongPatientOffered(route, permissions, 'pharmacy')
  const status = statusOf(item, undispensable)
  const shown = opened === 'dispense' && canDispense ? 'dispense' : opened === 'reverse' && canReverse ? 'reverse' : null

  function toggle(kind: ActionKind) {
    setError(''); problems.clear()
    setOpened(current => current === kind ? null : kind)
  }

  /** A control's id, validity and descriptions while its field is refused. */
  function control(id: string, hint = false) {
    const refused = problems.error(id) !== undefined
    const describedBy = [refused ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ')
    return { id, 'aria-invalid': refused || undefined, 'aria-describedby': describedBy || undefined }
  }

  const footer = (label: string) => <>
    {error && <div className="hid-ehr-dept-pharmacy-error" role="alert">{error}</div>}
    <div className="hid-ehr-dept-form-actions hid-ehr-dept-pharmacy-footer">
      <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : label}</EhrButton>
      {error && <small className="hid-ehr-dept-pharmacy-footnote">{RETRY_NOTE}</small>}
    </div>
  </>

  const actions = <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-actions-card" aria-labelledby={`pharmacy-${item.id}-actions`}>
    <h2 id={`pharmacy-${item.id}-actions`} className="hid-ehr-card-title">Actions</h2>
    {undispensable && !item.dispensing && <DeptNotice tone="critical" role="alert" title="Not dispensable">{notDispensableText(item)}</DeptNotice>}
    {!item.dispensing && doseMissing(item) && <DeptNotice tone="caution" title={DOSE_MISSING}>
      The prescription doesn’t say the dose with its unit, or how often. Ask the prescriber to complete it before you hand it over.</DeptNotice>}
    {(canDispense || canReverse) && <div className="hid-ehr-dept-action-stack">
      {canDispense && <EhrButton variant="secondary" aria-expanded={shown === 'dispense'} aria-controls={`pharmacy-dispense-${item.id}`}
        onClick={() => toggle('dispense')}>Dispense quantity</EhrButton>}
      {canReverse && <EhrButton variant="secondary" aria-expanded={shown === 'reverse'} aria-controls={`pharmacy-reverse-${item.id}`}
        onClick={() => toggle('reverse')}>Reverse dispensing</EhrButton>}
    </div>}
    {shown === 'dispense' && <form id={`pharmacy-dispense-${item.id}`} className="hid-ehr-dept-form hid-ehr-dept-action-form"
      aria-label="Dispense quantity" noValidate onSubmit={event => void submit(event)}>
      <div className="hid-ehr-dept-form-grid">
        <ActionField id={`pharmacy-quantity-${item.id}`} label="Quantity to dispense" error={problems.error(`pharmacy-quantity-${item.id}`)}
          hint="The whole amount handed over. Part of a dispensing can’t be recorded.">
          <EhrInput name="quantity" type="number" min="0.0001" step="0.0001" required {...control(`pharmacy-quantity-${item.id}`, true)} />
        </ActionField>
        <ActionField id={`pharmacy-unit-${item.id}`} label="Unit" error={problems.error(`pharmacy-unit-${item.id}`)}>
          <EhrInput name="unit" maxLength={80} defaultValue={item.doseUnit ?? ''} required {...control(`pharmacy-unit-${item.id}`)} />
        </ActionField>
        <ActionField id={`pharmacy-reason-${item.id}`} label="Reason" full error={problems.error(`pharmacy-reason-${item.id}`)}>
          <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required {...control(`pharmacy-reason-${item.id}`)} />
        </ActionField>
      </div>
      {route && item.patient && <p className="hid-ehr-dept-muted">{handOverCheckText(item.patient.fullName)}</p>}
      {footer('Dispense quantity')}
    </form>}
    {shown === 'reverse' && <form id={`pharmacy-reverse-${item.id}`} className="hid-ehr-dept-form hid-ehr-dept-action-form"
      aria-label="Reverse dispensing" noValidate onSubmit={event => void submit(event, true)}>
      <ActionField id={`pharmacy-reversal-${item.id}`} label="Reason" error={problems.error(`pharmacy-reversal-${item.id}`)}>
        <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required {...control(`pharmacy-reversal-${item.id}`)} />
      </ActionField>
      {footer('Reverse dispensing')}
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
    {!canDispense && !canReverse && !ending && <p className="hid-ehr-dept-muted">Nothing more to do here.</p>}
    {sheet}
    {/* Mounted throughout, so what was recorded is announced. */}
    <div id={`pharmacy-status-${item.id}`} role="status">{success && <p className="hid-ehr-dept-pharmacy-success">{success}</p>}</div>
  </section>

  return <>
    <DeptContextLine status={statusTitle(status)} tone={statusTone(status)} items={[`Accepted ${dateText(item.acceptedAt)}`]} />
    {/* Who the medicine is for, in the same place on every record. */}
    {banner}
    {said && route && <DeptNotice id={`pharmacy-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{said}</DeptNotice>}
    <RoutedWorkPaused items={[item]} crossFacilityWork={crossFacilityWork} receives={holds} />
    <DeptRecordLayout
      main={<DeptSection title="Prescription"><DeptFacts facts={recordFacts(item, status)} />
        {route && <div className="hid-ehr-dept-pharmacy-route"><RoutedWorkLines route={route} /></div>}</DeptSection>}
      aside={actions} />
  </>
}
