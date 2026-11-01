import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isBlankHealthIdInput, signInPrincipal, signInPrincipalInput } from '@hid/contracts'
import { fallbackMessageForStatus, isHidApiError, type HidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { signupHandoff } from './enrollment/signupHandoff'
import { Alert, Button, Field, Input } from '../kasuwa/ui'

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
 * own words are shown; these stand in only if a problem came without them. GOOGLE_LINK_REQUIRED's are always ours:
 * Identity's say to link Google from Settings, which the portal no longer has (the owner's decision of 2026-10-28).
 */
export const GOOGLE_NOT_REGISTERED = 'This Google account is not registered on Health ID. Use Sign Up first.'
export const GOOGLE_LINK_REQUIRED = 'This Google account can’t be linked automatically. Sign in with your email or Health ID and password.'
const STAND_INS: Readonly<Record<string, string>> = { ACCOUNT_SUSPENDED, GOOGLE_NOT_REGISTERED }
const googleNotRegistered = (reason: unknown) => isHidApiError(reason) && reason.code === 'GOOGLE_NOT_REGISTERED'

/** Identity's words for a refused sign-in: its own, or ours for a problem that came without them. */
const refusalText = (reason: HidApiError) => {
  if (reason.code === 'GOOGLE_LINK_REQUIRED') return GOOGLE_LINK_REQUIRED
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
  // Empty, with "HID-" only in the placeholder (the review of 2026-10-31): a prefilled HID- got in the way of the
  // people who sign in with an email or a phone number. One typed is still read as a Health ID (signInPrincipal).
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

  const googleOffered = Boolean(import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleClientId())
  return <AuthLayout brandTo="/"
    title="Welcome back." titleId="sign-in-title"
    lede="Sign in to see your records and choose who sees them.">
    <div className="flex flex-col gap-5">
      {/* One alert, so a screen reader reads the way to finish a sign-up with the refusal. The email typed goes with
          the link in router state, never the URL, so the sign-up starts with it. */}
      {(error || sessionError) && <Alert intent="error">
        {error && refusal === 'suspended' ? withSupportLink(error) : error || sessionError}
        {error && refusal === 'unfinished' && <> Didn't finish signing up? <Link to="/enroll" state={signupHandoff(signInPrincipal(email))}>Finish creating your Health ID</Link></>}
        {error && refusal === 'google-not-registered' && <> <Link to="/enroll">Sign up for a Health ID</Link></>}</Alert>}
      {signedOutElsewhere && !error && <Alert intent="warning">You were signed out because this browser's Health ID sign-in changed in another tab. Sign in again to continue.</Alert>}
      {otherPortalSession && <Alert intent="info" live={false}>A provider sign-in is active in this browser. Signing in here replaces it. <Link to="/provider">Go to the provider portal</Link></Alert>}
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4">
        <Field label="Email, phone or Health ID" htmlFor="sign-in-principal">
          <Input id="sign-in-principal" required autoComplete="username" value={email} onChange={event => setEmail(signInPrincipalInput(event.target.value))}
            placeholder="HID-…, you@example.com or 0803…" />
        </Field>
        <Field label="Password" htmlFor="sign-in-password">
          <PasswordInput id="sign-in-password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6} />
        </Field>
        <Link to="/recover" className="-mt-2 self-end text-[13px] font-medium text-brand-ink">Forgot password?</Link>
        <Turnstile action="patient-login" onTokenChange={setTurnstileToken} resetKey={resetKey} />
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      {googleOffered && <div className="flex flex-col gap-3">
        <p className="m-0 flex items-center gap-3 text-[13px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or</p>
        <GoogleButton text="signin_with" disabled={busy || !turnstileToken} onCredential={google}
          disabledReason={turnstileToken ? undefined : 'Complete the security check to continue with Google.'} /></div>}
      <p className="m-0 text-center text-sm text-ink-2">New to Health ID? <Link to="/enroll" className="font-medium text-brand-ink">Get your Health ID</Link></p>
    </div>
  </AuthLayout>
}
