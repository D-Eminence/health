import { useCallback, useMemo, useState } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrEmptyState, EhrSkeleton, type EhrDataTableColumn } from '@hid/ui/ehr'
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
import { DeptContextLine, DeptFacts, DeptLinkButton, DeptRecordLayout, DeptRecordName, type DeptFact } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { MODULE_NOT_IN_SERVICE } from '../parts/errors'
import { dateText, matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, RoutedWorkLines, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed, useNotCompletedEndings,
  useReceiving, useRowSaid, WorkListCap, type Said,
  sameShownPatient,
} from '../parts/routedWork'
import { AccessionForm, AccessionView } from './accession'
import { LabActionButton, LabActions, LabSlots, SAVED_TITLE_ID, statusWord, type LabOffer } from './labParts'
import './laboratory.css'

/*
 * Laboratory in the blue Hospital EHR: the target's list (search and a table of lab work with Quick view and Open, first
 * under the heading, then orders from other facilities and what was said about them) and record view (Saved record
 * holding the accession and its samples, one Available actions card, Connected hospital history, then each result's
 * preserved versions). What the page reads, writes and refuses is today's Laboratory page's
 * (staff/routes/Operations.tsx Laboratory): its work list, orders from other facilities, the wrong-patient and
 * can't-complete endings, the late correction, the accession and every step on it.
 */

/** The list's heading, and its Refresh after a failed read and on the empty list: where focus goes once it is read again. */
const LIST_TITLE_ID = 'lab-list-title'
const LIST_RETRY_ID = 'lab-list-retry'
const LIST_EMPTY_REFRESH_ID = 'lab-list-empty-refresh'

/** A work item's name, as its row and record show it. */
function workTitle(item: LabWorkItem) {
  return item.testName ?? 'Lab test'
}

/** A work item's status in the target's words: accessioned once it has an accession, else Lab's own status. */
function workStatus(item: LabWorkItem) {
  return item.accessionId ? 'accessioned' : statusWord(item.status)
}

/**
 * What is known of a work item, for its Saved record and its quick view. `accessionShown`: the record shows the
 * accession (AccessionView), whose "Accession number" stands in for the work's own "Accession", while it is read too.
 */
function workFacts(item: LabWorkItem, accessionShown = false): DeptFact[] {
  const route = item.orderRoute
  return [
    { label: 'Test', value: workTitle(item) },
    { label: 'Patient', value: patientLabel(item) },
    ...(item.priority ? [{ label: 'Urgency', value: (word => word.charAt(0).toUpperCase() + word.slice(1))(statusWord(item.priority)) }] : []),
    { label: 'Accepted', value: dateText(item.acceptedAt) },
    ...(route ? [{ label: 'Ordering facility', value: route.orderingFacilityName ?? 'Not available' }] : []),
    ...(route?.reference ? [{ label: 'Reference', value: route.reference }] : []),
    ...(route?.ordererName ? [{ label: 'Ordered by', value: route.ordererName
      + (route.ordererLicence ? ` · ${licenceLine(route.ordererLicence.body, route.ordererLicence.number)}` : '') }] : []),
    ...(accessionShown ? [] : [{ label: 'Accession', value: item.accessionNumber ?? 'Not created yet' }]),
    { label: 'Status', value: workStatus(item) },
  ]
}

