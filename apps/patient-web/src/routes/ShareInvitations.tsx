import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'
import { ItemName } from '../ItemName'
import { learnShareServed } from '../shareServed'
import { useOnNotificationChange } from '../notificationBadge'
import {
  SHARE_ROLE_LABELS, shareDay, shareDurationLabel, shareLevelLabel, shareUntil,
  type ShareInvitation, type ShareInvitationList, type ShareInvitationStatus,
} from '../shareRecords'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { shareProblem } from './ShareRecords'

/**
 * "Invitations to share" on Access and consent (hid-1.0 parity B4, hid-system 0095; contract b45-contract.md §2.7): the
 * invitations the patient sent by email, open ones and those that ended in the last 30 days. Its read is the portal's
 * probe for sharing: a backend that does not serve it answers 404, and the card is not shown and says nothing. A pending
 * invitation can be cancelled; one the provider accepted shows who they are, to confirm (which shares the record, and
 * needs a recent sign-in) or decline. Nothing is shared until the patient confirms (D7).
 */
const STATUS_WORDS: Readonly<Record<ShareInvitationStatus, string>> = {
  pending: 'Waiting for them to accept',
  accepted: 'Accepted · waiting for you to confirm',
  confirmed: 'Confirmed · your records are shared',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

function sentAt(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(parsed)
}

const invitee = (item: ShareInvitation) => item.inviteeName ? `${item.inviteeName} (${item.inviteeEmail})` : item.inviteeEmail

export function ShareInvitationsCard({ onShared }: { onShared?: () => Promise<unknown> | void }) {
  const { api } = useSession()
  const load = useCallback((signal?: AbortSignal) => api.shareInvitations(signal).then(list => {
    learnShareServed(true)
    return list
  }, (caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) { learnShareServed(false); return null }
    throw caught
  }), [api])
  // Kept for the account under its own name: `load` is made again each time the card is.
  const invitations = usePatientResource<ShareInvitationList | null>(load, 'share-invitations')
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)
  // A provider accepted, or an invitation expired (each writes a notice): the list is read again by itself.
  useOnNotificationChange(() => { void invitations.reload() })

  // Not served (404), or not known yet: nothing is shown, so today's backend shows the page as before.
  if (invitations.data === null && !invitations.error) return null

  const act = async (item: ShareInvitation, action: 'cancel' | 'confirm' | 'decline') => {
    if (working) return
    setWorking(item.invitationId); setError(null); setNotice(null)
    try {
      if (action === 'confirm') {
        const shared = await api.confirmShareInvitation(item.invitationId)
        setNotice(`${shared.clinicianName ?? 'The health worker'} at ${shared.facilityName} can see your records ${shareUntil(shared.duration, shared.expiresAt)}.`)
        await Promise.all([invitations.reload(), onShared?.()])
      } else {
        await api.cancelShareInvitation(item.invitationId)
        setNotice(action === 'decline' ? 'Invitation declined. Nothing was shared.' : 'Invitation cancelled.')
        await invitations.reload()
      }
      focusAfter(() => heading.current)
    } catch (cause) {
      setError(shareProblem(cause, action === 'confirm' ? 'Couldn’t share your records. Try again.'
        : 'Couldn’t update the invitation. Try again.'))
      focusAfter(() => document.getElementById(`${action}-invitation-${item.invitationId}`))
    } finally { setWorking(null) }
  }

  const list = invitations.data
  const busy = !!working || invitations.loading
  return <div className="patient-card" aria-busy={(invitations.loading && list !== null) || undefined}>
    <h2 ref={heading} tabIndex={-1}>Invitations to share</h2>
    <p className="patient-field-hint">Nothing is shared until they accept and you confirm.</p>
    {invitations.error && <div role="alert"><p>{invitations.error}</p>
      <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(invitations.reload)}>Try again</button></div>}
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {list && !invitations.error && (list.items.length === 0 ? <p className="patient-empty">No invitations yet.</p>
      : <ul className="patient-list">{list.items.map(item => <li key={item.invitationId} className="patient-access-item"><div>
        <strong>{invitee(item)}</strong>
        <span>{[shareLevelLabel(item.level), shareDurationLabel(item.duration)].filter(Boolean).join(' · ')}</span>
        <span>Sent {sentAt(item.createdAt)}{item.status === 'pending' || item.status === 'accepted' ? ` · Ends ${shareDay(item.expiresAt)}` : ''}</span>
        <span>{STATUS_WORDS[item.status]}{item.status === 'pending' && item.deliveryOutcome === 'not_confirmed' ? ' · We aren’t sure the email arrived' : ''}</span>
        {item.status === 'accepted' && item.offer && <p>
          {item.offer.clinicianName ?? 'A health worker'}, {SHARE_ROLE_LABELS[item.offer.role]} at {[item.offer.facilityName, item.offer.organizationName].filter(Boolean).join(', ')}
          {item.offer.newOnHealthId && <> <span className="patient-status-tag">New on Health ID</span></>}
          .</p>}
      </div>
      {item.status === 'pending' && <div className="patient-decision-actions">
        <button id={`cancel-invitation-${item.invitationId}`} type="button" className="patient-secondary-button" disabled={busy}
          onClick={() => void act(item, 'cancel')}>Cancel invitation <ItemName>to {item.inviteeEmail}</ItemName></button></div>}
      {item.status === 'accepted' && <div className="patient-decision-actions">
        <button id={`confirm-invitation-${item.invitationId}`} type="button" className="patient-primary-button" disabled={busy}
          onClick={() => void act(item, 'confirm')}>Confirm and share <ItemName>with {item.offer?.clinicianName ?? item.inviteeEmail}</ItemName></button>
        <button id={`decline-invitation-${item.invitationId}`} type="button" className="patient-secondary-button" disabled={busy}
          onClick={() => void act(item, 'decline')}>Decline <ItemName>the invitation to {item.inviteeEmail}</ItemName></button></div>}
    </li>)}</ul>)}
    {list?.limits && <p className="patient-field-hint">You can send {list.limits.remainingToday} more {list.limits.remainingToday === 1 ? 'invitation' : 'invitations'} today.</p>}
    <Link to="/access/share?by=email">Invite a health worker by email →</Link>
  </div>
}
