import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import type { EnrollmentProgress } from '../api'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import { isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useActionFocus } from './actionFocus'
import { NinStep } from './enrollment/NinStep'
import { ContactStep } from './enrollment/ContactStep'
import { ContactCodeStep } from './enrollment/ContactCodeStep'
import { PasswordStep } from './enrollment/PasswordStep'
import { Complete } from './enrollment/Complete'
import { RegistrationClosed } from './enrollment/RegistrationClosed'

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
 * ended here is told to enter its NIN again only once a read finds it open.
 * Until then, while the read has failed, Try again stands in for the NIN step,
 * focus included. Production keeps registration closed until hid-system's N1
 * holder step ships; the notice is Identity's own wording for the start's 503.
 */
type Registration = 'open' | 'closed' | 'unknown'
/**
 * A contact proved more than 30 minutes before activation is proved again
 * (hid-system#68, N2(c), ADR-048): activation answers 409 and has already sent
 * the enrollment back to the contact step without its contact, so the page goes
 * there too. At the password step a second try would only be refused.
 */
const contactReverifyRequired = (reason: unknown) => isHidApiError(reason) && reason.status === 409
  && reason.code === 'ENROLLMENT_CONTACT_REVERIFY_REQUIRED'
const REVERIFY_CONTACT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. Send a new code, enter it, then choose your password.'
const REVERIFY_CODE_SENT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. Enter the new code sent to it, then choose your password.'
/**
 * That return seen without its 409, which was lost or answered another tab's
 * activation: any further activation is refused as not at the password step
 * (409 ENROLLMENT_STAGE_INVALID), so the enrollment's stage is read again and
 * the page goes where Identity has it.
 */
const notAtPasswordStep = (reason: unknown) => isHidApiError(reason) && reason.status === 409
  && reason.code === 'ENROLLMENT_STAGE_INVALID'

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
  // The availability read's Try again is also the NIN step's focus target (above).
  const retryInPlaceOfNin = useCallback((element: HTMLButtonElement | null) => {
    checkRetry.current = element
    stepFocus.target(element)
  }, [stepFocus.target])
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
      if (notAtPasswordStep(reason)) {
        let progress: EnrollmentProgress
        try { progress = await api.enrollmentCurrent() } catch (again) { displayError(again); return }
        // Still at the password step, the refusal is about something else and is shown below.
        if (progress.stage !== 'set_password') {
          applyProgress(progress); setCode(''); setPassword(''); setStepHint(null)
          if (progress.stage === 'verify_contact') {
            setError(progress.challengeId ? REVERIFY_CODE_SENT : REVERIFY_CONTACT); setFieldError(false); setErrorAlert(true)
          }
          return
        }
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
  const invalid = fieldError ? true as const : undefined
  const errorId = fieldError ? 'enroll-error' : undefined
  const stepProps = { focusTarget: stepFocus.target, busy, invalid, errorId }

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
      {error && <p id="enroll-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error === ENDED_HERE && registration !== 'open' ? ENDED : error}</p>}
      {/* Not at a NIN step that offers no start, where Google is not offered either. */}
      {googleRequired && !googlePending && startOffered && <p role="status" className="patient-inline-error">Reconnect the Google account used to start this enrollment.</p>}
      {ready && stage === 'nin' && registration === 'unknown' && <div className="patient-inline-error" role="alert"><p>We could not check whether new Health ID registration is open. Try again before starting.</p><button ref={retryInPlaceOfNin} type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; setCheckKey(value => value + 1) }}>Try again</button></div>}
      {closed && <RegistrationClosed focusTarget={stepFocus.target} />}
      {ready && stage === 'nin' && registration === 'open' && <NinStep {...stepProps} nin={nin} onNin={setNin} onSubmit={event => void submitNin(event)}
        turnstile={<Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />}
        blocked={!turnstileToken || (googleRequired && !googlePending)} />}
      {ready && stage === 'contact' && <ContactStep {...stepProps} channel={channel} onChannel={setChannel} contact={contact} onContact={setContact}
        onSubmit={event => void submitContact(event)} />}
      {ready && stage === 'otp' && <ContactCodeStep {...stepProps} maskedContact={maskedContact} code={code} onCode={setCode} onSubmit={event => void submitCode(event)}
        onAnotherCode={() => { setCode(''); setChallengeId(null); setStepHint(null); clearError(); setStage('contact'); stepFocus.focus() }}
        budgetNote={stepHint === 'code'} />}
      {ready && stage === 'password' && <PasswordStep {...stepProps} password={password} onPassword={setPassword} onSubmit={event => void submitPassword(event)}
        blocked={googleRequired && !googlePending} limitNote={stepHint === 'activation'} />}
      {ready && stage === 'complete' && <Complete focusTarget={stepFocus.target} hidCode={hidCode} />}
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
