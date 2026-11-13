import { useCallback, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrInput } from '@hid/ui/ehr'
import { CloudOff, UserPlus } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { staffApi, type Facility, type OutreachInvitation, type OutreachOrganiserStatus, type OutreachTeamMember } from '../../../staff/api'
import { isOutreachProblem, outreachProblemText } from '../../../outreachProblems'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { controlProps, ErrorBox, OutreachField } from './outreachParts'
import type { PendingRegistration, QueueSyncResult, WaitReason } from './offlineQueue'

/*
 * An outreach group (open sign-up on outreach., owner decisions of 11 November 2026): a volunteer, NGO or community
 * group's own private Outreach space. Its people hold only the roles outreach_organiser and outreach_volunteer there,
 * which the database keeps at outreach groups only; a hospital's outreach team never holds them. The same login may
 * work at a hospital too (decision 5): what a page shows depends on the facility it is working at.
 */

/** The roles that exist only at an outreach group's own facility. */
export const OUTREACH_GROUP_ROLES: ReadonlySet<string> = new Set(['outreach_organiser', 'outreach_volunteer'])

/** Whether the working facility is an outreach group (not a hospital), as its roles say. Copy only: Outreach decides. */
export function isOutreachGroup(facility: Pick<Facility, 'roles'> | undefined): boolean {
  return facility?.roles.some(role => OUTREACH_GROUP_ROLES.has(role)) ?? false
}

/** Whether this membership runs the group: only its organiser invites the team. */
export function isOrganiser(facility: Pick<Facility, 'roles'> | undefined): boolean {
  return facility?.roles.includes('outreach_organiser') ?? false
}

/** What a waiting registration says at an outreach group, which can't link anyone to a Health ID. */
export const LINKS_LATER = 'The person links their own Health ID to this registration later, from their own Health ID account. '
  + 'Outreach groups can’t link people to a Health ID.'

/**
 * Whether Health ID has paused the group. Health ID does not check a group before its campaigns go live (owner decision
 * Q38), so a group that is not paused, a hospital, or an Outreach that could not say shows nothing.
 */
export function OutreachGroupBanner({ status }: { readonly status: OutreachOrganiserStatus | undefined }) {
  if (status === 'suspended') {
    return (
      <Alert intent="error" title="This outreach group is paused">
        Health ID has paused this group. Nobody in it can register people or change campaigns. Contact Health ID support.
      </Alert>
    )
  }
  return null
}

