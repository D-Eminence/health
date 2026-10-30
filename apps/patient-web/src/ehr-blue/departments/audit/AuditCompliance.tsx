import { useEffect, useLayoutEffect, useState } from 'react'
import { EhrButton, EhrEmptyState, EhrField, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { staffApi, type FacilityAuditEvent, type FacilityAuditPage } from '../../../staff/api'
import { focusIsLost } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptPage } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSearch } from '../parts/DeptSearch'
import { errorText } from '../parts/errors'

/*
 * Audit & Compliance (target admin/audit.png): the working facility's audit events, newest first, as the target lists
 * them. The reads are today's (staff/routes/Audit.tsx): staffApi.facilityAudit for the working facility, 50 events a
 * page, an older page by the last page's cursor; only for a membership holding audit.read; an answer for an earlier
 * facility or page is dropped. Only what the API returns is shown: it withholds patient identifiers, reasons and event
 * details, and names no actor or membership. The search and the outcome filter are today's too, over the page loaded
 * only, drawn as the target's list search.
 */

type PagePosition = { facilityId: string; cursors: Array<string | undefined> }
type LoadedPage = { facilityId: string; cursor: string | undefined; page: FacilityAuditPage }
/** A refused read: 403 (this membership may not review audit events) or another failure, in words. */
type LoadProblem = { facilityId: string; cursor: string | undefined; forbidden: boolean; message: string }
/** Where focus goes once the read a button started has answered, if that button is gone by then. */
type FocusAfter = { facilityId: string; pressed: string; settledAt: number }

const EVENTS = 'hid-ehr-dept-audit-events'
const NEWER = 'hid-ehr-dept-audit-newer'
const OLDER = 'hid-ehr-dept-audit-older'
const TRY_AGAIN = 'hid-ehr-dept-audit-try-again'

const OUTCOMES = [
  { value: 'all', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'failure', label: 'Failure' },
] as const

/** The time as the target shows it (ISO, UTC), or that it is not available. */
function eventTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'time unavailable' : time.toISOString()
}

function AuditEvent({ event }: { readonly event: FacilityAuditEvent }) {
  return (
    <li>
      <span className="hid-ehr-dept-audit-event">
        <strong className="hid-ehr-dept-audit-action">{event.action}</strong>
        <small className="hid-ehr-dept-audit-meta">{eventTime(event.occurredAt)} · actor {event.actorType} · correlation {event.correlationId}</small>
        <small className="hid-ehr-dept-audit-meta">{event.resourceType ?? 'resource not recorded'} · {event.outcome}</small>
      </span>
    </li>
  )
}

