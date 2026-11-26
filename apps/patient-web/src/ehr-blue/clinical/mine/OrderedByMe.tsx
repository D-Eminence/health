import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, type EhrBadgeTone } from '@hid/ui/ehr'
import { FilterTabs } from '../../../kasuwa/ui'
import { useStaff } from '../../../staff/App'
import { myOrdersApi, type MyOrder, type MyOrdersKindFilter, type MyOrdersPage } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../../departments/parts/access'
import { DeptNotice } from '../../departments/parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../../departments/parts/DeptPage'
import { birthDateText } from '../../departments/parts/format'
import { bornText, healthIdEnding, lagosToday, sexText } from '../../departments/waiting/waitingRules'
import { routeStatus } from '../consult/orders/Routing'
import { readOrderRoute } from '../consult/orders/words'
import { statusWords } from '../parts/format'
import {
  DESCRIPTION, EYEBROW, KIND_TABS, LOAD_FAILED, MORE_FAILED, PAGE_SIZE, RESTARTED, TITLE, UNAVAILABLE_MESSAGE, canUseOrderedByMe, coverageText,
  earliestSince, emptyText, firstKind, hiddenText, isSinceRefusal, kindWord, orderName, orderWord, orderedWhen, patientName, priorityWords,
  progressWords, refusalWords, showsLab, showsPrescriptions, sinceProblem, sinceRefusalWords,
} from './myOrders'
import './mine.css'

/**
 * "Ordered by me" (hid-system 0143, MY-1) under Care: the lab requests and prescriptions the signed-in member ordered at
 * this facility, newest first, each with the patient's card (name, sex, date of birth, the Health ID's last 4
 * characters), its status and priority, and how far it has got in this facility's own laboratory or pharmacy (ORD-3's
 * words). Read when the page opens and when the member asks (a tab, Open only, Look further back, Refresh, Load more),
 * never on a timer: each read is audited for every patient it shows.
 *
 * A row opens its order only while its patient is the record open now for direct care, as Home's wrong-person card
 * does (home/liveCards.tsx): a chart opens only by a Health ID lookup, and a row has no Health ID. Any other row says
 * to open the patient from Patients first. Nothing read here goes to storage or the address; the cursor stays in state.
 *
 * Only the kinds the member orders are shown (the overseer, hid-system#258, 26 Nov 2026, following Ola's clinical view):
 * lab requests with lab-request write and read, prescriptions with prescription write and read, and the tabs (All, Lab,
 * Prescriptions) only to a member shown both. A member shown one kind asks for that kind alone, so a kind they only read
 * never comes back. Without either, the address gives the page's own words (OrderedByMeUnavailable) and reads nothing.
 */
export function OrderedByMe() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canUseOrderedByMe(permissions)) return <OrderedByMeUnavailable />
  const lab = showsLab(permissions)
  const prescriptions = showsPrescriptions(permissions)
  // Keyed by what it shows too, so a change of role at the same facility starts again with the kinds it now shows.
  return <MyOrdersDesk key={`${facility.id}|${lab}|${prescriptions}`} facilityId={facility.id} lab={lab} prescriptions={prescriptions} />
}

export function OrderedByMeUnavailable() {
  return <DeptUnavailable title={TITLE} message={UNAVAILABLE_MESSAGE} />
}

interface Filters {
  readonly kind: MyOrdersKindFilter
  readonly openOnly: boolean
  /** The day chosen with Look further back; null for the backend's default (90 days back). */
  readonly since: string | null
}

type Problem = { readonly text: string; readonly retry: boolean }

const cancelled = (caught: unknown) => isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED'
const isCursorRefusal = (caught: unknown) => isHidApiError(caught) && caught.code === 'INVALID_CURSOR'

