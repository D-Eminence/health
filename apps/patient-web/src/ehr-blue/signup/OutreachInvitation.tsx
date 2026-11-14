import '@hid/ui/ehr.css'
import './signup.css'
import { useState, type FormEvent } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { useDocumentTitle } from '../../authSteps'
import { STAFF_SIGN_IN_PATH, staffRecoveryHref, staffSignInHref } from '../../productHostname'
import { outreachOrganiserApi, staffApi, type OutreachInvitationDevice } from '../../staff/api'
import { announceStaffSessionChange } from '../../staff/session'
import { Turnstile } from '../../Turnstile'
import { INVITED_PATIENT_LOGIN, isOutreachProblem, outreachProblemText } from '../../outreachProblems'
import { outreachInviteLinkSignInEnabled } from './outreachLinkSignIn'
import { PasswordField } from './PasswordField'
import { Required, ScreenHeading } from './parts'
import { SignupShell } from './SignupShell'

const FALLBACK = 'The invitation could not be accepted. Please try again.'
/** Without the whole link there is nothing to accept with: the email carries no code. */
export const NEEDS_LINK = 'This page needs the full link from your invitation email. Open the link again, or copy all of it into your browser.'
/** The link's fragment: `#<invitationId>.<token>` (notification-api outreachInvitationContent). */
const LINK = /^#?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i

/** The invitation the link carries, read once; the fragment then leaves the address. */
export function readOutreachInvitationLink(hash: string): { invitationId: string; token: string } | null {
  const match = LINK.exec(hash)
  return match ? { invitationId: match[1]!.toLowerCase(), token: match[2]! } : null
}

/** Where the page keeps the link once it has taken it out of the address (link sign-in on): the history entry, as
 * BlueStaffInvitation.tsx does, so a reload does not lose it. Never in storage that outlives the tab. */
const HISTORY_KEY = 'hidOutreachInvitation'

type InvitationLink = { invitationId: string; token: string }

/** Today's reading: the fragment, once; the address is then cleaned and nothing is kept. */
function takeLinkOnce(): InvitationLink | null {
  const read = readOutreachInvitationLink(window.location.hash)
  if (read) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  return read
}

/** With link sign-in on: the fragment, kept in the history entry; or, after a reload, the one the entry kept. */
function takeLinkKept(): InvitationLink | null {
  const fromHash = readOutreachInvitationLink(window.location.hash)
  const state = (window.history.state ?? {}) as Record<string, unknown>
  if (window.location.hash) {
    try {
      window.history.replaceState({ ...state, ...(fromHash ? { [HISTORY_KEY]: fromHash } : {}) }, '',
        window.location.pathname + window.location.search)
    } catch { /* the address keeps it */ }
  }
  if (fromHash) return fromHash
  const kept = state[HISTORY_KEY] as Partial<InvitationLink> | undefined
  return kept && typeof kept.invitationId === 'string' && typeof kept.token === 'string'
    ? readOutreachInvitationLink(`${kept.invitationId}.${kept.token}`) : null
}

/** The link is used once: after joining, the history entry no longer holds it. */
function forgetKeptLink(): void {
  const state = window.history.state as Record<string, unknown> | null
  if (!state || !(HISTORY_KEY in state)) return
  const rest = { ...state }
  delete rest[HISTORY_KEY]
  try { window.history.replaceState(rest, '', window.location.pathname + window.location.search) } catch { /* nothing kept */ }
}

