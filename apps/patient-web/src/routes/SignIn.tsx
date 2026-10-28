import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { HEALTH_ID_PREFIX, emailOrHealthId, healthIdOrOtherInput, isBlankHealthIdInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { signupHandoff } from './enrollment/signupHandoff'

export function SignIn() {
  const { state, sessionError, otherPortalSession, signedOutElsewhere, signIn, acceptGoogleSession, api } = useSession()
  const navigate = useNavigate()
  useDocumentTitle('Sign in · Health ID')
  // Starts at HID- (owner decision, 2026-10-27); an email typed after it drops it.
  // Empty until focused, so a browser can still fill a saved sign-in; HID- as soon as the person starts.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Refused as invalid credentials (401), which is also what an account whose sign-up was never finished gets
  // (hid-system local-auth.provider.ts): the way to finish it is offered, as hid-1.0 did for "email not confirmed".
  const [unfinished, setUnfinished] = useState(false)

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    // Only the prefill: as empty as the field was before it was filled in, so nothing is sent.
    if (isBlankHealthIdInput(email)) { setError('Enter your email or Health ID.'); return }
    setBusy(true)
    setError(null)
    setUnfinished(false)
    try {
      await signIn(emailOrHealthId(email), password, turnstileToken)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(isHidApiError(reason) ? reason.message : 'Sign-in could not be completed. Please try again.')
      setUnfinished(isHidApiError(reason) && reason.status === 401)
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
    setUnfinished(false)
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
    {/* One alert, so a screen reader reads the way to finish a sign-up with the refusal. The email typed goes with
        the link in router state, never the URL, so the sign-up starts with it. */}
    {(error || sessionError) && <div role="alert" className="auth-alert"><p className="patient-inline-error">{error || sessionError}</p>
      {error && unfinished && <p className="patient-field-hint">Didn't finish signing up? <Link to="/enroll" state={signupHandoff(emailOrHealthId(email))}>Finish creating your Health ID</Link></p>}</div>}
    {signedOutElsewhere && !error && <p role="alert" className="patient-inline-error">You were signed out because this browser's Health ID sign-in changed in another tab or window. Sign in again to continue.</p>}
    {otherPortalSession && <div className="patient-session-note">
      <p>A provider sign-in is active in this browser. Signing in here as a patient replaces it.</p>
      <Link to="/provider">Go to the provider portal</Link>
    </div>}
    <form onSubmit={event => void submit(event)} className="patient-form">
      <label>Email or Health ID<input required autoComplete="username" value={email} onFocus={() => { if (!email) setEmail(HEALTH_ID_PREFIX) }} onChange={event => setEmail(healthIdOrOtherInput(event.target.value))} placeholder="you@example.com or HID-…" /></label>
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
