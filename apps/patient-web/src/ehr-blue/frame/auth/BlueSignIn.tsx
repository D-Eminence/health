import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Alert, Button, buttonClass } from '../../../kasuwa/ui'
import { useStaff } from '../../../staff/App'
import type { StaffLoginChallenge, StaffSession } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { STAFF_MFA_NOTICE } from '../../../staff/routes/SignIn'
import { StaffMfaSteps, type StaffMfaLook } from '../../../staff/routes/StaffMfaSteps'
import { ClinicianSignUpEntry, PageLink } from '../../../staff/clinician/ClinicianSignUpEntry'
import { CLINICIAN_STATUS_PATH, STAFF_RECOVERY_PATH, staffRecoveryHref, staffSignInHref } from '../../../productHostname'
import { servesClinicianApplications } from '../../../backendContract'
import { authHrefs, BlueAuthLayout, HINT, LINK, NOTE, SiteLink } from './BlueAuthLayout'
import { getStaffLandingPath, passwordRefusal, TurnstileChallenge } from './signInParts'

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
 * The Hospital EHR's staff sign-in, working as today's does (staff/routes/SignIn.tsx): work email and password with
 * Turnstile, then the authenticator or its set-up, recovery codes, today's refusals and landing. On a site where staff
 * do not sign in, it points to the one where they do. staff/App.tsx opens it at /provider/sign-in in place of today's
 * page once the clinic switch is on (README.md).
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
      <BlueAuthLayout title="Sign in on the EHR site." titleId="blue-sign-in-title" lede="Use your work account at ehr.healthidentitydirectory.com.">
        <a className={buttonClass({ variant: 'primary', size: 'lg', block: true })} href={elsewhere}>Continue to provider sign in</a>
        <ClinicianSignUpEntry className={HINT} />
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
    <BlueAuthLayout title="Welcome back." titleId="blue-sign-in-title" titleAs={challenge ? 'p' : 'h1'} titleRef={heading}
      lede={challenge ? undefined : 'Sign in to your hospital workspace.'} links={false}>
      {challenge ? (
        <StaffMfaSteps challenge={challenge} look={BLUE_MFA_LOOK}
          calls={{ verify: verifyMfa, sendEnrollmentCode, startEnrollment, activate: activateEnrollment }}
          doneLabel="Continue to the Hospital EHR" onSignedIn={finish} onRestart={restart} restartLabel="Start again" />
      ) : <>
        {mfaRequired ? <Alert intent="info" size="sm">{STAFF_MFA_NOTICE}</Alert> : null}
        {/* One alert: the refusal, with the way to check a clinician application when that is why. */}
        {error ? <Alert intent="error" size="sm">{error}
          {noFacility && servesClinicianApplications() ? <> Applied as a doctor or nurse? You can sign in once your application
            is approved. <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink>.</> : null}</Alert> : null}
        <form className="staff-form" onSubmit={event => void submit(event)}>
          <div className="auth-field-label">
            <label htmlFor="blue-sign-in-email">Email</label>
            <input id="blue-sign-in-email" type="email" autoComplete="username" placeholder="you@hospital.org" value={email} required
              onChange={event => setEmail(event.target.value)} />
          </div>
          <div className="auth-field-label">
            <label htmlFor="blue-sign-in-password">Password</label>
            <PasswordInput appearance="plain" id="blue-sign-in-password" autoComplete="current-password" value={password} required
              onChange={event => setPassword(event.target.value)} />
          </div>
          <p className="-mt-3 m-0 flex flex-wrap items-center justify-end gap-x-2 text-[13px]">
            {recovery !== STAFF_RECOVERY_PATH ? <span className="text-ink-3">You reset it on the main Health ID site.</span> : null}
            <SiteLink className={LINK} href={recovery}>Forgot password?</SiteLink>
          </p>
          <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || (!!siteKey && !token)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div className="flex flex-col gap-1">
          <p className={NOTE}>New to Health ID? <SiteLink className={LINK} href={hrefs.register}>Register a hospital</SiteLink></p>
          <p className={NOTE}>Joining your team? <SiteLink className={LINK} href={hrefs.invitation}>Accept invitation</SiteLink></p>
          <ClinicianSignUpEntry className={HINT} />
        </div>
      </>}
    </BlueAuthLayout>
  )
}
