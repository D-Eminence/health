import { useLayoutEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError, retryAfterSeconds } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { PasswordRules } from '../../PasswordRules'
import { SIGNUP_GENDERS, type EnrollmentActivation, type EnrollmentSignupDetails, type SignupGender } from '../../api'
import { AuthLayout } from '../../AuthLayout'
import { GoogleButton } from '../../GoogleButton'
import { googleClientId } from '../../googleClient'
import { Turnstile } from '../../Turnstile'
import { useSession } from '../../session'
import { describedBy, sentFromField, useStepFocus } from '../../authSteps'
import { CodeBoxes, codeComplete } from '../../CodeBoxes'
import { useResendWait } from '../recoveryWait'
import { HospitalPicker } from './HospitalPicker'
import { googleProfileOf } from './googleProfile'
import { REGISTRATION_CLOSED } from './RegistrationClosed'
import { Complete } from './Complete'
import { Alert, Button, Field, Select } from '../../kasuwa/ui'
import { Hint, InputR, SelectR } from '../profileParts'
import { STEP_UNAVAILABLE, refusedWith, registrationClosed, temporarilyUnavailable } from './problems'
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, internationalPhone } from './phoneCountries'
import { ExistingAccountAlert, existingAccount, type ExistingAccount } from './googleAccountExists'
import { ConsentChecks } from '../../agreements/ConsentChecks'
import { PATIENT_TERMS } from '../../agreements/patientTerms'
import { PATIENT_CONSENT_ITEMS, usePatientConsent } from '../../agreements/patientConsent'
import { patientConsentRecord, recordQuietly } from '../../agreements/records'

/**
 * The patient sign-up without a NIN (an owner decision, 2026-10-27), as hid-1.0's
 * PatientAuth: the details, a password with the security check and the agreements
 * (the last step before the account is made), a code sent to the email, then the
 * Health ID. The NIN is verified later, from the profile.
 * Shown by routes/Enrollment.tsx only while Identity's availability read says
 * `signup: true`; until then the NIN-first enrollment is shown as before.
 *
 * The password is kept in memory from its step until activation, which follows
 * the code at once: Identity takes it only at `set_password`. An activation that
 * signs the patient in (`signedIn: true`, owner decision 2026-10-28) shows the
 * Health ID with "Proceed to profile", as hid-1.0 did; otherwise with a link to
 * sign in.
 */
type SignupStep = 'details' | 'password' | 'code' | 'done'
type DetailsField = 'firstName' | 'lastName' | 'email' | 'phone' | 'gender' | 'hospitalCurrentlyUsing'
type Field = DetailsField | 'password' | 'code'
type FieldErrors = Partial<Record<Field, string>>

const DETAILS_ORDER: readonly DetailsField[] = ['firstName', 'lastName', 'email', 'phone', 'gender', 'hospitalCurrentlyUsing']
const PASSWORD_ORDER: readonly Field[] = ['password']

const GENDER_LABELS: Record<SignupGender, string> = { female: 'Female', male: 'Male', other: 'Other' }

