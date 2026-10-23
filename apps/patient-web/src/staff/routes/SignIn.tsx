import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Button, Field, Input, PasswordInput } from '@hid/ui'
import { getEnvironment } from '../env'
import { useStaff } from '../App'
import type { StaffLoginChallenge, StaffSession } from '../api'
import { AuthLayout } from '../../AuthLayout'
import { loadTurnstileScript, turnstileSize } from '../../Turnstile'
import { CLINICIAN_STATUS_PATH, resolveStaffProductHostname, STAFF_RECOVERY_PATH, staffLoginAction, staffRecoveryHref, staffSignInHref } from '../../productHostname'
import { staffReturnPath } from '../session'
import { STAFF_MFA_FACTOR_UNPROVEN, STAFF_MFA_UNAVAILABLE, StaffMfaSteps, type StaffMfaLook } from './StaffMfaSteps'
import { ClinicianSignUpEntry, PageLink } from '../clinician/ClinicianSignUpEntry'

/**
 * Said when Identity ended the sign-in for want of an authenticator
 * (403 STAFF_MFA_REQUIRED, hid-system #71): here, and on the session-ended screen.
 */
export const STAFF_MFA_NOTICE = 'Health ID now asks staff for a code from an authenticator app at sign-in. '
  + 'Sign in again to set one up, or to use the one you have.'

function StaffMfaButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button tone={primary ? 'primary' : 'quiet'} {...rest} />
}

/** The authenticator steps, drawn as the rest of the provider sign-in page is. */
const STAFF_MFA_LOOK: StaffMfaLook = {
  headingAs: 'h1',
  classNames: { step: 'staff-form staff-mfa', note: 'staff-muted', error: 'staff-error', status: 'staff-success' },
  Button: StaffMfaButton,
}

/**
 * What the page says for a refused password step: the portal's words for the
 * refusals of a right password that mean something for staff sign-in with an
 * authenticator, and otherwise Identity's own.
 */
function passwordRefusal(caught: unknown): string {
  if (isHidApiError(caught) && caught.code === 'STAFF_MFA_FACTOR_UNPROVEN') return STAFF_MFA_FACTOR_UNPROVEN
  if (isHidApiError(caught) && caught.code === 'MFA_UNAVAILABLE') return STAFF_MFA_UNAVAILABLE
  return caught instanceof Error ? caught.message : 'Sign in failed.'
}

function getStaffLandingPath(search: string): string {
  return staffReturnPath(new URLSearchParams(search).get('returnTo'))
    ?? resolveStaffProductHostname(window.location.hostname)?.route ?? '/provider'
}

const CHALLENGE_UNAVAILABLE = 'Human verification could not load. Refresh the page and try again.'

