import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import type { PatientProfile } from '../api'
import { useSession } from '../session'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { describedBy, sentFromField, useStepFocus } from '../authSteps'
import { useAnnounceProfileChange } from '../profileChange'
import { maskEmail, maskPhone, oneLine, type EmailChangeStarted } from '../profileParity'
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, internationalPhone } from './enrollment/phoneCountries'
import { useActionFocus } from './actionFocus'
import { ItemName } from '../ItemName'

/** Which part of a step a refusal is about: focus goes there and its description names the error. */
type Field = 'value' | 'password' | 'code' | null

/** A code sent to a new email: Identity's answer, the address, and when the answer came (Date.now()). */
interface PendingEmail { change: EmailChangeStarted; email: string; sentAt: number }

/**
 * A step, or none open. Asking for a new code goes back to the address step (a new code needs the current password
 * again) and keeps the code already sent, which still works until a new one is sent: the patient can go back to it,
 * and does when Identity refuses the new one.
 */
type Step = { kind: 'idle' } | { kind: 'email'; pending?: PendingEmail } | { kind: 'email-code'; pending: PendingEmail } | { kind: 'phone' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * What a refused change means, in Identity's words where the contract gives them (hid-system 0094). A wrong password is
 * rate limited; a contact another account holds is refused with no further detail, so nothing is learned about it.
 */
export const CONTACT_REFUSALS: Readonly<Record<string, { message: string; field: Field }>> = {
  PASSWORD_INCORRECT: { message: 'That password is not right. Enter the password you sign in to Health ID with.', field: 'password' },
  CONTACT_UNAVAILABLE: { message: 'That email address or phone number can’t be used.', field: 'value' },
  PASSWORD_REQUIRED: { message: 'Set a password first to change your contact details.', field: null },
  OTP_INVALID_OR_EXPIRED: { message: 'That code is wrong or has expired. Check it and try again, or send a new code.', field: 'code' },
  PATIENT_RECENT_AUTH_REQUIRED: { message: 'For your security, sign out, sign in again, and return here within 10 minutes to change your contact details.', field: null },
}

function refusal(cause: unknown, step: Step['kind']): { message: string; field: Field } {
  if (!isHidApiError(cause)) return { message: 'Your contact details could not be changed. Try again.', field: null }
  const known = CONTACT_REFUSALS[cause.code]
  if (known) return known
  // Identity says how long: "Wait a moment before asking for another code.", "Try again in 15 minutes."
  if (cause.code === 'CONTACT_CHANGE_RATE_LIMITED' && cause.message) return { message: cause.message, field: null }
  if (cause.status === 429) return { message: 'Too many tries. Wait a few minutes, then try again.', field: null }
  if (cause.status === 400 || cause.status === 422) return { message: cause.message, field: step === 'email-code' ? 'code' : 'value' }
  return { message: cause.message, field: null }
}

function minutes(seconds: number) {
  const value = Math.max(1, Math.round(seconds / 60))
  return value === 1 ? '1 minute' : `${value} minutes`
}

/** A wait in words: seconds under two minutes, minutes above. */
function duration(seconds: number) {
  if (seconds >= 120) return minutes(seconds)
  const value = Math.max(1, Math.ceil(seconds))
  return value === 1 ? '1 second' : `${value} seconds`
}

/** The seconds left before Identity sends another code for this change (0 once it will), from its own answer. */
const secondsBeforeResend = ({ change, sentAt }: PendingEmail, now: number) =>
  Math.max(0, Math.ceil(change.resendAfterSeconds - (now - sentAt) / 1000))
/** Whether the code sent for this change still works by its expiry (a wrong code too many can end it sooner). */
const codeLive = ({ change, sentAt }: PendingEmail, now: number) => now - sentAt < change.expiresInSeconds * 1000

/**
 * "Contact details" on the profile (hid-1.0 parity B3, the lead's decisions): the account's email and phone, shown
 * masked, each with Change. A new email needs the current password and the 6-digit code sent to it; a new phone needs
 * the current password only (production sends no SMS) and is then shown as not verified. Either way the verified
 * email is told, and sign-in and recovery use the new contact from then on. Shown only where Identity sends them.
 */
export function ContactDetailsCard({ profile, onChanged }: { profile: PatientProfile; onChanged: () => Promise<unknown> }) {
  const { api } = useSession()
  const announce = useAnnounceProfileChange()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; field: Field; alert: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Said by Send a new code while Identity would not send one yet; focus stays on the button. */
  const [resendNote, setResendNote] = useState<string | null>(null)
  const stepFocus = useStepFocus()
  const focusAfter = useActionFocus()
  const heading = useRef<HTMLHeadingElement>(null)
  if (profile.email === undefined && profile.phone === undefined) return null
  // Identity tells the account's email of a phone change only while that email is verified.
  const phoneNoticeByEmail = Boolean(profile.email) && profile.emailVerified !== false

  const fieldRef = (field: Exclude<Field, null>) => (error?.field ?? (step.kind === 'email-code' ? 'code' : 'value')) === field ? stepFocus.target : undefined
  const invalid = (field: Exclude<Field, null>) => error?.field === field || undefined
  const errorFor = (field: Exclude<Field, null>) => error?.field === field ? 'contact-error' : undefined

  const open = (kind: 'email' | 'phone') => {
    setStep({ kind }); setError(null); setNotice(null); setResendNote(null); setPassword(''); setCode('')
    if (kind === 'email') setEmail('')
    else { setPhone(''); setPhoneCountry(DEFAULT_PHONE_COUNTRY) }
    stepFocus.focus()
  }
  const close = (back: 'email' | 'phone') => {
    setStep({ kind: 'idle' }); setError(null); setResendNote(null); setPassword(''); setCode('')
    focusAfter(() => document.getElementById(`contact-change-${back}`))
  }
  const refused = (cause: unknown, kind: Step['kind'], fromField: boolean) => {
    const problem = refusal(cause, kind)
    // Sent with Enter in a field, focus stays where it is: the refusal is then said as an alert.
    setError({ ...problem, alert: problem.field === null || fromField })
    if (problem.field === 'password') setPassword('')
    if (problem.field === 'code') setCode('')
  }

  const startEmail = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    const typed = email.trim()
    if (busy) return
    if (!EMAIL.test(typed)) { setError({ message: 'Enter an email address, like name@example.com.', field: 'value', alert: fromField }); stepFocus.focus(); return }
    if (profile.email && typed.toLowerCase() === profile.email.toLowerCase()) {
      setError({ message: 'This is already your email address.', field: 'value', alert: fromField }); stepFocus.focus(); return
    }
    if (!password) { setError({ message: 'Enter your current password.', field: 'password', alert: fromField }); stepFocus.focus(); return }
    setBusy(true); setError(null); setNotice(null)
    const pending = step.kind === 'email' ? step.pending : undefined
    try {
      const change = await api.startEmailChange(typed, password)
      setPassword(''); setCode('')
      setStep({ kind: 'email-code', pending: { change, email: typed, sentAt: Date.now() } })
    } catch (cause) {
      // A new code refused for now (Identity sends one a minute at most, five an hour): the one already sent still
      // works, so its step comes back with Identity's own words, rather than leaving the patient with no code to enter.
      if (pending && isHidApiError(cause) && cause.status === 429 && codeLive(pending, Date.now())) {
        setPassword(''); setCode('')
        setStep({ kind: 'email-code', pending })
        const wait = refusal(cause, 'email').message
        setError({ message: `${wait} The code we sent to ${pending.change.maskedContact} still works: enter it here.`, field: null, alert: true })
      } else refused(cause, 'email', fromField)
    } finally { setBusy(false); stepFocus.focus() }
  }

  /** Send a new code: before Identity would send one, says how long is left and stays; after, asks for the password again. */
  const askForNewCode = () => {
    if (step.kind !== 'email-code' || busy) return
    const wait = secondsBeforeResend(step.pending, Date.now())
    if (wait > 0) {
      setResendNote(`You can ask for a new code in ${duration(wait)}. The code we sent to ${step.pending.change.maskedContact} still works.`)
      return
    }
    setStep({ kind: 'email', pending: step.pending }); setEmail(step.pending.email)
    setError(null); setResendNote(null); setCode(''); setPassword(''); stepFocus.focus()
  }
  const backToCode = () => {
    if (step.kind !== 'email' || !step.pending || busy) return
    if (codeLive(step.pending, Date.now())) {
      setStep({ kind: 'email-code', pending: step.pending }); setError(null); setPassword(''); setCode('')
    } else {
      setStep({ kind: 'email' }); setError({ message: 'The code we sent has expired. Send a new code.', field: null, alert: true })
    }
    stepFocus.focus()
  }

  const verifyEmail = async (event: FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'email-code' || busy || !codeComplete(code)) return
    const fromField = sentFromField(event)
    setBusy(true); setError(null)
    try {
      const answer = await api.verifyEmailChange(step.pending.change.changeId, code)
      const now = typeof answer?.email === 'string' && answer.email ? answer.email : step.pending.email
      setStep({ kind: 'idle' }); setCode(''); setEmail(''); setResendNote(null)
      setNotice(`Your email address is now ${maskEmail(now)}. Use it to sign in and to reset your password.`
        + (profile.email ? ' We told your previous address.' : ''))
      await onChanged()
      announce()
      focusAfter(() => heading.current)
    } catch (cause) { refused(cause, 'email-code', fromField); stepFocus.focus() } finally { setBusy(false) }
  }

  const changePhone = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy) return
    const number = internationalPhone(phone, phoneCountry)
    if (number === null) {
      setError({ message: 'Enter a valid phone number for the country chosen, like 0801 234 5678 for Nigeria, or start it with + and the country code.',
        field: 'value', alert: fromField })
      stepFocus.focus(); return
    }
    if (profile.phone && number === profile.phone) { setError({ message: 'This is already your phone number.', field: 'value', alert: fromField }); stepFocus.focus(); return }
    if (!password) { setError({ message: 'Enter your current password.', field: 'password', alert: fromField }); stepFocus.focus(); return }
    setBusy(true); setError(null); setNotice(null)
    try {
      const answer = await api.changePhone(number, password)
      setStep({ kind: 'idle' }); setPassword(''); setPhone('')
      setNotice(`Your phone number is now ${maskPhone(answer.phone)}. It shows as not verified, because Health ID can’t send it a text yet.`
        + (phoneNoticeByEmail ? ' We emailed your verified address about the change.' : ''))
      await onChanged()
      announce()
      focusAfter(() => heading.current)
    } catch (cause) { refused(cause, 'phone', fromField); stepFocus.focus() } finally { setBusy(false) }
  }

  const errorLine = error && <p id="contact-error" role={error.alert ? 'alert' : undefined} className="patient-inline-error">{error.message}</p>
  const passwordField = <div className="patient-field"><label htmlFor="contact-password">Current password</label>
    <PasswordInput appearance="plain" id="contact-password" ref={fieldRef('password')} autoComplete="current-password" value={password}
      onChange={event => { setPassword(event.target.value); if (error?.field === 'password') setError(null) }}
      aria-invalid={invalid('password')} aria-describedby={describedBy('contact-password-hint', errorFor('password'))} />
    <p id="contact-password-hint" className="patient-field-hint">The password you sign in to Health ID with, to confirm it is you.</p></div>

  return <div className="patient-card" id="contact-details" aria-busy={busy || undefined}>
    <h2 ref={heading} tabIndex={-1}>Contact details</h2>
    <p className="patient-field-hint">You sign in and reset your password with these. Each is shown in part, to keep it private.</p>
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <dl className="patient-details">
      <div><dt>Email</dt><dd>{profile.email ? maskEmail(profile.email) : 'No email address'}
        {/* Health ID sends nothing to an address that was never confirmed (one kept from hid-1.0). */}
        {profile.email && profile.emailVerified === false && <> <span className="patient-status-tag">Not verified</span></>}</dd>
        {step.kind === 'idle' && <dd><button id="contact-change-email" type="button" className="patient-secondary-button" disabled={busy}
          onClick={() => open('email')}>{profile.email ? 'Change' : 'Add'} <ItemName>email address</ItemName></button></dd>}</div>
      <div><dt>Phone</dt><dd>{profile.phone ? maskPhone(profile.phone) : 'No phone number'}
        {profile.phone && <> <span className={profile.phoneVerified ? 'patient-status-tag patient-status-tag-ok' : 'patient-status-tag'}>
          {profile.phoneVerified ? 'Verified' : 'Not verified'}</span></>}</dd>
        {step.kind === 'idle' && <dd><button id="contact-change-phone" type="button" className="patient-secondary-button" disabled={busy}
          onClick={() => open('phone')}>{profile.phone ? 'Change' : 'Add'} <ItemName>phone number</ItemName></button></dd>}</div>
    </dl>

    {step.kind === 'email' && <form className="patient-form patient-contact-form" onSubmit={event => void startEmail(event)} noValidate>
      <h3>New email address</h3>
      {errorLine}
      <label>New email address<input ref={fieldRef('value')} type="email" autoComplete="email" maxLength={254} value={email}
        onChange={event => { setEmail(oneLine(event.target.value)); if (error?.field === 'value') setError(null) }}
        aria-invalid={invalid('value')} aria-describedby={describedBy('contact-email-hint', errorFor('value'))} /></label>
      <p id="contact-email-hint" className="patient-field-hint">We will send a 6-digit code to this address. Your email changes once you enter it.</p>
      {passwordField}
      <div className="patient-decision-actions">
        <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        {step.pending && <button type="button" className="patient-secondary-button" disabled={busy}
          onClick={backToCode}>Enter the code already sent</button>}
        <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => close('email')}>Cancel</button>
      </div>
    </form>}

    {step.kind === 'email-code' && <form className="patient-form patient-contact-form" onSubmit={event => void verifyEmail(event)}>
      <h3>Enter the code</h3>
      <p id="contact-code-hint" className="patient-field-hint">We sent a 6-digit code to {step.pending.change.maskedContact}. It works for
        {' '}{minutes(step.pending.change.expiresInSeconds)}.</p>
      {errorLine}
      <CodeBoxes id="contact-code" label="Code from your new email" value={code} busy={busy} inputRef={fieldRef('code')}
        onChange={value => { setCode(value); if (error?.field === 'code') setError(null) }}
        invalid={invalid('code')} describedBy={describedBy('contact-code-hint', errorFor('code'))} />
      <div className="patient-decision-actions">
        <button type="submit" className="patient-primary-button" disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Confirm'}</button>
        <button type="button" className="patient-secondary-button" disabled={busy} onClick={askForNewCode}>Send a new code</button>
        <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => close('email')}>Cancel</button>
      </div>
      <div role="status">{resendNote && <p className="patient-field-hint">{resendNote}</p>}</div>
    </form>}

    {step.kind === 'phone' && <form className="patient-form patient-contact-form" onSubmit={event => void changePhone(event)} noValidate>
      <h3>New phone number</h3>
      {errorLine}
      <div className="patient-phone-field">
        <label>Country code<select autoComplete="tel-country-code" value={phoneCountry} onChange={event => setPhoneCountry(event.target.value)}>
          {PHONE_COUNTRIES.map(country => <option key={country.iso} value={country.iso}>{country.name} (+{country.code})</option>)}
        </select></label>
        <label>Phone number<input ref={fieldRef('value')} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={24} value={phone}
          onChange={event => { setPhone(event.target.value.replace(/[^\d+\s().-]/g, '')); if (error?.field === 'value') setError(null) }}
          aria-invalid={invalid('value')} aria-describedby={describedBy('contact-phone-hint', errorFor('value'))} /></label>
      </div>
      <p id="contact-phone-hint" className="patient-field-hint">Choose your country, then enter your number. Health ID can’t text it
        yet, so it will show as not verified{phoneNoticeByEmail ? '; we email your verified address to say it changed' : ''}.</p>
      {passwordField}
      <div className="patient-decision-actions">
        <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Saving…' : 'Change phone number'}</button>
        <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => close('phone')}>Cancel</button>
      </div>
    </form>}
  </div>
}
