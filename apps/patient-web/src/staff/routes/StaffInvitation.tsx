import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input, PasswordInput } from '@hid/ui'
import './providerSetup.css'
import { AuthLayout } from '../../AuthLayout'
import { useDocumentTitle } from '../../authSteps'
import { Turnstile } from '../../Turnstile'
import { STAFF_JOIN_PATH, STAFF_SIGN_IN_PATH, staffHostForRole, staffPagesOrigin } from '../../productHostname'
import { getEnvironment } from '../env'
import { OpenStaffPage, sameStaffPageOn, staffSignInAddress } from '../../staffSignIn'
import { staffApi, staffInvitationApi, type StaffInvitationOpened, type StaffInvitationProof } from '../api'
import { invitationLinkOf, staffJoinAddress, type InvitationLink } from '../invitationCapture'
import { licenceBodyForRole, roleInSentence } from '../staffAccess'
import { isRouteMissing, joinProblemText } from '../staffProblems'

/**
 * Joining a facility by invitation (Novu, P4b SPEC 8.2), the page the invitation email links to on the staff site of
 * the invitee's role (each product site opens invitations itself; staging's portal and local too):
 * `/provider/invitation#<invitationId>.<token>`, or, without the link, the
 * email address and the 6-digit code. The page proves the invitation with Identity (Turnstile action
 * `staff-invitation`), shows who invited whom to what, and lets a new person, or one whose staff account works nowhere
 * now, set a password. Nobody is signed in here: they sign in on their role's site afterwards. Someone who already
 * works elsewhere on Health ID accepts signed in on their own site. Identity opens no invitation for a browser signed
 * in on the site: someone signed in there (staff of another facility, with the link from the email) is offered the
 * signed-in join page with the link, as before, or to sign out first (a shared computer).
 */

/** Where the page keeps the link once it has taken it out of the address: the browser's history entry. */
const HISTORY_KEY = 'hidStaffInvitation'

/** The link in the address, moved into this history entry so that a reload still has it; or the one kept there. */
function takeLinkFromAddress(): InvitationLink | null {
  const fromHash = invitationLinkOf(window.location.hash)
  const state = (window.history.state ?? {}) as Record<string, unknown>
  if (window.location.hash) {
    try {
      window.history.replaceState({ ...state, ...(fromHash ? { [HISTORY_KEY]: fromHash } : {}) }, '',
        `${window.location.pathname}${window.location.search}`)
    } catch { /* the address keeps it */ }
  }
  if (fromHash) return fromHash
  const kept = state[HISTORY_KEY] as Partial<InvitationLink> | undefined
  return kept && typeof kept.invitationId === 'string' && typeof kept.token === 'string'
    ? invitationLinkOf(`${kept.invitationId}.${kept.token}`) : null
}

function supportAddress(): string | null {
  let contact: string | null = null
  try { contact = getEnvironment().supportContact } catch { /* reported where the API is used */ }
  return contact?.startsWith('mailto:') ? contact.slice('mailto:'.length) : null
}

function SupportLink() {
  const address = supportAddress()
  return address ? <> at <a className="provider-setup-link" href={`mailto:${address}`}>{address}</a></> : null
}

/** "12 Oct 2026, 14:05". */
function when(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function FocusedHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <h2 id={id} ref={heading} tabIndex={-1} className="hid-mfa-heading">{children}</h2>
}

/** A link to sign in on the role's site: its own host in production and staging, this portal elsewhere. */
function SignInOnSite({ role, children }: { role: string; children: ReactNode }) {
  const host = staffHostForRole(role, window.location.hostname)
  return host ? <a className="patient-primary-button" href={`https://${host}${STAFF_SIGN_IN_PATH}`}>{children}</a>
    : <Link className="patient-primary-button" to={STAFF_SIGN_IN_PATH}>{children}</Link>
}

export function StaffInvitation() {
  useDocumentTitle('Join your facility · Health ID Provider')
  const location = useLocation()
  // A site that serves no staff pages (the production portal, an admin site) opens the EHR site's page at once, with
  // the link: hid-system accepts the invitation check there.
  const elsewhere = staffPagesOrigin(window.location.hostname)
  return elsewhere ? <OpenStaffPage href={sameStaffPageOn(elsewhere, location)} /> : <InvitationSteps />
}

