import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Users } from 'lucide-react'
import { FormActions, PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, Select, Textarea } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { staffApi, type OutreachCampaign, type OutreachCampaignRole } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptRecordLayout } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAMPAIGN_ROLES, CAMPAIGN_STALE, CAMPAIGN_STATUS_FAILED, campaignErrorText, campaignFacts, campaignStarted, campaignStatusLabel,
  COMPLETE_FIELD, controlProps, ErrorBox, MEMBER_ADD_FAILED, memberRoleLabel, MEMBERS_NOT_LOADED, NO_ACTIONS, OutreachField, REASON_LENGTH, RETRY_NOTE,
  servicesText, STAFF_NOT_LOADED, type FieldErrors, type MembersRead,
} from './outreachParts'

/**
 * One campaign's members, read as today's campaign card reads them: for every campaign
 * listed, as soon as it is listed. It draws nothing: the page keeps what it read, for the
 * campaign's record view and to know which campaigns a case may name.
 */
export function CampaignMembersRead({ facilityId, membershipId, campaign, onMembershipChange, onRead }: {
  readonly facilityId: string
  readonly membershipId: string | undefined
  readonly campaign: OutreachCampaign
  readonly onMembershipChange: (campaignId: string, isMember: boolean) => void
  readonly onRead: (campaignId: string, read: MembersRead | null) => void
}) {
  const members = useFacilityRead(facilityId, true, useCallback(id => staffApi.outreachCampaignMembers(id, campaign.id), [campaign.id]), MEMBERS_NOT_LOADED)
  useEffect(() => {
    if (members.value) onMembershipChange(campaign.id, members.value.some(member => member.membershipId === membershipId))
  }, [campaign.id, membershipId, members.value, onMembershipChange])
  const { value, loading, error, refresh } = members
  useEffect(() => {
    onRead(campaign.id, { facilityId, items: value, loading, error, refresh })
  }, [campaign.id, facilityId, value, loading, error, refresh, onRead])
  useEffect(() => () => onRead(campaign.id, null), [campaign.id, onRead])
  return null
}

type Action = 'open' | 'close' | 'add'
type ActionField = 'reason' | 'person'

/**
 * A campaign as the design's record view, its members listed under it. Where Outreach serves campaign management
 * (`manage`: hid-system#222, 0111, and the membership may write campaigns), the campaign's own admins open it (once it
 * has started), close it (for good, after a confirmation) and add people to it, each with what Outreach asks for; its
 * other members and staff are told that only its admins change it. Elsewhere it is read only, as before.
 */
