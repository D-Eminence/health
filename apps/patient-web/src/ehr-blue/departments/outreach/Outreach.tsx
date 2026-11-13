import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { ArrowRight, CircleCheck, ClipboardList, LayoutGrid, Megaphone, Play, Plus, UserPlus, Users } from 'lucide-react'
import { LoadingRows, PageState } from '../../../kasuwa/parts'
import { Badge, Button, FilterTabs } from '../../../kasuwa/ui'
import { EnsureToastProvider, useToast } from '../../../kasuwa/toast'
import { staffApi, type OutreachCampaign, type OutreachCase, type OutreachOrganiserStatus } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { focusLost } from '../../../pageFocus'
import { NO_OUTREACH } from '../../../staff/refusedWork'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { dateText, matchesSearch } from '../parts/format'
import { useErrorToast } from './notify'
import { useFacilityRead } from '../parts/useFacilityRead'
import { OutreachCampaignNew } from './OutreachCampaignNew'
import { CampaignMembersRead, OutreachCampaignView } from './OutreachCampaignView'
import { OutreachCaseView } from './OutreachCaseView'
import { OutreachNew, type CaseAttempt, type OutreachGroupForm } from './OutreachNew'
import { isOrganiser, isOutreachGroup, OutreachGroupBanner, OutreachQueuePanel, OutreachTeam } from './outreachGroup'
import { lastOpenedCampaign, outreachQueueStore, rememberOpenedCampaign, useOutreachQueue } from './offlineQueue'
import {
  isOutreachAddress, OUTREACH_HOME, setOutreachNav, setOutreachSearch, tabAddress, tabOfAddress, type OutreachNavState, type OutreachSearchHit,
} from './outreachNav'
import {
  ageText, campaignOpenNow, CAMPAIGNS_NOT_LOADED, caseName, caseTone, CASES_NOT_LOADED, caseSearchText, caseWaiting, createdText, ErrorBox,
  NO_FACILITY, nextStepText, sexText, statusLabel, type MembersRead,
} from './outreachParts'
import { type OutreachVisit, type TeamRole } from './campaignTypes'
import { VisitView } from './day'
import { CampaignPlanWizard } from './plan'
import { CampaignCards } from './insight/CampaignCards'
import { CampaignHub } from './insight/CampaignHub'
import { campaignDatesText, canReadReport, hubRoles, hubTabs, shownTab, type CampaignTab } from './insight/tabs'
import { CampaignReport } from './insight/CampaignReport'
import { CampaignSummaryRead, type CampaignSummary } from './insight/campaignSummary'
import { useLiveRefresh } from './insight/insightParts'
import { visitMatches } from './insight/CampaignPeople'
import { campaignOrder, OrganisationHome, shortName } from './insight/OrganisationHome'
import { useOrganisationNumbers, workOutSummary } from './insight/organisationSummary'
import type { MoreItem } from './insight/MoreMenu'
import { campaignStatusLabel } from './outreachParts'

/** A list shows this many records a page: a screen or two, never a long page. */
const PAGE_SIZE = 25

/**
 * Where the page is: its lists, the create form, or one record. In memory only: nothing about
 * a record goes in the address or the history. `snapshot` is the record as it was opened, shown
 * while the list is read again; `created` marks a case the create form has just made.
 */
type View =
  | { kind: 'list'; focus?: string }
  /** Every campaign (the home shows six), the organisation's team, and the registrations made before campaigns. */
  | { kind: 'campaigns' }
  | { kind: 'team' }
  | { kind: 'registrations' }
  | { kind: 'new' }
  | { kind: 'case'; id: string; snapshot: OutreachCase; created: boolean; from?: 'registrations' }
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
  // What happens after an action is said in a toast at the top of the screen. The app provides the one toast stack;
  // this adds one only where Outreach is rendered on its own.
  return <EnsureToastProvider><OutreachPage /></EnsureToastProvider>
}

