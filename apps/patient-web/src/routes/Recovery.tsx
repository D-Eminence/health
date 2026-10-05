import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'

type Step = 'start' | 'code' | 'password' | 'complete'

export function Recovery() {
  const { api } = useSession()
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

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() }
    catch (reason) { setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.') }
    finally { setBusy(false) }
  }

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    void run(async () => {
      try {
        const result = await api.recoveryStart(identifier.trim(), turnstileToken)
        setChallengeId(result.challengeId)
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
    })
  }

  const complete = (event: FormEvent) => {
    event.preventDefault()
    if (!verificationToken || password.length < 12 || busy) return
    void run(async () => {
      await api.recoveryComplete(challengeId, verificationToken, password)
      setVerificationToken(''); setPassword(''); setStep('complete')
    })
  }

  return <main className="patient-auth-page"><section className="patient-auth-card" aria-labelledby="recovery-title">
    <Link to="/sign-in" className="patient-auth-brand"><BrandLogo /></Link>
    <p className="patient-eyebrow">Account recovery</p><h1 id="recovery-title" className="patient-page-title">Reset your password.</h1>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {step === 'start' && <form onSubmit={start} className="patient-form"><p className="patient-page-copy">Enter your email or Health ID. We will send a code to your verified contact.</p>
      <label>Email or Health ID<input required autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
      <Turnstile action="patient-reset-start" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Sending…' : 'Send recovery code'}</button></form>}
    {step === 'code' && <form onSubmit={verify} className="patient-form"><p className="patient-page-copy">Enter the six digit code sent to your verified contact.</p>
      <label>Recovery code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <button className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button></form>}
    {step === 'password' && <form onSubmit={complete} className="patient-form"><p className="patient-page-copy">Choose a new password of at least 12 characters.</p>
      <label>New password<input required type="password" autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="patient-primary-button" disabled={busy || password.length < 12}>{busy ? 'Saving…' : 'Reset password'}</button></form>}
    {step === 'complete' && <div role="status" className="patient-success"><h2>Password reset complete.</h2><Link className="patient-primary-button" to="/sign-in">Sign in</Link></div>}
    <p className="patient-auth-footer"><Link to="/sign-in">Back to sign in</Link></p>
  </section></main>
}
