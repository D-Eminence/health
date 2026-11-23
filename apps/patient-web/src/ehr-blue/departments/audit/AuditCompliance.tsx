import { useEffect, useLayoutEffect, useState } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrSelect, EhrSkeleton, type EhrBadgeTone } from '@hid/ui/ehr'
import { isHidApiError, plainErrorText } from '@hid/http'
import { staffApi, type FacilityAuditPage } from '../../../staff/api'
import { AUDIT_WORK, refusedWorkText } from '../../../staff/refusedWork'
import { focusIsLost } from '../../../staff/focus'
import { auditRow, matchesAuditSearch, type AuditRow } from '../../../audit/auditRow'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSearch } from '../parts/DeptSearch'

/*
 * Audit trail (target admin/audit.png): the working facility's audit events, newest first, as the target lists
 * them. The reads are today's (staff/routes/Audit.tsx): staffApi.facilityAudit for the working facility, 50 events a
 * page, an older page by the last page's cursor; only for a membership holding audit.read; an answer for an earlier
 * facility or page is dropped. Only what the API returns is shown: it withholds patient identifiers, reasons and event
 * details, and names no actor or membership. The search and the outcome filter are today's too, over the page loaded
 * only, drawn as the target's list search.
 *
 * Layout (design audit, #64): under the heading's line (Refresh beside it) and the intro, the page is one list card
 * ('hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card', DeptSearch's): the search and outcome filter at its top,
 * then every event of the page loaded that they match (all of them as the page opens), with Newer and Older events
 * under them. The request log (health#70) is never a row. The target draws no Refresh, search or filter, but all three
 * stay for good (owner decision 2 Nov 2026).
 *
 * Each event reads as a plain sentence (owner rule of 1 Nov 2026, docs/AUDIT_ACTION_LABELS.md): what was done, by whom,
 * when, and Allowed, Refused or Failed, in the words audit/auditRow.ts gives the classic page too. The action code, the
 * correlation ID and the resource type are never shown; the search still finds an event by its code.
 *
 * Its words are the classic page's (staff/routes/Audit.tsx, parity report 3.3-74): the title and intro, Refresh events,
 * Newer page and Older page, the search and outcome labels, the empty and load-failure states (plainErrorText), the
 * time as the browser writes it, and each outcome's badge.
 */

type PagePosition = { facilityId: string; cursors: Array<string | undefined> }
type LoadedPage = { facilityId: string; cursor: string | undefined; page: FacilityAuditPage }
/** A refused read: 403 (said at render, as the refusal is, by who reads it) or another failure, in words. */
type LoadProblem = { facilityId: string; cursor: string | undefined; forbidden: boolean; message: string }
/** Where focus goes once the read a button started has answered, if that button is gone by then. */
type FocusAfter = { facilityId: string; pressed: string; settledAt: number }

const EVENTS = 'hid-ehr-dept-audit-events'
const NEWER = 'hid-ehr-dept-audit-newer'
const OLDER = 'hid-ehr-dept-audit-older'
const TRY_AGAIN = 'hid-ehr-dept-audit-try-again'

// The outcomes in the words each row uses.
const OUTCOMES = [
  { value: 'all', label: 'All outcomes' },
  { value: 'success', label: 'Allowed' },
  { value: 'denied', label: 'Refused' },
  { value: 'failure', label: 'Failed' },
] as const

/** A failed read in plain words, never the server's: the classic page's sentence and plainErrorText's shared words. */
function loadProblemText(caught: unknown): string {
  return plainErrorText(caught, 'Audit events could not be loaded.', { audience: 'facility' })
}

/** When it happened, as the classic page writes it (the browser's own date and time), or that it is not available. */
export function eventTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'Time unavailable' : time.toLocaleString()
}

/** Each outcome's badge, as the classic page colours it: Allowed, Refused, Failed, and anything else plain. */
export function outcomeTone(outcome: AuditRow['outcome']): EhrBadgeTone {
  if (outcome === 'success') return 'positive'
  if (outcome === 'denied') return 'caution'
  if (outcome === 'failure') return 'critical'
  return 'neutral'
}

