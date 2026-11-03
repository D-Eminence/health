import { useEffect, useState } from 'react'
import { findEndpoint, type EndpointMethod } from '@hid/contracts'
import { isHidApiError, plainErrorText } from '@hid/http'
import { Badge, Button, Card } from '@hid/ui'
import { staffApi } from '../api'
import { UNAVAILABLE, useFocusById } from '../focus'
import {
  shareDay, shareLevelLabel,
  type ShareDuration, type SharedPatient, type StaffShareInvitation, type StaffShareInvitationList,
} from '../../shareRecords'

/**
 * The clinician's side of patient sharing on the provider portal's Patients page (hid-1.0 parity B4, hid-system 0095 on
 * Novu; contract S1 to S3). "Shared with you" lists the patients who shared their record with this clinician here and
 * opens one through the Health ID lookup; "Invitations" lists the invitations sent to the clinician's verified sign-in
 * email, with Accept, after which the patient confirms. Each card is hidden while it loads, for a role the route would
 * refuse, and when the backend does not serve it (404: before 0095, or with sharing off). What they learn is held in
 * memory only.
 */

/** Whether the role holds every permission the registry lists for the route; a route it does not describe is never called. */
function roleMay(route: string, method: EndpointMethod, permissions: readonly string[]): boolean {
  const required = findEndpoint(route)?.permissions?.[method] ?? []
  return required.length > 0 && required.every(permission => permissions.includes(permission))
}

type Load<T> = { readonly state: 'hidden' } | { readonly state: 'failed'; readonly message: string } | { readonly state: 'ready'; readonly value: T }

function loadFailure(caught: unknown, fallback: string): Load<never> {
  if (isHidApiError(caught) && caught.status === 404) return { state: 'hidden' }
  return { state: 'failed', message: plainErrorText(caught, fallback, { audience: 'facility' }) }
}

/** Reads one card's list for the facility, again when the facility changes; nothing for a role the route would refuse. */
function useCardLoad<T>(facilityId: string | undefined, allowed: boolean, read: (facilityId: string, signal: AbortSignal) => Promise<T>,
  fallback: string) {
  const [load, setLoad] = useState<Load<T>>({ state: 'hidden' })
  useEffect(() => {
    setLoad({ state: 'hidden' })
    if (!facilityId || !allowed) return
    const controller = new AbortController()
    // Run as a promise, so that a read that throws at once is a failure of this card, never of the page.
    void Promise.resolve().then(() => read(facilityId, controller.signal)).then(
      value => { if (!controller.signal.aborted) setLoad({ state: 'ready', value }) },
      (caught: unknown) => { if (!controller.signal.aborted) setLoad(loadFailure(caught, fallback)) })
    return () => controller.abort()
    // `read` and `fallback` are fixed for each card.
  }, [facilityId, allowed])
  return [load, setLoad] as const
}

const DURATION_LABELS: Readonly<Record<ShareDuration, string>> = {
  '24h': '24 hours', '7d': '7 days', '30d': '30 days', until_revoked: 'Until the patient ends it (up to 1 year)',
}

const readShared = (facilityId: string, signal: AbortSignal) => staffApi.sharedWithMe(facilityId, signal)
const readInvitations = (facilityId: string, signal: AbortSignal) => staffApi.staffShareInvitations(facilityId, signal)

export interface SharedWithYouProps {
  readonly facilityId: string | undefined
  readonly permissions: readonly string[]
  /** Why the role cannot open a record (the Health ID lookup), or null. */
  readonly openUnavailable: string | null
  readonly busy: boolean
  readonly onOpen: (hid: string) => void
}

/** S1: the patients who shared their record with this clinician at this facility. */
export function SharedWithYou({ facilityId, permissions, openUnavailable, busy, onOpen }: SharedWithYouProps) {
  const [load] = useCardLoad<SharedPatient[]>(facilityId, roleMay('identity.sharedWithMe', 'GET', permissions), readShared,
    'The patients shared with you could not be loaded.')
  if (load.state === 'hidden') return null
  return <Card className="staff-card">
    <h2 id="shared-with-you-title">Shared with you</h2>
    <p className="staff-muted">Patients who chose to share their record with you at this facility. Opening one checks access with the
      server.</p>
    {load.state === 'failed' ? <p className="staff-muted">{load.message}</p>
      : load.value.length === 0 ? <p className="staff-muted">No patient has shared their record with you here.</p>
      : <>
        {openUnavailable && <p id="shared-open-unavailable" className="staff-muted">{openUnavailable}</p>}
        <ul className="staff-share-list">{load.value.map(item => <li key={item.consentGrantId} className="staff-row">
          <strong>{item.fullName}</strong><span className="staff-muted">{item.hid}</span>
          <Badge tone="success">{shareLevelLabel(item.level)}</Badge>
          <span className="staff-muted">Until {shareDay(item.expiresAt)}</span>
          <Button tone="secondary" size="sm" disabled={openUnavailable !== null} aria-disabled={busy || undefined} className={UNAVAILABLE}
            aria-label={`Open ${item.fullName}’s record`} aria-describedby={openUnavailable ? 'shared-open-unavailable' : undefined}
            onClick={() => { if (!busy) onOpen(item.hid) }}>Open record</Button>
        </li>)}</ul>
      </>}
  </Card>
}

