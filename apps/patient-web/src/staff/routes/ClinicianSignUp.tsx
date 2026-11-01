import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Field, PasswordInput } from '@hid/ui'
import { PasswordRules } from '../../PasswordRules'
import { useDocumentTitle } from '../../authSteps'
import { CLINICIAN_SIGNUP_PATH, CLINICIAN_STATUS_PATH, STAFF_RECOVERY_PATH, clinicianMainSiteHref } from '../../productHostname'
import { servesClinicianApplications } from '../../backendContract'
import { CLINICIAN_REGULATOR_OF, clinicianApplicationApi, newClinicianIdempotencyKey, type ClinicianSignUp as SignUpInput,
  type ClinicianSubmitted } from '../clinicianApplicationApi'
import { ClinicianAuthenticator } from '../clinician/ClinicianAuthenticator'
import { Declarations, DetailsFields, EMPTY_DETAILS, applicationDetails, declarationProblems, detailsProblems,
  type DetailsValue } from '../clinician/ClinicianDetails'
import { EmailCode } from '../clinician/EmailCode'
import { APPLICATIONS_LIMITED, FACILITY_UNAVAILABLE, PROFESSION_NAME, REGULATOR_NAME, SIGNUP_CLOSED, SIGNUP_CLOSED_KEPT,
  SIGNUP_SEARCHES_USED, codeOf, codeSentCopy, formatDate, isUnavailable, refusalCopy } from '../clinician/copy'
import { AuthStepper } from '../../AuthLayout'
import { ClinicianFrame, ErrorSummary, MainSiteOnly, PrimaryButton, StepError, StepHeading, TextButton, fieldError, shownError,
  type Problem } from '../clinician/ui'
import { buttonClass } from '../../kasuwa/ui'

/**
 * Clinician self sign-up at /provider/join (hid-system ADR-066, owner decision
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
  ['password', 'Password'], ['authenticator', 'Sign-in codes'], ['done', 'Done']]
const label = (step: Step) => STEPS.find(([name]) => name === step)![1]

/** Another screen in place of the step: the address has an account, the email proof expired, or the page closed. */
type Screen = 'steps' | 'in-use' | 'expired' | 'ended'

