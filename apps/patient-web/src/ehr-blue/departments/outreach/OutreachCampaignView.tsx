import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EhrBadge, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { UserSearch, Users } from 'lucide-react'
import { FormActions, PageState } from '../../../kasuwa/parts'
import { Alert, Button, Card } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { staffApi, type OutreachCampaign, type OutreachCampaignRole, type OutreachCase } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptRecordLayout } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { CaseCard, ShowMore, useOutreachCases } from './OutreachCaseList'
import { healthIdUnavailable, noConnection } from './offlineQueue'
import { OutreachNumbers } from './outreachNumbers'
import {
  CAMPAIGN_ROLES, CAMPAIGN_STALE, CAMPAIGN_STATUS_FAILED, campaignErrorText, campaignFacts, campaignOpenNow, campaignStarted, campaignStatusLabel,
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
  const { value, loading, error, caught, refresh } = members
  useEffect(() => {
    onRead(campaign.id, { facilityId, items: value, loading, error, caught, refresh })
  }, [campaign.id, facilityId, value, loading, error, caught, refresh, onRead])
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
export function OutreachCampaignView({ facilityId, campaign, members, manage, group = false, created = false, exportAction, registrations, onBack, onChanged }: {
  readonly facilityId: string
  readonly campaign: OutreachCampaign
  readonly members: MembersRead | undefined
  /** Outreach serves campaign management and this membership may write campaigns. */
  readonly manage: boolean
  /**
   * The working facility is an outreach group, whose helpers join it and are in no campaign until added. Only there is
   * everyone not in the campaign yet offered at once: at a hospital that would be every member of its staff.
   */
  readonly group?: boolean
  /** Opened from "New campaign", which made it. */
  readonly created?: boolean
  /** "Export" for this campaign's registrations (OutreachExport.tsx), for those who can read them. */
  readonly exportAction?: ReactNode
  /** For those who can read registrations: this campaign's, newest first, with "Show more" and a way to open each. */
  readonly registrations?: {
    readonly canLink: boolean
    readonly group: boolean
    readonly onOpen: (item: OutreachCase) => void
  }
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
  // Set at once, so a second tap before the page draws again starts nothing.
  const addingAll = useRef(false)
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
  // At an outreach group only: everyone who has joined it and isn't in this campaign yet, added at once.
  const canAddEveryone = group && canAdd
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

  /**
   * Adds everyone at the outreach group who isn't in this campaign yet as an enumerator, one after another (never at
   * once). Someone already in it counts as added. A refusal that means the campaign is out of date stops the rest and is
   * said as "Add a person" says it; so does a failure that would meet every request the same way (no signal, too slow,
   * Health ID unavailable, signed out, no access). Any other refusal is about that person: listed by name once the rest
   * are added.
   */
  async function addEveryone() {
    if (busy || addingAll.current) return
    addingAll.current = true
    const people = candidates
    setError('')
    setDone('')
    setBusy(true)
    let added = 0
    const missed: string[] = []
    let stale = false
    let stopped = false
    let stopRefusal: unknown
    try {
      for (const person of people) {
        try {
          await staffApi.addOutreachCampaignMember(facilityId, campaign.id, { membershipId: person.membershipId, role: 'enumerator' })
          added += 1
        } catch (caught) {
          if (isHidApiError(caught) && caught.code === 'OUTREACH_CAMPAIGN_MEMBER_EXISTS') {
            added += 1
          } else if (isHidApiError(caught) && CAMPAIGN_STALE.has(caught.code)) {
            stale = true
            stopRefusal = caught
            break
          } else if (noConnection(caught) || healthIdUnavailable(caught) || (isHidApiError(caught) && (caught.status === 401 || caught.status === 403))) {
            stopped = true
            stopRefusal = caught
            break
          } else {
            missed.push(person.name)
          }
        }
      }
      const missedText = missed.length
        ? `${missed.length === 1 ? '1 person' : `${missed.length} people`} couldn’t be added: ${missed.join(', ')}.` : ''
      if (added) {
        // Said only as it will be: the registration form lists a campaign once it is open and takes registrations.
        const registering = campaign.services.includes('registration')
        const running = registering && campaign.status === 'active' && campaignOpenNow(campaign)
        setDone(`${added === 1 ? 'Added 1 person as an enumerator.' : `Added ${added} people as enumerators.`}`
          + (running ? ' They can register people once they press Refresh.'
            : registering ? ' They can register people once the campaign is open and they press Refresh.' : ''))
        focus(ids.done)
      }
      if (stale) await refused(stopRefusal, MEMBER_ADD_FAILED)
      else if (stopped) setError([campaignErrorText(stopRefusal, MEMBER_ADD_FAILED), missedText].filter(Boolean).join(' '))
      else if (missed.length) setError(`${missedText} Try again.`)
      // With no signal, reading again would only wait as long again: the button still counts who is left to add.
      if (!(stopped && noConnection(stopRefusal))) await Promise.all([staff.refresh(), members?.refresh()])
    } finally {
      addingAll.current = false
      setBusy(false)
    }
  }

  const reasonField = (label: string, hint: string) => (
    <OutreachField id={ids.reason} label={label} required hint={hint}
      error={problems.errors.reason} alert={problems.alert === 'reason'} seq={problems.seq}>
      <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required {...controlProps(ids.reason, problems.errors.reason, true)} />
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
            <EhrSelect name="membershipId" required defaultValue="" {...controlProps(ids.person, problems.errors.person, true)}>
              <option value="">Choose a person</option>
              {candidates.map(person => <option key={person.membershipId} value={person.membershipId}>{person.name}</option>)}
            </EhrSelect>
          </OutreachField>
          <OutreachField id={ids.role} label="Their role" required hint="A campaign admin can also open, close and add people to it.">
            <EhrSelect name="role" required defaultValue="enumerator" {...controlProps(ids.role, undefined, true)}>
              {CAMPAIGN_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </EhrSelect>
          </OutreachField>
          {formFoot('Add to campaign')}
        </form>
      </DeptActions>
    )
  } else {
    const offered = [
      canOpen ? <Button key="open" id={ids.first} variant="primary" onClick={() => choose('open')}>Open campaign</Button> : null,
      canAdd ? (candidates.length
        ? <Button key="add" id={canOpen ? undefined : ids.first} className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined}
          onClick={() => choose('add')}>Add a person</Button>
        : <p key="add" className="hid-ehr-dept-muted m-0">Everyone active at this facility is already in this campaign.</p>) : null,
      canAddEveryone && candidates.length
        ? <Button key="add-everyone" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}
          onClick={() => void addEveryone()}>{busy ? 'Adding…' : candidates.length === 1
            ? 'Add the 1 person who has joined' : `Add everyone who has joined (${candidates.length})`}</Button> : null,
      canClose ? <Button key="close" id={canOpen || (canAdd && candidates.length) ? undefined : ids.first} onClick={() => choose('close')}>Close campaign</Button> : null,
      admin && campaign.status === 'planned' && !started
        ? <p key="later" className="hid-ehr-dept-muted m-0">You can open it from {dateText(campaign.startsAt)}.</p> : null,
    ]
    actions = <DeptActions empty={closed ? 'This campaign is finished. Nothing more can be changed.' : NO_ACTIONS}>{offered}</DeptActions>
  }

  const items = members?.items ?? null
  const loading = !members || (members.loading && !items)
  return (
    <DeptPage title={campaign.name} onBack={onBack} backUnavailable={manage ? busy : undefined} secondaryActions={exportAction}>
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
                <EhrBadge>{memberRoleLabel(member.role)}</EhrBadge>
              </li>
            ))}
          </ul>
        </PageState>
      </DeptSection>
      {registrations ? <CampaignRegistrations facilityId={facilityId} campaign={campaign} {...registrations} /> : null}
      {sheet}
    </DeptPage>
  )
}

