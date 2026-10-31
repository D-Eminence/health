import { useCallback, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { Badge, Button, Card, statusTone } from '../kasuwa/ui'
import { Actions, LoadProblem, Problem, Saved } from './profileParts'
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
  return <Card aria-busy={(invitations.loading && list !== null) || undefined} aria-labelledby="share-invitations-heading">
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 ref={heading} id="share-invitations-heading" tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">Invitations to share</h2>
        <p className="m-0 text-[13px] text-ink-3">Nothing is shared until they accept and you confirm.</p>
      </div>
      <Button to="/access/share?by=email" size="sm" icon={Mail}>Invite</Button>
    </div>
    {(invitations.error || error || notice) && <div className="flex flex-col gap-3 px-5 pt-4">
      {invitations.error && <LoadProblem what="invitations" error={invitations.error} buttonRef={retryFocus.button} onRetry={() => retryFocus.retry(invitations.reload)} />}
      {error && <Problem>{error}</Problem>}
    </div>}
    <div className="px-5 empty:hidden"><Saved>{notice}</Saved></div>
    {list && !invitations.error && (list.items.length === 0 ? <p className="m-0 px-5 py-6 text-[13px] text-ink-3">No invitations yet.</p>
      : <ul className="m-0 list-none divide-y divide-line p-0">{list.items.map(item => <li key={item.invitationId} className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">{invitee(item)}</p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">{[shareLevelLabel(item.level), shareDurationLabel(item.duration)].filter(Boolean).join(' · ')}</p>
            <p className="m-0 text-[13px] text-ink-3">Sent {sentAt(item.createdAt)}{item.status === 'pending' || item.status === 'accepted' ? ` · Ends ${shareDay(item.expiresAt)}` : ''}
              {item.status === 'pending' && item.deliveryOutcome === 'not_confirmed' ? ' · We aren’t sure the email arrived' : ''}</p>
            {item.status === 'accepted' && item.offer && <p className="m-0 mt-1 text-[13px] text-ink-2">
              {item.offer.clinicianName ?? 'A health worker'}, {SHARE_ROLE_LABELS[item.offer.role]} at {[item.offer.facilityName, item.offer.organizationName].filter(Boolean).join(', ')}.
              {item.offer.newOnHealthId && <> <Badge size="sm" tone="warn">New on Health ID</Badge></>}</p>}
          </div>
          <Badge size="sm" tone={item.status === 'accepted' ? 'brand' : statusTone(item.status)}>{STATUS_WORDS[item.status]}</Badge>
        </div>
        {item.status === 'pending' && <Actions>
          <Button id={`cancel-invitation-${item.invitationId}`} size="sm" variant="danger" disabled={busy}
            onClick={() => void act(item, 'cancel')}>Cancel invitation <ItemName>to {item.inviteeEmail}</ItemName></Button></Actions>}
        {item.status === 'accepted' && <div className="grid grid-cols-2 gap-2">
          <Button id={`decline-invitation-${item.invitationId}`} block disabled={busy}
            onClick={() => void act(item, 'decline')}>Decline <ItemName>the invitation to {item.inviteeEmail}</ItemName></Button>
          <Button id={`confirm-invitation-${item.invitationId}`} block variant="primary" disabled={busy}
            onClick={() => void act(item, 'confirm')}>Confirm and share <ItemName>with {item.offer?.clinicianName ?? item.inviteeEmail}</ItemName></Button></div>}
      </li>)}</ul>)}
    {list?.limits && <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-3">You can send {list.limits.remainingToday} more {list.limits.remainingToday === 1 ? 'invitation' : 'invitations'} today.</p>}
  </Card>
}
