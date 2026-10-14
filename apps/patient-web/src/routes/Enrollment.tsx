import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import type { EnrollmentProgress } from '../api'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useActionFocus } from './actionFocus'

type Stage = 'nin' | 'contact' | 'otp' | 'password' | 'complete'

/**
 * Identity refuses every enrollment call while the browser holds a sign-in, a
 * provider's included (hid-system patient-enrollment.controller.ts, and the Google
 * exchange for an enrollment): trying again cannot help until it is signed out.
 */
const SIGN_OUT_FIRST = new Set(['PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT', 'GOOGLE_ONBOARDING_REQUIRES_SIGN_OUT'])
const requiresSignOut = (reason: unknown) => isHidApiError(reason) && reason.status === 409 && SIGN_OUT_FIRST.has(reason.code)

/**
 * Since hid-system #50 every sign-in, refresh and sign-out in this browser expires
 * the enrollment cookie, and each step then answers 404 ENROLLMENT_NOT_FOUND
 * (patient-enrollment.service.ts requireEnrollment). The start sent again with the
 * same key and NIN restores it (the key is kept for as long as this page is), while
 * a new key is refused as a duplicate for a day.
 */
const enrollmentEnded = (reason: unknown) => isHidApiError(reason) && reason.status === 404 && reason.code === 'ENROLLMENT_NOT_FOUND'
const ENDED = 'This enrollment ended on this device because someone signed in or out here.'
const ENDED_HERE = `${ENDED} Enter the same NIN to continue it.`
const ENDS_ENROLLMENT = 'Signing out also ends an enrollment in progress on this device; continue it by entering the same NIN before reloading this page.'
/**
 * Whether a new enrollment may start (hid-system#68, FE-4): only `200 { open: true }`
 * from the availability read says so, and a read that failed is said as such. Only
 * the start is refused while registration is closed, a start with the same key
 * included, so an enrollment in progress continues whatever it says, and one that
 * ended here is not told to enter its NIN again. Production keeps registration
 * closed until hid-system's N1 holder step ships; the notice is Identity's own
 * wording for the start's 503.
 */
type Registration = 'open' | 'closed' | 'unknown'
const REGISTRATION_CLOSED = 'New Health ID registration is not open yet. If you already have a Health ID, sign in.'
/**
 * Enrollment's limits (hid-system #61 and #50): wrong codes spend one budget per
 * contact, so the fifth within 15 minutes refuses every code, a correct one too,
 * and sends no new one, for 15 minutes; and one enrollment's activation attempts
 * are limited to 15 in 15 minutes. Both answers are the step's usual refusal.
 */
const CODE_BUDGET_HINT = 'After 5 wrong codes within 15 minutes for the same contact, every code is refused, even a correct one, and no new code is sent to it, for 15 minutes.'
const ACTIVATION_LIMIT_HINT = 'This enrollment has had too many activation attempts. Wait about 15 minutes, then activate again: the enrollment is kept.'
/**
 * A contact proved more than 30 minutes before activation is proved again
 * (hid-system#68, N2(c), ADR-048): activation answers 409 and has already sent
 * the enrollment back to the contact step without its contact, so the page goes
 * there too. At the password step a second try would only be refused.
 */
const contactReverifyRequired = (reason: unknown) => isHidApiError(reason) && reason.status === 409
  && reason.code === 'ENROLLMENT_CONTACT_REVERIFY_REQUIRED'
const REVERIFY_CONTACT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. Send a new code, enter it, then choose your password.'
/**
 * The HID is shown only here (hid-system#68, N2(a) and N2(b)): the activation
 * response expires the enrollment cookie, and if that response is lost
 * GET /current shows the HID for 15 minutes after activation only. Until it is
 * also sent to the verified contact, a patient who verified only a phone signs
 * in and resets their password with it.
 */
const SAVE_HID = 'Save your Health ID now: write it down or keep it somewhere safe. This page may not show it again once you leave or reload it, and never more than 15 minutes after activation.'

