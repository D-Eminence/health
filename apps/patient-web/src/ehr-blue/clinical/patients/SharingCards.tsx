import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { staffApi } from '../../../staff/api'
import {
  shareDay, shareLevelLabel, type ShareDuration, type SharedPatient, type StaffShareInvitation, type StaffShareInvitationList,
} from '../../../shareRecords'
import { StatusBadge } from '../parts/StatusBadge'
import { roleMay } from '../consent/access'

/**
 * Patient sharing on Patients (today's SharedPatients.tsx), in the design's card and list-row style. Each card is
 * hidden while it loads, for a role the route would refuse, and when the backend does not serve it (404). What they
 * read is held in component memory only.
 */

type Load<T> = { readonly state: 'hidden' } | { readonly state: 'failed'; readonly message: string } | { readonly state: 'ready'; readonly value: T }

function useCardLoad<T>(facilityId: string | undefined, allowed: boolean, read: (facilityId: string, signal: AbortSignal) => Promise<T>, fallback: string) {
  const [load, setLoad] = useState<Load<T>>({ state: 'hidden' })
  const reader = useRef({ read, fallback })
  useEffect(() => {
    setLoad({ state: 'hidden' })
    if (!facilityId || !allowed) return
    const controller = new AbortController()
    const { read: readNow, fallback: fallbackNow } = reader.current
    void Promise.resolve().then(() => readNow(facilityId, controller.signal)).then(
      value => { if (!controller.signal.aborted) setLoad({ state: 'ready', value }) },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        if (isHidApiError(caught) && caught.status === 404) setLoad({ state: 'hidden' })
        else setLoad({ state: 'failed', message: isHidApiError(caught) && caught.message ? caught.message : fallbackNow })
      })
    return () => controller.abort()
  }, [facilityId, allowed])
  return [load, setLoad] as const
}

const DURATION_LABELS: Readonly<Record<ShareDuration, string>> = {
  '24h': '24 hours', '7d': '7 days', '30d': '30 days', until_revoked: 'Until the patient ends it (up to 1 year)',
}

const readShared = (facilityId: string, signal: AbortSignal) => staffApi.sharedWithMe(facilityId, signal)
const readInvitations = (facilityId: string, signal: AbortSignal) => staffApi.staffShareInvitations(facilityId, signal)

