import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'

export function SignIn() {
  const { state, sessionError, signIn, acceptGoogleSession, api } = useSession()
  const navigate = useNavigate()
  useDocumentTitle('Sign in · Health ID')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password, turnstileToken)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(isHidApiError(reason) ? reason.message : 'Sign-in could not be completed. Please try again.')
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  const google = async (idToken: string) => {
    if (!turnstileToken) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.googleExchange(idToken, turnstileToken, 'sign_in')
      if (!('actor' in result)) throw new Error('This Google account is not linked to a patient account.')
      acceptGoogleSession(result)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(isHidApiError(reason) ? reason.message : reason instanceof Error ? reason.message : 'Google sign-in could not be completed.')
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  return <main className="patient-auth-page">
    <section className="patient-auth-card" aria-labelledby="sign-in-title">
      <Link to="/" className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">Your Health ID</p>
      <h1 id="sign-in-title" className="patient-page-title">Welcome back.</h1>
      <p className="patient-page-copy">Sign in to view your health information and manage access to it.</p>
      {(error || sessionError) && <p role="alert" className="patient-inline-error">{error || sessionError}</p>}
      <form onSubmit={event => void submit(event)} className="patient-form">
        <label>Email or Health ID<input required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com or HID-…" /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6} /></label>
        <div className="patient-form-aside"><Link to="/recover">Forgot password?</Link></div>
        <Turnstile action="patient-login" onTokenChange={setTurnstileToken} resetKey={resetKey} />
        <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && <div className="patient-auth-separator"><span>or continue with Google</span>
        <GoogleButton text="signin_with" disabled={busy || !turnstileToken} onCredential={google}
          disabledReason={turnstileToken ? undefined : 'Complete the security check to continue with Google.'} /></div>}
      <p className="patient-auth-footer">New to Health ID? <Link to="/enroll">Get your Health ID</Link></p>
    </section>
  </main>
}
