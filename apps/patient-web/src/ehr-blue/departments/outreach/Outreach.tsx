import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { ArrowRight, CircleCheck, Megaphone, Plus, RotateCcw, Search, UserPlus, Users } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, FilterTabs, Input } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase, type OutreachOrganiserStatus } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { focusLost } from '../../../pageFocus'
import { NO_OUTREACH } from '../../../staff/refusedWork'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { dateText, matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { OutreachCampaignNew } from './OutreachCampaignNew'
import { CampaignMembersRead, OutreachCampaignView } from './OutreachCampaignView'
import { OutreachCaseView } from './OutreachCaseView'
import { OutreachNew, type CaseAttempt, type OutreachGroupForm } from './OutreachNew'
import { isOrganiser, isOutreachGroup, OutreachGroupBanner, OutreachQueuePanel, OutreachTeam } from './outreachGroup'
import { useOutreachQueue } from './offlineQueue'
import {
  ageText, campaignOpenNow, CAMPAIGNS_NOT_LOADED, caseName, caseTone, CASES_NOT_LOADED, caseSearchText, caseWaiting, createdText, ErrorBox,
  NO_FACILITY, nextStepText, sexText, statusLabel, type MembersRead,
} from './outreachParts'
import type { OutreachVisit } from './campaignTypes'
import { VisitView } from './day'
import { CampaignPlanWizard } from './plan'
import { CampaignCards } from './insight/CampaignCards'
import { CampaignHub } from './insight/CampaignHub'
import { canReadReport, hubRoles, type CampaignTab } from './insight/tabs'
import { CampaignReport } from './insight/CampaignReport'
import { CampaignSummaryRead, type CampaignSummary } from './insight/campaignSummary'

/** The design's list shows this many records a page. */
const PAGE_SIZE = 50

/**
 * Where the page is: its lists, the create form, or one record. In memory only: nothing about
 * a record goes in the address or the history. `snapshot` is the record as it was opened, shown
 * while the list is read again; `created` marks a case the create form has just made.
 */
type View =
  | { kind: 'list'; focus?: string }
  | { kind: 'new' }
  | { kind: 'case'; id: string; snapshot: OutreachCase; created: boolean }
  /** A campaign: its hub (with the tab shown) where its campaign routes are served, else today's record. */
  | { kind: 'campaign'; id: string; snapshot: OutreachCampaign; created?: boolean; tab?: CampaignTab }
  /** Today's campaign record (open, close, members), from a campaign hub's "Campaign record". */
  | { kind: 'record'; id: string; snapshot: OutreachCampaign; tab?: CampaignTab }
  /** One person's visit in a campaign, from its People tab (or just registered at Today). */
  | { kind: 'visit'; campaign: OutreachCampaign; caseId: string; tab: CampaignTab }
  | { kind: 'report'; campaign: OutreachCampaign; tab?: CampaignTab }
  | { kind: 'newCampaign' }

type FocusRequest = { id?: string; ifLost: boolean }

/**
 * Whether Outreach serves campaign management (hid-system#222, 0111: a campaign's own admins open, close and staff it).
 * An Outreach before it answers 404, and the page then keeps campaigns read only.
 */
async function campaignsManaged(facilityId: string): Promise<Governance> {
  try {
    const answer = await staffApi.outreachCampaignGovernance(facilityId)
    return { managed: answer?.rule === 'campaign_admins', organiserStatus: answer?.organiserStatus }
  } catch (caught) {
    if (isHidApiError(caught) && caught.status === 404) return { managed: false }
    throw caught
  }
}

/**
 * What the governance read says: whether a campaign's own admins manage it, and, with open sign-up on outreach., where
 * an outreach group stands with Health ID (an earlier Outreach says nothing of it).
 */
interface Governance {
  readonly managed: boolean
  readonly organiserStatus?: OutreachOrganiserStatus
}

/**
 * Outreach in the blue Hospital EHR: registration cases and campaigns as the design's
 * workspace (a list with search, Quick view and Open; a record view with "Saved record" and
 * "Available actions"; "Create record" for a new case), on today's staff API and its rules
 * (staff/routes/Operations.tsx Outreach, CampaignCard, OutreachCaseCard): registration cases
 * created and linked to a verified existing patient; campaigns read, and, where Outreach serves
 * campaign management to a membership that may write campaigns, created, and opened, closed and
 * staffed by their own admins.
 */
export function Outreach() {
  const { facility, facilityId, membershipId, permissions, actorId } = useDeptAccess()
  const { lock } = useStaff()
  // An outreach group's own facility (open sign-up on outreach.), as its roles say; a hospital's outreach team is not one.
  const group = isOutreachGroup(facility)
  const organiser = group && isOrganiser(facility)
  const canReadCases = permissions.includes('outreach.registration.read')
  const canReadCampaigns = permissions.includes('outreach.campaign.read')
  const canWrite = permissions.includes('outreach.registration.write')
  // Campaign management is offered only where Outreach says it serves it, and is never asked of anyone who may not use it.
  // At an outreach group every member reading campaigns asks too, for where the group stands with Health ID.
  const askGovernance = canReadCampaigns && (permissions.includes('outreach.campaign.write') || group)
  const governance = useFacilityRead(facilityId, askGovernance, campaignsManaged, '')
  const canManage = askGovernance && permissions.includes('outreach.campaign.write') && governance.value?.managed === true
  const organiserStatus = group ? governance.value?.organiserStatus : undefined
  const campaigns = useFacilityRead(facilityId, canReadCampaigns, useCallback((id: string) => staffApi.outreachCampaigns(id), []), CAMPAIGNS_NOT_LOADED)
  const cases = useFacilityRead(facilityId, canReadCases, useCallback((id: string) => staffApi.outreachCases(id), []), CASES_NOT_LOADED)
  const caseAttempt = useRef<CaseAttempt>(null)

  // Each campaign's members, as read for it, by campaign.
  const [members, setMembers] = useState<ReadonlyMap<string, MembersRead>>(() => new Map())
  const recordMembers = useCallback((campaignId: string, read: MembersRead | null) => {
    setMembers(previous => {
      if (!read && !previous.has(campaignId)) return previous
      const next = new Map(previous)
      if (read) next.set(campaignId, read)
      else next.delete(campaignId)
      return next
    })
  }, [])
  // What each campaign's own routes say (owner decisions of 13 November 2026): whether they are served, the caller's
  // team roles, the plan and the counts. Read again with the campaigns (`summaryEpoch`).
  const [summaries, setSummaries] = useState<ReadonlyMap<string, CampaignSummary>>(() => new Map())
  const [summaryEpoch, setSummaryEpoch] = useState(0)
  const recordSummary = useCallback((campaignId: string, summary: CampaignSummary) => {
    setSummaries(previous => new Map(previous).set(campaignId, summary))
  }, [])
  const summaryOf = useCallback((campaignId: string) => {
    const summary = summaries.get(campaignId)
    return summary?.facilityId === facilityId ? summary : undefined
  }, [summaries, facilityId])
  const [eligibleCampaigns, setEligibleCampaigns] = useState<{ facilityId: string; ids: Set<string> }>({ facilityId: '', ids: new Set() })
  const recordMembership = useCallback((campaignId: string, isMember: boolean) => {
    setEligibleCampaigns(previous => {
      const ids = previous.facilityId === facilityId ? new Set(previous.ids) : new Set<string>()
      if (isMember) ids.add(campaignId)
      else ids.delete(campaignId)
      if (previous.facilityId === facilityId && ids.size === previous.ids.size && ids.has(campaignId) === previous.ids.has(campaignId)) return previous
      return { facilityId: facilityId ?? '', ids }
    })
  }, [facilityId])
  // Only active registration campaigns containing this facility membership, inside their start and end times, can take a case.
  const caseCampaigns = useMemo(() => (campaigns.value ?? []).filter(campaign => campaign.status === 'active'
    && campaign.services.includes('registration') && campaignOpenNow(campaign)
    && eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id)),
  [campaigns.value, eligibleCampaigns, facilityId])

  // The view belongs to the facility it was opened at; another facility opens on its lists.
  const [place, setPlace] = useState<{ facilityId: string | undefined; view: View }>({ facilityId, view: { kind: 'list' } })
  const view: View = place.facilityId === facilityId ? place.view : { kind: 'list' }
  const viewRef = useRef(view)
  viewRef.current = view

  // Focus moves with the view, in the commit that shows it: to the new view's heading, or back to the record opened.
  const root = useRef<HTMLDivElement>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  useLayoutEffect(() => {
    if (!focusRequest || lock != null) return
    setFocusRequest(null)
    if (focusRequest.ifLost && !focusLost()) return
    const target = (focusRequest.id ? document.getElementById(focusRequest.id) : null) ?? root.current?.querySelector<HTMLElement>('h1') ?? null
    if (!target) return
    if (target.tagName === 'H1' && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus()
  }, [focusRequest, lock])
  const show = useCallback((next: View, focusId?: string) => {
    setPlace({ facilityId, view: next })
    setFocusRequest({ id: focusId, ifLost: false })
  }, [facilityId])
  const backToList = useCallback((from?: string) => show({ kind: 'list' }, from), [show])
  const focusHeadingIfLost = useCallback(() => setFocusRequest({ ifLost: true }), [])

  // What the last create said, for the facility it was made at: written into a status region that stays mounted
  // across the views, so it is announced whatever view shows next. Cleared as the next case is sent.
  const [createdNote, setCreatedNote] = useState<{ facilityId: string; text: string } | null>(null)
  const clearCreatedNote = useCallback(() => setCreatedNote(null), [])
  const refreshCases = cases.refresh
  const onCreated = useCallback((created: OutreachCase) => {
    if (facilityId) setCreatedNote({ facilityId, text: createdText(created) })
    void refreshCases()
    // Open the case made, as the design opens a saved record. The form keeps the user on it until the answer comes.
    if (viewRef.current.kind === 'new' && created?.id) show({ kind: 'case', id: created.id, snapshot: created, created: true })
  }, [facilityId, refreshCases, show])

  // At an outreach group, a registration that could not be sent waits on this device and is sent again (offlineQueue.ts).
  // A campaign's Today keeps its own (day/), with its station writes.
  const queue = useOutreachQueue(group ? actorId : undefined, facilityId ?? '', useCallback((created: OutreachCase) => {
    if (facilityId) setCreatedNote({ facilityId, text: `${createdText(created)} It was sent from this device.` })
    void refreshCases()
  }, [facilityId, refreshCases]))
  const [queuedNote, setQueuedNote] = useState<{ facilityId: string; text: string } | null>(null)
  const groupForm: OutreachGroupForm | undefined = group && facility ? {
    name: facility.name,
    queue: entry => queue.add(entry),
    onQueued: fullName => {
      if (facilityId) setQueuedNote({ facilityId, text: `No connection: ${fullName}’s registration is saved on this device. It is sent when you are back online.` })
      show({ kind: 'list' })
    },
  } : undefined

  if (!facilityId) {
    return (
      <DeptPage title="Outreach">
        <ErrorBox message={NO_FACILITY} />
      </DeptPage>
    )
  }
  if (!canReadCases && !canReadCampaigns) return <OutreachRefusal />

  const listedIds = new Set((campaigns.value ?? []).map(campaign => campaign.id))
  // The campaign open now is read too when the list doesn't hold it yet (just made by the plan wizard).
  const openId = view.kind === 'campaign' || view.kind === 'record' ? view.id : view.kind === 'visit' || view.kind === 'report' ? view.campaign.id : undefined
  const summaryIds = canReadCampaigns ? [...listedIds, ...(openId && !listedIds.has(openId) ? [openId] : [])] : []
  const readers = canReadCampaigns ? <>
    {campaigns.value?.map(campaign => (
      <CampaignMembersRead key={campaign.id} facilityId={facilityId} membershipId={membershipId} campaign={campaign}
        onMembershipChange={recordMembership} onRead={recordMembers} />
    ))}
    {summaryIds.map(id => <CampaignSummaryRead key={`summary-${id}`} facilityId={facilityId} campaignId={id} epoch={summaryEpoch} onRead={recordSummary} />)}
  </> : null
  const membersOf = (campaignId: string) => {
    const read = members.get(campaignId)
    return read?.facilityId === facilityId ? read : undefined
  }
  const campaignOf = (campaignId: string | undefined) => campaignId ? campaigns.value?.find(campaign => campaign.id === campaignId) : undefined
  const mayWriteCampaigns = permissions.includes('outreach.campaign.write')
  // Today's Outreach (no campaign routes yet, as every campaign read says): campaigns are made with today's form.
  const known = (campaigns.value ?? []).map(campaign => summaryOf(campaign.id)?.offered)
  const legacyOutreach = known.includes(false) && !known.includes(true) && !known.includes(null)
  /** Registrations shown on the Outreach page itself: those outside any campaign whose own hub lists them. */
  const homeCases = (item: OutreachCase) => !canReadCampaigns || !item.campaignId || summaryOf(item.campaignId)?.offered !== true
  const refreshAll = () => Promise.all([canReadCases ? cases.refresh() : undefined, canReadCampaigns ? campaigns.refresh() : undefined])
    .then(() => setSummaryEpoch(epoch => epoch + 1))
  const openCampaign = (campaign: OutreachCampaign, tab?: CampaignTab, focusId?: string) =>
    show({ kind: 'campaign', id: campaign.id, snapshot: campaign, tab }, focusId)
  /** The campaign as listed, or as it was opened while the list is read again (or just made). */
  const currentCampaign = (id: string, snapshot: OutreachCampaign, created?: boolean) => {
    const listed = campaigns.value?.find(campaign => campaign.id === id)
    const settled = campaigns.value !== null && !campaigns.loading && !campaigns.error
    return listed ?? (!settled || created ? snapshot : null)
  }

  let content: ReactNode
  if (view.kind === 'new' && canWrite) {
    content = <OutreachNew facilityId={facilityId} showCampaign={canReadCampaigns} campaigns={caseCampaigns} attempt={caseAttempt}
      group={groupForm} onBack={() => backToList()} onSending={() => { clearCreatedNote(); setQueuedNote(null) }} onCreated={onCreated} />
  } else if (view.kind === 'case' && (canReadCases || view.created)) {
    const listed = cases.value?.find(item => item.id === view.id)
    // A record the list no longer holds is not shown from memory, unless the list cannot say (not read, being read,
    // or refused) or the create form has just made it.
    const settled = canReadCases && cases.value !== null && !cases.loading && !cases.error
    const item = listed ?? (view.created || !settled ? view.snapshot : null)
    content = item
      ? <OutreachCaseView key={item.id} facilityId={facilityId} item={item} campaign={campaignOf(item.campaignId)} canLink={canWrite && !group} group={group}
        created={view.created} listError={cases.error} onBack={() => backToList(`outreach-case-${item.id}-open`)}
        onNew={canWrite ? () => show({ kind: 'new' }) : undefined}
        onChanged={cases.refresh} onFocusHeading={focusHeadingIfLost} />
      : <RecordNotFound onBack={() => backToList()} />
  } else if (view.kind === 'newCampaign' && canManage && legacyOutreach) {
    content = <OutreachCampaignNew facilityId={facilityId} onBack={() => backToList('outreach-new-campaign')}
      onUnsure={() => void campaigns.refresh()}
      onCreated={created => {
        void campaigns.refresh()
        show({ kind: 'campaign', id: created.id, snapshot: created, created: true })
      }} />
  } else if (view.kind === 'newCampaign' && canManage) {
    content = <CampaignPlanWizard onCreated={() => void campaigns.refresh()} onUnsure={() => void campaigns.refresh()} onCancel={() => backToList('outreach-new-campaign')}
      onDone={campaignId => {
        void campaigns.refresh()
        setSummaryEpoch(epoch => epoch + 1)
        const made = campaignOf(campaignId) ?? { id: campaignId, name: 'New campaign', status: 'planned', services: ['registration'],
          startsAt: new Date().toISOString(), rowVersion: 0 }
        show({ kind: 'campaign', id: campaignId, snapshot: made, created: true, tab: 'team' })
      }} />
  } else if (view.kind === 'campaign' && canReadCampaigns) {
    const campaign = currentCampaign(view.id, view.snapshot, view.created)
    const summary = summaryOf(view.id)
    if (!campaign) {
      content = <RecordNotFound onBack={() => backToList()} />
    } else if (summary?.offered === false || (!summary && legacyOutreach)) {
      // Today's Outreach: the campaign's own record, as before.
      content = <OutreachCampaignView key={campaign.id} facilityId={facilityId} campaign={campaign} members={membersOf(campaign.id)}
        manage={canManage} created={view.created} onChanged={campaigns.refresh}
        onBack={() => backToList(`outreach-campaign-${campaign.id}-open`)} />
    } else {
      const roles = hubRoles(summary, mayWriteCampaigns)
      const here = { ...view, snapshot: campaign }
      content = <CampaignHub key={campaign.id} campaign={campaign} summary={summary} roles={roles} tab={view.tab}
        onTab={tab => setPlace({ facilityId, view: { ...here, tab } })}
        facilityId={facilityId} accountId={actorId} cases={canReadCases ? cases : null}
        onBack={() => backToList(`outreach-campaign-${campaign.id}-open`)}
        onOpenVisit={(visit: OutreachVisit) => show({ kind: 'visit', campaign, caseId: visit.id, tab: 'people' })}
        onRegistered={() => { void cases.refresh(); setSummaryEpoch(epoch => epoch + 1) }}
        onReport={canReadReport(roles) ? () => show({ kind: 'report', campaign, tab: view.tab }) : undefined}
        onRecord={canManage ? () => show({ kind: 'record', id: campaign.id, snapshot: campaign, tab: view.tab }) : undefined} />
    }
  } else if (view.kind === 'record' && canReadCampaigns) {
    const campaign = currentCampaign(view.id, view.snapshot)
    content = campaign
      ? <OutreachCampaignView key={campaign.id} facilityId={facilityId} campaign={campaign} members={membersOf(campaign.id)}
        manage={canManage} onChanged={async () => { await campaigns.refresh(); setSummaryEpoch(epoch => epoch + 1) }}
        onBack={() => openCampaign(campaign, view.tab, `outreach-campaign-${campaign.id}-record`)} />
      : <RecordNotFound onBack={() => backToList()} />
  } else if (view.kind === 'visit' && canReadCampaigns) {
    content = <VisitView key={view.caseId} campaignId={view.campaign.id} caseId={view.caseId}
      onBack={() => { void cases.refresh(); openCampaign(view.campaign, view.tab, `outreach-visit-${view.caseId}-open`) }} />
  } else if (view.kind === 'report' && canReadCampaigns) {
    const campaign = campaignOf(view.campaign.id) ?? view.campaign
    const roles = hubRoles(summaryOf(campaign.id), mayWriteCampaigns)
    content = (
      <DeptPage title="Campaign report" description={campaign.name} backLabel="Back to the campaign"
        onBack={() => openCampaign(campaign, view.tab, `outreach-campaign-${campaign.id}-report`)}>
        <CampaignReport campaignId={campaign.id} campaign={campaign} canClose={roles.includes('coordinator')}
          onClosed={() => { void campaigns.refresh(); setSummaryEpoch(epoch => epoch + 1) }} />
      </DeptPage>
    )
  } else {
    content = (
      <OutreachList canReadCases={canReadCases} canReadCampaigns={canReadCampaigns} canWrite={canWrite} cases={cases} campaigns={campaigns}
        group={group} campaignOf={campaignOf} onNew={() => show({ kind: 'new' })} showCase={homeCases}
        summaryOf={summaryOf} onRefresh={refreshAll}
        top={group ? <>
          <OutreachGroupBanner status={organiserStatus} />
          {queuedNote?.facilityId === facilityId ? <Alert intent="warning" title="Saved on this device">{queuedNote.text}</Alert> : null}
          <OutreachQueuePanel entries={queue.entries} durable={queue.durable} syncing={queue.syncing} onSync={() => void queue.sync()}
            onDiscard={id => void queue.discard(id)} />
        </> : undefined}
        bottom={organiser ? <OutreachTeam facilityId={facilityId} /> : undefined}
        onNewCampaign={canManage ? () => show({ kind: 'newCampaign' }) : undefined}
        onOpenCase={item => show({ kind: 'case', id: item.id, snapshot: item, created: false })}
        onOpenCampaign={campaign => show({ kind: 'campaign', id: campaign.id, snapshot: campaign })} />
    )
  }

  return (
    <div ref={root}>
      {readers}
      {content}
      {/* Mounted throughout, so what was created is announced; the created case's view shows it as a banner. */}
      <div id="outreach-status" role="status" className="hid-ehr-sr-only">
        {createdNote?.facilityId === facilityId ? createdNote.text : null}
      </div>
    </div>
  )
}

/** The design's view of a record the list no longer holds. */
function RecordNotFound({ onBack }: { readonly onBack: () => void }) {
  return (
    <DeptPage title="Record not found" onBack={onBack}>
      <p className="hid-ehr-dept-muted">The record is missing or outside your authorized hospital / branch.</p>
    </DeptPage>
  )
}

interface ListRead<T> {
  readonly value: T[] | null
  readonly loading: boolean
  readonly error: string
  readonly refresh: () => Promise<void>
}

type CaseTab = 'waiting' | 'done' | 'all'

/**
 * The Outreach page itself: the campaigns as cards (with "New campaign" as the one main action where campaigns are
 * managed here), and the registrations that no campaign hub lists (all of them on today's Outreach) as cards, filtered by
 * what still needs doing, with search and pages. A group's standing and what waits on this device come first.
 */
function OutreachList({ canReadCases, canReadCampaigns, canWrite, cases, campaigns, group, top, bottom, campaignOf, showCase, summaryOf, onRefresh, onNew,
  onNewCampaign, onOpenCase, onOpenCampaign }: {
  readonly canReadCases: boolean
  /** An outreach group's own Outreach (open sign-up on outreach.): nobody here links a Health ID. */
  readonly group: boolean
  /** Shown above the lists: an outreach group's standing with Health ID, and what waits on this device. */
  readonly top?: ReactNode
  /** Shown below the lists: an outreach group's team, for its organiser. */
  readonly bottom?: ReactNode
  readonly canReadCampaigns: boolean
  readonly canWrite: boolean
  readonly cases: ListRead<OutreachCase>
  readonly campaigns: ListRead<OutreachCampaign>
  readonly campaignOf: (campaignId: string | undefined) => OutreachCampaign | undefined
  /** Whether a registration is listed here (not in a campaign hub's People). */
  readonly showCase: (item: OutreachCase) => boolean
  readonly summaryOf: (campaignId: string) => CampaignSummary | undefined
  readonly onRefresh: () => Promise<unknown>
  readonly onNew: () => void
  /** Opens "New campaign", where Outreach serves campaign management to this membership. */
  readonly onNewCampaign?: () => void
  readonly onOpenCase: (item: OutreachCase) => void
  readonly onOpenCampaign: (campaign: OutreachCampaign) => void
}) {
  const [tab, setTab] = useState<CaseTab>('waiting')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const focus = useFocusById()
  const loading = (canReadCases && cases.loading) || (canReadCampaigns && campaigns.loading) || refreshing
  const refresh = () => {
    setRefreshing(true)
    void onRefresh().finally(() => setRefreshing(false))
  }

  // Newest first: the person just met is the one most likely to be looked for.
  const everyCase = [...(cases.value ?? [])].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
  const all = everyCase.filter(showCase)
  // Every registration is in a campaign's own People: no list of them here.
  const showCases = canReadCases && !(cases.value && everyCase.length > 0 && all.length === 0)
  const waiting = all.filter(caseWaiting)
  const inTab = (item: OutreachCase) => tab === 'all' || (tab === 'waiting') === caseWaiting(item)
  const rows = all.filter(item => inTab(item) && matchesSearch(search, caseSearchText(item)))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, pages - 1)
  const first = shownPage === 0
  const last = shownPage + 1 >= pages
  const listed = cases.value !== null
  // One main action: New campaign where campaigns are managed here, else New registration.
  const newButton = canWrite ? <Button variant={onNewCampaign ? 'secondary' : 'primary'} icon={UserPlus} onClick={onNew}>New registration</Button> : null
  const newCampaign = onNewCampaign ? <Button id="outreach-new-campaign" variant="primary" icon={Plus} onClick={onNewCampaign}>New campaign</Button> : null
  const canLink = canWrite && !group
  const emptyAll = { icon: Users, title: 'No registrations yet', description: canWrite
    ? 'People you register in the field show here, with what each needs next.' : 'People registered in the field show here.', action: newButton ?? undefined }
  const empty = all.length === 0 ? emptyAll : rows.length > 0 ? null : search
    ? { icon: Search, title: 'No matching registrations', description: 'Check the spelling, or search by another name.' }
    : tab === 'waiting' ? { icon: CircleCheck, title: 'No one is waiting to be linked', description: 'Every registration here is linked to a Health ID.' }
      : { icon: Users, title: 'None linked yet', description: 'Registrations move here once they are linked to a Health ID.' }
  const registeredIn = (campaignId: string) => cases.value ? cases.value.filter(item => item.campaignId === campaignId).length : undefined

  return (
    <DeptPage title="Outreach" description={canReadCampaigns ? 'Your campaigns, and the people registered in the field.' : 'People registered in the field, and what each one needs next.'}
      primaryAction={newCampaign ?? undefined}
      secondaryActions={<>
        <Button icon={RotateCcw} aria-busy={loading || undefined} onClick={() => { if (!loading) refresh() }}>Refresh</Button>
        {/* Always here, so it stays one button as the page learns whether campaigns are managed here; the main one without them. */}
        {newButton}
      </>}>
      <div className="flex flex-col gap-6">
        {top}
        {canReadCampaigns ? (
          <section aria-labelledby="outreach-campaigns-heading" className="flex flex-col gap-3">
            <h2 id="outreach-campaigns-heading" className="m-0 text-title-2 text-ink">Campaigns</h2>
            {campaigns.error && campaigns.value ? <Alert intent="error" title="Couldn’t refresh campaigns">{campaigns.error}</Alert> : null}
            <PageState loading={campaigns.loading} error={campaigns.value ? null : campaigns.error || null} hasData={campaigns.value !== null}
              onRetry={() => void campaigns.refresh()} what="campaigns" rows={2}
              empty={campaigns.value?.length === 0 ? group && onNewCampaign
                ? { icon: Megaphone, title: 'Create your first campaign', description: 'A campaign is one outreach event or drive: '
                  + 'what it screens for, where, and who helps. You become its coordinator, and everyone you register gets their own Health ID record.',
                action: <Button variant="primary" icon={Plus} onClick={onNewCampaign}>Create your first campaign</Button> }
                : { icon: Megaphone, title: 'No campaigns yet', description: onNewCampaign
                  ? 'Create a campaign to plan outreach work. You become its coordinator.' : 'Campaigns this facility runs show here.' } : null}>
              <CampaignCards campaigns={campaigns.value ?? []} summaryOf={summaryOf} registeredIn={registeredIn} onOpen={onOpenCampaign} />
            </PageState>
          </section>
        ) : null}
        {showCases ? (
          <section aria-labelledby="outreach-cases-heading" className="flex flex-col gap-3">
            <h2 id="outreach-cases-heading" className="m-0 text-title-2 text-ink">Registrations</h2>
            <div className="flex flex-col gap-3 @xl:flex-row @xl:flex-wrap @xl:items-center @xl:justify-between">
              <FilterTabs label="Show registrations" value={tab} onChange={value => { setTab(value); setPage(0) }} options={[
                { value: 'waiting', label: 'Waiting to link', count: waiting.length },
                { value: 'done', label: 'Linked', count: all.length - waiting.length },
                { value: 'all', label: 'All', count: all.length },
              ]} />
              <div className="flex min-w-0 items-center gap-2 @xl:w-80">
                <label htmlFor="outreach-search" className="sr-only">Search Outreach</label>
                <Input id="outreach-search" type="search" icon={Search} className="min-w-0 flex-1" value={search} autoComplete="off"
                  placeholder="Search by name" onChange={event => { setSearch(event.target.value); setPage(0) }} />
                {search ? <Button onClick={() => { setSearch(''); setPage(0); focus('outreach-search') }}>Clear search</Button> : null}
              </div>
            </div>
            {cases.error && listed ? <Alert intent="error" title="Couldn’t refresh registrations">{cases.error}</Alert> : null}
            <PageState loading={cases.loading} error={listed ? null : cases.error || null} hasData={listed} onRetry={() => void cases.refresh()}
              what="registrations" empty={empty}>
              <ul aria-label="Registrations" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
                {rows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE).map(item => (
                  <CaseCard key={item.id} item={item} campaign={campaignOf(item.campaignId)} canLink={canLink} group={group} onOpen={() => onOpenCase(item)} />
                ))}
              </ul>
              {rows.length > PAGE_SIZE ? (
                <nav className="hid-ehr-dept-outreach-pages" aria-label="Registration case pages">
                  {/* Unavailable at the first and last page, not disabled: a disabled button would lose the focus it has. */}
                  <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={first || undefined}
                    onClick={() => { if (!first) setPage(shownPage - 1) }}>Previous page</Button>
                  <span>Page {shownPage + 1} of {pages}</span>
                  <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={last || undefined}
                    onClick={() => { if (!last) setPage(shownPage + 1) }}>Next page</Button>
                </nav>
              ) : null}
            </PageState>
          </section>
        ) : null}
        {bottom}
      </div>
    </DeptPage>
  )
}

