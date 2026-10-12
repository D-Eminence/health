'use client'

/**
 * Form controls, and the Field that labels and describes them.
 *
 * Field gives its hint or error id to the control inside it through context,
 * so a screen reader announces them with the control and an error marks it
 * invalid, without each caller wiring aria-describedby by hand. Context needs a
 * client module; server components can still render these.
 */

import { createContext, useContext } from 'react'
import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cx } from './primitives'

const CONTROL_BASE =
  'w-full rounded-(--radius-control) border bg-surface px-3 py-2.5 font-sans text-[14px] leading-[1.25] text-ink placeholder:text-faint transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-tint disabled:text-muted disabled:opacity-70'

/**
 * Border and focus colours by state. Never both: with two border colours on one
 * element, Tailwind's source order, not the state, decides which one shows.
 */
const controlState = (invalid: boolean) => invalid
  ? 'border-critical focus:border-critical focus:ring-critical/20'
  : 'border-line-control focus:border-brand focus:ring-brand/25'

interface FieldState {
  /** The id of the error when there is one, otherwise of the hint. */
  readonly describedBy?: string
  readonly invalid: boolean
}

const FieldContext = createContext<FieldState>({ invalid: false })

/** A control's description and validity: its own, joined with its Field's, each id once. */
function useFieldState(invalid: boolean, describedBy: string | undefined): FieldState {
  const field = useContext(FieldContext)
  const ids = [...new Set([field.describedBy, ...(describedBy?.split(/\s+/) ?? [])].filter(Boolean))]
  return { describedBy: ids.length > 0 ? ids.join(' ') : undefined, invalid: invalid || field.invalid }
}

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode
  readonly htmlFor: string
  readonly hint?: ReactNode
  readonly error?: ReactNode
  readonly required?: boolean
  readonly children: ReactNode
}

/** Labels, help and error copy stay consistently associated with controls. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
  ...rest
}: FieldProps) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined
  return (
    <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>
      <div className={cx('grid gap-1.5', className)} {...rest}>
        <label htmlFor={htmlFor} className="text-[13px] font-medium leading-[1.25] text-ink">
          {label}
          {required ? <span aria-hidden="true" className="ml-1 text-critical">*</span> : null}
        </label>
        {children}
        {error ? <p id={`${htmlFor}-error`} className="text-[12px] leading-[1.45] text-critical">{error}</p> : null}
        {!error && hint ? <p id={`${htmlFor}-hint`} className="text-[12px] leading-[1.45] text-muted">{hint}</p> : null}
      </div>
    </FieldContext.Provider>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean
}

export function Input({ invalid = false, className, 'aria-describedby': describedBy, ...rest }: InputProps) {
  const state = useFieldState(invalid, describedBy)
  return (
    <input
      aria-invalid={state.invalid || undefined}
      aria-describedby={state.describedBy}
      className={cx(CONTROL_BASE, controlState(state.invalid), className)}
      {...rest}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean
}

export function Textarea({ invalid = false, className, 'aria-describedby': describedBy, ...rest }: TextareaProps) {
  const state = useFieldState(invalid, describedBy)
  return (
    <textarea
      aria-invalid={state.invalid || undefined}
      aria-describedby={state.describedBy}
      className={cx(CONTROL_BASE, 'min-h-28 resize-y leading-[1.45]', controlState(state.invalid), className)}
      {...rest}
    />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean
}

export function Select({ invalid = false, className, children, 'aria-describedby': describedBy, ...rest }: SelectProps) {
  const state = useFieldState(invalid, describedBy)
  return (
    <select
      aria-invalid={state.invalid || undefined}
      aria-describedby={state.describedBy}
      className={cx(CONTROL_BASE, 'h-[38px] py-0', controlState(state.invalid), className)}
      {...rest}
    >
      {children}
    </select>
  )
}
