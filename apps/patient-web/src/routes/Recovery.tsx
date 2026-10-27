import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { HEALTH_ID_PREFIX, emailOrHealthId, healthIdOrOtherInput, isBlankHealthIdInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from './recoveryWait'

type Step = 'start' | 'code' | 'password' | 'complete'

export function Recovery() {
  const { api } = useSession()
  useDocumentTitle('Reset your password · Health ID')
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  // Starts at HID- (owner decision, 2026-10-27); an email typed after it drops it.
  const [identifier, setIdentifier] = useState(HEALTH_ID_PREFIX)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  // An error about the field is announced by the field's description once focus
  // moves there; it is an alert only when focus is already in the field (Enter),
  // or when it is not about the field at all. As both it would be spoken twice.
  const [errorAlert, setErrorAlert] = useState(true)
  // A code was refused: it may be the account's spent code budget, which the refusal does not tell apart.
  const budget = useCodeBudgetNote()
  const resend = useResendWait()

  const run = async (operation: () => Promise<void>, stepCodes: readonly string[] = []) => {
    const fromField = stepFocus.onTarget()
    setBusy(true); setError(null); setFieldError(false)
    try { await operation() }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') budget.refused(emailOrHealthId(identifier))
      const aboutField = isFieldProblem(reason, stepCodes)
      setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
      setFieldError(aboutField)
      setErrorAlert(!aboutField || fromField)
    } finally { setBusy(false); stepFocus.focus() }
  }

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    // Only the prefill: as empty as the field was before it was filled in, so nothing is sent.
    if (isBlankHealthIdInput(identifier)) {
      setError('Enter your email or Health ID.'); setFieldError(true); setErrorAlert(stepFocus.onTarget()); stepFocus.focus(); return
    }
    void run(async () => {
      try {
        const result = await api.recoveryStart(emailOrHealthId(identifier), turnstileToken)
        budget.started(emailOrHealthId(identifier))
        setChallengeId(result.challengeId)
        resend.begin(result.resendAfterSeconds)
        setStep('code')
      } finally { setTurnstileToken(null); setResetKey(value => value + 1) }
    })
  }

  const verify = (event: FormEvent) => {
    event.preventDefault()
    if (!challengeId || busy) return
    void run(async () => {
      const result = await api.recoveryVerify(challengeId, code)
      budget.accepted()
      setVerificationToken(result.verificationToken)
      setCode('')
      setStep('password')
    }, ['OTP_INVALID_OR_EXPIRED'])
  }

  const complete = (event: FormEvent) => {
    event.preventDefault()
    if (!verificationToken || password.length < 12 || busy) return
    void run(async () => {
      await api.recoveryComplete(challengeId, verificationToken, password)
      setVerificationToken(''); setPassword(''); setStep('complete')
    })
  }

  // Back to the first step, the identifier kept to be corrected or sent again: another account's identifier
  // gets a code at once; the same one, or the same account's other one, only once the previous start's wait
  // has passed. The budget note stays for a start with the same identifier (useCodeBudgetNote).
  const restart = () => {
    if (busy) return
    setStep('start'); setError(null); setFieldError(false); setCode(''); setChallengeId(''); setVerificationToken('')
    setPassword(''); resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's one field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'recovery-error' : undefined

  return <AuthLayout brandTo="/sign-in" title="Reset your password." titleId="recovery-title">
    {error && <p id="recovery-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form"><p id="recovery-start-hint" className="patient-page-copy">Enter your email or Health ID. We will send a code to your verified contact.</p>
      <label>Email or Health ID<input ref={stepFocus.target} required autoComplete="username" value={identifier} onChange={event => setIdentifier(healthIdOrOtherInput(event.target.value))}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-start-hint', errorId)} /></label>
      <Turnstile action="patient-reset-start" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button></form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form"><p id="recovery-code-hint" className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <label>Recovery code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-code-hint', errorId)} /></label>
      <button className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
      {budget.shown && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}</form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form"><p id="recovery-password-hint" className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      <div className="patient-field"><label htmlFor="recovery-password">New password</label><PasswordInput appearance="plain" id="recovery-password" ref={stepFocus.target} required autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-password-hint', errorId)} /></div>
      <button className="patient-primary-button" disabled={busy || password.length < 12}>{busy ? 'Saving…' : 'Reset password'}</button></form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2 ref={stepFocus.target} tabIndex={-1}>Password reset complete.</h2><Link className="patient-primary-button" to="/sign-in">Sign in</Link></div>}
    {/* A start within the previous one's wait sends no code for the same identifier, which answers the same
        challenge (hid-system #55, migration 0081), nor for the same account's other identifier, which since #55
        answers a new challengeId under which the code already sent is not accepted; another account's identifier
        may be entered at once. A new code is offered once the wait has passed, in a region mounted throughout,
        so it is announced. */}
    {(step === 'code' || step === 'password') && <div className="patient-auth-footer">
      <button className="patient-text-button" type="button" onClick={restart} disabled={busy}
        aria-describedby={resend.ready ? undefined : 'recovery-other-identifier-hint'}>Use a different email or Health ID</button>
      {!resend.ready && <p id="recovery-other-identifier-hint" className="patient-field-hint">The same account's other email or Health ID will not get a new code until a new code is offered here, and using it before then may stop the code already sent from being accepted.</p>}
      <div role="status">{resend.ready && <><p className="patient-field-hint">No code, or a code refused? Start again with the same email or Health ID to get a new code.</p>
        <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Start again for a new code</button></>}</div></div>}
    <p className="patient-auth-footer"><Link to="/sign-in">Back to sign in</Link></p>
  </AuthLayout>
}