export function AuditCompliance() {
  const { facility } = useDeptAccess()
  const facilityId = facility?.id ?? ''
  const allowed = facility?.permissions.includes('audit.read') ?? false
  const [position, setPosition] = useState<PagePosition>({ facilityId: '', cursors: [undefined] })
  const [loaded, setLoaded] = useState<LoadedPage | null>(null)
  const [problem, setProblem] = useState<LoadProblem | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  // How many reads have answered: a focus request waits for the read its button started.
  const [settled, setSettled] = useState(0)
  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null)
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('all')
  const cursors = position.facilityId === facilityId ? position.cursors : [undefined]
  const cursor = cursors[cursors.length - 1]
  const page = loaded?.facilityId === facilityId && loaded.cursor === cursor ? loaded.page : null
  const current = problem?.facilityId === facilityId && problem.cursor === cursor ? problem : null
  const error = !current ? '' : current.forbidden
    ? `Your membership at ${facility?.name ?? 'this facility'} can’t review audit events. Ask your facility administrator for audit access.`
    : current.message
  // No answer yet for this page: its read is starting or running.
  const waiting = !page && !error
  const busy = loading || waiting
  const pressed = focusAfter?.facilityId === facilityId ? focusAfter.pressed : null

  useEffect(() => {
    if (!facilityId || !allowed) return
    let active = true
    setLoading(true)
    setProblem(null)
    void staffApi.facilityAudit(facilityId, cursor).then(next => {
      if (active) setLoaded({ facilityId, cursor, page: next })
    }).catch(caught => {
      if (!active) return
      setProblem({ facilityId, cursor, forbidden: isHidApiError(caught) && caught.status === 403,
        message: errorText(caught, 'Audit events could not be loaded. Try again.') })
    }).finally(() => { if (active) { setLoading(false); setSettled(count => count + 1) } })
    return () => { active = false }
  }, [facilityId, allowed, cursor, reload])

  // A page button stays (unavailable) while its page is read; once the page answers, a button no longer offered has
  // gone with focus on it, so focus moves to Try again, then the button pressed, the other page button, or the events.
  useLayoutEffect(() => {
    if (!focusAfter) return
    if (focusAfter.facilityId !== facilityId) { setFocusAfter(null); return }
    if (loading || settled === focusAfter.settledAt) return
    setFocusAfter(null)
    const order = focusAfter.pressed === TRY_AGAIN ? [TRY_AGAIN, EVENTS]
      : [...(error ? [TRY_AGAIN] : []), focusAfter.pressed, focusAfter.pressed === OLDER ? NEWER : OLDER, EVENTS]
    const target = order.map(id => document.getElementById(id)).find(element => element !== null) ?? null
    if (focusIsLost(target)) target?.focus()
  }, [focusAfter, facilityId, loading, settled, error])

  if (!facility || !allowed) {
    return (
      <DeptPage title="Audit & Compliance">
        <DeptNotice role="status">{facility
          ? `Your current permissions at ${facility.name} don’t allow audit review. Choose an authorized workflow.`
          : 'Choose the facility you are working at to review its audit events.'}</DeptNotice>
      </DeptPage>
    )
  }

  const showNewer = cursors.length > 1 || (pressed === NEWER && waiting)
  const showOlder = Boolean(page?.nextBeforeSequenceId) || (pressed === OLDER && waiting)
  const newer = () => {
    if (cursors.length < 2) return
    setFocusAfter({ facilityId, pressed: NEWER, settledAt: settled })
    setPosition({ facilityId, cursors: cursors.slice(0, -1) })
  }
  const older = () => {
    const next = page?.nextBeforeSequenceId
    if (!next) return
    setFocusAfter({ facilityId, pressed: OLDER, settledAt: settled })
    setPosition({ facilityId, cursors: [...cursors, next] })
  }
  const refresh = () => setReload(value => value + 1)
  const tryAgain = () => {
    setFocusAfter({ facilityId, pressed: TRY_AGAIN, settledAt: settled })
    setReload(value => value + 1)
  }

  // Today's search and filter, over the page loaded only: any of the action, correlation ID, resource type or actor type.
  const query = search.trim().toLocaleLowerCase()
  const visible = page?.items.filter(event =>
    (outcome === 'all' || event.outcome === outcome)
    && (!query || [event.action, event.correlationId, event.resourceType ?? '', event.actorType]
      .some(value => value.toLocaleLowerCase().includes(query)))) ?? []

  return (
    <DeptPage title="Audit & Compliance"
      secondaryActions={<EhrButton variant="secondary" busy={busy} onClick={refresh}>Refresh</EhrButton>}>
      <p className="hid-ehr-dept-audit-intro">Audit events for {facility.name}. Health ID checks your membership and records each review.
        Patient identifiers, reasons and event details are not shown here.</p>
      <DeptSearch label="Search Audit & Compliance" value={search} onChange={setSearch}
        placeholder="Search actions, actor types, resources or correlation IDs…"
        hint="Search and outcome apply to the events loaded on this page. Use Older events to look further back."
        filters={(
          <EhrField label="Outcome" className="hid-ehr-dept-audit-outcome">
            <EhrSelect value={outcome} onChange={event => setOutcome(event.target.value)}>
              {OUTCOMES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </EhrSelect>
          </EhrField>
        )}>
        <div id={EVENTS} className="hid-ehr-dept-audit-card" role="region" aria-label="Audit events" tabIndex={-1}>
          {error && (
            <DeptNotice tone="critical" role="alert">
              <p>{error}</p>
              <p><EhrButton id={TRY_AGAIN} variant="secondary" size="sm" onClick={tryAgain}>Try again</EhrButton></p>
            </DeptNotice>
          )}
          {loading && !page && <EhrSkeleton label="Loading audit events" />}
          {/* A page already shown stays while it is read again; the read is still said, as today's page says every read. */}
          {loading && page && <p role="status" className="hid-ehr-sr-only">Loading audit events</p>}
          {!loading && page?.items.length === 0 && (cursors.length > 1
            ? <EhrEmptyState title="No older events" message={`There are no earlier audit events at ${facility.name}.`} />
            : <EhrEmptyState title="No audit events yet" message={`Events at ${facility.name} appear here once they are recorded.`} />)}
          {!loading && page && page.items.length > 0 && visible.length === 0 && (
            <EhrEmptyState title="No matching events" message="Change the search or outcome, or look at another page." />
          )}
          {visible.length > 0 && (
            <ul className="hid-ehr-dept-rows" aria-label={`Audit events, page ${cursors.length}`} aria-busy={loading || undefined}>
              {visible.map(event => <AuditEvent key={event.sequenceId} event={event} />)}
            </ul>
          )}
          {(showNewer || showOlder) && (
            <div className="hid-ehr-dept-audit-pager">
              {showNewer && <EhrButton id={NEWER} variant="secondary" size="sm" busy={busy} onClick={newer}>Newer events</EhrButton>}
              {showOlder && <EhrButton id={OLDER} variant="secondary" size="sm" busy={busy} onClick={older}>Older events</EhrButton>}
              {page && <span className="hid-ehr-dept-audit-pager-note">Page {cursors.length} · {page.items.length} {page.items.length === 1 ? 'event' : 'events'}</span>}
            </div>
          )}
        </div>
      </DeptSearch>
    </DeptPage>
  )
}
