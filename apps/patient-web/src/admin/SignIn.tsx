import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type MfaEnrollment, type PlatformLoginChallenge } from './api'
import { environment } from './env'
import { failure, isProblem } from './problems'
import { RecoveryCodes } from './RecoveryCodes'
import { SIX_DIGIT_CODE_FIELD, formatSetupKey, isRecoveryCode, isSixDigitCode, sixDigitCode } from '../mfa/codes'
import { Turnstile } from './Turnstile'
import { AuthLayout } from '../AuthLayout'
import { date } from './ui'

type Step =
  | { kind: 'credentials' }
  | { kind: 'verify'; challenge: PlatformLoginChallenge }
  | { kind: 'enroll'; challenge: PlatformLoginChallenge }
  | { kind: 'recovery-codes'; codes: string[] }
  | { kind: 'finishing' }

const SIGN_IN_FAILED = 'Sign-in failed. Check your email and password. Only platform administrators can sign in here.'

/** The setup key's grouping is shared with the provider portal; re-exported for the console's callers. */
export { formatSetupKey }

/**
 * Platform administration sign-in (hid-system Stage 2A): a password, then a
 * code from the administrator's authenticator app or one recovery code. An
 * administrator without an authenticator sets one up here. Each step is the
 * backend's decision; no step is skipped or inferred in the browser.
 */
export function AdminSignIn({ onSignedIn, notice }: {
  /** Opens the signed-in workspace; rejects with a displayable message. */
  onSignedIn: () => Promise<void>; notice: string | null
}) {
  const [step, setStep] = useState<Step>({ kind: 'credentials' })
  const [error, setError] = useState<string | null>(null)

  function restart(message: string | null) {
    setStep({ kind: 'credentials' })
    setError(message)
  }

  async function finish() {
    setError(null)
    setStep({ kind: 'finishing' })
    try { await onSignedIn() }
    catch (caught) { restart(caught instanceof Error ? caught.message : 'Platform administration could not be opened.') }
  }

  /**
   * The challenge cookie expired, was used up or was never set; or, for an
   * account that also works at a facility, Identity enrols the authenticator
   * at staff sign-in only (hid-system #71), so this challenge cannot go on.
   */
  function mfaFailure(caught: unknown, fallback: string) {
    if (isProblem(caught, 'MFA_CHALLENGE_INVALID') || isProblem(caught, 'MFA_ENROLLMENT_STAFF_SIGN_IN_REQUIRED')) {
      restart(failure(caught, fallback)); return
    }
    setError(failure(caught, fallback))
  }

  return <AuthLayout brandTo="/admin/sign-in" brandLabel="Health ID platform administration"
    title="Platform administration." titleId="admin-sign-in-title" titleAs="p"
    lede="Access is limited to accounts with platform permissions. You will also need your authenticator app.">
    {notice && step.kind === 'credentials' && <p role="status" className="admin-warning">{notice}</p>}
    {step.kind === 'credentials' && <CredentialsStep error={error} onError={setError}
      onChallenge={challenge => { setError(null); setStep(challenge.status === 'mfa_required'
        ? { kind: 'verify', challenge } : { kind: 'enroll', challenge }) }} />}
    {step.kind === 'verify' && <VerifyStep challenge={step.challenge} error={error}
      onFailure={caught => mfaFailure(caught, 'Your code could not be checked. Try again.')}
      onVerified={() => void finish()} onRestart={() => restart(null)} />}
    {step.kind === 'enroll' && <EnrollStep challenge={step.challenge} error={error}
      onFailure={caught => mfaFailure(caught, 'Authenticator setup could not be completed. Try again.')}
      onActivated={codes => { setError(null); setStep({ kind: 'recovery-codes', codes }) }}
      onRestart={() => restart(null)} />}
    {step.kind === 'recovery-codes' && <RecoveryCodes codes={step.codes} doneLabel="Continue to platform administration"
      onDone={() => void finish()} />}
    {step.kind === 'finishing' && <p role="status">Opening platform administration…</p>}
  </AuthLayout>
}

function CredentialsStep({ error, onError, onChallenge }: {
  error: string | null; onError: (message: string | null) => void; onChallenge: (challenge: PlatformLoginChallenge) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [pending, setPending] = useState(false)
  const config = environment()
  const requiresToken = Boolean(config.turnstileSiteKey) || config.name !== 'local'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (requiresToken && !token)) return
    setPending(true); onError(null)
    try {
      onChallenge(await adminApi.login(email.trim(), password, token ?? ''))
      setPassword('')
    } catch (caught) {
      onError(isProblem(caught, 'AUTHENTICATION_REQUIRED') ? SIGN_IN_FAILED : failure(caught, 'Sign-in could not be completed.'))
    } finally { setPending(false); setToken(null); setResetKey(value => value + 1) }
  }

  return <form onSubmit={event => void submit(event)} className="admin-auth-form">
    <h1>Administration sign in</h1>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {(config.turnstileSiteKey || config.name !== 'local') &&
      <Turnstile siteKey={config.turnstileSiteKey} resetKey={resetKey} onChange={setToken} />}
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    <button type="submit" className="admin-primary" disabled={pending || (requiresToken && !token)}>
      {pending ? 'Signing in…' : 'Continue'}
    </button>
    <p><Link to="/admin/recover">Forgot your password?</Link></p>
  </form>
}

