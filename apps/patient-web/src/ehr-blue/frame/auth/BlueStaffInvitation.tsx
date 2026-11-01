import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { Alert, Button, buttonClass } from '../../../kasuwa/ui'
import { useDocumentTitle } from '../../../authSteps'
import { Turnstile } from '../../../Turnstile'
import { STAFF_JOIN_PATH, STAFF_SIGN_IN_PATH, staffHostForRole, staffPagesOrigin } from '../../../productHostname'
import { OpenStaffPage, sameStaffPageOn } from '../../../staffSignIn'
import { getEnvironment } from '../../../staff/env'
import { staffInvitationApi, type StaffInvitationOpened, type StaffInvitationProof } from '../../../staff/api'
import { invitationLinkOf, type InvitationLink } from '../../../staff/invitationCapture'
import { licenceBodyForRole, roleInSentence } from '../../../staff/staffAccess'
import { isRouteMissing, joinProblemText } from '../../../staff/staffProblems'
import { BlueAuthLayout, NOTE } from './BlueAuthLayout'

/*
 * Joining a facility by invitation, in the redesign's auth look, working as today's page does
 * (staff/routes/StaffInvitation.tsx): the link from the email, or the email address and 6-digit code, proven with
 * Turnstile (action staff-invitation); who invited whom to what; a password for a new or dormant account; signed-in
 * acceptance on the person's own site for existing staff; and today's refusals. Each product site opens invitations
 * itself (hid-system accepts staff-invitation there, and the email links to the site of the invitee's role); a site
 * that serves no staff pages (the production patient portal, an admin site) opens the EHR site's page at once, with
 * the link. The page's private helpers are copied
 * below, word for word, until both pages share them (README.md). App.tsx opens it at /provider/invitation in place of
 * today's page once the clinic switch is on (BLUE_FOR_ALL).
 */

/** Where the page keeps the link once it has taken it out of the address: the browser's history entry, as today's does. */
const HISTORY_KEY = 'hidStaffInvitation'

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
  return address ? <> at <a href={`mailto:${address}`}>{address}</a></> : null
}