export const SIGNUP_PROBLEMS: Record<DetailsField, string> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter your email address, like name@example.com.',
  phone: 'Enter your phone number, like 0801 234 5678 for Nigeria. Or start with + and the country code.',
  gender: 'Select your gender.',
  hospitalCurrentlyUsing: 'Check the name of the hospital you currently use.',
}
export const PASSWORD_RULE = 'Choose a password of at least 12 characters.'
/** 409 PATIENT_EMAIL_ALREADY_REGISTERED; shown with a link to sign in. */
export const EMAIL_TAKEN = 'This email address already has a Health ID account.'
/** 409 PATIENT_PHONE_ALREADY_REGISTERED. */
export const PHONE_TAKEN = 'This phone number already has a Health ID account. Sign in instead, or use another phone number.'
const CODE_REFUSED = 'That code is wrong or too old. Check the latest email, or send a new code.'
const CHECK_DETAILS = 'Some details need checking. They are marked below.'
/** 404 ENROLLMENT_NOT_FOUND after the details were sent: the sign-up's cookie expired or was ended here. */
export const SIGNUP_ENDED = 'This sign-up is no longer open on this device. It may have timed out, or someone signed in or out on this device. Check your details and continue to start again.'
const GOOGLE_FILLED = 'Google details added. Check them and complete the form to continue.'
const GOOGLE_UNREAD = 'We couldn’t get your details from Google. Enter them below.'
const resendWaitText = (seconds: number) => `A code was sent recently. You can ask for a new code in ${seconds} seconds.`
/** Identity's field names in a 400 VALIDATION_FAILED, to the fields of the details step. */
const SERVER_FIELDS: Readonly<Record<string, DetailsField>> = {
  firstName: 'firstName', lastName: 'lastName', email: 'email', phone: 'phone', gender: 'gender',
  hospitalCurrentlyUsing: 'hospitalCurrentlyUsing',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const enrollmentEnded = (reason: unknown) => refusedWith(reason, 404, 'ENROLLMENT_NOT_FOUND')

interface Details {
  firstName: string
  lastName: string
  email: string
  phone: string
  /**
   * The country chosen for the phone number (phoneCountries.ts), Nigeria at first: since hid-1.0 parity B2 (owner
   * decision 2026-10-28) a number of any country is taken, sent as E.164.
   */
  phoneCountry: string
  gender: SignupGender | ''
  hospitalCurrentlyUsing: string
}
const EMPTY_DETAILS: Details = {
  firstName: '', lastName: '', email: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY, gender: '', hospitalCurrentlyUsing: '',
}

function detailsProblems(details: Details): FieldErrors {
  const problems: FieldErrors = {}
  if (!details.firstName.trim()) problems.firstName = SIGNUP_PROBLEMS.firstName
  if (!details.lastName.trim()) problems.lastName = SIGNUP_PROBLEMS.lastName
  if (!EMAIL_PATTERN.test(details.email.trim())) problems.email = SIGNUP_PROBLEMS.email
  if (internationalPhone(details.phone, details.phoneCountry) === null) problems.phone = SIGNUP_PROBLEMS.phone
  if (!details.gender) problems.gender = SIGNUP_PROBLEMS.gender
  return problems
}

function passwordProblems(password: string): FieldErrors {
  const problems: FieldErrors = {}
  if (password.length < 12 || password.length > 256) problems.password = PASSWORD_RULE
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

export function PatientSignup({ focusOnArrival = false, initialEmail = '', signedInByActivation, onProceed }: {
  /** Focus goes to the first field as the sign-up is shown: it replaced the control that was used. */
  focusOnArrival?: boolean
  /** The email typed at sign-in, when its "Finish creating your Health ID" opened the sign-up (SignIn.tsx). */
  initialEmail?: string
  /** Whether the activation signed the patient in here, its session taken up (Enrollment.tsx, which holds the page). */
  signedInByActivation: (activation: EnrollmentActivation) => Promise<boolean>
  /** "Proceed to profile", once signed in. */
  onProceed: () => void
}) {
  const { api, acceptGoogleSession } = useSession()
  const navigate = useNavigate()
  const stepFocus = useStepFocus()
  const { focus } = stepFocus
  useLayoutEffect(() => { if (focusOnArrival) focus() }, [focusOnArrival, focus])
  const resend = useResendWait()
  const [step, setStep] = useState<SignupStep>('details')
  const [details, setDetails] = useState<Details>(() => ({ ...EMPTY_DETAILS, email: initialEmail }))
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [maskedContact, setMaskedContact] = useState('')
  const [resendWaitSeconds, setResendWaitSeconds] = useState(0)
  // The email is proved (set_password): what is left is activation, with no new sign-up or security check.
  const [verified, setVerified] = useState(false)
  const [hidCode, setHidCode] = useState('')
  // The activation signed the patient in on this device, and the session was taken up.
  const [signedIn, setSignedIn] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  // An error is an alert when focus does not move to what it describes (PA-02): sent with Enter in a field.
  const [errorAlert, setErrorAlert] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  // Google on the sign-up asks Identity first (intent `enroll`), with its own security check ('patient-login'): a
  // Google email that already has a Health ID is told to sign in instead.
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [googleResetKey, setGoogleResetKey] = useState(0)
  const [accountExists, setAccountExists] = useState<ExistingAccount | null>(null)
  // The three boxes, on the password step: the last before the account is made. termsAccepted is sent only once both
  // required boxes are ticked (the sign-up is not sent before), and the boxes are recorded once the patient is signed in.
  const consent = usePatientConsent()

  /** A field's error goes once it is changed. */
  const dropError = (field: Field) => setFieldErrors(current => {
    if (!current[field]) return current
    const rest = { ...current }
    delete rest[field]
    return rest
  })
  const update = <K extends keyof Details>(field: K, value: Details[K]) => {
    setDetails(current => ({ ...current, [field]: value }))
    // The country is part of the phone number: its error goes with it.
    dropError(field === 'phoneCountry' ? 'phone' : field as Exclude<K, 'phoneCountry'>)
  }
  const clearMessages = () => { setFieldErrors({}); setError(null); setErrorAlert(true); setNotice(null); setAccountExists(null) }
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
    // Taken up before the Health ID is shown, as sign-in takes up its session; never a refusal of the activation.
    const signedInHere = await signedInByActivation(result)
    if (signedInHere) recordQuietly(() => api.recordConsents(patientConsentRecord(consent.checked), crypto.randomUUID()))
    setPassword(''); setCode('')
    setSignedIn(signedInHere); setHidCode(result.hidCode); setStep('done')
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
    sayRefusal(reason, 'We couldn’t create your account just now. Try again.')
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy) return
    // Typed once, with Show to check it (the review of 2026-10-31): there is no second field to match.
    const problems = passwordProblems(password)
    // The boxes are checked with the password; focus goes to the password first, then to the first box missing.
    const missing = consent.check(!problems.password)
    if (Object.keys(problems).length) {
      setNotice(null); setFieldErrors(problems); setError(fromField ? problems.password ?? null : null); setErrorAlert(true)
      stepFocus.focus()
      return
    }
    if (missing.length) { setNotice(null); setFieldErrors({}); setError(null); return }
    if (!verified && !turnstileToken) return
    setBusy(true); clearMessages()
    try {
      if (verified) { await activate(); return }
      const input: EnrollmentSignupDetails = {
        firstName: details.firstName.trim(), lastName: details.lastName.trim(), email: details.email.trim(),
        phone: internationalPhone(details.phone, details.phoneCountry) ?? details.phone, gender: details.gender as SignupGender,
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
      sayRefusal(reason, 'We couldn’t start your sign-up just now. Try again.')
    } finally {
      // Each security check is used once: a new one is needed for another attempt.
      setTurnstileToken(null); setResetKey(value => value + 1); setBusy(false); stepFocus.focus()
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy || !challengeId || !codeComplete(code)) return
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
      } else sayRefusal(reason, 'We couldn’t check the code just now. Try again.')
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
      } else sayRefusal(reason, 'We couldn’t send a new code just now. Try again.')
    } finally { setBusy(false); stepFocus.focus() }
  }

  /** Fills in the name and email from a Google credential (as hid-1.0's prefillSignupWithGoogle). */
  const fillFrom = (idToken: string) => {
    const google = googleProfileOf(idToken)
    if (!google || (!google.firstName && !google.lastName && !google.email)) { setNotice(null); sayError(GOOGLE_UNREAD); return }
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
  }

  /**
   * "Continue with Google": Identity is asked first (intent `enroll`). A Google account already linked signs in, as on
   * the sign-in page; one whose email already has a Health ID is told to sign in with Google instead (409
   * GOOGLE_ACCOUNT_EXISTS, owner decision 2026-10-28). Otherwise the name and email are filled in from the credential,
   * for the patient to check, and the sign-up goes on as before; they are filled in too when Identity could not be
   * asked, since the email is proved with a code anyway.
   */
  const continueWithGoogle = async (idToken: string): Promise<void> => {
    if (!googleToken || busy) return
    setBusy(true); clearMessages()
    try {
      const result = await api.googleExchange(idToken, googleToken, 'enroll')
      if ('actor' in result) { acceptGoogleSession(result); navigate('/', { replace: true }); return }
      fillFrom(idToken)
    } catch (reason) {
      const existing = existingAccount(reason)
      if (existing) setAccountExists(existing)
      else fillFrom(idToken)
    } finally { setGoogleToken(null); setGoogleResetKey(value => value + 1); setBusy(false) }
  }

  const invalid = (field: Field) => fieldErrors[field] ? true as const : undefined
  const errorId = (field: Field) => fieldErrors[field] ? `signup-${field}-error` : undefined
  const fieldError = (field: Field) => fieldErrors[field] ? <>
    {fieldErrors[field]}{field === 'email' && fieldErrors.email === EMAIL_TAKEN && <> <Link to="/sign-in">Sign in instead.</Link></>}
  </> : undefined
  const detailsFocus = firstOf(DETAILS_ORDER, fieldErrors) ?? 'firstName'
  const passwordFocus = firstOf(PASSWORD_ORDER, fieldErrors) ?? 'password'
  const target = (field: Field, focusOn: Field) => field === focusOn ? stepFocus.target : undefined
  const steps = step === 'done' ? undefined : ([['Your details', 'details'], ['Password', 'password'], ['Email code', 'code']] as const)
    .map(([label, at]) => ({ label, current: step === at }))
  const googleOffered = Boolean(googleClientId()) && step === 'details'
  // Each step's heading names its form for a screen reader; on screen the stepper above the title already says it.
  const stepTitle = 'sr-only'

  return <AuthLayout brandTo="/" title={step === 'done' ? null : 'Create your Health ID'} titleId="enroll-title"
    panelLabelledBy={step === 'done' ? 'enroll-title' : undefined}
    steps={steps} stepsLabel="Sign-up steps">
    <div className="flex flex-col gap-5">
    {error && <Alert intent="error" id="signup-error" live={errorAlert}>{error}</Alert>}
    {/* Kept mounted, so a notice is a change of a live region, not a new one. */}
    <div role="status" className="empty:hidden">{notice && <Alert intent="success" size="sm" live={false}>{notice}</Alert>}</div>

    {/* Google first: one tap fills the name and email. */}
    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleOffered && <section className="flex flex-col gap-3" aria-label="Google sign-up">
      {accountExists && <ExistingAccountAlert account={accountExists} />}
      <Turnstile action="patient-login" onTokenChange={setGoogleToken} resetKey={googleResetKey} />
      <GoogleButton text="continue_with" disabled={busy || !googleToken} onCredential={continueWithGoogle}
        disabledReason={googleToken ? undefined : 'Complete the security check to continue with Google.'} />
      <p className="m-0 flex items-center gap-3 text-[13px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or fill in your details</p>
    </section>}

    {step === 'details' && <form onSubmit={submitDetails} className="flex flex-col gap-4" noValidate aria-labelledby="signup-details-title">
      <h2 id="signup-details-title" className={stepTitle}>Your details</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="signup-firstName" errorId={errorId('firstName')} error={fieldError('firstName')}>
          <InputR id="signup-firstName" ref={target('firstName', detailsFocus)} required autoComplete="given-name" maxLength={100} value={details.firstName}
            onChange={event => update('firstName', event.target.value)} aria-invalid={invalid('firstName')} aria-describedby={errorId('firstName')} /></Field>
        <Field label="Last name" htmlFor="signup-lastName" errorId={errorId('lastName')} error={fieldError('lastName')}>
          <InputR id="signup-lastName" ref={target('lastName', detailsFocus)} required autoComplete="family-name" maxLength={100} value={details.lastName}
            onChange={event => update('lastName', event.target.value)} aria-invalid={invalid('lastName')} aria-describedby={errorId('lastName')} /></Field>
      </div>
      <Field label="Email address" htmlFor="signup-email" hintId="signup-email-hint" hint="We’ll send a 6-digit code here."
        errorId={errorId('email')} error={fieldError('email')}>
        <InputR id="signup-email" ref={target('email', detailsFocus)} required type="email" autoComplete="email" maxLength={254} value={details.email}
          onChange={event => update('email', event.target.value)} aria-invalid={invalid('email')}
          aria-describedby={describedBy('signup-email-hint', errorId('email'))} /></Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
        <Field label="Country" htmlFor="signup-phone-country">
          <Select id="signup-phone-country" autoComplete="tel-country-code" value={details.phoneCountry} onChange={event => update('phoneCountry', event.target.value)}>
            {PHONE_COUNTRIES.map(country => <option key={country.iso} value={country.iso}>{country.name} (+{country.code})</option>)}
          </Select></Field>
        <Field label="Phone number" htmlFor="signup-phone" hintId="signup-phone-hint" hint="Like 0803 123 4567." errorId={errorId('phone')} error={fieldError('phone')}>
          <InputR id="signup-phone" ref={target('phone', detailsFocus)} required type="tel" inputMode="tel" autoComplete="tel-national" maxLength={24} value={details.phone}
            onChange={event => update('phone', event.target.value.replace(/[^\d+\s().-]/g, ''))} aria-invalid={invalid('phone')}
            aria-describedby={describedBy('signup-phone-hint', errorId('phone'))} /></Field>
      </div>
      <Field label="Gender" htmlFor="signup-gender" errorId={errorId('gender')} error={fieldError('gender')}>
        <SelectR id="signup-gender" ref={target('gender', detailsFocus)} required value={details.gender} onChange={event => update('gender', event.target.value as SignupGender | '')}
          aria-invalid={invalid('gender')} aria-describedby={errorId('gender')}>
          <option value="">Select…</option>
          {SIGNUP_GENDERS.map(value => <option key={value} value={value}>{GENDER_LABELS[value]}</option>)}
        </SelectR></Field>
      <Field label="Hospital you use" optional htmlFor="signup-hospital" errorId={errorId('hospitalCurrentlyUsing')} error={fieldError('hospitalCurrentlyUsing')}>
        <HospitalPicker id="signup-hospital" inputRef={target('hospitalCurrentlyUsing', detailsFocus)} value={details.hospitalCurrentlyUsing}
          onChange={value => update('hospitalCurrentlyUsing', value)}
          invalid={invalid('hospitalCurrentlyUsing')} describedBy={errorId('hospitalCurrentlyUsing')} /></Field>
      <Hint>You can add your NIN (National Identification Number) later, from your profile.</Hint>
      <Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button>
    </form>}

    {step === 'password' && <form onSubmit={event => void submitPassword(event)} className="flex flex-col gap-4" noValidate aria-labelledby="signup-password-title">
      <h2 id="signup-password-title" className={stepTitle}>Create a password</h2>
      {verified && <Hint>Your email is confirmed. Create your account to get your Health ID.</Hint>}
      <Field label="Password" htmlFor="signup-password" errorId={errorId('password')} error={fieldError('password')}>
        <PasswordInput id="signup-password" ref={target('password', passwordFocus)} required autoComplete="new-password" minLength={12} maxLength={256} value={password}
          onChange={event => { setPassword(event.target.value); dropError('password') }}
          aria-invalid={invalid('password')} aria-describedby={describedBy('signup-password-hint', errorId('password'))} />
        <PasswordRules id="signup-password-hint" password={password} /></Field>
      <ConsentChecks idPrefix="signup-consent" summary={PATIENT_TERMS} items={PATIENT_CONSENT_ITEMS} checked={consent.checked}
        onChange={consent.onChange} errors={consent.errors} focusRequest={consent.focusRequest} />
      {!verified && <Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />}
      {!verified && !turnstileToken && <Hint id="signup-check-needed">Complete the security check to continue.</Hint>}
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || (!verified && !turnstileToken)}
        aria-describedby={!verified && !turnstileToken ? 'signup-check-needed' : undefined}>{busy ? 'Creating account…' : 'Create account'}</Button>
      {!verified && <Button variant="link" className="self-start" disabled={busy}
        onClick={() => { clearMessages(); setStep('details'); stepFocus.focus() }}>Back</Button>}
    </form>}

    {step === 'code' && <form onSubmit={event => void submitCode(event)} className="flex flex-col gap-4" aria-labelledby="signup-code-title">
      <h2 id="signup-code-title" className={stepTitle}>Enter the code</h2>
      <p id="signup-code-hint" className="m-0 text-sm text-ink-2">We sent a 6-digit code to {maskedContact || 'your email address'}.</p>
      <CodeBoxes id="signup-code" label="Code" value={code} onChange={value => { setCode(value); setFieldErrors({}) }}
        inputRef={stepFocus.target} busy={busy} invalid={invalid('code')} describedBy={describedBy('signup-code-hint', errorId('code'))} />
      {fieldErrors.code && <p id="signup-code-error" className="m-0 text-xs font-medium text-danger-ink">{fieldErrors.code}</p>}
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Check code'}</Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" disabled={busy || !resend.ready} onClick={() => void sendCodeAgain()}
          aria-describedby={resend.ready ? undefined : 'signup-resend-wait'}>Send code again</Button>
        <Button variant="link" disabled={busy}
          onClick={() => { clearMessages(); backToDetails(); stepFocus.focus() }}>Change your details</Button>
      </div>
      {!resend.ready && <Hint id="signup-resend-wait">You can ask for a new code in {resendWaitSeconds} seconds.</Hint>}
    </form>}

    {step === 'done' && <Complete focusTarget={stepFocus.target} hidCode={hidCode} signedIn={signedIn} onProceed={onProceed} />}

    {step !== 'done' && <p className="m-0 text-center text-sm text-ink-2">Already have a Health ID? <Link to="/sign-in" className="font-medium text-brand-ink">Sign in</Link></p>}
    </div>
  </AuthLayout>
}
