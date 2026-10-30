import { useState, type FormEvent } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { staffSignInHref, staffSiteForOrganizationType, staffSiteHostname } from '../../productHostname'
import { organizationTypeNote } from '../../staff/routes/ProviderEnrollment'
import { registeringDetails, seconds, waitWords, type OrganizationType } from './enrollmentRules'
import { PasswordField } from './PasswordField'
import { ErrorWords, ScreenHeading, SignInLink, SupportContact } from './parts'
import type { Enrollment } from './useEnrollment'

function Alert({ e }: { readonly e: Enrollment }) {
  return e.error ? <p role="alert" className="hid-ehr-signup-alert"><ErrorWords error={e.error} /></p> : null
}

/**
 * Registration submitted (design screen 08), shown once today's start has accepted the details: the CAC number has
 * been checked and the code step comes next.
 */
export function Submitted({ e }: { readonly e: Enrollment }) {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-submitted-title">Facility registration submitted</ScreenHeading>
      <p className="hid-ehr-signup-lede">We’ve checked your CAC registration number. Confirm your email next, then choose your
        password. Full access begins once Health ID support has checked your facility, usually within one working day.</p>
      <EhrButton className="hid-ehr-signup-wide" onClick={() => e.setSubmitted(false)}>Continue to verification</EhrButton>
    </>
  )
}

/**
 * Enter your verification code (design screen 09), over today's code step and its "Didn't get the code?"
 * (ProviderEnrollment.tsx:1083-1122): the same hints, waits, security check and results. "Change unverified email" is
 * today's "Start again": back to Your account, with every detail kept.
 */
export function CodeStep({ e }: { readonly e: Enrollment }) {
  const email = e.administratorEmail
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-code-title">Enter your verification code</ScreenHeading>
      <p className="hid-ehr-signup-lede">{e.unsent === 'recent'
        ? `We didn’t send a new code, because one was sent to ${email} less than a minute ago. Enter the six `
          + 'digit code from that email.'
        : e.unsent === 'limit'
          ? 'We didn’t send a new code, because we’ve sent as many as we can for now. Enter the six digit code from the '
            + `latest email Health ID sent to ${email}.`
          : `Enter the six digit code sent to ${email}.`}</p>
      <Alert e={e} />
      <form className="hid-ehr-signup-form hid-ehr-signup-stack" noValidate
        onSubmit={(event: FormEvent) => { event.preventDefault(); void e.verify() }}>
        <EhrField label="Verification code" controlId="hid-ehr-signup-code">
          <EhrInput required inputMode="numeric" autoComplete="one-time-code" value={e.code}
            onChange={event => e.setCode(event.target.value)} pattern="[0-9]{6}" maxLength={6} />
        </EhrField>
        <EhrButton type="submit" className="hid-ehr-signup-wide" busy={e.busy} disabled={e.code.length !== 6}>
          {e.busy ? 'Checking…' : 'Verify code'}
        </EhrButton>
      </form>
      <section className="hid-ehr-signup-resend" aria-labelledby="hid-ehr-signup-resend-title">
        <h2 id="hid-ehr-signup-resend-title" className="hid-ehr-signup-subtitle">Didn’t get the code?</h2>
        <p className="hid-ehr-hint">Check your spam or junk folder first. A new code replaces the last one.</p>
        <div className="hid-ehr-signup-turnstile">
          <Turnstile action="provider-enrollment" onTokenChange={e.setTurnstileToken} resetKey={e.resetKey} />
        </div>
        <EhrButton variant="secondary" className="hid-ehr-signup-wide" onClick={() => void e.resend()}
          disabled={e.busy || !e.turnstileToken || e.resendIn > 0 || e.codeLimitIn > 0}>Resend code</EhrButton>
        {e.codeLimitIn > 0
          ? <p className="hid-ehr-hint">We’ve sent as many codes as we can for now. {e.codeInForce
            ? <>Use the code in the latest email from{' '}Health ID, or ask for a new one in {waitWords(e.codeLimitIn)}.</>
            : <>You can ask for a new one in {waitWords(e.codeLimitIn)}.</>}</p>
          : e.resendIn > 0 && <p className="hid-ehr-hint">You can ask for a new code in {e.codesReported
            ? waitWords(e.resendIn) : seconds(e.resendIn)}.</p>}
        <div role="status">{e.resent && <p className="hid-ehr-hint">{e.resent === 'sent'
          ? `We’ve sent a new code to ${email}.`
          : e.resent === 'in-force' ? 'We didn’t send a new code: the code in the latest email from Health ID still works.'
            : 'We didn’t send a new code, and the last one can no longer be used.'}</p>}</div>
      </section>
      <EhrButton variant="secondary" className="hid-ehr-signup-wide" onClick={() => e.startAgain(0)}>Change unverified email</EhrButton>
    </>
  )
}

