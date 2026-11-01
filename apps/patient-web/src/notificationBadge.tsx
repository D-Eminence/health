import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { toast } from '@hid/ui'
import { useSession } from './session'

/**
 * The bell's unread count (hid-system 0093, patient parity B2): GET .../me/notifications/unread-count, the unread
 * inbox items and the unread notifications carried over from hid-1.0. It is read as the portal opens, every minute
 * while the page is visible, and as it comes back into view. An Identity before it answers 404: no bell is shown and
 * it is not asked again. The count is held in memory only, for the account signed in.
 *
 * A reading on the minute never renews the sign-in (a polled tab would otherwise never go idle, against the 7-day
 * idle rule): it neither refreshes an expired access token nor signs the patient out on a 401. After such a 401 the
 * minute's readings wait until the sign-in is known to be live again: the page comes into view, another page opens,
 * or a request the page sent for the patient is answered (it renewed the sign-in, or found it renewed). Meanwhile
 * every fifth minute still reads, without renewing, so a sign-in renewed in another window is seen.
 *
 * When the count rises a polite pop-up says so, with a link to the notifications; it never takes focus. Pages that
 * show what a notice is about (the notifications and Access and consent) read again when the count changes.
 */
export const UNREAD_POLL_MS = 60_000
/** After a 401, one minute's reading in this many still goes, without renewing the sign-in. */
export const UNREAD_WAITING_EVERY = 5
export const NEW_NOTIFICATION = 'You have a new notification'
const TOAST_ID = 'patient-new-notification'

type Reading = 'start' | 'minute' | 'visible' | 'resume' | 'settle'

interface UnreadNotifications {
  /** The count, or null while unknown or where Identity does not serve it. */
  readonly unread: number | null
  /** Goes up each time the count changes after its first reading. */
  readonly changes: number
  /**
   * Reads the count again after the page's own change (a notice marked read): a fall it caused is not passed on to
   * the pages, which already show it.
   */
  readonly settle: () => Promise<void>
}

const UnreadNotificationsContext = createContext<UnreadNotifications | null>(null)
const NONE: UnreadNotifications = { unread: null, changes: 0, settle: async () => undefined }

export function UnreadNotificationsProvider({ children }: { children: ReactNode }) {
  const { api, state } = useSession()
  const { pathname } = useLocation()
  const account = state.status === 'authenticated' ? state.principal.subjectId : null
  const [unread, setUnread] = useState<number | null>(null)
  const [changes, setChanges] = useState(0)
  const reader = useRef<(reading: Reading) => Promise<void>>(async () => undefined)

  useEffect(() => {
    setUnread(null)
    if (account === null) return
    let active = true
    // Whether Identity serves the count, whether the minute's readings wait for a live sign-in, and the last count read.
    let served = true
    let waiting = false
    // The minute's readings held back since the last 401.
    let held = 0
    let last: number | null = null
    let inFlight: Promise<void> | null = null
    const controller = new AbortController()

    const once = async (reading: Reading) => {
      try {
        const count = await api.unreadNotificationCount({ refresh: reading !== 'minute', signal: controller.signal })
        if (!active) return
        waiting = false
        const previous = last
        last = count
        setUnread(count)
        if (previous === null || count === previous) return
        if (count > previous) {
          toast.info(NEW_NOTIFICATION, { id: TOAST_ID, dedupeKey: TOAST_ID, duration: 10_000,
            description: <Link to="/notifications">View notifications</Link> })
        } else if (reading === 'settle') return
        setChanges(value => value + 1)
      } catch (reason) {
        if (!active) return
        if (isHidApiError(reason) && reason.status === 404) { served = false; last = null; setUnread(null) }
        else if (isHidApiError(reason) && reason.status === 401) { waiting = true; held = 0 }
        // Anything else (an outage, a cancelled read) leaves the count shown until the next reading.
      }
    }

    const read = async (reading: Reading): Promise<void> => {
      if (!active || !served) return
      if (reading !== 'settle' && document.visibilityState === 'hidden') return
      if (reading === 'resume' && !waiting) return
      if (reading === 'minute' && waiting) {
        held += 1
        if (held < UNREAD_WAITING_EVERY) return
        held = 0
      }
      if (inFlight) {
        // A reading after the page's own change must postdate it; any other is answered by the one under way.
        if (reading !== 'settle') return
        await inFlight
        if (!active) return
      }
      const current = once(reading)
      inFlight = current
      try { await current } finally { if (inFlight === current) inFlight = null }
    }

    reader.current = read
    void read('start')
    const timer = setInterval(() => { void read('minute') }, UNREAD_POLL_MS)
    const onVisibility = () => { if (document.visibilityState === 'visible') void read('visible') }
    document.addEventListener('visibilitychange', onVisibility)
    // A request the page sent for the patient was answered: the sign-in is live, so readings held back start again.
    const stopListening = api.onSessionAccepted(() => { void read('resume') })
    return () => {
      active = false
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      stopListening()
      reader.current = async () => undefined
      // Nothing said for one account stays on screen for the next.
      toast.dismiss(TOAST_ID)
    }
  }, [api, account])

  // Another page opened: the patient is here, so readings the minute held back after a 401 start again.
  useEffect(() => { void reader.current('resume') }, [pathname])

  const settle = useCallback(() => reader.current('settle'), [])
  const value = useMemo(() => ({ unread, changes, settle }), [unread, changes, settle])
  return <UnreadNotificationsContext.Provider value={value}>{children}</UnreadNotificationsContext.Provider>
}

/** The count and `settle`; outside the portal's shell (a page tested on its own) there is no count. */
export function useUnreadNotifications(): UnreadNotifications {
  return useContext(UnreadNotificationsContext) ?? NONE
}

/**
 * Calls `onChange` each time the unread count changes after the page opened: a notice came, or one was read in
 * another window. The page reads its information again; nothing moves focus.
 */
export function useOnNotificationChange(onChange: () => void) {
  const { changes } = useUnreadNotifications()
  const seen = useRef(changes)
  const latest = useRef(onChange)
  useLayoutEffect(() => { latest.current = onChange })
  useEffect(() => {
    if (changes === seen.current) return
    seen.current = changes
    latest.current()
  }, [changes])
}

/** The bell in the portal's header: only while something is unread. */
export function NotificationBell() {
  const { unread } = useUnreadNotifications()
  if (unread === null || unread <= 0) return null
  // The shell's icon-button look (kasuwa): 44px on a phone, the count as a small brand pill on its corner.
  return <NavLink to="/notifications" aria-label={`Notifications, ${unread} unread`}
    className="relative ml-auto inline-flex size-11 items-center justify-center rounded-md text-ink-2 no-underline ring-1 ring-line-strong ring-inset hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:size-10">
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
    <span aria-hidden="true" className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-fill px-1.5 text-[11px] leading-none font-semibold text-white ring-2 ring-canvas">{unread > 99 ? '99+' : unread}</span>
  </NavLink>
}
