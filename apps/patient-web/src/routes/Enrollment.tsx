import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import type { EnrollmentProgress } from '../api'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'

type Stage = 'nin' | 'contact' | 'otp' | 'password' | 'complete'

export function Enrollment() {
  const { state, api, acceptGoogleSession } = useSession()
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>('nin')
  const [nin, setNin] = useState('')
  const [channel, setChannel] = useState<'phone' | 'email'>('phone')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [hidCode, setHidCode] = useState('')
  const [maskedContact, setMaskedContact] = useState('')
  const [googleRequired, setGoogleRequired] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [googleTurnstileToken, setGoogleTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [googleResetKey, setGoogleResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState(false)
  const [checkKey, setCheckKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const startKey = useRef<{ nin: string; key: string } | null>(null)

  const applyProgress = (progress: EnrollmentProgress) => {
    setGoogleRequired(progress.googleOnboardingRequired === true)
    setMaskedContact(progress.maskedContact ?? '')
    setChallengeId(progress.challengeId ?? null)
    if (progress.stage === 'active') { setHidCode(progress.hidCode ?? ''); setStage('complete') }
    else if (progress.stage === 'set_password') setStage('password')
    else setStage(progress.challengeId ? 'otp' : 'contact')
  }

  useEffect(() => {
    let active = true
    setChecking(true)
    setCheckError(false)
    void Promise.allSettled([api.enrollmentCurrent(), api.googleOnboarding()]).then(([progress, google]) => {
      if (!active) return
      const unavailable = [progress, google].some(result => result.status === 'rejected'
        && (!isHidApiError(result.reason) || ![401, 404].includes(result.reason.status)))
      if (unavailable) {
        setCheckError(true)
        setChecking(false)
        return
      }
      if (progress.status === 'fulfilled') applyProgress(progress.value)
      if (google.status === 'fulfilled' && new Date(google.value.expiresAt).getTime() > Date.now()) setGooglePending(true)
      setChecking(false)
    })
    return () => { active = false }
  }, [api, checkKey])

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const displayError = (reason: unknown) => setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')

  const submitNin = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{11}$/.test(nin) || !turnstileToken || busy) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before continuing.'); return }
    setBusy(true); setError(null)
    if (startKey.current?.nin !== nin) startKey.current = { nin, key: crypto.randomUUID() }
    try {
      const progress = await api.enrollmentStart(nin, turnstileToken, startKey.current.key)
      applyProgress(progress)
      setNin('')
    } catch (reason) { displayError(reason) }
    finally { setTurnstileToken(null); setResetKey(value => value + 1); setBusy(false) }
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !contact.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await api.enrollmentContact(channel, contact.trim())
      setChallengeId(result.challengeId)
      setMaskedContact(contact.trim())
      setContact('')
      setStage('otp')
    } catch (reason) { displayError(reason) }
    finally { setBusy(false) }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true); setError(null)
    try { await api.enrollmentVerify(challengeId, code); setCode(''); setStage('password') }
    catch (reason) { displayError(reason) }
    finally { setBusy(false) }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || password.length < 12) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before activation.'); return }
    setBusy(true); setError(null)
    try {
      const result = await api.enrollmentActivate(password)
      setPassword('')
      setHidCode(result.hidCode)
      setStage('complete')
    } catch (reason) { displayError(reason) }
    finally { setBusy(false) }
  }

  const onGoogle = async (idToken: string) => {
    if (!googleTurnstileToken) return
    setBusy(true); setError(null)
    try {
      const result = await api.googleExchange(idToken, googleTurnstileToken, 'enroll')
      if ('actor' in result) { acceptGoogleSession(result); navigate('/', { replace: true }); return }
      setGooglePending(true)
      // Binding answers only that it bound; the enrollment's own progress is read
      // again, so a patient already past the contact step is not sent back to it.
      if (stage !== 'nin') { await api.enrollmentBindGoogle(); applyProgress(await api.enrollmentCurrent()) }
    } catch (reason) { displayError(reason) }
    finally { setGoogleTurnstileToken(null); setGoogleResetKey(value => value + 1); setBusy(false) }
  }

  return <main className="patient-auth-page">
    <section className="patient-auth-card patient-enroll-card" aria-labelledby="enroll-title">
      <Link to="/" className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">Patient enrollment</p>
      <h1 id="enroll-title" className="patient-page-title">Get your Health ID.</h1>
      <p className="patient-page-copy">Verify your identity, confirm a contact, and activate your account.</p>
      <ol className="patient-step-list" aria-label="Enrollment steps">
        {['NIN', 'Contact', 'Code', 'Activate'].map((label, index) => <li key={label} aria-current={['nin', 'contact', 'otp', 'password'][index] === stage ? 'step' : undefined}>{label}</li>)}
      </ol>
      {checking ? <p role="status">Checking for an enrollment in progress…</p> : null}
      {checkError && <div className="patient-inline-error" role="alert"><p>We could not check for an enrollment in progress. Try again before starting.</p><button type="button" className="patient-secondary-button" onClick={() => setCheckKey(value => value + 1)}>Try again</button></div>}
      {error && <p role="alert" className="patient-inline-error">{error}</p>}
      {googleRequired && !googlePending && <p role="status" className="patient-inline-error">Reconnect the Google account used to start this enrollment.</p>}
      {!checking && !checkError && stage === 'nin' && <form onSubmit={event => void submitNin(event)} className="patient-form">
        <label>National Identification Number<input required inputMode="numeric" autoComplete="off" value={nin} onChange={event => setNin(event.target.value.replace(/\D/g, '').slice(0, 11))} pattern="[0-9]{11}" maxLength={11} placeholder="11 digits" /></label>
        <p className="patient-field-hint">Your NIN is verified by the existing Health ID identity service. It is not stored in this browser.</p>
        <Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
        <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken || nin.length !== 11 || (googleRequired && !googlePending)}>{busy ? 'Verifying…' : 'Verify NIN'}</button>
      </form>}
      {!checking && !checkError && stage === 'contact' && <form onSubmit={event => void submitContact(event)} className="patient-form">
        <h2>Where should we send your code?</h2>
        <label>Contact method<select value={channel} onChange={event => setChannel(event.target.value as 'phone' | 'email')}><option value="phone">Phone</option><option value="email">Email</option></select></label>
        <label>{channel === 'phone' ? 'Phone number' : 'Email address'}<input required type={channel === 'phone' ? 'tel' : 'email'} autoComplete={channel === 'phone' ? 'tel' : 'email'} value={contact} onChange={event => setContact(event.target.value)} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>
      </form>}
      {!checking && !checkError && stage === 'otp' && <form onSubmit={event => void submitCode(event)} className="patient-form">
        <h2>Verify your contact</h2><p className="patient-field-hint">Enter the six digit code sent to {maskedContact || 'your contact'}.</p>
        <label>Verification code<input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" maxLength={6} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
        <button type="button" className="patient-text-button" onClick={() => { setCode(''); setChallengeId(null); setStage('contact') }}>Request another code or change contact</button>
      </form>}
      {!checking && !checkError && stage === 'password' && <form onSubmit={event => void submitPassword(event)} className="patient-form">
        <h2>Activate your account</h2><p className="patient-field-hint">Choose a password of at least 12 characters.</p>
        <label>Password<input required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12 || (googleRequired && !googlePending)}>{busy ? 'Activating…' : 'Activate Health ID'}</button>
      </form>}
      {!checking && !checkError && stage === 'complete' && <div className="patient-success" role="status"><h2>Your Health ID is ready.</h2><strong>{hidCode}</strong><p>Sign in with your verified email or Health ID and new password.</p><Link className="patient-primary-button" to="/sign-in">Sign in</Link></div>}
      {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && !checking && !checkError && stage !== 'complete' && !googlePending && <section className="patient-auth-separator" aria-label="Google enrollment">
        <span>{googleRequired ? 'Reconnect Google' : 'Continue with Google'}</span>
        <Turnstile action="patient-login" onTokenChange={setGoogleTurnstileToken} resetKey={googleResetKey} />
        <GoogleButton text="signup_with" disabled={busy || !googleTurnstileToken} onCredential={onGoogle} />
      </section>}
      {googlePending && !checkError && stage !== 'complete' && <p role="status" className="patient-field-hint">Google identity confirmed for this enrollment.</p>}
      <p className="patient-auth-footer">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
    </section>
  </main>
}
