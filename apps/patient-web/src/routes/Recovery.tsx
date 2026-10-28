import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { HEALTH_ID_PREFIX, emailOrHealthId, healthIdOrOtherInput, isBlankHealthIdInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from './recoveryWait'

type Step = 'start' | 'code' | 'password' | 'complete'

export function Recovery() {
  const { api } = useSession()
  useDocumentTitle('Reset your password · Health ID')
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  // Starts at HID- (owner decision, 2026-10-27); an email typed after it drops it.
  // Empty until focused, so a browser can still fill a saved sign-in; HID- as soon as the person starts.
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  // Nothing is sent until it agrees with the new password (hid-1.0's "Passwords do not match"), as for staff.
  const [confirm, setConfirm] = useState('')
  // A confirmation was left, or Enter pressed with one: from then on one that differs is told, even one the new
  // password begins with, which would otherwise leave Reset off with nothing to say why.
  const [confirmChecked, setConfirmChecked] = useState(false)
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
    if (!challengeId || busy || !codeComplete(code)) return
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
    if (!verificationToken || password.length < 12 || password !== confirm || busy) return
    void run(async () => {
      await api.recoveryComplete(challengeId, verificationToken, password)
      setVerificationToken(''); setPassword(''); setConfirm(''); setConfirmChecked(false); setStep('complete')
    })
  }

  // Back to the first step, the identifier kept to be corrected or sent again: another account's identifier
  // gets a code at once; the same one, or the same account's other one, only once the previous start's wait
  // has passed. The budget note stays for a start with the same identifier (useCodeBudgetNote).
  const restart = () => {
    if (busy) return
    setStep('start'); setError(null); setFieldError(false); setCode(''); setChallengeId(''); setVerificationToken('')
    setPassword(''); setConfirm(''); setConfirmChecked(false); resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's one field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'recovery-error' : undefined
  // Not while the confirmation is still being typed and agrees so far.
  const mismatch = confirm !== '' && password !== confirm && (confirmChecked || !password.startsWith(confirm))

  return <AuthLayout brandTo="/sign-in" title="Reset your password." titleId="recovery-title">
    {error && <p id="recovery-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form"><p id="recovery-start-hint" className="patient-page-copy">Enter your email or Health ID. We will send a code to your verified contact.</p>
      <label>Email or Health ID<input ref={stepFocus.target} required autoComplete="username" value={identifier} onFocus={() => { if (!identifier) setIdentifier(HEALTH_ID_PREFIX) }} onChange={event => setIdentifier(healthIdOrOtherInput(event.target.value))}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-start-hint', errorId)} /></label>
      <Turnstile action="patient-reset-start" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button></form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form"><p id="recovery-code-hint" className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <CodeBoxes id="recovery-code" label="Recovery code" value={code} onChange={setCode} inputRef={stepFocus.target} busy={busy}
        invalid={invalid} describedBy={describedBy('recovery-code-hint', errorId)} />
      <button className="patient-primary-button" disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Verify code'}</button>
      {budget.shown && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}</form>}
    {/* Enter sends nothing while Reset is off (the form's default button), so it checks the confirmation instead. */}
    {step === 'password' && <form onSubmit={complete} onKeyDown={event => { if (event.key === 'Enter' && confirm) setConfirmChecked(true) }} className="patient-form"><p id="recovery-password-hint" className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      {/* Two fields, so each toggle is named for its own (a screen reader's list of buttons shows both). */}
      <div className="patient-field"><label htmlFor="recovery-password">New password</label><PasswordInput appearance="plain" id="recovery-password" toggleLabel="Show new password" ref={stepFocus.target} required autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy('recovery-password-hint', errorId)} /></div>
      <div className="patient-field"><label htmlFor="recovery-confirm">Confirm new password</label><PasswordInput appearance="plain" id="recovery-confirm" toggleLabel="Show confirmed password" required autoComplete="new-password" minLength={12} value={confirm} onChange={event => setConfirm(event.target.value)}
        onBlur={() => { if (confirm) setConfirmChecked(true) }} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'recovery-mismatch' : undefined} /></div>
      {/* Always mounted, so the mismatch is announced once when it appears, not on each keystroke (PA-05). */}
      <div aria-live="polite">{mismatch && <p id="recovery-mismatch" className="patient-inline-error">Passwords do not match.</p>}</div>
      <button className="patient-primary-button" disabled={busy || password.length < 12 || password !== confirm}>{busy ? 'Saving…' : 'Reset password'}</button></form>}
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