const INVITATION_STATUS: Readonly<Record<string, { label: string; tone: 'success' | 'warn' | 'neutral' }>> = {
  pending: { label: 'Waiting to accept', tone: 'warn' },
  accepted: { label: 'Joined', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Withdrawn', tone: 'neutral' },
  superseded: { label: 'Replaced by a newer invitation', tone: 'neutral' },
}

/** The team as Identity answers it: who has joined, then the invitations still waiting. */
interface Team { readonly members: readonly OutreachTeamMember[]; readonly invitations: readonly OutreachInvitation[] }

const ROLE_WORDS: Readonly<Record<string, string>> = { outreach_organiser: 'Organiser', outreach_volunteer: 'Helper' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'&()/-]*$/u

/**
 * "Your team" (the organiser's): invite helpers by email, each as an outreach volunteer, and see who has joined. Helpers
 * register people at the group's campaigns; they can't see any hospital's records.
 */
export function OutreachTeam({ facilityId }: { readonly facilityId: string }) {
  const load = useCallback((id: string) => staffApi.outreachInvitations(id)
    .then((answer): Team => ({ members: answer?.members ?? [], invitations: answer?.invitations ?? [] })), [])
  const team = useFacilityRead<Team>(facilityId, true, load, 'Your team could not be loaded. Try again.')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // The same helper sent again keeps its key. Identity itself refuses a second invitation to someone who has one waiting.
  const attempt = useRef<{ signature: string; key: string } | null>(null)

  async function invite(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    const found: { name?: string; email?: string } = {}
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 80 || !NAME.test(trimmed)) found.name = 'Enter their name: letters and simple punctuation, 2 to 80 characters.'
    if (!EMAIL.test(email.trim())) found.email = 'Enter their email address, like name@example.com.'
    setErrors(found)
    if (found.name || found.email) return
    const signature = JSON.stringify([facilityId, trimmed, email.trim().toLowerCase()])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const sent = await staffApi.createOutreachInvitation(facilityId, { name: trimmed, email: email.trim() }, attempt.current.key)
      attempt.current = null
      setName('')
      setEmail('')
      setNotice(sent.deliveryOutcome === 'definitive_failure'
        ? `The invitation to ${trimmed} was made, but the email could not be delivered. Check the address.`
        : `Invitation sent to ${trimmed}. They join when they open the link in the email.`)
      void team.refresh()
    } catch (caught) {
      // Already waiting (say, the first answer was lost): the list read again shows it.
      if (isOutreachProblem(caught, 'OUTREACH_INVITATION_ALREADY_SENT')) { attempt.current = null; void team.refresh() }
      setError(outreachProblemText(caught, 'The invitation could not be sent. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="outreach-team-heading">
      <Card>
        <CardHeader as="h2" icon={UserPlus} iconTone="brand" title="Your team" titleId="outreach-team-heading"
          description="Invite helpers by email. They register people at your campaigns, and can’t see any hospital’s records." />
        <div className="flex flex-col gap-4 p-5">
          <form className="grid gap-3 @xl:grid-cols-[1fr_1fr_auto] @xl:items-end" noValidate aria-label="Invite a helper" onSubmit={event => void invite(event)}>
            <OutreachField id="outreach-team-name" label="Their name" required error={errors.name}>
              <EhrInput maxLength={80} autoComplete="off" value={name} onChange={event => setName(event.target.value)}
                {...controlProps('outreach-team-name', errors.name)} />
            </OutreachField>
            <OutreachField id="outreach-team-email" label="Their email" required error={errors.email}>
              <EhrInput type="email" maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)}
                {...controlProps('outreach-team-email', errors.email)} />
            </OutreachField>
            <EhrButton type="submit" busy={busy}>{busy ? 'Sending…' : 'Send invitation'}</EhrButton>
          </form>
          <ErrorBox message={error} />
          <div role="status">{notice ? <p className="m-0 text-body text-ink-2">{notice}</p> : null}</div>
          {team.error ? <ErrorBox message={team.error} /> : null}
          {team.value && team.value.members.length === 0 && team.value.invitations.length === 0
            ? <p className="m-0 text-caption text-ink-3">No one invited yet.</p> : null}
          {team.value && team.value.members.length > 0 ? (
            <ul aria-label="Team members" className="m-0 list-none divide-y divide-line p-0">
              {team.value.members.map(member => (
                <li key={member.membershipId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold break-words">{member.name || member.email || 'Team member'}</span>
                    <span className="text-[13px] text-ink-3 break-all">{ROLE_WORDS[member.roleCode] ?? 'Team member'}{member.email && member.name ? ` · ${member.email}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[13px] text-ink-3">
                    {member.joinedAt ? <span>Joined {dateText(member.joinedAt)}</span> : null}
                    {member.status === 'active' ? <Badge size="sm" tone="success">Joined</Badge> : <Badge size="sm" tone="neutral">Not active</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {team.value && team.value.invitations.length > 0 ? (
            <ul aria-label="Team invitations" className="m-0 list-none divide-y divide-line p-0">
              {team.value.invitations.map(invitation => {
                const status = INVITATION_STATUS[invitation.status] ?? { label: 'Status not known', tone: 'neutral' as const }
                return (
                  <li key={invitation.invitationId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold break-words">{invitation.name}</span>
                      <span className="text-[13px] text-ink-3 break-all">{invitation.email}</span>
                    </span>
                    <span className="flex items-center gap-2 text-[13px] text-ink-3">
                      {invitation.status === 'pending' && invitation.expiresAt ? <span>Expires {dateText(invitation.expiresAt)}</span> : null}
                      <Badge size="sm" tone={status.tone}>{status.label}</Badge>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </Card>
    </section>
  )
}

/** What the page says as a registration is kept on this device: no connection, or Health ID unavailable just now. */
export function queuedText(fullName: string, reason: WaitReason): string {
  return reason === 'unavailable'
    ? `Health ID isn’t available right now. ${fullName}’s registration is saved on this device and will be sent automatically.`
    : `No connection: ${fullName}’s registration is saved on this device. It is sent when you are back online.`
}

const registrations = (count: number) => `${count} registration${count === 1 ? '' : 's'}`

/** What "Send now" did, in plain words: how many were sent, how many still wait and why, and how many Health ID refused. */
export function queueSyncText({ sent, waiting, refused, reason }: QueueSyncResult): string {
  const said: string[] = []
  if (sent > 0) said.push(`Sent ${registrations(sent)} to Health ID.`)
  if (waiting > 0) {
    const why = reason === 'unavailable' ? ' because Health ID isn’t available right now'
      : reason === 'connection' ? ' because there is no connection' : ''
    said.push(`${registrations(waiting)} couldn’t be sent yet${why}. ${waiting === 1 ? 'It stays' : 'They stay'} on this device and will be tried again.`)
  }
  if (refused > 0) said.push(`${registrations(refused)} ${refused === 1 ? 'wasn’t' : 'weren’t'} accepted by Health ID: see below.`)
  return said.length > 0 ? said.join(' ') : 'Nothing was waiting to be sent.'
}

/**
 * The registrations kept on this device, waiting for the network, or refused by Health ID once sent: "Send now", and
 * for a refused one what Health ID said and "Remove from this device".
 */
export function OutreachQueuePanel({ entries, durable, syncing, onSync, onDiscard }: {
  readonly entries: readonly PendingRegistration[]
  readonly durable: boolean
  readonly syncing: boolean
  readonly onSync: () => void
  readonly onDiscard: (localCommandId: string) => void
}) {
  if (entries.length === 0) return null
  const waiting = entries.filter(entry => entry.state === 'waiting').length
  return (
    <section aria-labelledby="outreach-queue-heading">
      <Card>
        <CardHeader as="h2" icon={CloudOff} iconTone="warn" title="Saved on this device" titleId="outreach-queue-heading"
          description={durable
            ? 'These registrations haven’t reached Health ID yet. They are sent when you are back online, even after a reload. Send them within 14 days: after that they are deleted from this device. Signing out deletes them too, so send them before you sign out.'
            : 'These registrations haven’t reached Health ID yet. This browser can’t keep them after a reload: stay on this page until they are sent.'} />
        <div className="flex flex-col gap-3 p-5">
          <ul aria-label="Registrations saved on this device" className="m-0 list-none divide-y divide-line p-0">
            {entries.map(entry => (
              <li key={entry.localCommandId} className="flex flex-col gap-1 py-2.5">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold break-words">{entry.input.fullName}</span>
                  <Badge size="sm" tone={entry.state === 'refused' ? 'danger' : 'warn'}>{entry.state === 'refused' ? 'Not accepted' : 'Waiting to send'}</Badge>
                </span>
                <span className="text-[13px] text-ink-3">Saved {dateText(entry.savedAt)}</span>
                {entry.state === 'refused' ? <>
                  <p role="alert" className="m-0 text-[13px] text-ink-2">{entry.refusal}</p>
                  <Button size="sm" className="self-start" onClick={() => onDiscard(entry.localCommandId)}>Remove from this device</Button>
                </> : null}
              </li>
            ))}
          </ul>
          {waiting > 0 ? <EhrButton variant="secondary" busy={syncing} onClick={() => { if (!syncing) onSync() }}>{syncing ? 'Sending…' : 'Send now'}</EhrButton> : null}
        </div>
      </Card>
    </section>
  )
}