function when(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function FocusedHeading({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <h2 id={id} ref={heading} tabIndex={-1}>{children}</h2>
}

function SignInOnSite({ role, children }: { readonly role: string; readonly children: ReactNode }) {
  const host = staffHostForRole(role, window.location.hostname)
  const className = buttonClass({ variant: 'primary', size: 'lg', block: true })
  return host ? <a className={className} href={`https://${host}${STAFF_SIGN_IN_PATH}`}>{children}</a>
    : <Link className={className} to={STAFF_SIGN_IN_PATH}>{children}</Link>
}

export function BlueStaffInvitation() {
  useDocumentTitle('Accept your invitation · Health ID Hospital EHR')
  const location = useLocation()
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

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !turnstileToken) return
    setError(''); setFieldError('')
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
      else setError(joinProblemText(caught, null))
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
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
      if (isHidApiError(caught) && caught.code === 'STAFF_INVITATION_SESSION_INVALID') setOpened(null)
      if (isHidApiError(caught) && caught.code === 'VALIDATION_FAILED') setFieldError('Choose a password of 12 to 256 characters.')
      else setError(joinProblemText(caught, opened.facilityName))
    } finally { setBusy(false) }
  }

  return (
    <BlueAuthLayout title={accepted ? 'You’ve joined.' : 'Accept your invitation'} titleId="blue-invitation-title"
      lede="Open the invitation your facility sent, then set up your staff account.">
      {error ? <Alert intent="error" size="sm">{error}</Alert> : null}

      {unavailable ? (
        <section className="staff-form" aria-labelledby="blue-invitation-unavailable-title">
          <FocusedHeading id="blue-invitation-unavailable-title">Invitations aren’t available yet</FocusedHeading>
          <p className={NOTE}>Joining a facility by invitation isn’t available on Health ID yet. Please try again later.</p>
        </section>
      ) : null}

      {!unavailable && !opened && !accepted ? (
        <form className="staff-form" noValidate onSubmit={event => void open(event)}>
          <h2>{mode === 'link' ? 'Open your invitation' : 'Enter your invitation code'}</h2>
          {mode === 'link'
            ? <p className={NOTE}>Complete the security check, then select Continue to see who invited you.</p>
            : <>
              <p className={NOTE}>Use the email address the invitation was sent to and the 6-digit code in the email.</p>
              <div className="auth-field-label">
                <label htmlFor="blue-invitation-email">Email address</label>
                <input id="blue-invitation-email" type="email" autoComplete="email" maxLength={254} value={email}
                  onChange={event => setEmail(event.target.value)} />
              </div>
              <div className="auth-field-label">
                <label htmlFor="blue-invitation-code">Invitation code</label>
                <input id="blue-invitation-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              </div>
            </>}
          {fieldError ? <Alert intent="error" size="sm">{fieldError}</Alert> : null}
          <Turnstile action="staff-invitation" onTokenChange={setTurnstileToken} resetKey={resetKey} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !turnstileToken}>{busy ? 'Opening…' : 'Continue'}</Button>
          {link ? (
            <Button variant="ghost" className="self-start" onClick={() => { setError(''); setFieldError(''); setMode(mode === 'link' ? 'code' : 'link') }}>
              {mode === 'link' ? 'I have a code' : 'Use the link from the email'}
            </Button>
          ) : null}
        </form>
      ) : null}

      {!unavailable && opened && !accepted ? (
        <Opened opened={opened} link={mode === 'link' ? link : null} busy={busy} password={password} confirm={confirm}
          onPassword={setPassword} onConfirm={setConfirm} fieldError={fieldError} onAccept={event => void accept(event)} />
      ) : null}

      {accepted && opened ? (
        <section className="staff-form" aria-labelledby="blue-invitation-done-title">
          <FocusedHeading id="blue-invitation-done-title">You’ve joined {accepted.facilityName}</FocusedHeading>
          <p className={NOTE}>{doneSentence(accepted.roleCode, opened.email)}</p>
          {licenceBodyForRole(accepted.roleCode)
            ? <p className={NOTE}>Your facility administrator vouched for your licence; Health ID records it.</p> : null}
          <SignInOnSite role={accepted.roleCode}>Go to staff sign-in</SignInOnSite>
        </section>
      ) : null}
    </BlueAuthLayout>
  )
}

function doneSentence(role: string, email: string): string {
  const host = staffHostForRole(role, window.location.hostname)
  return `You can now sign in ${host ? `at ${host}` : 'to the Provider Portal'} with ${email} and your new password.`
}

