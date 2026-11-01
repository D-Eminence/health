import { useState, type FormEvent } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { staffSignInHref, staffSiteForOrganizationType, staffSiteHostname } from '../../productHostname'
import { registeringDetails, seconds, waitWords, type OrganizationType } from './enrollmentRules'
import { PasswordField } from './PasswordField'
import { PasswordRules } from '../../PasswordRules'
import { ErrorWords, ScreenHeading, SignInLink, SupportContact } from './parts'
import type { Enrollment } from './useEnrollment'

function Alert({ e }: { readonly e: Enrollment }) {
  return e.error ? <p role="alert" className="hid-ehr-signup-alert"><ErrorWords error={e.error} /></p> : null
}

/**
 * Confirm your email, over today's code step and its "Didn't get the code?" (ProviderEnrollment.tsx:1083-1122): the
 * same waits, security check and results, each said once. Right after Send it also says the CAC number was checked
 * (`submitted`), so no screen of its own is needed for that. "Use a different email" is today's "Start again": back to
 * the first step, with every detail kept.
 */
export function CodeStep({ e }: { readonly e: Enrollment }) {
  const email = e.administratorEmail
  // Past Identity's limit on codes, the line above the field says so when it brought the administrator here; the wait
  // below then says only when a new code can be asked for.
  const limitSaid = e.unsent === 'limit'
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-code-title">Confirm your email</ScreenHeading>
      <p className="hid-ehr-signup-lede">{e.unsent === 'recent'
        ? `We sent a code to ${email} less than a minute ago, so we didn’t send another. Enter the 6-digit code from that email.`
        : e.unsent === 'limit'
          ? `We’ve sent as many codes as we can for now. Enter the 6-digit code from the latest email we sent to ${email}.`
          : e.submitted ? `We checked your CAC number. Enter the 6-digit code we sent to ${email}.`
            : `Enter the 6-digit code we sent to ${email}.`}</p>
      <Alert e={e} />
      <form className="hid-ehr-signup-form" noValidate aria-labelledby="hid-ehr-signup-code-title"
        onSubmit={(event: FormEvent) => { event.preventDefault(); void e.verify() }}>
        <div className="hid-ehr-signup-fields">
          <EhrField label="Code" controlId="hid-ehr-signup-code">
            <EhrInput required inputMode="numeric" autoComplete="one-time-code" value={e.code}
              onChange={event => e.setCode(event.target.value)} pattern="[0-9]{6}" maxLength={6} />
          </EhrField>
        </div>
        <div className="hid-ehr-signup-resend">
          <p className="hid-ehr-signup-hint">No code? Check your spam folder, or get a new one. A new code replaces the last.</p>
          <div className="hid-ehr-signup-turnstile">
            <Turnstile action="provider-enrollment" onTokenChange={e.setTurnstileToken} resetKey={e.resetKey} />
          </div>
          <EhrButton variant="secondary" onClick={() => void e.resend()}
            disabled={e.busy || !e.turnstileToken || e.resendIn > 0 || e.codeLimitIn > 0}>Send a new code</EhrButton>
          {e.codeLimitIn > 0
            ? <p className="hid-ehr-signup-hint">{limitSaid ? null : <>We’ve sent as many codes as we can for now. </>}{e.codeInForce
              ? <>Use the code in the latest email, or ask for a new one in {waitWords(e.codeLimitIn)}.</>
              : <>You can ask for a new one in {waitWords(e.codeLimitIn)}.</>}</p>
            : e.resendIn > 0 && <p className="hid-ehr-signup-hint">You can ask for a new code in {e.codesReported
              ? waitWords(e.resendIn) : seconds(e.resendIn)}.</p>}
          <div role="status">{e.resent && <p className="hid-ehr-signup-hint">{e.resent === 'sent'
            ? `We’ve sent a new code to ${email}.`
            : e.resent === 'in-force' ? 'We didn’t send a new code: the code in the latest email still works.'
              : 'We didn’t send a new code, and the last one no longer works.'}</p>}</div>
        </div>
        <div className="hid-ehr-signup-actions">
          <EhrButton variant="secondary" onClick={() => e.startAgain(0)}>Use a different email</EhrButton>
          <EhrButton type="submit" busy={e.busy} disabled={e.code.length !== 6}>{e.busy ? 'Checking…' : 'Confirm'}</EhrButton>
        </div>
      </form>
    </>
  )
}

