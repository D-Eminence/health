import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Encounter, VitalMeasurement, VitalMeasurements } from '../../../staff/api'
import { Flag } from '../../../kasuwa/parts'
import { ErrorBox } from '../parts/Notices'
import type { FieldErrors, SubmitOutcome } from '../parts/RecordForm'
import { COMPLETE_FIELD, REASON_SHORT, visitLabel } from './records'
import { vitalFlag } from './ranges'
import { BOTH_BP, CHANGE_ONE, ENTER_ONE, VITAL_FIELDS, fieldLabel, measured, type VitalField, type VitalValues } from './vitals'

/** The group of measurements, as a problem's key: a rule about the values together is told at the group. */
export const VALUES = 'values'

export interface VitalsInput {
  readonly encounterId: string
  readonly values: VitalMeasurements
  readonly reason: string
}

function startValues(current: VitalValues | undefined) {
  const values: Record<string, string> = {}
  for (const field of VITAL_FIELDS) {
    const value = current?.[field.name]
    values[field.name] = value == null || value === '' ? '' : String(value)
  }
  return values
}

function decimals(step: string) {
  return step.includes('.') ? step.split('.')[1]!.length : 0
}

/** What the browser's own check of a number field found, said in the design's plain words. */
function validityText(field: VitalField, validity: ValidityState): string | null {
  if (validity.valid) return null
  if (validity.badInput) return 'Enter a number.'
  if (validity.rangeUnderflow || validity.rangeOverflow) return `Enter a value from ${field.min} to ${field.max}.`
  if (validity.stepMismatch) {
    const places = decimals(field.step)
    return places === 0 ? 'Enter a whole number.' : `Enter a value with at most ${places} decimal ${places === 1 ? 'place' : 'places'}.`
  }
  return 'Enter a valid value.'
}

/**
 * Today's vitals form in the design's form layout: a visit (when recording), the eight measurements with today's
 * steps and ranges, and a reason (when correcting). Today's refusals, in today's order: at least one measurement,
 * both blood pressure readings or neither, and for a correction a changed value and a reason of three characters.
 * The first problem takes focus; a field's problem clears as it changes. The visit chosen stays chosen, and offered,
 * while another page of visits is shown, as today's encounter being documented does (Clinical.tsx:1288-1292, :1795).
 */
