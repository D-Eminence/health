import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Turnstile } from '../Turnstile'
import type { AuthStep } from '../AuthLayout'
import { createPrincipalRecoveryApi, type RecoveryAudience } from '../recoveryApi'
import { describedBy, isFieldProblem, recoveryRefusal, useDocumentTitle, useStepFocus } from '../authSteps'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { CODE_BUDGET_HINT, useCodeBudgetNote, useResendWait } from './recoveryWait'
import { Alert, Button, buttonClass, Field } from '../kasuwa/ui'
import { Hint, InputR } from './profileParts'

type Step = 'start' | 'code' | 'password' | 'complete'

/** What a page around the reset draws: its title and steps, and the reset itself. */
export interface WorkEmailRecoveryLayoutProps {
  readonly title: string
  readonly titleId: string
  readonly steps?: readonly AuthStep[]
  readonly stepsLabel: string
  readonly children: ReactNode
}

export interface WorkEmailRecoveryProps {
  /** Whose reset: a staff account's (staff-reset) or a platform administrator's (admin-reset). */
  readonly audience: RecoveryAudience
  /** The browser tab's name. */
  readonly documentTitle: string
  /** Where "Back to sign in" and the last step's "Sign in" go: a page of this site, or a full address on another. */
  readonly signInHref: string
  /** The page around the reset: the staff sites' auth look, or the shared one. */
  readonly Layout: (props: WorkEmailRecoveryLayoutProps) => ReactElement
}

/** A page of this site, or a plain link to a full address on another Health ID site. */
function SignInLink({ href, className, children }: { readonly href: string; readonly className?: string; readonly children: ReactNode }) {
  return /^https?:\/\//.test(href) ? <a className={className} href={href}>{children}</a> : <Link className={className} to={href}>{children}</Link>
}

/**
 * Resetting a work account's password, looking and working as the patient reset on app. does (routes/Recovery.tsx;
 * owner's answer to Q89, 17 Nov 2026): "Reset your password." with the steps Your account, Code and New password; the
 * work email; six code boxes that send the code by themselves once the sixth digit is in; one new password with Show;
 * then "Your password is reset." Underneath it keeps the staff (or admin) calls: Identity's OTP routes with the
 * Turnstile action `${audience}-reset`, a neutral answer whether or not the account exists, the wrong-code budget and the
 * wait before a new code. The challenge and its token live in component memory only.
 */