/**
 * Choose a password: today's password step (ProviderEnrollment.tsx:1124-1155). The account is made only once the email
 * is confirmed and the CAC record's name has been shown. Confirm password is checked here and never sent; activation
 * sends the password alone.
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
      <ScreenHeading id="hid-ehr-signup-password-title">Choose a password</ScreenHeading>
      {/* The facility type and administrator are the confirmed code's (R6), shown so they can be checked too. */}
      <div className="hid-ehr-signup-registering">
        <p id="hid-ehr-signup-registering">{registering?.organizationName
          ? <>You’re registering <strong>{registering.organizationName}</strong>, CAC number {e.cacNumber}
            {registeringDetails(registering)}.</>
          : <>You’re registering the facility with CAC number {e.cacNumber}{registeringDetails(registering)}.</>}</p>
        {e.registeringFailed && <p>We couldn’t load its registered name. <EhrButton variant="quiet"
          className="hid-ehr-signup-inline" disabled={e.busy} onClick={() => void e.readRegisteringAgain()}>Try again</EhrButton></p>}
        <EhrButton variant="quiet" className="hid-ehr-signup-inline" disabled={e.busy}
          onClick={() => void e.notMine()}>This isn’t my facility</EhrButton>
      </div>
      <Alert e={e} />
      <form className="hid-ehr-signup-form" noValidate onSubmit={submit} aria-labelledby="hid-ehr-signup-password-title">
        <div className="hid-ehr-signup-fields">
          <p id="hid-ehr-signup-account-hint" className="hid-ehr-signup-hint">You’ll sign in with {e.accountEmail} and
            {' '}this password.</p>
          {/* Lets a password manager save the new password with its email. */}
          <input type="email" hidden readOnly autoComplete="username" value={e.accountEmail} />
          <PasswordField label="Password" controlId="hid-ehr-signup-password" required autoComplete="new-password"
            minLength={12} maxLength={256} aria-describedby="hid-ehr-signup-account-hint hid-ehr-signup-password-hint" value={e.password}
            onChange={event => e.setPassword(event.target.value)} />
          <PasswordField label="Confirm password" controlId="hid-ehr-signup-confirm" toggleLabel="Show password confirmation" required
            autoComplete="new-password"
            maxLength={256} value={confirm} error={mismatch ? 'The passwords don’t match.' : undefined}
            onChange={event => setConfirm(event.target.value)} />
          <PasswordRules id="hid-ehr-signup-password-hint" password={e.password} confirm={confirm} />
        </div>
        <div className="hid-ehr-signup-actions">
          <EhrButton type="submit" busy={e.busy} disabled={e.password.length < 12}>
            {e.busy ? 'Creating account…' : 'Create account'}
          </EhrButton>
        </div>
      </form>
    </>
  )
}

/**
 * Your facility is set up: today's ending on Novu (FacilityReady, ProviderEnrollment.tsx:1188-1208). The administrator
 * is signed in here, and in production signs in on the staff site of the facility's type from then on. What the type
 * opens, and when, was said where the type was chosen.
 */
export function FacilityReady({ e }: { readonly e: Enrollment }) {
  const hostname = window.location.hostname
  const type: OrganizationType = e.registering?.organizationType ?? e.organizationType
  const site = staffSignInHref(hostname) !== null ? staffSiteHostname(staffSiteForOrganizationType(type), hostname) : null
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-done-title">Your facility is set up</ScreenHeading>
      <p className="hid-ehr-signup-lede">{site
        ? `You’re signed in. Next time, sign in at ${site} with ${e.accountEmail}.`
        : `You’re signed in. Next time, sign in to the Provider Portal with ${e.accountEmail}.`}</p>
      <div className="hid-ehr-signup-actions">
        <EhrButton onClick={e.openWorkspace}>Open the Provider Portal</EhrButton>
      </div>
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
      <ScreenHeading id="hid-ehr-signup-sign-in-title">Your account may be ready</ScreenHeading>
      <p className="hid-ehr-signup-lede">We couldn’t confirm it, but your facility may be set up. Sign in
        with {e.accountEmail || 'your email'} and the password you chose. If you can’t, <SupportContact purpose="inline" /></p>
      <div className="hid-ehr-signup-actions"><SignInLink>Sign in to the Provider Portal</SignInLink></div>
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
        <div className="hid-ehr-signup-actions">
          <EhrButton onClick={e.anotherEmail}>Use another email</EhrButton>
        </div>
      </> : <p className="hid-ehr-signup-lede">{help.text} <SupportContact purpose="finish" /></p>}
    </>
  )
}

/** Facility sign-up is closed (ProviderEnrollment.tsx:995-1000). */
export function ClosedPanel() {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-closed-title">Facility sign-up isn’t open right now</ScreenHeading>
      <p className="hid-ehr-signup-lede">Facilities can’t sign themselves up at the moment. <SupportContact purpose="register" />
        {' '}If your facility already uses Health ID, sign in instead.</p>
    </>
  )
}

/** Identity could not tell whether sign-up is open (a fault): not closed, so it says so (ProviderEnrollment.tsx:1002-1008). */
export function UnavailablePanel({ e }: { readonly e: Enrollment }) {
  return (
    <>
      <ScreenHeading id="hid-ehr-signup-unavailable-title">Facility sign-up isn’t working right now</ScreenHeading>
      <p className="hid-ehr-signup-lede">This is a problem on our side. Please try again in a few
        minutes. <SupportContact purpose="persist" /></p>
      <div className="hid-ehr-signup-actions">
        <EhrButton onClick={e.checkAvailabilityAgain}>Try again</EhrButton>
      </div>
    </>
  )
}