function VerifyStep({ challenge, error, onFailure, onVerified, onRestart }: {
  challenge: PlatformLoginChallenge; error: string | null; onFailure: (caught: unknown) => void
  onVerified: () => void; onRestart: () => void
}) {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pending, setPending] = useState(false)
  const valid = mode === 'totp' ? isSixDigitCode(code) : isRecoveryCode(recoveryCode)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !valid) return
    setPending(true)
    try {
      await adminApi.verifyMfa(mode === 'totp' ? { code } : { recoveryCode: recoveryCode.trim() })
    } catch (caught) {
      setCode('')
      setPending(false)
      onFailure(caught)
      return
    }
    onVerified()
  }

  return <form onSubmit={event => void submit(event)} className="admin-auth-form">
    <h1>Verify it’s you</h1>
    {mode === 'totp' ? <>
      <p>Enter the 6-digit code from your authenticator app. Email codes are not accepted for administrators.</p>
      <label>Authenticator code<input value={code} onChange={event => setCode(sixDigitCode(event.target.value))}
        {...SIX_DIGIT_CODE_FIELD} required autoFocus /></label>
    </> : <>
      <p>Enter one of your recovery codes. Each code works once. You can sign in with it, but high-risk actions still
        need your authenticator app.</p>
      <label>Recovery code<input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)}
        autoComplete="off" spellCheck={false} maxLength={16} required autoFocus /></label>
    </>}
    <p className="admin-note">This step expires at {date(challenge.expiresAt)}.</p>
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    <button type="submit" className="admin-primary" disabled={pending || !valid}>{pending ? 'Verifying…' : 'Verify'}</button>
    <button type="button" className="admin-link" onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')}>
      {mode === 'totp' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}</button>
    <p className="admin-note">Lost your authenticator and recovery codes? Ask another administrator to request an
      authenticator reset; a second Super Admin must approve it.</p>
    <button type="button" className="admin-link" onClick={onRestart}>Start again</button>
  </form>
}

function EnrollStep({ challenge, error, onFailure, onActivated, onRestart }: {
  challenge: PlatformLoginChallenge; error: string | null; onFailure: (caught: unknown) => void
  onActivated: (codes: string[]) => void; onRestart: () => void
}) {
  // The setup key exists only in this component's state, from the one
  // response that contains it until activation succeeds.
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)

  async function begin() {
    if (pending) return
    setPending(true)
    try { setEnrollment(await adminApi.startEnrollment()) }
    catch (caught) { onFailure(caught) }
    finally { setPending(false) }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !isSixDigitCode(code)) return
    setPending(true)
    try {
      const activated = await adminApi.activateEnrollment(code)
      setEnrollment(null)
      onActivated(activated.recoveryCodes)
    } catch (caught) {
      setCode('')
      onFailure(caught)
    } finally { setPending(false) }
  }

  if (!enrollment) return <div className="admin-auth-form">
    <h1>Set up your authenticator</h1>
    <p>Platform administration requires an authenticator app (for example one that supports time-based codes). This
      account has none: it is new, or its authenticator was reset. Email codes are not accepted for administrators.</p>
    <p className="admin-note">Setup must be finished by {date(challenge.expiresAt)}.</p>
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    <button type="button" className="admin-primary" disabled={pending} onClick={() => void begin()}>
      {pending ? 'Preparing…' : 'Begin setup'}</button>
    <button type="button" className="admin-link" onClick={onRestart}>Start again</button>
  </div>

  return <form onSubmit={event => void activate(event)} className="admin-auth-form">
    <h1>Add Health ID to your authenticator</h1>
    <ol className="admin-steps">
      <li>In your authenticator app, add an account and enter this setup key. On a phone with the app installed you can
        instead <a href={enrollment.otpauthUri}>open it in the app</a>.
        <code className="admin-setup-key" aria-label="Setup key">{formatSetupKey(enrollment.secret)}</code>
        <small>Time-based · {enrollment.algorithm} · {enrollment.digits} digits · every {enrollment.periodSeconds} seconds.
          This key is shown only during setup and cannot be retrieved later.</small></li>
      <li>Enter the code the app now shows.</li>
    </ol>
    <label>Authenticator code<input value={code} onChange={event => setCode(sixDigitCode(event.target.value))}
      {...SIX_DIGIT_CODE_FIELD} required autoFocus /></label>
    <p className="admin-note">Setup must be finished by {date(enrollment.expiresAt)}.</p>
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    <button type="submit" className="admin-primary" disabled={pending || !isSixDigitCode(code)}>
      {pending ? 'Activating…' : 'Activate authenticator'}</button>
    <button type="button" className="admin-link" onClick={onRestart}>Start again</button>
  </form>
}
