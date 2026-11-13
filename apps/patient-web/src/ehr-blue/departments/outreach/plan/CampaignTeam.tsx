import { useCallback, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Mail, Phone, RotateCcw, Trash2, UserCog, UserPlus, Users } from 'lucide-react'
import { ConfirmSheet, PageState } from '../../../../kasuwa/parts'
import { Drawer } from '../../../../kasuwa/interactive'
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, Select, type Tone } from '../../../../kasuwa/ui'
import { useToast } from '../../../../kasuwa/toast'
import { useDeptAccess } from '../../parts/access'
import { useFacilityRead } from '../../parts/useFacilityRead'
import { campaignFlowErrorText, newLocalCommandId, NOT_OFFERED, outreachCampaignApi, whenOffered } from '../campaignApi'
import {
  roleLabel, STATIONS, stationLabel, TEAM_ROLES, type CampaignSite, type CampaignTeamMember, type StationKind, type StationMode, type TeamRole,
  type TeamMemberStatus,
} from '../campaignTypes'
import { isOrganiser, isOutreachGroup, OutreachTeam } from '../outreachGroup'
import { ChoiceChips, enterMovesOn, fieldProps, PlanField } from './planParts'
import { listInWords } from './planDraft'

/*
 * A campaign's team (owner decisions of 13 November 2026): everyone on it as a card (roles in words, site, station,
 * where their invitation stands, and how many people they registered and screened), and, for coordinators, Invite (by
 * phone or email, one or more roles, a site and a station), Change, Resend and Remove. Every invitation carries an
 * Idempotency-Key: the same person sent again keeps the same key, so a lost answer never invites twice. Where Outreach
 * doesn't serve campaign teams yet, an outreach group's organiser keeps inviting helpers by email, as before.
 */

