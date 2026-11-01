import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ErrorBox } from './Notices'

export type FieldType = 'text' | 'tel' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'email' | 'checkbox' | 'select'

/** One form field, as the design's workspace catalogue describes it. */
export interface FieldDef {
  readonly key: string
  readonly label: string
  /** `select` is implied by `options` or `choices`. */
  readonly type?: FieldType
  readonly required?: boolean
  readonly options?: readonly string[]
  readonly choices?: readonly { readonly value: string; readonly label: string }[]
  readonly multiple?: boolean
  readonly suggestions?: readonly string[]
  readonly hint?: string
  readonly placeholder?: string
  readonly maxLength?: number
  readonly min?: number
  readonly max?: number
  readonly step?: number | 'any'
  readonly autoComplete?: string
  readonly inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
  /** Spans both columns; textareas always do. */
  readonly full?: boolean
  /** Fields with the same `row`, one after another, sit side by side (a dose and its unit). */
  readonly row?: string
  /** Applied to text as it is typed (".5" becomes "0.5": a decimal is never written without its leading zero). */
  readonly normalise?: (value: string) => string
  /** Shown only when this answers true for the form's values (a free-text unit once "Other" is chosen). */
  readonly when?: (values: FormValues) => boolean
}

export type FormValue = string | boolean | readonly string[]
export type FormValues = Readonly<Record<string, FormValue>>
export type FieldErrors = Readonly<Record<string, string>>

/** What `onSubmit` may answer: nothing (done), false (cancelled: keep the values), or problems to show. */
export type SubmitOutcome = void | false | { readonly formError?: ReactNode; readonly fieldErrors?: FieldErrors }

export const COMPLETE_FIELD = 'Complete this field.'
export const VALID_EMAIL = 'Enter a valid email address.'

function kindOf(field: FieldDef): FieldType {
  if (field.options || field.choices) return 'select'
  return field.type ?? 'text'
}

function emptyValue(field: FieldDef): FormValue {
  const kind = kindOf(field)
  if (kind === 'checkbox') return false
  if (kind === 'select' && field.multiple) return []
  return ''
}

function isBlank(value: FormValue | undefined) {
  return value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0)
}

/** The design's client checks, run on submit only. */
export function checkFields(fields: readonly FieldDef[], values: FormValues): FieldErrors {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (field.when && !field.when(values)) continue
    const value = values[field.key]
    if (field.required && isBlank(value)) errors[field.key] = COMPLETE_FIELD
    else if (kindOf(field) === 'email' && typeof value === 'string' && value && !/^\S+@\S+\.\S+$/.test(value)) errors[field.key] = VALID_EMAIL
  }
  return errors
}

/**
 * The design's record form: a two-column grid of labelled fields (" *" marks required ones), then the footer with
 * the submit button. Checks run on submit; the first problem gets focus; a field's problem clears as it changes.
 * `onSubmit` may answer a form error or field errors from the server, shown in the same places.
 */
