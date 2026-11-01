import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isBlankHealthIdInput, signInPrincipal, signInPrincipalInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from './recoveryWait'
import { Alert, Button, Field } from '../kasuwa/ui'
import { InputR } from './profileParts'

type Step = 'start' | 'code' | 'password' | 'complete'

export function Recovery() {
  const { api } = useSession()
  useDocumentTitle('Reset your password · Health ID')
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  // Empty, with "HID-" only in the placeholder, as on sign-in.
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  // Typed once, with Show to check it (the review of 2026-10-31): no second field to match.
  const [password, setPassword] = useState('')
  const [tooShort, setTooShort] = useState(false)
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
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') budget.refused(signInPrincipal(identifier))
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
      setError('Enter your email, phone number or Health ID.'); setFieldError(true); setErrorAlert(stepFocus.onTarget()); stepFocus.focus(); return
    }
    void run(async () => {
      try {
        const result = await api.recoveryStart(signInPrincipal(identifier), turnstileToken)
        budget.started(signInPrincipal(identifier))
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
    if (!verificationToken || busy) return
    if (password.length < 12) { setTooShort(true); stepFocus.focus(); return }
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
    setPassword(''); setTooShort(false); resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's one field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'recovery-error' : undefined
  const steps = (['Your account', 'Code', 'New password'] as const).map((label, index) => ({ label,
    current: (step === 'start' && index === 0) || (step === 'code' && index === 1) || (step === 'password' && index === 2) }))
  const problem = error && <span role={errorAlert ? 'alert' : undefined}>{error}</span>

  return <AuthLayout brandTo="/sign-in" title="Reset your password." titleId="recovery-title"
    steps={step === 'complete' ? undefined : steps} stepsLabel="Steps to reset your password">
    <div className="flex flex-col gap-5">
    {error && !fieldError && <Alert intent="error" id="recovery-error" live={errorAlert}>{error}</Alert>}
    {step === 'start' && <form onSubmit={start} className="flex flex-col gap-4">
      <Field label="Email, phone or Health ID" htmlFor="recovery-identifier" hintId="recovery-start-hint"
        hint="We’ll send a code to the verified email on your account." errorId={errorId} error={fieldError ? problem : undefined}>
        <InputR id="recovery-identifier" ref={stepFocus.target} required autoComplete="username" value={identifier} placeholder="HID-…, you@example.com or 0803…"
          onChange={event => setIdentifier(signInPrincipalInput(event.target.value))}
          aria-invalid={invalid} aria-describedby={describedBy('recovery-start-hint', errorId)} />
      </Field>
      <Turnstile action="patient-reset-start" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send code'}</Button></form>}
    {step === 'code' && <form onSubmit={verify} className="flex flex-col gap-4">
      <p id="recovery-code-hint" className="m-0 text-sm text-ink-2">Enter the 6-digit code we sent.</p>
      <CodeBoxes id="recovery-code" label="Code" value={code} onChange={setCode} inputRef={stepFocus.target} busy={busy}
        invalid={invalid} describedBy={describedBy('recovery-code-hint', errorId)} />
      {fieldError && <p id="recovery-error" className="m-0 text-xs font-medium text-danger-ink">{problem}</p>}
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Verify code'}</Button>
      {budget.shown && <p className="m-0 text-[13px] text-ink-3">{CODE_BUDGET_HINT}</p>}</form>}
    {step === 'password' && <form onSubmit={complete} noValidate className="flex flex-col gap-4">
      <Field label="New password" htmlFor="recovery-password" hintId="recovery-password-hint" hint="At least 12 characters. Tap Show to check it."
        errorId={fieldError ? errorId : tooShort ? 'recovery-short' : undefined}
        error={fieldError ? problem : tooShort && password.length < 12 ? 'Use at least 12 characters.' : undefined}>
        <PasswordInput id="recovery-password" toggleLabel="Show new password" ref={stepFocus.target} required autoComplete="new-password" minLength={12} value={password}
          onChange={event => { setPassword(event.target.value); if (event.target.value.length >= 12) setTooShort(false) }}
          aria-invalid={invalid ?? (tooShort || undefined)} aria-describedby={describedBy('recovery-password-hint', errorId, tooShort && 'recovery-short')} />
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</Button></form>}
    {step === 'complete' && <div role="status" className="flex flex-col gap-4"><h2 ref={stepFocus.target} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Your password is reset.</h2>
      <Button to="/sign-in" variant="primary" size="lg" block>Sign in</Button></div>}
    {/* A start within the previous one's wait sends no code for the same identifier, which answers the same
        challenge (hid-system #55, migration 0081), nor for the same account's other identifier, which since #55
        answers a new challengeId under which the code already sent is not accepted; another account's identifier
        may be entered at once. A new code is offered once the wait has passed, in a region mounted throughout,
        so it is announced. */}
    {(step === 'code' || step === 'password') && <div className="flex flex-col items-start gap-2">
      <Button variant="link" onClick={restart} disabled={busy}
        aria-describedby={resend.ready ? undefined : 'recovery-other-identifier-hint'}>Use a different email, phone or Health ID</Button>
      {!resend.ready && <p id="recovery-other-identifier-hint" className="m-0 text-[13px] text-ink-3">Wait for a new code before using another email, phone or Health ID on the same account.</p>}
      <div role="status">{resend.ready && <><p className="m-0 text-[13px] text-ink-3">No code? Start again to get a new one.</p>
        <Button variant="link" onClick={restart} disabled={busy}>Start again for a new code</Button></>}</div></div>}
    {step !== 'complete' && <p className="m-0 text-center text-sm"><Link to="/sign-in" className="font-medium text-brand-ink">Back to sign in</Link></p>}
    </div>
  </AuthLayout>
}