export function VitalsForm({ mode, visits = [], visitHint, current, groupLabel, hint, submitLabel, onSubmit, children }: {
  mode: 'record' | 'correct'
  /** The visits on the page of visits shown. */
  visits?: readonly Encounter[]
  /** Under the visit, given the visit chosen (null when none), which may be on another page. */
  visitHint?: (chosen: Encounter | null) => ReactNode
  /** The values a correction starts from and must change. */
  current?: VitalValues
  groupLabel: string
  hint?: string
  submitLabel: string
  onSubmit: (input: VitalsInput) => Promise<SubmitOutcome>
  /** Between the fields and the footer. */
  children?: ReactNode
}) {
  const id = useId()
  const groupErrorId = `${id}-values-error`
  const [visit, setVisit] = useState<Encounter | null>(null)
  const [values, setValues] = useState(() => startValues(current))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const controls = useRef(new Map<string, HTMLElement>())
  const order = ['visit', ...VITAL_FIELDS.map(field => field.name), 'reason']
  // The visit chosen, as the page shown has it when it is there (today's selection, Clinical.tsx:1288-1292); one on
  // another page is still offered, first.
  const chosen = visit ? visits.find(encounter => encounter.id === visit.id) ?? visit : null
  const options = chosen && !visits.includes(chosen) ? [chosen, ...visits] : visits

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(key, element)
    else controls.current.delete(key)
  }

  const clear = (...keys: string[]) => setErrors(errors => {
    if (!keys.some(key => key in errors)) return errors
    const next = { ...errors }
    for (const key of keys) delete next[key]
    return next
  })

  const show = (problems: FieldErrors) => {
    setErrors(problems)
    const first = order.find(key => problems[key]) ?? (problems[VALUES] ? VITAL_FIELDS[0]!.name : undefined)
    if (first) controls.current.get(first)?.focus()
  }

  const check = (): { problems: FieldErrors } | { input: VitalsInput } => {
    if (mode === 'record' && !chosen) return { problems: { visit: COMPLETE_FIELD } }
    const invalid: Record<string, string> = {}
    for (const field of VITAL_FIELDS) {
      const element = controls.current.get(field.name)
      const problem = element instanceof HTMLInputElement ? validityText(field, element.validity) : null
      if (problem) invalid[field.name] = problem
    }
    if (Object.keys(invalid).length > 0) return { problems: invalid }
    const measurements: VitalMeasurements = {}
    for (const field of VITAL_FIELDS) {
      const value = values[field.name]?.trim() ?? ''
      if (value !== '') measurements[field.name] = Number(value)
    }
    if (Object.keys(measurements).length === 0) return { problems: { [VALUES]: ENTER_ONE } }
    if ((measurements.systolicMmhg === undefined) !== (measurements.diastolicMmhg === undefined)) {
      return { problems: { [measurements.systolicMmhg === undefined ? 'systolicMmhg' : 'diastolicMmhg']: BOTH_BP } }
    }
    if (mode === 'correct') {
      const unchanged = VITAL_FIELDS.every(field => measurements[field.name] === (current ? measured(current, field.name) : undefined))
      if (unchanged) return { problems: { [VALUES]: CHANGE_ONE } }
      if (reason.trim().length < 3) return { problems: { reason: REASON_SHORT } }
    }
    return { input: { encounterId: chosen?.id ?? '', values: measurements, reason: reason.trim() } }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    setFormError(null)
    const checked = check()
    if ('problems' in checked) return show(checked.problems)
    setErrors({})
    sending.current = true
    setBusy(true)
    try {
      const outcome = await onSubmit(checked.input)
      if (outcome && typeof outcome === 'object') {
        if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) show(outcome.fieldErrors)
        if (outcome.formError) setFormError(outcome.formError)
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const change = (name: VitalMeasurement, value: string) => {
    setValues(values => ({ ...values, [name]: value }))
    clear(name, VALUES, ...(name === 'systolicMmhg' || name === 'diastolicMmhg' ? ['systolicMmhg', 'diastolicMmhg'] : []))
  }

  return (
    <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void submit(event)}>
      {hint ? <p className="hid-ehr-clinical-note">{hint}</p> : null}
      <div className="hid-ehr-clinical-form-grid">
        {mode === 'record' ? (
          <EhrField label={<>Visit<span aria-hidden="true"> *</span></>} hint={visitHint?.(chosen)} error={errors.visit}>
            <EhrSelect ref={register('visit')} required value={chosen?.id ?? ''} onChange={event => {
              const value = event.target.value
              setVisit(options.find(encounter => encounter.id === value) ?? null)
              clear('visit')
            }}>
              <option value="">Select…</option>
              {options.map(encounter => <option key={encounter.id} value={encounter.id}>{visitLabel(encounter)}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        <div
          role="group"
          aria-label={groupLabel}
          aria-describedby={errors[VALUES] ? groupErrorId : undefined}
          className="hid-ehr-clinical-form-full hid-ehr-clinical-triage-group"
        >
          {VITAL_FIELDS.map(field => {
            // Flagged as typed against the adult range (ranges.ts): a prompt to look again, not a diagnosis.
            const flag = vitalFlag(field.name, values[field.name]?.trim())
            return (
            <EhrField key={field.name} label={fieldLabel(field)} error={errors[field.name]}>
              <span className="hid-ehr-clinical-triage-input">
              <EhrInput
                ref={register(field.name)}
                type="number"
                inputMode="decimal"
                step={field.step}
                min={field.min}
                max={field.max}
                autoComplete="off"
                value={values[field.name] ?? ''}
                aria-describedby={errors[VALUES] ? groupErrorId : undefined}
                onChange={event => change(field.name, event.target.value)}
              />
              {flag ? <Flag level={flag} /> : null}
              </span>
            </EhrField>
            )
          })}
          {errors[VALUES] ? <p id={groupErrorId} className="hid-ehr-clinical-field-error hid-ehr-clinical-triage-group-error">{errors[VALUES]}</p> : null}
        </div>
        {mode === 'correct' ? (
          <EhrField className="hid-ehr-clinical-form-full" label={<>Reason<span aria-hidden="true"> *</span></>} error={errors.reason}>
            <EhrTextarea ref={register('reason')} required rows={3} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); clear('reason') }} />
          </EhrField>
        ) : null}
      </div>
      {children}
      {formError ? <ErrorBox>{formError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-form-footer hid-ehr-clinical-form-footer-sticky">
        <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : submitLabel}</EhrButton>
      </div>
    </form>
  )
}