function InvitationSteps() {
  const [link] = useState(takeLinkFromAddress)
  const [mode, setMode] = useState<'link' | 'code'>(link ? 'link' : 'code')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [opened, setOpened] = useState<StaffInvitationOpened | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState<{ facilityName: string; roleCode: string } | null>(null)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  // Identity refused to open the invitation because this browser is signed in on the site; then signed out here.
  const [signedInHere, setSignedInHere] = useState(false)
  const [signedOut, setSignedOut] = useState(false)

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !turnstileToken) return
    setError(''); setFieldError(''); setSignedOut(false)
    let proof: StaffInvitationProof
    if (mode === 'link' && link) proof = link
    else {
      const address = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !/^\d{6}$/.test(code)) {
        setFieldError('Enter the email address the invitation was sent to, and the 6-digit code from the email.')
        return
      }
      proof = { email: address, code }
    }
    setBusy(true)
    try {
      setOpened(await staffInvitationApi.open(proof, turnstileToken))
    } catch (caught) {
      if (isRouteMissing(caught)) setUnavailable(true)
      else if (isHidApiError(caught) && caught.code === 'STAFF_INVITATION_REQUIRES_SIGN_OUT') setSignedInHere(true)
      else setError(joinProblemText(caught, null))
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  /** Ends the session this browser holds on the site, then the invitation can be opened without an account. */
  async function signOutFirst() {
    if (busy) return
    setError(''); setBusy(true)
    try {
      await staffApi.logout()
      setSignedInHere(false); setSignedOut(true)
    } catch {
      setError('We couldn’t sign you out. Try again, or open the invitation in a private window.')
    } finally { setBusy(false) }
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !opened) return
    setError(''); setFieldError('')
    if (password.length < 12) { setFieldError('Choose a password of at least 12 characters.'); return }
    if (password !== confirm) { setFieldError('The two passwords don’t match.'); return }
    setBusy(true)
    try {
      const done = await staffInvitationApi.accept(password)
      setAccepted({ facilityName: done.facilityName || opened.facilityName, roleCode: done.roleCode || opened.roleCode })
      setPassword(''); setConfirm('')
    } catch (caught) {
      setPassword(''); setConfirm('')
      // The acceptance step has ended (an hour, or five tries): the invitation is opened again first.
      if (isHidApiError(caught) && caught.code === 'STAFF_INVITATION_SESSION_INVALID') setOpened(null)
      if (isHidApiError(caught) && caught.code === 'VALIDATION_FAILED') setFieldError('Choose a password of 12 to 256 characters.')
      else setError(joinProblemText(caught, opened.facilityName))
    } finally { setBusy(false) }
  }

  const title = accepted ? 'You’ve joined.' : 'Join your facility.'
  // Staff sign in on the EHR site from the production portal (staffSignIn.tsx), and on this site elsewhere.
  const signIn = staffSignInAddress()
  return <AuthLayout brandTo={signIn} brandLabel="Health ID provider sign in"
    headerLink={{ to: signIn, label: 'Sign in' }} title={title} titleId="staff-invitation-title"
    lede="Open the invitation your facility sent you, then set up your Health ID staff account.">
    {error && <p role="alert" className="patient-inline-error">{error}</p>}

    {unavailable && <section className="patient-form" aria-labelledby="staff-invitation-unavailable-title">
      <FocusedHeading id="staff-invitation-unavailable-title">Invitations aren’t available</FocusedHeading>
      <p className="patient-field-hint">Joining a facility by invitation isn’t available. Contact the facility that invited you.</p>
    </section>}

    {!unavailable && signedInHere && <SignedInHere link={mode === 'link' ? link : null} busy={busy}
      onSignOut={() => void signOutFirst()} />}

    {!unavailable && !signedInHere && !opened && !accepted && <form className="patient-form" noValidate onSubmit={event => void open(event)}>
      {signedOut && <p role="status" className="patient-field-hint">You’re signed out. Select Continue to open your invitation.</p>}
      <h2>{mode === 'link' ? 'Open your invitation' : 'Enter your invitation code'}</h2>
      {mode === 'link'
        ? <p className="patient-field-hint">Complete the security check, then select Continue to see who invited you.</p>
        : <>
          <p className="patient-field-hint">Use the email address the invitation was sent to and the 6-digit code in the email.</p>
          <Field label="Email address" htmlFor="staff-invitation-email">
            <Input id="staff-invitation-email" type="email" autoComplete="email" maxLength={254} value={email}
              onChange={event => setEmail(event.target.value)} />
          </Field>
          <Field label="Invitation code" htmlFor="staff-invitation-code">
            <Input id="staff-invitation-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
        </>}
      {fieldError && <p role="alert" className="patient-inline-error">{fieldError}</p>}
      <Turnstile action="staff-invitation" onTokenChange={setTurnstileToken} resetKey={resetKey} />
      <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken}>{busy ? 'Opening…' : 'Continue'}</button>
      {link && <button type="button" className="patient-text-button" onClick={() => { setError(''); setFieldError('')
        setMode(mode === 'link' ? 'code' : 'link') }}>{mode === 'link' ? 'I have a code' : 'Use the link from the email'}</button>}
    </form>}

    {!unavailable && opened && !accepted && <Opened opened={opened} link={mode === 'link' ? link : null} busy={busy}
      password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} fieldError={fieldError}
      onAccept={event => void accept(event)} />}

    {accepted && opened && <section className="patient-form" aria-labelledby="staff-invitation-done-title">
      <FocusedHeading id="staff-invitation-done-title">You’ve joined {accepted.facilityName}</FocusedHeading>
      <p className="patient-field-hint">{doneSentence(accepted.roleCode, opened.email)}</p>
      {licenceBodyForRole(accepted.roleCode) && <p className="patient-field-hint">Your facility administrator vouched for your
        licence; Health ID records it.</p>}
      <SignInOnSite role={accepted.roleCode}>Go to staff sign-in</SignInOnSite>
    </section>}
  </AuthLayout>
}

