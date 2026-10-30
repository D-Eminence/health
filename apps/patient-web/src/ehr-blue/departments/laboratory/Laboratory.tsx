import { useCallback, useState } from 'react'
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
import { dateText, matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, RefreshButton, RoutedWorkLines, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed, useNotCompletedEndings,
  useReceiving, useRowSaid, WorkListCap, type Said,
} from '../parts/routedWork'
import { AccessionForm, AccessionView } from './accession'
import { LabActionButton, LabActions, statusWord } from './labParts'

/*
 * Laboratory in the blue Hospital EHR: the target's list (search, a table of lab work with Quick view and Open) and
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

/** What is known of a work item, for its Saved record and its quick view. */
function workFacts(item: LabWorkItem): DeptFact[] {
  const route = item.orderRoute
  return [
    { label: 'Test', value: workTitle(item) },
    { label: 'Patient', value: patientLabel(item) },
    ...(item.priority ? [{ label: 'Priority', value: statusWord(item.priority) }] : []),
    { label: 'Accepted', value: dateText(item.acceptedAt) },
    ...(route ? [{ label: 'Ordering facility', value: route.orderingFacilityName ?? 'Not available' }] : []),
    ...(route?.reference ? [{ label: 'Reference', value: route.reference }] : []),
    ...(route?.ordererName ? [{ label: 'Ordered by', value: route.ordererName
      + (route.ordererLicence ? ` · ${licenceLine(route.ordererLicence.body, route.ordererLicence.number)}` : '') }] : []),
    { label: 'Accession', value: item.accessionNumber ?? 'Not created yet' },
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
    { id: 'updated', header: 'Updated', cell: item => dateText(item.acceptedAt) },
    { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: item => <div className="hid-ehr-dept-table-actions">
      <EhrButton variant="secondary" size="sm" aria-describedby={`lab-${item.id}-record`} onClick={() => setQuickId(item.id)}>Quick view</EhrButton>
      <DeptLinkButton describedBy={`lab-${item.id}-record`} onClick={() => open(item)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
    </div> },
  ]
  return <div className="hid-ehr-dept-laboratory">
    {detail && <WorkRecord facilityId={workFacility} item={detail} accessionId={selected?.accessionId || detail.accessionId}
      accessionNumber={selected?.accessionNumber || detail.accessionNumber} created={selection?.created} permissions={permissions} routed={Boolean(selectedRoute)} closed={routeClosedForWork(selectedRoute)}
      said={said.rowSaid(detail.orderRoute?.id)} onBack={() => back(detail)} onListChanged={() => void list.refresh()}
      onCreated={accession => {
        setSelection({ facilityId: workFacility, item: { ...detail, accessionId: accession.id, accessionNumber: accession.accessionNumber },
          created: `Accession ${accession.accessionNumber} created.` })
        focus('lab-accession-title', true)
        void list.refresh()
      }}
      onEnded={ending => endedHere(detail, ending)} onNotCompleted={notCompletedHere} onReread={said.reread} />}
    {/* The list stays mounted under a record, so orders waiting here and a lookup in progress keep their place. */}
    <div hidden={Boolean(detail)}>
      <DeptPage title="Laboratory" primaryAction={<RefreshButton loading={list.loading} onRefresh={list.refresh}>Refresh list</RefreshButton>}>
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
            message="Accepted lab orders for this facility appear here. Refresh to check for new work."
            action={<EhrButton variant="secondary" onClick={() => void list.refresh()}>Refresh</EhrButton>} />}
          {items.length > 0 && <EhrDataTable caption="Lab work" captionHidden columns={columns} rows={rows} rowKey={item => item.id}
            emptyTitle="No matching records" emptyMessage="Change your search." />}
        </DeptSearch>
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
 * One piece of lab work, opened from the list: what is known of it, what can be done on it (create its accession, end
 * an order from another facility as not the order's patient or as one this laboratory can't complete), and its
 * accession. On work from another facility it checks that the person is the patient before a sample is taken, leaves
 * out "Create accession" once the services would refuse it as closed, and offers the endings while the order may still
 * be worked. What an ending's refusal said stays here when the list read again no longer offers the form (`said`).
 */
function WorkRecord({ facilityId, item, accessionId, accessionNumber, created, permissions, routed, closed, said, onBack, onListChanged, onCreated, onEnded,
  onNotCompleted, onReread }: {
  readonly facilityId: string; readonly item: LabWorkItem; readonly accessionId: string | null | undefined
  readonly accessionNumber: string | null | undefined; readonly created?: string
  readonly permissions: readonly string[]; readonly routed: boolean; readonly closed: boolean; readonly said: string | null
  readonly onBack: () => void; readonly onListChanged: () => void; readonly onCreated: (accession: LabAccession) => void
  readonly onEnded: (ending: WrongPatientEnding) => void
  readonly onNotCompleted: (ending: Omit<CannotCompleteEnding, 'key'>) => void
  readonly onReread: (routeId: string, mode: OrderEndingMode, said?: string) => Promise<void>
}) {
  const route = item.orderRoute
  const title = workTitle(item)
  const prepare = !accessionId && permissions.includes('lab.accession.create') && !routeClosedForWork(route)
  const ordering = route?.orderingFacilityName ?? 'The ordering facility'
  const cannotComplete = cannotCompleteOffered(route, permissions, 'lab', useCannotCompleteServed())
  const [preparing, setPreparing] = useState(false)
  return <DeptPage title={<span id="lab-record-title" tabIndex={-1}>{title}</span>} onBack={onBack}>
    <DeptContextLine status={workStatus(item)} items={[patientLabel(item), `Accepted ${dateText(item.acceptedAt)}`]} />
    {said && route && <DeptNotice id={`lab-${item.id}-said`} tone="critical" role="alert" tabIndex={-1}>{said}</DeptNotice>}
    {route && <div className="hid-ehr-dept-laboratory-routed"><RoutedWorkLines route={route} /></div>}
    <DeptRecordLayout
      main={<DeptSection title="Saved record"><DeptFacts facts={workFacts({ ...item, accessionNumber })} /></DeptSection>}
      aside={<LabActions none={!prepare && !wrongPatientOffered(route, permissions, 'lab')}>
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
        {prepare && preparing && <AccessionForm facilityId={facilityId} item={item} onCreated={accession => { setPreparing(false); onCreated(accession) }} />}
      </LabActions>}
    />
    {accessionId && permissions.includes('lab.accession.read') && <AccessionView key={`${facilityId}-${accessionId}`} facilityId={facilityId}
      id={accessionId} permissions={permissions} created={created} routed={routed} closed={closed} onChanged={onListChanged} />}
  </DeptPage>
}
