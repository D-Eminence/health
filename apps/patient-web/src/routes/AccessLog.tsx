import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import type { AccessLogAction, AccessLogEvent, AccessLogPage } from '../accessLog'
import { useSession } from '../session'
import { useOnNotificationChange } from '../notificationBadge'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'

/**
 * "Who viewed or changed your record" on Access and consent (hid-system 0093, patient parity B2): the patient's
 * access log, newest first, a page at a time, with "Show more" for older events. Clinicians and facilities are named,
 * as hid-1.0 named them. An Identity before it answers 404 and the section is not shown.
 */
export const WHAT: Readonly<Record<AccessLogAction, string>> = {
  viewed: 'Viewed your record',
  changed: 'Changed your record',
  access_granted: 'Was given access to your record',
  access_ended: 'Access to your record ended',
  emergency_access: 'Used emergency access to your record',
}

function when(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/** Who did it, in words: the clinician at their facility, the facility, you, Health ID support, or Health ID itself. */
export function accessLogActor(event: AccessLogEvent): string {
  switch (event.actorKind) {
    case 'patient': return 'You'
    case 'support': return 'Health ID support'
    case 'system': return event.facilityName ?? 'Health ID'
    case 'facility': return event.facilityName ?? event.actorName ?? 'A facility'
    case 'clinician': {
      const clinician = event.actorName ?? 'A clinician'
      return event.facilityName ? `${clinician} at ${event.facilityName}` : clinician
    }
  }
}

/** Events in the order shown, each once: the newest page first, then the older pages "Show more" added. */
function together(first: readonly AccessLogEvent[], older: readonly AccessLogEvent[]): AccessLogEvent[] {
  const seen = new Set<string>()
  return [...first, ...older].filter(event => !seen.has(event.id) && (seen.add(event.id), true))
}

const time = (event: AccessLogEvent) => Date.parse(event.at)

/**
 * Identity reads a bounded stretch of its audit rows for each page, and a stretch may hold only rows the log leaves
 * out (the patient's own reads, most of all). A read, the first or "Show more", goes on through at most this many
 * pages while they add nothing.
 */
export const ACCESS_LOG_PAGES_PER_READ = 3

async function readOn(read: (before: string | null) => Promise<AccessLogPage>, from: string | null): Promise<AccessLogPage> {
  let page = await read(from)
  for (let pages = 1; pages < ACCESS_LOG_PAGES_PER_READ && page.events.length === 0 && page.nextBefore; pages += 1) {
    page = await read(page.nextBefore)
  }
  return page
}

interface OlderPages { readonly events: readonly AccessLogEvent[]; readonly next: string | null }

/**
 * The older pages "Show more" added, after the newest page was read again: undefined when the new page stands alone.
 * They stay below it where it reaches them (its oldest event is no newer than the newest shown), keeping only what is
 * older than everything it holds. Identity makes views (or changes) close together one entry under the latest one's
 * id, so an entry shown before can come back under a new id; by time it is not shown twice.
 */
function olderAfterReread(fresh: AccessLogPage, shown: readonly AccessLogEvent[], next: string | null): OlderPages | undefined {
  // A page with nothing older holds every event; an empty one, or nothing shown, cannot be placed against them.
  if (fresh.nextBefore === null || fresh.events.length === 0 || shown.length === 0) return undefined
  const boundary = Math.min(...fresh.events.map(time))
  if (boundary > Math.max(...shown.map(time))) return undefined
  const held = new Set(fresh.events.map(event => event.id))
  return { events: shown.filter(event => !held.has(event.id) && time(event) <= boundary), next }
}

export function AccessLogCard() {
  const { api } = useSession()
  // A backend without the log answers 404: the section is then not shown.
  const load = useCallback((signal?: AbortSignal) => readOn(before => api.accessLog(before, signal), null).catch((caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) return null
    throw caught
  }), [api])
  // Kept for the account under its own name: `load` is made again each time the card is.
  const first = usePatientResource<AccessLogPage | null>(load, 'access-log')
  // Older pages "Show more" added, and the cursor after the last of them; undefined until it was used.
  const [older, setOlder] = useState<OlderPages | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  // What "Show more" found when it added nothing, said politely.
  const [moreNote, setMoreNote] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)
  // The newest page shown, for a "Show more" answered after it was read again.
  const shownPage = useRef(first.data)
  useLayoutEffect(() => { shownPage.current = first.data })

  // A notice came, or one was read: the newest page is read again. Older pages already shown stay below it, unless
  // the new page does not reach them (more than a page of new events), when it stands alone.
  useOnNotificationChange(() => { void first.reload() })
  const [basis, setBasis] = useState(first.data)
  if (first.data !== basis) {
    setBasis(first.data)
    setMoreNote(null)
    // What the newest page pushed down stays shown, above the older pages, and "Show more" goes on from them.
    if (older) setOlder(first.data && basis ? olderAfterReread(first.data, [...basis.events, ...older.events], older.next) : undefined)
  }

  if (first.data === null && !first.loading && !first.error) return null
  const page = first.data
  const events = page ? together(page.events, older?.events ?? []) : []
  const next = older ? older.next : page?.nextBefore ?? null

  const showMore = async () => {
    if (!next || loadingMore) return
    const before = events.length
    const from = first.data
    setLoadingMore(true); setMoreError(null); setMoreNote(null)
    try {
      const more = await readOn(cursor => api.accessLog(cursor), next)
      // The newest page was read again meanwhile, and "Show more" goes on from it now: this answer is not placed.
      if (shownPage.current !== from) { focusAfter(() => document.getElementById('access-log-more') ?? heading.current); return }
      setOlder({ events: [...older?.events ?? [], ...more.events], next: more.nextBefore })
      if (more.events.length === 0) {
        setMoreNote(more.nextBefore ? 'No entries in this stretch of time. Show more to look further back.' : 'There are no older entries.')
      }
      // The first event added, or the button again when nothing new came, or the heading once there is nothing more.
      focusAfter(() => list.current?.querySelectorAll<HTMLElement>('li[tabindex]')[before]
        ?? document.getElementById('access-log-more') ?? heading.current)
    } catch (cause) {
      setMoreError(isHidApiError(cause) ? cause.message : 'Older events could not be loaded.')
      focusAfter(() => document.getElementById('access-log-more'))
    } finally { setLoadingMore(false) }
  }

  return <div className="patient-card" aria-busy={(first.loading && first.data !== null) || undefined}>
    <h2 ref={heading} tabIndex={-1}>Who viewed or changed your record</h2>
    <p className="patient-field-hint">Each time a clinician or facility opened or changed your health record, or was given or lost
      access to it, newest first.</p>
    {first.loading && first.data === null && <p role="status">Loading who viewed or changed your record…</p>}
    {first.error && <div role="alert"><p>{first.error}</p>
      <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(first.reload)}>Try again</button></div>}
    {page && !first.error && (events.length === 0 ? <p className="patient-empty">{next
      ? 'No recent entries. Show more to look further back.' : 'No one has viewed or changed your record yet.'}</p>
      : <ul ref={list} className="patient-list patient-access-log">{events.map(event => <li key={event.id} tabIndex={-1}><div>
        <strong>{accessLogActor(event)}</strong>
        <span>{WHAT[event.action]}</span>
        <span><time dateTime={event.at}>{when(event.at)}</time></span>
      </div></li>)}</ul>)}
    {moreError && <p role="alert" className="patient-inline-error">{moreError}</p>}
    <div role="status">{moreNote && <p className="patient-field-hint">{moreNote}</p>}</div>
    {page && !first.error && next && <button id="access-log-more" type="button" className="patient-secondary-button"
      disabled={loadingMore || first.loading} onClick={() => void showMore()}>{loadingMore ? 'Loading…' : 'Show more'}</button>}
  </div>
}