export function OutreachCampaignView({ facilityId, campaign, members, manage, created = false, onBack, onChanged }: {
  readonly facilityId: string
  readonly campaign: OutreachCampaign
  readonly members: MembersRead | undefined
  /** Outreach serves campaign management and this membership may write campaigns. */
  readonly manage: boolean
  /** Opened from "New campaign", which made it. */
  readonly created?: boolean
  readonly onBack: () => void
  /** Reads the campaigns again. */
  readonly onChanged: () => Promise<void>
}) {
  const staff = useFacilityRead(facilityId, manage,
    useCallback((id: string) => staffApi.outreachCampaignStaff(id, campaign.id), [campaign.id]), STAFF_NOT_LOADED)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [problems, setProblems] = useState<FieldErrors<ActionField>>({ errors: {}, seq: 0 })
  const focus = useFocusById()
  const { ask, sheet } = useConfirm()
  const asking = useRef(false)
  const ids = {
    form: `outreach-campaign-${campaign.id}-action`,
    reason: `outreach-campaign-${campaign.id}-reason`,
    person: `outreach-campaign-${campaign.id}-person`,
    role: `outreach-campaign-${campaign.id}-role`,
    done: `outreach-campaign-${campaign.id}-done`,
    first: `outreach-campaign-${campaign.id}-first-action`,
  }

  const admin = manage && staff.value?.yourRole === 'admin'
  const closed = campaign.status === 'closed'
  const started = campaignStarted(campaign)
  const canOpen = admin && campaign.status === 'planned' && started
  const canClose = admin && !closed
  const canAdd = admin && !closed
  // A form stays open only while the campaign, as last read, still offers it.
  const shown = action === 'open' ? (canOpen ? action : null) : action === 'close' ? (canClose ? action : null)
    : action === 'add' ? (canAdd ? action : null) : null
  const candidates = (staff.value?.people ?? []).filter(person => person.campaignRole === null)
  const names = new Map((staff.value?.people ?? []).map(person => [person.membershipId, person.name]))

  const choose = (next: Action | null) => {
    if (busy) return
    setAction(next)
    setError('')
    setProblems(previous => ({ errors: {}, seq: previous.seq }))
    if (next) setDone('')
    focus(next ? (next === 'add' ? ids.person : ids.reason) : ids.first)
  }

  /** What a refusal means for what is shown: read the campaign (and its people) again when it is out of date. */
  async function refused(caught: unknown, fallback: string) {
    setError(campaignErrorText(caught, fallback))
    if (isHidApiError(caught) && CAMPAIGN_STALE.has(caught.code)) await Promise.all([onChanged(), staff.refresh()])
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>, status: 'active' | 'closed') {
    event.preventDefault()
    if (busy || asking.current) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setError('')
    const reasonError = !reason ? COMPLETE_FIELD : reason.length < 8 ? REASON_LENGTH : undefined
    if (reasonError) {
      const here = document.activeElement?.id === ids.reason
      setProblems(previous => ({ errors: { reason: reasonError }, alert: here ? 'reason' : undefined, seq: previous.seq + 1 }))
      if (!here) focus(ids.reason)
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    if (status === 'closed') {
      // Closing is for good: Outreach never opens a closed campaign again.
      asking.current = true
      let confirmed = false
      try {
        confirmed = await ask({ title: 'Close this campaign?', subject: <Card className="px-4 py-3"><p className="m-0 text-title-3 text-ink">{campaign.name}</p>
          <p className="m-0 text-caption text-ink-2">{campaignStatusLabel(campaign.status)} · starts {dateText(campaign.startsAt)}</p></Card>,
        effect: <>Closing finishes it for good: it can’t be opened again, and no one can register people into it any more. What was registered stays.</>,
        confirmLabel: 'Close campaign' })
      } finally { asking.current = false }
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await staffApi.setOutreachCampaignStatus(facilityId, campaign, status, reason)
      setAction(null)
      setDone(status === 'active' ? 'Campaign opened. Its members can now register people into it.'
        : 'Campaign closed. No one can register people into it any more.')
      focus(ids.done)
      await onChanged()
    } catch (caught) {
      await refused(caught, CAMPAIGN_STATUS_FAILED)
    } finally {
      setBusy(false)
    }
  }

  async function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const membershipId = String(form.get('membershipId') ?? '')
    const role = String(form.get('role') ?? 'enumerator') as OutreachCampaignRole
    setError('')
    if (!membershipId) {
      const here = document.activeElement?.id === ids.person
      setProblems(previous => ({ errors: { person: COMPLETE_FIELD }, alert: here ? 'person' : undefined, seq: previous.seq + 1 }))
      if (!here) focus(ids.person)
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    const name = names.get(membershipId) ?? 'The person'
    setBusy(true)
    try {
      await staffApi.addOutreachCampaignMember(facilityId, campaign.id, { membershipId, role })
      setAction(null)
      setDone(`${name} added as ${memberRoleLabel(role).toLowerCase()}.`)
      focus(ids.done)
      await Promise.all([staff.refresh(), members?.refresh()])
    } catch (caught) {
      await refused(caught, MEMBER_ADD_FAILED)
      if (isHidApiError(caught) && (caught.code === 'OUTREACH_CAMPAIGN_MEMBER_EXISTS' || caught.code === 'OUTREACH_STAFF_NOT_AVAILABLE')) {
        await Promise.all([staff.refresh(), members?.refresh()])
      }
    } finally {
      setBusy(false)
    }
  }

  const reasonField = (label: string, hint: string) => (
    <OutreachField id={ids.reason} label={label} required hint={hint}
      error={problems.errors.reason} alert={problems.alert === 'reason'} seq={problems.seq}>
      <Textarea name="reason" rows={3} minLength={8} maxLength={500} required {...controlProps(ids.reason, problems.errors.reason, true)} />
    </OutreachField>
  )
  const formFoot = (submit: string) => (
    <>
      <ErrorBox message={error} />
      {error ? <small className="hid-ehr-dept-outreach-note">{RETRY_NOTE}</small> : null}
      <FormActions sticky={false}>
        <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={() => choose(null)}>Cancel</Button>
        <Button type="submit" variant="primary" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : submit}</Button>
      </FormActions>
    </>
  )

  let actions
  if (!manage) {
    actions = <DeptActions empty={NO_ACTIONS} />
  } else if (staff.value === null) {
    actions = (
      <DeptActions empty={staff.error ? '' : 'Checking your role in this campaign…'}>
        {staff.error ? [<ErrorBox key="error" message={staff.error} />,
          <Button key="retry" onClick={() => void staff.refresh()}>Try again</Button>] : null}
      </DeptActions>
    )
  } else if (!admin) {
    actions = <DeptActions empty="Only this campaign’s admins can open it, close it or add people to it." />
  } else if (shown === 'open' || shown === 'close') {
    const opening = shown === 'open'
    actions = (
      <DeptActions title={opening ? 'Open campaign' : 'Close campaign'}>
        <form id={ids.form} className="flex flex-col gap-4" noValidate aria-label={opening ? 'Open campaign' : 'Close campaign'}
          onSubmit={event => void changeStatus(event, opening ? 'active' : 'closed')}>
          <p className="hid-ehr-dept-muted m-0">{opening
            ? 'Once it is open, its members can register people into it.'
            : 'Closing finishes it for good. It can’t be opened again.'}</p>
          {reasonField(opening ? 'Why it is opening' : 'Why it is closing',
            opening ? 'For example: the team is on site. At least 8 characters.' : 'For example: the work is done. At least 8 characters.')}
          {formFoot(opening ? 'Open campaign' : 'Close campaign')}
        </form>
      </DeptActions>
    )
  } else if (shown === 'add') {
    actions = (
      <DeptActions title="Add a person">
        <form id={ids.form} className="flex flex-col gap-4" noValidate aria-label="Add a person" onSubmit={event => void addPerson(event)}>
          <OutreachField id={ids.person} label="Person" required hint="Active staff at this facility who aren’t in this campaign yet."
            error={problems.errors.person} alert={problems.alert === 'person'} seq={problems.seq}>
            <Select name="membershipId" required defaultValue="" {...controlProps(ids.person, problems.errors.person, true)}>
              <option value="">Choose a person</option>
              {candidates.map(person => <option key={person.membershipId} value={person.membershipId}>{person.name}</option>)}
            </Select>
          </OutreachField>
          <OutreachField id={ids.role} label="Their role" required hint="A campaign admin can also open, close and add people to it.">
            <Select name="role" required defaultValue="enumerator" {...controlProps(ids.role, undefined, true)}>
              {CAMPAIGN_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </Select>
          </OutreachField>
          {formFoot('Add to campaign')}
        </form>
      </DeptActions>
    )
  } else {
    const offered = [
      canOpen ? <Button key="open" id={ids.first} variant="primary" onClick={() => choose('open')}>Open campaign</Button> : null,
      canAdd ? (candidates.length
        ? <Button key="add" id={canOpen ? undefined : ids.first} onClick={() => choose('add')}>Add a person</Button>
        : <p key="add" className="hid-ehr-dept-muted m-0">Everyone active at this facility is already in this campaign.</p>) : null,
      canClose ? <Button key="close" id={canOpen || (canAdd && candidates.length) ? undefined : ids.first} onClick={() => choose('close')}>Close campaign</Button> : null,
      admin && campaign.status === 'planned' && !started
        ? <p key="later" className="hid-ehr-dept-muted m-0">You can open it from {dateText(campaign.startsAt)}.</p> : null,
    ]
    actions = <DeptActions empty={closed ? 'This campaign is finished. Nothing more can be changed.' : NO_ACTIONS}>{offered}</DeptActions>
  }

  const items = members?.items ?? null
  const loading = !members || (members.loading && !items)
  return (
    <DeptPage title={campaign.name} onBack={onBack} backUnavailable={manage ? busy : undefined}>
      <DeptContextLine status={campaignStatusLabel(campaign.status)}
        items={[servicesText(campaign.services), `Starts ${dateText(campaign.startsAt)}`]} />
      {/* Mounted throughout, so what was done is announced. */}
      <div role="status" className="hid-ehr-sr-only">{done}</div>
      {created && !done ? (
        <Alert intent="success" title="Campaign created">You are its admin. Add the people who will work on it, then open it once it has started.</Alert>
      ) : null}
      {done ? <div id={ids.done} tabIndex={-1} className="outline-none"><Alert intent="success" title="Saved" live={false}>{done}</Alert></div> : null}
      {/* A refusal whose form is gone (the campaign, read again, no longer offers it) is said here instead. */}
      {error && !shown ? <ErrorBox message={error} /> : null}
      <DeptRecordLayout
        main={<DeptSection title="Saved record"><DeptFacts facts={campaignFacts(campaign)} /></DeptSection>}
        aside={actions}
      />
      <DeptSection title="Members">
        <PageState loading={loading} error={items ? null : members?.error || null} hasData={items !== null} what="members" rows={2}
          onRetry={members ? () => void members.refresh() : undefined}
          empty={items?.length === 0 ? { icon: Users, title: 'No members yet', description: 'No facility memberships are listed for this campaign.' } : null}>
          <ul className="hid-ehr-dept-rows">
            {(items ?? []).map(member => (
              <li key={member.id}>
                <div className="hid-ehr-dept-row-main">
                  <span className="hid-ehr-dept-row-title">{names.get(member.membershipId) ?? 'Team member'}</span>
                  <span className="hid-ehr-dept-muted">Added {dateText(member.createdAt)}</span>
                </div>
                <Badge size="sm">{memberRoleLabel(member.role)}</Badge>
              </li>
            ))}
          </ul>
        </PageState>
      </DeptSection>
      {sheet}
    </DeptPage>
  )
}
