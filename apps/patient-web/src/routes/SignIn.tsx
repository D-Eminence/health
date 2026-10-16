import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'

export function SignIn() {
  const { state, sessionError, otherPortalSession, signedOutElsewhere, signIn, acceptGoogleSession, api } = useSession()
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

  return <AuthLayout brandTo="/"
    title="Welcome back." titleId="sign-in-title"
    lede="Sign in to view your health information and manage who can see it.">
    {(error || sessionError) && <p role="alert" className="patient-inline-error">{error || sessionError}</p>}
    {signedOutElsewhere && !error && <p role="alert" className="patient-inline-error">You were signed out because this browser's Health ID sign-in changed in another tab or window. Sign in again to continue.</p>}
    {otherPortalSession && <div className="patient-session-note">
      <p>A provider sign-in is active in this browser. Signing in here as a patient replaces it.</p>
      <Link to="/provider">Go to the provider portal</Link>
    </div>}
    <form onSubmit={event => void submit(event)} className="patient-form">
      <label>Email or Health ID<input required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com or HID-…" /></label>
      <div className="patient-field"><label htmlFor="sign-in-password">Password</label><PasswordInput appearance="plain" id="sign-in-password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6} /></div>
      <div className="patient-form-aside"><Link to="/recover">Forgot password?</Link></div>
      <Turnstile action="patient-login" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleClientId() && <div className="patient-auth-separator"><span>or continue with Google</span>
      <GoogleButton text="signin_with" disabled={busy || !turnstileToken} onCredential={google}
        disabledReason={turnstileToken ? undefined : 'Complete the security check to continue with Google.'} /></div>}
    <p className="patient-auth-footer">New to Health ID? <Link to="/enroll">Get your Health ID</Link></p>
  </AuthLayout>
}
