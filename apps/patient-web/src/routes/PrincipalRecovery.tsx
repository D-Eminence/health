import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { createPrincipalRecoveryApi, type RecoveryAudience } from '../recoveryApi'
import { STAFF_RECOVERY_PATH, staffRecoveryHref } from '../productHostname'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CODE_BUDGET_HINT, useResendWait } from './recoveryWait'

type Step = 'start' | 'code' | 'password' | 'complete'

/** Recovery uses only component memory for the challenge and completion token. */
export function PrincipalRecovery({ audience }: { audience: RecoveryAudience }) {
  const api = useMemo(() => createPrincipalRecoveryApi(audience), [audience])
  const signInPath = audience === 'staff' ? '/provider/sign-in' : '/admin/sign-in'
  const accountLabel = audience === 'staff' ? 'Provider' : 'Platform'
  useDocumentTitle(`Reset your password · Health ID ${accountLabel}`)
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  const [identifier, setIdentifier] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  // As in patient recovery: an error about the field is spoken by its description
  // once focus moves there, and is an alert only when focus is already in the field.
  const [errorAlert, setErrorAlert] = useState(true)
  // A code was refused: it may be the account's spent code budget, which the refusal does not tell apart.
  const [codeRefused, setCodeRefused] = useState(false)
  const resend = useResendWait()

  // hid-system refuses a staff reset everywhere but the main site. Opened on a
  // product or admin site (a bookmark, history), the page points there instead.
  const mainSiteRecovery = audience === 'staff' ? staffRecoveryHref(window.location.hostname) : STAFF_RECOVERY_PATH
  if (mainSiteRecovery !== STAFF_RECOVERY_PATH) {
    return <main className="patient-auth-page"><section className="patient-auth-card" aria-labelledby="principal-recovery-title">
      <Link to={signInPath} className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">{accountLabel} account recovery</p>
      <h1 id="principal-recovery-title" className="patient-page-title">Reset your password.</h1>
      <p className="patient-page-copy">Password resets are done on the main Health ID site.</p>
      <a className="patient-primary-button" href={mainSiteRecovery}>Reset your password on the main site</a>
      <p className="patient-auth-footer"><Link to={signInPath}>Back to {accountLabel.toLowerCase()} sign in</Link></p>
    </section></main>
  }

  async function run(operation: () => Promise<void>, stepCodes: readonly string[] = []) {
    const fromField = stepFocus.onTarget()
    setBusy(true)
    setError(null)
    setFieldError(false)
    try { await operation() }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') setCodeRefused(true)
      const aboutField = isFieldProblem(reason, stepCodes)
      setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
      setFieldError(aboutField)
      setErrorAlert(!aboutField || fromField)
    } finally {
      setBusy(false)
      stepFocus.focus()
    }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !turnstileToken) return
    void run(async () => {
      try {
        const result = await api.start(identifier.trim(), turnstileToken)
        setChallengeId(result.challengeId)
        resend.begin(result.resendAfterSeconds)
        setStep('code')
      } finally {
        // A siteverify token is single use, even when the request fails.
        setTurnstileToken(null)
        setTurnstileResetKey(value => value + 1)
      }
    })
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !challengeId || code.length !== 6) return
    void run(async () => {
      const result = await api.verify(challengeId, code)
      setVerificationToken(result.verificationToken)
      setCode('')
      setStep('password')
    }, ['OTP_INVALID_OR_EXPIRED'])
  }

  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !challengeId || !verificationToken || password.length < 12 || password !== confirmPassword) return
    void run(async () => {
      await api.complete(challengeId, verificationToken, password)
      setVerificationToken('')
      setPassword('')
      setConfirmPassword('')
      setStep('complete')
    })
  }

  function restart() {
    if (busy) return
    setStep('start')
    setError(null)
    setFieldError(false)
    setCode('')
    setChallengeId('')
    setVerificationToken('')
    setPassword('')
    setConfirmPassword('')
    setCodeRefused(false)
    resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'principal-recovery-error' : undefined
  // Not while the confirmation is still being typed and agrees so far.
  const mismatch = confirmPassword !== '' && password !== confirmPassword && !password.startsWith(confirmPassword)

  return <main className="patient-auth-page"><section className="patient-auth-card" aria-labelledby="principal-recovery-title">
    <Link to={signInPath} className="patient-auth-brand"><BrandLogo /></Link>
    <p className="patient-eyebrow">{accountLabel} account recovery</p>
    <h1 id="principal-recovery-title" className="patient-page-title">Reset your password.</h1>
    {error && <p id="principal-recovery-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form">
      <p id="principal-recovery-start-hint" className="patient-page-copy">Enter your work email. If an eligible account exists, we will send a code to its verified contact.</p>
      <label>Work email<input ref={stepFocus.target} required type="email" autoComplete="username" maxLength={254} value={identifier} onChange={event => setIdentifier(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-start-hint', errorId)} /></label>
      <Turnstile action={audience === 'staff' ? 'staff-reset' : 'admin-reset'} onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
      <button className="patient-primary-button" type="submit" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button>
    </form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form">
      <p id="principal-recovery-code-hint" className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <label>Recovery code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-code-hint', errorId)} /></label>
      <button className="patient-primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
      {codeRefused && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}
    </form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form">
      <p id="principal-recovery-password-hint" className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      <label>New password<input ref={stepFocus.target} required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-password-hint', errorId)} /></label>
      <label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
        aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'principal-recovery-mismatch' : undefined} /></label>
      {/* Always mounted, so the mismatch is announced once when it appears, not on each keystroke (PA-05). */}
      <div aria-live="polite">{mismatch && <p id="principal-recovery-mismatch" className="patient-inline-error">Passwords do not match.</p>}</div>
      <button className="patient-primary-button" type="submit" disabled={busy || password.length < 12 || password !== confirmPassword}>{busy ? 'Saving…' : 'Reset password'}</button>
    </form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2 ref={stepFocus.target} tabIndex={-1}>Password reset complete.</h2>
      <Link className="patient-primary-button" to={signInPath}>Sign in</Link></div>}
    {/* A start within the previous one's wait answers the same challenge and sends no code, but only for the
        same identifier (hid-system #55, migration 0081): another one may be entered at once. A new code for the
        same one is offered once the wait has passed, in a region mounted throughout, so it is announced. */}
    {(step === 'code' || step === 'password') && <div className="patient-auth-footer">
      <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Use a different work email</button>
      <div role="status">{resend.ready && <><p className="patient-field-hint">No code, or a code refused? Start again with the same work email to get a new code.</p>
        <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Start again for a new code</button></>}</div></div>}
    <p className="patient-auth-footer"><Link to={signInPath}>Back to {accountLabel.toLowerCase()} sign in</Link></p>
  </section></main>
}
