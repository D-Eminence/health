import { isHidApiError } from '@hid/http'
import { EhrButton } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { focusLost } from '../../../pageFocus'
import { staffApi } from '../../../staff/api'
import {
  shareDay, shareLevelLabel, type ShareDuration, type SharedPatient, type StaffShareInvitation, type StaffShareInvitationList,
} from '../../../shareRecords'
import type { RecordRow } from '../parts/RecordTable'
import { roleMay } from '../consent/access'

/**
 * Patient sharing on Patients (today's SharedPatients.tsx), as rows of the Patients list (audit 2): each patient shared
 * with this clinician opens through the same Health ID lookup as a search, and each invitation's quick view holds its
 * Accept. Each list is left out while it loads, for a role the route would refuse, and when the backend does not serve
 * it (404). What the lists said (a failure, an empty list, an ineligible role) and what Accept did are shown under the
 * table, in today's words. What they read is held in component memory only.
 */

type Load<T> = { readonly state: 'hidden' } | { readonly state: 'failed'; readonly message: string } | { readonly state: 'ready'; readonly value: T }

function useListLoad<T>(facilityId: string | undefined, allowed: boolean, read: (facilityId: string, signal: AbortSignal) => Promise<T>, fallback: string) {
  const [load, setLoad] = useState<Load<T>>({ state: 'hidden' })
  const reader = useRef({ read, fallback })
  useEffect(() => {
    setLoad({ state: 'hidden' })
    if (!facilityId || !allowed) return
    const controller = new AbortController()
    const { read: readNow, fallback: fallbackNow } = reader.current
    // Run as a promise, so that a read that throws at once is a failure of this list, never of the page.
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

const levelText = (level: string) => shareLevelLabel(level) ?? level
const SHARED_OPEN_UNAVAILABLE_ID = 'shared-open-unavailable'

/**
 * The sharing rows for the Patients list ("Shared with you" first, then "Invitations") and what to show under it.
 * `onOpen` is the page's own Health ID lookup; `openUnavailable` is why the role cannot run it; `busy` while one runs.
 */
export function usePatientSharing({ facilityId, permissions, openUnavailable, busy, onOpen }: {
  facilityId: string | undefined
  permissions: readonly string[]
  openUnavailable: string | null
  busy: boolean
  onOpen: (hid: string) => void
}): { rows: RecordRow[]; notes: ReactNode } {
  const [shared] = useListLoad<SharedPatient[]>(facilityId, roleMay('identity.sharedWithMe', 'GET', permissions), readShared,
    'The patients shared with you could not be loaded.')
  const [invitations, setInvitations] = useListLoad<StaffShareInvitationList>(facilityId,
    roleMay('identity.staffShareInvitations', 'GET', permissions), readInvitations, 'Your invitations could not be loaded.')
  const acceptAllowed = roleMay('identity.staffShareInvitationAccept', 'POST', permissions)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState('')
  const [moved, setMoved] = useState(0)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)

  // Another facility's list is another list: what was said about this one goes.
  useEffect(() => { setError(''); setAccepted('') }, [facilityId])
  // Accept takes its row (and its quick view) away: focus goes to the refusal, or to what happened, as today: the latter
  // only if focus was lost (useFocusById's ifLost), so a user who closed the quick view and moved on while it ran keeps
  // focus where they put it.
  useLayoutEffect(() => {
    if (!moved) return
    if (!accepted) errorRef.current?.focus()
    else if (focusLost() || document.activeElement === resultRef.current) resultRef.current?.focus()
  }, [moved, accepted])

  const withdraw = (invitationId: string) => setInvitations(current => current.state !== 'ready' ? current
    : { state: 'ready', value: { ...current.value, items: current.value.items.filter(item => item.invitationId !== invitationId) } })

  /** Today's Accept. The quick view it was pressed in closes as it ends, with what happened, so focus can go there. */
  async function accept(item: StaffShareInvitation, close: () => void) {
    if (!facilityId || accepting || !acceptAllowed) return
    setAccepting(item.invitationId); setError(''); setAccepted('')
    try {
      await staffApi.acceptShareInvitation(facilityId, item.invitationId)
      withdraw(item.invitationId)
      setAccepted(`You accepted invitation ${item.reference || 'to share'}. The patient must now confirm before you can open their `
        + 'record. Once they do, they appear under Shared with you.')
    } catch (caught) {
      // One that is gone or no longer waiting cannot be accepted again here.
      if (isHidApiError(caught) && ['SHARE_INVITATION_NOT_FOUND', 'SHARE_INVITATION_NOT_PENDING'].includes(caught.code)) withdraw(item.invitationId)
      setError(acceptProblem(caught))
    } finally {
      setAccepting(null)
      setMoved(value => value + 1)
      close()
    }
  }
  // Read through a ref, so the rows below need not change with every render.
  const acceptRef = useRef(accept)
  useLayoutEffect(() => { acceptRef.current = accept })

  const sharedItems = shared.state === 'ready' ? shared.value : null
  const invitationItems = invitations.state === 'ready' && invitations.value.eligible ? invitations.value.items : null

  const rows = useMemo<RecordRow[]>(() => {
    const unavailable = openUnavailable ? { id: SHARED_OPEN_UNAVAILABLE_ID, reason: openUnavailable } : null
    const sharedRows = (sharedItems ?? []).map((item): RecordRow => ({
      id: `shared-${item.consentGrantId}`,
      name: item.fullName,
      reference: 'Shared with you',
      context: item.fullName,
      contextSub: item.hid,
      status: levelText(item.level),
      statusNote: `until ${shareDay(item.expiresAt)}`,
      details: [
        { label: 'Name', value: item.fullName },
        { label: 'Health ID', value: item.hid },
        { label: 'Access', value: levelText(item.level) },
        { label: 'Access until', value: shareDay(item.expiresAt) },
      ],
      open: { onOpen: () => onOpen(item.hid), busy, unavailable },
      // Today's "Shared with you" intro, which says why opening one can still be refused.
      quickView: () => <p className="hid-ehr-clinical-quick-text">Patients who chose to share their record with you at this facility. Opening one checks access with the server.</p>,
    }))
    const invitationRows = (invitationItems ?? []).map((item): RecordRow => ({
      id: `invitation-${item.invitationId}`,
      name: item.reference ? `Invitation ${item.reference}` : 'Invitation',
      reference: `${DURATION_LABELS[item.duration]} · sent ${shareDay(item.createdAt)}`,
      context: levelText(item.level),
      contextSub: item.inviteeName ? `To ${item.inviteeName}` : undefined,
      status: 'invited',
      statusNote: `open until ${shareDay(item.expiresAt)}`,
      details: [
        ...(item.inviteeName ? [{ label: 'To', value: item.inviteeName }] : []),
        { label: 'Access', value: levelText(item.level) },
        { label: 'Duration', value: DURATION_LABELS[item.duration] },
        { label: 'Sent', value: shareDay(item.createdAt) },
        { label: 'Open until', value: shareDay(item.expiresAt) },
      ],
      // An invitation names no patient and opens nothing: its quick view holds Accept.
      open: null,
      quickView: close => (
        <>
          <p className="hid-ehr-clinical-quick-text">Patients can invite you by email to see their record. Accept here, signed in with that email; the patient then confirms, and is not named until they do.</p>
          <EhrButton
            disabled={!acceptAllowed || (accepting !== null && accepting !== item.invitationId)}
            busy={accepting === item.invitationId}
            aria-label={item.reference ? `Accept invitation ${item.reference}` : 'Accept invitation'}
            onClick={() => void acceptRef.current(item, close)}
          >
            {accepting === item.invitationId ? 'Accepting…' : 'Accept'}
          </EhrButton>
        </>
      ),
    }))
    return [...sharedRows, ...invitationRows]
  }, [sharedItems, invitationItems, openUnavailable, busy, onOpen, acceptAllowed, accepting])

  let sharedNote: ReactNode = null
  if (shared.state === 'failed') sharedNote = <p className="hid-ehr-clinical-note">{shared.message}</p>
  else if (shared.state === 'ready' && shared.value.length === 0) sharedNote = <p className="hid-ehr-clinical-note">No patient has shared their record with you here.</p>
  else if (shared.state === 'ready' && openUnavailable) sharedNote = <p id={SHARED_OPEN_UNAVAILABLE_ID} className="hid-ehr-clinical-note">{openUnavailable}</p>

  let invitationNote: ReactNode = null
  if (invitations.state === 'failed') invitationNote = <p className="hid-ehr-clinical-note">{invitations.message}</p>
  else if (invitations.state === 'ready' && !invitations.value.eligible) {
    invitationNote = <p className="hid-ehr-clinical-note">Only a doctor, clinician or nurse at a facility Health ID has checked can accept invitations. Your role here cannot, so invitations sent to your email are not shown. Switch to such a facility to see them.</p>
  } else if (invitations.state === 'ready' && invitations.value.items.length === 0) {
    invitationNote = <p className="hid-ehr-clinical-note">No invitations are waiting for your sign-in email.</p>
  }

  // The page places these under its list (in its own notes region).
  const notes = (
    <>
      {sharedNote}
      {invitationNote}
      {error ? <div ref={errorRef} tabIndex={-1}><div className="hid-ehr-clinical-alert" role="alert"><p>{error}</p></div></div> : null}
      {/* Mounted throughout, so what Accept did is announced. */}
      <div role="status">{accepted ? <p ref={resultRef} tabIndex={-1} className="hid-ehr-clinical-status">{accepted}</p> : null}</div>
    </>
  )

  return { rows, notes }
}