/**
 * Today's password step (ProviderEnrollment.tsx:1124-1155), after the code, drawn as the design's account fields: the
 * account is made only once the email is confirmed and the CAC record's name has been shown. The design's Confirm
 * password is checked here and never sent; activation sends the password alone.
 */
export function PasswordStep({ e }: { readonly e: Enrollment }) {
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const registering = e.registering

  function submit(event: FormEvent) {
    event.preventDefault()
    if (e.busy || e.password.length < 12) return
    if (confirm !== e.password) { setMismatch(true); return }
    setMismatch(false)
    void e.activate()
  }

  return (
    <>
      <ScreenHeading id="hid-ehr-signup-password-title">Create your provider account</ScreenHeading>
      <div className="hid-ehr-signup-registering">
        {/* The facility type and administrator are the confirmed code's (R6), shown so they can be checked too. */}
        <p id="hid-ehr-signup-registering">{registering?.organizationName
          ? <>You’re registering <strong>{registering.organizationName}</strong>, CAC number {e.cacNumber}
            {registeringDetails(registering)}. Check that this is your organization before you create the account.</>
          : <>You’re registering the organization with CAC number {e.cacNumber}{registeringDetails(registering)}. Check
            {' '}that this is your organization’s number before you create the account.</>}</p>
        {e.registeringFailed && <p>We couldn’t load your organization’s registered name just
          now. <EhrButton variant="quiet" size="sm" disabled={e.busy} onClick={() => void e.readRegisteringAgain()}>Try again</EhrButton></p>}
        <EhrButton variant="secondary" size="sm" disabled={e.busy} onClick={() => void e.notMine()}>This isn’t my organization</EhrButton>
      </div>
      <Alert e={e} />
      <form className="hid-ehr-signup-form hid-ehr-signup-stack" noValidate onSubmit={submit}>
        <p id="hid-ehr-signup-password-hint" className="hid-ehr-hint">Choose a password of at least 12 characters. You’ll use
          it with {e.accountEmail} to sign in. Once your account is created, you go straight into the Provider Portal as your
          facility’s administrator.</p>
        {/* Lets a password manager save the new password with its email. */}
        <input type="email" hidden readOnly autoComplete="username" value={e.accountEmail} />
        <PasswordField label="Password" controlId="hid-ehr-signup-password" required autoComplete="new-password"
          minLength={12} maxLength={256} aria-describedby="hid-ehr-signup-password-hint" value={e.password}
          onChange={event => e.setPassword(event.target.value)} />
        <PasswordField label="Confirm password" controlId="hid-ehr-signup-confirm" toggleLabel="Show password confirmation" required
          autoComplete="new-password"
          maxLength={256} value={confirm} error={mismatch ? 'Passwords do not match.' : undefined}
          onChange={event => setConfirm(event.target.value)} />
        <EhrButton type="submit" className="hid-ehr-signup-wide" busy={e.busy} disabled={e.password.length < 12}>
          {e.busy ? 'Creating provider account…' : 'Create provider account'}
        </EhrButton>
      </form>
    </>
  )
}