/** One event: what was done in bold, then by whom, when, and the outcome's badge. No code, in its text or an attribute. */
function AuditEvent({ row, occurredAt }: { readonly row: AuditRow; readonly occurredAt: string }) {
  return (
    <li>
      <span className="hid-ehr-dept-audit-event">
        <strong className="hid-ehr-dept-audit-action">{row.what}</strong>
        <small className="hid-ehr-dept-audit-meta">{row.who} · {eventTime(occurredAt)} · <EhrBadge tone={outcomeTone(row.outcome)}>{row.outcomeText}</EhrBadge></small>
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
  // Refused on reading: the refusal's own words, by who reads them (refusedWorkText), as the classic page says it, so a
  // facility's own administrator is never told to ask themselves, and the page says one thing whichever refuses first.
  const error = !current ? '' : current.forbidden ? refusedWorkText(facility, facility?.permissions ?? [], AUDIT_WORK) : current.message
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
      setProblem({ facilityId, cursor, forbidden: isHidApiError(caught) && caught.status === 403, message: loadProblemText(caught) })
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

  // The same title and words as the page's refusal (page.tsx) and the classic page, by who reads them: no permission named.
  if (!facility || !allowed) {
    return <DeptUnavailable title="Audit access unavailable" message={facility
      ? refusedWorkText(facility, facility.permissions, AUDIT_WORK)
      : 'Choose the facility you are working at to review its audit events.'} />
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

  // Today's search and filter, over the page loaded only: what the row says, and its action code, which is not shown.
  const visible = (page?.items ?? []).flatMap(event => {
    const row = auditRow(event)
    return row && (outcome === 'all' || row.outcome === outcome) && matchesAuditSearch(event, search) ? [{ event, row }] : []
  })

  return (
    <DeptPage eyebrow="Healthcare operations" title="Facility audit."
      secondaryActions={<EhrButton variant="secondary" busy={busy} onClick={refresh}>Refresh events</EhrButton>}>
      <p className="hid-ehr-dept-audit-intro">Review events for {facility.name}. The server checks your current membership and records each
        review. Patient identifiers, free-text reasons, and event details are withheld from this view.</p>
      <DeptSearch label="Search this page" value={search} onChange={setSearch}
        placeholder="What happened, who or outcome"
        hint="Search and outcome filters apply to the current page only. Use Older page to review earlier events."
        filters={(
          <EhrField label="Outcome on this page" className="hid-ehr-dept-audit-outcome">
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
          {!loading && page?.items.length === 0 && (page.nextBeforeSequenceId
            ? <EhrEmptyState title="Nothing to show on this page" message="This page held only request records, which aren’t shown here. Use Older page to look further back." />
            : <EhrEmptyState title="No audit events" message="The server returned no events for this page and facility." />)}
          {!loading && page && page.items.length > 0 && visible.length === 0 && (
            <EhrEmptyState title="No matching events on this page" message="Change the search or outcome filter, or review another page." />
          )}
          {visible.length > 0 && (
            <ul className="hid-ehr-dept-rows" aria-label={`Audit events, page ${cursors.length}`} aria-busy={loading || undefined}>
              {visible.map(({ event, row }) => <AuditEvent key={event.sequenceId} row={row} occurredAt={event.occurredAt} />)}
            </ul>
          )}
          {(showNewer || showOlder) && (
            <div className="hid-ehr-dept-audit-pager">
              {showNewer && <EhrButton id={NEWER} variant="secondary" size="sm" busy={busy} onClick={newer}>Newer page</EhrButton>}
              {showOlder && <EhrButton id={OLDER} variant="secondary" size="sm" busy={busy} onClick={older}>Older page</EhrButton>}
              {page && <span className="hid-ehr-dept-audit-pager-note">Page {cursors.length} · {page.items.length} {page.items.length === 1 ? 'event' : 'events'}</span>}
            </div>
          )}
        </div>
      </DeptSearch>
    </DeptPage>
  )
}