export function Enrollment() {
  const { state, api, acceptGoogleSession, otherPortalSession, retrySessionCheck } = useSession()
  const navigate = useNavigate()
  useDocumentTitle('Get your Health ID · Health ID')
  const stepFocus = useStepFocus()
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
  const [registration, setRegistration] = useState<Registration>('unknown')
  const [signOutRequired, setSignOutRequired] = useState(false)
  // Focus moves to the note when a check the person asked for, or a step, finds
  // the sign-in: it is read there, and its message is an alert only otherwise, so
  // it is not read twice (as errorAlert below).
  const [signOutAlert, setSignOutAlert] = useState(true)
  const signOutNote = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  // An error about the field is spoken by its description once focus moves there,
  // and is an alert only when focus is already in the field (Enter) or it is not
  // about the field.
  const [errorAlert, setErrorAlert] = useState(true)
  // What a refusal at the code or password step may mean, said under that step.
  const [stepHint, setStepHint] = useState<'code' | 'activation' | null>(null)
  const startKey = useRef<{ nin: string; key: string } | null>(null)
  // 'Try again' and 'Check again' are replaced while the check runs: focus then
  // goes to the step's field, or to what replaced them when the check finds
  // the same again (PR-04).
  const retriedCheck = useRef(false)
  const checkRetry = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()
  // The step shown, for the check, which runs apart from any one render.
  const stageShown = useRef<Stage>(stage)
  useEffect(() => { stageShown.current = stage }, [stage])

  // Back to the NIN step, the enrollment's challenge and contact gone with it.
  const restartAtNin = () => {
    setStage('nin'); setChallengeId(null); setMaskedContact(''); setCode(''); setPassword(''); setStepHint(null)
    setError(ENDED_HERE); setFieldError(false); setErrorAlert(true)
  }

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
    setSignOutRequired(false)
    void Promise.allSettled([api.enrollmentCurrent(), api.googleOnboarding(), api.enrollmentAvailability()]).then(([progress, google, availability]) => {
      if (!active) return
      const registrationNow: Registration = availability.status === 'rejected' ? 'unknown'
        : availability.value?.open === true ? 'open' : 'closed'
      setRegistration(registrationNow)
      // The enrollment's own progress must be known before starting, as must
      // availability before a new one (below). A failed check for a pending
      // Google sign-up (for example a browser that sends no Referer, which that
      // check needs when no Origin is sent) counts as none pending: an
      // enrollment that requires Google still says so.
      const unavailable = progress.status === 'rejected'
        && (!isHidApiError(progress.reason) || ![401, 404].includes(progress.reason.status))
      const retried = retriedCheck.current
      retriedCheck.current = false
      if (progress.status === 'rejected' && requiresSignOut(progress.reason)) {
        setSignOutRequired(true)
        setSignOutAlert(!retried)
        setChecking(false)
        if (retried) focusAfter(() => signOutNote.current)
        return
      }
      if (unavailable) {
        setCheckError(true)
        setChecking(false)
        if (retried) focusAfter(() => checkRetry.current)
        return
      }
      // An enrollment this page had reached a step of is gone: it ended here.
      const ended = progress.status === 'rejected' && enrollmentEnded(progress.reason)
        && ['contact', 'otp', 'password'].includes(stageShown.current)
      if (progress.status === 'fulfilled') applyProgress(progress.value)
      else if (ended) restartAtNin()
      if (google.status === 'fulfilled' && new Date(google.value.expiresAt).getTime() > Date.now()) setGooglePending(true)
      setChecking(false)
      // At the NIN step, a failed availability read is offered Try again in place of the step.
      const atNin = progress.status === 'rejected' && (ended || stageShown.current === 'nin')
      if (retried && atNin && registrationNow === 'unknown') focusAfter(() => checkRetry.current)
      else if (retried) stepFocus.focus()
    })
    return () => { active = false }
  }, [api, checkKey, focusAfter, stepFocus.focus])

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const displayError = (reason: unknown, fromField = false, stepCodes: readonly string[] = []) => {
    if (enrollmentEnded(reason)) return restartAtNin()
    if (requiresSignOut(reason)) {
      setSignOutRequired(true); setSignOutAlert(false); setError(null); setFieldError(false)
      focusAfter(() => signOutNote.current)
      return
    }
    const aboutField = isFieldProblem(reason, stepCodes)
    setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
    setFieldError(aboutField)
    setErrorAlert(!aboutField || fromField)
  }
  const clearError = () => { setError(null); setFieldError(false); setErrorAlert(true) }

  const submitNin = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (!/^\d{11}$/.test(nin) || !turnstileToken || busy) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before continuing.'); setFieldError(false); return }
    setBusy(true); clearError()
    if (startKey.current?.nin !== nin) startKey.current = { nin, key: crypto.randomUUID() }
    try {
      const progress = await api.enrollmentStart(nin, turnstileToken, startKey.current.key)
      applyProgress(progress)
      setNin('')
    } catch (reason) { displayError(reason, fromField) }
    finally { setTurnstileToken(null); setResetKey(value => value + 1); setBusy(false); stepFocus.focus() }
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (busy || !contact.trim()) return
    setBusy(true); clearError()
    try {
      const result = await api.enrollmentContact(channel, contact.trim())
      setChallengeId(result.challengeId)
      setMaskedContact(contact.trim())
      // Kept, so 'Request another code' comes back to it filled in (PA-10).
      setStage('otp')
    } catch (reason) { displayError(reason, fromField, ['CONTACT_ALREADY_REGISTERED']) }
    finally { setBusy(false); stepFocus.focus() }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true); clearError()
    try { await api.enrollmentVerify(challengeId, code); setCode(''); setStepHint(null); setStage('password') }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID') setStepHint('code')
      displayError(reason, fromField)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (busy || password.length < 12) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before activation.'); setFieldError(false); return }
    setBusy(true); clearError()
    try {
      const result = await api.enrollmentActivate(password)
      setPassword('')
      setHidCode(result.hidCode)
      setStepHint(null)
      setStage('complete')
    } catch (reason) {
      if (contactReverifyRequired(reason)) {
        // The contact typed on this page is kept, so a new code goes to it with one press (PA-10).
        setStage('contact'); setChallengeId(null); setMaskedContact(''); setCode(''); setPassword(''); setStepHint(null)
        setError(REVERIFY_CONTACT); setFieldError(false); setErrorAlert(true)
        return
      }
      if (isHidApiError(reason) && reason.status === 429) setStepHint('activation')
      displayError(reason, fromField)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  const onGoogle = async (idToken: string) => {
    if (!googleTurnstileToken) return
    setBusy(true); clearError()
    try {
      const result = await api.googleExchange(idToken, googleTurnstileToken, 'enroll')
      if ('actor' in result) { acceptGoogleSession(result); navigate('/', { replace: true }); return }
      setGooglePending(true)
      // Binding answers only that it bound; the enrollment's own progress is read
      // again, so a patient already past the contact step is not sent back to it.
      if (stage !== 'nin') { await api.enrollmentBindGoogle(); applyProgress(await api.enrollmentCurrent()) }
    } catch (reason) { displayError(reason); setFieldError(false); setErrorAlert(true) }
    finally { setGoogleTurnstileToken(null); setGoogleResetKey(value => value + 1); setBusy(false); stepFocus.focus() }
  }

  // No step is offered while the check runs, after it failed, or while a sign-in blocks enrollment.
  const ready = !checking && !checkError && !signOutRequired
  // A new enrollment is offered only while registration is open; one in progress continues.
  const startOffered = stage !== 'nin' || registration === 'open'
  const closed = ready && stage === 'nin' && registration === 'closed'
  // The error is about the stage's field when the server refused its value.
  const invalid = fieldError ? true : undefined
  const errorId = fieldError ? 'enroll-error' : undefined

  return <main className="patient-auth-page">
    <section className="patient-auth-card patient-enroll-card" aria-labelledby="enroll-title">
      <Link to="/" className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">Patient enrollment</p>
      <h1 id="enroll-title" className="patient-page-title">Get your Health ID.</h1>
      <p className="patient-page-copy">Verify your identity, confirm a contact, and activate your account.</p>
      {!closed && <ol className="patient-step-list" aria-label="Enrollment steps">
        {['NIN', 'Contact', 'Code', 'Activate'].map((label, index) => <li key={label} aria-current={['nin', 'contact', 'otp', 'password'][index] === stage ? 'step' : undefined}>{label}</li>)}
      </ol>}
      {checking ? <p role="status">Checking for an enrollment in progress…</p> : null}
      {checkError && <div className="patient-inline-error" role="alert"><p>We could not check for an enrollment in progress. Try again before starting.</p><button ref={checkRetry} type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; setCheckKey(value => value + 1) }}>Try again</button></div>}
      {signOutRequired && <div ref={signOutNote} tabIndex={-1} role="group" aria-labelledby="enroll-sign-out" className="patient-inline-error patient-session-note">
        {otherPortalSession ? <>
          <p id="enroll-sign-out" role={signOutAlert ? 'alert' : undefined}>A provider sign-in is active in this browser. Sign out of the provider portal before starting a new Health ID.</p>
          <p>{ENDS_ENROLLMENT}</p>
          <Link to="/provider">Go to the provider portal</Link>
        </> : <>
          <p id="enroll-sign-out" role={signOutAlert ? 'alert' : undefined}>This browser is still signed in to Health ID. Sign out of the patient or provider portal before starting a new Health ID.</p>
          {/* No link to the patient portal: this tab has no patient session, so it would open sign-in. Check again opens it once the session check finds the patient. */}
          <p>If a patient is signed in, Check again opens the patient portal, where you can sign out.</p>
          <p>{ENDS_ENROLLMENT}</p>
          <Link to="/provider">Go to the provider portal</Link>
        </>}
        {/* Once it is signed out elsewhere, as asked, the browser's session and the enrollment are checked again. */}
        <button type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; retrySessionCheck(); setCheckKey(value => value + 1) }}>Check again</button>
      </div>}
      {error && <p id="enroll-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{closed && error === ENDED_HERE ? ENDED : error}</p>}
      {googleRequired && !googlePending && <p role="status" className="patient-inline-error">Reconnect the Google account used to start this enrollment.</p>}
      {ready && stage === 'nin' && registration === 'unknown' && <div className="patient-inline-error" role="alert"><p>We could not check whether new Health ID registration is open. Try again before starting.</p><button ref={checkRetry} type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; setCheckKey(value => value + 1) }}>Try again</button></div>}
      {closed && <section className="patient-success" aria-labelledby="enroll-closed-title">
        <h2 id="enroll-closed-title" ref={stepFocus.target} tabIndex={-1}>Registration is not open yet</h2>
        <p role="status">{REGISTRATION_CLOSED}</p>
        <Link className="patient-primary-button" to="/sign-in">Sign in</Link>
        <Link className="patient-text-button" to="/recover">Forgot password?</Link>
      </section>}
      {ready && stage === 'nin' && registration === 'open' && <form onSubmit={event => void submitNin(event)} className="patient-form">
        <label>National Identification Number<input ref={stepFocus.target} required inputMode="numeric" autoComplete="off" value={nin} onChange={event => setNin(event.target.value.replace(/\D/g, '').slice(0, 11))} pattern="[0-9]{11}" maxLength={11} placeholder="11 digits"
          aria-invalid={invalid} aria-describedby={describedBy('enroll-nin-hint', errorId)} /></label>
        <p id="enroll-nin-hint" className="patient-field-hint">Your NIN is 11 digits. It is verified by the existing Health ID identity service. It is not stored in this browser.</p>
        <Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
        <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken || nin.length !== 11 || (googleRequired && !googlePending)}>{busy ? 'Verifying…' : 'Verify NIN'}</button>
      </form>}
      {ready && stage === 'contact' && <form onSubmit={event => void submitContact(event)} className="patient-form">
        <h2>Where should we send your code?</h2>
        <label>Contact method<select value={channel} onChange={event => setChannel(event.target.value as 'phone' | 'email')}><option value="phone">Phone</option><option value="email">Email</option></select></label>
        <label>{channel === 'phone' ? 'Phone number' : 'Email address'}<input ref={stepFocus.target} required type={channel === 'phone' ? 'tel' : 'email'} autoComplete={channel === 'phone' ? 'tel' : 'email'} value={contact} onChange={event => setContact(event.target.value)}
          aria-invalid={invalid} aria-describedby={errorId} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>
      </form>}
      {ready && stage === 'otp' && <form onSubmit={event => void submitCode(event)} className="patient-form">
        <h2>Verify your contact</h2><p id="enroll-code-hint" className="patient-field-hint">Enter the six digit code sent to {maskedContact || 'your contact'}.</p>
        <label>Verification code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" maxLength={6}
          aria-invalid={invalid} aria-describedby={describedBy('enroll-code-hint', errorId)} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
        {/* The note on a refused code is about that code: a new one starts without it. */}
        <button type="button" className="patient-text-button" disabled={busy} onClick={() => { setCode(''); setChallengeId(null); setStepHint(null); clearError(); setStage('contact'); stepFocus.focus() }}>Request another code or change contact</button>
        {stepHint === 'code' && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}
      </form>}
      {ready && stage === 'password' && <form onSubmit={event => void submitPassword(event)} className="patient-form">
        <h2>Activate your account</h2><p id="enroll-password-hint" className="patient-field-hint">Choose a password of at least 12 characters.</p>
        <label>Password<input ref={stepFocus.target} required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}
          aria-invalid={invalid} aria-describedby={describedBy('enroll-password-hint', errorId)} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12 || (googleRequired && !googlePending)}>{busy ? 'Activating…' : 'Activate Health ID'}</button>
        {stepHint === 'activation' && <p className="patient-field-hint">{ACTIVATION_LIMIT_HINT}</p>}
      </form>}
      {ready && stage === 'complete' && <div className="patient-success" role="status"><h2 ref={stepFocus.target} tabIndex={-1}>Your Health ID is ready.</h2><strong>{hidCode}</strong><p>{SAVE_HID}</p><p>Sign in with your verified email or Health ID and new password. With a verified phone number, your Health ID is how you sign in and reset your password.</p><Link className="patient-primary-button" to="/sign-in">Sign in</Link></div>}
      {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && ready && startOffered && stage !== 'complete' && !googlePending && <section className="patient-auth-separator" aria-label="Google enrollment">
        <span>{googleRequired ? 'Reconnect Google' : 'Continue with Google'}</span>
        <Turnstile action="patient-login" onTokenChange={setGoogleTurnstileToken} resetKey={googleResetKey} />
        <GoogleButton text="signup_with" disabled={busy || !googleTurnstileToken} onCredential={onGoogle}
          disabledReason={googleTurnstileToken ? undefined : 'Complete the security check to continue with Google.'} />
      </section>}
      {googlePending && !checkError && startOffered && stage !== 'complete' && <p role="status" className="patient-field-hint">Google identity confirmed for this enrollment.</p>}
      <p className="patient-auth-footer">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
    </section>
  </main>
}