/**
 * Your facility is set up: today's ending on Novu (FacilityReady, ProviderEnrollment.tsx:1188-1208). The administrator
 * is signed in here, and in production signs in on the staff site of the facility's type from then on.
 */
export function FacilityReady({ e }: { readonly e: Enrollment }) {
  const hostname = window.location.hostname
  const type: OrganizationType = e.registering?.organizationType ?? e.organizationType
  const site = staffSignInHref(hostname) !== null ? staffSiteHostname(staffSiteForOrganizationType(type), hostname) : null
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-done-title">Your facility is set up</ScreenHeading>
      <p className="hid-ehr-signup-lede">You’re signed in as your facility’s administrator.</p>
      <p className="hid-ehr-signup-lede">{site
        ? `Next time, sign in at ${site} with ${e.accountEmail} and the password you just chose.`
        : `Next time, sign in to the Provider Portal with ${e.accountEmail} and the password you just chose.`}</p>
      <p className="hid-ehr-signup-lede">{organizationTypeNote(type, e.ordersOn)}</p>
      <EhrButton className="hid-ehr-signup-wide" onClick={e.openWorkspace}>Continue to the Provider Portal</EhrButton>
    </>
  )
}

/**
 * Activation's answer was lost, or the sign-in that follows it failed, after the account may have been created
 * (MaybeActive, ProviderEnrollment.tsx:1210-1223). A new activation would be refused, so the administrator signs in.
 */
export function MaybeActive({ e }: { readonly e: Enrollment }) {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-sign-in-title">Your account may already be ready</ScreenHeading>
      <p className="hid-ehr-signup-lede">We couldn’t confirm that your facility was set up, but it may have been. Sign in with
        {e.accountEmail ? ` ${e.accountEmail}` : ' your administrator email'} and the password you chose. If you can’t sign in,
        {' '}<SupportContact purpose="inline" /></p>
      <SignInLink>Sign in to the Provider Portal</SignInLink>
    </>
  )
}

/** A panel in place of the step (ProviderEnrollment.tsx:1168-1174): Health ID needs to help, or another email can start again. */
export function HelpPanel({ e }: { readonly e: Enrollment }) {
  const help = e.help
  if (!help) return null
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-help-title">{help.title}</ScreenHeading>
      {help.restart ? <>
        <p className="hid-ehr-signup-lede">{help.text} <SupportContact purpose="help" /></p>
        <EhrButton className="hid-ehr-signup-wide" onClick={e.anotherEmail}>Start again with another email</EhrButton>
      </> : <p className="hid-ehr-signup-lede">{help.text} <SupportContact purpose="finish" /></p>}
    </>
  )
}

/** Facility sign-up is closed (ProviderEnrollment.tsx:995-1000). */
export function ClosedPanel() {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-closed-title">Facility sign-up isn’t open right now</ScreenHeading>
      <p className="hid-ehr-signup-lede">Hospitals, laboratories and pharmacies can’t sign themselves up on Health ID at the
        moment. <SupportContact purpose="register" /></p>
      <p className="hid-ehr-signup-lede">If your facility already uses Health ID, sign in instead.</p>
    </>
  )
}

/** Identity could not tell whether sign-up is open (a fault): not closed, so it says so (ProviderEnrollment.tsx:1002-1008). */
export function UnavailablePanel({ e }: { readonly e: Enrollment }) {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-unavailable-title">Facility sign-up is temporarily unavailable</ScreenHeading>
      <p className="hid-ehr-signup-lede">We can’t take facility sign-ups just now because of a problem on our side. Please
        try again in a few minutes. <SupportContact purpose="persist" /></p>
      <EhrButton className="hid-ehr-signup-wide" onClick={e.checkAvailabilityAgain}>Try again</EhrButton>
    </>
  )
}