/** A backend without accept-link, or with its switch off, answers 404: the page then offers today's password form. */
function linkSignInMissing(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 404 && (caught.code === 'NOT_FOUND' || caught.code === 'API_ROUTE_NOT_FOUND')
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Whether the session Identity gave lasts more than a day: only then does the page say the phone stays signed in. */
function staysSignedInLong(expiresAt: string | undefined): boolean {
  const ends = expiresAt ? Date.parse(expiresAt) : Number.NaN
  return Number.isFinite(ends) && ends - Date.now() > DAY_MS
}

type Outcome = { kind: 'joined' } | { kind: 'signed-in'; staysLong: boolean } | { kind: 'sign-in-next' }

/** A refusal in plain words: a patient's login is told to ask for another email, whichever code Identity names it with. */
function invitationProblemText(caught: unknown): string {
  return isOutreachProblem(caught, 'OUTREACH_PATIENT_LOGIN') ? INVITED_PATIENT_LOGIN : outreachProblemText(caught, FALLBACK)
}

/**
 * An outreach invitation (open sign-up on outreach.): a helper the organiser invited joins the group as an outreach
 * volunteer. Someone new sets a password and is signed in; someone with a Health ID login accepts with it, signed in
 * (owner decision 5: the same login can work at a hospital and help an outreach group). The link's token is read from
 * the address once and kept in memory only. The email has no code (notification-api accepts outreach invitations by link
 * only), so without a whole link the page says to open the link again and offers nothing to send.
 *
 * Password-free joining (passwordless plan, phase 1; off unless the build turns it on, outreachLinkSignIn.ts): the first
 * screen is two "Join" buttons, own phone or shared phone, that accept with the link alone and sign this phone in
 * (identity-api accept-link). The link is then kept in the history entry, so a reload does not lose it, until it is used.
 * A backend without accept-link answers 404 and the page shows today's password form, with the same security check.
 */
export function OutreachInvitation() {
  useDocumentTitle('Accept an invitation · Health ID Outreach')
  // Read once: a build's switch does not change while the page is open.
  const [linkSignIn] = useState(outreachInviteLinkSignInEnabled)
  const [link] = useState(() => linkSignIn ? takeLinkKept() : takeLinkOnce())
  // With link sign-in on, the first screen is the "Join" buttons; the password form follows only if Identity has no
  // accept-link (404). Off, the page is today's.
  const [mode, setMode] = useState<'link' | 'password'>(linkSignIn ? 'link' : 'password')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problems, setProblems] = useState<Partial<Record<string, string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  // Identity's answer does not name the group, so the page says "the outreach group".
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const signIn = staffSignInHref(window.location.hostname) ?? STAFF_SIGN_IN_PATH
  const joined = () => { forgetKeptLink(); setOutcome({ kind: 'joined' }) }

  async function acceptByLink(device: OutreachInvitationDevice) {
    if (busy || !link) return
    setError('')
    setProblems({})
    if (!turnstileToken) { setError('Complete the security check, then try again.'); return }
    setBusy(true)
    // A 404 is answered before the security check is used, so the same check goes on to the password form.
    let keepCheck = false
    try {
      const answer = await outreachOrganiserApi.acceptInvitationByLink(link, device, turnstileToken)
      forgetKeptLink()
      if (answer.signedIn === true) {
        announceStaffSessionChange()
        setOutcome({ kind: 'signed-in', staysLong: staysSignedInLong(answer.expiresAt) })
      } else {
        setOutcome({ kind: 'sign-in-next' })
      }
    } catch (caught) {
      if (linkSignInMissing(caught)) {
        keepCheck = true
        setMode('password')
      } else {
        setError(invitationProblemText(caught))
      }
    } finally {
      setBusy(false)
      if (!keepCheck) {
        setTurnstileToken(null)
        setResetKey(key => key + 1)
      }
    }
  }

  async function acceptNew(event: FormEvent) {
    event.preventDefault()
    if (busy || !link) return
    setError('')
    const found: Record<string, string> = {}
    if (password.length < 12) found.password = 'Use at least 12 characters.'
    if (confirm !== password) found.confirm = 'The two passwords are not the same.'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    if (!turnstileToken) { setError('Complete the security check, then try again.'); return }
    setBusy(true)
    try {
      await outreachOrganiserApi.acceptInvitation(link, password, turnstileToken)
      setPassword('')
      setConfirm('')
      joined()
    } catch (caught) {
      setError(invitationProblemText(caught))
    } finally {
      setBusy(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  async function acceptSignedIn() {
    if (busy || !link) return
    setError('')
    setProblems({})
    setBusy(true)
    try {
      await staffApi.acceptOutreachInvitationSignedIn(link)
      joined()
    } catch (caught) {
      setError(isHidApiError(caught) && caught.status === 401
        ? 'Sign in with your Health ID login first, then open the invitation link again.'
        : invitationProblemText(caught))
    } finally { setBusy(false) }
  }

  const story = { eyebrow: 'Health ID — Outreach', title: <>Help register people<br />at outreach events.</>,
    text: 'Join an outreach group’s team on Health ID.' }
  const footer = <p>Helpers register people at the group’s events. They can’t see any hospital’s records.</p>
  if (outcome?.kind === 'signed-in') {
    return <SignupShell centered footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-done">You’re in.</ScreenHeading>
      <p className="hid-ehr-signup-intro">You have joined the outreach group. You can now register people at the group’s
        campaigns.</p>
      {outcome.staysLong
        ? <p className="hid-ehr-signup-muted">This phone stays signed in for up to 30 days unless you sign out.</p> : null}
      <a className="hid-ehr-button hid-ehr-signup-wide" href="/provider/outreach">Open Outreach</a>
    </SignupShell>
  }
  if (outcome?.kind === 'sign-in-next') {
    return <SignupShell centered footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-done">You’ve joined. Sign in to start.</ScreenHeading>
      <p className="hid-ehr-signup-intro">You have joined the outreach group, but this phone could not be signed in.</p>
      <p className="hid-ehr-signup-muted">You don’t have a password yet. Choose “Set a password”, and we’ll email you a
        code to set one. Then sign in.</p>
      <a className="hid-ehr-button hid-ehr-signup-wide" href={staffRecoveryHref(window.location.hostname)}>Set a password</a>
      <p className="hid-ehr-signup-muted"><a className="hid-ehr-signup-link" href={signIn}>Sign in</a></p>
    </SignupShell>
  }
  if (outcome) {
    return <SignupShell centered footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-done">You have joined the outreach group</ScreenHeading>
      <p className="hid-ehr-signup-intro">You can now register people at the group’s campaigns. If you also work at a hospital,
        use Switch facility to move between them.</p>
      <a className="hid-ehr-button hid-ehr-signup-wide" href="/provider/outreach">Open Outreach</a>
    </SignupShell>
  }
  if (!link) {
    return <SignupShell centered footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-title">Join an outreach group</ScreenHeading>
      <p className="hid-ehr-signup-intro">{NEEDS_LINK}</p>
    </SignupShell>
  }
  const byLink = mode === 'link'
  // One form, so the security check stays the same widget, with its answer, when the "Join" buttons give way to the
  // password form (a 404 from a backend without accept-link). With link sign-in off it is today's form exactly.
  return (
    <SignupShell footer={footer} story={story}>
      <ScreenHeading key={mode} id="outreach-invitation-title">{byLink ? 'Join the outreach team' : 'Join an outreach group'}</ScreenHeading>
      <p className="hid-ehr-signup-intro">An outreach group’s organiser invited you to help register people at their events.</p>
      {byLink ? <p className="hid-ehr-signup-intro">Tap a button to accept. This phone will be signed in to Health ID Outreach.
        The link works once.</p> : null}

      <form className="hid-ehr-signup-form" noValidate onSubmit={event => { if (byLink) event.preventDefault(); else void acceptNew(event) }}
        aria-labelledby={byLink ? 'outreach-invitation-title' : 'outreach-invitation-new'}>
        {byLink ? null : <h2 id="outreach-invitation-new" className="hid-ehr-signup-step-title">New to Health ID? Choose a password</h2>}
        {byLink ? null : <PasswordField label={<Required>Password</Required>} controlId="outreach-invitation-password" error={problems.password}
          hint="At least 12 characters. Don’t use a password you use anywhere else." autoComplete="new-password"
          value={password} onChange={event => setPassword(event.target.value)} />}
        {byLink ? null : <PasswordField label={<Required>Type the password again</Required>} controlId="outreach-invitation-confirm" error={problems.confirm}
          toggleLabel="Show password confirmation" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />}
        <div className="hid-ehr-signup-actions">
          <div className="hid-ehr-signup-turnstile">
            <Turnstile action="outreach-invitation" onTokenChange={setTurnstileToken} resetKey={resetKey} />
          </div>
          {byLink ? null : <EhrButton type="submit" busy={busy}>Join the group</EhrButton>}
          {byLink ? <EhrButton busy={busy} onClick={() => void acceptByLink('own')}>Join – this is my own phone (keep me signed in)</EhrButton> : null}
          {byLink ? <EhrButton variant="secondary" busy={busy} onClick={() => void acceptByLink('shared')}>
            Join on a shared phone (sign me out after 15 minutes)</EhrButton> : null}
        </div>
      </form>

      <section aria-labelledby="outreach-invitation-existing" className="hid-ehr-signup-form">
        <h2 id="outreach-invitation-existing" className="hid-ehr-signup-step-title">Already have a Health ID login?</h2>
        <p className="hid-ehr-signup-muted">Sign in first (<a className="hid-ehr-signup-link" href={signIn}>Sign in</a>), then open
          the invitation link again and choose “Join with my login”. Your hospital work, if any, stays as it is.</p>
        <EhrButton variant="secondary" busy={busy} onClick={() => void acceptSignedIn()}>Join with my login</EhrButton>
      </section>
      {error ? <p role="alert" className="hid-ehr-signup-alert">{error}</p> : null}
    </SignupShell>
  )
}
