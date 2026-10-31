import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { ArrowRight, ChevronRight, CircleCheck, Megaphone, Search, UserPlus, Users } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, FilterTabs, Input } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { focusLost } from '../../../pageFocus'
import { useDeptAccess } from '../parts/access'
import { DeptPage } from '../parts/DeptPage'
import { dateText, matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { CampaignMembersRead, OutreachCampaignView } from './OutreachCampaignView'
import { OutreachCaseView } from './OutreachCaseView'
import { OutreachNew, type CaseAttempt } from './OutreachNew'
import {
  ageText, CAMPAIGNS_NOT_LOADED, caseName, caseTone, CASES_NOT_LOADED, caseSearchText, caseWaiting, ErrorBox,
  NO_FACILITY, NO_READ_PERMISSION, nextStepText, PENDING, sexText, statusLabel, statusWords, type MembersRead,
} from './outreachParts'

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
  | { kind: 'campaign'; id: string; snapshot: OutreachCampaign }

type FocusRequest = { id?: string; ifLost: boolean }

/**
 * Outreach in the blue Hospital EHR: registration cases and campaigns as the design's
 * workspace (a list with search, Quick view and Open; a record view with "Saved record" and
 * "Available actions"; "Create record" for a new case), on today's staff API and its rules
 * (staff/routes/Operations.tsx Outreach, CampaignCard, OutreachCaseCard): campaigns and their
 * members read only, registration cases created and linked to a verified existing patient.
 */
export function Outreach() {
  const { facilityId, membershipId, permissions } = useDeptAccess()
  const { lock } = useStaff()
  const canReadCases = permissions.includes('outreach.registration.read')
  const canReadCampaigns = permissions.includes('outreach.campaign.read')
  const canWrite = permissions.includes('outreach.registration.write')
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
  // Only active registration campaigns containing this facility membership can take a case.
  const caseCampaigns = useMemo(() => (campaigns.value ?? []).filter(campaign => campaign.status === 'active'
    && campaign.services.includes('registration') && eligibleCampaigns.facilityId === facilityId && eligibleCampaigns.ids.has(campaign.id)),
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

  if (!facilityId) {
    return (
      <DeptPage title="Outreach">
        <ErrorBox message={NO_FACILITY} />
      </DeptPage>
    )
  }
  if (!canReadCases && !canReadCampaigns) {
    return (
      <DeptPage title="Outreach">
        <ErrorBox message={NO_READ_PERMISSION} />
      </DeptPage>
    )
  }

  const readers = canReadCampaigns ? campaigns.value?.map(campaign => (
    <CampaignMembersRead key={campaign.id} facilityId={facilityId} membershipId={membershipId} campaign={campaign}
      onMembershipChange={recordMembership} onRead={recordMembers} />
  )) : null
  const membersOf = (campaignId: string) => {
    const read = members.get(campaignId)
    return read?.facilityId === facilityId ? read : undefined
  }
  const campaignOf = (campaignId: string | undefined) => campaignId ? campaigns.value?.find(campaign => campaign.id === campaignId) : undefined

  let content: ReactNode
  if (view.kind === 'new' && canWrite) {
    content = <OutreachNew facilityId={facilityId} showCampaign={canReadCampaigns} campaigns={caseCampaigns} attempt={caseAttempt}
      onBack={() => backToList()} onSending={clearCreatedNote} onCreated={onCreated} />
  } else if (view.kind === 'case' && (canReadCases || view.created)) {
    const listed = cases.value?.find(item => item.id === view.id)
    // A record the list no longer holds is not shown from memory, unless the list cannot say (not read, being read,
    // or refused) or the create form has just made it.
    const settled = canReadCases && cases.value !== null && !cases.loading && !cases.error
    const item = listed ?? (view.created || !settled ? view.snapshot : null)
    content = item
      ? <OutreachCaseView key={item.id} facilityId={facilityId} item={item} campaign={campaignOf(item.campaignId)} canLink={canWrite}
        created={view.created} listError={cases.error} onBack={() => backToList(`outreach-case-${item.id}-open`)}
        onNew={canWrite ? () => show({ kind: 'new' }) : undefined}
        onChanged={cases.refresh} onFocusHeading={focusHeadingIfLost} />
      : <RecordNotFound onBack={() => backToList()} />
  } else if (view.kind === 'campaign' && canReadCampaigns) {
    const listed = campaigns.value?.find(campaign => campaign.id === view.id)
    const settled = campaigns.value !== null && !campaigns.loading && !campaigns.error
    const campaign = listed ?? (!settled ? view.snapshot : null)
    content = campaign
      ? <OutreachCampaignView key={campaign.id} campaign={campaign} members={membersOf(campaign.id)}
        onBack={() => backToList(`outreach-campaign-${campaign.id}-open`)} />
      : <RecordNotFound onBack={() => backToList()} />
  } else {
    content = (
      <OutreachList canReadCases={canReadCases} canReadCampaigns={canReadCampaigns} canWrite={canWrite} cases={cases} campaigns={campaigns}
        campaignOf={campaignOf} onNew={() => show({ kind: 'new' })}
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

/** What the create form's answer said: the case made, and where its identity stands. */
function createdText(created: OutreachCase | undefined) {
  if (!created?.status) return 'Registration case created.'
  return created.status === PENDING
    ? 'Registration case created. It stays pending until it is linked to a verified Health ID patient.'
    : `Registration case created. Its status is ${statusLabel(created.status).toLowerCase()}.`
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
function OutreachList({ canReadCases, canReadCampaigns, canWrite, cases, campaigns, campaignOf, onNew, onOpenCase, onOpenCampaign }: {
  readonly canReadCases: boolean
  readonly canReadCampaigns: boolean
  readonly canWrite: boolean
  readonly cases: ListRead<OutreachCase>
  readonly campaigns: ListRead<OutreachCampaign>
  readonly campaignOf: (campaignId: string | undefined) => OutreachCampaign | undefined
  readonly onNew: () => void
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
  const emptyAll = { icon: Users, title: 'No registrations yet', description: canWrite
    ? 'People you register in the field show here, with what each needs next.' : 'People registered in the field show here.', action: newButton ?? undefined }
  const empty = all.length === 0 ? emptyAll : rows.length > 0 ? null : search
    ? { icon: Search, title: 'No matching registrations', description: 'Check the spelling, or search by another name.' }
    : tab === 'waiting' ? { icon: CircleCheck, title: 'No one is waiting to be linked', description: 'Every registration here is linked to a Health ID.' }
      : { icon: Users, title: 'None linked yet', description: 'Registrations move here once they are linked to a Health ID.' }

  return (
    <DeptPage title="Outreach" description="People registered in the field, and what each one needs next." primaryAction={newButton ?? undefined}
      secondaryActions={<EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void refresh() }}>Refresh</EhrButton>}>
      <div className="flex flex-col gap-6">
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
                  <CaseCard key={item.id} item={item} campaign={campaignOf(item.campaignId)} canLink={canWrite} onOpen={() => onOpenCase(item)} />
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
          </section>
        ) : null}
        {canReadCampaigns ? (
          <section aria-labelledby="outreach-campaigns-heading" className="flex flex-col gap-3">
            <h2 id="outreach-campaigns-heading" className="m-0 text-title-2 text-ink">Campaigns</h2>
            {campaigns.error && campaigns.value ? <Alert intent="error" title="Couldn’t refresh campaigns">{campaigns.error}</Alert> : null}
            <PageState loading={campaigns.loading} error={campaigns.value ? null : campaigns.error || null} hasData={campaigns.value !== null}
              onRetry={() => void campaigns.refresh()} what="campaigns" rows={2}
              empty={campaigns.value?.length === 0 ? { icon: Megaphone, title: 'No campaigns yet', description: 'Campaigns this facility runs show here.' } : null}>
              <Card as="div">
                <ul aria-label="Campaigns" className="m-0 list-none divide-y divide-line p-0">
                  {(campaigns.value ?? []).map(campaign => (
                    <li key={campaign.id}>
                      <button type="button" id={`outreach-campaign-${campaign.id}-open`} onClick={() => onOpenCampaign(campaign)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 border-0 bg-transparent px-5 py-3.5 text-left text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
                        <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
                          <span className="font-semibold break-words">{campaign.name}</span>
                          <span className="text-[13px] text-ink-3">{campaign.services.length ? campaign.services.join(', ') : 'No services listed'} · starts {dateText(campaign.startsAt)}</span>
                        </span>
                        <Badge size="sm" tone={campaign.status === 'active' ? 'success' : 'neutral'}>{statusWords(campaign.status)}</Badge>
                        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </PageState>
          </section>
        ) : null}
      </div>
    </DeptPage>
  )
}

/** One registration as a card: who (large), age and sex, its status in words, and its next step. One button opens it. */
function CaseCard({ item, campaign, canLink, onOpen }: {
  readonly item: OutreachCase
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
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
            {nextStepText(item, canLink)}{waiting && canLink ? <ArrowRight className="size-3.5" aria-hidden /> : null}
          </span>
          <span className="text-ink-3 tabular">Registered {dateText(item.createdAt)}</span>
        </span>
      </button>
    </li>
  )
}
