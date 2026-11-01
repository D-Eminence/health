import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { PasswordRules } from '../PasswordRules'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { createPrincipalRecoveryApi, type RecoveryAudience } from '../recoveryApi'
import { STAFF_RECOVERY_PATH, staffRecoveryHref, staffSignInHref } from '../productHostname'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from './recoveryWait'

type Step = 'start' | 'code' | 'password' | 'complete'
const RECOVERY_STEPS: ReadonlyArray<readonly [string, Step]> = [['Email', 'start'], ['Code', 'code'], ['New password', 'password']]

/** Recovery uses only component memory for the challenge and completion token. */
export function PrincipalRecovery({ audience }: { audience: RecoveryAudience }) {
  const api = useMemo(() => createPrincipalRecoveryApi(audience), [audience])
  const signInPath = audience === 'staff' ? '/provider/sign-in' : '/admin/sign-in'
  // On the production portal, staff sign in on the EHR site (staffSignInHref).
  const signInElsewhere = audience === 'staff' ? staffSignInHref(window.location.hostname) : null
  const signInLink = (label: string, className?: string) => signInElsewhere
    ? <a className={className} href={signInElsewhere}>{label}</a>
    : <Link className={className} to={signInPath}>{label}</Link>
  const accountLabel = audience === 'staff' ? 'Provider' : 'Platform'
  const layoutAudience = audience === 'staff' ? 'provider' : 'admin'
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
  const budget = useCodeBudgetNote()
  const resend = useResendWait()

  // hid-system refuses a staff reset everywhere but the main site. Opened on a
  // product or admin site (a bookmark, history), the page points there instead.
  const mainSiteRecovery = audience === 'staff' ? staffRecoveryHref(window.location.hostname) : STAFF_RECOVERY_PATH
  if (mainSiteRecovery !== STAFF_RECOVERY_PATH) {
    return <AuthLayout brandTo={signInPath} audience={layoutAudience} title="Reset your password" titleId="principal-recovery-title"
      lede="Staff reset passwords on the main Health ID site.">
      <a className="patient-primary-button auth-primary" href={mainSiteRecovery}>Reset your password on the main site</a>
      <p className="patient-auth-footer">{signInLink('Back to sign in')}</p>
    </AuthLayout>
  }

  async function run(operation: () => Promise<void>, stepCodes: readonly string[] = []) {
    const fromField = stepFocus.onTarget()
    setBusy(true)
    setError(null)
    setFieldError(false)
    try { await operation() }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') budget.refused(identifier)
      const aboutField = isFieldProblem(reason, stepCodes)
      setError(isHidApiError(reason) ? reason.message : 'Something went wrong. Please try again.')
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
        budget.started(identifier)
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
      budget.accepted()
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

  // Back to the first step, the work email kept. The budget note stays for a start with the same one (useCodeBudgetNote).
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
    resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'principal-recovery-error' : undefined
  // Not while the confirmation is still being typed and agrees so far.
  const mismatch = confirmPassword !== '' && password !== confirmPassword && !password.startsWith(confirmPassword)

  return <AuthLayout brandTo={signInPath} audience={layoutAudience} title="Reset your password" titleId="principal-recovery-title"
    steps={step === 'complete' ? undefined : RECOVERY_STEPS.map(([label, at]) => ({ label, current: at === step }))} stepsLabel="Steps to reset your password">
    {error && <p id="principal-recovery-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form">
      <p id="principal-recovery-start-hint" className="patient-page-copy">We’ll send a code to the email or phone on your work account.</p>
      <label>Work email<input ref={stepFocus.target} required type="email" autoComplete="username" maxLength={254} value={identifier} onChange={event => setIdentifier(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-start-hint', errorId)} /></label>
      <Turnstile action={audience === 'staff' ? 'staff-reset' : 'admin-reset'} onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
      <button className="patient-primary-button" type="submit" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send code'}</button>
    </form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form">
      <p id="principal-recovery-code-hint" className="patient-page-copy">Enter the 6-digit code we sent.</p>
      <label>Code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-code-hint', errorId)} /></label>
      <button className="patient-primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Check code'}</button>
      {budget.shown && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}
    </form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form">
      {/* Two fields, so each toggle is named for its own (a screen reader's list of buttons shows both). */}
      <div className="patient-field"><label htmlFor="principal-recovery-password">New password</label><PasswordInput appearance="plain" id="principal-recovery-password" toggleLabel="Show new password" ref={stepFocus.target} required autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('principal-recovery-password-hint', errorId)} /></div>
      <div className="patient-field"><label htmlFor="principal-recovery-confirm">Confirm new password</label><PasswordInput appearance="plain" id="principal-recovery-confirm" toggleLabel="Show confirmed password" required autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
        aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'principal-recovery-mismatch' : undefined} /></div>
      <PasswordRules id="principal-recovery-password-hint" password={password} confirm={confirmPassword} />
      {/* Always mounted, so the mismatch is announced once when it appears, not on each keystroke (PA-05). */}
      <div aria-live="polite">{mismatch && <p id="principal-recovery-mismatch" className="patient-inline-error">Passwords do not match.</p>}</div>
      <button className="patient-primary-button" type="submit" disabled={busy || password.length < 12 || password !== confirmPassword}>{busy ? 'Saving…' : 'Reset password'}</button>
    </form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2 ref={stepFocus.target} tabIndex={-1}>Your password is reset.</h2>
      {signInLink('Sign in', 'patient-primary-button')}</div>}
    {/* A start within the previous one's wait sends no code for the same identifier, which answers the same
        challenge (hid-system #55, migration 0081), nor for the same account's other identifier; another
        account's work email may be entered at once. A new code is offered once the wait has passed, in a region
        mounted throughout, so it is announced. */}
    {(step === 'code' || step === 'password') && <div className="patient-auth-footer">
      <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Use a different work email</button>
      <div role="status">{resend.ready && <><p className="patient-field-hint">No code, or the code didn’t work? Start again with the same work email to get a new one.</p>
        <button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Start again for a new code</button></>}</div></div>}
    {step !== 'complete' && <p className="patient-auth-footer">{signInLink('Back to sign in')}</p>}
  </AuthLayout>
}