/** "Shared with you": opening one is the same Health ID lookup as a search. */
export function SharedWithYou({ facilityId, permissions, openUnavailable, busy, onOpen }: {
  facilityId: string | undefined
  permissions: readonly string[]
  openUnavailable: string | null
  busy: boolean
  onOpen: (hid: string) => void
}) {
  const [load] = useCardLoad<SharedPatient[]>(facilityId, roleMay('identity.sharedWithMe', 'GET', permissions), readShared,
    'The patients shared with you could not be loaded.')
  if (load.state === 'hidden') return null
  return (
    <EhrCard title="Shared with you">
      <p>Patients who chose to share their record with you at this facility. Opening one checks access with the server.</p>
      {load.state === 'failed' ? <p>{load.message}</p>
        : load.value.length === 0 ? <p>No patient has shared their record with you here.</p>
          : (
            <>
              {openUnavailable ? <p id="shared-open-unavailable" className="hid-ehr-clinical-note">{openUnavailable}</p> : null}
              <ul className="hid-ehr-clinical-history-list">
                {load.value.map(item => (
                  <li key={item.consentGrantId} className="hid-ehr-clinical-history-row">
                    <span>
                      {item.fullName}
                      <span className="hid-ehr-clinical-cell-sub">{`${item.hid} · Until ${shareDay(item.expiresAt)}`}</span>
                    </span>
                    <span className="hid-ehr-clinical-patients-share-actions">
                      <StatusBadge status={shareLevelLabel(item.level) ?? item.level} />
                      <EhrButton
                        variant="secondary"
                        disabled={openUnavailable !== null}
                        aria-disabled={busy || undefined}
                        aria-label={`Open ${item.fullName}’s record`}
                        aria-describedby={openUnavailable ? 'shared-open-unavailable' : undefined}
                        onClick={() => { if (!busy) onOpen(item.hid) }}
                      >
                        Open record
                      </EhrButton>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
    </EhrCard>
  )
}

function acceptProblem(caught: unknown): string {
  if (isHidApiError(caught)) {
    if (caught.code === 'SHARE_INVITATION_NOT_FOUND') return 'This invitation is not available.'
    if (caught.code === 'SHARE_PROVIDER_NOT_ELIGIBLE') return 'Your role at this facility cannot receive patient records through Health ID.'
    if (caught.code === 'SHARE_INVITATION_NOT_PENDING') return 'This invitation has already been accepted, cancelled or has ended.'
    if (caught.code === 'SHARE_PERMISSION_DENIED') return 'Sharing is not available for your account at this facility.'
    if (caught.status === 404) return 'Accepting invitations is not available right now.'
    if (caught.message) return caught.message
  }
  return 'The invitation could not be accepted. Please try again.'
}

/** "Invitations": invitations sent to this clinician's sign-in email, with Accept; no patient is named. */
export function ShareInvitationsForMe({ facilityId, permissions }: { facilityId: string | undefined; permissions: readonly string[] }) {
  const [load, setLoad] = useCardLoad<StaffShareInvitationList>(facilityId,
    roleMay('identity.staffShareInvitations', 'GET', permissions), readInvitations, 'Your invitations could not be loaded.')
  const acceptAllowed = roleMay('identity.staffShareInvitationAccept', 'POST', permissions)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState('')
  const [moved, setMoved] = useState(0)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => { setError(''); setAccepted('') }, [facilityId])
  // Accept takes its row away: focus goes to what happened, or to the refusal.
  useLayoutEffect(() => {
    if (!moved) return
    if (accepted) resultRef.current?.focus()
    else errorRef.current?.focus()
  }, [moved, accepted])

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
    } catch (caught) {
      if (isHidApiError(caught) && ['SHARE_INVITATION_NOT_FOUND', 'SHARE_INVITATION_NOT_PENDING'].includes(caught.code)) withdraw(item.invitationId)
      setError(acceptProblem(caught))
    } finally {
      setAccepting(null)
      setMoved(value => value + 1)
    }
  }

  if (load.state === 'hidden') return null
  return (
    <EhrCard title="Invitations">
      <p>Patients can invite you by email to see their record. Accept here, signed in with that email; the patient then confirms, and is not named until they do.</p>
      {load.state === 'failed' ? <p>{load.message}</p>
        : !load.value.eligible ? <p>Only a doctor, clinician or nurse at a facility Health ID has checked can accept invitations. Your role here cannot, so invitations sent to your email are not shown. Switch to such a facility to see them.</p>
          : load.value.items.length === 0 ? <p>No invitations are waiting for your sign-in email.</p>
            : (
              <ul className="hid-ehr-clinical-history-list">
                {load.value.items.map(item => (
                  <li key={item.invitationId} className="hid-ehr-clinical-history-row">
                    <span>
                      {item.reference ? `Invitation ${item.reference}` : 'Invitation'}
                      {item.inviteeName ? <span className="hid-ehr-clinical-cell-sub">{`To ${item.inviteeName}`}</span> : null}
                      <span className="hid-ehr-clinical-cell-sub">{`${DURATION_LABELS[item.duration]} · sent ${shareDay(item.createdAt)} · open until ${shareDay(item.expiresAt)}`}</span>
                    </span>
                    <span className="hid-ehr-clinical-patients-share-actions">
                      <StatusBadge status={shareLevelLabel(item.level) ?? item.level} />
                      <EhrButton
                        disabled={!acceptAllowed || (accepting !== null && accepting !== item.invitationId)}
                        busy={accepting === item.invitationId}
                        aria-label={item.reference ? `Accept invitation ${item.reference}` : 'Accept invitation'}
                        onClick={() => void accept(item)}
                      >
                        {accepting === item.invitationId ? 'Accepting…' : 'Accept'}
                      </EhrButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
      {error ? <div ref={errorRef} tabIndex={-1}><div className="hid-ehr-clinical-alert" role="alert"><p>{error}</p></div></div> : null}
      <div role="status">{accepted ? <p ref={resultRef} tabIndex={-1} className="hid-ehr-clinical-status">{accepted}</p> : null}</div>
    </EhrCard>
  )
}
