import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { EhrField, EhrIconButton, EhrInput } from '@hid/ui/ehr'

/** The design's eye (the kit has none): decorative, the button's name says what it does. */
function Eye() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
  </svg>
}

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  readonly label: ReactNode
  readonly controlId: string
  readonly hint?: ReactNode
  readonly error?: ReactNode
  /** The eye's name; each eye on a screen has its own (a confirmation's says so). */
  readonly toggleLabel?: string
}

/**
 * A password field with the design's eye beside it, as today's PasswordInput (@hid/ui Field.tsx) behaves: the toggle is
 * a button outside the label, named "Show password" with aria-pressed saying whether the password is shown, and the
 * field is masked again when its form is sent, the page is left or hidden (the device may be shared). Showing it
 * changes only how it is displayed.
 */
export function PasswordField({ label, controlId, hint, error, disabled, toggleLabel = 'Show password', ...input }: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = field.current
    if (!shown || !element) return
    const hide = () => setShown(false)
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

  return (
    <EhrField label={label} hint={hint} error={error} controlId={controlId}>
      <div className="hid-ehr-signup-password">
        <EhrInput {...input} ref={field} type={shown && !disabled ? 'text' : 'password'} disabled={disabled} />
        <EhrIconButton variant="quiet" className="hid-ehr-signup-password-toggle" aria-label={toggleLabel}
          aria-pressed={shown && !disabled} aria-controls={controlId} disabled={disabled} icon={<Eye />}
          onClick={() => setShown(value => !value)} />
      </div>
    </EhrField>
  )
}