export function WorkEmailRecovery({ audience, documentTitle, signInHref, Layout }: WorkEmailRecoveryProps) {
  const api = useMemo(() => createPrincipalRecoveryApi(audience), [audience])
  useDocumentTitle(documentTitle)
  const stepFocus = useStepFocus()
  const [step, setStep] = useState<Step>('start')
  const [identifier, setIdentifier] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  // Typed once, with Show to check it, as on app.: no second field to match.
  const [password, setPassword] = useState('')
  const [tooShort, setTooShort] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  // An error about the field is announced by the field's description once focus moves there; it is an alert only when
  // focus is already in the field (Enter), or when it is not about the field at all. As both it would be spoken twice.
  const [errorAlert, setErrorAlert] = useState(true)
  // A code was refused: it may be the account's spent code budget, which the refusal does not tell apart.
  const budget = useCodeBudgetNote()
  const resend = useResendWait()

  async function run(operation: () => Promise<void>, stepCodes: readonly string[] = []) {
    const fromField = stepFocus.onTarget()
    setBusy(true)
    setError(null)
    setFieldError(false)
    try { await operation() } catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID_OR_EXPIRED') budget.refused(identifier)
      const aboutField = isFieldProblem(reason, stepCodes)
      // A staff reset is said in plain words (owner's rule, 1 Nov 2026); the admin console's wording is its own.
      setError(audience === 'staff' ? recoveryRefusal(reason, 'facility')
        : isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
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
    if (!identifier.trim()) {
      setError('Enter your work email.'); setFieldError(true); setErrorAlert(stepFocus.onTarget()); stepFocus.focus(); return
    }
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
    if (busy || !challengeId || !codeComplete(code)) return
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
    if (busy || !challengeId || !verificationToken) return
    if (password.length < 12) { setTooShort(true); stepFocus.focus(); return }
    void run(async () => {
      await api.complete(challengeId, verificationToken, password)
      setVerificationToken('')
      setPassword('')
      setStep('complete')
    })
  }

  // Back to the first step, the work email kept to be corrected or sent again: another account's email gets a code at
  // once; the same one only once the previous start's wait has passed. The budget note stays for a start with the same
  // email (useCodeBudgetNote).
  function restart() {
    if (busy) return
    setStep('start')
    setError(null)
    setFieldError(false)
    setCode('')
    setChallengeId('')
    setVerificationToken('')
    setPassword('')
    setTooShort(false)
    resend.reset()
    stepFocus.focus()
  }

  // The error is about the step's one field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'work-recovery-error' : undefined
  const steps = (['Your account', 'Code', 'New password'] as const).map((label, index) => ({ label,
    current: (step === 'start' && index === 0) || (step === 'code' && index === 1) || (step === 'password' && index === 2) }))
  const problem = error && <span role={errorAlert ? 'alert' : undefined}>{error}</span>

  return <Layout title="Reset your password." titleId="work-recovery-title" steps={step === 'complete' ? undefined : steps}
    stepsLabel="Steps to reset your password">
    <div className="flex flex-col gap-5">
      {error && !fieldError && <Alert intent="error" id="work-recovery-error" live={errorAlert}>{error}</Alert>}
      {step === 'start' && <form onSubmit={start} className="flex flex-col gap-4">
        <Field label="Work email" htmlFor="work-recovery-email" hintId="work-recovery-start-hint"
          hint="We’ll send a code to the verified email on your account." errorId={errorId} error={fieldError ? problem : undefined}>
          <InputR id="work-recovery-email" ref={stepFocus.target} required type="email" autoComplete="username" maxLength={254} value={identifier}
            onChange={event => setIdentifier(event.target.value)}
            aria-invalid={invalid} aria-describedby={describedBy('work-recovery-start-hint', errorId)} />
        </Field>
        <Turnstile action={audience === 'staff' ? 'staff-reset' : 'admin-reset'} onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
        {/* Why Send code waits, as on app. */}
        {!turnstileToken && !busy && <Hint id="work-recovery-check-needed">Complete the security check to continue.</Hint>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}
          aria-describedby={!turnstileToken && !busy ? 'work-recovery-check-needed' : undefined}>{busy ? 'Sending…' : 'Send code'}</Button>
      </form>}
      {step === 'code' && <form onSubmit={verify} className="flex flex-col gap-4">
        <p id="work-recovery-code-hint" className="m-0 text-sm text-ink-2">Enter the 6-digit code we sent.</p>
        <CodeBoxes id="work-recovery-code" label="Code" value={code} onChange={setCode} inputRef={stepFocus.target} busy={busy}
          invalid={invalid} describedBy={describedBy('work-recovery-code-hint', errorId)} />
        {fieldError && <p id="work-recovery-error" className="m-0 text-xs font-medium text-danger-ink">{problem}</p>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Verify code'}</Button>
        {budget.shown && <p className="m-0 text-[13px] text-ink-3">{CODE_BUDGET_HINT}</p>}
      </form>}
      {step === 'password' && <form onSubmit={complete} noValidate className="flex flex-col gap-4">
        <Field label="New password" htmlFor="work-recovery-password" hintId="work-recovery-password-hint" hint="At least 12 characters. Tap Show to check it."
          errorId={fieldError ? errorId : tooShort ? 'work-recovery-short' : undefined}
          error={fieldError ? problem : tooShort && password.length < 12 ? 'Use at least 12 characters.' : undefined}>
          <PasswordInput id="work-recovery-password" toggleLabel="Show new password" ref={stepFocus.target} required autoComplete="new-password"
            minLength={12} maxLength={256} value={password}
            onChange={event => { setPassword(event.target.value); if (event.target.value.length >= 12) setTooShort(false) }}
            aria-invalid={invalid ?? (tooShort || undefined)} aria-describedby={describedBy('work-recovery-password-hint', errorId, tooShort && 'work-recovery-short')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</Button>
      </form>}
      {step === 'complete' && <div role="status" className="flex flex-col gap-4">
        <h2 ref={stepFocus.target} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Your password is reset.</h2>
        <SignInLink href={signInHref} className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>Sign in</SignInLink>
      </div>}
      {/* A start within the previous one's wait sends no code for the same work email, which answers the same challenge
          (hid-system #55, migration 0081); another account's work email may be entered at once. A new code is offered
          once the wait has passed, in a region mounted throughout, so it is announced. */}
      {(step === 'code' || step === 'password') && <div className="flex flex-col items-start gap-2">
        <Button variant="link" onClick={restart} disabled={busy}
          aria-describedby={resend.ready ? undefined : 'work-recovery-wait-hint'}>Use a different email</Button>
        {!resend.ready && <p id="work-recovery-wait-hint" className="m-0 text-[13px] text-ink-3">Wait for a new code before starting again with the same email.</p>}
        <div role="status">{resend.ready && <><p className="m-0 text-[13px] text-ink-3">No code? Start again to get a new one.</p>
          <Button variant="link" onClick={restart} disabled={busy}>Start again for a new code</Button></>}</div>
      </div>}
      {step !== 'complete' && <p className="m-0 text-center text-sm">
        <SignInLink href={signInHref} className="-my-3 inline-flex min-h-11 items-center font-medium text-brand-ink">Back to sign in</SignInLink></p>}
    </div>
  </Layout>
}
