import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { HEALTH_ID_PREFIX, isBlankHealthIdInput, signInPrincipal, signInPrincipalInput } from '@hid/contracts'
import { fallbackMessageForStatus, isHidApiError, type HidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { signupHandoff } from './enrollment/signupHandoff'

const SUPPORT_EMAIL = 'support@healthidentitydirectory.com'
/**
 * 403 ACCOUNT_SUSPENDED (hid-system, owner decision 2026-10-28): the password was right, but the account or patient is
 * suspended, blocked or disabled. A wrong password still gets the usual 401, so only someone holding the password
 * learns this. Identity's own wording is shown; this stands in only if a problem came without it.
 */
export const ACCOUNT_SUSPENDED = `This account is suspended. Contact ${SUPPORT_EMAIL}.`
const suspended = (reason: unknown) => isHidApiError(reason) && reason.code === 'ACCOUNT_SUSPENDED'

/**
 * Google sign-in for a Google account not linked yet (hid-system, owner decision 2026-10-28): Identity links it when
 * Google says its email is verified and exactly one patient account has that verified email. With none, 404
 * GOOGLE_NOT_REGISTERED, and the page offers the sign-up; with more than one, 409 GOOGLE_LINK_REQUIRED. Identity's
 * own words are shown; these stand in only if a problem came without them.
 */
export const GOOGLE_NOT_REGISTERED = 'This Google account is not registered on Health ID. Use Sign Up first.'
export const GOOGLE_LINK_REQUIRED = 'Sign in with your password, then link Google from Settings.'
const STAND_INS: Readonly<Record<string, string>> = {
  ACCOUNT_SUSPENDED, GOOGLE_NOT_REGISTERED, GOOGLE_LINK_REQUIRED,
}
const googleNotRegistered = (reason: unknown) => isHidApiError(reason) && reason.code === 'GOOGLE_NOT_REGISTERED'

/** Identity's words for a refused sign-in: its own, or ours for a problem that came without them. */
const refusalText = (reason: HidApiError) => {
  const standIn = reason.code !== undefined && Object.hasOwn(STAND_INS, reason.code) ? STAND_INS[reason.code] : undefined
  return standIn && reason.message === fallbackMessageForStatus(reason.status) ? standIn : reason.message
}

/** The suspension's text, with the support address in it as a link to write to. */
function withSupportLink(text: string) {
  const at = text.indexOf(SUPPORT_EMAIL)
  if (at < 0) return text
  return <>{text.slice(0, at)}<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{text.slice(at + SUPPORT_EMAIL.length)}</>
}

export function SignIn() {
  const { state, sessionError, otherPortalSession, signedOutElsewhere, signIn, acceptGoogleSession, api } = useSession()
  const navigate = useNavigate()
  useDocumentTitle('Sign in · Health ID')
  // Starts at HID- (owner decision, 2026-10-27); an email or a phone number typed after it drops it (2026-10-28).
  // Empty until focused, so a browser can still fill a saved sign-in; HID- as soon as the person starts.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Why the last sign-in was refused, where the page says more than the error. Invalid credentials (401) is also what
  // an account whose sign-up was never finished gets (hid-system local-auth.provider.ts): the way to finish it is
  // offered, as hid-1.0 did for "email not confirmed". A suspended account (403 ACCOUNT_SUSPENDED) is told whom to
  // contact, and not offered that. A Google account no patient account has is offered the sign-up.
  const [refusal, setRefusal] = useState<'unfinished' | 'suspended' | 'google-not-registered' | null>(null)

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    // Only the prefill: as empty as the field was before it was filled in, so nothing is sent.
    if (isBlankHealthIdInput(email)) { setError('Enter your email, phone number or Health ID.'); return }
    setBusy(true)
    setError(null)
    setRefusal(null)
    try {
      await signIn(signInPrincipal(email), password, turnstileToken)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(isHidApiError(reason) ? refusalText(reason) : 'Sign-in could not be completed. Please try again.')
      setRefusal(suspended(reason) ? 'suspended' : isHidApiError(reason) && reason.status === 401 ? 'unfinished' : null)
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
    setRefusal(null)
    try {
      const result = await api.googleExchange(idToken, turnstileToken, 'sign_in')
      if (!('actor' in result)) throw new Error('This Google account is not linked to a patient account.')
      acceptGoogleSession(result)
      navigate('/', { replace: true })
    } catch (reason) {
      setError(isHidApiError(reason) ? refusalText(reason) : reason instanceof Error ? reason.message : 'Google sign-in could not be completed.')
      setRefusal(suspended(reason) ? 'suspended' : googleNotRegistered(reason) ? 'google-not-registered' : null)
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
    {(error || sessionError) && <div role="alert" className="auth-alert">
      <p className="patient-inline-error">{error && refusal === 'suspended' ? withSupportLink(error) : error || sessionError}</p>
      {error && refusal === 'unfinished' && <p className="patient-field-hint">Didn't finish signing up? <Link to="/enroll" state={signupHandoff(signInPrincipal(email))}>Finish creating your Health ID</Link></p>}
      {error && refusal === 'google-not-registered' && <p className="patient-field-hint"><Link to="/enroll">Sign up for a Health ID</Link></p>}</div>}
    {signedOutElsewhere && !error && <p role="alert" className="patient-inline-error">You were signed out because this browser's Health ID sign-in changed in another tab or window. Sign in again to continue.</p>}
    {otherPortalSession && <div className="patient-session-note">
      <p>A provider sign-in is active in this browser. Signing in here as a patient replaces it.</p>
      <Link to="/provider">Go to the provider portal</Link>
    </div>}
    <form onSubmit={event => void submit(event)} className="patient-form">
      <label>Email, phone or Health ID<input required autoComplete="username" value={email} onFocus={() => { if (!email) setEmail(HEALTH_ID_PREFIX) }} onChange={event => setEmail(signInPrincipalInput(event.target.value))} placeholder="you@example.com, 0803… or HID-…" /></label>
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
