import { useMemo, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Alert, Button, buttonClass } from '../../../kasuwa/ui'
import { Turnstile } from '../../../Turnstile'
import { createPrincipalRecoveryApi } from '../../../recoveryApi'
import { STAFF_RECOVERY_PATH, staffRecoveryHref } from '../../../productHostname'
import { OpenStaffPage } from '../../../staffSignIn'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../../../authSteps'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from '../../../routes/recoveryWait'
import { authHrefs, BlueAuthLayout, HINT, NOTE, SiteLink } from './BlueAuthLayout'

type Step = 'start' | 'code' | 'password' | 'complete'

/**
 * The Hospital EHR's staff password recovery, in the redesign's auth look, working as today's does
 * (routes/PrincipalRecovery.tsx, audience 'staff'): the work email with Turnstile, a neutral answer whether or not the
 * account exists, the six-digit code, then a new password of at least 12 characters. The challenge and its token live
 * in component memory only. Each product site has its own, which hid-system accepts there (staff-reset); on a site that
 * serves no staff pages (the production patient portal, an admin site) it opens the EHR site's at once. App.tsx opens it at
 * /provider/recover in place of today's page once the clinic switch is on (BLUE_FOR_ALL).
 */
export function BlueRecovery() {
  const api = useMemo(() => createPrincipalRecoveryApi('staff'), [])
  useDocumentTitle('Recover account access · Health ID Hospital EHR')
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
  const [errorAlert, setErrorAlert] = useState(true)
  const budget = useCodeBudgetNote()
  const resend = useResendWait()
  const signIn = authHrefs().signIn

  const elsewhere = staffRecoveryHref(window.location.hostname)
  if (elsewhere !== STAFF_RECOVERY_PATH) return <OpenStaffPage href={elsewhere} />

  async function run(operation: () => Promise<void>, stepCodes: readonly string[] = []) {
    const fromField = stepFocus.onTarget()
    setBusy(true)
    setError(null)
    setFieldError(false)
    try { await operation() } catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') budget.refused(identifier)
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

  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'blue-recovery-error' : undefined
  const mismatch = confirmPassword !== '' && password !== confirmPassword && !password.startsWith(confirmPassword)

  return (
    <BlueAuthLayout title="Recover account access" titleId="blue-recovery-title" lede="For staff accounts.">
      {/* Every refusal is boxed; it is an alert unless it is about the field focus is moving to, which says it. */}
      {error ? <Alert id="blue-recovery-error" intent="error" size="sm" live={errorAlert}>{error}</Alert> : null}
      {step === 'start' ? (
        <form onSubmit={start} className="staff-form">
          <p id="blue-recovery-start-hint" className={NOTE}>Enter your work email. If an account exists, we send a code to its verified contact.</p>
          <div className="auth-field-label">
            <label htmlFor="blue-recovery-email">Work email</label>
            <input id="blue-recovery-email" ref={stepFocus.target} required type="email" autoComplete="username" maxLength={254} value={identifier}
              onChange={event => setIdentifier(event.target.value)} aria-invalid={invalid}
              aria-describedby={describedBy('blue-recovery-start-hint', errorId)} />
          </div>
          <Turnstile action="staff-reset" onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</Button>
        </form>
      ) : null}
      {step === 'code' ? (
        <form onSubmit={verify} className="staff-form">
          <p id="blue-recovery-code-hint" className={NOTE}>Enter the 6-digit code sent to your verified contact.</p>
          <div className="auth-field-label">
            <label htmlFor="blue-recovery-code">Recovery code</label>
            <input id="blue-recovery-code" ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={invalid}
              aria-describedby={describedBy('blue-recovery-code-hint', errorId)} />
          </div>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</Button>
          {budget.shown ? <p className={HINT}>{CODE_BUDGET_HINT}</p> : null}
        </form>
      ) : null}
      {step === 'password' ? (
        <form onSubmit={complete} className="staff-form">
          <p id="blue-recovery-password-hint" className={NOTE}>Choose a new password of at least 12 characters.</p>
          <div className="auth-field-label">
            <label htmlFor="blue-recovery-password">New password</label>
            <PasswordInput appearance="plain" id="blue-recovery-password" toggleLabel="Show new password" ref={stepFocus.target} required
              autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}
              aria-invalid={invalid} aria-describedby={describedBy('blue-recovery-password-hint', errorId)} />
          </div>
          <div className="auth-field-label">
            <label htmlFor="blue-recovery-confirm">Confirm new password</label>
            <PasswordInput appearance="plain" id="blue-recovery-confirm" toggleLabel="Show confirmed password" required autoComplete="new-password"
              minLength={12} maxLength={256} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
              aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'blue-recovery-mismatch' : undefined} />
          </div>
          {/* Always mounted, so the mismatch is announced once when it appears, not on each keystroke. */}
          <div aria-live="polite">{mismatch ? <p id="blue-recovery-mismatch" className="m-0 text-[13px] font-medium text-danger-ink">Passwords do not match.</p> : null}</div>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || password.length < 12 || password !== confirmPassword}>
            {busy ? 'Saving…' : 'Reset password'}
          </Button>
        </form>
      ) : null}
      {step === 'complete' ? (
        <div role="status" className="staff-form">
          <h2 ref={stepFocus.target} tabIndex={-1}>Password reset complete.</h2>
          <SiteLink href={signIn} className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>Sign in</SiteLink>
        </div>
      ) : null}
      {step === 'code' || step === 'password' ? (
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" onClick={restart} disabled={busy}>Use a different work email</Button>
          <div role="status" className="flex flex-col items-start gap-1">{resend.ready ? <>
            <p className={HINT}>No code, or a code refused? Start again with the same work email to get a new code.</p>
            <Button variant="ghost" onClick={restart} disabled={busy}>Start again for a new code</Button>
          </> : null}</div>
        </div>
      ) : null}
    </BlueAuthLayout>
  )
}