/**
 * A campaign's registrations, newest first: its newest 100 (asked by campaign; an Outreach before paging sends its newest
 * 100 of every campaign, and only this campaign's are kept), then "Show more" while older ones are left.
 */
function CampaignRegistrations({ facilityId, campaign, canLink, group, onOpen }: {
  readonly facilityId: string
  readonly campaign: OutreachCampaign
  readonly canLink: boolean
  readonly group: boolean
  readonly onOpen: (item: OutreachCase) => void
}) {
  const cases = useOutreachCases(facilityId, true, campaign.id)
  const rows = cases.value ?? []
  return (
    <DeptSection title="Registrations">
      {cases.error && cases.value ? <Alert intent="error" title="Couldn’t refresh registrations">{cases.error}</Alert> : null}
      <PageState loading={cases.loading} error={cases.value ? null : cases.error || null} hasData={cases.value !== null} what="registrations" rows={2}
        onRetry={() => void cases.refresh()}
        empty={cases.value?.length === 0 && !cases.more.available
          ? { icon: UserSearch, title: 'No registrations yet', description: 'People registered into this campaign show here.' } : null}>
        <div className="flex flex-col gap-3">
          <OutreachNumbers cases={cases.value} more={cases.more.available} label={`Numbers for ${campaign.name}`} />
          <ul aria-label={`Registrations in ${campaign.name}`} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
            {rows.map(item => <CaseCard key={item.id} item={item} campaign={campaign} canLink={canLink} group={group} onOpen={() => onOpen(item)} />)}
          </ul>
          <ShowMore more={cases.more} shown={rows.length} />
        </div>
      </PageState>
    </DeptSection>
  )
}
