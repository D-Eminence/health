import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CODE_BUDGET_HINT, useResendWait } from './recoveryWait'

type Step = 'start' | 'code' | 'password' | 'complete'

export function Recovery() {
  const { api } = useSession()
  useDocumentTitle('Reset your password · Health ID')
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  const [identifier, setIdentifier] = useState('')
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
  const [codeRefused, setCodeRefused] = useState(false)
  const resend = useResendWait()

  const run = async (operation: () => Promise<void>, stepCodes: readonly string[] = []) => {
    const fromField = stepFocus.onTarget()
    setBusy(true); setError(null); setFieldError(false)
    try { await operation() }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') setCodeRefused(true)
      const aboutField = isFieldProblem(reason, stepCodes)
      setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
      setFieldError(aboutField)
      setErrorAlert(!aboutField || fromField)
    } finally { setBusy(false); stepFocus.focus() }
  }

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    void run(async () => {
      try {
        const result = await api.recoveryStart(identifier.trim(), turnstileToken)
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

  // Back to the first step, the identifier kept to be corrected or sent again: another identifier gets a
  // code at once, the same one only once the previous start's wait has passed.
  const restart = () => {
    if (busy) return
    setStep('start'); setError(null); setFieldError(false); setCode(''); setChallengeId(''); setVerificationToken('')
    setPassword(''); setCodeRefused(false); resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's one field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'recovery-error' : undefined

  return <main className="patient-auth-page"><section className="patient-auth-card" aria-labelledby="recovery-title">
    <Link to="/sign-in" className="patient-auth-brand"><BrandLogo /></Link>
    <p className="patient-eyebrow">Account recovery</p><h1 id="recovery-title" className="patient-page-title">Reset your password.</h1>
    {error && <p id="recovery-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form"><p id="recovery-start-hint" className="patient-page-copy">Enter your email or Health ID. We will send a code to your verified contact.</p>
      <label>Email or Health ID<input ref={stepFocus.target} required autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-start-hint', errorId)} /></label>
      <Turnstile action="patient-reset-start" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button></form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form"><p id="recovery-code-hint" className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <label>Recovery code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-code-hint', errorId)} /></label>
      <button className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
      {codeRefused && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}</form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form"><p id="recovery-password-hint" className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      <label>New password<input ref={stepFocus.target} required type="password" autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-password-hint', errorId)} /></label>
      <button className="patient-primary-button" disabled={busy || password.length < 12}>{busy ? 'Saving…' : 'Reset password'}</button></form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2 ref={stepFocus.target} tabIndex={-1}>Password reset complete.</h2><Link className="patient-primary-button" to="/sign-in">Sign in</Link></div>}
    {/* A start within the previous one's wait answers the same challenge and sends no code, but only for the
        same identifier (hid-system #55, migration 0081): another one may be entered at once. A new code for the
        same one is offered once the wait has passed, in a region mounted throughout, so it is announced. */}
    {(step === 'code' || step === 'password') && <div className="patient-auth-footer">
      <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Use a different email or Health ID</button>
      <div role="status">{resend.ready && <><p className="patient-field-hint">No code, or a code refused? Start again with the same email or Health ID to get a new code.</p>
        <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Start again for a new code</button></>}</div></div>}
    <p className="patient-auth-footer"><Link to="/sign-in">Back to sign in</Link></p>
  </section></main>
}
