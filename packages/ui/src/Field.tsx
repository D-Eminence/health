'use client'

/**
 * Form controls, and the Field that labels and describes them.
 *
 * Field gives its hint or error id to the control inside it through context,
 * so a screen reader announces them with the control and an error marks it
 * invalid, without each caller wiring aria-describedby by hand. Context needs a
 * client module; server components can still render these.
 *
 * A Field wraps one control: every Input, PasswordInput, Select and Textarea
 * inside it takes its hint or error, whatever its id. Only these read it; a
 * SearchField or a native control in a Field takes aria-describedby and
 * aria-invalid from its caller.
 */

import { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import ViewIcon from '@hugeicons/core-free-icons/ViewIcon'
import ViewOffSlashIcon from '@hugeicons/core-free-icons/ViewOffSlashIcon'
import { cx } from './primitives'

const CONTROL_BASE =
  'w-full rounded-(--radius-control) border bg-surface px-3 py-2.5 font-sans text-[14px] leading-[1.25] text-ink placeholder:text-faint transition-[border-color,box-shadow,background-color] duration-150 focus:outline-2 focus:outline-offset-2 focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-tint disabled:text-muted disabled:opacity-70'

/**
 * Border and focus colours by state. Never both: with two border colours on one
 * element, Tailwind's source order, not the state, decides which one shows.
 *
 * The outline is what shows focus. The border change and the halo are under 3:1
 * against what they replace, and an invalid control's border is red at rest. It
 * is on :focus, not only :focus-visible, so a field focused after a refused
 * submit shows it too.
 */
const controlState = (invalid: boolean) => invalid
  ? 'border-critical focus:border-critical focus:outline-critical focus:ring-critical/20'
  : 'border-line-control focus:border-brand focus:outline-brand focus:ring-brand/25'

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

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** The field's id: a label points at it, and the toggle names it as what it controls. */
  readonly id: string
  /**
   * The toggle's accessible name, the same whether the password is shown or not
   * (aria-pressed says which). Give each toggle its own where a form has two fields.
   */
  readonly toggleLabel?: string
  /** 'control' styles the field as Input does; 'plain' leaves it to the page's own form styles. */
  readonly appearance?: 'control' | 'plain'
}

// The eye sits inside the field, at its end, as people expect: one box, not a field and a button side by side.
const PASSWORD_TOGGLE =
  'absolute inset-y-0 right-0 inline-flex w-11 cursor-pointer items-center justify-center rounded-r-(--radius-control) border-0 bg-transparent text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:text-brand'

/**
 * A password field with a show/hide eye inside it, at its end.
 *
 * The toggle is a button outside the field's label: inside a label its text
 * becomes part of the field's name ("Password Show password"). Its name stays
 * the same and aria-pressed says whether the password is shown, as the WAI-ARIA
 * toggle button pattern asks; the eye icon and the pressed style show it too.
 * Showing the password changes only how it is displayed: the value, the
 * autocomplete hint and the form's submission are untouched, a pointer press
 * leaves focus in the field, and the field is masked again when its form is sent,
 * the page is left (or kept in the back/forward cache) or the person switches
 * away from it (another tab or app, a locked screen): the device may be shared.
 * It is the only reveal control: Edge's own button in password fields is hidden.
 * The eye button is the field's full height and 44px wide; the field keeps room for it on the right.
 * Give the field a label with htmlFor={id}. Its ref is the field.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({
  id,
  toggleLabel = 'Show password',
  appearance = 'control',
  invalid = false,
  className,
  disabled,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}, ref: Ref<HTMLInputElement>) {
  // Invalid when the caller says so (as aria-invalid, as a page's own fields do) or its Field has an error.
  const state = useFieldState(invalid || ariaInvalid === true || ariaInvalid === 'true', describedBy)
  const [shown, setShown] = useState(false)
  const field = useRef<HTMLInputElement | null>(null)
  const selection = useRef<readonly [number, number] | null>(null)
  const setField = useCallback((element: HTMLInputElement | null) => {
    field.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }, [ref])

  // A pointer or touch press that changes the type puts Chromium's caret at the
  // start of the field. Setting it back once the new type is laid out (reading
  // offsetWidth forces that) keeps the person's place; doing it any sooner does not.
  useLayoutEffect(() => {
    const element = field.current
    const saved = selection.current
    selection.current = null
    if (!element || !saved || document.activeElement !== element) return
    void element.offsetWidth
    element.setSelectionRange(saved[0], saved[1])
  }, [shown])

  // Masked again, at once, when the form is sent, the page is left, or it is hidden.
  useEffect(() => {
    const element = field.current
    if (!shown || !element) return
    const hide = () => { element.type = 'password'; setShown(false) }
    const hidden = () => { if (document.visibilityState === 'hidden') hide() }
    const form = element.form
    form?.addEventListener('submit', hide)
    window.addEventListener('pagehide', hide)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      form?.removeEventListener('submit', hide)
      window.removeEventListener('pagehide', hide)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [shown])

  const toggle = () => {
    const element = field.current
    selection.current = element && element.selectionStart !== null && element.selectionEnd !== null
      ? [element.selectionStart, element.selectionEnd] : null
    setShown(value => !value)
  }

  return (
    <span className="relative flex min-w-0 items-stretch">
      <input
        {...rest}
        ref={setField}
        id={id}
        type={shown ? 'text' : 'password'}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-invalid={state.invalid || undefined}
        aria-describedby={state.describedBy}
        className={cx(appearance === 'control' && CONTROL_BASE, appearance === 'control' && controlState(state.invalid),
          'min-w-0 flex-1 pr-12 [&::-ms-reveal]:hidden', className)}
      />
      <button
        type="button"
        className={PASSWORD_TOGGLE}
        aria-label={toggleLabel}
        title={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={id}
        disabled={disabled}
        onMouseDown={event => event.preventDefault()}
        onClick={toggle}
      >
        <HugeiconsIcon icon={shown ? ViewOffSlashIcon : ViewIcon} size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </span>
  )
})

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
