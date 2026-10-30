import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrDialog, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { DeptNotice } from '../DeptNotice'
import {
  fieldOptions, isRequired, missingFields, RETRY_TEXT, type SampleField, type SampleOptionContext, type SampleValues,
} from './model'

/** A question before a consequential action, in the design's words. */
export interface SampleConfirm {
  readonly title: string
  readonly body: string
  readonly action: string
  /** A word to type before confirming. */
  readonly word?: string
}

export interface SampleFormProps {
  readonly fields: readonly SampleField[]
  readonly initial?: SampleValues
  /** What the selects' choices depend on. */
  readonly context?: SampleOptionContext
  /** The submit button's words: "Save record", or the action's own label. */
  readonly submitLabel: string
  /** Asked before onSubmit runs, once the fields are complete. */
  readonly confirm?: SampleConfirm
  /** Records the values; a refusal in plain words keeps the form open with it. */
  readonly onSubmit: (values: SampleValues) => string | undefined
  readonly className?: string
  readonly id?: string
  /** Focus the first field as the form opens (an edit form opened by its button). */
  readonly focusFirst?: boolean
}

/**
 * The design's record form: its fields two to a row (a long text across the row), each label marked * when required,
 * selects starting at "Select…", and the design's inline validation: on a save with a required field empty, "Complete
 * this field." under each such field and focus on the first. A consequential action asks first; a refusal shows
 * above the button.
 */
export function SampleForm({ fields, initial = {}, context = {}, submitLabel, confirm, onSubmit, className, id, focusFirst = false }: SampleFormProps) {
  const [values, setValues] = useState<SampleValues>(() => Object.fromEntries(
    fields.map(field => [field.key, initial[field.key] ?? '']),
  ))
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [refusal, setRefusal] = useState('')
  const [asking, setAsking] = useState(false)
  const controls = useRef(new Map<string, HTMLElement>())
  const submitRef = useRef<HTMLButtonElement>(null)
  // Focus moves in the commit that shows the errors, so the field is announced with its error.
  const [focusKey, setFocusKey] = useState<{ readonly key: string } | null>(null)
  useLayoutEffect(() => {
    if (!focusKey) return
    setFocusKey(null)
    controls.current.get(focusKey.key)?.focus()
  }, [focusKey])

  // Once, in the commit that shows the form.
  const [opening] = useState(() => (focusFirst ? fields[0]?.key : undefined))
  useLayoutEffect(() => {
    if (opening) controls.current.get(opening)?.focus()
  }, [opening])

  const change = (key: string, value: string) => {
    setValues(old => ({ ...old, [key]: value }))
    setErrors(old => {
      if (!(key in old)) return old
      const next = { ...old }
      delete next[key]
      return next
    })
  }

  const finish = () => {
    const refused = onSubmit(values)
    setRefusal(refused ?? '')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = missingFields(fields, values)
    setErrors(found)
    const first = fields.find(field => found[field.key])
    if (first) {
      setFocusKey({ key: first.key })
      return
    }
    if (confirm) setAsking(true)
    else finish()
  }

  const control = (key: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(key, element)
    else controls.current.delete(key)
  }

  return (
    <form id={id} className={['hid-ehr-dept-form', className].filter(Boolean).join(' ')} noValidate onSubmit={submit}>
      {fields.length > 0 ? (
        <div className="hid-ehr-dept-form-grid">
          {fields.map(field => {
            const options = fieldOptions(field, context)
            const required = isRequired(field)
            const value = values[field.key] ?? ''
            return (
              <EhrField key={field.key} className={field.type === 'textarea' ? 'hid-ehr-dept-full' : undefined}
                label={<>{field.label}{required ? <span aria-hidden="true"> *</span> : null}</>} error={errors[field.key]}>
                {options ? (
                  <EhrSelect ref={control(field.key)} required={required} value={value} onChange={event => change(field.key, event.target.value)}>
                    <option value="">Select…</option>
                    {options.map((option, index) => <option key={`${index}-${option.value}`} value={option.value}>{option.label}</option>)}
                  </EhrSelect>
                ) : field.type === 'textarea' ? (
                  <EhrTextarea ref={control(field.key)} rows={3} required={required} value={value} onChange={event => change(field.key, event.target.value)} />
                ) : (
                  <EhrInput ref={control(field.key)} type={field.type ?? 'text'} required={required} value={value}
                    onChange={event => change(field.key, event.target.value)} />
                )}
              </EhrField>
            )
          })}
        </div>
      ) : null}
      {refusal ? <DeptNotice tone="critical" role="alert">{refusal}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions hid-ehr-dept-sample-footer">
        <EhrButton ref={submitRef} type="submit">{submitLabel}</EhrButton>
        {refusal ? <p className="hid-ehr-dept-muted">{RETRY_TEXT}</p> : null}
      </div>
      {confirm ? (
        <EhrDialog open={asking} title={confirm.title} description={confirm.body} confirmLabel={confirm.action} confirmWord={confirm.word}
          returnFocusRef={submitRef} onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); finish() }} />
      ) : null}
    </form>
  )
}
