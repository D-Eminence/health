import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isBlankHealthIdInput, signInPrincipal, signInPrincipalInput } from '@hid/contracts'
import { isHidApiError, PlainError, plainErrorText } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { AuthLayout } from '../AuthLayout'
import { useSession } from '../session'
import { describedBy, sentFromField, useDocumentTitle } from '../authSteps'
import { focusLost } from '../pageFocus'
import { patientReturnPath } from '../signInReturn'
import { useActionFocus } from './actionFocus'
import { signupHandoff } from './enrollment/signupHandoff'
import { ButtonR, Hint, InputR } from './profileParts'
import { Alert, Button, Field } from '../kasuwa/ui'

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
 * GOOGLE_NOT_REGISTERED, and the page offers the sign-up; with more than one, 409 GOOGLE_LINK_REQUIRED. The website's
 * own words are always shown, never Identity's (owner's rule, 1 Nov 2026).
 */
export const GOOGLE_NOT_REGISTERED = 'This Google account is not registered on Health ID. Use Sign Up first.'
export const GOOGLE_LINK_REQUIRED = 'This Google account can’t be linked automatically. Sign in with your email or Health ID and password.'
const GOOGLE_DENIED = 'Google sign-in couldn’t be completed for this account. Sign in with your email or Health ID and password.'
const SIGN_IN_CODES: Readonly<Record<string, string>> = { ACCOUNT_SUSPENDED, GOOGLE_NOT_REGISTERED, GOOGLE_LINK_REQUIRED, GOOGLE_SIGN_IN_DENIED: GOOGLE_DENIED }
const SIGN_IN_STATUSES: Readonly<Partial<Record<number, string>>> = {
  401: 'That email, phone, Health ID or password isn’t right. Try again.',
}
const googleNotRegistered = (reason: unknown) => isHidApiError(reason) && reason.code === 'GOOGLE_NOT_REGISTERED'
/** HCS-06: the patient was using the portal when their session ended (session.tsx sessionEnded). */
export const SESSION_ENDED = 'You were signed out because your session ended. Sign in again to continue.'
/** SO-20: the session check failed. Signing in still works, and replaces whatever session the browser holds. */
const SESSION_UNCHECKED = 'We couldn’t check whether you’re signed in. Try again, or sign in below.'
const CHECK_NEEDED = 'Complete the security check to continue.'
const ERROR_ID = 'sign-in-error'

/** A refused sign-in in plain words: ours for the codes we know, never Identity's own text. */
const refusalText = (reason: unknown, fallback: string, statuses = SIGN_IN_STATUSES) =>
  plainErrorText(reason, fallback, { codes: SIGN_IN_CODES, statuses })

/** The suspension's text, with the support address in it as a link to write to. */
function withSupportLink(text: string) {
  const at = text.indexOf(SUPPORT_EMAIL)
  if (at < 0) return text
  return <>{text.slice(0, at)}<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{text.slice(at + SUPPORT_EMAIL.length)}</>
}

