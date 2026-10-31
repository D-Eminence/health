import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { EhrButton, EhrEmptyState, EhrSkeleton } from '@hid/ui/ehr'
import { staffApi, type LabAccession, type LabWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import {
  cannotCompleteOffered, holdsReceivePermission, licenceLine, routeClosedForWork, sampleCheckText, wrongPatientOffered,
} from '../../../staff/orderRoutes'
import { IncomingOrders } from '../../../staff/routes/IncomingOrders'
import { LateWrongPatient } from '../../../staff/routes/LateWrongPatient'
import { CannotCompleteEndings, OrderEndingActions, type CannotCompleteEnding, type OrderEndingMode } from '../../../staff/routes/CannotComplete'
import type { WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { useLateCorrectionServed } from '../../../lateCorrectionServed'
import { useCannotCompleteServed } from '../../../cannotCompleteServed'
import { useDeptAccess } from '../parts/access'
import { DeptEmbedded } from '../parts/DeptEmbedded'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { DeptContextLine, DeptFacts, DeptRecordLayout, type DeptFact } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { birthDateText, dateText, matchesSearch } from '../parts/format'
import { QueuePatient, statusTitle, urgentFirst, WorkQueue } from '../parts/WorkQueue'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, RefreshButton, RoutedWorkLines, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed, useNotCompletedEndings,
  useReceiving, useRowSaid, WorkListCap, type Said,
} from '../parts/routedWork'
import { PatientBanner } from '../../../kasuwa/parts'
import { AccessionForm, AccessionView, type LabSubject } from './accession'
import { LabActionButton, LabActions, statusWord } from './labParts'
import { Plus } from 'lucide-react'
import { Button } from '../../../kasuwa/ui'
import type { PaymentSettings, WorkItemBill } from '../commerce/api'
import { BillBadge } from '../commerce/BillBadge'
import { PaidLine, PaymentStep, usePaymentSettings } from '../pharmacy/pointOfCare'
import { billOf, billOwing, outsideOf, paysFirst } from '../pharmacy/pocFields'

/** The open work's id in the address (`?work=`), so Back and a refresh keep the place. */
const WORK_PARAM = 'work'

/*
 * Laboratory in the blue Hospital EHR: the queue (search, then the lab work, stat and urgent first, each row opening it) and
 * record view (Saved record, Available actions, then the accession's samples and results). What the page reads, writes
 * and refuses is today's Laboratory page's (staff/routes/Operations.tsx Laboratory): its work list, orders from other
 * facilities, the wrong-patient and can't-complete endings, the late correction, the accession and every step on it.
 */

/** A work item's name, as its row and record show it. */
function workTitle(item: LabWorkItem) {
  return item.testName ?? 'Lab test'
}

/** A work item's status in the target's words: accessioned once it has an accession, else Lab's own status. */
function workStatus(item: LabWorkItem) {
  return item.accessionId ? 'accessioned' : statusWord(item.status)
}

/**
 * Who the work is for, for the confirm before a save: the name, date of birth and sex when Lab sends them (work from
 * another facility), else the masked reference Lab sends for this facility's own work.
 */
function subjectOf(item: LabWorkItem): LabSubject {
  const patient = item.patient
  const name = patient?.fullName ?? patientLabel(item)
  const hid = patient?.healthIdLast4 ? `Health ID ending ${patient.healthIdLast4}` : 'Health ID not sent'
  return { name, banner: <PatientBanner compact name={name} hid={hid} dateOfBirth={patient?.dateOfBirth} sex={patient?.sex} /> }
}

/** What is known of a work item, for its record. */
function workFacts(item: LabWorkItem): DeptFact[] {
  const route = item.orderRoute
  return [
    { label: 'Test', value: workTitle(item) },
    { label: 'Patient', value: patientLabel(item) },
    ...(item.patient?.dateOfBirth ? [{ label: 'Date of birth', value: birthDateText(item.patient.dateOfBirth) }] : []),
    ...(item.priority ? [{ label: 'Priority', value: statusTitle(item.priority) }] : []),
    { label: 'Accepted', value: dateText(item.acceptedAt) },
    ...(route ? [{ label: 'Ordering facility', value: route.orderingFacilityName ?? 'Not available' }] : []),
    ...(route?.reference ? [{ label: 'Reference', value: route.reference }] : []),
    ...(route?.ordererName ? [{ label: 'Ordered by', value: route.ordererName
      + (route.ordererLicence ? ` · ${licenceLine(route.ordererLicence.body, route.ordererLicence.number)}` : '') }] : []),
    { label: 'Accession', value: item.accessionNumber ?? 'Not created yet' },
    { label: 'Status', value: statusTitle(workStatus(item)) },
  ]
}

export function Laboratory() {
  const { facilityId, permissions, facility } = useDeptAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const read = useFacilityRead(facilityId, canRead, useCallback((id: string) => staffApi.labWorkItems(id), []))
  const list = { ...read, items: read.value ? read.value.items : null }
  // The open work lives in the address (`?work=`), so Back and a refresh keep the place. What a create added to it (its
  // accession, and the line saying so) is held here, for that work only.
  const [params, setParams] = useSearchParams()
  const workId = params.get(WORK_PARAM)
  const [selection, setSelection] = useState<{ facilityId: string; item: LabWorkItem; created?: string } | null>(null)
  const chosen = workId ? list.items?.find(item => item.id === workId)
    ?? (selection?.item.id === workId && list.items === null ? selection.item : null) ?? null : null
  const extra = selection && selection.facilityId === facilityId && selection.item.id === workId ? selection : null
  // The chosen work, only while the list still holds it: work that has left the list (an order ended, here or elsewhere)
  // never shows its accession or its patient again, even once other work is listed.
  const selected = chosen ? { ...chosen, accessionId: extra?.item.accessionId || chosen.accessionId, accessionNumber: extra?.item.accessionNumber || chosen.accessionNumber } : null
  // The chosen work as the list now has it: its order may have ended since it was chosen.
  const current = selected
  const selectedRoute = current?.orderRoute
  // Opening a record, going back, or creating an accession moves focus to where the work continues.
  const focus = useFocusById()
  // Orders other facilities send here: received by laboratory scientists (lab.order-route.receive), and only at a
  // laboratory: a hospital's or clinic's own laboratory is never sent any (useReceiving).
  const { mounted, probe, watch, holds, receives, onFound, onAnswer } = useReceiving(facility, 'lab', read)
  useLearnWrongPatientServed(list.items)
  useLearnLateCorrectionServed(read.value)
  useLearnCannotCompleteServed(read.value)
  // "Correct an order that has ended": for a member who receives lab requests from other facilities, once the backend
  // serves it; a laboratory that no longer receives may still hold past orders.
  const lateCorrection = useLateCorrectionServed() === true && holdsReceivePermission(facility, 'lab')
  const cannotServed = useCannotCompleteServed()
  // An order ended as accepted for the wrong person, or an ended one withdrawn: said until closed; the list is read again.
  const [ended, setEnded] = useState<Said | null>(null)
  // Orders ended because this laboratory couldn't complete them: one entry each, newest first, until closed.
  const notCompleted = useNotCompletedEndings(facilityId)
  const said = useRowSaid('lab', read.value, list.refresh, (mode, route) => mode === 'wrong_patient'
    ? wrongPatientOffered(route, permissions, 'lab') : cannotCompleteOffered(route, permissions, 'lab', cannotServed))
  const [search, setSearch] = useState('')
  // The facility's payment setup (POINT_OF_CARE_SPEC §1): whether a bill is paid before the sample is taken. Off (404)
  // or unread, nothing waits for payment, as today.
  const paymentSettings = usePaymentSettings(canRead ? facilityId : undefined)
  const settings = paymentSettings.status === 'ready' ? paymentSettings.data : null
  const navigate = useNavigate()
  const location = useLocation()
  // Leaving a record (its Back, or the browser's) puts focus back on its row, once the list shows again.
  const lastWork = useRef(workId)
  useLayoutEffect(() => {
    const was = lastWork.current
    lastWork.current = workId
    if (was && !workId) focus(`lab-${was}-record`, true)
  }, [workId, focus])
  // Work named in the address that the list no longer holds (it ended, or the address is old): back to the list.
  const stale = Boolean(workId && list.items !== null && !chosen)
  useLayoutEffect(() => {
    if (stale) setParams(previous => { const next = new URLSearchParams(previous); next.delete(WORK_PARAM); return next }, { replace: true })
  }, [stale, setParams])
  if (!facilityId || !canRead) return <DeptUnavailable title="Laboratory"
    message="You can’t open Laboratory here. Your role needs permission to see lab work." />
  const workFacility = facilityId
  /** Opens or closes the work in the address: a new history entry, so the browser's Back returns to the list. */
  function show(id: string | null, replace = false) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (id) next.set(WORK_PARAM, id)
      else next.delete(WORK_PARAM)
      return next
    }, { replace, state: id ? { fromQueue: true } : undefined })
  }
  function open(item: LabWorkItem) {
    setSelection({ facilityId: workFacility, item })
    show(item.id)
    focus('lab-record-title')
  }
  function back(item: LabWorkItem) {
    setSelection(null)
    // Opened from the list: step back in history, so the browser's Back doesn't reopen it. Else (a shared address) replace.
    if ((location.state as { fromQueue?: unknown } | null)?.fromQueue === true) navigate(-1)
    else show(null, true)
    focus(`lab-${item.id}-record`, true)
  }
  function endedHere(item: LabWorkItem, ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    said.clear()
    if (workId === item.id) { setSelection(null); show(null, true) }
    void list.refresh()
  }
  // Ended from "Correct an order that has ended" while still open: its record, if open, goes too.
  function endedLate(ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    if (current?.orderRoute?.id === ending.result.route.id) { setSelection(null); show(null, true) }
    void list.refresh()
  }
  // Ended because it can't be completed. The page goes back to the list, where the ending is said and takes focus; an
  // order whose reads were kept stays listed and can be opened again.
  function notCompletedHere(ending: Omit<CannotCompleteEnding, 'key'>) {
    notCompleted.add(ending)
    said.clear()
    if (current?.orderRoute?.id === ending.result.route.id) { setSelection(null); show(null, true) }
    void list.refresh()
  }
  const items = list.items ? notCompleted.shown(list.items) : []
  // Stat and urgent work first, so it is seen first.
  const rows = urgentFirst(items.filter(item => matchesSearch(search, [workTitle(item), item.accessionNumber, patientLabel(item),
    item.patient?.fullName, workStatus(item), item.priority, item.orderRoute?.orderingFacilityName, item.orderRoute?.reference])), item => item.priority)
  const detail = current
  return <div className="hid-ehr-dept-laboratory">
    {detail && <WorkRecord facilityId={workFacility} item={detail} accessionId={selected?.accessionId || detail.accessionId}
      accessionNumber={selected?.accessionNumber || detail.accessionNumber} created={extra?.created} permissions={permissions} routed={Boolean(selectedRoute)} closed={routeClosedForWork(selectedRoute)}
      said={said.rowSaid(detail.orderRoute?.id)} onBack={() => back(detail)} onListChanged={() => void list.refresh()}
      onCreated={accession => {
        setSelection({ facilityId: workFacility, item: { ...detail, accessionId: accession.id, accessionNumber: accession.accessionNumber },
          created: `Accession ${accession.accessionNumber} created.` })
        focus('lab-accession-title', true)
        void list.refresh()
      }}
      onEnded={ending => endedHere(detail, ending)} onNotCompleted={notCompletedHere} onReread={said.reread} settings={settings} />}
    {/* The list stays mounted under a record, so orders waiting here and a lookup in progress keep their place. */}
    <div hidden={Boolean(detail)}>
      <DeptPage title="Laboratory" secondaryActions={<RefreshButton loading={list.loading} onRefresh={list.refresh}>Refresh</RefreshButton>}
        primaryAction={permissions.includes('lab.walk-in.create') ? <Button variant="primary" icon={Plus} to="/provider/laboratory/new-walk-in">New walk-in</Button> : undefined}>
        <StandaloneWorkNote facility={facility} kind="laboratory" ordersOn={read.value?.crossFacilityOrders === true} receives={receives} />
        {mounted && facility && <DeptEmbedded className="hid-ehr-dept-laboratory-embedded"><IncomingOrders service="lab" facilityId={workFacility}
          facilityName={facility.name} probe={probe} watch={watch} membershipId={facility.membershipId} onFound={onFound} onAnswer={onAnswer}
          onAccepted={() => void list.refresh()}
          onEnded={routeId => setSelection(previous => previous?.item.orderRoute?.id === routeId ? null : previous)}
          closedRouteId={notCompleted.lastRouteId} /></DeptEmbedded>}
        <SaidAboveTheList service="lab" said={ended} facilityId={workFacility} onClose={() => setEnded(null)} />
        {notCompleted.endings.length > 0 && <DeptEmbedded>
          <CannotCompleteEndings service="lab" endings={notCompleted.endings} onClose={notCompleted.close} />
        </DeptEmbedded>}
        {lateCorrection && <DeptEmbedded><LateWrongPatient service="lab" facilityId={workFacility} onEnded={endedLate}
          onNotCompleted={notCompletedHere}
          onCorrected={correction => { notCompleted.corrected(correction); setEnded({ facilityId: workFacility, correction }) }} /></DeptEmbedded>}
        <RoutedWorkPaused items={list.items} crossFacilityWork={read.value?.crossFacilityWork} receives={holds} />
        <WorkListCap count={list.items?.length ?? 0}>{cannotServed === true && lateCorrection
          && <DeptNotice>{CAP_CANNOT_COMPLETE}</DeptNotice>}</WorkListCap>
        <SaidAboveList id="lab-said" text={said.listSaid} />
        <DeptSearch label="Search Laboratory" value={search} onChange={setSearch}>
          {list.error && <DeptNotice tone="critical" role="alert">{list.error}</DeptNotice>}
          {list.loading && !list.items?.length && <EhrSkeleton label="Loading lab work…" />}
          {!list.loading && !list.error && !list.items?.length && <EhrEmptyState title="No lab work yet"
            message="Lab orders accepted here show in this list. Refresh to check for new work."
            action={<EhrButton variant="secondary" onClick={() => void list.refresh()}>Refresh</EhrButton>} />}
          {items.length > 0 && rows.length === 0 && <EhrEmptyState title="No matching work" message="Change your search." />}
          {rows.length > 0 && <WorkQueue label="Lab work" titleHeader="Test" rows={rows.map(item => {
            const rowSaid = detail ? null : said.rowSaid(item.orderRoute?.id)
            return {
              id: item.id,
              buttonId: `lab-${item.id}-record`,
              title: workTitle(item),
              detail: item.accessionNumber ? `Accession ${item.accessionNumber}` : undefined,
              // The name and date of birth to match a sample to a person, when Lab sends them; else its masked reference.
              patient: <QueuePatient patient={item.patient} fallback={patientLabel(item)} />,
              priority: item.priority,
              status: workStatus(item),
              // The bill, from a backend that sends bills on the work (POINT_OF_CARE_SPEC §3): Paid, Unpaid ₦x, Bill follows.
              flag: billOf(item) !== undefined ? <BillBadge bill={billOf(item)} /> : undefined,
              when: dateText(item.acceptedAt),
              onOpen: () => open(item),
              below: item.orderRoute ? <>
                {rowSaid && item.orderRoute && <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{rowSaid}</DeptNotice>}
                <RoutedWorkLines route={item.orderRoute} />
              </> : undefined,
            }
          })} />}
        </DeptSearch>
      </DeptPage>
    </div>
  </div>
}