function OutreachPage() {
  const { facility, facilityId, membershipId, permissions, actorId } = useDeptAccess()
  const toast = useToast()
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
  const location = useLocation()
  // The tab last shown in each campaign, for this visit: coming back to a campaign opens where the person was.
  const lastTabs = useRef(new Map<string, CampaignTab>())
  // The campaign this person was last in, from the day settings on this device (per account): undefined while read.
  const [lastCampaign, setLastCampaign] = useState<{ facilityId: string; id: string | null } | undefined>(undefined)
  const readsCampaigns = permissions.includes('outreach.campaign.read')
  useEffect(() => {
    if (!facilityId) return
    if (!actorId || !readsCampaigns) { setLastCampaign({ facilityId, id: null }); return }
    let live = true
    void outreachQueueStore().then(store => lastOpenedCampaign(store, { accountId: actorId, facilityId }))
      .catch(() => null).then(id => { if (live) setLastCampaign({ facilityId, id }) })
    return () => { live = false }
  }, [actorId, facilityId, readsCampaigns])
  // Whether the page has decided where this visit starts (a campaign opened directly, or the list), per facility.
  const [arrived, setArrived] = useState<string | null>(null)

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
  const groupForm: OutreachGroupForm | undefined = group && facility ? {
    name: facility.name,
    queue: entry => queue.add(entry),
    onQueued: fullName => {
      toast.warning({ title: 'Saved on this device', message: `No connection: ${fullName}’s registration is saved on this device. It is sent when you are back online.` })
      show({ kind: 'list' })
    },
  } : undefined

  // The organisation's numbers for the home: served, else worked out from the campaigns' own reads once they are in.
  const listedForNumbers = campaigns.value ?? []
  const numbersSettled = campaigns.value !== null && !campaigns.loading && listedForNumbers.every(campaign => summaryOf(campaign.id))
  const numbers = useOrganisationNumbers(facilityId, canReadCampaigns && place.view.kind === 'list',
    () => workOutSummary(listedForNumbers, summaryOf, canReadCases ? cases.value : null), numbersSettled || (campaigns.value === null && !campaigns.loading))
  const organisationName = listedForNumbers.map(campaign => summaryOf(campaign.id)?.plan?.organisationName).find(Boolean) ?? facility?.name

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
  const registeredIn = (campaignId: string) => cases.value ? cases.value.filter(item => item.campaignId === campaignId).length : undefined
  const campaignOf = (campaignId: string | undefined) => campaignId ? campaigns.value?.find(campaign => campaign.id === campaignId) : undefined
  const mayWriteCampaigns = permissions.includes('outreach.campaign.write')
  // Today's Outreach (no campaign routes yet, as every campaign read says): campaigns are made with today's form.
  const known = (campaigns.value ?? []).map(campaign => summaryOf(campaign.id)?.offered)
  const legacyOutreach = known.includes(false) && !known.includes(true) && !known.includes(null)
  /** The home is today's list of registrations (no campaign routes, or no campaigns read), not the organisation's numbers. */
  const legacyHome = !canReadCampaigns || legacyOutreach
  const campaignsKnown = campaigns.value !== null && !campaigns.loading && campaigns.value.every(campaign => summaryOf(campaign.id) !== undefined)
  /** Registrations shown on the Outreach page itself: those outside any campaign whose own hub lists them. */
  const homeCases = (item: OutreachCase) => !canReadCampaigns || !item.campaignId || summaryOf(item.campaignId)?.offered !== true
  const refreshAll = () => Promise.all([canReadCases ? cases.refresh() : undefined, canReadCampaigns ? campaigns.refresh() : undefined])
    .then(() => setSummaryEpoch(epoch => epoch + 1))
  const openCampaign = (campaign: OutreachCampaign, tab?: CampaignTab, focusId?: string) =>
    show({ kind: 'campaign', id: campaign.id, snapshot: campaign, tab: tab ?? lastTabs.current.get(campaign.id) }, focusId)
  /** The campaign as listed, or as it was opened while the list is read again (or just made). */
  const currentCampaign = (id: string, snapshot: OutreachCampaign, created?: boolean) => {
    const listed = campaigns.value?.find(campaign => campaign.id === id)
    const settled = campaigns.value !== null && !campaigns.loading && !campaigns.error
    return listed ?? (!settled || created ? snapshot : null)
  }

  // ------------------------------------------------------------------------------------------- where it starts --
  /** The hub's tabs for a campaign, as this person's roles there allow. */
  const tabsOf = (campaignId: string) => hubTabs(hubRoles(summaryOf(campaignId), mayWriteCampaigns), canReadCases)
  const served = (campaignId: string) => summaryOf(campaignId)?.offered === true
  // The campaign the menu and its tabs are about: the one open now, else the one this person was last in.
  const viewCampaignId = view.kind === 'campaign' || view.kind === 'record' ? view.id : view.kind === 'visit' || view.kind === 'report' ? view.campaign.id : undefined
  const rememberedId = lastCampaign?.facilityId === facilityId ? lastCampaign.id : null
  const navCampaign = (viewCampaignId ? campaignOf(viewCampaignId) ?? (view.kind === 'campaign' || view.kind === 'record' ? view.snapshot : undefined) : undefined)
    ?? (rememberedId ? campaignOf(rememberedId) : undefined)
  const navTabs = navCampaign && served(navCampaign.id) ? tabsOf(navCampaign.id) : null
  /** The address that says where the page is: its list, or a campaign hub's tab. Null where the address stays as it is. */
  const hubTab = view.kind === 'campaign' && served(view.id) ? shownTab(tabsOf(view.id), view.tab ?? lastTabs.current.get(view.id)) : undefined
  const address = view.kind === 'list' ? OUTREACH_HOME : hubTab ? tabAddress(hubTab) : null
  // The campaigns running now that this person is on (owner, 13 Nov 2026: no reselecting): on its team, or a member.
  const running = (campaigns.value ?? []).filter(campaign => campaign.status === 'active' && campaignOpenNow(campaign))
  const mine = running.filter(campaign => served(campaign.id)
    && (summaryOf(campaign.id)?.team?.you != null || (eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id))))
  const continuing = mine.find(campaign => campaign.id === rememberedId) ?? mine[0]
  // The organisation's owner, admins and coordinators start on its numbers (owner, 13 Nov 2026); someone who only works
  // in the field goes straight to their campaign.
  // Their roles on the campaigns' teams decide; on none (or none read yet), whether they may write campaigns here.
  const teamRoles = (campaigns.value ?? []).map(campaign => summaryOf(campaign.id)?.team?.you?.roles).filter((roles): roles is readonly TeamRole[] => Boolean(roles?.length))
  const manager = teamRoles.length ? teamRoles.some(roles => roles.includes('coordinator')) : mayWriteCampaigns
  // Where this visit starts: the one campaign running for them, else the one they were last in, else the list. Undefined
  // while that can't be told yet (the campaigns, what each one's routes say, or the day settings still being read).
  let arrival: OutreachCampaign | 'list' | undefined
  if (arrived === facilityId) arrival = undefined
  else if (view.kind !== 'list' || !canReadCampaigns || (campaigns.value === null && !campaigns.loading)) arrival = 'list'
  else if (campaigns.value === null || lastCampaign?.facilityId !== facilityId) arrival = undefined
  else if (running.some(campaign => !summaryOf(campaign.id)) || (rememberedId && campaignOf(rememberedId) && !summaryOf(rememberedId))) arrival = undefined
  else if (manager && !legacyOutreach && !tabOfAddress(location.pathname)) arrival = 'list'
  else if (mine.length === 1) arrival = mine[0]
  // Someone who only works in the field goes to the campaign they were last in (else the first running for them).
  else if (!manager && continuing) arrival = continuing
  else {
    const remembered = rememberedId ? campaignOf(rememberedId) : undefined
    arrival = remembered && served(remembered.id) ? remembered : 'list'
  }
  const arrive = (pick: OutreachCampaign | 'list') => {
    setArrived(facilityId)
    if (pick === 'list') return
    const tab = tabOfAddress(location.pathname) ?? lastTabs.current.get(pick.id)
    setPlace({ facilityId, view: { kind: 'campaign', id: pick.id, snapshot: pick, tab } })
    setFocusRequest({ ifLost: true })
  }
  /** An address the person followed (the menu's Campaigns or a tab): the page goes there, when it isn't there already. */
  const followAddress = (tab: CampaignTab | null) => {
    if (tab === null) {
      if (view.kind !== 'list') backToList()
      return
    }
    if (view.kind === 'campaign' && hubTab === tab) return
    if (navCampaign && navTabs?.includes(tab)) {
      lastTabs.current.set(navCampaign.id, tab)
      show({ kind: 'campaign', id: navCampaign.id, snapshot: navCampaign, tab })
    }
  }
  const openedId = view.kind === 'campaign' && served(view.id) ? view.id : undefined
  // The top bar's Search (one search, owner 13 Nov 2026): people in the campaign open or remembered and registrations
  // outside any campaign, by name, phone or visit code; campaigns by name.
  const search = (query: string): OutreachSearchHit[] => {
    const words = query.trim()
    if (words.length < 2) return []
    const inOpenCampaign = (item: OutreachCase) => Boolean(navCampaign && item.campaignId === navCampaign.id && served(navCampaign.id))
    // A campaign's people by name, phone or visit code; a registration outside any campaign by what its card shows
    // (never by its phone, which its card doesn't show).
    const people = canReadCases ? (cases.value ?? []).filter(item => inOpenCampaign(item) ? visitMatches(item as OutreachVisit, words)
      : homeCases(item) && matchesSearch(words, caseSearchText(item)))
      .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)).slice(0, 6)
      .map(item => {
        const visit = item as OutreachVisit
        const inHub = inOpenCampaign(item)
        return { id: `person-${item.id}`, kind: 'person' as const, title: caseName(item),
          detail: [ageText(item), sexText(item), visit.visitCode ? `visit code ${visit.visitCode}` : null].filter(Boolean).join(' · '),
          open: () => inHub && navCampaign ? show({ kind: 'visit', campaign: navCampaign, caseId: item.id, tab: 'people' })
            : show({ kind: 'case', id: item.id, snapshot: item, created: false, ...(legacyHome ? {} : { from: 'registrations' as const }) }) }
      }) : []
    const named = canReadCampaigns ? (campaigns.value ?? []).filter(campaign => matchesSearch(words, [campaign.name])).slice(0, 4)
      .map(campaign => ({ id: `campaign-${campaign.id}`, kind: 'campaign' as const, title: campaign.name,
        detail: `${campaignStatusLabel(campaign.status)} · ${campaignDatesText(campaign)}`, open: () => openCampaign(campaign) })) : []
    return [...people, ...named]
  }
  const keeper = (
    <PlaceKeeper ready={arrived === facilityId} arrival={arrival} onArrive={arrive} address={address} onAddress={followAddress}
      nav={navCampaign && navTabs ? { facilityId, campaignName: navCampaign.name, tabs: navTabs } : null}
      search={search} facilityId={facilityId}
      openedId={openedId} onOpened={campaignId => {
        if (!actorId) return
        setLastCampaign({ facilityId, id: campaignId })
        void outreachQueueStore().then(store => rememberOpenedCampaign(store, { accountId: actorId, facilityId }, campaignId)).catch(() => undefined)
      }} />
  )

  let content: ReactNode
  if (view.kind === 'new' && canWrite) {
    content = <OutreachNew facilityId={facilityId} showCampaign={canReadCampaigns} campaigns={caseCampaigns} attempt={caseAttempt}
      group={groupForm} onBack={() => backToList()} onSending={clearCreatedNote} onCreated={onCreated} />
  } else if (view.kind === 'case' && (canReadCases || view.created)) {
    const listed = cases.value?.find(item => item.id === view.id)
    // A record the list no longer holds is not shown from memory, unless the list cannot say (not read, being read,
    // or refused) or the create form has just made it.
    const settled = canReadCases && cases.value !== null && !cases.loading && !cases.error
    const item = listed ?? (view.created || !settled ? view.snapshot : null)
    content = item
      ? <OutreachCaseView key={item.id} facilityId={facilityId} item={item} campaign={campaignOf(item.campaignId)} canLink={canWrite && !group} group={group}
        created={view.created} listError={cases.error}
        onBack={() => view.from === 'registrations' ? show({ kind: 'registrations' }, `outreach-case-${item.id}-open`) : backToList(`outreach-case-${item.id}-open`)}
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
        // Inside the campaign made, on the first tab the person's roles have (Today, or the Dashboard): no reselecting.
        show({ kind: 'campaign', id: campaignId, snapshot: made, created: true })
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
      content = <CampaignHub key={campaign.id} campaign={campaign} summary={summary} roles={roles} tab={view.tab ?? lastTabs.current.get(campaign.id)}
        onTab={tab => { lastTabs.current.set(campaign.id, tab); setPlace({ facilityId, view: { ...here, tab } }) }}
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
        onBack={() => openCampaign(campaign, view.tab, `outreach-campaign-${campaign.id}-more`)} />
      : <RecordNotFound onBack={() => backToList()} />
  } else if (view.kind === 'visit' && canReadCampaigns) {
    content = <VisitView key={view.caseId} campaignId={view.campaign.id} caseId={view.caseId}
      onBack={() => { void cases.refresh(); openCampaign(view.campaign, view.tab, `outreach-visit-${view.caseId}-open`) }} />
  } else if (view.kind === 'report' && canReadCampaigns) {
    const campaign = campaignOf(view.campaign.id) ?? view.campaign
    const roles = hubRoles(summaryOf(campaign.id), mayWriteCampaigns)
    content = (
      <DeptPage title="Campaign report" description={campaign.name} backLabel="Back to the campaign"
        onBack={() => openCampaign(campaign, view.tab, `outreach-campaign-${campaign.id}-more`)}>
        <CampaignReport campaignId={campaign.id} campaign={campaign} canClose={roles.includes('coordinator')}
          onClosed={() => { void campaigns.refresh(); setSummaryEpoch(epoch => epoch + 1) }} />
      </DeptPage>
    )
  } else if (view.kind === 'campaigns' && canReadCampaigns) {
    content = (
      <DeptPage title="All campaigns" onBack={() => backToList('outreach-home-more')} backLabel="Back to Outreach">
        <PageState loading={campaigns.loading} error={campaigns.value ? null : campaigns.error || null} hasData={campaigns.value !== null}
          onRetry={() => void campaigns.refresh()} what="campaigns" rows={3}
          empty={campaigns.value?.length === 0 ? { icon: Megaphone, title: 'No campaigns yet', description: 'Campaigns your organisation runs show here.' } : null}>
          <PagedCampaigns campaigns={campaignOrder(campaigns.value ?? [])} summaryOf={summaryOf} registeredIn={registeredIn} onOpen={campaign => openCampaign(campaign)} />
        </PageState>
      </DeptPage>
    )
  } else if (view.kind === 'team' && organiser) {
    content = (
      <DeptPage title="Team" description={facility?.name} onBack={() => backToList('outreach-home-more')} backLabel="Back to Outreach">
        <OutreachTeam facilityId={facilityId} />
      </DeptPage>
    )
  } else if (view.kind === 'registrations' && canReadCases) {
    content = (
      <OutreachList canReadCases={canReadCases} canReadCampaigns={false} canWrite={canWrite} cases={cases} campaigns={campaigns}
        group={group} campaignOf={campaignOf} onNew={() => show({ kind: 'new' })} showCase={homeCases}
        summaryOf={summaryOf} onRefresh={refreshAll} legacy title="Registered before campaigns" onBack={() => backToList('outreach-home-more')}
        continuing={undefined} onContinue={() => undefined}
        onOpenCase={item => show({ kind: 'case', id: item.id, snapshot: item, created: false, from: 'registrations' })}
        onOpenCampaign={campaign => openCampaign(campaign)} />
    )
  } else if (canReadCampaigns && !campaignsKnown && (campaigns.value !== null || campaigns.loading)) {
    // Which home this is (the organisation's numbers, or today's list) is known once each campaign says what it serves.
    content = <DeptPage title="Outreach"><LoadingRows rows={3} label="Loading Outreach" /></DeptPage>
  } else if (!legacyHome) {
    const listedCampaigns = campaigns.value ?? []
    const registrationsBefore = canReadCases && (cases.value ?? []).some(homeCases)
    const menu: MoreItem[] = [
      ...(listedCampaigns.length ? [{ id: 'outreach-menu-campaigns', label: 'All campaigns', icon: LayoutGrid, onSelect: () => show({ kind: 'campaigns' }) }] : []),
      ...(organiser ? [{ id: 'outreach-menu-team', label: 'Team', icon: Users, onSelect: () => show({ kind: 'team' }) }] : []),
      ...(registrationsBefore ? [{ id: 'outreach-menu-registrations', label: 'Registered before campaigns', icon: ClipboardList, onSelect: () => show({ kind: 'registrations' }) }] : []),
    ]
    content = (
      <HomeRefresh onRefresh={refreshAll}>
        <OrganisationHome organisationName={organisationName} numbers={numbers} campaigns={listedCampaigns}
          campaignsRead={{ loading: campaigns.loading, error: campaigns.error, listed: campaigns.value !== null, retry: () => void campaigns.refresh() }}
          summaryOf={summaryOf} registeredIn={registeredIn} continuing={continuing} onContinue={campaign => openCampaign(campaign)}
          onNewCampaign={canManage ? () => show({ kind: 'newCampaign' }) : undefined} onOpenCampaign={campaign => openCampaign(campaign)}
          onAllCampaigns={() => show({ kind: 'campaigns' })} menu={menu}
          top={group ? <>
          <OutreachGroupBanner status={organiserStatus} />
          <OutreachQueuePanel entries={queue.entries} durable={queue.durable} syncing={queue.syncing} onSync={() => void queue.sync()}
            onDiscard={id => void queue.discard(id)} />
        </> : undefined} />
      </HomeRefresh>
    )
  } else {
    content = (
      <OutreachList canReadCases={canReadCases} canReadCampaigns={canReadCampaigns} canWrite={canWrite} cases={cases} campaigns={campaigns}
        group={group} campaignOf={campaignOf} onNew={() => show({ kind: 'new' })} showCase={homeCases}
        summaryOf={summaryOf} onRefresh={refreshAll} legacy
        continuing={continuing} onContinue={campaign => openCampaign(campaign)}
        top={group ? <>
          <OutreachGroupBanner status={organiserStatus} />
          <OutreachQueuePanel entries={queue.entries} durable={queue.durable} syncing={queue.syncing} onSync={() => void queue.sync()}
            onDiscard={id => void queue.discard(id)} />
        </> : undefined}
        bottom={organiser ? <OutreachTeam facilityId={facilityId} /> : undefined}
        onNewCampaign={canManage ? () => show({ kind: 'newCampaign' }) : undefined}
        onOpenCase={item => show({ kind: 'case', id: item.id, snapshot: item, created: false })}
        onOpenCampaign={campaign => openCampaign(campaign)} />
    )
  }

  return (
    <div ref={root}>
      {readers}
      {keeper}
      {content}
      {/* Mounted throughout, so what was created is announced; the created case's view shows it as a banner. */}
      <div id="outreach-status" role="status" className="hid-ehr-sr-only">
        {createdNote?.facilityId === facilityId ? createdNote.text : null}
      </div>
    </div>
  )
}

