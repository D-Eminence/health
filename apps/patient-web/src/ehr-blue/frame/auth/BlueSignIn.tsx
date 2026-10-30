import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { useStaff } from '../../../staff/App'
import type { StaffLoginChallenge, StaffSession } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { STAFF_MFA_NOTICE } from '../../../staff/routes/SignIn'
import { StaffMfaSteps, type StaffMfaLook } from '../../../staff/routes/StaffMfaSteps'
import { ClinicianSignUpEntry, PageLink } from '../../../staff/clinician/ClinicianSignUpEntry'
import { CLINICIAN_STATUS_PATH, STAFF_RECOVERY_PATH, staffRecoveryHref, staffSignInHref } from '../../../productHostname'
import { servesClinicianApplications } from '../../../backendContract'
import { authHrefs, BlueAuthLayout, BluePasswordInput, SiteLink } from './BlueAuthLayout'
import { getStaffLandingPath, passwordRefusal, TurnstileChallenge } from './signInParts'

function BlueMfaButton({ primary, children, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <EhrButton variant={primary ? 'primary' : 'quiet'} {...rest}>{children}</EhrButton>
}

/** Today's authenticator steps (StaffMfaSteps), in the blue page's look: the design's "Verify your sign-in". */
const BLUE_MFA_LOOK: StaffMfaLook = {
  headingAs: 'h1',
  classNames: { step: 'hid-ehr-blue-auth-form', note: 'hid-ehr-blue-auth-note', error: 'hid-ehr-error', status: 'hid-ehr-blue-auth-status' },
  Button: BlueMfaButton,
}

/**
 * Staff sign-in as the design draws it (screens/2-sign-in/01-signin.png), working as today's does
 * (staff/routes/SignIn.tsx): work email and password with Turnstile, then the authenticator or its set-up, recovery
 * codes, today's refusals and landing. On a site where staff do not sign in, it points to the one where they do.
 * Not wired in yet (README.md).
 */
export function BlueSignIn() {
  const { state, login, verifyMfa, sendEnrollmentCode, startEnrollment, activateEnrollment, completeSignIn } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [noFacility, setNoFacility] = useState(false)
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null)
  // Back at the password step from a later one, its heading takes focus in the commit that shows it.
  const heading = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const [returned, setReturned] = useState(0)
  useLayoutEffect(() => { if (returned) heading.current?.focus() }, [returned])
  const siteKey = getEnvironment().turnstileSiteKey
  const mfaRequired = (state.status === 'signed-out' || state.status === 'ended') && state.reason === 'mfa-required'

  if (state.status === 'ready') return <Navigate to={getStaffLandingPath(location.search, state.session)} replace />
  const elsewhere = staffSignInHref(window.location.hostname)
  if (elsewhere) {
    return (
      <BlueAuthLayout eyebrow="Hospital EHR" title="Sign in on the EHR site."
        lede="Provider staff sign in at ehr.healthidentitydirectory.com, with the staff account assigned to your facility.">
        <a className="hid-ehr-button hid-ehr-button-primary hid-ehr-blue-auth-wide" href={elsewhere}>Continue to provider sign in</a>
        <ClinicianSignUpEntry className="hid-ehr-blue-auth-note" />
      </BlueAuthLayout>
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNoFacility(false)
    setBusy(true)
    try {
      const answer = await login(email.trim(), password, token || undefined)
      if (answer.kind === 'challenge') {
        setPassword('')
        setChallenge(answer.challenge)
      } else finish(answer.session)
    } catch (caught) {
      setError(passwordRefusal(caught))
      setNoFacility(isHidApiError(caught) && caught.code === 'NO_ACTIVE_FACILITY_MEMBERSHIP')
    } finally {
      setToken('')
      setTurnstileResetKey(value => value + 1)
      setBusy(false)
    }
  }

  function finish(session: StaffSession) {
    try { completeSignIn(session) } catch (caught) { restart(caught instanceof Error ? caught.message : 'Sign in failed.'); return }
    navigate(getStaffLandingPath(location.search, session))
  }

  function restart(message: string | null) {
    setChallenge(null)
    setError(message ?? '')
    setReturned(value => value + 1)
  }

  const hrefs = authHrefs()
  const recovery = staffRecoveryHref(window.location.hostname)
  return (
    <BlueAuthLayout eyebrow="Hospital EHR" title="Welcome back." titleAs={challenge ? 'p' : 'h1'} titleRef={heading}
      lede={challenge ? undefined : 'Sign in to your hospital workspace.'} links={false}>
      {challenge ? (
        <StaffMfaSteps challenge={challenge} look={BLUE_MFA_LOOK}
          calls={{ verify: verifyMfa, sendEnrollmentCode, startEnrollment, activate: activateEnrollment }}
          doneLabel="Continue to the Hospital EHR" onSignedIn={finish} onRestart={restart} restartLabel="Start again" />
      ) : <>
        {mfaRequired ? <p role="status" className="hid-ehr-blue-auth-notice">{STAFF_MFA_NOTICE}</p> : null}
        <form className="hid-ehr-blue-auth-form" onSubmit={event => void submit(event)}>
          <EhrField label="Email">
            <EhrInput type="email" autoComplete="username" placeholder="you@hospital.org" value={email} required
              onChange={event => setEmail(event.target.value)} />
          </EhrField>
          <EhrField label="Password">
            <BluePasswordInput autoComplete="current-password" value={password} required onChange={event => setPassword(event.target.value)} />
          </EhrField>
          <p className="hid-ehr-blue-auth-forgot">
            <SiteLink href={recovery}>Forgot password?</SiteLink>
            {recovery !== STAFF_RECOVERY_PATH ? <span className="hid-ehr-blue-auth-note"> Password resets are done on the main Health ID site.</span> : null}
          </p>
          <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
          {error ? <p className="hid-ehr-error" role="alert">{error}</p> : null}
          {error && noFacility && servesClinicianApplications() ? (
            <p className="hid-ehr-blue-auth-note">Applied as a doctor or nurse? You can sign in once two HID administrators have approved
              your application. <PageLink path={CLINICIAN_STATUS_PATH}>Check your clinician application</PageLink>.</p>
          ) : null}
          <EhrButton type="submit" className="hid-ehr-blue-auth-wide" disabled={busy || (!!siteKey && !token)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </EhrButton>
        </form>
        <div className="hid-ehr-blue-auth-more">
          <p>New to Health ID? <SiteLink href={hrefs.register}>Register a hospital</SiteLink></p>
          <p>Joining your team? <SiteLink href={hrefs.invitation}>Accept invitation</SiteLink></p>
          <ClinicianSignUpEntry className="hid-ehr-blue-auth-note" />
        </div>
      </>}
    </BlueAuthLayout>
  )
}