/**
 * This browser is signed in on the site, so Identity opens no invitation here. If it is the invited person (staff
 * elsewhere), they accept signed in on the join page, which takes the link from its address; if not, they sign out.
 */
function SignedInHere({ link, busy, onSignOut }: { link: InvitationLink | null; busy: boolean; onSignOut: () => void }) {
  return <section className="patient-form" aria-labelledby="staff-invitation-signed-in-title">
    <FocusedHeading id="staff-invitation-signed-in-title">You’re already signed in</FocusedHeading>
    <p className="patient-field-hint">Someone is signed in to Health ID in this browser. If it’s you, accept the invitation
      with your account.{link ? '' : ' You’ll enter the code from the invitation email again.'} If it’s someone else, or
      you don’t have a Health ID staff account yet, sign out first.</p>
    <a className="patient-primary-button" href={staffJoinAddress(link)}>Accept with my account</a>
    <button type="button" className="patient-secondary-button" disabled={busy} onClick={onSignOut}>
      {busy ? 'Signing out…' : 'Sign out first'}</button>
  </section>
}

/** "You can now sign in at ehr.healthidentitydirectory.com with … and your new password." */
function doneSentence(role: string, email: string): string {
  const host = staffHostForRole(role, window.location.hostname)
  return `You can now sign in ${host ? `at ${host}` : 'to the Provider Portal'} with ${email} and your new password.`
}

