import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Turnstile } from '../Turnstile'
import { createPrincipalRecoveryApi, type RecoveryAudience } from '../recoveryApi'

type Step = 'start' | 'code' | 'password' | 'complete'

/** Recovery uses only component memory for the challenge and completion token. */
export function PrincipalRecovery({ audience }: { audience: RecoveryAudience }) {
  const api = useMemo(() => createPrincipalRecoveryApi(audience), [audience])
  const signInPath = audience === 'staff' ? '/provider/sign-in' : '/admin/sign-in'
  const accountLabel = audience === 'staff' ? 'Provider' : 'Platform'
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

  async function run(operation: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await operation() }
    catch (reason) {
      setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
    } finally { setBusy(false) }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !turnstileToken) return
    void run(async () => {
      try {
        const result = await api.start(identifier.trim(), turnstileToken)
        setChallengeId(result.challengeId)
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
    })
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
    setCode('')
    setChallengeId('')
    setVerificationToken('')
    setPassword('')
    setConfirmPassword('')
  }

  return <main className="patient-auth-page"><section className="patient-auth-card" aria-labelledby="principal-recovery-title">
    <Link to={signInPath} className="patient-auth-brand">H<span>ID</span></Link>
    <p className="patient-eyebrow">{accountLabel} account recovery</p>
    <h1 id="principal-recovery-title" className="patient-page-title">Reset your password.</h1>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form">
      <p className="patient-page-copy">Enter your work email. If an eligible account exists, we will send a code to its verified contact.</p>
      <label>Work email<input required type="email" autoComplete="username" maxLength={254} value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
      <Turnstile action={audience === 'staff' ? 'staff-reset' : 'admin-reset'} onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
      <button className="patient-primary-button" type="submit" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button>
    </form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form">
      <p className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <label>Recovery code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <button className="patient-primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
    </form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form">
      <p className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      <label>New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
      {confirmPassword && password !== confirmPassword && <p className="patient-inline-error">Passwords do not match.</p>}
      <button className="patient-primary-button" type="submit" disabled={busy || password.length < 12 || password !== confirmPassword}>{busy ? 'Saving…' : 'Reset password'}</button>
    </form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2>Password reset complete.</h2>
      <Link className="patient-primary-button" to={signInPath}>Sign in</Link></div>}
    {(step === 'code' || step === 'password') && <p className="patient-auth-footer"><button className="patient-text-button" type="button" onClick={restart} disabled={busy}>Start again</button></p>}
    <p className="patient-auth-footer"><Link to={signInPath}>Back to {accountLabel.toLowerCase()} sign in</Link></p>
  </section></main>
}