/** One registration as a card: who (large), age and sex, its status in words, and its next step. One button opens it. */
function CaseCard({ item, campaign, canLink, group, onOpen }: {
  readonly item: OutreachCase
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
  readonly group: boolean
  readonly onOpen: () => void
}) {
  const waiting = caseWaiting(item)
  return (
    <li className="flex min-w-0 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
      <button type="button" id={`outreach-case-${item.id}-open`} onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-4 text-left text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:p-5">
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 flex-[1_1_10rem] text-[18px] font-semibold leading-tight break-words">{caseName(item)}</span>
          <Badge size="sm" tone={caseTone(item.status)}>{statusLabel(item.status)}</Badge>
        </span>
        <span className="text-[14px] text-ink-2">{ageText(item)} · {sexText(item)}{campaign ? ` · ${campaign.name}` : ''}</span>
        <span className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[13px]">
          <span className={waiting ? 'inline-flex items-center gap-1 font-medium text-brand-ink' : 'text-ink-3'}>
            {nextStepText(item, canLink, group)}{waiting && canLink ? <ArrowRight className="size-3.5" aria-hidden /> : null}
          </span>
          <span className="text-ink-3 tabular">Registered {dateText(item.createdAt)}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * What Outreach says to a membership with neither campaign nor registration read, as the classic page does
 * (staff/routes/Operations.tsx Outreach); the frame shows it at the address. Screens name no permission (the owner's
 * rule), and no role holds Outreach on hid-system main (migration 0091), so like Document OCR it says to everyone that
 * it isn't available yet, asking nobody (NO_OUTREACH, the owner's answer of 2 November).
 */
export function OutreachRefusal() {
  return <DeptUnavailable title="Outreach unavailable" message={NO_OUTREACH} />
}