export function SignIn() {
  const { state, sessionError, otherPortalSession, signedOutElsewhere, sessionEnded, retrySessionCheck, signIn, acceptGoogleSession, api } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  // The patient page asked for, when the route guard sent the patient here (SO-04): only this site's patient pages.
  const returnTo = patientReturnPath(location.state)
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
  // SO-03: a refusal about what was typed (a wrong email, phone, Health ID or password) marks both fields, which it
  // describes, and focus moves to the password, where it is read once; it is an alert only when focus stays in a field
  // (sent with Enter there). Any other refusal is an alert, and focus lost with the busy button goes to the first field.
  const [errorAlert, setErrorAlert] = useState(true)
  // The field a refusal is about: the identifier left blank, or both (401, either may be wrong).
  const [invalidFields, setInvalidFields] = useState<'principal' | 'both' | null>(null)
  const principalField = useRef<HTMLInputElement>(null)
  const passwordField = useRef<HTMLInputElement>(null)
  const focusAfter = useActionFocus()
  // SO-20: Try again on a failed session check is replaced while the check runs: focus then goes to the new Try again
  // if it fails again, or to the first field once the check finds no session.
  const sessionRetry = useRef<HTMLButtonElement>(null)
  const retriedSession = useRef(false)
  // HCS-06: a patient sent here because their session ended, or another tab signed them out, arrives with focus on
  // the page left behind; it goes to the heading, above the notice that says why.
  const title = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const told = sessionEnded || signedOutElsewhere
  useLayoutEffect(() => { if (told && focusLost()) title.current?.focus() }, [told])
  useLayoutEffect(() => {
    if (!retriedSession.current || state.status === 'unknown' && !sessionError) return
    retriedSession.current = false
    if (!focusLost()) return
    if (sessionError) sessionRetry.current?.focus()
    else principalField.current?.focus()
  }, [sessionError, state.status])

  if (state.status === 'authenticated') return <Navigate to={returnTo} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!turnstileToken || busy) return
    const fromField = sentFromField(event)
    // Only the prefill: as empty as the field was before it was filled in, so nothing is sent.
    if (isBlankHealthIdInput(email)) {
      setError('Enter your email, phone number or Health ID.'); setRefusal(null); setInvalidFields('principal'); setErrorAlert(fromField)
      focusAfter(() => principalField.current)
      return
    }
    setBusy(true)
    setError(null)
    setRefusal(null)
    setInvalidFields(null)
    try {
      await signIn(signInPrincipal(email), password, turnstileToken)
      navigate(returnTo, { replace: true })
    } catch (reason) {
      const wrong = isHidApiError(reason) && reason.status === 401
      setError(refusalText(reason, 'Sign-in could not be completed. Please try again.'))
      setRefusal(suspended(reason) ? 'suspended' : wrong ? 'unfinished' : null)
      setInvalidFields(wrong ? 'both' : null)
      setErrorAlert(!wrong || fromField)
      focusAfter(() => wrong ? passwordField.current : principalField.current)
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
    setInvalidFields(null)
    try {
      const result = await api.googleExchange(idToken, turnstileToken, 'sign_in')
      if (!('actor' in result)) throw new PlainError('This Google account is not linked to a patient account.')
      acceptGoogleSession(result)
      navigate(returnTo, { replace: true })
    } catch (reason) {
      setError(refusalText(reason, 'Google sign-in could not be completed.', { 401: GOOGLE_DENIED }))
      setRefusal(suspended(reason) ? 'suspended' : googleNotRegistered(reason) ? 'google-not-registered' : null)
      // Focus is usually still on Google's button: said as an alert, and moved to the first field only if it was lost.
      setErrorAlert(true)
      focusAfter(() => principalField.current)
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  const googleOffered = Boolean(import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleClientId())
  // SO-16: the main button waits for the security check, and says so while it does.
  const checkNeeded = !turnstileToken && !busy
  const principalInvalid = invalidFields !== null
  const passwordInvalid = invalidFields === 'both'
  const retrySession = () => { retriedSession.current = true; retrySessionCheck() }
  return <AuthLayout brandTo="/"
    title="Welcome back." titleId="sign-in-title" titleRef={title} titleFocusable
    lede="Sign in to see your records and choose who sees them.">
    <div className="flex flex-col gap-5">
      {/* One notice, so a screen reader reads the way to finish a sign-up with the refusal, as an alert or as the
          fields' description (SO-03). The email typed goes with the link in router state, never the URL, so the sign-up
          starts with it. */}
      {error && <Alert intent="error" id={ERROR_ID} live={errorAlert}>
        {refusal === 'suspended' ? withSupportLink(error) : error}
        {refusal === 'unfinished' && <> Didn't finish signing up? <Link to="/enroll" state={signupHandoff(signInPrincipal(email))}>Finish creating your Health ID</Link></>}
        {refusal === 'google-not-registered' && <> <Link to="/enroll">Sign up for a Health ID</Link></>}</Alert>}
      {sessionError && !error && <Alert intent="error"
        action={<ButtonR ref={sessionRetry} size="sm" onClick={retrySession}>Try again</ButtonR>}>{SESSION_UNCHECKED}</Alert>}
      {signedOutElsewhere && !error && <Alert intent="warning">You were signed out because this browser's Health ID sign-in changed in another tab. Sign in again to continue.</Alert>}
      {sessionEnded && !signedOutElsewhere && !error && <Alert intent="warning">{SESSION_ENDED}</Alert>}
      {/* app. is for patients only (owner, 2 Nov 2026): the note names no staff site and links to none. */}
      {otherPortalSession && <Alert intent="info" live={false}>Another Health ID account is signed in on this browser. Signing in here signs it out.</Alert>}
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4">
        {/* The label names all three; the placeholder fits a 320px phone (SO-17). */}
        <Field label="Email, phone or Health ID" htmlFor="sign-in-principal">
          <InputR ref={principalField} id="sign-in-principal" required autoComplete="username" value={email} onChange={event => setEmail(signInPrincipalInput(event.target.value))}
            placeholder="HID-…, 0803… or email"
            aria-invalid={principalInvalid || undefined} aria-describedby={principalInvalid ? ERROR_ID : undefined} />
        </Field>
        <Field label="Password" htmlFor="sign-in-password">
          <PasswordInput ref={passwordField} id="sign-in-password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6}
            aria-invalid={passwordInvalid || undefined} aria-describedby={passwordInvalid ? ERROR_ID : undefined} />
        </Field>
        {/* 44px to tap (SO-13), its text where it was. */}
        <Link to="/recover" className="-my-3 inline-flex min-h-11 items-center self-end text-[13px] font-medium text-brand-ink">Forgot password?</Link>
        <Turnstile action="patient-login" onTokenChange={setTurnstileToken} resetKey={resetKey} />
        {checkNeeded && <Hint id="sign-in-check-needed">{CHECK_NEEDED}</Hint>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}
          aria-describedby={describedBy(checkNeeded && 'sign-in-check-needed')}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      {googleOffered && <div className="flex flex-col gap-3">
        <p className="m-0 flex items-center gap-3 text-[13px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or</p>
        <GoogleButton text="signin_with" disabled={busy || !turnstileToken} onCredential={google}
          disabledReason={turnstileToken ? undefined : 'Complete the security check to continue with Google.'} /></div>}
      <p className="m-0 text-center text-sm text-ink-2">New to Health ID? <Link to="/enroll" className="font-medium text-brand-ink">Get your Health ID</Link></p>
    </div>
  </AuthLayout>
}