const KEPT = 'Your details are still here; try again later.'
/** A refused submit's own words, where they differ from any step's. */
const SUBMIT_REFUSAL: Readonly<Record<string, string>> = {
  PASSWORD_INVALID: 'Choose a password of 12 to 256 characters.',
  PLATFORM_MAINTENANCE: `Health ID is under maintenance. ${KEPT}`,
  CLINICIAN_SIGNUP_CLOSED: SIGNUP_CLOSED_KEPT,
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
  // A control to focus once the page has drawn: the step stays after a refusal, and its button was disabled while busy.
  const [focusRequest, setFocusRequest] = useState<{ id: string; count: number } | null>(null)

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [details, setDetails] = useState<DetailsValue>(EMPTY_DETAILS)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accurate, setAccurate] = useState(false)
  const [consent, setConsent] = useState(false)
  const [submitted, setSubmitted] = useState<ClinicianSubmitted | null>(null)
  // The application page (Identity's capability cookie) once the application is submitted: open, being closed, or closed.
  const [pageState, setPageState] = useState<'open' | 'closing' | 'closed'>('open')
  const [closeError, setCloseError] = useState<{ id: number; message: string } | null>(null)
  // Once closed, an authenticator answer that arrives late changes nothing: the page stays closed.
  const closed = useRef(false)
  // One key per submission, reused only when the same submission is sent again (never stored).
  const submission = useRef<{ key: string; fingerprint: string } | null>(null)

  useDocumentTitle(availability === 'loading' ? 'Clinician sign-up · Health ID Provider'
    : availability !== 'open' ? 'Clinician sign-up is closed for now · Health ID Provider'
      : `Clinician sign-up – ${label(step)} · Health ID Provider`)

  // In the commit that shows the refusal, not an effect a task later: a check made as soon as it is shown finds the focus moved.
  useLayoutEffect(() => { if (focusRequest) document.getElementById(focusRequest.id)?.focus() }, [focusRequest])

  function focusOn(id: string) {
    setFocusRequest(previous => ({ id, count: (previous?.count ?? 0) + 1 }))
  }

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
    // Intake closed after the page opened: the not-open screen replaces the form, takes focus and says why.
    if (code === 'CLINICIAN_SIGNUP_CLOSED') { setAvailability('closed'); setMoved(true); return null }
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

  /**
   * The submission's key: the same while the same details and password are
   * sent again, a new one once either changes. Identity's request digest
   * leaves the password out, so a retry under the same key with another
   * password would replay the first submission and keep the first password;
   * a new key for a draft already used is refused instead (the email
   * confirmation screen). Only a digest of the password is kept, in memory.
   */
  async function keyFor(input: SignUpInput): Promise<string> {
    const { password, ...sent } = input
    const fingerprint = JSON.stringify({ ...sent, password: await passwordDigest(password) })
    if (submission.current?.fingerprint !== fingerprint) submission.current = { key: newClinicianIdempotencyKey(), fingerprint }
    return submission.current.key
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const refused = [...passwordProblems(password, confirm), ...declarationProblems(accurate, consent)]
    if (refused.length > 0) { setProblems(refused); setSummaryKey(value => value + 1); return }
    const input: SignUpInput = { email, fullName: fullName.trim().replace(/\s+/g, ' '), password, ...applicationDetails(details) }
    setBusy(true)
    setError(null)
    setProblems([])
    try {
      const answer = await clinicianApplicationApi.submit(input, await keyFor(input))
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
        // The step stays, with the password to type again.
        focusOn('clinician-password')
        return
    }
    const code = codeOf(caught)
    setError(shownError((code && Object.hasOwn(SUBMIT_REFUSAL, code) ? SUBMIT_REFUSAL[code] : undefined)
      ?? refusalCopy(caught, "We couldn't submit your application right now. Your details are still here; try again.",
        APPLICATIONS_LIMITED)))
    focusOn('clinician-password')
  }

  /**
   * Ends the application page on this device (P15), as the status page's
   * "Close this page" does: until then anyone at this browser could open the
   * applications without a code, for up to 30 minutes. Offered from the
   * authenticator step on, where an applicant without their phone may leave.
   */
  async function closePage() {
    if (pageState !== 'open') return
    setPageState('closing')
    setCloseError(null)
    try {
      await clinicianApplicationApi.endSession()
    } catch {
      setPageState('open')
      setCloseError(shownError("This page couldn't be closed right now. Try again."))
      focusOn('clinician-signup-close')
      return
    }
    closed.current = true
    setPageState('closed')
    focusOn('clinician-signup-closed')
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
      <StepHeading id="clinician-signup-title" level={1} focus={moved}>Clinician sign-up is closed for now</StepHeading>
      {moved && availability === 'closed' && <p role="alert" className="patient-inline-error">{SIGNUP_CLOSED}</p>}
      <p className="patient-page-copy">If you already have a provider account, sign in.</p>
      {availability === 'failed' && <div className="clinician-panel">
        <p role="alert" className="patient-inline-error">We couldn't check right now.</p>
        {/* The check replaces this screen, Retry with it: what is shown next (a step, or this screen again) takes focus. */}
        <PrimaryButton onClick={() => { setMoved(true); setChecks(value => value + 1) }}>Retry</PrimaryButton>
      </div>}
      <ul className="clinician-links clinician-panel">
        <li><Link to="/provider/sign-in">Sign in</Link></li>
        {servesClinicianApplications() && <li><Link to={CLINICIAN_STATUS_PATH}>Check an application</Link></li>}
      </ul>
    </ClinicianFrame>
  }

  const regulator = details.profession ? REGULATOR_NAME[CLINICIAN_REGULATOR_OF[details.profession]] : 'your regulator'
  const facilityName = details.facility?.name ?? 'your facility'

  return <ClinicianFrame labelledBy="clinician-signup-title">
    <AuthStepper label="Clinician sign-up steps" steps={STEPS.map(([name, text]) => ({ label: text, current: name === step }))} />
    <h1 id="clinician-signup-title" className="patient-page-title">Apply as a doctor or nurse</h1>
    <p className="patient-page-copy">Use your own email, not your facility’s admin account. We check your licence and call you to confirm it’s you.</p>

    {screen === 'in-use' && <section className="clinician-panel" aria-labelledby="clinician-in-use-title">
      <StepHeading id="clinician-in-use-title" focus>Use a different email address</StepHeading>
      <p role="alert">This email address already has a Health ID account.</p>
      <p>Clinician accounts need their own address. If you're a facility administrator or a patient on Health ID, apply with a
        different email.</p>
      <ul className="clinician-links">
        <li><Link to="/provider/sign-in">Sign in</Link></li>
        <li><Link to={STAFF_RECOVERY_PATH}>Forgot password?</Link></li>
        <li><Link to={CLINICIAN_STATUS_PATH}>Check an application</Link></li>
      </ul>
      <div><PrimaryButton onClick={differentEmail}>Use a different email address</PrimaryButton></div>
    </section>}

    {screen === 'expired' && <section className="clinician-panel" aria-labelledby="clinician-expired-title">
      <StepHeading id="clinician-expired-title" focus>Confirm your email again</StepHeading>
      {/* P4 also ends a draft after five hashed submissions (hid-system 9e981e4), with the same 401 as its expiry. */}
      <p role="alert">Your email confirmation has ended: it lasts an hour and covers up to five attempts to submit. If you already
        submitted, check your application status; otherwise confirm your email again. Your other details are kept on this page.</p>
      <div className="clinician-actions">
        <PrimaryButton onClick={confirmEmailAgain}>Confirm email again</PrimaryButton>
        <Link className={buttonClass({ variant: 'secondary' })} to={CLINICIAN_STATUS_PATH}>Check application status</Link>
      </div>
    </section>}

    {screen === 'ended' && <section className="clinician-panel" aria-labelledby="clinician-ended-title">
      <StepHeading id="clinician-ended-title" focus>This page has closed</StepHeading>
      <p>For your safety, this page closed after 30 minutes. Your application is saved. Check your application to finish setting up
        your code app. Health ID can't review it until you do.</p>
      <div><Link className={buttonClass({ variant: 'primary', block: true })} to={CLINICIAN_STATUS_PATH}>Check your application</Link></div>
    </section>}

    {screen === 'steps' && (step === 'email' || step === 'code') && <EmailCode key={emailRound} idPrefix="clinician-signup"
      action="clinician-application" email={email} onEmail={setEmail} focusFirst={moved}
      copy={{ emailHeading: 'Your work email', codeInvalid: 'That code is wrong or too old. Check your latest email or send a new code.',
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
        onSearchRefused={searchRefused}
        searchesUsed={{ message: SIGNUP_SEARCHES_USED, action: { label: 'Confirm email again', onClick: confirmEmailAgain } }} />
      <button type="submit" className={buttonClass({ variant: 'primary', block: true })}>Continue</button>
    </form>}

    {screen === 'steps' && step === 'password' && <form className="patient-form" aria-labelledby="clinician-password-title" noValidate
      aria-busy={busy} onSubmit={event => void submit(event)}>
      <StepHeading id="clinician-password-title" focus>Password and agreements</StepHeading>
      <p className="patient-field-hint">Choose the password you'll sign in with once your access is turned on. All fields are required.</p>
      <StepError error={error} />
      <ErrorSummary problems={problems} focusKey={summaryKey} />
      <Field label="Password" htmlFor="clinician-password" error={fieldError(problems, 'clinician-password')} required>
        <PasswordInput id="clinician-password" autoComplete="new-password" maxLength={256} value={password}
          aria-describedby="clinician-password-rules" onChange={event => setPassword(event.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="clinician-password-confirm" error={fieldError(problems, 'clinician-password-confirm')} required>
        <PasswordInput id="clinician-password-confirm" toggleLabel="Show confirmed password" autoComplete="new-password" maxLength={256} value={confirm}
          onChange={event => setConfirm(event.target.value)} />
      </Field>
      <PasswordRules id="clinician-password-rules" password={password} confirm={confirm} />
      <Declarations accurate={accurate} consent={consent} onAccurate={setAccurate} onConsent={setConsent} regulator={regulator}
        facility={facilityName} problems={problems} />
      <div className="clinician-actions">
        <button type="submit" className={buttonClass({ variant: 'primary', block: true })} disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
        <TextButton onClick={() => goTo('details')} disabled={busy}>Back</TextButton>
      </div>
    </form>}

    {/* A replay is only of this same submission (its key follows the password too): nothing new was saved. */}
    {screen === 'steps' && step === 'authenticator' && submitted?.replayed && <p role="status" className="patient-field-hint">
      Your application was already received from your earlier attempt, with the password you entered then.</p>}
    {screen === 'steps' && step === 'authenticator' && submitted && pageState !== 'closed' && <ClinicianAuthenticator
      start={submitted.authenticator ? (submitted.authenticator.purpose === 'verify' ? 'verify' : 'enrol') : 'reopen'}
      context="signup" email={email} doneLabel="Continue to your application"
      onReady={() => { if (!closed.current) goTo('done') }} onEnded={() => { if (!closed.current) show('ended') }}
      footer={<div className="clinician-panel">
        <p className="patient-page-copy">Can't set it up now? Your application is saved, and you can finish from the status page.
          This page stays open on this device for up to 30 minutes, so on a shared computer, close it.</p>
        <StepError error={closeError} />
        <div><TextButton id="clinician-signup-close" onClick={() => void closePage()} disabled={pageState === 'closing'}>
          {pageState === 'closing' ? 'Closing…' : 'Close this page'}</TextButton></div>
      </div>} />}
    {screen === 'steps' && step === 'authenticator' && pageState === 'closed' && <section className="clinician-panel">
      <p id="clinician-signup-closed" tabIndex={-1} role="status" className="patient-inline-success">This page is closed on this device.
        Your application is saved. To set up your code app, enter your email on the status page. Health ID can't review your
        application until you do.</p>
      <div><Link className={buttonClass({ variant: 'primary', block: true })} to={CLINICIAN_STATUS_PATH}>Check your application</Link></div>
    </section>}

    {screen === 'steps' && step === 'done' && submitted && <section className="patient-success" aria-labelledby="clinician-done-title">
      <StepHeading id="clinician-done-title" focus>Application submitted</StepHeading>
      <dl className="clinician-facts">
        <dt>Facility</dt><dd>{submitted.facility.name}</dd>
        <dt>Profession</dt><dd>{PROFESSION_NAME[submitted.profession] ?? submitted.profession}</dd>
        {formatDate(submitted.expiresAt) && <><dt>Kept open until</dt><dd>{formatDate(submitted.expiresAt)}</dd></>}
      </dl>
      <p className="patient-page-copy">Health ID will call you for a short video check. Have your photo ID and your code app
        ready. You can sign in once you're approved. We keep applications open for 30 days.</p>
      <div><Link className={buttonClass({ variant: 'primary', block: true })} to={CLINICIAN_STATUS_PATH}>View application status</Link></div>
      <p className="patient-page-copy">This page stays open on this device for up to 30 minutes, so your application can be checked here
        without a code. On a shared computer, close it when you're done.</p>
      <StepError error={closeError} />
      {pageState === 'closed'
        ? <p id="clinician-signup-closed" tabIndex={-1} role="status" className="patient-inline-success">This page is closed on this
          device. To check your application, enter your email on the status page.</p>
        : <div><TextButton id="clinician-signup-close" onClick={() => void closePage()} disabled={pageState === 'closing'}>
          {pageState === 'closing' ? 'Closing…' : 'Close this page'}</TextButton></div>}
    </section>}

    <p className="patient-auth-footer">Already applied? <Link to={CLINICIAN_STATUS_PATH}>Check an application's status</Link>.
      {' '}Have provider access? <Link to="/provider/sign-in">Sign in to the provider site</Link>.</p>
  </ClinicianFrame>
}

/** A SHA-256 digest of the password, to tell one submission from another without keeping the password. */
async function passwordDigest(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function passwordProblems(password: string, confirm: string): Problem[] {
  const problems: Problem[] = []
  if (password.length < 12 || password.length > 256) problems.push({ field: 'clinician-password', message: 'Choose a password of at least 12 characters.' })
  if (confirm !== password || !confirm) problems.push({ field: 'clinician-password-confirm', message: 'Type the same password again.' })
  return problems
}
