import { useMemo, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { Turnstile } from '../../../Turnstile'
import { createPrincipalRecoveryApi } from '../../../recoveryApi'
import { STAFF_RECOVERY_PATH, staffRecoveryHref } from '../../../productHostname'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../../../authSteps'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from '../../../routes/recoveryWait'
import { authHrefs, BlueAuthLayout, BluePasswordInput, SiteLink } from './BlueAuthLayout'

type Step = 'start' | 'code' | 'password' | 'complete'

/**
 * Staff password recovery as the design draws it (screens/3-forgot-password), working as today's does
 * (routes/PrincipalRecovery.tsx, audience 'staff'): the work email with Turnstile, a neutral answer whether or not the
 * account exists, the six-digit code, then a new password of at least 12 characters. The challenge and its token live
 * in component memory only. On a site where staff do not reset, it points to the main site. Not wired in yet.
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

  const mainSiteRecovery = staffRecoveryHref(window.location.hostname)
  if (mainSiteRecovery !== STAFF_RECOVERY_PATH) {
    return (
      <BlueAuthLayout title="Recover account access" lede="Password resets are done on the main Health ID site.">
        <a className="hid-ehr-button hid-ehr-button-primary hid-ehr-blue-auth-wide" href={mainSiteRecovery}>Reset your password on the main site</a>
      </BlueAuthLayout>
    )
  }

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
    <BlueAuthLayout title="Recover account access" lede="Health ID — Hospital EHR">
      {error ? <p id="blue-recovery-error" role={errorAlert ? 'alert' : undefined} className="hid-ehr-error">{error}</p> : null}
      {step === 'start' ? (
        <form onSubmit={start} className="hid-ehr-blue-auth-form">
          <p id="blue-recovery-start-hint" className="hid-ehr-blue-auth-note">Enter your work email. If an eligible account exists, we will send a code to its verified contact.</p>
          <EhrField label="Work email">
            <EhrInput ref={stepFocus.target} required type="email" autoComplete="username" maxLength={254} value={identifier}
              onChange={event => setIdentifier(event.target.value)} aria-invalid={invalid}
              aria-describedby={describedBy('blue-recovery-start-hint', errorId)} />
          </EhrField>
          <Turnstile action="staff-reset" onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
          <EhrButton type="submit" className="hid-ehr-blue-auth-wide" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</EhrButton>
        </form>
      ) : null}
      {step === 'code' ? (
        <form onSubmit={verify} className="hid-ehr-blue-auth-form">
          <p id="blue-recovery-code-hint" className="hid-ehr-blue-auth-note">Enter the six digit code sent to your verified contact.</p>
          <EhrField label="Recovery code">
            <EhrInput ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={invalid}
              aria-describedby={describedBy('blue-recovery-code-hint', errorId)} />
          </EhrField>
          <EhrButton type="submit" className="hid-ehr-blue-auth-wide" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</EhrButton>
          {budget.shown ? <p className="hid-ehr-blue-auth-note">{CODE_BUDGET_HINT}</p> : null}
        </form>
      ) : null}
      {step === 'password' ? (
        <form onSubmit={complete} className="hid-ehr-blue-auth-form">
          <p id="blue-recovery-password-hint" className="hid-ehr-blue-auth-note">Choose a new password of at least 12 characters.</p>
          <EhrField label="New password">
            <BluePasswordInput toggleLabel="Show new password" ref={stepFocus.target} required autoComplete="new-password" minLength={12}
              maxLength={256} value={password} onChange={event => setPassword(event.target.value)} aria-invalid={invalid}
              aria-describedby={describedBy('blue-recovery-password-hint', errorId)} />
          </EhrField>
          <EhrField label="Confirm new password">
            <BluePasswordInput toggleLabel="Show confirmed password" required autoComplete="new-password" minLength={12} maxLength={256}
              value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'blue-recovery-mismatch' : undefined} />
          </EhrField>
          {/* Always mounted, so the mismatch is announced once when it appears, not on each keystroke. */}
          <div aria-live="polite">{mismatch ? <p id="blue-recovery-mismatch" className="hid-ehr-error">Passwords do not match.</p> : null}</div>
          <EhrButton type="submit" className="hid-ehr-blue-auth-wide" disabled={busy || password.length < 12 || password !== confirmPassword}>
            {busy ? 'Saving…' : 'Reset password'}
          </EhrButton>
        </form>
      ) : null}
      {step === 'complete' ? (
        <div role="status" className="hid-ehr-blue-auth-form">
          <h2 ref={stepFocus.target} tabIndex={-1} className="hid-ehr-blue-auth-step-title">Password reset complete.</h2>
          <SiteLink href={signIn} className="hid-ehr-button hid-ehr-button-primary hid-ehr-blue-auth-wide">Sign in</SiteLink>
        </div>
      ) : null}
      {step === 'code' || step === 'password' ? (
        <div className="hid-ehr-blue-auth-more">
          <EhrButton variant="quiet" onClick={restart} disabled={busy}>Use a different work email</EhrButton>
          <div role="status">{resend.ready ? <>
            <p className="hid-ehr-blue-auth-note">No code, or a code refused? Start again with the same work email to get a new code.</p>
            <EhrButton variant="quiet" onClick={restart} disabled={busy}>Start again for a new code</EhrButton>
          </> : null}</div>
        </div>
      ) : null}
    </BlueAuthLayout>
  )
}