/**
 * Keeps where Outreach is in step with the frame (it draws nothing, as CampaignSummaryRead): it opens the campaign this
 * visit starts in (`arrival`), keeps the address on the list or the hub's tab (`address`), follows an address the menu
 * opened (`onAddress`), tells the menu the tabs of the campaign open or remembered (`nav`), and notes on this device the
 * campaign opened (`onOpened`). Only at Outreach's own addresses in the frame: elsewhere the address is left alone.
 */
function PlaceKeeper({ ready, arrival, onArrive, address, onAddress, nav, openedId, onOpened, search, facilityId }: {
  /** What the top bar's Search finds here (outreachNav.ts). */
  readonly search: (query: string) => OutreachSearchHit[]
  readonly facilityId: string
  readonly ready: boolean
  readonly arrival: OutreachCampaign | 'list' | undefined
  readonly onArrive: (pick: OutreachCampaign | 'list') => void
  readonly address: string | null
  readonly onAddress: (tab: CampaignTab | null) => void
  readonly nav: OutreachNavState | null
  readonly openedId: string | undefined
  readonly onOpened: (campaignId: string) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const inFrame = isOutreachAddress(location.pathname)
  const latest = useRef({ onArrive, onAddress, onOpened, search })
  latest.current = { onArrive, onAddress, onOpened, search }
  // Outreach is shown: the top bar's Search asks it, always with what the page knows now.
  useEffect(() => {
    const source = { facilityId, search: (query: string) => latest.current.search(query) }
    setOutreachSearch(source)
    return () => setOutreachSearch(null)
  }, [facilityId])

  useEffect(() => { if (!ready && arrival !== undefined) latest.current.onArrive(arrival) }, [ready, arrival])
  // The address says where the page is, replacing the one before (the history keeps no step per tab).
  useEffect(() => {
    if (ready && inFrame && address && address !== location.pathname) navigate(address, { replace: true })
  }, [ready, inFrame, address, location.pathname, navigate])
  // An address followed from the menu (a new history entry, even to the same address): the page goes there.
  const seen = useRef(location.key)
  useEffect(() => {
    if (seen.current === location.key) return
    seen.current = location.key
    if (ready && inFrame) latest.current.onAddress(tabOfAddress(location.pathname))
  }, [location.key, location.pathname, ready, inFrame])
  useEffect(() => { setOutreachNav(nav) })
  useEffect(() => () => setOutreachNav(null), [])
  useEffect(() => { if (openedId) latest.current.onOpened(openedId) }, [openedId])
  return null
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
  onNewCampaign, onOpenCase, onOpenCampaign, legacy, continuing, onContinue, title = 'Outreach', onBack }: {
  /** The page's title: Outreach, or "Registered before campaigns" when opened from the home's menu. */
  readonly title?: string
  readonly onBack?: () => void
  /** Today's Outreach, with no campaign routes (or no campaigns read): registrations are made here, with the old form. */
  readonly legacy: boolean
  /** The campaign running now that this person is on: carrying on with it is the one main action. */
  readonly continuing: OutreachCampaign | undefined
  readonly onContinue: (campaign: OutreachCampaign) => void
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
  const [page, setPage] = useState(0)
  // Read again when the page is shown again or gets focus (and every two minutes while shown): no Refresh button.
  const refreshing = useRef(false)
  useLiveRefresh(useCallback(() => {
    if (refreshing.current) return
    refreshing.current = true
    void onRefresh().finally(() => { refreshing.current = false })
  }, [onRefresh]), 120_000)

  // Newest first: the person just met is the one most likely to be looked for.
  const everyCase = [...(cases.value ?? [])].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
  const all = everyCase.filter(showCase)
  // Every registration is in a campaign's own People: no list of them here.
  const showCases = canReadCases && !(cases.value && everyCase.length > 0 && all.length === 0)
  const waiting = all.filter(caseWaiting)
  const inTab = (item: OutreachCase) => tab === 'all' || (tab === 'waiting') === caseWaiting(item)
  const rows = all.filter(inTab)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, pages - 1)
  const first = shownPage === 0
  const last = shownPage + 1 >= pages
  const listed = cases.value !== null
  // One main action (Hick, Fitts): carry on with the campaign running for this person; else New campaign where campaigns are
  // managed here; else, on today's Outreach only, New registration. A registration is otherwise made in a campaign's Today.
  const newButton = canWrite && legacy
    ? <Button variant={onNewCampaign || continuing ? 'secondary' : 'primary'} icon={UserPlus} onClick={onNew}>New registration</Button> : null
  const continueButton = continuing
    ? <Button id="outreach-continue" variant="primary" icon={Play} className="max-w-full" aria-label={`Continue ${continuing.name}`}
      onClick={() => onContinue(continuing)}><span className="truncate">Continue {shortName(continuing.name)}</span></Button> : null
  const newCampaign = onNewCampaign
    ? <Button id="outreach-new-campaign" variant={continuing ? 'secondary' : 'primary'} icon={Plus} onClick={onNewCampaign}>New campaign</Button> : null
  const canLink = canWrite && !group
  const emptyAll = { icon: Users, title: 'No registrations yet', description: canWrite
    ? 'People you register in the field show here, with what each needs next.' : 'People registered in the field show here.', action: newButton ?? undefined }
  const empty = all.length === 0 ? emptyAll : rows.length > 0 ? null
    : tab === 'waiting' ? { icon: CircleCheck, title: 'No one is waiting to be linked', description: 'Every registration here is linked to a Health ID.' }
      : { icon: Users, title: 'None linked yet', description: 'Registrations move here once they are linked to a Health ID.' }
  const registeredIn = (campaignId: string) => cases.value ? cases.value.filter(item => item.campaignId === campaignId).length : undefined
  useErrorToast(campaigns.error && campaigns.value ? campaigns.error : null, 'Couldn’t refresh campaigns', () => void campaigns.refresh())
  useErrorToast(cases.error && listed ? cases.error : null, 'Couldn’t refresh registrations', () => void cases.refresh())

  return (
    <DeptPage title={title} onBack={onBack} backLabel={onBack ? 'Back to Outreach' : undefined}
      description={onBack ? 'People registered before your campaigns, and what each one needs next.' : canReadCampaigns ? 'Your campaigns, and the people registered in the field.' : 'People registered in the field, and what each one needs next.'}
      primaryAction={continueButton ?? newCampaign ?? newButton ?? undefined}
      secondaryActions={continueButton ? newCampaign || newButton ? <>{newCampaign}{newButton}</> : undefined
        : newCampaign && newButton ? newButton : undefined}>
      <div className="flex flex-col gap-6">
        {top}
        {canReadCampaigns ? (
          <section aria-labelledby="outreach-campaigns-heading" className="flex flex-col gap-3">
            <h2 id="outreach-campaigns-heading" className="m-0 text-title-2 text-ink">Campaigns</h2>
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
            <h2 id="outreach-cases-heading" className={onBack ? 'sr-only' : 'm-0 text-title-2 text-ink'}>Registrations</h2>
            <FilterTabs label="Show registrations" value={tab} onChange={value => { setTab(value); setPage(0) }} options={[
              { value: 'waiting', label: 'Waiting to link', count: waiting.length },
              { value: 'done', label: 'Linked', count: all.length - waiting.length },
              { value: 'all', label: 'All', count: all.length },
            ]} />
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
                  <span aria-live="polite">Page {shownPage + 1} of {pages}</span>
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

/** Reads the home's lists again when the page is shown again or gets focus (and every two minutes while shown). */
function HomeRefresh({ onRefresh, children }: { readonly onRefresh: () => Promise<unknown>; readonly children: ReactNode }) {
  const refreshing = useRef(false)
  useLiveRefresh(useCallback(() => {
    if (refreshing.current) return
    refreshing.current = true
    void onRefresh().finally(() => { refreshing.current = false })
  }, [onRefresh]), 120_000)
  return <>{children}</>
}

/** All campaigns, running first, as cards in pages of 12. */
function PagedCampaigns({ campaigns, ...cards }: Omit<Parameters<typeof CampaignCards>[0], 'campaigns'> & { readonly campaigns: readonly OutreachCampaign[] }) {
  const [page, setPage] = useState(0)
  const size = 12
  const pages = Math.max(1, Math.ceil(campaigns.length / size))
  const shown = Math.min(page, pages - 1)
  return (
    <div className="flex flex-col gap-3">
      <CampaignCards {...cards} campaigns={campaigns.slice(shown * size, (shown + 1) * size)} />
      {pages > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-3" aria-label="Campaign pages">
          <Button aria-disabled={shown === 0 || undefined} onClick={() => { if (shown > 0) setPage(shown - 1) }}>Previous page</Button>
          <span className="text-[14px] text-ink-2" aria-live="polite">Page {shown + 1} of {pages}</span>
          <Button aria-disabled={shown + 1 >= pages || undefined} onClick={() => { if (shown + 1 < pages) setPage(shown + 1) }}>Next page</Button>
        </nav>
      ) : null}
    </div>
  )
}
