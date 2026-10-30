import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { EhrField, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { focusIsWithin } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { NOT_COLLECTED, PROVISIONAL_LABEL } from './registrationText'

/** The design's ErrorBox: a refusal after an action, or a read that failed. */
export function ErrorBox({ message }: { readonly message: string }) {
  return message ? <div role="alert" className="hid-ehr-dept-registration-error">{message}</div> : null
}

interface Shown {
  readonly errors: Readonly<Record<string, string>>
  /** The field refused while focus was already in it: its error is an alert there, new for each refusal (seq). */
  readonly alert?: string
  readonly seq: number
}

/**
 * A form's refusals before sending, in today's words (PEHR-04, staff/useFieldProblems.tsx), drawn as the design's
 * validation (03-new-patient-validation): every refused field marked at once, each with its error under it, and focus on
 * the first. Refused from Enter in that field itself, focus cannot move, so its error is an alert there instead.
 * Errors belong to a control by its id, which the control's EhrField takes as its controlId.
 */
export function useFormProblems() {
  const focus = useFocusById()
  const [shown, setShown] = useState<Shown>({ errors: {}, seq: 0 })
  /** Refuses each [control id, message], in the form's order. */
  const refuse = useCallback((refused: ReadonlyArray<readonly [string, string]>) => {
    const first = refused[0]?.[0]
    if (!first) return
    const here = focusIsWithin(first)
    setShown(previous => ({ errors: Object.fromEntries(refused), alert: here ? first : undefined, seq: previous.seq + 1 }))
    if (!here) focus(first)
  }, [focus])
  const clear = useCallback(() => setShown(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous)), [])
  const error = (id: string): ReactNode => {
    const message = shown.errors[id]
    if (message === undefined) return undefined
    return shown.alert === id ? <span key={shown.seq} role="alert">{message}</span> : message
  }
  return { refuse, clear, error }
}
export type FormProblems = ReturnType<typeof useFormProblems>

/**
 * Idempotency keys stay in component memory only and are reused for an unchanged retry (Registration.tsx 28-38).
 */
export function useCommandKey() {
  const previous = useRef<{ signature: string; key: string } | null>(null)
  return {
    forInput(signature: string) {
      if (previous.current?.signature !== signature) previous.current = { signature, key: crypto.randomUUID() }
      return previous.current.key
    },
    clear() { previous.current = null },
  }
}

/**
 * A field of the design's form that Health ID does not take (owner decision): shown, disabled, and saying so. It has
 * no name and no value, so nothing typed here could be sent or kept; it is disabled, so nothing can be typed.
 */
export function NotCollectedField({ label, multiline = false, className }: {
  readonly label: string
  readonly multiline?: boolean
  readonly className?: string
}) {
  return (
    <EhrField label={label} hint={NOT_COLLECTED} className={className}>
      {multiline ? <EhrTextarea rows={3} disabled /> : <EhrInput disabled autoComplete="off" />}
    </EhrField>
  )
}

/** The design's "Provisional local identity" checkbox, beside its label, likewise not taken: disabled, with the hint. */
export function NotCollectedCheck() {
  const id = useId()
  return (
    <div className="hid-ehr-field hid-ehr-dept-registration-check">
      <label className="hid-ehr-label" htmlFor={`${id}-control`}>
        {PROVISIONAL_LABEL}
        <input id={`${id}-control`} type="checkbox" disabled aria-describedby={`${id}-hint`} />
      </label>
      <p id={`${id}-hint`} className="hid-ehr-hint">{NOT_COLLECTED}</p>
    </div>
  )
}

/** A design action Health ID cannot do: shown disabled, its one-line reason under it. */
export function UnavailableAction({ label, reason, variant = 'secondary', wide = false }: {
  readonly label: string
  readonly reason: string
  readonly variant?: 'primary' | 'secondary'
  /** Full width, as an action in "Available actions". */
  readonly wide?: boolean
}) {
  const id = useId()
  return (
    <div className={['hid-ehr-dept-registration-off', wide ? 'hid-ehr-dept-registration-off-wide' : undefined].filter(Boolean).join(' ')}>
      <button type="button" disabled aria-describedby={`${id}-reason`}
        className={['hid-ehr-button', variant === 'secondary' ? 'hid-ehr-button-secondary' : undefined].filter(Boolean).join(' ')}>
        {label}
      </button>
      <p id={`${id}-reason`} className="hid-ehr-dept-registration-reason">{reason}</p>
    </div>
  )
}

/** The sidebar icon (the design's "registration": a page being filled in), in the departments' inline stroke style. */
export function RegistrationIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M13 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v4" />
      <path d="M14 3v5h5M9 13h4M9 17h2" />
      <path d="m15.5 20.5.5-2.5 4-4a1.4 1.4 0 0 1 2 2l-4 4z" />
    </svg>
  )
}