export function Laboratory() {
  const { facilityId, permissions, facility } = useDeptAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const read = useFacilityRead(facilityId, canRead, useCallback((id: string) => staffApi.labWorkItems(id), []))
  const list = { ...read, items: read.value ? read.value.items : null }
  const [selection, setSelection] = useState<{ facilityId: string; item: LabWorkItem; created?: string } | null>(null)
  // The chosen work, only while the list still holds it: work that has left the list (an order ended, here or elsewhere)
  // never shows its accession or its patient again, even once other work is listed.
  const selected = selection && selection.facilityId === facilityId
    && (list.items === null || list.items.some(item => item.id === selection.item.id)) ? selection.item : null
  // The chosen work as the list now has it: its order may have ended since it was chosen.
  const current = selected && (list.items?.find(item => item.id === selected.id) || selected)
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
  const [quickId, setQuickId] = useState<string | null>(null)
  if (!facilityId || !canRead) return <DeptUnavailable title="Laboratory"
    message="Permission denied. This facility membership cannot open Laboratory: it needs permission to read lab work." />
  const workFacility = facilityId
  // The list's Refresh after a failed read, and the empty list's, go while the list is read: focus comes back to either
  // if it is shown again, else to the list's heading, only if it was lost.
  async function reread() {
    await list.refresh()
    focus([LIST_RETRY_ID, LIST_EMPTY_REFRESH_ID, LIST_TITLE_ID], true)
  }
  function open(item: LabWorkItem) {
    setQuickId(null)
    setSelection({ facilityId: workFacility, item })
    focus('lab-record-title')
  }
  function back(item: LabWorkItem) {
    setSelection(null)
    focus(`lab-${item.id}-record`)
  }
  function endedHere(item: LabWorkItem, ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    said.clear()
    if (selection?.item.id === item.id) setSelection(null)
    void list.refresh()
  }
  // Ended from "Correct an order that has ended" while still open: its record, if open, goes too.
  function endedLate(ending: WrongPatientEnding) {
    setEnded({ facilityId: workFacility, ending })
    setSelection(previous => previous?.item.orderRoute?.id === ending.result.route.id ? null : previous)
    void list.refresh()
  }
  // Ended because it can't be completed. The page goes back to the list, where the ending is said and takes focus; an
  // order whose reads were kept stays listed and can be opened again.
  function notCompletedHere(ending: Omit<CannotCompleteEnding, 'key'>) {
    notCompleted.add(ending)
    said.clear()
    setSelection(previous => previous?.item.orderRoute?.id === ending.result.route.id ? null : previous)
    void list.refresh()
  }
  const items = list.items ? notCompleted.shown(list.items) : []
  const rows = items.filter(item => matchesSearch(search, [workTitle(item), item.accessionNumber, patientLabel(item), workStatus(item),
    item.orderRoute?.orderingFacilityName, item.orderRoute?.reference]))
  const detail = current
  const quick = quickId ? items.find(item => item.id === quickId) ?? null : null
  const columns: EhrDataTableColumn<LabWorkItem>[] = [
    { id: 'record', header: 'Record', cell: item => <DeptRecordName id={`lab-${item.id}-record`} name={workTitle(item)}
      reference={item.accessionNumber ?? item.id.slice(0, 8)} onOpen={() => open(item)} /> },
    { id: 'patient', header: 'Patient / context', cell: item => {
      const rowSaid = detail ? null : said.rowSaid(item.orderRoute?.id)
      return <div className="hid-ehr-dept-laboratory-cell">
        {rowSaid && item.orderRoute && <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{rowSaid}</DeptNotice>}
        <span>{patientLabel(item)}</span>
        <RoutedWorkLines route={item.orderRoute} />
      </div>
    } },
    { id: 'status', header: 'Status', cell: item => <EhrBadge>{workStatus(item)}</EhrBadge> },
    { id: 'updated', header: 'Updated', cell: item => <span className="hid-ehr-dept-nowrap">{dateText(item.acceptedAt)}</span> },
    { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: item => <div className="hid-ehr-dept-table-actions">
      <EhrButton variant="secondary" aria-describedby={`lab-${item.id}-record`} onClick={() => setQuickId(item.id)}>Quick view</EhrButton>
      <DeptLinkButton describedBy={`lab-${item.id}-record`} onClick={() => open(item)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
    </div> },
  ]
  return <div className="hid-ehr-dept-laboratory">
    {detail && <WorkRecord key={detail.id} facilityId={workFacility} item={detail} accessionId={selected?.accessionId || detail.accessionId}
      accessionNumber={selected?.accessionNumber || detail.accessionNumber} created={selection?.created} permissions={permissions} routed={Boolean(selectedRoute)} closed={routeClosedForWork(selectedRoute)}
      said={said.rowSaid(detail.orderRoute?.id)} onBack={() => back(detail)} onListChanged={() => void list.refresh()}
      onCreated={accession => {
        setSelection({ facilityId: workFacility, item: { ...detail, accessionId: accession.id, accessionNumber: accession.accessionNumber },
          created: `Accession ${accession.accessionNumber} created.` })
        focus(SAVED_TITLE_ID, true)
        void list.refresh()
      }}
      onEnded={ending => endedHere(detail, ending)} onNotCompleted={notCompletedHere} onReread={said.reread}
      related={items.filter(other => other.id !== detail.id && sameShownPatient(other, detail))} onOpen={open} />}
    {/* The list stays mounted under a record, so orders waiting here and a lookup in progress keep their place. */}
    <div hidden={Boolean(detail)}>
      <DeptPage title={<span id={LIST_TITLE_ID} tabIndex={-1}>Laboratory</span>}>
        <DeptSearch label="Search Laboratory" value={search} onChange={setSearch}>
          {list.error && <DeptNotice tone="critical" role="alert">{list.error}</DeptNotice>}
          {/* The list's own retry once its read failed: the page has no other way to read it again, unless the module is off. */}
          {list.error && list.error !== MODULE_NOT_IN_SERVICE && <div className="hid-ehr-dept-form-actions">
            <EhrButton id={LIST_RETRY_ID} variant="secondary" onClick={() => void reread()}>Refresh</EhrButton></div>}
          {list.loading && !list.items?.length && <EhrSkeleton label="Loading lab work…" />}
          {!list.loading && !list.error && !list.items?.length && <EhrEmptyState title="No lab work yet"
            message="Accepted lab orders for this facility appear here. Refresh to check for new work."
            action={<EhrButton id={LIST_EMPTY_REFRESH_ID} variant="secondary" onClick={() => void reread()}>Refresh</EhrButton>} />}
          {items.length > 0 && <EhrDataTable caption="Lab work" captionHidden columns={columns} rows={rows} rowKey={item => item.id}
            emptyTitle="No matching records" emptyMessage="Change your search." />}
        </DeptSearch>
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
      </DeptPage>
      <EhrDrawer open={Boolean(quick)} title="Record quick view" onClose={() => setQuickId(null)}>
        {quick && <div className="hid-ehr-dept-laboratory-quick">
          <h3>{workTitle(quick)}</h3>
          <p>Accepted {dateText(quick.acceptedAt)}</p>
          <DeptFacts facts={workFacts(quick)} />
          <RoutedWorkLines route={quick.orderRoute} />
          <div><EhrButton onClick={() => open(quick)}>Open full record</EhrButton></div>
        </div>}
      </EhrDrawer>
    </div>
  </div>
}

/**
 * One piece of lab work, opened from the list: what is known of it with its accession (Saved record), what can be done
 * on it in one card (create its accession, the accession's sample, processing and result steps, end an order from
 * another facility as not the order's patient or as one this laboratory can't complete), the patient's other work
 * listed here (Connected hospital history), then each result's preserved versions. On work from another facility it
 * checks that the person is the patient before a sample is taken, leaves out "Create accession" once the services would
 * refuse it as closed, and offers the endings while the order may still be worked. What an ending's refusal said stays
 * here when the list read again no longer offers the form (`said`).
 */
function WorkRecord({ facilityId, item, accessionId, accessionNumber, created, permissions, routed, closed, said, related, onBack, onListChanged,
  onCreated, onEnded, onNotCompleted, onReread, onOpen }: {
  readonly facilityId: string; readonly item: LabWorkItem; readonly accessionId: string | null | undefined
  readonly accessionNumber: string | null | undefined; readonly created?: string
  readonly permissions: readonly string[]; readonly routed: boolean; readonly closed: boolean; readonly said: string | null
  /** The other work on the list for the same patient. */
  readonly related: readonly LabWorkItem[]
  readonly onBack: () => void; readonly onListChanged: () => void; readonly onCreated: (accession: LabAccession) => void
  readonly onEnded: (ending: WrongPatientEnding) => void
  readonly onNotCompleted: (ending: Omit<CannotCompleteEnding, 'key'>) => void
  readonly onReread: (routeId: string, mode: OrderEndingMode, said?: string) => Promise<void>
  readonly onOpen: (item: LabWorkItem) => void
}) {
  const route = item.orderRoute
  const title = workTitle(item)
  const prepare = !accessionId && permissions.includes('lab.accession.create') && !routeClosedForWork(route)
  const ordering = route?.orderingFacilityName ?? 'The ordering facility'
  const cannotComplete = cannotCompleteOffered(route, permissions, 'lab', useCannotCompleteServed())
  const ends = wrongPatientOffered(route, permissions, 'lab')
  const [preparing, setPreparing] = useState(false)
  // Where the accession draws its actions (in this record's one actions card) and its results' versions (after
  // Connected hospital history), and what it offers in that card.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
  const [historySlot, setHistorySlot] = useState<HTMLDivElement | null>(null)
  const slots = useMemo(() => ({ actions: actionsSlot, history: historySlot }), [actionsSlot, historySlot])
  const [accessionOffer, setAccessionOffer] = useState<LabOffer>('unsettled')
  const shownAccessionId = accessionId && permissions.includes('lab.accession.read') ? accessionId : null
  return <DeptPage title={<span id="lab-record-title" tabIndex={-1}>{title}</span>} onBack={onBack}>
    <DeptContextLine status={workStatus(item)} items={[`${patientLabel(item)} · ${item.accessionNumber ?? item.id.slice(0, 8)}`, `Accepted ${dateText(item.acceptedAt)}`]} />
    {said && route && <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{said}</DeptNotice>}
    {route && <div className="hid-ehr-dept-laboratory-routed"><RoutedWorkLines route={route} /></div>}
    <LabSlots.Provider value={slots}>
      <DeptRecordLayout
        main={<DeptSection title="Saved record" headingId={SAVED_TITLE_ID}>
          <DeptFacts facts={workFacts({ ...item, accessionNumber }, Boolean(shownAccessionId))} />
          {shownAccessionId && <AccessionView key={`${facilityId}-${shownAccessionId}`} facilityId={facilityId} id={shownAccessionId}
            number={accessionNumber} permissions={permissions}
            created={created} routed={routed} closed={closed} onChanged={onListChanged} onOffer={setAccessionOffer} />}
        </DeptSection>}
        aside={<LabActions none={!prepare && !ends && (!shownAccessionId || accessionOffer === 'none')}>
          {prepare && route && item.patient && <DeptNotice>{sampleCheckText(item.patient.fullName)}</DeptNotice>}
          {prepare && <LabActionButton open={preparing} onToggle={() => setPreparing(value => !value)}>Create accession</LabActionButton>}
          <div ref={setActionsSlot} className="hid-ehr-dept-laboratory-slot" />
          {ends && <DeptEmbedded className="hid-ehr-dept-laboratory-endings">
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
          {prepare && preparing && <AccessionForm facilityId={facilityId} item={item} onCreated={accession => { setPreparing(false); onCreated(accession) }} />}
        </LabActions>}
      />
    </LabSlots.Provider>
    <DeptSection title="Connected hospital history">
      <p>Only records available to your current permissions are listed.</p>
      {related.length > 0 && <ul className="hid-ehr-dept-rows hid-ehr-dept-laboratory-connected">
        {related.map(other => <li key={other.id}>
          <DeptLinkButton onClick={() => onOpen(other)}>{workTitle(other)} · {other.accessionNumber ?? other.id.slice(0, 8)}</DeptLinkButton>
          <EhrBadge>{workStatus(other)}</EhrBadge>
        </li>)}
      </ul>}
    </DeptSection>
    <div ref={setHistorySlot} className="hid-ehr-dept-laboratory-history" />
  </DeptPage>
}
