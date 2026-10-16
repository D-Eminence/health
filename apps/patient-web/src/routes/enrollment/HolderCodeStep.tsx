import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'

/** Codes one registration may send to the phone on the NIN record (hid-system ADR-062). */
export const HOLDER_CODES_PER_REGISTRATION = 3

interface HolderCodeStepProps {
  /** The heading takes focus on arrival, the field after a refusal about the code. */
  focusTarget: (element: HTMLElement | null) => void
  busy: boolean
  /** The error is about the code typed. */
  codeError: boolean
  errorId: string | undefined
  /** Seconds the code lives, when Identity said. */
  expiresInSeconds: number | null
  code: string
  onCode: (code: string) => void
  onSubmit: (event: FormEvent) => void
  /** Whether a new code may be asked for now (recoveryWait.ts useResendWait), and the wait said until then. */
  resendReady: boolean
  resendWaitSeconds: number
  onResend: () => void
  onOtherWay: () => void
  onDifferentNin: () => void
}

/** The code texted to the phone on the NIN record (POST .../holder/verify). */
export function HolderCodeStep(props: HolderCodeStepProps) {
  const { focusTarget, busy, codeError, errorId, expiresInSeconds, code, onCode, onSubmit,
    resendReady, resendWaitSeconds, onResend, onOtherWay, onDifferentNin } = props
  const minutes = expiresInSeconds !== null && expiresInSeconds > 0 ? Math.ceil(expiresInSeconds / 60) : null
  const incomplete = code.length !== 6
  return <form onSubmit={onSubmit} className="patient-form">
    <h2 ref={codeError ? undefined : focusTarget} tabIndex={-1}>Enter the code we texted you</h2>
    <p id="enroll-holder-code-hint" className="patient-field-hint">
      We sent a 6-digit code to the phone number linked to your NIN.{minutes !== null && ` It expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`}
    </p>
    <label>Verification code<input ref={codeError ? focusTarget : undefined} required inputMode="numeric" autoComplete="one-time-code" value={code}
      onChange={event => onCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" maxLength={6}
      aria-invalid={codeError ? true : undefined} aria-describedby={describedBy('enroll-holder-code-hint', codeError && errorId)} /></label>
    {incomplete && <p id="enroll-holder-code-needed" className="patient-field-hint">Enter the 6-digit code to continue.</p>}
    <button type="submit" className="patient-primary-button" disabled={busy || incomplete}
      aria-describedby={incomplete ? 'enroll-holder-code-needed' : undefined}>{busy ? 'Checking…' : 'Verify code'}</button>
    <button type="button" className="patient-text-button" disabled={busy || !resendReady} onClick={onResend}
      aria-describedby={resendReady ? undefined : 'enroll-resend-wait'}>Send a new code</button>
    {!resendReady && <p id="enroll-resend-wait" className="patient-field-hint">A new code can be sent {resendWaitSeconds} seconds after the last one.</p>}
    {/* Mounted throughout, so a new code being on offer is announced once, politely. */}
    <p role="status" className="patient-field-hint">{resendReady ? 'You can ask for a new code now.' : ''}</p>
    <p className="patient-field-hint">This registration can get up to {HOLDER_CODES_PER_REGISTRATION} codes.</p>
    <button type="button" className="patient-text-button" disabled={busy} onClick={onOtherWay}>I can't get the code</button>
    <button type="button" className="patient-text-button" disabled={busy} onClick={onDifferentNin}>Use a different NIN</button>
  </form>
}