function TurnstileChallenge({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) {
  const siteKey = getEnvironment().turnstileSiteKey
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  // Read when the widget answers, so a new callback does not render the widget again.
  const tokenTo = useRef(onToken)
  useEffect(() => { tokenTo.current = onToken }, [onToken])

  useEffect(() => {
    if (!siteKey || !host.current) return
    let active = true
    let widgetId: string | null = null
    // The portal's one loader (Turnstile.tsx): this page adds no script of its own.
    void loadTurnstileScript().then(() => {
      if (!active || !host.current || !window.turnstile) return
      setError('')
      widgetId = window.turnstile.render(host.current, {
        sitekey: siteKey,
        action: staffLoginAction(window.location.hostname),
        size: turnstileSize(host.current, 'normal'),
        callback: (token: string) => tokenTo.current(token),
        'expired-callback': () => tokenTo.current(''),
        'error-callback': () => { tokenTo.current(''); setError(CHALLENGE_UNAVAILABLE) },
      })
    }).catch(() => { if (active) setError(CHALLENGE_UNAVAILABLE) })
    return () => { active = false; if (widgetId && window.turnstile) window.turnstile.remove(widgetId) }
  }, [siteKey, resetKey])

  if (!siteKey) return null
  return <div><div ref={host} />{error && <p role="alert" className="staff-error">{error}</p>}</div>
}

export function SignIn() {
  const { state, login, verifyMfa, sendEnrollmentCode, startEnrollment, activateEnrollment, completeSignIn } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A right password for an account with no active facility: a clinician applicant not yet approved, perhaps (ADR-066).
  const [noFacility, setNoFacility] = useState(false)
  // The second step Identity asked for, while it is shown. The password form is gone meanwhile, so each is a new one.
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null)
  // Back at the password step from a later one, its heading takes focus: the step left is gone.
  const heading = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const [returned, setReturned] = useState(0)
  useEffect(() => { if (returned) heading.current?.focus() }, [returned])
  const siteKey = getEnvironment().turnstileSiteKey
  const landingPath = getStaffLandingPath(location.search)
  const mfaRequired = (state.status === 'signed-out' || state.status === 'ended') && state.reason === 'mfa-required'

  if (state.status === 'ready') return <Navigate to={landingPath} replace />
  // The production portal sends staff to the EHR site's sign-in, which
  // hid-system accepts; a form here would always be refused.
  const elsewhere = staffSignInHref(window.location.hostname)
  if (elsewhere) return <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
    title="Sign in on the EHR site." titleId="staff-sign-in-title"
    lede="Provider staff sign in at ehr.healthidentitydirectory.com, with the staff account assigned to your facility.">
    <p><a className="patient-primary-button" href={elsewhere}>Continue to provider sign in</a></p>
    <ClinicianSignUpEntry className="staff-muted" />
  </AuthLayout>
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNoFacility(false)
    setBusy(true)
    try {
      const answer = await login(email.trim(), password, token || undefined)
      if (answer.kind === 'challenge') {
        // The password has done its part; a new challenge asks for it again.
        setPassword('')
        setChallenge(answer.challenge)
      }
      else finish(answer.session)
    }
    catch (caught) {
      setError(passwordRefusal(caught))
      setNoFacility(isHidApiError(caught) && caught.code === 'NO_ACTIVE_FACILITY_MEMBERSHIP')
    }
    finally {
      setToken('')
      setTurnstileResetKey(value => value + 1)
      setBusy(false)
    }
  }

  function finish(session: StaffSession) {
    try { completeSignIn(session) }
    catch (caught) { restart(caught instanceof Error ? caught.message : 'Sign in failed.'); return }
    navigate(getStaffLandingPath(location.search))
  }

  function restart(message: string | null) {
    setChallenge(null)
    setError(message ?? '')
    setReturned(value => value + 1)
  }

  return <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
    headerLink={{ to: '/provider/enroll', label: 'Set up your facility' }}
    title="Welcome back." titleId="staff-sign-in-title" titleAs={challenge ? 'p' : 'h1'}
    titleRef={heading} titleFocusable={!challenge}
    lede="Sign in with the staff account assigned to your facility. Health ID verifies your permissions and facility.">
    {challenge ? <StaffMfaSteps challenge={challenge} look={STAFF_MFA_LOOK}
      calls={{ verify: verifyMfa, sendEnrollmentCode, startEnrollment, activate: activateEnrollment }}
      doneLabel="Continue to the Provider Portal" onSignedIn={finish} onRestart={restart} restartLabel="Start again" /> : <>
      {mfaRequired && <p role="status" className="staff-notice">{STAFF_MFA_NOTICE}</p>}
      <form className="staff-form" onSubmit={event => void submit(event)}>
        <Field label="Work email" htmlFor="staff-email" required><Input id="staff-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></Field>
        <Field label="Password" htmlFor="staff-password" required><PasswordInput id="staff-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
        {error && <p className="staff-error" role="alert">{error}</p>}
        {error && noFacility && <p className="staff-muted">Applied as a doctor or nurse? You can sign in once two HID administrators
          have approved your application. <PageLink path={CLINICIAN_STATUS_PATH}>Check your clinician application</PageLink>.</p>}
        <Button type="submit" disabled={busy || !!siteKey && !token}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <RecoveryLink />
      <ClinicianSignUpEntry className="staff-muted" />
    </>}
  </AuthLayout>
}

/**
 * hid-system accepts a staff password reset only on the main site, so a staff
 * product site links to the main site's recovery page and says so.
 */
function RecoveryLink() {
  const href = staffRecoveryHref(window.location.hostname)
  const central = href !== STAFF_RECOVERY_PATH
  return <p className="staff-muted">
    {central ? <a href={href}>Forgot your password?</a> : <Link to={href}>Forgot your password?</Link>}
    {central && ' Password resets are done on the main Health ID site.'}
    {' '}For a new staff account, contact your facility administrator.
  </p>
}
