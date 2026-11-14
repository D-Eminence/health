import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError, plainErrorText } from '@hid/http'

import { Alert, Button, buttonClass } from '../../../kasuwa/ui'
import { useStaff } from '../../../staff/App'
import type { StaffLoginChallenge, StaffSession } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { STAFF_MFA_NOTICE } from '../../../staff/routes/SignIn'
import { StaffMfaSteps, type StaffMfaLook } from '../../../staff/routes/StaffMfaSteps'
import { PageLink } from '../../../staff/clinician/ClinicianSignUpEntry'
import { CLINICIAN_STATUS_PATH, staffSignInHref } from '../../../productHostname'
import { OpenStaffPage } from '../../../staffSignIn'
import { servesClinicianApplications } from '../../../backendContract'
import { BlueAuthLayout, HINT, siteName } from './BlueAuthLayout'
import { getStaffLandingPath, passwordRefusal, SIGN_IN_FAILED, TurnstileChallenge } from './signInParts'
import { productOf, type Product } from '../product'

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
 * The sign-in's welcome line, its last button and the example work address in the email field, in the words of the
 * product this site is (product.ts): the Hospital EHR on ehr. (and wherever no product site is named), each product's
 * own name on lab., pharmacy., outreach., migrate. The example is you@hospital.org on the Hospital EHR only and
 * you@work.org on each product site.
 */
export function signInWords(product: Product): { readonly lede: string; readonly done: string; readonly emailExample: string } {
  if (product === 'ehr') return { lede: 'Sign in to your hospital workspace.', done: 'Continue to the Hospital EHR', emailExample: 'you@hospital.org' }
  const name = siteName(product)
  // A lab, pharmacy or outreach team is not always a hospital's: the example address names no kind of workplace.
  return { lede: `Sign in to ${name}.`, done: `Continue to ${name}`, emailExample: 'you@work.org' }
}

/**
 * The Hospital EHR's staff sign-in, working as today's does (staff/routes/SignIn.tsx): work email and password with
 * Turnstile, then the authenticator or its set-up, recovery codes, today's refusals and landing. Each product site's
 * own ways in (Register, Accept invitation, Forgot password?) stay on that site. On a site where staff do not sign in
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
      const answer = await login(email.trim(), password || 'email-only', token || undefined)
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

  // Before signing in there are no permissions to go by: the site's own address names the product.
  const words = signInWords(productOf(window.location.hostname, []))
  return (
    <BlueAuthLayout title="Welcome back." titleId="blue-sign-in-title" titleAs={challenge ? 'p' : 'h1'} titleRef={heading}
      lede={challenge ? undefined : words.lede} links={false}>
      {challenge ? (
        <StaffMfaSteps challenge={challenge} look={BLUE_MFA_LOOK}
          calls={{ verify: verifyMfa, sendEnrollmentCode, startEnrollment, activate: activateEnrollment }}
          doneLabel={words.done} onSignedIn={finish} onRestart={restart} restartLabel="Start again" />
      ) : <>
        {mfaRequired ? <Alert intent="info" size="sm">{STAFF_MFA_NOTICE}</Alert> : null}
        {/* One alert: the refusal, with the way to check a clinician application when that is why. */}
        {error ? <Alert intent="error" size="sm">{error}
          {noFacility && servesClinicianApplications() ? <> Applied as a doctor or nurse? You can sign in once your application
            is approved. <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink>.</> : null}</Alert> : null}
        <form className="staff-form" onSubmit={event => void submit(event)}>
          <div className="auth-field-label">
            <label htmlFor="blue-sign-in-email">Team code</label>
            <input id="blue-sign-in-email" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} required
              onChange={event => setEmail(event.target.value)} />
          </div>
          {/* Outreach on Supabase (temporary): the team code, then the person taps their name (owner, 14 Nov 2026). */}
          <p className="-mt-3 m-0 text-[13px] text-ink-2">Your coordinator gives you the code. Organisers can use their email.</p>
          <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || (!!siteKey && !token)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </>}
    </BlueAuthLayout>
  )
}
