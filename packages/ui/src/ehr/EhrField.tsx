'use client'

/**
 * An EHR form field: a visible label tied to its control, and a hint and an
 * error tied to it by aria-describedby. An error marks the control
 * aria-invalid and is written out as text beside an icon, never colour alone.
 *
 * Put one EhrInput, EhrSelect or EhrTextarea inside an EhrField; the control
 * takes its id and descriptions from the field.
 */

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon'
import { cx } from '../primitives'

interface EhrFieldContextValue {
  readonly controlId: string
  readonly describedBy: string | undefined
  readonly invalid: boolean
}

const EhrFieldContext = createContext<EhrFieldContextValue | null>(null)

export interface EhrFieldProps {
  readonly label: ReactNode
  readonly hint?: ReactNode
  /** Plain-language copy saying what to change. */
  readonly error?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function EhrField({ label, hint, error, children, className }: EhrFieldProps) {
  const id = useId()
  const controlId = `${id}-control`
  const hintId = hint !== undefined ? `${id}-hint` : undefined
  const errorId = error !== undefined ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <EhrFieldContext.Provider value={{ controlId, describedBy, invalid: error !== undefined }}>
      <div className={cx('hid-ehr-field', className)}>
        <label className="hid-ehr-label" htmlFor={controlId}>{label}</label>
        {children}
        {hint !== undefined ? <p id={hintId} className="hid-ehr-hint">{hint}</p> : null}
        {error !== undefined ? (
          <p id={errorId} className="hid-ehr-error">
            <span className="hid-ehr-error-icon" aria-hidden="true">
              <HugeiconsIcon icon={Alert02Icon} size={14} strokeWidth={1.65} aria-hidden />
            </span>
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </EhrFieldContext.Provider>
  )
}

interface ControlAttributes {
  readonly id?: string
  readonly 'aria-describedby'?: string
  readonly 'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid']
}

/** The id, descriptions and validity a control takes from its field, joined with its own. */
function useFieldControl({ id, 'aria-describedby': ownDescribedBy, 'aria-invalid': ownInvalid }: ControlAttributes) {
  const field = useContext(EhrFieldContext)
  const describedBy = [field?.describedBy, ownDescribedBy].filter(Boolean).join(' ') || undefined
  return {
    id: id ?? field?.controlId,
    'aria-describedby': describedBy,
    'aria-invalid': ownInvalid ?? (field?.invalid ? true : undefined),
  }
}

export interface EhrInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>
}

export function EhrInput({ className, ref, ...props }: EhrInputProps) {
  const control = useFieldControl(props)
  return <input {...props} {...control} ref={ref} className={cx('hid-ehr-control', className)} />
}

export interface EhrSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>
}

export function EhrSelect({ className, ref, ...props }: EhrSelectProps) {
  const control = useFieldControl(props)
  return <select {...props} {...control} ref={ref} className={cx('hid-ehr-control', className)} />
}

export interface EhrTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>
}

export function EhrTextarea({ className, ref, ...props }: EhrTextareaProps) {
  const control = useFieldControl(props)
  return <textarea {...props} {...control} ref={ref} className={cx('hid-ehr-control', 'hid-ehr-textarea', className)} />
}
