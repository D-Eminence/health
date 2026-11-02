import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, FlaskConical, Plus, RotateCcw, Search } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { Badge, Button, Card, EmptyState, FilterTabs, Input, PageHeader } from '../../../kasuwa/ui'
import { staffApi, type LabWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { cannotCompleteOffered, holdsReceivePermission, wrongPatientOffered } from '../../../staff/orderRoutes'
import { IncomingOrders } from '../../../staff/routes/IncomingOrders'
import { LateWrongPatient } from '../../../staff/routes/LateWrongPatient'
import { CannotCompleteEndings, type CannotCompleteEnding } from '../../../staff/routes/CannotComplete'
import type { WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { useLateCorrectionServed } from '../../../lateCorrectionServed'
import { useCannotCompleteServed } from '../../../cannotCompleteServed'
import type { PaymentSettings } from '../commerce/api'
import { BillBadge } from '../commerce/BillBadge'
import { useDeptAccess } from '../parts/access'
import { DeptEmbedded } from '../parts/DeptEmbedded'
import { DeptNotice } from '../parts/DeptNotice'
import { matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { isUrgent, urgencyRank } from '../parts/WorkQueue'
import {
  CAP_CANNOT_COMPLETE, RoutedWorkLines, RoutedWorkPaused, SaidAboveList, SaidAboveTheList, StandaloneWorkNote, useLearnCannotCompleteServed,
  useLearnLateCorrectionServed, useLearnWrongPatientServed, useNotCompletedEndings, useReceiving, useRowSaid, WorkListCap, type Said,
} from '../parts/routedWork'
import { usePaymentSettings } from '../pharmacy/pointOfCare'
import { billOf, billOwing, paysFirst } from '../pharmacy/pocFields'
import { LabRequest } from './LabRequest'
import {
  ageSex, byUrgencyThenWait, factsOfItem, nextAction, personOf, requestOf, stageOf, STAGE_LABEL, STAGES, waitedText, type LabStage,
} from './stage'

/** The work list's address; a request opens below it (`/work/:id`), so Back and a refresh keep the place. */
export const WORK_HREF = '/provider/laboratory/work'
const STAGE_PARAM = 'stage'

const isStage = (value: string | null): value is LabStage => value !== null && (STAGES as readonly string[]).includes(value)

/** The request open in the address, if any. */
function openId(pathname: string): string | null {
  const match = /\/laboratory\/work\/([^/]+)\/?$/.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

/** Work items asked for together (one walk-in request) and at the same stage: one card. */
interface Group { readonly key: string; readonly items: readonly LabWorkItem[]; readonly stage: LabStage }

function groupsOf(items: readonly LabWorkItem[]): Group[] {
  const groups = new Map<string, { items: LabWorkItem[]; stage: LabStage }>()
  for (const item of items) {
    const stage = stageOf(item)
    const key = `${requestOf(item)?.id ?? item.id}:${stage}`
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { items: [item], stage })
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}

/**
 * The lab's work list (laboratory/work): every request by stage (Waiting for sample → Testing → Enter results → Check &
 * release → Done), urgent first, then the longest waiting; each card the one next thing to do. A request opens below
 * the list (laboratory/work/:id) while the list stays mounted, so orders waiting here and a lookup in progress keep
 * their place. Orders from other facilities keep everything today's Laboratory page does with them: Incoming, the
 * wrong-patient and can't-complete endings and the late correction (staff/routes, unchanged).
 */
export function Laboratory() {
  const { facilityId, permissions, facility } = useDeptAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const read = useFacilityRead(facilityId, canRead, useCallback((id: string) => staffApi.labWorkItems(id), []))
  const list = { ...read, items: read.value ? read.value.items : null }
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const workId = openId(location.pathname)
  const chosen = workId ? list.items?.find(item => item.id === workId) ?? null : null
  const focus = useFocusById()
  const { mounted, probe, watch, holds, receives, onFound, onAnswer } = useReceiving(facility, 'lab', read)
  useLearnWrongPatientServed(list.items)
  useLearnLateCorrectionServed(read.value)
  useLearnCannotCompleteServed(read.value)
  const lateCorrection = useLateCorrectionServed() === true && holdsReceivePermission(facility, 'lab')
  const cannotServed = useCannotCompleteServed()
  const [ended, setEnded] = useState<Said | null>(null)
  const notCompleted = useNotCompletedEndings(facilityId)
  const said = useRowSaid('lab', read.value, list.refresh, (mode, route) => mode === 'wrong_patient'
    ? wrongPatientOffered(route, permissions, 'lab') : cannotCompleteOffered(route, permissions, 'lab', cannotServed))
  const [search, setSearch] = useState('')
  const paymentSettings = usePaymentSettings(canRead ? facilityId : undefined)
  const settings: PaymentSettings | null = paymentSettings.status === 'ready' ? paymentSettings.data : null

  const items = list.items ? notCompleted.shown(list.items) : []
  const searched = items.filter(item => {
    const person = personOf(item)
    return matchesSearch(search, [item.testName, item.accessionNumber, person.name, person.phone, person.healthId, requestOf(item)?.number,
      item.priority, item.orderRoute?.orderingFacilityName, item.orderRoute?.reference])
  })
  const groups = groupsOf(searched)
  const count = (stage: LabStage) => groups.filter(group => group.stage === stage).length
  const asked = params.get(STAGE_PARAM)
  // With no stage in the address: the first with work waiting, else Waiting for sample.
  const stage: LabStage = isStage(asked) ? asked : STAGES.find(value => value !== 'done' && groupsOf(items).some(group => group.stage === value)) ?? 'collect'
  const shown = byUrgencyThenWait(groups.filter(group => group.stage === stage),
    // A request is as urgent as its most urgent test: stat, then as soon as possible, then urgent.
    group => group.items.map(item => item.priority).reduce((most, priority) => urgencyRank(priority) < urgencyRank(most) ? priority : most),
    group => group.items[0]!.acceptedAt)
  // The card each work item is reached from: focus goes back there from its record.
  const cardOf = new Map(groupsOf(items).flatMap(group => group.items.map(item => [item.id, `lab-${group.items[0]!.id}-record`] as const)))

  // Focus follows the address, in the commit that shows the new view (the router's update can come a render after the
  // press): a request opened (from its card, or another test on it) puts it on the request's title; leaving one (its
  // Back, or the browser's) puts it back on its card, once the list shows again.
  const lastWork = useRef(workId)
  useLayoutEffect(() => {
    const was = lastWork.current
    lastWork.current = workId
    if (was && !workId) focus([cardOf.get(was) ?? `lab-${was}-record`, 'lab-work-title'], true)
    else if (workId && workId !== was) focus('lab-record-title')
  }, [workId, focus, cardOf])
  // A request named in the address that the list no longer holds (it ended, or the address is old): back to the list.
  const stale = Boolean(workId && list.items !== null && !chosen)
  useLayoutEffect(() => {
    if (stale) navigate({ pathname: WORK_HREF, search: location.search }, { replace: true })
  }, [stale, navigate, location.search])

  if (!facilityId || !canRead) return <div className="flex flex-col gap-5">
    <PageHeader title="Work list" />
    <EmptyState icon={FlaskConical} title="You can’t open the lab here" description="Your role needs permission to see lab work." />
  </div>
  const workFacility = facilityId
  const listHref = `${WORK_HREF}${stage ? `?${STAGE_PARAM}=${stage}` : ''}`

  function open(item: LabWorkItem) {
    navigate(`${WORK_HREF}/${encodeURIComponent(item.id)}`, { state: { fromQueue: true } })
    focus('lab-record-title')
  }
  function closeRecord() { navigate(listHref, { replace: true }) }
  function endedHere(item: LabWorkItem, ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    said.clear()
    if (workId === item.id) closeRecord()
    void list.refresh()
  }
  function endedLate(ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    if (chosen?.orderRoute?.id === ending.result.route.id) closeRecord()
    void list.refresh()
  }
  function notCompletedHere(ending: Omit<CannotCompleteEnding, 'key'>) {
    notCompleted.add(ending)
    said.clear()
    if (chosen?.orderRoute?.id === ending.result.route.id) closeRecord()
    void list.refresh()
  }
  const pick = (value: LabStage) => setParams(previous => { const next = new URLSearchParams(previous); next.set(STAGE_PARAM, value); return next }, { replace: true })
  const siblings = chosen ? items.filter(item => item.id !== chosen.id && requestOf(item) && requestOf(item)?.id === requestOf(chosen)?.id) : []

  return <div className="hid-ehr-dept-laboratory">
    {chosen ? <LabRequest key={chosen.id} facilityId={workFacility} item={chosen} siblings={siblings} permissions={permissions} settings={settings}
      said={said.rowSaid(chosen.orderRoute?.id)} backTo={listHref} onListChanged={() => void list.refresh()}
      onEnded={ending => endedHere(chosen, ending)} onNotCompleted={notCompletedHere} onReread={said.reread} /> : null}
    {/* The list stays mounted under a record, so orders waiting here and a lookup in progress keep their place. */}
    <div hidden={Boolean(chosen)} className="flex flex-col gap-5">
      <PageHeader title={<span id="lab-work-title" tabIndex={-1} className="outline-none">Work list</span>}
        actions={<>
          {/* Busy while the list is read, but never disabled: a disabled button would lose the focus it has. */}
          <Button icon={RotateCcw} aria-busy={list.loading || undefined} aria-disabled={list.loading || undefined}
            onClick={() => { if (!list.loading) void list.refresh() }}>Refresh</Button>
          {permissions.includes('lab.walk-in.create') ? <Button variant="primary" icon={Plus} to="/provider/laboratory/new">New request</Button> : null}
        </>} />
      <StandaloneWorkNote facility={facility} kind="laboratory" ordersOn={read.value?.crossFacilityOrders === true} receives={receives} />
      {mounted && facility ? <DeptEmbedded className="hid-ehr-dept-laboratory-embedded"><IncomingOrders service="lab" facilityId={workFacility}
        facilityName={facility.name} probe={probe} watch={watch} membershipId={facility.membershipId} onFound={onFound} onAnswer={onAnswer}
        onAccepted={() => void list.refresh()} onEnded={() => void list.refresh()} closedRouteId={notCompleted.lastRouteId} /></DeptEmbedded> : null}
      <SaidAboveTheList service="lab" said={ended} facilityId={workFacility} onClose={() => setEnded(null)} />
      {notCompleted.endings.length > 0 ? <DeptEmbedded>
        <CannotCompleteEndings service="lab" endings={notCompleted.endings} onClose={notCompleted.close} />
      </DeptEmbedded> : null}
      {lateCorrection ? <DeptEmbedded><LateWrongPatient service="lab" facilityId={workFacility} onEnded={endedLate} onNotCompleted={notCompletedHere}
        onCorrected={correction => { notCompleted.corrected(correction); setEnded({ facilityId: workFacility, correction }) }} /></DeptEmbedded> : null}
      <RoutedWorkPaused items={list.items} crossFacilityWork={read.value?.crossFacilityWork} receives={holds} />
      <WorkListCap count={list.items?.length ?? 0}>{cannotServed === true && lateCorrection ? <DeptNotice>{CAP_CANNOT_COMPLETE}</DeptNotice> : null}</WorkListCap>
      <SaidAboveList id="lab-said" text={said.listSaid} />

      <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:justify-between">
        <FilterTabs<LabStage> label="Stage" value={stage} onChange={pick}
          options={STAGES.map(value => ({ value, label: STAGE_LABEL[value], count: count(value) }))} />
        <Input icon={Search} type="search" aria-label="Search the work list" placeholder="Name, phone, test or number" value={search}
          onChange={event => setSearch(event.target.value)} className="@4xl:w-80" />
      </div>
      <PageState loading={list.loading} error={list.error || null} hasData={list.items !== null} onRetry={() => void list.refresh()} what="the work list" rows={4}
        empty={shown.length === 0 ? { icon: FlaskConical, title: search.trim() ? 'Nothing matches' : stage === 'done' ? 'Nothing done yet today' : `Nothing in ${STAGE_LABEL[stage]}`,
          description: search.trim() ? 'Check the spelling, or try another stage.' : stage === 'collect' ? 'New requests show here.' : undefined } : null}>
        <ul aria-label={STAGE_LABEL[stage]} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
          {shown.map(group => <RequestCard key={group.key} group={group} settings={settings} onOpen={open}
            below={group.items.map(item => {
              const rowSaid = chosen ? null : said.rowSaid(item.orderRoute?.id)
              return item.orderRoute ? <div key={item.id} className="flex flex-col gap-2">
                {rowSaid ? <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{rowSaid}</DeptNotice> : null}
                <DeptEmbedded><RoutedWorkLines route={item.orderRoute} /></DeptEmbedded>
              </div> : null
            })} />)}
        </ul>
      </PageState>
    </div>
  </div>
}

/** One request at one stage: who, their age and sex, the tests, urgency, how long they have waited, the bill, and the one next action. */
function RequestCard({ group, settings, onOpen, below }: {
  readonly group: Group; readonly settings: PaymentSettings | null; readonly onOpen: (item: LabWorkItem) => void; readonly below: ReactNode
}) {
  const first = group.items[0]!
  const person = personOf(first)
  const urgent = group.items.some(item => isUrgent(item.priority))
  const bill = billOf(first)
  const owing = group.stage === 'collect' && paysFirst(settings, 'lab') && billOwing(bill)
  const action = nextAction(group.stage, factsOfItem(first), owing)
  const waited = waitedText(first.acceptedAt)
  const details = [ageSex(person), person.healthId ?? (person.hidText === 'No Health ID' ? null : person.hidText)].filter(Boolean).join(' · ')
  return <Card as="li" className="@container flex min-w-0 flex-col gap-3 p-4">
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="m-0 text-title-3 text-ink break-words">{person.name}</p>
        {details ? <p className="m-0 text-caption text-ink-2">{details}</p> : null}
      </div>
      <div className="flex max-w-full flex-wrap gap-1.5">
        {urgent ? <Badge size="sm" tone="danger">Urgent</Badge> : null}
        {bill !== undefined ? <BillBadge bill={bill} /> : null}
      </div>
    </div>
    <p className="m-0 text-[15px] font-medium text-ink break-words">{group.items.map(item => item.testName ?? 'Lab test').join(' · ')}</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-caption text-ink-3 tabular">
        <Clock className="size-3.5" aria-hidden />{waited ? `Waiting ${waited}` : 'Just in'}{requestOf(first) ? ` · ${requestOf(first)!.number}` : ''}
      </span>
      <Button id={`lab-${first.id}-record`} variant="soft" onClick={() => onOpen(first)} className="whitespace-nowrap @max-xs:w-full">
        {action}<span className="sr-only">: {person.name}, {group.items.map(item => item.testName ?? 'Lab test').join(', ')}</span>
      </Button>
    </div>
    {below}
  </Card>
}