const STATUS: Readonly<Record<TeamMemberStatus, { label: string; tone: Tone }>> = {
  invited: { label: 'Invite sent', tone: 'warn' },
  accepted: { label: 'Joined', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Invite expired', tone: 'neutral' },
  removed: { label: 'Removed', tone: 'neutral' },
}

/** The station a role usually works at, for the invite's default. */
const ROLE_STATION: Partial<Record<TeamRole, StationKind>> = {
  registrar: 'register', vitals: 'vitals', tester: 'tests', counsellor: 'counselling', clinician: 'results',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?\d{10,14}$/

/** A typed phone or email as Outreach takes it, or null when it is neither. */
export function contactFrom(typed: string): { phone: string } | { email: string } | null {
  const value = typed.trim()
  if (value.includes('@')) return EMAIL.test(value) ? { email: value.toLowerCase() } : null
  const phone = value.replace(/[\s()-]/g, '')
  return PHONE.test(phone) ? { phone } : null
}

type TeamRead = { readonly offered: false } | { readonly offered: true; readonly members: readonly CampaignTeamMember[]; readonly you: { readonly roles: readonly TeamRole[] } | null }
interface PlanBits { readonly sites: readonly CampaignSite[]; readonly stationMode: StationMode; readonly stations: readonly StationKind[] }

interface MemberForm { contact: string; name: string; roles: TeamRole[]; siteId: string; station: string }

export function CampaignTeam({ campaignId, facilityId: given, embedded = false }: {
  readonly campaignId: string
  readonly facilityId?: string
  /** Inside another page: says nothing where Outreach doesn't serve campaign teams yet (an organiser still sees "Your team"). */
  readonly embedded?: boolean
}) {
  const access = useDeptAccess()
  const facilityId = given ?? access.facilityId
  const toast = useToast()
  const team = useFacilityRead<TeamRead>(facilityId, true, useCallback(async (id: string) => {
    const read = await whenOffered(() => outreachCampaignApi.team(id, campaignId))
    return read.offered ? { offered: true, members: read.value.members, you: read.value.you } : { offered: false }
  }, [campaignId]), 'The team could not be loaded. Try again.')
  const plan = useFacilityRead<PlanBits | null>(facilityId, true, useCallback(async (id: string) => {
    try {
      const read = await whenOffered(() => outreachCampaignApi.plan(id, campaignId))
      return read.offered ? read.value : null
    } catch { return null }
  }, [campaignId]), '')

  const [drawer, setDrawer] = useState<{ kind: 'invite' } | { kind: 'change'; member: CampaignTeamMember } | null>(null)
  const [form, setForm] = useState<MemberForm>({ contact: '', name: '', roles: ['registrar'], siteId: '', station: 'register' })
  const [errors, setErrors] = useState<{ contact?: string; roles?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<CampaignTeamMember | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  // The same person invited again keeps their key: a lost answer, sent again, invites them once.
  const attempt = useRef<{ signature: string; key: string } | null>(null)

  if (team.value && !team.value.offered) {
    if (isOutreachGroup(access.facility) && isOrganiser(access.facility) && facilityId) return <OutreachTeam facilityId={facilityId} />
    return embedded ? null : <EmptyState compact icon={Users} description={NOT_OFFERED} />
  }

  const read = team.value?.offered ? team.value : null
  const coordinator = read?.you?.roles.includes('coordinator') ?? false
  const sites = plan.value?.sites ?? []
  const split = plan.value ? plan.value.stationMode === 'split' : true
  const stationOptions = STATIONS.filter(station => !plan.value || plan.value.stationMode === 'one_person' || plan.value.stations.includes(station.value))
  const siteName = (siteId: string | null) => sites.find(site => site.id === siteId)?.name ?? null

  const startInvite = () => {
    setForm({ contact: '', name: '', roles: ['registrar'], siteId: sites[0]?.id ?? '', station: split ? 'register' : '' })
    setErrors({}); setError('')
    setDrawer({ kind: 'invite' })
  }
  const startChange = (member: CampaignTeamMember) => {
    setForm({ contact: member.phone ?? member.email ?? '', name: member.name ?? '', roles: [...member.roles], siteId: member.siteId ?? '', station: member.station ?? '' })
    setErrors({}); setError('')
    setDrawer({ kind: 'change', member })
  }
  const close = () => { if (!busy) setDrawer(null) }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy || !drawer || !facilityId) return
    const found: typeof errors = {}
    const contact = drawer.kind === 'invite' ? contactFrom(form.contact) : null
    if (drawer.kind === 'invite' && !contact) found.contact = 'Enter a phone number like 08012345678, or an email address.'
    if (!form.roles.length) found.roles = 'Choose at least one role.'
    setErrors(found)
    if (found.contact || found.roles) {
      document.getElementById(found.contact ? 'team-contact' : `team-roles-${TEAM_ROLES[0]!.value}`)?.focus()
      return
    }
    setError('')
    setBusy(true)
    try {
      if (drawer.kind === 'invite') {
        const invite = { ...contact!, ...(form.name.trim() ? { name: form.name.trim() } : {}), roles: form.roles,
          ...(form.siteId ? { siteId: form.siteId } : {}), ...(form.station ? { station: form.station as StationKind } : {}) }
        const signature = JSON.stringify([facilityId, campaignId, invite])
        if (attempt.current?.signature !== signature) attempt.current = { signature, key: newLocalCommandId() }
        await outreachCampaignApi.inviteTeamMember(facilityId, campaignId, invite, attempt.current.key)
        attempt.current = null
        toast.success(`Invitation sent to ${form.name.trim() || form.contact.trim()}.`)
      } else {
        await outreachCampaignApi.changeTeamMember(facilityId, campaignId, drawer.member,
          { roles: form.roles, siteId: form.siteId || null, station: (form.station || null) as StationKind | null })
        toast.success(`Roles saved for ${drawer.member.name ?? drawer.member.phone ?? drawer.member.email ?? 'this person'}.`)
      }
      setDrawer(null)
      await team.refresh()
    } catch (caught) {
      setError(campaignFlowErrorText(caught, drawer.kind === 'invite' ? 'The invitation could not be sent. Try again.' : 'The change could not be saved. Try again.'))
      if (isHidApiError(caught) && (caught.code === 'VERSION_CONFLICT' || caught.code === 'OUTREACH_TEAM_MEMBER_EXISTS')) await team.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function resend(member: CampaignTeamMember) {
    if (!facilityId || working) return
    setWorking(member.memberId)
    try {
      await outreachCampaignApi.inviteTeamMember(facilityId, campaignId, {
        ...(member.phone ? { phone: member.phone } : { email: member.email ?? '' }), ...(member.name ? { name: member.name } : {}), roles: member.roles,
        ...(member.siteId ? { siteId: member.siteId } : {}), ...(member.station ? { station: member.station } : {}),
      }, newLocalCommandId())
      toast.success(`Invitation sent again to ${member.name ?? member.phone ?? member.email}.`)
      await team.refresh()
    } catch (caught) {
      toast.error(campaignFlowErrorText(caught, 'The invitation could not be sent again. Try again.'))
    } finally {
      setWorking(null)
    }
  }

  async function remove() {
    if (!removing || !facilityId) return
    setBusy(true)
    try {
      await outreachCampaignApi.removeTeamMember(facilityId, campaignId, removing)
      toast.success(`${removing.name ?? 'They'} ${removing.name ? 'is' : 'are'} off the team.`)
      setRemoving(null)
      await team.refresh()
    } catch (caught) {
      toast.error(campaignFlowErrorText(caught, 'They could not be removed. Try again.'))
      setRemoving(null)
      if (isHidApiError(caught) && caught.code === 'VERSION_CONFLICT') await team.refresh()
    } finally {
      setBusy(false)
    }
  }

  const members = (read?.members ?? []).filter(member => member.status !== 'removed')
  const waiting = members.filter(member => member.status === 'invited').length
  const joined = members.filter(member => member.status === 'accepted').length

  return (
    <section aria-labelledby={`team-${campaignId}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`team-${campaignId}-heading`} className="m-0 text-title-2 text-ink">Team</h2>
          {read ? <p className="m-0 text-sm text-ink-2">{joined} joined{waiting ? ` · ${waiting} invite${waiting === 1 ? '' : 's'} waiting` : ''}</p> : null}
        </div>
        {coordinator ? <Button variant="primary" icon={UserPlus} onClick={startInvite}>Invite</Button> : null}
      </div>
      <PageState loading={team.loading} error={read ? null : team.error || null} hasData={read !== null} what="the team" rows={3} onRetry={() => void team.refresh()}
        empty={read && members.length === 0 ? { icon: Users, title: 'No one on the team yet', description: coordinator ? 'Invite the people who will work on this campaign.' : undefined } : null}>
        <ul aria-label="Team members" className="m-0 grid list-none gap-3 p-0 @2xl:grid-cols-2">
          {members.map(member => {
            const status = STATUS[member.status]
            const who = member.name ?? member.phone ?? member.email ?? 'Invited person'
            const place = [siteName(member.siteId), member.station ? stationLabel(member.station) : null].filter(Boolean).join(' · ')
            return (
              <Card as="li" key={member.memberId} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={who} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold break-words text-ink">{who}</p>
                    <p className="m-0 text-[13px] text-ink-2">{listInWords(member.roles.map(roleLabel))}</p>
                    {place ? <p className="m-0 text-[13px] text-ink-3">{place}</p> : null}
                    {member.name && (member.phone || member.email) ? (
                      <p className="m-0 flex items-center gap-1 text-[13px] break-all text-ink-3">
                        {member.phone ? <Phone className="size-3.5 shrink-0" aria-hidden /> : <Mail className="size-3.5 shrink-0" aria-hidden />}{member.phone ?? member.email}
                      </p>
                    ) : null}
                  </div>
                  <Badge size="sm" tone={status.tone}>{status.label}</Badge>
                </div>
                {member.status === 'accepted' || member.registered || member.screened ? (
                  <dl className="m-0 grid grid-cols-2 gap-2 rounded-lg bg-tray px-3 py-2">
                    <div><dt className="text-[12px] text-ink-3">Registered</dt><dd className="m-0 text-title-3 text-ink tabular">{member.registered}</dd></div>
                    <div><dt className="text-[12px] text-ink-3">Screened</dt><dd className="m-0 text-title-3 text-ink tabular">{member.screened}</dd></div>
                  </dl>
                ) : null}
                {coordinator ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon={UserCog} aria-label={`Change roles for ${who}`} onClick={() => startChange(member)}>Change roles</Button>
                    {member.status === 'invited' || member.status === 'expired' ? (
                      <Button size="sm" icon={RotateCcw} loading={working === member.memberId} aria-label={`Resend the invitation to ${who}`} onClick={() => void resend(member)}>Resend</Button>
                    ) : null}
                    <Button size="sm" variant="danger" icon={Trash2} aria-label={`Remove ${who}`} onClick={() => setRemoving(member)}>Remove</Button>
                  </div>
                ) : null}
              </Card>
            )
          })}
        </ul>
      </PageState>
      {team.error && read ? <Alert intent="error" title="Couldn’t load the latest team" action={<Button size="sm" onClick={() => void team.refresh()}>Try again</Button>}>{team.error}</Alert> : null}

      <Drawer open={drawer !== null} onClose={close}
        title={drawer?.kind === 'change' ? `Change roles for ${drawer.member.name ?? drawer.member.phone ?? drawer.member.email ?? 'this person'}` : 'Invite to the team'}
        description={drawer?.kind === 'invite' ? 'They get a text or an email with a link to join.' : undefined}
        footer={<>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{busy ? 'Saving…' : drawer?.kind === 'change' ? 'Save' : 'Send invitation'}</Button>
        </>}>
        <form className="flex flex-col gap-4" noValidate aria-label={drawer?.kind === 'change' ? 'Change roles' : 'Invite to the team'}
          onSubmit={event => void submit(event)} onKeyDown={enterMovesOn}>
          {drawer?.kind === 'invite' ? (
            <>
              <PlanField id="team-contact" label="Phone or email" required error={errors.contact} hint="Like 08012345678 or name@example.com.">
                <Input className="h-12 text-base sm:h-11 sm:text-sm" data-autofocus type="text" inputMode="email" autoComplete="off" maxLength={254} value={form.contact}
                  onChange={event => setForm({ ...form, contact: event.target.value })} {...fieldProps('team-contact', errors.contact, true)} />
              </PlanField>
              <PlanField id="team-name" label="Their name" optional>
                <Input className="h-12 text-base sm:h-11 sm:text-sm" id="team-name" autoComplete="off" maxLength={80} value={form.name}
                  onChange={event => setForm({ ...form, name: event.target.value })} />
              </PlanField>
            </>
          ) : null}
          <ChoiceChips name="roles" id="team-roles" legend="Roles" hint="One person can have several." options={TEAM_ROLES} values={form.roles} error={errors.roles}
            onChange={roles => {
              const added = roles.find(role => !form.roles.includes(role))
              const station = split && added && ROLE_STATION[added] && (!form.station || form.roles.length === 0) ? ROLE_STATION[added]! : form.station
              setForm({ ...form, roles, station })
            }} />
          {sites.length ? (
            <PlanField id="team-site" label="Site">
              <Select id="team-site" className="[&_select]:h-12 sm:[&_select]:h-11" value={form.siteId} onChange={event => setForm({ ...form, siteId: event.target.value })}>
                <option value="">Any site</option>
                {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
              </Select>
            </PlanField>
          ) : null}
          {split ? (
            <PlanField id="team-station" label="Station">
              <Select id="team-station" className="[&_select]:h-12 sm:[&_select]:h-11" value={form.station} onChange={event => setForm({ ...form, station: event.target.value })}>
                <option value="">Any station</option>
                {stationOptions.map(station => <option key={station.value} value={station.value}>{station.label}</option>)}
              </Select>
            </PlanField>
          ) : null}
          {error ? <Alert intent="error" title={error} /> : null}
        </form>
      </Drawer>

      <ConfirmSheet open={removing !== null} onClose={() => setRemoving(null)} destructive busy={busy}
        title={`Remove ${removing?.name ?? 'this person'} from the team?`}
        effect={removing?.status === 'invited' ? 'Their invitation is withdrawn.' : 'They can no longer work on this campaign. The people they registered and screened stay, and still count.'}
        confirmLabel="Remove" onConfirm={() => void remove()} />
    </section>
  )
}