/**
 * One piece of lab work, opened from the list: what is known of it, what can be done on it (create its accession, end
 * an order from another facility as not the order's patient or as one this laboratory can't complete), and its
 * accession. On work from another facility it checks that the person is the patient before a sample is taken, leaves
 * out "Create accession" once the services would refuse it as closed, and offers the endings while the order may still
 * be worked. What an ending's refusal said stays here when the list read again no longer offers the form (`said`).
 */
function WorkRecord({ facilityId, item, accessionId, accessionNumber, created, permissions, routed, closed, said, onBack, onListChanged, onCreated, onEnded,
  onNotCompleted, onReread, settings }: {
  readonly facilityId: string; readonly item: LabWorkItem; readonly accessionId: string | null | undefined
  readonly accessionNumber: string | null | undefined; readonly created?: string
  readonly permissions: readonly string[]; readonly routed: boolean; readonly closed: boolean; readonly said: string | null
  readonly onBack: () => void; readonly onListChanged: () => void; readonly onCreated: (accession: LabAccession) => void
  readonly onEnded: (ending: WrongPatientEnding) => void
  readonly onNotCompleted: (ending: Omit<CannotCompleteEnding, 'key'>) => void
  readonly onReread: (routeId: string, mode: OrderEndingMode, said?: string) => Promise<void>
  /** The facility's payment setup, or null (unread, or payments not switched on: nothing waits for payment). */
  readonly settings: PaymentSettings | null
}) {
  const route = item.orderRoute
  // Payment first (POINT_OF_CARE_SPEC §3): creating the accession and collecting the sample wait for the bill to be paid
  // or set to follow; the payment step stands in their place.
  const [cleared, setCleared] = useState<NonNullable<WorkItemBill> | null>(null)
  const bill = cleared ?? billOf(item)
  const samples = permissions.includes('lab.accession.create') || permissions.includes('lab.specimen.collect')
  const waitsForPayment = samples && !routeClosedForWork(route) && paysFirst(settings, 'lab') && billOwing(bill)
  const outside = outsideOf(item)
  const title = workTitle(item)
  const prepare = !accessionId && permissions.includes('lab.accession.create') && !routeClosedForWork(route) && !waitsForPayment
  const ordering = route?.orderingFacilityName ?? 'The ordering facility'
  const cannotComplete = cannotCompleteOffered(route, permissions, 'lab', useCannotCompleteServed())
  const [preparing, setPreparing] = useState(false)
  const focus = useFocusById()
  return <DeptPage title={<span id="lab-record-title" tabIndex={-1}>{title}</span>} onBack={onBack}>
    <DeptContextLine status={statusTitle(workStatus(item))} items={[`Accepted ${dateText(item.acceptedAt)}`]} />
    {/* Who the sample is for, in the same place on every record. */}
    {subjectOf(item).banner}
    {said && route && <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{said}</DeptNotice>}
    {route && <div className="hid-ehr-dept-laboratory-routed"><RoutedWorkLines route={route} /></div>}
    {waitsForPayment && bill && settings && <PaymentStep facilityId={facilityId} summary={bill} settings={settings}
      permissions={permissions} subject={subjectOf(item).banner} verb="take the sample" headingId={`lab-${item.id}-payment`}
      onCleared={summary => { setCleared(summary); focus(accessionId ? `lab-accession-title` : 'lab-record-title', true) }} />}
    {cleared && <PaidLine summary={cleared} />}
    {bill !== undefined && !waitsForPayment && !cleared ? <div className="flex items-center gap-2 text-[14px] text-ink-2">Bill: <BillBadge bill={bill} /></div> : null}
    <DeptRecordLayout
      main={<DeptSection title="Request"><DeptFacts facts={workFacts({ ...item, accessionNumber })} /></DeptSection>}
      aside={<LabActions none={!prepare && !(waitsForPayment && !accessionId) && !wrongPatientOffered(route, permissions, 'lab')}>
        {waitsForPayment && !accessionId && <DeptNotice tone="caution">Payment first. Once it is paid or set to follow, create the accession and take the sample.</DeptNotice>}
        {prepare && route && item.patient && <DeptNotice>{sampleCheckText(item.patient.fullName)}</DeptNotice>}
        {prepare && <LabActionButton open={preparing} onToggle={() => setPreparing(value => !value)}>Create accession</LabActionButton>}
        {wrongPatientOffered(route, permissions, 'lab') && <DeptEmbedded className="hid-ehr-dept-laboratory-endings">
          <OrderEndingActions base={`lab-${item.id}`} service="lab"
            facilityId={facilityId} route={{ id: route.id, version: route.version, reference: route.reference }} title={title}
            patient={item.patient?.fullName ?? null} ordering={ordering}
            cannotComplete={cannotComplete ? { priority: item.priority ?? null, accession: Boolean(item.accessionId),
              acceptedAt: item.acceptedAt ?? null, specimenStatuses: Array.isArray(item.specimenStatuses) ? item.specimenStatuses : [] }
              : null}
            onReread={(mode, text) => onReread(route.id, mode, text)}
            onWrongPatientEnded={result => onEnded({ service: 'lab', title, reference: route.reference,
              patient: item.patient?.fullName ?? null, ordering, result, dateOfBirthOnly: false })}
            onNotCompleted={(result, reason) => onNotCompleted({ service: 'lab', title, reference: route.reference,
              patient: item.patient?.fullName ?? null, ordering, reason, priority: item.priority ?? null, result })} />
        </DeptEmbedded>}
        {prepare && preparing && <AccessionForm facilityId={facilityId} item={item} subject={subjectOf(item)} onCreated={accession => { setPreparing(false); onCreated(accession) }} />}
      </LabActions>}
    />
    {accessionId && permissions.includes('lab.accession.read') && <AccessionView key={`${facilityId}-${accessionId}`} facilityId={facilityId}
      id={accessionId} permissions={permissions} created={created} routed={routed} closed={closed} subject={subjectOf(item)} onChanged={onListChanged}
      collectBlocked={waitsForPayment} share={outside ? { email: outside.prescriberEmail, doctor: outside.prescriberName } : null} />}
  </DeptPage>
}
