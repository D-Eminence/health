import '@hid/ui/ehr.css'
import './signup.css'
import { useState, type FormEvent } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { useDocumentTitle } from '../../authSteps'
import { STAFF_SIGN_IN_PATH, staffSignInHref } from '../../productHostname'
import { outreachOrganiserApi, staffApi } from '../../staff/api'
import { Turnstile } from '../../Turnstile'
import { outreachProblemText } from '../../outreachProblems'
import { PasswordField } from './PasswordField'
import { Required, ScreenHeading } from './parts'
import { SignupShell } from './SignupShell'

const FALLBACK = 'The invitation could not be accepted. Please try again.'
/** The link's fragment: `#<invitationId>.<token>` (notification-api outreachInvitationContent). */
const LINK = /^#?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i

/** The invitation the link carries, read once; the fragment then leaves the address. */
export function readOutreachInvitationLink(hash: string): { invitationId: string; token: string } | null {
  const match = LINK.exec(hash)
  return match ? { invitationId: match[1]!.toLowerCase(), token: match[2]! } : null
}

type Done = { facilityName?: string; signedIn: boolean }

/**
 * An outreach invitation (open sign-up on outreach.): a helper the organiser invited joins the group as an outreach
 * volunteer. Someone new sets a password and is signed in; someone with a Health ID login accepts with it, signed in
 * (owner decision 5: the same login can work at a hospital and help an outreach group). The link's token is read from
 * the address once and kept in memory only; without the link, the email address and the 6-digit code from the email.
 */
export function OutreachInvitation() {
  useDocumentTitle('Accept an invitation · Health ID Outreach')
  const [link] = useState(() => {
    const read = readOutreachInvitationLink(window.location.hash)
    if (read) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    return read
  })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problems, setProblems] = useState<Partial<Record<string, string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [done, setDone] = useState<Done | null>(null)
  const signIn = staffSignInHref(window.location.hostname) ?? STAFF_SIGN_IN_PATH

  function proofProblems(): Record<string, string> {
    const found: Record<string, string> = {}
    if (!link) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'Enter the email address the invitation was sent to.'
      if (!/^[0-9]{6}$/.test(code.trim())) found.code = 'Enter the 6-digit code from the email.'
    }
    return found
  }

  async function acceptNew(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found = proofProblems()
    if (password.length < 12) found.password = 'Use at least 12 characters.'
    if (confirm !== password) found.confirm = 'The two passwords are not the same.'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    if (!turnstileToken) { setError('Complete the security check, then try again.'); return }
    setBusy(true)
    try {
      const accepted = await outreachOrganiserApi.acceptInvitation(link ?? { email: email.trim(), code: code.trim() }, password, turnstileToken)
      setPassword('')
      setConfirm('')
      setDone({ facilityName: accepted.facilityName, signedIn: true })
    } catch (caught) {
      setError(outreachProblemText(caught, FALLBACK))
    } finally {
      setBusy(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  async function acceptSignedIn() {
    if (busy) return
    setError('')
    if (!link && !/^[0-9]{6}$/.test(code.trim())) { setProblems({ code: 'Enter the 6-digit code from the email.' }); return }
    setProblems({})
    setBusy(true)
    try {
      const accepted = await staffApi.acceptOutreachInvitationSignedIn(link ?? { code: code.trim() })
      setDone({ facilityName: accepted.facilityName, signedIn: true })
    } catch (caught) {
      setError(isHidApiError(caught) && caught.status === 401
        ? 'Sign in with your Health ID login first, then open the invitation link again.'
        : outreachProblemText(caught, FALLBACK))
    } finally { setBusy(false) }
  }

  const story = { eyebrow: 'Health ID — Outreach', title: <>Help register people<br />at outreach events.</>,
    text: 'Join an outreach group’s team on Health ID.' }
  const footer = <p>Helpers register people at the group’s events. They can’t see any hospital’s records.</p>
  if (done) {
    return <SignupShell centered footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-done">You have joined {done.facilityName || 'the outreach group'}</ScreenHeading>
      <p className="hid-ehr-signup-intro">You can now register people at the group’s campaigns. If you also work at a hospital,
        use Switch facility to move between them.</p>
      <a className="hid-ehr-button hid-ehr-signup-wide" href="/provider/outreach">Open Outreach</a>
    </SignupShell>
  }
  return (
    <SignupShell footer={footer} story={story}>
      <ScreenHeading id="outreach-invitation-title">Join an outreach group</ScreenHeading>
      <p className="hid-ehr-signup-intro">An outreach group’s organiser invited you to help register people at their events.</p>
      {!link ? <div className="hid-ehr-signup-grid">
        <EhrField label={<Required>Email the invitation was sent to</Required>} controlId="outreach-invitation-email" error={problems.email}>
          <EhrInput type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
        </EhrField>
        <EhrField label={<Required>Code from the email</Required>} controlId="outreach-invitation-code" error={problems.code}>
          <EhrInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        </EhrField>
      </div> : null}

      <form className="hid-ehr-signup-form" noValidate onSubmit={event => void acceptNew(event)} aria-labelledby="outreach-invitation-new">
        <h2 id="outreach-invitation-new" className="hid-ehr-signup-step-title">New to Health ID? Choose a password</h2>
        <PasswordField label={<Required>Password</Required>} controlId="outreach-invitation-password" error={problems.password}
          hint="At least 12 characters. Don’t use a password you use anywhere else." autoComplete="new-password"
          value={password} onChange={event => setPassword(event.target.value)} />
        <PasswordField label={<Required>Type the password again</Required>} controlId="outreach-invitation-confirm" error={problems.confirm}
          toggleLabel="Show password confirmation" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
        <div className="hid-ehr-signup-actions">
          <div className="hid-ehr-signup-turnstile">
            <Turnstile action="outreach-invitation" onTokenChange={setTurnstileToken} resetKey={resetKey} />
          </div>
          <EhrButton type="submit" busy={busy}>Join the group</EhrButton>
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
