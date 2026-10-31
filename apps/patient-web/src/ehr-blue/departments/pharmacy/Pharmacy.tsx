import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { EhrButton } from '@hid/ui/ehr'
import { CircleCheck, Pill, Plus, Search, Wallet } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { Alert, Button, FilterTabs, Input } from '../../../kasuwa/ui'
import { staffApi, type PharmacyWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { cannotCompleteOffered, holdsReceivePermission, routeClosedForWork, wrongPatientOffered } from '../../../staff/orderRoutes'
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
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CAP_CANNOT_COMPLETE, patientLabel, readsKept, RefreshButton, RoutedWorkPaused, SaidAboveList, SaidAboveTheList,
  StandaloneWorkNote, useLearnCannotCompleteServed, useLearnLateCorrectionServed, useLearnWrongPatientServed,
  useNotCompletedEndings, useReceiving, useRowSaid, WORK_LIST_CAP, WorkListCap, type Said,
} from '../parts/routedWork'
import { PharmacyCard, PharmacyCards } from './PharmacyQueue'
import { PharmacyRecord } from './PharmacyRecord'
import { doseMissing, inTab, matchesItem, queueOrder, queueTone, routeAlert, statusOf, type PharmacyTab } from './pharmacyText'
import { BillBadge } from '../commerce/BillBadge'
import { StockLine, usePaymentSettings } from './pointOfCare'
import { billOf, stockOf } from './pocFields'

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
  // The queue opens on what is waiting: the work of the counter.
  const [tab, setTab] = useState<PharmacyTab>('todo')
  const [page, setPage] = useState(0)
  // A dispensing or reversal being sent from the open record: Back to list waits for its outcome.
  const [recording, setRecording] = useState(false)
  const focus = useFocusById()
  // The facility's payment setup (POINT_OF_CARE_SPEC §1): whether a bill must be paid before dispensing. Off (404) or
  // unread, nothing waits for payment, as today.
  const paymentSettings = usePaymentSettings(canRead ? facilityId : undefined)
  const settings = paymentSettings.status === 'ready' ? paymentSettings.data : null

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

  const routeClosed = (item: PharmacyWorkItem) => routeClosedForWork(item.orderRoute)
  const rows = queueOrder(visible ?? [], notDispensable)
  const counts = { todo: rows.filter(item => inTab('todo', item)).length, payment: rows.filter(item => inTab('payment', item)).length,
    dispensed: rows.filter(item => inTab('dispensed', item)).length, all: rows.length }
  // "Waiting for payment" only from a backend that sends bills on the work (POINT_OF_CARE_SPEC §3).
  const billed = rows.some(item => billOf(item) !== undefined)
  const matching = rows.filter(item => inTab(tab, item) && matchesItem(search, item, statusOf(item, notDispensable(item.id))))
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shownRows = matching.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const listed = rows.length > 0
  // The next prescription waiting, after the one open: "Next prescription" on the done state keeps the counter moving.
  const nextItem = selected ? rows.find(item => item.id !== selected.id && inTab('todo', item) && !doseMissing(item)
    && !notDispensable(item.id) && !routeClosed(item)) ?? null : null
  function openNext() {
    if (!nextItem) return
    // In place of the record just done, keeping how it was reached, so Back to list still returns to the list.
    setParams(previous => {
      const next = new URLSearchParams(previous)
      next.set(RX_PARAM, nextItem.id)
      return next
    }, { replace: true, state: location.state })
    focus(`pharmacy-${nextItem.id}-title`)
  }
  const refresh = <RefreshButton loading={read.loading} onRefresh={read.refresh}>Refresh</RefreshButton>
  const emptyTab = tab === 'todo'
    ? { icon: CircleCheck, title: 'Nothing waiting to dispense', description: 'New prescriptions show here as soon as Pharmacy accepts them.' }
    : tab === 'payment' ? { icon: Wallet, title: 'Nothing waiting for payment', description: 'Prescriptions with a bill still owed show here.' }
    : tab === 'dispensed' ? { icon: Pill, title: 'Nothing dispensed yet', description: 'Prescriptions you dispense move here.' }
      : { icon: Pill, title: 'No prescriptions yet', description: 'Prescriptions show here once they are accepted.' }
  return (
    <DeptPage title={selected ? <span id={`pharmacy-${selected.id}-title`} tabIndex={-1}>{selected.medication.display}</span>
      : <span id={HEADING} tabIndex={-1}>Pharmacy</span>}
      primaryAction={selected ? <EhrButton variant="secondary" aria-disabled={recording || undefined} onClick={back}>Back to list</EhrButton>
        : permissions.includes('pharmacy.walk-in.create') ? <Button variant="primary" icon={Plus} to="/provider/pharmacy/new-sale">New sale</Button> : undefined}
      secondaryActions={refresh}>
      {read.error && (listed || selected) && <Alert intent="error" title="Couldn’t refresh prescriptions"
        action={<EhrButton variant="secondary" size="sm" onClick={() => void read.refresh()}>Try again</EhrButton>}>{read.error} What is shown may be out of date.</Alert>}
      <SaidAboveTheList service="pharmacy" said={ended} facilityId={here} onClose={() => setEnded(null)} />
      {notCompleted.endings.length > 0 && <DeptEmbedded><CannotCompleteEndings service="pharmacy" endings={notCompleted.endings}
        onClose={notCompleted.close} /></DeptEmbedded>}
      <div hidden={selected !== null} className="flex flex-col gap-4">
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
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <FilterTabs label="Show prescriptions" value={tab} onChange={value => { setTab(value); setPage(0) }} options={[
            { value: 'todo', label: 'To dispense', count: counts.todo },
            ...(billed || tab === 'payment' ? [{ value: 'payment' as const, label: 'Waiting for payment', count: counts.payment }] : []),
            { value: 'dispensed', label: 'Dispensed', count: counts.dispensed },
            { value: 'all', label: 'All', count: counts.all },
          ]} />
          <div className="flex min-w-0 items-center gap-2 sm:w-80">
            <label htmlFor="pharmacy-search" className="sr-only">Search Pharmacy</label>
            <Input id="pharmacy-search" type="search" icon={Search} className="min-w-0 flex-1" value={search} autoComplete="off"
              placeholder="Search by drug or patient" onChange={event => { setSearch(event.target.value); setPage(0) }} />
            {search ? <EhrButton variant="secondary" onClick={() => { setSearch(''); setPage(0); focus('pharmacy-search') }}>Clear search</EhrButton> : null}
          </div>
        </div>
        {matching.length > PAGE_SIZE && <nav className="hid-ehr-dept-toolbar" aria-label="Record pages">
          <EhrButton variant="secondary" size="sm" aria-disabled={current === 0 || undefined}
            onClick={() => { if (current > 0) setPage(current - 1) }}>Previous page</EhrButton>
          <span className="hid-ehr-dept-toolbar-note">Page {current + 1} of {pages}</span>
          <EhrButton variant="secondary" size="sm" aria-disabled={current + 1 >= pages || undefined}
            onClick={() => { if (current + 1 < pages) setPage(current + 1) }}>Next page</EhrButton>
        </nav>}
        <PageState loading={read.loading} error={listed ? null : read.error || null} hasData={listed} onRetry={() => void read.refresh()}
          what="prescriptions" rows={3}
          empty={!listed ? emptyTab : matching.length === 0 ? (search
            ? { icon: Search, title: 'No matching prescriptions', description: 'Check the spelling, or search by another drug or patient name.' }
            : emptyTab) : null}>
          <PharmacyCards label="Prescriptions">
            {shownRows.map(item => {
              const status = statusOf(item, notDispensable(item.id))
              const text = selected ? null : said.rowSaid(item.orderRoute?.id)
              const alert = routeAlert(item.orderRoute, late)
              const bill = billOf(item)
              const stock = stockOf(item)
              return <PharmacyCard key={item.id} item={item} buttonId={`pharmacy-${item.id}-name`} status={status} tone={queueTone(status)}
                badges={!item.dispensing && (bill !== undefined || (stock && stock.onHand <= 0)) ? <>
                  {bill !== undefined ? <BillBadge bill={bill} /> : null}
                  {stock && stock.onHand <= 0 ? <StockLine stock={stock} className="rounded-md bg-danger-soft px-2 py-0.5 text-[12px]" /> : null}
                </> : undefined}
                missing={!item.dispensing && doseMissing(item)} patientFallback={patientLabel(item)} when={dateText(item.acceptedAt)}
                onOpen={() => open(item)}
                below={item.orderRoute || alert ? <>
                  {text && item.orderRoute && <p id={`pharmacy-${item.id}-said`} className="hid-ehr-dept-pharmacy-said" role="alert" tabIndex={-1}>{text}</p>}
                  {item.orderRoute && <small className="hid-ehr-dept-reference">From {item.orderRoute.orderingFacilityName ?? 'the ordering facility'}</small>}
                  {alert && <small className="hid-ehr-dept-pharmacy-alert">{alert}</small>}
                </> : undefined} />
            })}
          </PharmacyCards>
        </PageState>
      </div>
      {selected && <PharmacyRecord key={selected.id} facilityId={here} item={selected} permissions={permissions}
        undispensable={notDispensable(selected.id)}
        onUndispensable={() => setUndispensable(current => ({ facilityId: here,
          ids: new Set(current.facilityId === here ? current.ids : []).add(selected.id) }))}
        said={said.rowSaid(selected.orderRoute?.id)} holds={holds} crossFacilityWork={read.value?.crossFacilityWork}
        onChanged={read.refresh} onBusy={setRecording} onEnded={endedHere} onNotCompleted={notCompletedHere} onReread={said.reread}
        next={nextItem ? nextItem.medication.display : null} onNext={openNext} onBack={back} settings={settings} />}
    </DeptPage>
  )
}
