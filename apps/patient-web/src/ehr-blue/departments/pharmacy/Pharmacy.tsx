import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrEmptyState, EhrSkeleton, type EhrDataTableColumn } from '@hid/ui/ehr'
import { staffApi, type PharmacyWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { cannotCompleteOffered, holdsReceivePermission, wrongPatientOffered } from '../../../staff/orderRoutes'
import { IncomingOrders } from '../../../staff/routes/IncomingOrders'
import { LateWrongPatient } from '../../../staff/routes/LateWrongPatient'
import { CannotCompleteEndings, type CannotCompleteEnding } from '../../../staff/routes/CannotComplete'
import type { WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { useCannotCompleteServed } from '../../../cannotCompleteServed'
import { useLateCorrectionServed } from '../../../lateCorrectionServed'
import { useDeptAccess } from '../parts/access'
import { DeptEmbedded } from '../parts/DeptEmbedded'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage } from '../parts/DeptPage'
import { DeptFacts, DeptLinkButton, DeptRecordName } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, readsKept, RefreshButton, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed,
  useNotCompletedEndings, useReceiving, useRowSaid, WORK_LIST_CAP, WorkListCap, type Said,
} from '../parts/routedWork'
import { PharmacyRecord, recordFacts } from './PharmacyRecord'
import { doseLine, matchesItem, routeAlert, statusOf, statusTone } from './pharmacyText'
import './pharmacy.css'

const LOAD_FAILED = 'Prescriptions could not be loaded. Please retry.'
/** The design's list shows 50 records a page. */
const PAGE_SIZE = 50
const HEADING = 'pharmacy-heading'

/**
 * Pharmacy in the blue Hospital EHR: the prescriptions accepted at the working facility (and, at a pharmacy that
 * receives them, prescriptions other facilities send), each opened as a record to dispense or reverse. Live on today's
 * Pharmacy API with today's checks (staff/routes/Operations.tsx Pharmacy); the screens and words are the design's.
 * The list and the record are views of this page, not routes: nothing about a record goes in the address.
 */