export function RecordForm({ fields, initial, submitLabel = 'Save', busyLabel = 'Saving…', onSubmit, validate, confirm, disabled = false, footer, children, className, submitVariant = 'primary' }: {
  fields: readonly FieldDef[]
  /** A page with another primary action makes this form's submit secondary (one focal point per screen). */
  submitVariant?: 'primary' | 'secondary'
  /**
   * Asked after the checks pass and before anything is sent (confirm the patient): false keeps the values and sends
   * nothing. While it is asked, the form is not busy.
   */
  confirm?: (values: FormValues) => Promise<boolean>
  initial?: FormValues
  submitLabel?: string
  busyLabel?: string
  onSubmit: (values: FormValues) => Promise<SubmitOutcome> | SubmitOutcome
  /** Extra checks after the required ones, as field errors. */
  validate?: (values: FormValues) => FieldErrors
  disabled?: boolean
  /** Beside the submit button. */
  footer?: ReactNode
  /** Between the fields and the footer. */
  children?: ReactNode
  className?: string
}) {
  const id = useId()
  const [values, setValues] = useState<FormValues>(() => {
    const start: Record<string, FormValue> = {}
    for (const field of fields) start[field.key] = initial?.[field.key] ?? emptyValue(field)
    return start
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const controls = useRef(new Map<string, HTMLElement>())

  const change = (key: string, value: FormValue) => {
    setValues(current => ({ ...current, [key]: value }))
    setErrors(current => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const focusFirst = (problems: FieldErrors) => {
    const first = fields.find(field => problems[field.key])
    if (first) controls.current.get(first.key)?.focus()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current || disabled) return
    const problems = { ...checkFields(fields, values), ...(validate?.(values) ?? {}) }
    setErrors(problems)
    setFormError(null)
    if (Object.keys(problems).length > 0) {
      focusFirst(problems)
      return
    }
    sending.current = true
    if (confirm) {
      let confirmed = false
      try { confirmed = await confirm(values) }
      finally { if (!confirmed) sending.current = false }
      if (!confirmed) return
    }
    setBusy(true)
    try {
      const outcome = await onSubmit(values)
      if (outcome && typeof outcome === 'object') {
        if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
          setErrors(outcome.fieldErrors)
          focusFirst(outcome.fieldErrors)
        }
        if (outcome.formError) setFormError(outcome.formError)
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(key, element)
    else controls.current.delete(key)
  }

  return (
    <form className={['hid-ehr-clinical-form', className].filter(Boolean).join(' ')} noValidate onSubmit={submit}>
      <div className="hid-ehr-clinical-form-grid">
        {rowsOf(fields.filter(field => !field.when || field.when(values))).map(group => {
          const controls = group.map(field => (
            <FieldControl
              key={field.key}
              id={`${id}-${field.key}`}
              field={field}
              value={values[field.key] ?? emptyValue(field)}
              error={errors[field.key]}
              disabled={disabled}
              register={register(field.key)}
              onChange={value => change(field.key, typeof value === 'string' && field.normalise ? field.normalise(value) : value)}
            />
          ))
          return group.length > 1 ? <div key={group[0]!.key} className="hid-ehr-clinical-form-row">{controls}</div> : controls
        })}
      </div>
      {children}
      {formError ? <ErrorBox>{formError}</ErrorBox> : null}
      {/* [secondary…, primary]: the primary rightmost on a computer, last (bottom, in thumb reach) on a phone. */}
      <div className="hid-ehr-clinical-form-footer hid-ehr-clinical-form-footer-sticky">
        {footer}
        <EhrButton type="submit" variant={submitVariant} busy={busy} disabled={disabled}>{busy ? busyLabel : submitLabel}</EhrButton>
      </div>
    </form>
  )
}

/** Fields in display order, those sharing a `row` grouped. */
function rowsOf(fields: readonly FieldDef[]): FieldDef[][] {
  const groups: FieldDef[][] = []
  for (const field of fields) {
    const last = groups.at(-1)
    if (field.row && last && last[0]!.row === field.row) last.push(field)
    else groups.push([field])
  }
  return groups
}

function Label({ field }: { field: FieldDef }) {
  return <>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</>
}

function FieldControl({ id, field, value, error, disabled, register, onChange }: {
  id: string
  field: FieldDef
  value: FormValue
  error: string | undefined
  disabled: boolean
  register: (element: HTMLElement | null) => void
  onChange: (value: FormValue) => void
}) {
  const kind = kindOf(field)
  const full = field.full || kind === 'textarea'
  const className = full ? 'hid-ehr-clinical-form-full' : undefined

  if (kind === 'checkbox') {
    const errorId = `${id}-error`
    return (
      <div className={className}>
        <label className="hid-ehr-clinical-checkbox">
          <Label field={field} />
          <input
            ref={register}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={event => onChange(event.target.checked)}
          />
        </label>
        {error ? <p id={errorId} className="hid-ehr-clinical-field-error">{error}</p> : null}
      </div>
    )
  }

  const common = {
    ref: register,
    disabled,
    required: field.required,
    'aria-invalid': error ? true : undefined,
  } as const

  let control: ReactNode
  if (kind === 'select') {
    const choices = field.choices ?? (field.options ?? []).map(option => ({ value: option, label: option }))
    control = (
      <EhrSelect
        {...common}
        multiple={field.multiple}
        value={field.multiple ? [...(Array.isArray(value) ? value : [])] : typeof value === 'string' ? value : ''}
        onChange={event => onChange(field.multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}
      >
        {field.multiple ? null : <option value="">Select…</option>}
        {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </EhrSelect>
    )
  } else if (kind === 'textarea') {
    control = (
      <EhrTextarea
        {...common}
        rows={3}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        onChange={event => onChange(event.target.value)}
      />
    )
  } else {
    const listId = field.suggestions?.length ? `${id}-suggestions` : undefined
    control = (
      <>
        <EhrInput
          {...common}
          type={kind}
          list={listId}
          maxLength={field.maxLength}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete ?? 'off'}
          inputMode={field.inputMode}
          value={typeof value === 'string' ? value : ''}
          onChange={event => onChange(event.target.value)}
        />
        {listId ? <datalist id={listId}>{field.suggestions!.map(option => <option key={option} value={option} />)}</datalist> : null}
      </>
    )
  }

  return (
    <EhrField className={className} label={<Label field={field} />} hint={field.hint} error={error}>
      {control}
    </EhrField>
  )
}
