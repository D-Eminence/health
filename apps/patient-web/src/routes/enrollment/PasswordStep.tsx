import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'
import type { StepProps } from './stepProps'

/** One enrollment's activation attempts are limited to 15 in 15 minutes (hid-system #61 and #50). */
const ACTIVATION_LIMIT_HINT = 'This enrollment has had too many activation attempts. Wait about 15 minutes, then activate again: the enrollment is kept.'

interface PasswordStepProps extends StepProps {
  password: string
  onPassword: (password: string) => void
  onSubmit: (event: FormEvent) => void
  /** Why the step cannot be sent yet, besides a password of 12 characters. */
  blocked: boolean
  /** Activation was refused for too many attempts. */
  limitNote: boolean
}

/** The password, which activates the Health ID. */
export function PasswordStep({ focusTarget, busy, invalid, errorId, password, onPassword, onSubmit, blocked, limitNote }: PasswordStepProps) {
  return <form onSubmit={onSubmit} className="patient-form">
    <h2>Activate your account</h2><p id="enroll-password-hint" className="patient-field-hint">Choose a password of at least 12 characters.</p>
    <label>Password<input ref={focusTarget} required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => onPassword(event.target.value)}
      aria-invalid={invalid} aria-describedby={describedBy('enroll-password-hint', errorId)} /></label>
    <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12 || blocked}>{busy ? 'Activating…' : 'Activate Health ID'}</button>
    {limitNote && <p className="patient-field-hint">{ACTIVATION_LIMIT_HINT}</p>}
  </form>
}
