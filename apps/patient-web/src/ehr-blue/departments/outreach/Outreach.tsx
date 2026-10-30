import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrEmptyState, EhrSkeleton, type EhrDataTableColumn } from '@hid/ui/ehr'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { focusLost } from '../../../pageFocus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage } from '../parts/DeptPage'
import { DeptFacts, DeptLinkButton, DeptRecordName } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { dateText, matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { CampaignMembersRead, OutreachCampaignView } from './OutreachCampaignView'
import { OutreachCaseView } from './OutreachCaseView'
import { OutreachNew, type CaseAttempt } from './OutreachNew'
import {
  ageText, campaignFacts, campaignSearchText, CAMPAIGNS_NOT_LOADED, CAMPAIGNS_READ_ONLY, CAMPAIGNS_READ_ONLY_TITLE, caseFacts, caseName,
  CASES_NOT_LOADED, caseSearchText, ErrorBox, NO_FACILITY, NO_READ_PERMISSION, PENDING, reference, sexText, statusWords, type MembersRead,
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
    : `Registration case created. Its status is ${statusWords(created.status)}.`
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

/** The design's list view: "Create record", then each list in its search card. */
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
  const [quick, setQuick] = useState<{ kind: 'case'; item: OutreachCase } | { kind: 'campaign'; campaign: OutreachCampaign } | null>(null)
  const loading = (canReadCases && cases.loading) || (canReadCampaigns && campaigns.loading)
  const refresh = () => Promise.all([canReadCases ? cases.refresh() : undefined, canReadCampaigns ? campaigns.refresh() : undefined])

  const caseColumns: EhrDataTableColumn<OutreachCase>[] = [
    { id: 'record', header: 'Record', cell: item => <DeptRecordName id={`outreach-case-${item.id}-open`} name={caseName(item)} reference={reference(item.id)} onOpen={() => onOpenCase(item)} /> },
    { id: 'context', header: 'Patient / context', cell: item => <>{caseName(item)}<span className="hid-ehr-dept-reference">{ageText(item)} · {sexText(item)}</span></> },
    { id: 'status', header: 'Status', cell: item => <EhrBadge>{statusWords(item.status)}</EhrBadge> },
    { id: 'created', header: 'Created', cell: item => dateText(item.createdAt) },
    {
      id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: item => (
        <div className="hid-ehr-dept-table-actions">
          <EhrButton variant="secondary" aria-describedby={`outreach-case-${item.id}-open`} onClick={() => setQuick({ kind: 'case', item })}>Quick view</EhrButton>
          <DeptLinkButton describedBy={`outreach-case-${item.id}-open`} onClick={() => onOpenCase(item)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
        </div>
      ),
    },
  ]
  const campaignColumns: EhrDataTableColumn<OutreachCampaign>[] = [
    { id: 'record', header: 'Record', cell: campaign => <DeptRecordName id={`outreach-campaign-${campaign.id}-open`} name={campaign.name} reference={reference(campaign.id)} onOpen={() => onOpenCampaign(campaign)} /> },
    { id: 'services', header: 'Services', cell: campaign => campaign.services.length ? campaign.services.join(', ') : 'None listed' },
    { id: 'status', header: 'Status', cell: campaign => <EhrBadge>{statusWords(campaign.status)}</EhrBadge> },
    { id: 'starts', header: 'Starts', cell: campaign => dateText(campaign.startsAt) },
    {
      id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: campaign => (
        <div className="hid-ehr-dept-table-actions">
          <EhrButton variant="secondary" aria-describedby={`outreach-campaign-${campaign.id}-open`} onClick={() => setQuick({ kind: 'campaign', campaign })}>Quick view</EhrButton>
          <DeptLinkButton describedBy={`outreach-campaign-${campaign.id}-open`} onClick={() => onOpenCampaign(campaign)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
        </div>
      ),
    },
  ]

  const open = () => {
    if (!quick) return
    setQuick(null)
    if (quick.kind === 'case') onOpenCase(quick.item)
    else onOpenCampaign(quick.campaign)
  }

  return (
    <DeptPage title="Outreach" primaryAction={(
      <>
        {canWrite ? <EhrButton onClick={onNew}>Create record</EhrButton> : null}
        <EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void refresh() }}>Refresh</EhrButton>
      </>
    )}>
      <EhrDrawer open={quick !== null} title="Record quick view" onClose={() => setQuick(null)}>
        {quick ? (
          <>
            <div className="hid-ehr-dept-outreach-quick">
              <h3>{quick.kind === 'case' ? caseName(quick.item) : quick.campaign.name}</h3>
              <p>{quick.kind === 'case' ? `Created ${dateText(quick.item.createdAt)}` : `Starts ${dateText(quick.campaign.startsAt)}`}</p>
            </div>
            <DeptFacts facts={quick.kind === 'case' ? caseFacts(quick.item, campaignOf(quick.item.campaignId)) : campaignFacts(quick.campaign)} />
            <div className="hid-ehr-dept-outreach-quick-open"><EhrButton onClick={open}>Open full record</EhrButton></div>
          </>
        ) : null}
      </EhrDrawer>
      {canReadCases ? (
        <RecordList label="Search Outreach" caption="Registration cases" pagesLabel="Registration case pages" read={cases} columns={caseColumns}
          rowKey={item => item.id} searchText={caseSearchText} loadingLabel="Loading registration cases"
          emptyMessage="Create the first record when you have the appropriate permission." />
      ) : null}
      {canReadCampaigns ? (
        <>
          <DeptNotice title={CAMPAIGNS_READ_ONLY_TITLE}>{CAMPAIGNS_READ_ONLY}</DeptNotice>
          <RecordList label="Search campaigns" caption="Campaigns" pagesLabel="Campaign pages" read={campaigns} columns={campaignColumns}
            rowKey={campaign => campaign.id} searchText={campaignSearchText} loadingLabel="Loading campaigns"
            emptyMessage="No campaigns are listed for this facility yet." />
        </>
      ) : null}
    </DeptPage>
  )
}

/**
 * One list in the design's search card: the search (in memory: it sends nothing), "Clear
 * search", record pages over 50, and the table, or its loading, refused or empty state.
 */
function RecordList<T>({ label, caption, pagesLabel, read, columns, rowKey, searchText, loadingLabel, emptyMessage }: {
  readonly label: string
  readonly caption: string
  readonly pagesLabel: string
  readonly read: ListRead<T>
  readonly columns: readonly EhrDataTableColumn<T>[]
  readonly rowKey: (row: T) => string
  readonly searchText: (row: T) => ReadonlyArray<string | null | undefined>
  readonly loadingLabel: string
  readonly emptyMessage: string
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  // "Clear search" removes itself, so focus goes back to the search it cleared, in the commit that removes it.
  const card = useRef<HTMLDivElement>(null)
  const [cleared, setCleared] = useState(0)
  useLayoutEffect(() => {
    if (cleared) card.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
  }, [cleared])
  const all = read.value ?? []
  const rows = all.filter(row => matchesSearch(search, searchText(row)))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, pages - 1)
  const first = shownPage === 0
  const last = shownPage + 1 >= pages
  return (
    <div ref={card}>
      <DeptSearch label={label} value={search} onChange={value => { setSearch(value); setPage(0) }}>
        {search || rows.length > PAGE_SIZE ? (
          <div className="hid-ehr-dept-outreach-list-tools">
            {search ? <EhrButton variant="secondary" onClick={() => { setSearch(''); setPage(0); setCleared(count => count + 1) }}>Clear search</EhrButton> : null}
            {rows.length > PAGE_SIZE ? (
              <nav className="hid-ehr-dept-outreach-pages" aria-label={pagesLabel}>
                {/* Unavailable at the first and last page, not disabled: a disabled button would lose the focus it has. */}
                <EhrButton variant="secondary" className="hid-ehr-dept-outreach-unavailable" aria-disabled={first || undefined}
                  onClick={() => { if (!first) setPage(shownPage - 1) }}>Previous page</EhrButton>
                <span>Page {shownPage + 1} of {pages}</span>
                <EhrButton variant="secondary" className="hid-ehr-dept-outreach-unavailable" aria-disabled={last || undefined}
                  onClick={() => { if (!last) setPage(shownPage + 1) }}>Next page</EhrButton>
              </nav>
            ) : null}
          </div>
        ) : null}
        <ErrorBox message={read.error} />
        {read.value === null
          ? (read.loading ? <EhrSkeleton label={loadingLabel} /> : null)
          : rows.length === 0
            ? <EhrEmptyState title="No matching records" message={all.length ? 'Change your search.' : emptyMessage} />
            : <EhrDataTable caption={caption} captionHidden columns={columns} rows={rows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE)} rowKey={rowKey} />}
      </DeptSearch>
    </div>
  )
}
