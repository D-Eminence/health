import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError, plainErrorText } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Alert, Button, buttonClass } from '../../../kasuwa/ui'
import { useStaff } from '../../../staff/App'
import type { StaffLoginChallenge, StaffSession } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { STAFF_MFA_NOTICE } from '../../../staff/routes/SignIn'
import { StaffMfaSteps, type StaffMfaLook } from '../../../staff/routes/StaffMfaSteps'
import { ClinicianSignUpEntry, PageLink } from '../../../staff/clinician/ClinicianSignUpEntry'
import { CLINICIAN_STATUS_PATH, patientSignInHref, staffRecoveryHref, staffSignInHref } from '../../../productHostname'
import { OpenStaffPage } from '../../../staffSignIn'
import { servesClinicianApplications } from '../../../backendContract'
import { authHrefs, BlueAuthLayout, HINT, LINK, SiteLink } from './BlueAuthLayout'
import { getStaffLandingPath, passwordRefusal, SIGN_IN_FAILED, TurnstileChallenge } from './signInParts'

function BlueMfaButton({ primary, className, type = 'button', ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} {...rest} className={buttonClass({ variant: primary ? 'primary' : 'ghost', size: primary ? 'lg' : 'md', block: primary, className })} />
}

/** Today's authenticator steps (StaffMfaSteps), drawn as the rest of the redesign's provider sign-in is. */
const BLUE_MFA_LOOK: StaffMfaLook = {
  headingAs: 'h1',
  classNames: { step: 'staff-form staff-mfa', note: HINT, error: 'm-0 text-[13px] font-medium text-danger-ink', status: 'm-0 text-[13px] text-success-ink' },
  Button: BlueMfaButton,
}

/**
 * The sign-in's welcome line and the authenticator step's last button, in the classic page's words
 * (staff/routes/SignIn.tsx), the same on every product site (parity report 3.3-42, 3.3-44).
 */
export const SIGN_IN_LEDE = 'Sign in with your work account.'
export const SIGN_IN_DONE = 'Continue'

/**
 * The Hospital EHR's staff sign-in, working as today's does (staff/routes/SignIn.tsx): work email and password with
 * Turnstile, then the authenticator or its set-up, recovery codes, today's refusals and landing, in its words and order:
 * "Set up your facility" in the header, the refusal below the human check, then "Forgot your password?". Each product
 * site's own ways in stay on that site. On a site where staff do not sign in
 * (the production patient portal, an admin site), it opens the EHR site's sign-in at once, with no step of its own.
 * staff/App.tsx opens it at /provider/sign-in in place of today's page once the clinic switch is on (README.md).
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
  if (elsewhere) return <OpenStaffPage href={elsewhere} />

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
    try { completeSignIn(session) } catch (caught) { restart(plainErrorText(caught, SIGN_IN_FAILED, { audience: 'facility' })); return }
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
    <BlueAuthLayout title="Welcome back." titleId="blue-sign-in-title" titleAs={challenge ? 'p' : 'h1'} titleRef={heading}
      lede={SIGN_IN_LEDE} links={false} headerLink={{ href: hrefs.register, label: 'Set up your facility' }}>
      {challenge ? (
        <StaffMfaSteps challenge={challenge} look={BLUE_MFA_LOOK}
          calls={{ verify: verifyMfa, sendEnrollmentCode, startEnrollment, activate: activateEnrollment }}
          doneLabel={SIGN_IN_DONE} onSignedIn={finish} onRestart={restart} restartLabel="Start again" />
      ) : <>
        {mfaRequired ? <Alert intent="info" size="sm">{STAFF_MFA_NOTICE}</Alert> : null}
        <form className="staff-form" onSubmit={event => void submit(event)}>
          <div className="auth-field-label">
            <label htmlFor="blue-sign-in-email">Work email</label>
            <input id="blue-sign-in-email" type="email" autoComplete="username" value={email} required
              onChange={event => setEmail(event.target.value)} />
          </div>
          <div className="auth-field-label">
            <label htmlFor="blue-sign-in-password">Password</label>
            <PasswordInput appearance="plain" id="blue-sign-in-password" autoComplete="current-password" value={password} required
              onChange={event => setPassword(event.target.value)} />
          </div>
          <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
          {/* The refusal below the human check, as on the classic page, with the way to check a clinician application when that is why. */}
          {error ? <p className="m-0 text-[13px] font-medium text-danger-ink" role="alert">{error}</p> : null}
          {error && noFacility && servesClinicianApplications() ? <p className={HINT}>Applied as a doctor or nurse? You can sign in
            once your application is approved. <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink>.</p> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || (!!siteKey && !token)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className={HINT}>
          <SiteLink className={LINK} href={recovery}>Forgot your password?</SiteLink>
          {' '}Need a staff account? Ask your facility administrator.
        </p>
        <p className={HINT}>Are you a patient? <SiteLink className={LINK} href={patientSignInHref(window.location.hostname)}>Sign in to Health ID</SiteLink></p>
        <ClinicianSignUpEntry className={HINT} />
      </>}
    </BlueAuthLayout>
  )
}