/** What the invitation is, and what this person does next, by who the invited email belongs to. */
function Opened({ opened, link, busy, password, confirm, onPassword, onConfirm, fieldError, onAccept }: {
  readonly opened: StaffInvitationOpened; readonly link: InvitationLink | null; readonly busy: boolean; readonly password: string
  readonly confirm: string; readonly onPassword: (value: string) => void; readonly onConfirm: (value: string) => void
  readonly fieldError: string; readonly onAccept: (event: FormEvent<HTMLFormElement>) => void
}) {
  const inviter = opened.inviterName ?? 'The facility administrator'
  const expires = when(opened.expiresAt)
  const intro = <p className={NOTE}>{inviter} invited you to join <strong>{opened.facilityName}</strong> as
    {' '}{roleInSentence(opened.roleCode)}.{expires ? ` The invitation expires on ${expires}.` : ''}</p>
  const host = staffHostForRole(opened.roleCode, window.location.hostname)
  const site = host ?? 'the Provider Portal'

  if (opened.linkRequired) {
    return (
      <section className="staff-form" aria-labelledby="blue-invitation-opened-title">
        <FocusedHeading id="blue-invitation-opened-title">Open the link in the email</FocusedHeading>{intro}
        <p className={NOTE}>Open the link in the invitation email to set your new password.</p>
      </section>
    )
  }

  if (opened.accountCase === 'new' || opened.accountCase === 'dormant_staff') {
    const dormant = opened.accountCase === 'dormant_staff'
    return (
      <form className="staff-form" noValidate onSubmit={onAccept} aria-labelledby="blue-invitation-opened-title">
        <FocusedHeading id="blue-invitation-opened-title">{dormant ? 'Set a new password' : 'Choose a password'}</FocusedHeading>
        {intro}
        <p id="blue-invitation-password-hint" className={NOTE}>{dormant
          ? `Your Health ID staff account ${opened.email} isn’t active at any facility now. Choose a new password of at least 12 `
            + `characters to use it at ${opened.facilityName}. Your old password will stop working.`
          : `Your Health ID staff account will use ${opened.email}. Choose a password of at least 12 characters.`}</p>
        {/* Lets a password manager save the new password with its email. */}
        <input type="email" hidden readOnly autoComplete="username" value={opened.email} />
        <div className="auth-field-label">
          <label htmlFor="blue-invitation-password">Password</label>
          <PasswordInput appearance="plain" id="blue-invitation-password" autoComplete="new-password" minLength={12} maxLength={256} value={password}
            aria-describedby="blue-invitation-password-hint" onChange={event => onPassword(event.target.value)} />
        </div>
        <div className="auth-field-label">
          <label htmlFor="blue-invitation-confirm">Confirm password</label>
          <PasswordInput appearance="plain" id="blue-invitation-confirm" toggleLabel="Show confirmed password" autoComplete="new-password"
            minLength={12} maxLength={256} value={confirm} onChange={event => onConfirm(event.target.value)} />
        </div>
        {fieldError ? <Alert intent="error" size="sm">{fieldError}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy}>{busy ? 'Joining…' : `Join ${opened.facilityName}`}</Button>
      </form>
    )
  }

  if (opened.accountCase === 'existing_staff') {
    const join = `${host ? `https://${host}` : ''}${STAFF_JOIN_PATH}${link ? `#${link.invitationId}.${link.token}` : ''}`
    return (
      <section className="staff-form" aria-labelledby="blue-invitation-opened-title">
        <FocusedHeading id="blue-invitation-opened-title">Sign in to accept</FocusedHeading>{intro}
        <p className={NOTE}>You already have a Health ID staff account. Sign in at {site} to accept. If you can’t sign
          in, reset your password there first.{link ? '' : ' Then enter the code from the invitation email.'}</p>
        <a className={buttonClass({ variant: 'primary', size: 'lg', block: true })} href={join}>Sign in to accept</a>
      </section>
    )
  }

  if (opened.accountCase === 'already_member') {
    return (
      <section className="staff-form" aria-labelledby="blue-invitation-opened-title">
        <FocusedHeading id="blue-invitation-opened-title">You already work there</FocusedHeading>
        <p className={NOTE}>You already work at {opened.facilityName} on Health ID.</p>
        <SignInOnSite role={opened.roleCode}>Go to staff sign-in</SignInOnSite>
      </section>
    )
  }

  if (opened.accountCase === 'patient_account') {
    return (
      <section className="staff-form" aria-labelledby="blue-invitation-opened-title">
        <FocusedHeading id="blue-invitation-opened-title">Use a work email</FocusedHeading>{intro}
        <p className={NOTE}>This email belongs to a Health ID patient account. Staff accounts need their own email: ask
          {' '}{opened.facilityName} to invite your work email.</p>
      </section>
    )
  }

  return (
    <section className="staff-form" aria-labelledby="blue-invitation-opened-title">
      <FocusedHeading id="blue-invitation-opened-title">Contact Health ID support</FocusedHeading>{intro}
      <p className={NOTE}>This invitation can’t be accepted with this email’s account here. Contact Health ID
        support<SupportLink />.</p>
    </section>
  )
}
