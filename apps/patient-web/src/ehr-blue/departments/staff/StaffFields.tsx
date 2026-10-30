import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'

/**
 * The target's form parts (prototype src/ui.tsx Form, ErrorBox, PasswordInput) in the blue look, with fixed ids so
 * that a refused field can be focused: "Label *" over the control, the field's problem under it. A field is an
 * EhrField that carries the fixed id as its controlId.
 */

/** A required field's label, "Label *": the star is hidden from screen readers, as the control says it is required. */
export function RequiredLabel({ children }: { readonly children: ReactNode }) {
  return <>{children}<span aria-hidden="true"> *</span></>
}

/** The target's ErrorBox: a refusal, said where the action was taken. */
export function ErrorBox({ children, id, tabIndex }: { readonly children: ReactNode; readonly id?: string; readonly tabIndex?: number }) {
  return <div id={id} tabIndex={tabIndex} role="alert" className="hid-ehr-dept-staff-error">{children}</div>
}

/** A required tick box whose label is a sentence, such as the facility's confirmation. */
export function StaffCheck({ id, checked, onChange, error, children }: {
  readonly id: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly error?: string
  readonly children: ReactNode
}) {
  return (
    <div className="hid-ehr-dept-full">
      <label className="hid-ehr-dept-staff-check">
        <input id={id} type="checkbox" checked={checked} required aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined} onChange={event => onChange(event.target.checked)} />
        <span><RequiredLabel>{children}</RequiredLabel></span>
      </label>
      {error ? <p id={`${id}-error`} className="hid-ehr-error">{error}</p> : null}
    </div>
  )
}

const EYE = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
const EYE_OFF = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>

/**
 * The administrator's own password, which Identity checks as a sign-in does (five wrong ones lock sign-in for 15
 * minutes). The target's password field: an eye inside it shows the password, which is masked again as its form is
 * sent, the page is left or hidden. A hidden username lets a password manager offer the administrator's own password.
 */
export function StaffPassword({ id, value, onChange, error, actorEmail }: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error?: string
  readonly actorEmail: string
}) {
  const [shown, setShown] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = input.current
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
  const toggle = `${shown ? 'Hide' : 'Show'} current password`
  return (
    <EhrField controlId={id} label={<RequiredLabel>Current password</RequiredLabel>} error={error}>
      <input type="email" hidden readOnly autoComplete="username" value={actorEmail} />
      <span className="hid-ehr-dept-staff-password">
        <EhrInput ref={input} type={shown ? 'text' : 'password'} value={value} autoComplete="current-password"
          maxLength={256} spellCheck={false} autoCapitalize="none" required onChange={event => onChange(event.target.value)} />
        <button type="button" className="hid-ehr-dept-staff-password-toggle" aria-label={toggle} title={toggle}
          aria-controls={id} aria-pressed={shown} onMouseDown={event => event.preventDefault()}
          onClick={() => setShown(value => !value)}>{shown ? EYE_OFF : EYE}</button>
      </span>
    </EhrField>
  )
}

/** The target form's footer: its one submit button, and the line it adds under a refusal. */
export function FormFooter({ busy, label, error, children }: {
  readonly busy: boolean
  readonly label: string
  readonly error: string
  readonly children?: ReactNode
}) {
  return (
    <>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <div className="hid-ehr-dept-staff-footer">
        <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : label}</EhrButton>
        {children}
        {error ? <small className="hid-ehr-dept-staff-note">Correct the issue or retry using the same button. No success is reported until saved.</small> : null}
      </div>
    </>
  )
}

