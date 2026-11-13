import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { ChevronRight, CircleCheck, Megaphone, Plus, Search, UserPlus, Users } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, FilterTabs, Input } from '../../../kasuwa/ui'
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
import { CaseCard, ShowMore, useOutreachCases, type CasesRead } from './OutreachCaseList'
import { GetHealthIdNow } from './GetHealthIdNow'
import { OutreachExport } from './OutreachExport'
import { OutreachNew, type CaseAttempt, type OutreachGroupForm } from './OutreachNew'
import { isOrganiser, isOutreachGroup, OutreachGroupBanner, OutreachQueuePanel, OutreachTeam, queuedText, queueSyncText } from './outreachGroup'
import { claimSend, noConnection, useOutreachQueue, type QueueSyncResult } from './offlineQueue'
import { outreachSnapshotOf, saveOutreachSnapshot } from './offlineStart'
import { noteOutreachRegistrations, outreachServed } from './outreachServed'
import { offlineShellHere } from '../../../productHostname'
import {
  campaignOpenNow, CAMPAIGNS_NOT_LOADED, campaignStatusLabel, caseSearchText, caseWaiting, createdText, ErrorBox,
  NO_FACILITY, servicesText, type CampaignsUnread, type MembersRead,
} from './outreachParts'

/** The design's list shows this many records a page. */
const PAGE_SIZE = 50

/** How often the campaigns open now are judged again while the page is open. */
const CAMPAIGN_CLOCK_MS = 60_000

/**
 * Renders the page again every minute, and as it is shown again, while `enabled`: whether a campaign is open now is
 * judged against the clock, so one that starts (or ends) while the page is open is offered (or withdrawn) in time.
 */
function useMinuteClock(enabled: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const tick = () => setTick(previous => previous + 1)
    const shown = () => { if (document.visibilityState === 'visible') tick() }
    const timer = window.setInterval(tick, CAMPAIGN_CLOCK_MS)
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [enabled])
}

/**
 * Where the page is: its lists, the create form, or one record. In memory only: nothing about
 * a record goes in the address or the history. `snapshot` is the record as it was opened, shown
 * while the list is read again; `created` marks a case the create form has just made.
 */
