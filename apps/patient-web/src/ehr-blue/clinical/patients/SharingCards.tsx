import { isHidApiError, plainErrorText } from '@hid/http'
import { Mail, Share2 } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { staffApi } from '../../../staff/api'
import {
  shareDay, shareLevelLabel, type ShareDuration, type SharedPatient, type StaffShareInvitation, type StaffShareInvitationList,
} from '../../../shareRecords'
import { roleMay } from '../consent/access'

/**
 * Patient sharing on Patients (today's SharedPatients.tsx), in the design's card and list-row style. Each card is
 * hidden while it loads, for a role the route would refuse, and when the API does not serve it (404). What they
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
        else setLoad({ state: 'failed', message: plainErrorText(caught, fallbackNow, { audience: 'facility' }) })
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
  // Only when there is something to act on: nobody shared yet is not worth a card.
  if (load.state === 'hidden' || (load.state === 'ready' && load.value.length === 0)) return null
  if (load.state === 'failed') return <Alert intent="error" title="Couldn’t load patients shared with you">{load.message}</Alert>
  return (
    <Card>
      <CardHeader as="h2" title="Shared with you" description={`${load.value.length} patient${load.value.length === 1 ? '' : 's'}`} icon={Share2} iconTone="brand" />
      {openUnavailable ? <p id="shared-open-unavailable" className="m-0 px-5 pt-3 text-[12px] text-ink-3">{openUnavailable}</p> : null}
      <ul className="m-0 list-none divide-y divide-line p-0">
        {load.value.map(item => (
          <li key={item.consentGrantId} className="flex items-center gap-3 px-5 py-3">
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-ink">{item.fullName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{item.fullName}</span>
              <span className="block text-[12px] text-ink-3">{item.hid} · until {shareDay(item.expiresAt)}</span></span>
            <Badge size="sm" tone="brand">{shareLevelLabel(item.level) ?? item.level}</Badge>
            <Button size="sm" disabled={openUnavailable !== null} aria-disabled={busy || undefined} aria-label={`Open ${item.fullName}’s record`}
              aria-describedby={openUnavailable ? 'shared-open-unavailable' : undefined} onClick={() => { if (!busy) onOpen(item.hid) }}>Open</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

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
      setAccepted('Accepted. Once the patient confirms, they appear under Shared with you.')
    } catch (caught) {
      if (isHidApiError(caught) && ['SHARE_INVITATION_NOT_FOUND', 'SHARE_INVITATION_NOT_PENDING'].includes(caught.code)) withdraw(item.invitationId)
      setError(acceptProblem(caught))
    } finally {
      setAccepting(null)
      setMoved(value => value + 1)
    }
  }

  // Only when there is something to accept, or something to say about an accept: a role that cannot accept, or no
  // invitations, shows nothing.
  const items = load.state === 'ready' && load.value.eligible ? load.value.items : []
  if (load.state === 'hidden' || (load.state === 'ready' && items.length === 0 && !error && !accepted)) return null
  if (load.state === 'failed') return <Alert intent="error" title="Couldn’t load your invitations">{load.message}</Alert>
  return (
    <Card>
      <CardHeader as="h2" title="Invitations" description="From patients, to your email. They confirm after you accept." icon={Mail} iconTone="violet" />
      {items.length > 0 ? <ul className="m-0 list-none divide-y divide-line p-0">
        {items.map(item => (
          <li key={item.invitationId} className="flex items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{item.reference ? `Invitation ${item.reference}` : 'Invitation'}{item.inviteeName ? ` · to ${item.inviteeName}` : ''}</span>
              <span className="block text-[12px] text-ink-3">{DURATION_LABELS[item.duration]} · open until {shareDay(item.expiresAt)}</span></span>
            <Badge size="sm" tone="brand">{shareLevelLabel(item.level) ?? item.level}</Badge>
            <Button size="sm" loading={accepting === item.invitationId} disabled={!acceptAllowed || (accepting !== null && accepting !== item.invitationId)}
              aria-label={item.reference ? `Accept invitation ${item.reference}` : 'Accept invitation'} onClick={() => void accept(item)}>
              {accepting === item.invitationId ? 'Accepting…' : 'Accept'}</Button>
          </li>
        ))}
      </ul> : null}
      {error ? <div ref={errorRef} tabIndex={-1} className="p-5 outline-none"><Alert intent="error" title="Couldn’t accept">{error}</Alert></div> : null}
      <div role="status" className="empty:hidden">{accepted ? <p ref={resultRef} tabIndex={-1} className="m-0 px-5 py-4 text-[13px] text-ink-2 outline-none">{accepted}</p> : null}</div>
    </Card>
  )
}