export function Pharmacy() {
  const { facilityId, permissions, facility } = useDeptAccess()
  const canRead = permissions.includes('pharmacy.work-item.read')
  const read = useFacilityRead(facilityId, canRead, useCallback((id: string) => staffApi.pharmacyWorkItems(id), []), LOAD_FAILED)
  const items = read.value ? read.value.items : null
  // Prescriptions other facilities send here (Novu, P4c): received by pharmacists (pharmacy.order-route.receive), and
  // only at a pharmacy: a hospital's or clinic's own pharmacy is never sent any (useReceiving).
  const { mounted, probe, watch, holds, receives, onFound, onAnswer } = useReceiving(facility, 'pharmacy', read)
  useLearnWrongPatientServed(items)
  useLearnLateCorrectionServed(read.value)
  useLearnCannotCompleteServed(read.value)
  // "Correct an order that has ended" (D17), as on the Laboratory page.
  const late = useLateCorrectionServed() === true
  const lateCorrection = late && holdsReceivePermission(facility, 'pharmacy')
  const cannotServed = useCannotCompleteServed()
  // A prescription ended as accepted for the wrong person (item 3), or an ended one withdrawn (D17): said until closed.
  const [ended, setEnded] = useState<Said | null>(null)
  // Prescriptions ended because this pharmacy couldn't complete them (D18).
  const notCompleted = useNotCompletedEndings(facilityId)
  const said = useRowSaid('pharmacy', read.value, read.refresh, (mode, route) => mode === 'wrong_patient'
    ? wrongPatientOffered(route, permissions, 'pharmacy') : cannotCompleteOffered(route, permissions, 'pharmacy', cannotServed))
  // Work Pharmacy refused to dispense (hid-system #48): known only from that refusal, kept while the work is listed.
  const [undispensable, setUndispensable] = useState<{ facilityId: string; ids: ReadonlySet<string> }>({ facilityId: '', ids: new Set() })
  const [opened, setOpened] = useState<{ facilityId: string; id: string } | null>(null)
  const [quick, setQuick] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  // A dispensing or reversal being sent from the open record: Back to list waits for its outcome.
  const [recording, setRecording] = useState(false)
  const focus = useFocusById()

  // The rows shown: an order this pharmacy couldn't complete and later withdrew as the wrong person is no longer shown.
  const visible = items ? notCompleted.shown(items) : null
  // The record open, only as the list now shows it: work that has left the list (an order ended, here or elsewhere) is
  // never shown again, even once other work is listed.
  const selected = opened && opened.facilityId === facilityId ? visible?.find(item => item.id === opened.id) ?? null : null
  const gone = Boolean(opened && (opened.facilityId !== facilityId || (visible !== null && !selected)))
  // In the commit that removes the record, so focus is never left on the page meanwhile.
  useLayoutEffect(() => {
    if (!gone) return
    setOpened(null)
    focus(HEADING, true)
  }, [gone, focus])
  useEffect(() => {
    if (!items) return
    setUndispensable(current => {
      const kept = [...current.ids].filter(id => items.some(item => item.id === id))
      return kept.length === current.ids.size ? current : { ...current, ids: new Set(kept) }
    })
  }, [items])

  if (!facilityId || !canRead) return (
    <DeptPage title="Pharmacy">
      <div className="hid-ehr-dept-pharmacy-error">Permission denied. This facility membership cannot open Pharmacy: it needs pharmacy work-item read permission.</div>
    </DeptPage>
  )
  const here = facilityId
  const notDispensable = (id: string) => undispensable.facilityId === here && undispensable.ids.has(id)

  function open(item: PharmacyWorkItem) {
    setQuick(null)
    setOpened({ facilityId: here, id: item.id })
    focus(`pharmacy-${item.id}-title`)
  }
  function back() {
    // Focusable while a request runs, but a press does nothing: the record must stay to say how it ended.
    if (recording) return
    const id = selected?.id
    setOpened(null)
    focus(id ? [`pharmacy-${id}-name`, HEADING] : HEADING)
  }
  function notCompletedHere(ending: Omit<CannotCompleteEnding, 'key'>) {
    notCompleted.add(ending)
    said.clear()
    // Where its reads ended at once, nothing of it is shown again.
    if (!readsKept(ending.result) && selected?.orderRoute?.id === ending.result.route.id) setOpened(null)
    void read.refresh()
  }
  function endedHere(ending: WrongPatientEnding) {
    said.clear()
    setEnded({ facilityId: here, ending })
    // The patient's details go at once: the record closes, and the list is read again.
    setOpened(null)
    void read.refresh()
  }

  const rows = visible ?? []
  const matching = rows.filter(item => matchesItem(search, item, statusOf(item, notDispensable(item.id))))
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shownRows = matching.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const quickItem = quick ? items?.find(item => item.id === quick) ?? null : null

  const columns: EhrDataTableColumn<PharmacyWorkItem>[] = [
    { id: 'record', header: 'Record', cell: item => {
      const text = selected ? null : said.rowSaid(item.orderRoute?.id)
      return <>
        <DeptRecordName id={`pharmacy-${item.id}-name`} name={item.medication.display} reference={item.id.slice(0, 8)} onOpen={() => open(item)} />
        {text && item.orderRoute && <p id={`pharmacy-${item.id}-said`} className="hid-ehr-dept-pharmacy-said" role="alert" tabIndex={-1}>{text}</p>}
      </>
    } },
    { id: 'patient', header: 'Patient / context', cell: item => <>
      {patientLabel(item)}
      <small className="hid-ehr-dept-reference">{doseLine(item)}</small>
      {item.orderRoute && <small className="hid-ehr-dept-reference">From {item.orderRoute.orderingFacilityName ?? 'the ordering facility'}</small>}
    </> },
    { id: 'status', header: 'Status', cell: item => {
      const status = statusOf(item, notDispensable(item.id))
      const alert = routeAlert(item.orderRoute, late)
      return <>
        <EhrBadge tone={statusTone(status)}>{status}</EhrBadge>
        {alert && <small className="hid-ehr-dept-pharmacy-alert">{alert}</small>}
      </>
    } },
    { id: 'accepted', header: 'Accepted', cell: item => dateText(item.acceptedAt) },
    { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: item => (
      <div className="hid-ehr-dept-table-actions">
        <EhrButton variant="secondary" size="sm" aria-describedby={`pharmacy-${item.id}-name`} onClick={() => setQuick(item.id)}>Quick view</EhrButton>
        <DeptLinkButton describedBy={`pharmacy-${item.id}-name`} onClick={() => open(item)}>Open<span aria-hidden="true"> →</span></DeptLinkButton>
      </div>
    ) },
  ]

  const listed = rows.length > 0
  const refresh = <RefreshButton loading={read.loading} onRefresh={read.refresh}>Refresh list</RefreshButton>
  return (
    <DeptPage title={selected ? <span id={`pharmacy-${selected.id}-title`} tabIndex={-1}>{selected.medication.display}</span>
      : <span id={HEADING} tabIndex={-1}>Pharmacy</span>}
      primaryAction={selected ? <EhrButton variant="secondary" aria-disabled={recording || undefined} onClick={back}>Back to list</EhrButton>
        : undefined} secondaryActions={refresh}>
      {read.error && <div className="hid-ehr-dept-pharmacy-error hid-ehr-dept-pharmacy-page-error" role="alert">{read.error}</div>}
      <SaidAboveTheList service="pharmacy" said={ended} facilityId={here} onClose={() => setEnded(null)} />
      {notCompleted.endings.length > 0 && <DeptEmbedded><CannotCompleteEndings service="pharmacy" endings={notCompleted.endings}
        onClose={notCompleted.close} /></DeptEmbedded>}
      <div hidden={selected !== null}>
        <StandaloneWorkNote facility={facility} kind="pharmacy" ordersOn={read.value?.crossFacilityOrders === true} receives={receives} />
        {mounted && facility && <DeptEmbedded><IncomingOrders service="pharmacy" facilityId={here} facilityName={facility.name}
          probe={probe} watch={watch} membershipId={facility.membershipId} onFound={onFound} onAnswer={onAnswer}
          onAccepted={() => void read.refresh()} closedRouteId={notCompleted.lastRouteId} /></DeptEmbedded>}
        {lateCorrection && <DeptEmbedded><LateWrongPatient service="pharmacy" facilityId={here}
          onEnded={ending => { setEnded({ facilityId: here, ending }); void read.refresh() }} onNotCompleted={notCompletedHere}
          onCorrected={correction => { notCompleted.corrected(correction); setEnded({ facilityId: here, correction }) }} /></DeptEmbedded>}
        <RoutedWorkPaused items={items} crossFacilityWork={read.value?.crossFacilityWork} receives={holds} />
        {/* hid-system #48: work whose prescription changed stays listed as accepted. */}
        <WorkListCap count={items?.length ?? 0}><DeptNotice>Work whose prescription changed after Pharmacy accepted it can’t be
          dispensed, but it stays listed and counts toward these {WORK_LIST_CAP}.</DeptNotice>
          {cannotServed === true && lateCorrection && <DeptNotice>{CAP_CANNOT_COMPLETE}</DeptNotice>}</WorkListCap>
        <SaidAboveList id="pharmacy-said" text={said.listSaid} />
        <DeptSearch label="Search Pharmacy" value={search} onChange={value => { setSearch(value); setPage(0) }}
          filters={search ? <div className="hid-ehr-dept-pharmacy-clear"><EhrButton variant="secondary" onClick={() => { setSearch(''); setPage(0) }}>
            Clear search</EhrButton></div> : undefined}>
          {matching.length > PAGE_SIZE && <nav className="hid-ehr-dept-toolbar" aria-label="Record pages">
            <EhrButton variant="secondary" size="sm" aria-disabled={current === 0 || undefined}
              onClick={() => { if (current > 0) setPage(current - 1) }}>Previous page</EhrButton>
            <span className="hid-ehr-dept-toolbar-note">Page {current + 1} of {pages}</span>
            <EhrButton variant="secondary" size="sm" aria-disabled={current + 1 >= pages || undefined}
              onClick={() => { if (current + 1 < pages) setPage(current + 1) }}>Next page</EhrButton>
          </nav>}
          {read.loading && !listed ? <EhrSkeleton label="Loading prescriptions" />
            : listed && matching.length > 0 ? <EhrDataTable caption="Prescriptions" captionHidden columns={columns} rows={shownRows} rowKey={item => item.id} />
              : listed ? <EhrEmptyState title="No matching records" message="Change your search." />
                : !read.error ? <EhrEmptyState title="No matching records" message="Prescriptions appear here once they are accepted." /> : null}
        </DeptSearch>
        <EhrDrawer open={quickItem !== null} title="Record quick view" onClose={() => setQuick(null)}>
          {quickItem && <div className="hid-ehr-dept-pharmacy-quick">
            <h3>{quickItem.medication.display}</h3>
            <p>Accepted {dateText(quickItem.acceptedAt)}</p>
            <DeptFacts facts={recordFacts(quickItem, statusOf(quickItem, notDispensable(quickItem.id)), true)} />
            <EhrButton onClick={() => open(quickItem)}>Open full record</EhrButton>
          </div>}
        </EhrDrawer>
      </div>
      {selected && <PharmacyRecord key={selected.id} facilityId={here} item={selected} permissions={permissions}
        undispensable={notDispensable(selected.id)}
        onUndispensable={() => setUndispensable(current => ({ facilityId: here,
          ids: new Set(current.facilityId === here ? current.ids : []).add(selected.id) }))}
        said={said.rowSaid(selected.orderRoute?.id)} holds={holds} crossFacilityWork={read.value?.crossFacilityWork}
        onChanged={read.refresh} onBusy={setRecording} onEnded={endedHere} onNotCompleted={notCompletedHere} onReread={said.reread} />}
    </DeptPage>
  )
}