function MyOrdersDesk({ facilityId, lab, prescriptions }: { readonly facilityId: string; readonly lab: boolean; readonly prescriptions: boolean }) {
  const [filters, setFilters] = useState<Filters>(() => ({ kind: firstKind(lab, prescriptions), openOnly: false, since: null }))
  const [list, setList] = useState<MyOrdersPage | null>(null)
  const [loading, setLoading] = useState<'first' | 'more' | null>('first')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [moreProblem, setMoreProblem] = useState('')
  const [notice, setNotice] = useState('')
  const [lookBack, setLookBack] = useState<{ readonly value: string; readonly problem: string } | null>(null)
  const sequence = useRef(0)
  /** The day of the last list the backend answered (null for its 90 days), to go back to when a later day is refused. */
  const accepted = useRef<string | null>(null)
  const focus = useFocusById()

  /**
   * The first page for `wanted`. A filter change or a restart clears what was shown, so no row is shown under the wrong
   * filter; Refresh (`keep`) leaves the rows shown while it reads, and after a failed read.
   */
  const loadFirst = useCallback(async (wanted: Filters, { restarted = false, keep = false }: { restarted?: boolean; keep?: boolean } = {}) => {
    const run = ++sequence.current
    setLoading('first'); setProblem(null); setMoreProblem('')
    if (!keep) setList(null)
    if (!restarted) setNotice('')
    try {
      const page = await myOrdersApi.list(facilityId,
        { kind: wanted.kind, openOnly: wanted.openOnly, limit: PAGE_SIZE, ...(wanted.since ? { since: wanted.since } : {}) })
      if (run !== sequence.current) return
      accepted.current = wanted.since
      setList(page)
      if (restarted) setNotice(RESTARTED)
    } catch (caught) {
      if (run !== sequence.current || cancelled(caught)) return
      if (wanted.since && isSinceRefusal(caught)) {
        // About the day chosen: said at the date picker, which stays open to choose another. The list goes back to the
        // last day answered (or the backend's 90 days when that is the day refused) and is read again, so the page never
        // says it shows a day it could not show, and Cancel leaves a list on screen.
        const refused = wanted.since
        setLookBack(previous => ({ value: previous?.value ?? refused, problem: sinceRefusalWords(caught) }))
        focus('my-orders-since')
        const fallback = accepted.current === refused ? null : accepted.current
        accepted.current = fallback
        setFilters(previous => ({ ...previous, since: fallback }))
        return
      }
      setProblem({ text: refusalWords(caught, LOAD_FAILED), retry: !(isHidApiError(caught) && caught.status === 403) })
    } finally {
      if (run === sequence.current) setLoading(null)
    }
  }, [facilityId, focus])

  useEffect(() => {
    void loadFirst(filters)
    return () => { sequence.current += 1 }
  }, [loadFirst, filters])

  async function loadMore() {
    const cursor = list?.nextCursor
    if (!cursor || loading) return
    const run = ++sequence.current
    setLoading('more'); setMoreProblem('')
    try {
      const page = await myOrdersApi.list(facilityId, { kind: filters.kind, openOnly: filters.openOnly, limit: PAGE_SIZE, cursor,
        ...(filters.since ? { since: filters.since } : {}) })
      if (run !== sequence.current) return
      setList(previous => previous ? {
        ...page,
        items: [...previous.items, ...page.items.filter(item => !previous.items.some(shown => shown.kind === item.kind && shown.orderId === item.orderId))],
      } : page)
      setLoading(null)
    } catch (caught) {
      if (run !== sequence.current || cancelled(caught)) return
      setLoading(null)
      // The list changed under the cursor: start again from the top, once, and say so.
      if (isCursorRefusal(caught)) { void loadFirst(filters, { restarted: true }); return }
      setMoreProblem(`${MORE_FAILED} ${refusalWords(caught, '')}`.trim())
    }
  }

  /** A filter change reads again only when something differs: each read is audited for every patient it shows. */
  function change(next: Partial<Filters>) {
    setFilters(previous => {
      const changed = (Object.keys(next) as (keyof Filters)[]).some(key => next[key] !== previous[key])
      return changed ? { ...previous, ...next } : previous
    })
  }

  function chooseSince(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!lookBack) return
    const said = sinceProblem(lookBack.value)
    if (said) { setLookBack({ ...lookBack, problem: said }); focus('my-orders-since'); return }
    setLookBack(null)
    change({ since: lookBack.value })
  }

  const today = lagosToday()
  const both = lab && prescriptions
  const items = list?.items ?? []
  const hidden = list ? hiddenText(list.hiddenCount, list.hiddenCountComplete) : ''
  const empty = emptyText(filters.openOnly)
  const what = filters.kind === 'lab' ? 'Lab requests' : filters.kind === 'prescription' ? 'Prescriptions' : 'Orders'

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-mine"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void loadFirst(filters, { keep: true })} busy={loading === 'first' && list !== null}>Refresh</EhrButton>}>
      <DeptSection title={what} headingId="my-orders-title"
        actions={(
          <label className="hid-ehr-mine-toggle">
            <input type="checkbox" checked={filters.openOnly} onChange={event => change({ openOnly: event.target.checked })} />
            <span>Open only</span>
          </label>
        )}>
        {both ? <FilterTabs<MyOrdersKindFilter> label="Show" value={filters.kind} onChange={kind => change({ kind })} options={KIND_TABS} /> : null}

        <div className="hid-ehr-mine-coverage">
          <p className="hid-ehr-mine-muted">{coverageText(filters.openOnly, filters.since, list?.since ?? '')}</p>
          {filters.openOnly ? null : lookBack ? null : (
            <EhrButton size="sm" variant="secondary" onClick={() => { setLookBack({ value: filters.since ?? '', problem: '' }); focus('my-orders-since') }}>
              Look further back
            </EhrButton>
          )}
        </div>

        {lookBack ? (
          <form className="hid-ehr-dept-form hid-ehr-mine-since" noValidate onSubmit={chooseSince} aria-label="Look further back">
            <EhrField label="Show orders from" controlId="my-orders-since" hint="You can look back up to 2 years." error={lookBack.problem || undefined}>
              <EhrInput type="date" value={lookBack.value} min={earliestSince(today)} max={today}
                onChange={event => setLookBack({ value: event.target.value, problem: '' })} />
            </EhrField>
            <div className="hid-ehr-dept-form-actions">
              <EhrButton type="button" variant="quiet" onClick={() => setLookBack(null)}>Cancel</EhrButton>
              <EhrButton type="submit">Show orders</EhrButton>
            </div>
          </form>
        ) : null}

        {notice ? <DeptNotice role="status" tone="info" variant="box">{notice}</DeptNotice> : null}
        {problem ? (
          <DeptNotice role="alert" tone="critical">
            <p>{problem.text}</p>
            {problem.retry ? <EhrButton size="sm" variant="secondary" onClick={() => void loadFirst(filters)}>Try again</EhrButton> : null}
          </DeptNotice>
        ) : null}
        {loading === 'first' && list === null ? <p className="hid-ehr-state-message" role="status">Loading your orders…</p> : null}
        {list !== null && items.length === 0 && !list.nextCursor ? <EhrEmptyState title={empty.title} message={empty.message} /> : null}
        {hidden ? <p className="hid-ehr-mine-hidden">{hidden}</p> : null}

        {items.length > 0 ? (
          <ul className="hid-ehr-mine-list" aria-label={what}>
            {items.map((order, index) => <OrderCard key={`${order.kind}:${order.orderId}`} order={order} index={index} />)}
          </ul>
        ) : null}

        {list?.nextCursor ? (
          <div className="hid-ehr-mine-more">
            {moreProblem ? <DeptNotice role="alert" tone="critical">{moreProblem}</DeptNotice> : null}
            <EhrButton variant="secondary" busy={loading === 'more'} disabled={loading === 'first'} onClick={() => void loadMore()}>Load more</EhrButton>
          </div>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}

const STATUS_TONES: Readonly<Record<string, EhrBadgeTone>> = {
  draft: 'neutral', active: 'brand', on_hold: 'caution', completed: 'positive', cancelled: 'neutral',
}

/** One order: what it is, its status and progress, and whose it is; it opens only for the patient open now. */
function OrderCard({ order, index }: { readonly order: MyOrder; readonly index: number }) {
  const { activePatient } = useStaff()
  const openPatient = activePatient?.purpose === 'direct-care' ? activePatient.lookup.patient.patientId : null
  // By its place in the list: the order's and patient's ids stay out of the page's markup.
  const headingId = `my-order-${index}`
  const name = patientName(order)
  const what = orderWord(order.kind)
  const progress = progressWords(order)
  const priority = priorityWords(order)
  const ordered = orderedWhen(order.createdAt)
  const route = readOrderRoute(order.orderRoute)
  const sent = route ? routeStatus(route, name).text : ''
  const identity = [sexText(order.patient.sex), bornText(birthDateText(order.patient.dateOfBirth), undefined)].filter(Boolean)
  const link = { patientId: order.patient.patientId, encounterId: order.encounterId, kind: order.kind, orderId: order.orderId }
  return (
    <li className="hid-ehr-mine-card" aria-labelledby={headingId}>
      <div className="hid-ehr-mine-main">
        <p className="hid-ehr-mine-kind">{kindWord(order.kind)}</p>
        <h3 id={headingId} className="hid-ehr-mine-name">{orderName(order)}</h3>
        <div className="hid-ehr-mine-badges">
          <EhrBadge tone={STATUS_TONES[order.status] ?? 'neutral'}>{order.status ? statusWords(order.status) : 'Status not known'}</EhrBadge>
          {priority ? <EhrBadge tone={order.priority === 'routine' ? 'neutral' : 'caution'}>{priority}</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-mine-facts">
          {ordered ? <div><dt>Ordered</dt><dd>{ordered}</dd></div> : null}
          {progress ? <div><dt>Progress</dt><dd>{progress}</dd></div> : null}
        </dl>
        {sent ? <p className="hid-ehr-mine-muted">{sent}</p> : null}
      </div>
      <div className="hid-ehr-mine-patient">
        <p className="hid-ehr-mine-patient-name">{name}</p>
        <p className="hid-ehr-mine-identity">
          {identity.length > 0 ? <span>{identity.join(' · ')}</span> : null}
          {order.patient.healthIdLast4
            ? <span aria-label={`Health ID ending ${order.patient.healthIdLast4}`}>{healthIdEnding(order.patient.healthIdLast4)}</span>
            : null}
        </p>
        {openPatient === order.patient.patientId
          ? <Link to="/provider/clinical" state={{ order: link }} className="hid-ehr-blue-link">Open the {what} →</Link>
          : <p className="hid-ehr-mine-muted">To see it, open {name}’s record from <Link to="/provider/patients"
            className="hid-ehr-blue-link">Patients</Link>, then select Open the {what} here.</p>}
      </div>
    </li>
  )
}
