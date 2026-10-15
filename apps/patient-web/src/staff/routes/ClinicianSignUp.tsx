import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Field, Input } from '@hid/ui'
import { useDocumentTitle } from '../../authSteps'
import { CLINICIAN_SIGNUP_PATH, CLINICIAN_STATUS_PATH, STAFF_RECOVERY_PATH, clinicianMainSiteHref } from '../../productHostname'
import { CLINICIAN_REGULATOR_OF, clinicianApplicationApi, newClinicianIdempotencyKey, type ClinicianSignUp as SignUpInput,
  type ClinicianSubmitted } from '../clinicianApplicationApi'
import { ClinicianAuthenticator } from '../clinician/ClinicianAuthenticator'
import { Declarations, DetailsFields, EMPTY_DETAILS, applicationDetails, declarationProblems, detailsProblems,
  type DetailsValue } from '../clinician/ClinicianDetails'
import { EmailCode } from '../clinician/EmailCode'
import { FACILITY_UNAVAILABLE, PROFESSION_NAME, REGULATOR_NAME, codeOf, codeSentCopy,
  formatDate, isUnavailable, refusalCopy } from '../clinician/copy'
import { ClinicianFrame, ErrorSummary, MainSiteOnly, PrimaryButton, StepError, StepHeading, TextButton, fieldError, shownError,
  type Problem } from '../clinician/ui'

/**
 * Clinician self sign-up at /provider/join (hid-system ADR-064, owner decision
 * 2): a doctor or nurse proves a work email with a code, gives their name,
 * licence and facility, chooses a password, and sets up an authenticator
 * before two HID administrators review the application. Identity creates the
 * account with no role and no session; the page never says the application
 * is verified or approved. What is typed lives in this page's state only, the
 * password until each submit, and nothing identifying goes into the address.
 * The capability Identity sets is an httpOnly cookie the page never reads.
 */

type Step = 'email' | 'code' | 'details' | 'password' | 'authenticator' | 'done'
const STEPS: ReadonlyArray<readonly [Step, string]> = [['email', 'Email'], ['code', 'Code'], ['details', 'Your details'],
  ['password', 'Password'], ['authenticator', 'Authenticator'], ['done', 'Done']]
const label = (step: Step) => STEPS.find(([name]) => name === step)![1]

/** Another screen in place of the step: the address has an account, the email proof expired, or the page closed. */
type Screen = 'steps' | 'in-use' | 'expired' | 'ended'

const KEPT = 'Your details are still here; try again later.'
/** A refused submit's own words, where they differ from any step's. */
const SUBMIT_REFUSAL: Readonly<Record<string, string>> = {
  PASSWORD_INVALID: 'Choose a password of 12 to 256 characters.',
  PLATFORM_MAINTENANCE: `Health ID is under maintenance. ${KEPT}`,
  CLINICIAN_SIGNUP_CLOSED: `New clinician applications aren't open right now. ${KEPT}`,
}

export function ClinicianSignUp() {
  const mainSite = clinicianMainSiteHref(window.location.hostname, CLINICIAN_SIGNUP_PATH)
  return mainSite ? <MainSiteOnly href={mainSite} path={CLINICIAN_SIGNUP_PATH} /> : <SignUp />
}

