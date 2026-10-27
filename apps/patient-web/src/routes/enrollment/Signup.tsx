import { useLayoutEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError, retryAfterSeconds } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { SIGNUP_GENDERS, type EnrollmentSignupDetails, type SignupGender } from '../../api'
import { AuthLayout } from '../../AuthLayout'
import { GoogleButton } from '../../GoogleButton'
import { googleClientId } from '../../googleClient'
import { Turnstile } from '../../Turnstile'
import { useSession } from '../../session'
import { describedBy, sentFromField, useStepFocus } from '../../authSteps'
import { useResendWait } from '../recoveryWait'
import { LegalDocuments } from './LegalDocuments'
import { googleProfileOf } from './googleProfile'
import { REGISTRATION_CLOSED } from './RegistrationClosed'
import { STEP_UNAVAILABLE, refusedWith, registrationClosed, temporarilyUnavailable } from './problems'

/**
 * The patient sign-up without a NIN (an owner decision, 2026-10-27), as hid-1.0's
 * PatientAuth: the details, a password with the security check, a code sent to
 * the email, then the Health ID. The NIN is verified later, from the profile.
 * Shown by routes/Enrollment.tsx only while Identity's availability read says
 * `signup: true`; until then the NIN-first enrollment is shown as before.
 *
 * The password is kept in memory from its step until activation, which follows
 * the code at once: Identity takes it only at `set_password`.
 */
type SignupStep = 'details' | 'password' | 'code' | 'done'
type DetailsField = 'firstName' | 'lastName' | 'email' | 'phone' | 'gender' | 'hospitalCurrentlyUsing' | 'terms'
type Field = DetailsField | 'password' | 'confirm' | 'code'
type FieldErrors = Partial<Record<Field, string>>

const DETAILS_ORDER: readonly DetailsField[] = ['firstName', 'lastName', 'email', 'phone', 'gender', 'hospitalCurrentlyUsing', 'terms']
const PASSWORD_ORDER: readonly Field[] = ['password', 'confirm']

const GENDER_LABELS: Record<SignupGender, string> = { female: 'Female', male: 'Male' }