/** S3's refusals, in the words the backend uses (contract S3). */
function acceptProblem(caught: unknown): string {
  if (isHidApiError(caught)) {
    if (caught.code === 'SHARE_INVITATION_NOT_FOUND') return 'This invitation is not available.'
    if (caught.code === 'SHARE_PROVIDER_NOT_ELIGIBLE') return 'Your role at this facility cannot receive patient records through Health ID.'
    if (caught.code === 'SHARE_INVITATION_NOT_PENDING') return 'This invitation has already been accepted, cancelled or has ended.'
    if (caught.code === 'SHARE_PERMISSION_DENIED') return 'Sharing is not available for your account at this facility.'
    if (caught.status === 404) return 'Accepting invitations is not available right now.'
  }
  return plainErrorText(caught, 'The invitation could not be accepted. Please try again.', { audience: 'facility' })
}

/** S2 with Accept (S3): the invitations to share sent to this clinician's verified sign-in email. No patient is named. */
export function ShareInvitationsForMe({ facilityId, permissions }: { readonly facilityId: string | undefined; readonly permissions: readonly string[] }) {
  const [load, setLoad] = useCardLoad<StaffShareInvitationList>(facilityId,
    roleMay('identity.staffShareInvitations', 'GET', permissions), readInvitations, 'Your invitations could not be loaded.')
  const acceptAllowed = roleMay('identity.staffShareInvitationAccept', 'POST', permissions)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState('')
  // Accept takes its invitation, and its button, off the list: focus goes to what happened, or to the refusal.
  const focus = useFocusById()

  // Another facility's list is another list: what was said about this one goes.
  useEffect(() => { setError(''); setAccepted('') }, [facilityId])

  const withdraw = (invitationId: string) => setLoad(current => current.state !== 'ready' ? current
    : { state: 'ready', value: { ...current.value, items: current.value.items.filter(item => item.invitationId !== invitationId) } })

  async function accept(item: StaffShareInvitation) {
    if (!facilityId || accepting || !acceptAllowed) return
    setAccepting(item.invitationId); setError(''); setAccepted('')
    try {
      await staffApi.acceptShareInvitation(facilityId, item.invitationId)
      withdraw(item.invitationId)
      setAccepted(`You accepted invitation ${item.reference || 'to share'}. The patient must now confirm before you can open their `
        + 'record. Once they do, they appear under Shared with you.')
      focus('share-invitations-result', true)
    } catch (caught) {
      // One that is gone or no longer waiting cannot be accepted again here.
      if (isHidApiError(caught) && ['SHARE_INVITATION_NOT_FOUND', 'SHARE_INVITATION_NOT_PENDING'].includes(caught.code)) withdraw(item.invitationId)
      setError(acceptProblem(caught))
      focus('share-invitations-error')
    } finally { setAccepting(null) }
  }

  if (load.state === 'hidden') return null
  return <Card className="staff-card">
    <h2 id="share-invitations-title">Invitations</h2>
    <p className="staff-muted">Patients can invite you by email to see their record. Accept here, signed in with that email; the patient
      then confirms, and is not named until they do.</p>
    {load.state === 'failed' ? <p className="staff-muted">{load.message}</p>
      : !load.value.eligible ? <p className="staff-muted">Only a doctor, clinician or nurse at a facility Health ID has checked can accept
        invitations. Your role here cannot, so invitations sent to your email are not shown. Switch to such a facility to see them.</p>
      : load.value.items.length === 0 ? <p className="staff-muted">No invitations are waiting for your sign-in email.</p>
      : <ul className="staff-share-list">{load.value.items.map(item => <li key={item.invitationId} className="staff-row">
        <strong>{item.reference ? `Invitation ${item.reference}` : 'Invitation'}</strong>
        {item.inviteeName && <span className="staff-muted">To {item.inviteeName}</span>}
        <Badge tone="information">{shareLevelLabel(item.level)}</Badge>
        <span className="staff-muted">{DURATION_LABELS[item.duration]} · sent {shareDay(item.createdAt)} · open until {shareDay(item.expiresAt)}</span>
        <Button size="sm" disabled={!acceptAllowed || (accepting !== null && accepting !== item.invitationId)}
          aria-disabled={accepting === item.invitationId || undefined} className={UNAVAILABLE}
          aria-label={item.reference ? `Accept invitation ${item.reference}` : 'Accept invitation'}
          onClick={() => void accept(item)}>{accepting === item.invitationId ? 'Accepting…' : 'Accept'}</Button>
      </li>)}</ul>}
    {error && <p id="share-invitations-error" tabIndex={-1} role="alert" className="staff-error">{error}</p>}
    {/* Mounted throughout, so what Accept did is announced. */}
    <div role="status">{accepted && <p id="share-invitations-result" tabIndex={-1} className="staff-success">{accepted}</p>}</div>
  </Card>
}
