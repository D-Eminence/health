import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { EhrButton, EhrEmptyState, EhrSkeleton } from '@hid/ui/ehr'
import { Flag } from '../../../kasuwa/parts'
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
import { DeptSearch } from '../parts/DeptSearch'
import { QueuePatient, WorkQueue } from '../parts/WorkQueue'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, readsKept, RefreshButton, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed,
  useNotCompletedEndings, useReceiving, useRowSaid, WORK_LIST_CAP, WorkListCap, type Said,
} from '../parts/routedWork'
import { PharmacyRecord } from './PharmacyRecord'
import { DOSE_MISSING, doseLine, doseMissing, matchesItem, queueTone, routeAlert, statusOf } from './pharmacyText'

const LOAD_FAILED = 'Prescriptions could not be loaded. Please retry.'
/** The design's list shows 50 records a page. */
const PAGE_SIZE = 50
const HEADING = 'pharmacy-heading'
/** The open prescription's id in the address (`?rx=`), so Back and a refresh keep the place. */
const RX_PARAM = 'rx'

/**
 * Pharmacy in the blue Hospital EHR: the prescriptions accepted at the working facility (and, at a pharmacy that
 * receives them, prescriptions other facilities send), each opened as a record to dispense or reverse. Live on today's
 * Pharmacy API with today's checks (staff/routes/Operations.tsx Pharmacy); the screens and words are the design's.
 * The list and the record are views of this page; the open record's id (never anything about the patient) is in the
 * address, so Back and a refresh keep the place.
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
  const [params, setParams] = useSearchParams()
  const openedId = params.get(RX_PARAM)
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  // A dispensing or reversal being sent from the open record: Back to list waits for its outcome.
  const [recording, setRecording] = useState(false)
  const focus = useFocusById()

  // The rows shown: an order this pharmacy couldn't complete and later withdrew as the wrong person is no longer shown.
  const visible = items ? notCompleted.shown(items) : null
  // The record open, only as the list now shows it: work that has left the list (an order ended, here or elsewhere) is
  // never shown again, even once other work is listed.
  const selected = openedId ? visible?.find(item => item.id === openedId) ?? null : null
  const gone = Boolean(openedId && visible !== null && !selected)
  /** Opens or closes a record in the address: a new history entry, so the browser's Back returns to the list. */
  const show = useCallback((id: string | null, replace = false) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (id) next.set(RX_PARAM, id)
      else next.delete(RX_PARAM)
      return next
    }, { replace, state: id ? { fromQueue: true } : undefined })
  }, [setParams])
  // In the commit that removes the record, so focus is never left on the page meanwhile.
  useLayoutEffect(() => {
    if (!gone) return
    show(null, true)
    focus(HEADING, true)
  }, [gone, focus, show])
  // Leaving a record (its Back, or the browser's) puts focus back on its row, once the list shows again.
  const lastOpened = useRef(openedId)
  useLayoutEffect(() => {
    const was = lastOpened.current
    lastOpened.current = openedId
    if (was && !openedId) focus([`pharmacy-${was}-name`, HEADING], true)
  }, [openedId, focus])
  useEffect(() => {
    if (!items) return
    setUndispensable(current => {
      const kept = [...current.ids].filter(id => items.some(item => item.id === id))
      return kept.length === current.ids.size ? current : { ...current, ids: new Set(kept) }
    })
  }, [items])

  if (!facilityId || !canRead) return (
    <DeptPage title="Pharmacy">
      <div className="hid-ehr-dept-pharmacy-error">You can’t open Pharmacy here. Your role needs permission to see prescriptions.</div>
    </DeptPage>
  )
  const here = facilityId
  const notDispensable = (id: string) => undispensable.facilityId === here && undispensable.ids.has(id)

  function open(item: PharmacyWorkItem) {
    show(item.id)
    focus(`pharmacy-${item.id}-title`)
  }
  function back() {
    // Focusable while a request runs, but a press does nothing: the record must stay to say how it ended.
    if (recording) return
    const id = selected?.id
    // Opened from the list: step back in history, so the browser's Back doesn't reopen it. Else (a shared address) replace.
    if ((location.state as { fromQueue?: unknown } | null)?.fromQueue === true) navigate(-1)
    else show(null, true)
    focus(id ? [`pharmacy-${id}-name`, HEADING] : HEADING, true)
  }
  function notCompletedHere(ending: Omit<CannotCompleteEnding, 'key'>) {
    notCompleted.add(ending)
    said.clear()
    // Where its reads ended at once, nothing of it is shown again.
    if (!readsKept(ending.result) && selected?.orderRoute?.id === ending.result.route.id) show(null, true)
    void read.refresh()
  }
  function endedHere(ending: WrongPatientEnding) {
    said.clear()
    setEnded({ facilityId: here, ending })
    // The patient's details go at once: the record closes, and the list is read again.
    show(null, true)
    void read.refresh()
  }

  const rows = visible ?? []
  const matching = rows.filter(item => matchesItem(search, item, statusOf(item, notDispensable(item.id))))
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shownRows = matching.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const listed = rows.length > 0
  const refresh = <RefreshButton loading={read.loading} onRefresh={read.refresh}>Refresh</RefreshButton>
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
            : listed && matching.length > 0 ? <WorkQueue label="Prescriptions" titleHeader="Medicine" priority={false} rows={shownRows.map(item => {
              const status = statusOf(item, notDispensable(item.id))
              const text = selected ? null : said.rowSaid(item.orderRoute?.id)
              const alert = routeAlert(item.orderRoute, late)
              const missing = !item.dispensing && doseMissing(item)
              return {
                id: item.id,
                buttonId: `pharmacy-${item.id}-name`,
                title: item.medication.display,
                detail: doseLine(item),
                // The name and date of birth to hand the medicine to the right person, when Pharmacy sends them.
                patient: <QueuePatient patient={item.patient} fallback={patientLabel(item)} />,
                status,
                statusTone: queueTone(status),
                flag: missing ? <span className="inline-flex items-center gap-1"><Flag level="abnormal" /><span className="text-[12px] font-medium text-warn-ink">{DOSE_MISSING}</span></span> : null,
                when: dateText(item.acceptedAt),
                onOpen: () => open(item),
                below: item.orderRoute || alert ? <>
                  {text && item.orderRoute && <p id={`pharmacy-${item.id}-said`} className="hid-ehr-dept-pharmacy-said" role="alert" tabIndex={-1}>{text}</p>}
                  {item.orderRoute && <small className="hid-ehr-dept-reference">From {item.orderRoute.orderingFacilityName ?? 'the ordering facility'}</small>}
                  {alert && <small className="hid-ehr-dept-pharmacy-alert">{alert}</small>}
                </> : undefined,
              }
            })} />
              : listed ? <EhrEmptyState title="No matching prescriptions" message="Change your search." />
                : !read.error ? <EhrEmptyState title="No prescriptions yet" message="Prescriptions show here once they are accepted." /> : null}
        </DeptSearch>
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