export const SIGNUP_PROBLEMS: Record<DetailsField, string> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter a valid email address, like name@example.com.',
  phone: 'Enter a valid phone number, like 08012345678 or +2348012345678.',
  gender: 'Select your gender.',
  hospitalCurrentlyUsing: 'Check the name of the hospital you currently use.',
  terms: 'Agree to the Terms of Service and Privacy Policy to create an account.',
}
export const PASSWORD_RULE = 'Choose a password of at least 12 characters.'
const CONFIRM_RULE = 'Type the same password again.'
/** 409 PATIENT_EMAIL_ALREADY_REGISTERED; shown with a link to sign in. */
export const EMAIL_TAKEN = 'This email address already has a Health ID account.'
/** 409 PATIENT_PHONE_ALREADY_REGISTERED. */
export const PHONE_TAKEN = 'This phone number already has a Health ID account. Sign in instead, or use another phone number.'
const CODE_REFUSED = 'That code is wrong or has expired. Check the latest email, or send a new code.'
const CHECK_DETAILS = 'Some details need checking. They are marked below.'
/** 404 ENROLLMENT_NOT_FOUND after the details were sent: the sign-up's cookie expired or was ended here. */
export const SIGNUP_ENDED = 'This sign-up is no longer open on this device. It may have expired, or ended when someone signed in or out in this browser. Check your details and continue to start again.'
const GOOGLE_FILLED = 'Google details added. Check them and complete the form to continue.'
const GOOGLE_UNREAD = 'We could not read your details from Google. Enter them below.'
const resendWaitText = (seconds: number) => `A code was sent recently. You can ask for a new code in ${seconds} seconds.`
/** Identity's field names in a 400 VALIDATION_FAILED, to the fields of the details step. */
const SERVER_FIELDS: Readonly<Record<string, DetailsField>> = {
  firstName: 'firstName', lastName: 'lastName', email: 'email', phone: 'phone', gender: 'gender',
  hospitalCurrentlyUsing: 'hospitalCurrentlyUsing', termsAccepted: 'terms',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** The phone number as sent: without the spaces, dashes, dots and brackets people type. */
const normalizePhone = (value: string) => value.replace(/[\s().-]/g, '')
const enrollmentEnded = (reason: unknown) => refusedWith(reason, 404, 'ENROLLMENT_NOT_FOUND')

interface Details {
  firstName: string
  lastName: string
  email: string
  phone: string
  gender: SignupGender | ''
  hospitalCurrentlyUsing: string
  terms: boolean
}
const EMPTY_DETAILS: Details = { firstName: '', lastName: '', email: '', phone: '', gender: '', hospitalCurrentlyUsing: '', terms: false }

function detailsProblems(details: Details): FieldErrors {
  const problems: FieldErrors = {}
  if (!details.firstName.trim()) problems.firstName = SIGNUP_PROBLEMS.firstName
  if (!details.lastName.trim()) problems.lastName = SIGNUP_PROBLEMS.lastName
  if (!EMAIL_PATTERN.test(details.email.trim())) problems.email = SIGNUP_PROBLEMS.email
  if (!/^\+?\d{7,15}$/.test(normalizePhone(details.phone))) problems.phone = SIGNUP_PROBLEMS.phone
  if (!details.gender) problems.gender = SIGNUP_PROBLEMS.gender
  if (!details.terms) problems.terms = SIGNUP_PROBLEMS.terms
  return problems
}

function passwordProblems(password: string, confirm: string): FieldErrors {
  const problems: FieldErrors = {}
  if (password.length < 12 || password.length > 256) problems.password = PASSWORD_RULE
  if (!confirm || confirm !== password) problems.confirm = CONFIRM_RULE
  return problems
}

/** The fields a 400 VALIDATION_FAILED names (`errors: [{ field, messages }]`), on the details step. */
function serverDetailsProblems(reason: unknown): FieldErrors {
  const problems: FieldErrors = {}
  if (!refusedWith(reason, 400, 'VALIDATION_FAILED') || !isHidApiError(reason) || !Array.isArray(reason.details)) return problems
  for (const entry of reason.details as unknown[]) {
    const name = entry && typeof entry === 'object' ? (entry as { field?: unknown }).field : undefined
    const field = typeof name === 'string' && Object.hasOwn(SERVER_FIELDS, name) ? SERVER_FIELDS[name] : undefined
    if (field) problems[field] = SIGNUP_PROBLEMS[field]
  }
  return problems
}

const firstOf = <T extends string>(order: readonly T[], errors: Partial<Record<T, string>>) => order.find(field => errors[field])

export function PatientSignup({ focusOnArrival = false }: {
  /** Focus goes to the first field as the sign-up is shown: it replaced the control that was used. */
  focusOnArrival?: boolean
}) {
  const { api } = useSession()
  const stepFocus = useStepFocus()
  const { focus } = stepFocus
  useLayoutEffect(() => { if (focusOnArrival) focus() }, [focusOnArrival, focus])
  const resend = useResendWait()
  const [step, setStep] = useState<SignupStep>('details')
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [maskedContact, setMaskedContact] = useState('')
  const [resendWaitSeconds, setResendWaitSeconds] = useState(0)
  // The email is proved (set_password): what is left is activation, with no new sign-up or security check.
  const [verified, setVerified] = useState(false)
  const [hidCode, setHidCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  // An error is an alert when focus does not move to what it describes (PA-02): sent with Enter in a field.
  const [errorAlert, setErrorAlert] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  /** A field's error goes once it is changed. */
  const dropError = (field: Field) => setFieldErrors(current => {
    if (!current[field]) return current
    const rest = { ...current }
    delete rest[field]
    return rest
  })
  const update = <K extends keyof Details>(field: K, value: Details[K]) => {
    setDetails(current => ({ ...current, [field]: value }))
    dropError(field)
  }
  const clearMessages = () => { setFieldErrors({}); setError(null); setErrorAlert(true); setNotice(null) }
  const sayError = (message: string) => { setError(message); setErrorAlert(true) }
  const beginResendWait = (seconds: unknown) => {
    resend.begin(seconds)
    setResendWaitSeconds(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0)
  }
  /** Back to the details, with what was typed kept; the next password step signs up again, under a new key. */
  const backToDetails = (errors: FieldErrors = {}, message: string | null = null, alert = true) => {
    setStep('details'); setVerified(false); setChallengeId(null); setMaskedContact(''); setCode(''); resend.reset()
    setFieldErrors(errors); setError(message); setErrorAlert(alert)
  }
  /** A refusal not about a field of the step: said as an alert, with Identity's own words where it has them. */
  const sayRefusal = (reason: unknown, fallback: string) => {
    if (registrationClosed(reason)) return sayError(REGISTRATION_CLOSED)
    if (temporarilyUnavailable(reason)) return sayError(STEP_UNAVAILABLE)
    sayError(isHidApiError(reason) ? reason.message : fallback)
  }

  const submitDetails = (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy) return
    const problems = detailsProblems(details)
    if (Object.keys(problems).length) {
      setNotice(null); setFieldErrors(problems)
      // Focus goes to the first field marked, whose description says why; from a field it stays, so say it.
      setError(fromField ? CHECK_DETAILS : null); setErrorAlert(true)
      stepFocus.focus()
      return
    }
    clearMessages(); setStep('password'); stepFocus.focus()
  }

  const activate = async () => {
    const result = await api.enrollmentActivate(password)
    setPassword(''); setConfirm(''); setCode('')
    setHidCode(result.hidCode); setStep('done')
  }

  /** Activation refused after the email was proved: the password step again, with the password kept. */
  const activationRefused = (reason: unknown, fromField: boolean) => {
    if (enrollmentEnded(reason)) return backToDetails({}, SIGNUP_ENDED)
    setStep('password')
    if (isHidApiError(reason) && (reason.status === 400 || reason.status === 422)) {
      setFieldErrors({ password: reason.message }); setError(null); setErrorAlert(true)
      if (fromField) sayError(reason.message)
      return
    }
    sayRefusal(reason, 'We could not create your account just now. Try again.')
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy) return
    const problems = passwordProblems(password, confirm)
    if (Object.keys(problems).length) {
      setNotice(null); setFieldErrors(problems); setError(fromField ? problems.password ?? problems.confirm ?? null : null); setErrorAlert(true)
      stepFocus.focus()
      return
    }
    if (!verified && !turnstileToken) return
    setBusy(true); clearMessages()
    try {
      if (verified) { await activate(); return }
      const input: EnrollmentSignupDetails = {
        firstName: details.firstName.trim(), lastName: details.lastName.trim(), email: details.email.trim(),
        phone: normalizePhone(details.phone), gender: details.gender as SignupGender,
        ...(details.hospitalCurrentlyUsing.trim() ? { hospitalCurrentlyUsing: details.hospitalCurrentlyUsing.trim() } : {}),
      }
      const progress = await api.enrollmentSignup(input, turnstileToken!, crypto.randomUUID())
      setChallengeId(progress.challengeId ?? null)
      setMaskedContact(progress.maskedContact ?? '')
      beginResendWait(progress.resendAfterSeconds)
      setCode(''); setStep('code')
    } catch (reason) {
      if (verified) { activationRefused(reason, fromField); return }
      if (refusedWith(reason, 409, 'PATIENT_EMAIL_ALREADY_REGISTERED')) return backToDetails({ email: EMAIL_TAKEN }, null)
      if (refusedWith(reason, 409, 'PATIENT_PHONE_ALREADY_REGISTERED')) return backToDetails({ phone: PHONE_TAKEN }, null)
      const refused = serverDetailsProblems(reason)
      if (Object.keys(refused).length) return backToDetails(refused, null)
      sayRefusal(reason, 'We could not start your sign-up just now. Try again.')
    } finally {
      // Each security check is used once: a new one is needed for another attempt.
      setTurnstileToken(null); setResetKey(value => value + 1); setBusy(false); stepFocus.focus()
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true); clearMessages()
    let proved = verified
    try {
      if (!proved) { await api.enrollmentVerify(challengeId, code); proved = true; setVerified(true) }
      await activate()
    } catch (reason) {
      // The password step is shown and takes focus, whose description then says why.
      if (proved) activationRefused(reason, false)
      else if (enrollmentEnded(reason)) backToDetails({}, SIGNUP_ENDED)
      else if (isHidApiError(reason) && (reason.code === 'OTP_INVALID' || reason.status === 422)) {
        setFieldErrors({ code: CODE_REFUSED }); setError(fromField ? CODE_REFUSED : null); setErrorAlert(true)
      } else sayRefusal(reason, 'We could not check the code just now. Try again.')
    } finally { setBusy(false); stepFocus.focus() }
  }

  const sendCodeAgain = async () => {
    if (busy) return
    setBusy(true); clearMessages()
    try {
      const sent = await api.enrollmentContact('email', details.email.trim())
      setChallengeId(sent.challengeId); setCode('')
      beginResendWait(sent.resendAfterSeconds)
      setNotice(`A new code was sent to ${maskedContact || 'your email address'}.`)
    } catch (reason) {
      if (enrollmentEnded(reason)) backToDetails({}, SIGNUP_ENDED)
      else if (refusedWith(reason, 429, 'OTP_RESEND_COOLDOWN')) {
        const wait = Math.max(1, Math.ceil(retryAfterSeconds(reason) ?? 60))
        beginResendWait(wait); sayError(resendWaitText(wait))
      } else sayRefusal(reason, 'We could not send a new code just now. Try again.')
    } finally { setBusy(false); stepFocus.focus() }
  }

  /** "Continue with Google": fills in the name and email from the credential, with nothing sent (as hid-1.0). */
  const fillFromGoogle = (idToken: string): Promise<void> => {
    const google = googleProfileOf(idToken)
    if (!google || (!google.firstName && !google.lastName && !google.email)) { setNotice(null); sayError(GOOGLE_UNREAD); return Promise.resolve() }
    setDetails(current => ({
      ...current,
      firstName: google.firstName || current.firstName,
      lastName: google.lastName || current.lastName,
      email: google.email || current.email,
    }))
    setFieldErrors(current => {
      const rest = { ...current }
      if (google.firstName) delete rest.firstName
      if (google.lastName) delete rest.lastName
      if (google.email) delete rest.email
      return rest
    })
    setError(null); setNotice(GOOGLE_FILLED)
    return Promise.resolve()
  }

  const invalid = (field: Field) => fieldErrors[field] ? true as const : undefined
  const errorId = (field: Field) => fieldErrors[field] ? `signup-${field}-error` : undefined
  const fieldError = (field: Field) => fieldErrors[field] && <p id={`signup-${field}-error`} className="patient-inline-error">
    {fieldErrors[field]}{field === 'email' && fieldErrors.email === EMAIL_TAKEN && <> <Link to="/sign-in">Sign in instead.</Link></>}
  </p>
  const detailsFocus = firstOf(DETAILS_ORDER, fieldErrors) ?? 'firstName'
  const passwordFocus = firstOf(PASSWORD_ORDER, fieldErrors) ?? 'password'
  const target = (field: Field, focusOn: Field) => field === focusOn ? stepFocus.target : undefined
  const steps = step === 'done' ? undefined : ([['Your details', 'details'], ['Password', 'password'], ['Email code', 'code']] as const)
    .map(([label, at]) => ({ label, current: step === at }))
  const googleOffered = Boolean(googleClientId()) && step === 'details'

  return <AuthLayout brandTo="/" title="Create your Health ID." titleId="enroll-title"
    lede="Your health data. Safely stored. Instantly accessible. Always in your control."
    steps={steps} stepsLabel="Sign-up steps">
    {error && <p id="signup-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    {/* Kept mounted, so a notice is a change of a live region, not a new one. */}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>

    {step === 'details' && <form onSubmit={submitDetails} className="patient-form" noValidate aria-labelledby="signup-details-title">
      <h2 id="signup-details-title">Your details</h2>
      <p className="patient-field-hint">You can verify your NIN later, from your profile.</p>
      <label>First name<input ref={target('firstName', detailsFocus)} required autoComplete="given-name" maxLength={100} value={details.firstName}
        onChange={event => update('firstName', event.target.value)} aria-invalid={invalid('firstName')} aria-describedby={errorId('firstName')} /></label>
      {fieldError('firstName')}
      <label>Last name<input ref={target('lastName', detailsFocus)} required autoComplete="family-name" maxLength={100} value={details.lastName}
        onChange={event => update('lastName', event.target.value)} aria-invalid={invalid('lastName')} aria-describedby={errorId('lastName')} /></label>
      {fieldError('lastName')}
      <label>Email address<input ref={target('email', detailsFocus)} required type="email" autoComplete="email" maxLength={254} value={details.email}
        onChange={event => update('email', event.target.value)} aria-invalid={invalid('email')}
        aria-describedby={describedBy('signup-email-hint', errorId('email'))} /></label>
      <p id="signup-email-hint" className="patient-field-hint">We will send a 6-digit code to this email address.</p>
      {fieldError('email')}
      <label>Phone number<input ref={target('phone', detailsFocus)} required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={details.phone}
        onChange={event => update('phone', event.target.value.replace(/[^\d+\s().-]/g, ''))} aria-invalid={invalid('phone')} aria-describedby={errorId('phone')} /></label>
      {fieldError('phone')}
      <label>Gender<select ref={target('gender', detailsFocus)} required value={details.gender} onChange={event => update('gender', event.target.value as SignupGender | '')}
        aria-invalid={invalid('gender')} aria-describedby={errorId('gender')}>
        <option value="">Select…</option>
        {SIGNUP_GENDERS.map(value => <option key={value} value={value}>{GENDER_LABELS[value]}</option>)}
      </select></label>
      {fieldError('gender')}
      <label>Hospital you currently use (optional)<input ref={target('hospitalCurrentlyUsing', detailsFocus)} autoComplete="off" maxLength={200}
        value={details.hospitalCurrentlyUsing} onChange={event => update('hospitalCurrentlyUsing', event.target.value)}
        aria-invalid={invalid('hospitalCurrentlyUsing')} aria-describedby={errorId('hospitalCurrentlyUsing')} /></label>
      {fieldError('hospitalCurrentlyUsing')}
      <label className="patient-checkbox"><input ref={target('terms', detailsFocus)} type="checkbox" checked={details.terms}
        onChange={event => update('terms', event.target.checked)} aria-invalid={invalid('terms')} aria-describedby={errorId('terms')} />
        I agree to the Terms of Service and Privacy Policy</label>
      {fieldError('terms')}
      <LegalDocuments />
      <button type="submit" className="patient-primary-button" disabled={busy}>Continue</button>
    </form>}

    {step === 'password' && <form onSubmit={event => void submitPassword(event)} className="patient-form" noValidate aria-labelledby="signup-password-title">
      <h2 id="signup-password-title">Create a secure password</h2>
      <p id="signup-password-hint" className="patient-field-hint">Use a strong password to protect your Health ID account. {PASSWORD_RULE}</p>
      {verified && <p className="patient-field-hint">Your email address is verified. Create your account to get your Health ID.</p>}
      <div className="patient-field"><label htmlFor="signup-password">Password</label><PasswordInput appearance="plain" id="signup-password"
        ref={target('password', passwordFocus)} required autoComplete="new-password" minLength={12} maxLength={256} value={password}
        onChange={event => { setPassword(event.target.value); dropError('password') }}
        aria-invalid={invalid('password')} aria-describedby={describedBy('signup-password-hint', errorId('password'))} /></div>
      {fieldError('password')}
      <div className="patient-field"><label htmlFor="signup-confirm">Confirm password</label><PasswordInput appearance="plain" id="signup-confirm"
        ref={target('confirm', passwordFocus)} required autoComplete="new-password" maxLength={256} value={confirm}
        onChange={event => { setConfirm(event.target.value); dropError('confirm') }}
        aria-invalid={invalid('confirm')} aria-describedby={errorId('confirm')} /></div>
      {fieldError('confirm')}
      {!verified && <Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />}
      {!verified && !turnstileToken && <p id="signup-check-needed" className="patient-field-hint">Complete the security check to continue.</p>}
      <button type="submit" className="patient-primary-button" disabled={busy || (!verified && !turnstileToken)}
        aria-describedby={!verified && !turnstileToken ? 'signup-check-needed' : undefined}>{busy ? 'Creating account…' : 'Create account'}</button>
      {!verified && <button type="button" className="patient-text-button" disabled={busy}
        onClick={() => { clearMessages(); setStep('details'); stepFocus.focus() }}>Back</button>}
    </form>}

    {step === 'code' && <form onSubmit={event => void submitCode(event)} className="patient-form" aria-labelledby="signup-code-title">
      <h2 id="signup-code-title">Enter verification code</h2>
      <p id="signup-code-hint" className="patient-field-hint">We sent a 6-digit code to {maskedContact || 'your email address'}. Enter it here to finish creating your Health ID account.</p>
      <label>Verification code<input ref={stepFocus.target} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
        onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setFieldErrors({}) }}
        aria-invalid={invalid('code')} aria-describedby={describedBy('signup-code-hint', errorId('code'))} /></label>
      {fieldError('code')}
      <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
      <button type="button" className="patient-text-button" disabled={busy || !resend.ready} onClick={() => void sendCodeAgain()}
        aria-describedby={resend.ready ? undefined : 'signup-resend-wait'}>Send code again</button>
      {!resend.ready && <p id="signup-resend-wait" className="patient-field-hint">A new code can be sent {resendWaitSeconds} seconds after the last one.</p>}
      <button type="button" className="patient-text-button" disabled={busy}
        onClick={() => { clearMessages(); backToDetails(); stepFocus.focus() }}>Change your details</button>
    </form>}

    {step === 'done' && <div className="patient-success" role="status">
      <h2 ref={stepFocus.target} tabIndex={-1}>Your Health ID is ready.</h2>
      <strong>{hidCode}</strong>
      <p>Save this code: write it down or keep it somewhere safe. This page may not show it again once you leave or reload it.</p>
      <p>Use your Health ID or your email address, with your password, whenever you sign in. Once signed in, you can verify your NIN from your profile.</p>
      <Link className="patient-primary-button" to="/sign-in">Sign in to continue</Link>
    </div>}

    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleOffered && <section className="patient-auth-separator" aria-label="Google sign-up">
      <p className="patient-field-hint">Continue with Google to fill in your name and email address.</p>
      <GoogleButton text="continue_with" disabled={busy} onCredential={fillFromGoogle} />
    </section>}
    <p className="patient-auth-footer">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
  </AuthLayout>
}
