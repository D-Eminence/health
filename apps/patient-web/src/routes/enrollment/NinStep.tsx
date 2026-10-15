import type { FormEvent, ReactNode } from 'react'
import { describedBy } from '../../authSteps'
import type { StepProps } from './stepProps'

interface NinStepProps extends StepProps {
  nin: string
  onNin: (nin: string) => void
  onSubmit: (event: FormEvent) => void
  /** The security check, which the page owns. */
  turnstile: ReactNode
  /** Why the step cannot be sent yet, besides a NIN of 11 digits and the security check. */
  blocked: boolean
}

/** The NIN, which Identity checks with QoreID before anything else. */
export function NinStep({ focusTarget, busy, invalid, errorId, nin, onNin, onSubmit, turnstile, blocked }: NinStepProps) {
  return <form onSubmit={onSubmit} className="patient-form">
    <label>National Identification Number<input ref={focusTarget} required inputMode="numeric" autoComplete="off" value={nin} onChange={event => onNin(event.target.value.replace(/\D/g, '').slice(0, 11))} pattern="[0-9]{11}" maxLength={11} placeholder="11 digits"
      aria-invalid={invalid} aria-describedby={describedBy('enroll-nin-hint', errorId)} /></label>
    <p id="enroll-nin-hint" className="patient-field-hint">Your NIN is 11 digits. It is verified by the existing Health ID identity service. It is not stored in this browser.</p>
    {turnstile}
    <button type="submit" className="patient-primary-button" disabled={busy || blocked || nin.length !== 11}>{busy ? 'Verifying…' : 'Verify NIN'}</button>
  </form>
}
