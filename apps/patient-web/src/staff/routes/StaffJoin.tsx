import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Button, Card, Field, Input } from '@hid/ui'
import { staffInvitationApi, type StaffInvitationPreview } from '../api'
import { useStaff } from '../App'
import { BUSY } from '../focus'
import { capturedStaffInvitation, forgetStaffInvitation, type InvitationLink } from '../invitationCapture'
import { roleNameInSentence } from '../staffAccess'
import { isRouteMissing, isUnavailable, joinProblemText } from '../staffProblems'

/**
 * Existing staff accept an invitation signed in on their own staff site (Novu, P4b SPEC 8.3). The email's link opens
 * `/provider/staff/join#<id>.<token>` there; the workspace keeps the link through the sign-in (invitationCapture).
 * Without the link the page asks for the email's code: the email is the session's own. Identity answers for the
 * signed-in account and names no facility of theirs; once accepted, the new facility is the one worked at.
 */

/*
 * The blue EHR shows this page too, as the next step of its invitation page, so a role is named as there: "a staff
 * member" for a code Health ID has no name for, never the code (parity report 3.1 #16).
 */

/** The page each role works on first; the page itself checks the facility's permissions. */
function landingFor(role: string): { to: string; title: string } {
  if (role === 'lab') return { to: '/provider/laboratory', title: 'Laboratory' }
  if (role === 'pharmacist') return { to: '/provider/pharmacy', title: 'Pharmacy' }
  return { to: '/provider/patients', title: 'Patient access' }
}

/** Refusals after which the link can never work: it is forgotten. Others (a fault, another account) keep it. */
const FINAL = new Set(['STAFF_INVITATION_CODE_INVALID', 'STAFF_INVITATION_LOCKED', 'STAFF_INVITATION_SUPERSEDED',
  'STAFF_INVITATION_EXPIRED', 'STAFF_INVITATION_WITHDRAWN', 'STAFF_INVITATION_ALREADY_ACCEPTED', 'STAFF_INVITATION_ALREADY_MEMBER',
  'STAFF_INVITATION_ACCOUNT_UNAVAILABLE'])

/**
 * Refusals of the held link that the same link may get past later: no answer (a fault, a timeout, the gateway's 503),
 * joining paused, too many tries from this network, or the account changed while joining. The page offers to try the
 * link again rather than leaving the person with only the message, since a reload forgets the link (held in memory only).
 */
function retryable(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  return isUnavailable(caught) || caught.status === 429 || caught.code === 'STAFF_INVITATIONS_UNAVAILABLE'
    || caught.code === 'STAFF_INVITATION_ACCOUNT_CHANGED'
}