/** What the invitation is, and what this person does next, by who the invited email belongs to (P4b SPEC 4.7). */
function Opened({ opened, link, busy, password, confirm, onPassword, onConfirm, fieldError, onAccept }: {
  opened: StaffInvitationOpened; link: InvitationLink | null; busy: boolean; password: string; confirm: string
  onPassword: (value: string) => void; onConfirm: (value: string) => void; fieldError: string
  onAccept: (event: FormEvent<HTMLFormElement>) => void
}) {
  const inviter = opened.inviterName ?? 'The facility administrator'
  const expires = when(opened.expiresAt)
  const intro = <p className="patient-field-hint">{inviter} invited you to join <strong>{opened.facilityName}</strong> as
    {' '}{roleInSentence(opened.roleCode)}.{expires ? ` The invitation expires on ${expires}.` : ''}</p>
  const host = staffHostForRole(opened.roleCode, window.location.hostname)
  const site = host ?? 'the Provider Portal'

  if (opened.linkRequired) return <section className="patient-form" aria-labelledby="staff-invitation-opened-title">
    <FocusedHeading id="staff-invitation-opened-title">Open the link in the email</FocusedHeading>{intro}
    <p className="patient-field-hint">Open the link in the invitation email to set your new password.</p>
  </section>

  if (opened.accountCase === 'new' || opened.accountCase === 'dormant_staff') {
    const dormant = opened.accountCase === 'dormant_staff'
    return <form className="patient-form" noValidate onSubmit={onAccept} aria-labelledby="staff-invitation-opened-title">
      <FocusedHeading id="staff-invitation-opened-title">{dormant ? 'Set a new password' : 'Choose a password'}</FocusedHeading>
      {intro}
      <p id="staff-invitation-password-hint" className="patient-field-hint">{dormant
        ? `Your Health ID staff account ${opened.email} isn’t active at any facility now. Choose a new password of at least 12 `
          + `characters to use it at ${opened.facilityName}. Your old password will stop working.`
        : `Your Health ID staff account will use ${opened.email}. Choose a password of at least 12 characters.`}</p>
      {/* Lets a password manager save the new password with its email. */}
      <input type="email" hidden readOnly autoComplete="username" value={opened.email} />
      <Field label="Password" htmlFor="staff-invitation-password">
        <PasswordInput id="staff-invitation-password" autoComplete="new-password" minLength={12} maxLength={256} value={password}
          aria-describedby="staff-invitation-password-hint" onChange={event => onPassword(event.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="staff-invitation-confirm">
        <PasswordInput id="staff-invitation-confirm" autoComplete="new-password" minLength={12} maxLength={256} value={confirm}
          onChange={event => onConfirm(event.target.value)} />
      </Field>
      {fieldError && <p role="alert" className="patient-inline-error">{fieldError}</p>}
      <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Joining…' : `Join ${opened.facilityName}`}</button>
    </form>
  }

  if (opened.accountCase === 'existing_staff') {
    // The link goes on with its fragment to the person's own site, where they accept signed in; typed mode has no link.
    const join = `${host ? `https://${host}` : ''}${STAFF_JOIN_PATH}${link ? `#${link.invitationId}.${link.token}` : ''}`
    return <section className="patient-form" aria-labelledby="staff-invitation-opened-title">
      <FocusedHeading id="staff-invitation-opened-title">Sign in to accept</FocusedHeading>{intro}
      <p className="patient-field-hint">You already have a Health ID staff account. Sign in at {site} to accept. If you can’t sign
        in, reset your password there first.{link ? '' : ' Then enter the code from the invitation email.'}</p>
      <a className="patient-primary-button" href={join}>Sign in to accept</a>
    </section>
  }

  if (opened.accountCase === 'already_member') return <section className="patient-form" aria-labelledby="staff-invitation-opened-title">
    <FocusedHeading id="staff-invitation-opened-title">You already work there</FocusedHeading>
    <p className="patient-field-hint">You already work at {opened.facilityName} on Health ID.</p>
    <SignInOnSite role={opened.roleCode}>Go to staff sign-in</SignInOnSite>
  </section>

  if (opened.accountCase === 'patient_account') return <section className="patient-form" aria-labelledby="staff-invitation-opened-title">
    <FocusedHeading id="staff-invitation-opened-title">Use a work email</FocusedHeading>{intro}
    <p className="patient-field-hint">This email belongs to a Health ID patient account. Staff accounts need their own email: ask
      {' '}{opened.facilityName} to invite your work email.</p>
  </section>

  return <section className="patient-form" aria-labelledby="staff-invitation-opened-title">
    <FocusedHeading id="staff-invitation-opened-title">Contact Health ID support</FocusedHeading>{intro}
    <p className="patient-field-hint">This invitation can’t be accepted with this email’s account here. Contact Health ID
      support<SupportLink />.</p>
  </section>
}