function SignUp() {
  const [availability, setAvailability] = useState<'loading' | 'open' | 'closed' | 'failed'>('loading')
  const [checks, setChecks] = useState(0)
  const [step, setStep] = useState<Step>('email')
  const [screen, setScreen] = useState<Screen>('steps')
  // Whether the page has moved from its first step: from then on each step's heading takes focus.
  const [moved, setMoved] = useState(false)
  const [emailRound, setEmailRound] = useState(0)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [summaryKey, setSummaryKey] = useState(0)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [details, setDetails] = useState<DetailsValue>(EMPTY_DETAILS)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accurate, setAccurate] = useState(false)
  const [consent, setConsent] = useState(false)
  const [submitted, setSubmitted] = useState<ClinicianSubmitted | null>(null)
  // One key per submission, reused only when the same submission is sent again (never stored).
  const submission = useRef<{ key: string; fingerprint: string } | null>(null)

  useDocumentTitle(availability === 'loading' ? 'Clinician sign-up · Health ID Provider'
    : availability !== 'open' ? "Clinician sign-up isn't open yet · Health ID Provider"
      : `Clinician sign-up – ${label(step)} · Health ID Provider`)

  useEffect(() => {
    let active = true
    setAvailability('loading')
    clinicianApplicationApi.availability().then(
      answer => { if (active) setAvailability(answer.open ? 'open' : 'closed') },
      (caught: unknown) => { if (active) setAvailability(isUnavailable(caught) ? 'failed' : 'closed') })
    return () => { active = false }
  }, [checks])

  function goTo(next: Step, carried: string | null = null) {
    setStep(next)
    setScreen('steps')
    setMoved(true)
    setError(carried ? shownError(carried) : null)
    setProblems([])
    setPassword('')
    setConfirm('')
  }

  function show(next: Screen) {
    setScreen(next)
    setMoved(true)
    setPassword('')
    setConfirm('')
  }

  function emailRefused(caught: unknown, call: 'send' | 'verify'): string | null {
    const code = codeOf(caught)
    if (code === 'CLINICIAN_SIGNUP_CLOSED') { setAvailability('closed'); return null }
    if (call === 'verify' && code === 'CLINICIAN_EMAIL_IN_USE') { show('in-use'); return null }
    return refusalCopy(caught, call === 'send' ? "We couldn't send a code right now. Try again in a few minutes."
      : "We couldn't check the code right now. Try again.", 'Too many sign-up attempts from your network. Try again later.')
  }

  function searchRefused(caught: unknown): boolean {
    if (codeOf(caught) !== 'CLINICIAN_APPLICATION_SESSION_INVALID') return false
    show('expired')
    return true
  }

  function continueDetails(event: FormEvent) {
    event.preventDefault()
    const refused = detailsProblems(details, fullName)
    if (refused.length > 0) { setProblems(refused); setSummaryKey(value => value + 1); return }
    goTo('password')
  }

  /** The submission's key: the same while the same details are sent again, a new one once they change. */
  function keyFor(input: SignUpInput): string {
    const { password: _password, ...sent } = input
    const fingerprint = JSON.stringify(sent)
    if (submission.current?.fingerprint !== fingerprint) submission.current = { key: newClinicianIdempotencyKey(), fingerprint }
    return submission.current.key
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const refused = [...passwordProblems(password, confirm), ...declarationProblems(accurate, consent)]
    if (refused.length > 0) { setProblems(refused); setSummaryKey(value => value + 1); return }
    const input: SignUpInput = { email, fullName: fullName.trim().replace(/\s+/g, ' '), password, ...applicationDetails(details) }
    const key = keyFor(input)
    setBusy(true)
    setError(null)
    setProblems([])
    try {
      const answer = await clinicianApplicationApi.submit(input, key)
      submission.current = null
      setSubmitted(answer)
      goTo('authenticator')
    } catch (caught) {
      // The password is typed again for each attempt; everything else stays.
      setPassword('')
      setConfirm('')
      submitRefused(caught)
    } finally {
      setBusy(false)
    }
  }

  function submitRefused(caught: unknown) {
    switch (codeOf(caught)) {
      case 'CLINICIAN_APPLICATION_SESSION_INVALID': show('expired'); return
      case 'CLINICIAN_EMAIL_IN_USE': show('in-use'); return
      case 'CLINICIAN_APPLICATION_FACILITY_UNAVAILABLE':
        setDetails(value => ({ ...value, facility: null }))
        goTo('details', FACILITY_UNAVAILABLE)
        return
      case 'CLINICIAN_APPLICATION_INVALID':
      case 'VALIDATION_FAILED':
        goTo('details', "Some details weren't accepted. Check that your licence number is as on your licence and that the licence is "
          + 'valid after today and for at most five more years.')
        return
      case 'IDEMPOTENCY_CONFLICT':
        submission.current = null
        setError(shownError('Your details changed since your last attempt. Submit again to send them.'))
        return
    }
    const code = codeOf(caught)
    setError(shownError((code && Object.hasOwn(SUBMIT_REFUSAL, code) ? SUBMIT_REFUSAL[code] : undefined)
      ?? refusalCopy(caught, "We couldn't submit your application right now. Your details are still here; try again.",
        'Too many applications were sent from your network. Try again later.')))
  }

  function differentEmail() {
    setEmail('')
    setEmailRound(value => value + 1)
    goTo('email')
  }

  function confirmEmailAgain() {
    setEmailRound(value => value + 1)
    goTo('email')
  }

  if (availability === 'loading') {
    return <ClinicianFrame><p role="status" className="patient-page-copy">Checking whether clinician sign-up is open…</p></ClinicianFrame>
  }
  if (availability !== 'open') {
    return <ClinicianFrame labelledBy="clinician-signup-title">
      <h1 id="clinician-signup-title" className="patient-page-title">Clinician sign-up isn't open yet</h1>
      <p className="patient-page-copy">You can't apply as a clinician on Health ID yet. If you already have a provider account, sign in.</p>
      {availability === 'failed' && <div className="clinician-panel">
        <p role="alert" className="patient-inline-error">We couldn't check right now.</p>
        <PrimaryButton onClick={() => setChecks(value => value + 1)}>Retry</PrimaryButton>
      </div>}
      <ul className="clinician-links clinician-panel">
        <li><Link to="/provider/sign-in">Sign in</Link></li>
        <li><Link to={CLINICIAN_STATUS_PATH}>Check an application</Link></li>
      </ul>
    </ClinicianFrame>
  }

  const regulator = details.profession ? REGULATOR_NAME[CLINICIAN_REGULATOR_OF[details.profession]] : 'your regulator'
  const facilityName = details.facility?.name ?? 'your facility'

  return <ClinicianFrame labelledBy="clinician-signup-title">
    <h1 id="clinician-signup-title" className="patient-page-title">Apply as a doctor or nurse</h1>
    <p className="patient-page-copy">Apply to work as a doctor or nurse on Health ID. You'll set up an authenticator app as part of
      applying. An HID administrator will check your licence and call you to confirm it's you, and a second administrator must approve
      before your access is turned on. A facility administrator account can't also hold a clinical role at the same facility; use a
      separate email address.</p>

    <ol className="patient-step-list clinician-steps" aria-label="Clinician sign-up steps">
      {STEPS.map(([name, text]) => <li key={name} aria-current={name === step ? 'step' : undefined}>{text}</li>)}
    </ol>

    {screen === 'in-use' && <section className="clinician-panel" aria-labelledby="clinician-in-use-title">
      <StepHeading id="clinician-in-use-title" focus>Use a different email address</StepHeading>
      <p role="alert">This email address already has a Health ID account.</p>
      <p>Clinician accounts need their own address. If you're a facility administrator or a patient on Health ID, apply with a
        different email.</p>
      <ul className="clinician-links">
        <li><Link to="/provider/sign-in">Sign in</Link></li>
        <li><Link to={STAFF_RECOVERY_PATH}>Forgot your password?</Link></li>
        <li><Link to={CLINICIAN_STATUS_PATH}>Check an application</Link></li>
      </ul>
      <div><PrimaryButton onClick={differentEmail}>Use a different email address</PrimaryButton></div>
    </section>}

    {screen === 'expired' && <section className="clinician-panel" aria-labelledby="clinician-expired-title">
      <StepHeading id="clinician-expired-title" focus>Confirm your email again</StepHeading>
      <p role="alert">Your email confirmation expired. If you already submitted, check your application status; otherwise confirm your
        email again. Your other details are kept on this page.</p>
      <div className="clinician-actions">
        <PrimaryButton onClick={confirmEmailAgain}>Confirm email again</PrimaryButton>
        <Link className="patient-secondary-button" to={CLINICIAN_STATUS_PATH}>Check application status</Link>
      </div>
    </section>}

    {screen === 'ended' && <section className="clinician-panel" aria-labelledby="clinician-ended-title">
      <StepHeading id="clinician-ended-title" focus>This page has closed</StepHeading>
      <p>For your security, this page closed after 30 minutes. Your application is saved: check your application to finish setting up
        your authenticator. HID can't review it until you do.</p>
      <div><Link className="patient-primary-button" to={CLINICIAN_STATUS_PATH}>Check your application</Link></div>
    </section>}

    {screen === 'steps' && (step === 'email' || step === 'code') && <EmailCode key={emailRound} idPrefix="clinician-signup"
      action="clinician-application" email={email} onEmail={setEmail} focusFirst={moved}
      copy={{ emailHeading: 'Your work email', codeInvalid: 'That code is wrong or has expired. Check your latest email or send a new code.',
        sent: codeSentCopy,
        emailIntro: <p className="patient-field-hint">We'll send a 6-digit code to confirm it. Use an address only you can read: it becomes
          your provider sign-in.</p> }}
      send={clinicianApplicationApi.sendCode} verify={clinicianApplicationApi.verifyCode} refused={emailRefused}
      onStage={stage => { setStep(stage); setMoved(true) }} onVerified={() => goTo('details')} />}

    {screen === 'steps' && step === 'details' && <form className="patient-form" aria-labelledby="clinician-details-title" noValidate
      onSubmit={continueDetails}>
      <StepHeading id="clinician-details-title" focus>Your details</StepHeading>
      <p className="patient-field-hint">All fields are required. Give them exactly as they are on your practising licence.</p>
      <StepError error={error} />
      <ErrorSummary problems={problems} focusKey={summaryKey} />
      <DetailsFields value={details} onChange={setDetails} problems={problems} fullName={fullName} onFullName={setFullName}
        onSearchRefused={searchRefused} />
      <button type="submit" className="patient-primary-button">Continue</button>
    </form>}

    {screen === 'steps' && step === 'password' && <form className="patient-form" aria-labelledby="clinician-password-title" noValidate
      aria-busy={busy} onSubmit={event => void submit(event)}>
      <StepHeading id="clinician-password-title" focus>Password and declarations</StepHeading>
      <p className="patient-field-hint">Choose the password you'll sign in with once your access is turned on. All fields are required.</p>
      <StepError error={error} />
      <ErrorSummary problems={problems} focusKey={summaryKey} />
      <Field label="Password" htmlFor="clinician-password" hint="At least 12 characters." error={fieldError(problems, 'clinician-password')} required>
        <Input id="clinician-password" type="password" autoComplete="new-password" maxLength={256} value={password}
          onChange={event => setPassword(event.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="clinician-password-confirm" error={fieldError(problems, 'clinician-password-confirm')} required>
        <Input id="clinician-password-confirm" type="password" autoComplete="new-password" maxLength={256} value={confirm}
          onChange={event => setConfirm(event.target.value)} />
      </Field>
      <Declarations accurate={accurate} consent={consent} onAccurate={setAccurate} onConsent={setConsent} regulator={regulator}
        facility={facilityName} problems={problems} />
      <div className="clinician-actions">
        <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
        <TextButton onClick={() => goTo('details')} disabled={busy}>Back</TextButton>
      </div>
    </form>}

    {screen === 'steps' && step === 'authenticator' && submitted && <ClinicianAuthenticator
      start={submitted.authenticator ? (submitted.authenticator.purpose === 'verify' ? 'verify' : 'enrol') : 'reopen'}
      context="signup" email={email} doneLabel="Continue to your application"
      onReady={() => goTo('done')} onEnded={() => show('ended')} />}

    {screen === 'steps' && step === 'done' && submitted && <section className="patient-success" aria-labelledby="clinician-done-title">
      <StepHeading id="clinician-done-title" focus>Application submitted</StepHeading>
      <dl className="clinician-facts">
        <dt>Facility</dt><dd>{submitted.facility.name}</dd>
        <dt>Profession</dt><dd>{PROFESSION_NAME[submitted.profession] ?? submitted.profession}</dd>
        {formatDate(submitted.expiresAt) && <><dt>Kept open until</dt><dd>{formatDate(submitted.expiresAt)}</dd></>}
      </dl>
      <p className="patient-page-copy">Your application is in HID's verification queue. An HID administrator will contact you for a short
        video call: have your photo ID and your authenticator app ready. A second administrator must approve before you can sign in to
        the provider portal. We keep applications open for 30 days.</p>
      <div><Link className="patient-primary-button" to={CLINICIAN_STATUS_PATH}>View application status</Link></div>
    </section>}

    <p className="patient-auth-footer">Already applied? <Link to={CLINICIAN_STATUS_PATH}>Check an application's status</Link>.
      {' '}Have provider access? <Link to="/provider/sign-in">Sign in to the provider portal</Link>.</p>
  </ClinicianFrame>
}

function passwordProblems(password: string, confirm: string): Problem[] {
  const problems: Problem[] = []
  if (password.length < 12 || password.length > 256) problems.push({ field: 'clinician-password', message: 'Choose a password of at least 12 characters.' })
  if (confirm !== password || !confirm) problems.push({ field: 'clinician-password-confirm', message: 'Type the same password again.' })
  return problems
}