type View =
  | { kind: 'list'; focus?: string }
  | { kind: 'new' }
  | { kind: 'case'; id: string; snapshot: OutreachCase; created: boolean; from?: { kind: 'campaign'; id: string; snapshot: OutreachCampaign } }
  | { kind: 'campaign'; id: string; snapshot: OutreachCampaign; created?: boolean }
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
  const { lock, state } = useStaff()
  const displayName = state.status === 'ready' ? state.session.actor.displayName : undefined
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
  // The newest 100 first, as before paging; "Show more" adds older ones where Outreach pages the list (hid-system#247).
  const cases = useOutreachCases(facilityId, canReadCases)
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
  // Only active registration campaigns containing this facility membership, inside their start and end times, can take a
  // case: judged at each render, and at least every minute.
  useMinuteClock(canReadCampaigns)
  const runningCampaigns = (campaigns.value ?? []).filter(campaign => campaign.status === 'active'
    && campaign.services.includes('registration') && campaignOpenNow(campaign))
  const caseCampaigns = runningCampaigns.filter(campaign => eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id))

  // Outreach with no signal (offlineStart.ts), on Health ID Outreach's own site, at an outreach group: the confirmed
  // session's few facts, kept for a reload or a start with no signal, with the campaigns this volunteer is in.
  // What Outreach serves, as its registrations show it, remembered for the session (outreachServed.ts): the day's first
  // registration, and a list that can't be read, keep what was seen before.
  noteOutreachRegistrations(cases.value)
  const served = outreachServed()
  const healthChecksServed = served.healthChecks
  const memberCampaigns = (campaigns.value ?? []).filter(campaign => eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id))
  const offlineFacts = group && facility && facilityId && actorId && state.status === 'ready' && campaigns.value !== null && offlineShellHere(window.location.hostname)
    ? JSON.stringify({ actorId, displayName, facilityId, facilityName: facility.name, healthChecksServed, campaigns: memberCampaigns })
    : null
  useEffect(() => {
    if (!offlineFacts) return
    saveOutreachSnapshot(outreachSnapshotOf(JSON.parse(offlineFacts) as Parameters<typeof outreachSnapshotOf>[0]))
    // The "No signal" page and the build files this page loaded are kept by the offline app shell while there is signal.
    void import('./OfflineOutreach').then(() => import('../../../outreachShell')).then(shell => shell.keepLoadedAssets(), () => undefined)
  }, [offlineFacts])

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

  // At an outreach group, a registration that could not be sent waits on this device and is sent again (offlineQueue.ts).
  const queue = useOutreachQueue(group ? actorId : undefined, facilityId ?? '', useCallback((created: OutreachCase) => {
    noteOutreachRegistrations([created])
    if (facilityId) setCreatedNote({ facilityId, text: `${createdText(created)} It was sent from this device.` })
    void refreshCases()
  }, [facilityId, refreshCases]))
  const syncQueue = queue.sync

  const onCreated = useCallback((created: OutreachCase) => {
    noteOutreachRegistrations([created])
    if (facilityId) setCreatedNote({ facilityId, text: createdText(created) })
    void refreshCases()
    // Health ID just took a registration: what waits on this device is sent too, without waiting for an online event.
    void syncQueue()
    // Open the case made, as the design opens a saved record. The form keeps the user on it until the answer comes.
    if (viewRef.current.kind === 'new' && created?.id) show({ kind: 'case', id: created.id, snapshot: created, created: true })
  }, [facilityId, refreshCases, show, syncQueue])

  // The registration just kept on this device, and why: said until it is sent (or refused, which the queue then shows).
  const [queuedNote, setQueuedNote] = useState<{ facilityId: string; localCommandId: string; text: string; ageYears: number } | null>(null)
  const queuedShown = queuedNote !== null && queuedNote.facilityId === facilityId
    && queue.entries.some(entry => entry.localCommandId === queuedNote.localCommandId && entry.state === 'waiting')
  // What "Send now" did, until the next registration is sent. Anything but "all sent" goes once nothing is left on this device.
  const [sendNote, setSendNote] = useState<{ facilityId: string; result: QueueSyncResult } | null>(null)
  const sendDone = sendNote ? sendNote.result.waiting === 0 && sendNote.result.refused === 0 : false
  const sendShown = sendNote?.facilityId === facilityId && (sendDone || queue.entries.length > 0)
  // A registration the list already holds (Health ID took it, and its answer was lost or is still on its way) is shown
  // once, as the list's row: not under "Saved on this device" too, while the queue sends it again (answered the same).
  const listedTemporary = new Set((cases.value ?? []).map(item => item.temporaryPatientId).filter(Boolean))
  const queueShown = queue.entries.filter(entry => !listedTemporary.has(entry.temporaryPatientId))
  const sendNow = () => {
    void syncQueue().then(result => { if (result && facilityId) setSendNote({ facilityId, result }) })
  }
  const groupForm: OutreachGroupForm | undefined = group && facility ? {
    name: facility.name,
    queue: entry => queue.add(entry),
    dequeue: localCommandId => queue.discard(localCommandId),
    claim: claimSend,
    onQueued: ({ fullName, localCommandId, reason, ageYears }) => {
      if (facilityId) setQueuedNote({ facilityId, localCommandId, text: queuedText(fullName, reason), ageYears })
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

  const readers = canReadCampaigns ? campaigns.value?.map(campaign => (
    <CampaignMembersRead key={campaign.id} facilityId={facilityId} membershipId={membershipId} campaign={campaign}
      onMembershipChange={recordMembership} onRead={recordMembers} />
  )) : null
  const membersOf = (campaignId: string) => {
    const read = members.get(campaignId)
    return read?.facilityId === facilityId ? read : undefined
  }
  const campaignOf = (campaignId: string | undefined) => campaignId ? campaigns.value?.find(campaign => campaign.id === campaignId) : undefined
  // Why the form lists no campaign, when it may not be that the person is in none: the campaigns, or a running campaign's
  // members, are still being read, or couldn't be (opened with no signal, say).
  const unread = (read: { readonly error: string; readonly caught?: unknown }): CampaignsUnread => read.error ? (noConnection(read.caught) ? 'offline' : 'failed') : 'loading'
  const memberReads = runningCampaigns.map(campaign => membersOf(campaign.id))
  const failedMembers = memberReads.find(read => read?.items === null && read.error)
  const campaignsUnread: CampaignsUnread | undefined = !canReadCampaigns ? undefined
    : campaigns.value === null ? unread(campaigns)
      : failedMembers ? unread(failedMembers)
        : memberReads.some(read => !read || read.items === null) ? 'loading' : undefined

  let content: ReactNode
  if (view.kind === 'new' && canWrite) {
    content = <OutreachNew facilityId={facilityId} showCampaign={canReadCampaigns} campaigns={caseCampaigns} campaignsUnread={campaignsUnread}
      attempt={caseAttempt} group={groupForm} healthChecksServed={healthChecksServed}
      onBack={() => backToList()} onSending={() => { clearCreatedNote(); setQueuedNote(null); setSendNote(null) }} onCreated={onCreated} />
  } else if (view.kind === 'case' && (canReadCases || view.created)) {
    const listed = cases.value?.find(item => item.id === view.id)
    // A record the list no longer holds is not shown from memory, unless the list cannot say (not read, being read,
    // or refused; or older registrations are left unread, as when it was opened after "Show more"), or it was opened
    // from a campaign's page (read on its own), or the create form has just made it.
    const settled = canReadCases && cases.value !== null && !cases.loading && !cases.error && !cases.more.available
    const item = listed ?? (view.created || view.from || !settled ? view.snapshot : null)
    const from = view.from
    const back = from ? () => show({ kind: 'campaign', id: from.id, snapshot: from.snapshot }, `outreach-case-${view.id}-open`)
      : () => backToList(`outreach-case-${view.id}-open`)
    content = item
      ? <OutreachCaseView key={item.id} facilityId={facilityId} item={item} campaign={campaignOf(item.campaignId)} canLink={canWrite && !group} canWrite={canWrite} group={group}
        created={view.created} listError={cases.error} onBack={back}
        onNew={canWrite ? () => show({ kind: 'new' }) : undefined}
        onChanged={cases.refresh} onFocusHeading={focusHeadingIfLost} />
      : <RecordNotFound onBack={back} />
  } else if (view.kind === 'newCampaign' && canManage) {
    content = <OutreachCampaignNew facilityId={facilityId} onBack={() => backToList('outreach-new-campaign')}
      onUnsure={() => void campaigns.refresh()}
      onCreated={created => {
        void campaigns.refresh()
        show({ kind: 'campaign', id: created.id, snapshot: created, created: true })
      }} />
  } else if (view.kind === 'campaign' && canReadCampaigns) {
    const listed = campaigns.value?.find(campaign => campaign.id === view.id)
    const settled = campaigns.value !== null && !campaigns.loading && !campaigns.error
    // A campaign just made shows from its answer until the list, read again, holds it.
    const campaign = listed ?? (!settled || view.created ? view.snapshot : null)
    content = campaign
      ? <OutreachCampaignView key={campaign.id} facilityId={facilityId} campaign={campaign} members={membersOf(campaign.id)}
        manage={canManage} created={view.created} onChanged={campaigns.refresh}
        exportAction={canReadCases ? <OutreachExport cases={cases.value} campaign={campaign} campaignOf={campaignOf} /> : undefined}
        registrations={canReadCases ? { canLink: canWrite && !group, group,
          onOpen: item => show({ kind: 'case', id: item.id, snapshot: item, created: false,
            from: { kind: 'campaign', id: campaign.id, snapshot: campaign } }) } : undefined}
        onBack={() => backToList(`outreach-campaign-${campaign.id}-open`)} />
      : <RecordNotFound onBack={() => backToList()} />
  } else {
    content = (
      <OutreachList canReadCases={canReadCases} canReadCampaigns={canReadCampaigns} canWrite={canWrite} cases={cases} campaigns={campaigns}
        group={group} campaignOf={campaignOf} onNew={() => show({ kind: 'new' })}
        top={group ? <>
          <OutreachGroupBanner status={organiserStatus} />
          {queuedShown ? <>
            <Alert intent="warning" title="Saved on this device">{queuedNote.text}</Alert>
            {/* The person is still here: they can get their own Health ID on their phone while this one waits for signal. */}
            {/* "Open it to create their Health ID", unless Outreach is known to make none (not from the list alone, which a
                page opened with no signal has not read). */}
            <GetHealthIdNow id="outreach-queued-health-id" queued={served.emailHealthId !== false} ageYears={queuedNote.ageYears} />
          </> : null}
          {sendShown && sendNote ? (
            <Alert intent={sendDone ? 'success' : 'warning'}
              title={sendNote.result.sent > 0 ? (sendDone ? 'Sent' : 'Not all sent') : (sendDone ? 'Nothing to send' : 'Not sent yet')}>
              {queueSyncText(sendNote.result)}
            </Alert>
          ) : null}
          <OutreachQueuePanel entries={queueShown} durable={queue.durable} syncing={queue.syncing} onSync={sendNow}
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
 * The list view: "New registration" as the one main action, then the registrations as cards (who, status, and the next
 * step on each), filtered by what still needs doing, then the campaigns (read only).
 */
function OutreachList({ canReadCases, canReadCampaigns, canWrite, cases, campaigns, group, top, bottom, campaignOf, onNew, onNewCampaign, onOpenCase,
  onOpenCampaign }: {
  readonly canReadCases: boolean
  /** An outreach group's own Outreach (open sign-up on outreach.): nobody here links a Health ID. */
  readonly group: boolean
  /** Shown above the lists: an outreach group's standing with Health ID, and what waits on this device. */
  readonly top?: ReactNode
  /** Shown below the lists: an outreach group's team, for its organiser. */
  readonly bottom?: ReactNode
  readonly canReadCampaigns: boolean
  readonly canWrite: boolean
  readonly cases: CasesRead
  readonly campaigns: ListRead<OutreachCampaign>
  readonly campaignOf: (campaignId: string | undefined) => OutreachCampaign | undefined
  readonly onNew: () => void
  /** Opens "New campaign", where Outreach serves campaign management to this membership. */
  readonly onNewCampaign?: () => void
  readonly onOpenCase: (item: OutreachCase) => void
  readonly onOpenCampaign: (campaign: OutreachCampaign) => void
}) {
  const [tab, setTab] = useState<CaseTab>('waiting')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const focus = useFocusById()
  const loading = (canReadCases && cases.loading) || (canReadCampaigns && campaigns.loading)
  const refresh = () => Promise.all([canReadCases ? cases.refresh() : undefined, canReadCampaigns ? campaigns.refresh() : undefined])

  // Newest first: the person just met is the one most likely to be looked for.
  const all = [...(cases.value ?? [])].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
  const waiting = all.filter(caseWaiting)
  const inTab = (item: OutreachCase) => tab === 'all' || (tab === 'waiting') === caseWaiting(item)
  const rows = all.filter(item => inTab(item) && matchesSearch(search, caseSearchText(item)))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, pages - 1)
  const first = shownPage === 0
  const last = shownPage + 1 >= pages
  const listed = cases.value !== null
  const newButton = canWrite ? <Button variant="primary" icon={UserPlus} onClick={onNew}>New registration</Button> : null
  const canLink = canWrite && !group
  const emptyAll = { icon: Users, title: 'No registrations yet', description: canWrite
    ? 'People you register in the field show here, with what each needs next.' : 'People registered in the field show here.', action: newButton ?? undefined }
  const empty = all.length === 0 ? emptyAll : rows.length > 0 ? null : search
    ? { icon: Search, title: 'No matching registrations', description: 'Check the spelling, or search by another name.' }
    : tab === 'waiting' ? { icon: CircleCheck, title: 'No one is waiting to be linked', description: 'Every registration here is linked to a Health ID.' }
      : { icon: Users, title: 'None linked yet', description: 'Registrations move here once they are linked to a Health ID.' }

  return (
    <DeptPage title="Outreach" description="People registered in the field, and what each one needs next." primaryAction={newButton ?? undefined}
      secondaryActions={<>
        {canReadCases ? <OutreachExport cases={cases.value} campaignOf={campaignOf} /> : null}
        <EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void refresh() }}>Refresh</EhrButton>
      </>}>
      <div className="flex flex-col gap-6">
        {top}
        {canReadCases ? (
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
                {search ? <EhrButton variant="secondary" onClick={() => { setSearch(''); setPage(0); focus('outreach-search') }}>Clear search</EhrButton> : null}
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
                  <EhrButton variant="secondary" className="hid-ehr-dept-outreach-unavailable" aria-disabled={first || undefined}
                    onClick={() => { if (!first) setPage(shownPage - 1) }}>Previous page</EhrButton>
                  <span>Page {shownPage + 1} of {pages}</span>
                  <EhrButton variant="secondary" className="hid-ehr-dept-outreach-unavailable" aria-disabled={last || undefined}
                    onClick={() => { if (!last) setPage(shownPage + 1) }}>Next page</EhrButton>
                </nav>
              ) : null}
            </PageState>
            {/* Outside the list's state: a search or tab that matches none of those loaded can still look further. */}
            {listed ? <ShowMore more={cases.more} shown={all.length} searching={search.trim() !== ''} /> : null}
          </section>
        ) : null}
        {canReadCampaigns ? (
          <section aria-labelledby="outreach-campaigns-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="outreach-campaigns-heading" className="m-0 text-title-2 text-ink">Campaigns</h2>
              {onNewCampaign ? <Button id="outreach-new-campaign" icon={Plus} onClick={onNewCampaign}>New campaign</Button> : null}
            </div>
            {campaigns.error && campaigns.value ? <Alert intent="error" title="Couldn’t refresh campaigns">{campaigns.error}</Alert> : null}
            <PageState loading={campaigns.loading} error={campaigns.value ? null : campaigns.error || null} hasData={campaigns.value !== null}
              onRetry={() => void campaigns.refresh()} what="campaigns" rows={2}
              empty={campaigns.value?.length === 0 ? group && onNewCampaign
                ? { icon: Megaphone, title: 'Create your first campaign', description: 'A campaign is one outreach event or drive: '
                  + 'its name, dates and what you offer. You become its first admin, and people are registered into it.',
                action: <Button variant="primary" icon={Plus} onClick={onNewCampaign}>Create your first campaign</Button> }
                : { icon: Megaphone, title: 'No campaigns yet', description: onNewCampaign
                  ? 'Create a campaign to plan outreach work. You become its first admin.' : 'Campaigns this facility runs show here.' } : null}>
              <Card as="div">
                <ul aria-label="Campaigns" className="m-0 list-none divide-y divide-line p-0">
                  {(campaigns.value ?? []).map(campaign => (
                    <li key={campaign.id}>
                      <button type="button" id={`outreach-campaign-${campaign.id}-open`} onClick={() => onOpenCampaign(campaign)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 border-0 bg-transparent px-5 py-3.5 text-left text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
                        <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
                          <span className="font-semibold break-words">{campaign.name}</span>
                          <span className="text-[13px] text-ink-3">{servicesText(campaign.services)} · starts {dateText(campaign.startsAt)}</span>
                        </span>
                        <Badge size="sm" tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaignStatusLabel(campaign.status)}</Badge>
                        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </PageState>
          </section>
        ) : null}
        {bottom}
      </div>
    </DeptPage>
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