export function StaffJoin() {
  const { state, selectFacility, refresh } = useStaff()
  const navigate = useNavigate()
  const email = state.status === 'ready' ? state.session.actor.email ?? '' : ''
  const [link, setLink] = useState<InvitationLink | null>(() => capturedStaffInvitation())
  const [proof, setProof] = useState<{ invitationId: string; token: string } | { code: string } | null>(link)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<StaffInvitationPreview | null>(null)
  const [joined, setJoined] = useState<{ facilityName: string; roleCode: string } | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  // Whether the held link's last preview was refused in a way trying it again may get past (see retryable).
  const [canRetry, setCanRetry] = useState(false)
  const asked = useRef(false)

  function refused(caught: unknown) {
    if (isRouteMissing(caught)) { setUnavailable(true); return }
    if (isHidApiError(caught) && FINAL.has(caught.code)) { forgetStaffInvitation(); setLink(null); setProof(null) }
    setError(joinProblemText(caught, preview?.facilityName ?? null))
  }

  async function ask(next: { invitationId: string; token: string } | { code: string }) {
    setBusy(true); setError(''); setCanRetry(false)
    try {
      setPreview(await staffInvitationApi.previewSignedIn(next))
      setProof(next)
    } catch (caught) { setPreview(null); setCanRetry(retryable(caught)); refused(caught) }
    finally { setBusy(false) }
  }

  /** Stops using the held link, so the page asks for the email's code instead. */
  function switchToCode() {
    forgetStaffInvitation()
    setLink(null); setProof(null); setError(''); setCanRetry(false)
  }

  // The link carried through the sign-in is previewed at once, once.
  useEffect(() => {
    if (!link || asked.current) return
    asked.current = true
    void ask(link)
  }, [link])

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from the invitation email.'); return }
    void ask({ code })
  }

  async function accept() {
    if (busy || !proof || !preview) return
    setBusy(true); setError('')
    try {
      const accepted = await staffInvitationApi.acceptSignedIn(proof)
      forgetStaffInvitation()
      setLink(null)
      // Work at the facility just joined. A switch Identity refuses (the session does not list it yet) leaves the
      // session to be read again instead.
      try { await selectFacility(accepted.facilityId) } catch { await refresh() }
      setJoined({ facilityName: accepted.facilityName || preview.facilityName, roleCode: accepted.roleCode || preview.roleCode })
    } catch (caught) { refused(caught) }
    finally { setBusy(false) }
  }

  function notNow() {
    forgetStaffInvitation()
    navigate('/provider')
  }

  if (unavailable) return <div className="staff-page-head"><p className="staff-eyebrow">Invitation</p><h1>Join a facility</h1>
    <p>Joining a facility by invitation isn’t available. Contact the facility that invited you.</p></div>

  if (joined) {
    const landing = landingFor(joined.roleCode)
    return <>
      <div className="staff-page-head"><p className="staff-eyebrow">Invitation</p><h1 tabIndex={-1}>You’ve joined {joined.facilityName}</h1>
        <p>You’re now working at {joined.facilityName} as {roleNameInSentence(joined.roleCode)}. Next time you sign in, Health ID opens
          your main facility: switch to {joined.facilityName} from “Working at”.</p></div>
      <Button onClick={() => navigate(landing.to)}>Open {landing.title}</Button>
    </>
  }

  const expires = preview?.expiresAt ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(preview.expiresAt)) : null
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Invitation</p><h1>Join a facility</h1>
      <p>Accept an invitation to work at another facility on Health ID with this account{email ? `, ${email}` : ''}.</p></div>
    {error && <p role="alert" className="staff-error">{error}</p>}
    {busy && !preview && <p role="status">Checking your invitation…</p>}
    {preview && <Card className="staff-card">
      <h2>Join {preview.facilityName} as {roleNameInSentence(preview.roleCode)}</h2>
      <p>{preview.inviterName ? `${preview.inviterName}, the facility administrator, invited you.`
        : 'The facility administrator invited you.'}{expires ? ` The invitation expires on ${expires}.` : ''}</p>
      <div className="staff-row">
        <Button onClick={() => void accept()} aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Joining…' : `Join ${preview.facilityName}`}</Button>
        <Button tone="quiet" onClick={notNow} disabled={busy}>Not now</Button>
      </div>
    </Card>}
    {/* The held link was refused but not for good: without these the page would offer nothing (P4c review). */}
    {!preview && link && !busy && error && <Card className="staff-card">
      <h2>Your invitation link</h2>
      <p>{canRetry ? 'Try the link again, or enter the 6-digit code from the invitation email instead.'
        : 'You can enter the 6-digit code from the invitation email instead.'}</p>
      <div className="staff-row">
        {canRetry && <Button onClick={() => void ask(link)}>Try again</Button>}
        <Button tone="secondary" onClick={switchToCode}>Use the code instead</Button>
        <Button tone="quiet" onClick={notNow}>Not now</Button>
      </div>
    </Card>}
    {!preview && !link && <Card className="staff-card"><form className="staff-form" noValidate onSubmit={submitCode}>
      <h2>Enter your invitation code</h2>
      <p>Enter the 6-digit code from the invitation email{email ? ` sent to ${email}` : ''}.</p>
      <Field label="Invitation code" htmlFor="staff-join-code">
        <Input id="staff-join-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
      </Field>
      <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Checking…' : 'Continue'}</Button>
    </form></Card>}
  </>
}
