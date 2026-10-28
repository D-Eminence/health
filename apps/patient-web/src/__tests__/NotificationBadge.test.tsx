import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { ToastProvider, toast } from '@hid/ui'
import type { PatientNotification } from '../api'
import { AccessPage, NotificationsPage, PortalShell } from '../routes/Portal'
import { HidApiError } from '@hid/http'
import { UNREAD_POLL_MS, UNREAD_WAITING_EVERY } from '../notificationBadge'
import { useSession } from '../session'
import { json, patientApi, problem, renderPortal, type Handler, type Sent } from './portalHarness'

vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))

/**
 * The bell (hid-1.0 parity B2, hid-system 0093): GET /identity/me/notifications/unread-count answers { unread }, the
 * unread inbox items and unread imported hid-1.0 notifications. It is read as the portal opens, every minute while
 * the page is visible and as it comes back into view; an Identity without it answers 404 and no bell is shown. A rise
 * pops up a polite notice that never takes focus, and the notifications and access pages read again by themselves.
 */
const COUNT = '/identity/me/notifications/unread-count'
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  act(() => toast.dismiss())
})
afterEach(() => {
  act(() => toast.dismiss())
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

const item = (overrides: Partial<PatientNotification> = {}): PatientNotification => ({
  id: '80000000-0000-4000-8000-000000000001', notificationCode: 'SECURITY_PASSWORD_CHANGED', resourceType: 'account',
  resourceId: null, metadata: {}, readAt: null, createdAt: '2026-10-28T10:00:00Z', ...overrides,
})

/** The portal's shell showing `page`, against a gateway whose count is `count()`. */
function portal(count: () => Response, other: Handler = () => json([]), page: ReactElement = <p>Overview page</p>) {
  const handler: Handler = (requested, method, body) => requested === COUNT ? count() : other(requested, method, body)
  return renderPortal(<ToastProvider><Routes>
    <Route path="/" element={<PortalShell />}><Route index element={page} /><Route path="*" element={<p>Another page</p>} /></Route>
  </Routes></ToastProvider>, handler, {}, { parityB2: true })
}
const reads = (sent: Sent[], path = COUNT) => sent.filter(request => request.path === path && request.method === 'GET').length
const minute = () => act(async () => { await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS) })
const bell = () => screen.queryByRole('link', { name: /^Notifications, .* unread$/ })
function showPage(state: DocumentVisibilityState) {
  visibility = state
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('the notification bell', () => {
  it('shows the unread count, named for a screen reader, linking to the notifications', async () => {
    portal(() => json({ unread: 3 }))
    const link = await screen.findByRole('link', { name: 'Notifications, 3 unread' })
    expect(link.getAttribute('href')).toBe('/notifications')
    expect(link.textContent).toBe('3')
    // In the header, beside Sign out, and the side navigation's Notifications link stays as it was.
    expect(screen.getByRole('banner').contains(link)).toBe(true)
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy()
  })

  it('shows no bell while nothing is unread, and 99+ past 99', async () => {
    let unread = 0
    const { sent } = portal(() => json({ unread }))
    await waitFor(() => expect(reads(sent)).toBe(1))
    expect(bell()).toBeNull()
    unread = 120
    await minute()
    const link = await screen.findByRole('link', { name: 'Notifications, 120 unread' })
    expect(link.textContent).toBe('99+')
  })

  it('reads the count every minute while the page is visible, not while it is hidden, and as it comes back', async () => {
    const { sent } = portal(() => json({ unread: 1 }))
    await waitFor(() => expect(reads(sent)).toBe(1))
    await minute()
    expect(reads(sent)).toBe(2)
    showPage('hidden')
    await minute(); await minute()
    expect(reads(sent)).toBe(2)
    showPage('visible')
    await waitFor(() => expect(reads(sent)).toBe(3))
    await minute()
    expect(reads(sent)).toBe(4)
  })

  it('shows nothing, says nothing and asks no more where Identity does not serve the count (404)', async () => {
    const { sent } = portal(() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/me/notifications/unread-count'))
    await waitFor(() => expect(reads(sent)).toBe(1))
    await minute(); await minute()
    showPage('hidden'); showPage('visible')
    expect(reads(sent)).toBe(1)
    expect(bell()).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the count shown through an outage, and reads again on the next minute', async () => {
    let answer = () => json({ unread: 2 })
    const { sent } = portal(() => answer())
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    answer = () => problem(503, 'UPSTREAM_UNAVAILABLE', 'Unavailable')
    await minute()
    expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    answer = () => json({ unread: 1 })
    await minute()
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
    expect(reads(sent)).toBe(3)
  })

  it('stops the minute\'s readings after a 401 until the patient is back, and never signs them out for it', async () => {
    let answer = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Sign in again.')
    const signOut = vi.fn()
    const handler: Handler = (path) => path === COUNT ? answer() : json([])
    const { sent } = renderPortal(<ToastProvider><Routes><Route path="/" element={<PortalShell />}>
      <Route index element={<p>Overview page</p>} /></Route></Routes></ToastProvider>, handler, { signOut }, { parityB2: true })
    await waitFor(() => expect(reads(sent)).toBe(1))
    await minute(); await minute()
    expect(reads(sent)).toBe(1)
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    answer = () => json({ unread: 4 })
    showPage('hidden'); showPage('visible')
    expect(await screen.findByRole('link', { name: 'Notifications, 4 unread' })).toBeTruthy()
    await minute()
    expect(reads(sent)).toBe(3)
  })

  it('lets only a reading the patient caused renew an expired access token: as the portal opens or comes into view', async () => {
    const unreadNotificationCount = vi.fn(async (_options: { refresh: boolean; signal?: AbortSignal }) => 1)
    const { api } = patientApi(() => json([]))
    renderPortal(<Routes><Route path="/" element={<PortalShell />}><Route index element={<p>Overview page</p>} /></Route></Routes>,
      () => json([]), { api: { ...api, unreadNotificationCount } })
    await waitFor(() => expect(unreadNotificationCount).toHaveBeenCalledTimes(1))
    await minute()
    showPage('hidden'); showPage('visible')
    await waitFor(() => expect(unreadNotificationCount).toHaveBeenCalledTimes(3))
    expect(unreadNotificationCount.mock.calls.map(([options]) => options.refresh)).toEqual([true, false, true])
  })

  it('starts the minute\'s readings again, after a 401, once the patient opens another page', async () => {
    let answer = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Sign in again.')
    const { sent } = portal(() => answer())
    await waitFor(() => expect(reads(sent)).toBe(1))
    await minute()
    expect(reads(sent)).toBe(1)
    answer = () => json({ unread: 2 })
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Access' })) })
    expect(await screen.findByText('Another page')).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(reads(sent)).toBe(2)
    await minute()
    expect(reads(sent)).toBe(3)
    // While nothing held them back, opening a page reads nothing more.
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Profile' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(reads(sent)).toBe(3)
  })
})

describe('the bell after a 401, while the patient stays on the page', () => {
  /** A page whose button sends a request for the patient, as approving an access request does. */
  function Approve() {
    const { api } = useSession()
    return <button type="button" onClick={() => { void api.orderRoutes() }}>Approve</button>
  }

  it('reads again as soon as a request the page sent for the patient is answered, then every minute', async () => {
    let answer = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Sign in again.')
    const { sent } = portal(() => answer(), path => path === '/ehr/me/order-routes' ? json({ items: [] }) : json([]), <Approve />)
    await waitFor(() => expect(reads(sent)).toBe(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    // The patient's own request renewed the sign-in (here: it is simply accepted again).
    answer = () => json({ unread: 1 })
    await minute()
    expect(reads(sent)).toBe(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
    expect(reads(sent)).toBe(2)
    answer = () => json({ unread: 2 })
    await minute()
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(reads(sent)).toBe(3)
    // Answered requests while nothing is held back read nothing more.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(reads(sent)).toBe(3)
  })

  it('still reads every fifth minute without renewing, so a sign-in renewed in another window is seen', async () => {
    let renewed = false
    const unreadNotificationCount = vi.fn(async (_options: { refresh: boolean; signal?: AbortSignal }) => {
      if (!renewed) throw new HidApiError(401, 'Sign in again.', { code: 'AUTHENTICATION_REQUIRED' })
      return 3
    })
    const { api } = patientApi(() => json([]))
    // Until then the header's profile read (hid-1.0 parity B3) is refused as the count is, so no answer says the sign-in is live.
    const profile = vi.fn(async () => { throw new HidApiError(401, 'Sign in again.', { code: 'AUTHENTICATION_REQUIRED' }) })
    renderPortal(<ToastProvider><Routes><Route path="/" element={<PortalShell />}><Route index element={<p>Overview page</p>} /></Route>
    </Routes></ToastProvider>, () => json([]), { api: { ...api, unreadNotificationCount, profile } })
    await waitFor(() => expect(unreadNotificationCount).toHaveBeenCalledTimes(1))
    for (let held = 1; held < UNREAD_WAITING_EVERY; held += 1) await minute()
    expect(unreadNotificationCount).toHaveBeenCalledTimes(1)
    await minute()
    expect(unreadNotificationCount).toHaveBeenCalledTimes(2)
    renewed = true
    for (let held = 1; held < UNREAD_WAITING_EVERY; held += 1) await minute()
    expect(unreadNotificationCount).toHaveBeenCalledTimes(2)
    expect(bell()).toBeNull()
    await minute()
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()
    // Every minute again once it is read.
    await minute()
    expect(unreadNotificationCount).toHaveBeenCalledTimes(4)
    expect(unreadNotificationCount.mock.calls.map(([options]) => options.refresh)).toEqual([true, false, false, false])
  })
})

describe('a new notification while the portal is open', () => {
  it('pops up a polite notice when the count rises, with a link to the notifications, and leaves focus where it was', async () => {
    let unread = 1
    portal(() => json({ unread }))
    await screen.findByRole('link', { name: 'Notifications, 1 unread' })
    // The count read as the portal opens is not new.
    expect(screen.queryByText('You have a new notification')).toBeNull()
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    signOut.focus()

    unread = 2
    await minute()
    const notice = (await screen.findByText('You have a new notification')).closest('article')!
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.getAttribute('aria-live')).toBe('polite')
    expect(within(notice).getByRole('link', { name: 'View notifications' }).getAttribute('href')).toBe('/notifications')
    expect(within(notice).getByRole('button', { name: 'Dismiss notification' })).toBeTruthy()
    expect(document.activeElement).toBe(signOut)

    // A fall says nothing.
    act(() => toast.dismiss())
    unread = 0
    await minute()
    expect(screen.queryByText('You have a new notification')).toBeNull()
    expect(bell()).toBeNull()
  })

  it('can be dismissed', async () => {
    let unread = 0
    portal(() => json({ unread }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    unread = 1
    await minute()
    await screen.findByText('You have a new notification')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.queryByText('You have a new notification')).toBeNull()
  })

  it('reads the notifications page again by itself when the count changes', async () => {
    let unread = 1
    let inbox = [item()]
    const { sent } = portal(() => json({ unread }), path => path === '/identity/me/notifications' ? json(inbox)
      : path === '/identity/me/imported-notifications' ? json([]) : json([]), <NotificationsPage />)
    expect(await screen.findByText('Your Health ID password was changed')).toBeTruthy()
    const before = reads(sent, '/identity/me/notifications')
    inbox = [item({ id: '80000000-0000-4000-8000-000000000002', notificationCode: 'SECURITY_GOOGLE_LINKED' }), ...inbox]
    unread = 2
    await minute()
    expect(await screen.findByText('A Google account was linked to your Health ID')).toBeTruthy()
    expect(reads(sent, '/identity/me/notifications')).toBe(before + 1)
  })

  it('reads the count again once a notice is marked read, without reading the list twice', async () => {
    let unread = 1
    let readAt: string | null = null
    const { sent } = portal(() => json({ unread }), (path, method) => {
      if (path === '/identity/me/notifications' && method === 'GET') return json([item({ readAt })])
      if (method === 'POST') { readAt = '2026-10-28T10:05:00Z'; unread = 0; return json({ id: item().id, readAt }) }
      return json([])
    }, <NotificationsPage />)
    await screen.findByRole('link', { name: 'Notifications, 1 unread' })
    const lists = reads(sent, '/identity/me/notifications')
    fireEvent.click(await screen.findByRole('button', { name: /^Mark as read/ }))
    await waitFor(() => expect(bell()).toBeNull())
    expect(reads(sent)).toBe(2)
    // Read once again for the mark, not once more for the count it changed.
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(reads(sent, '/identity/me/notifications')).toBe(lists + 1)
  })

  it('reads Access and consent again by itself when the count changes', async () => {
    let unread = 0
    const { sent } = portal(() => json({ unread }), path => path === '/identity/me/access-history' ? json({ items: [] })
      : path === '/identity/me/access-log' ? json({ events: [], nextBefore: null }) : json([]), <AccessPage />)
    expect(await screen.findByText('There are no access requests.')).toBeTruthy()
    const requests = reads(sent, '/identity/me/access-requests'), history = reads(sent, '/identity/me/access-history')
    const log = reads(sent, '/identity/me/access-log')
    unread = 1
    await minute()
    await waitFor(() => expect(reads(sent, '/identity/me/access-requests')).toBe(requests + 1))
    expect(reads(sent, '/identity/me/access-history')).toBe(history + 1)
    expect(reads(sent, '/identity/me/access-log')).toBe(log + 1)
  })

  it('keeps the older access log pages shown when it reads the newest again, the events it pushed down included', async () => {
    let unread = 0
    const ev = (n: number) => ({ id: `event-${n}`, at: `2026-10-${10 + n}T09:00:00Z`, action: 'viewed', actorKind: 'clinician',
      actorName: `Dr Number ${n}`, facilityName: 'Lagos General' })
    let newest = { events: [ev(3), ev(2)], nextBefore: 'after-2' }
    portal(() => json({ unread }), (path, method, body) => {
      void method; void body
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (path !== '/identity/me/access-log') return json([])
      return json(showingMore ? { events: [ev(1)], nextBefore: null } : newest)
    }, <AccessPage />)
    let showingMore = false
    await screen.findByText('Dr Number 3 at Lagos General')
    showingMore = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more' })) })
    await screen.findByText('Dr Number 1 at Lagos General')
    showingMore = false
    // Two new events push event 2 off the newest page.
    newest = { events: [ev(5), ev(4), ev(3)], nextBefore: 'after-3' }
    unread = 1
    await minute()
    await screen.findByText('Dr Number 5 at Lagos General')
    const names = () => screen.getAllByText(/^Dr Number \d+ at Lagos General$/).map(element => element.textContent)
    expect(names()).toEqual([5, 4, 3, 2, 1].map(n => `Dr Number ${n} at Lagos General`))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()

    // More new events than a page holds: the newest page stands alone, and "Show more" goes on from it.
    newest = { events: [ev(9), ev(8)], nextBefore: 'after-8' }
    unread = 2
    await minute()
    await screen.findByText('Dr Number 9 at Lagos General')
    expect(names()).toEqual([9, 8].map(n => `Dr Number ${n} at Lagos General`))
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
  })

  it('shows an entry Identity grouped again under a newer id once, in its place, after reading the newest again', async () => {
    let unread = 0
    let showingMore = false
    const entry = (id: string, at: string, actorName: string, action = 'viewed') =>
      ({ id, at, action, actorKind: 'clinician', actorName, facilityName: 'Lagos General' })
    let newest = { events: [entry('x-1', '2026-10-28T10:00:00Z', 'Dr A'), entry('b', '2026-10-28T09:00:00Z', 'Dr B')], nextBefore: 'after-b' }
    portal(() => json({ unread }), path => {
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (path !== '/identity/me/access-log') return json([])
      return json(showingMore ? { events: [entry('c', '2026-10-28T08:00:00Z', 'Dr C')], nextBefore: null } : newest)
    }, <AccessPage />)
    await screen.findByText('Dr A at Lagos General')
    showingMore = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more' })) })
    await screen.findByText('Dr C at Lagos General')
    showingMore = false
    // Dr A viewed again at 10:05 (grouped with 10:00 under the newer view's id), then ended their access at 10:06.
    newest = { events: [entry('end', '2026-10-28T10:06:00Z', 'Dr A', 'access_ended'), entry('x-2', '2026-10-28T10:05:00Z', 'Dr A'),
      entry('b', '2026-10-28T09:00:00Z', 'Dr B')], nextBefore: 'after-b' }
    unread = 1
    await minute()
    await screen.findByText('Access to your record ended')
    const card = screen.getByRole('heading', { name: 'Who viewed or changed your record' }).closest('.patient-card') as HTMLElement
    const rows = within(card).getAllByRole('listitem').map(row => [row.querySelector('strong')?.textContent, row.querySelector('time')?.getAttribute('dateTime')])
    expect(rows).toEqual([
      ['Dr A at Lagos General', '2026-10-28T10:06:00Z'], ['Dr A at Lagos General', '2026-10-28T10:05:00Z'],
      ['Dr B at Lagos General', '2026-10-28T09:00:00Z'], ['Dr C at Lagos General', '2026-10-28T08:00:00Z'],
    ])
  })

  it('keeps the count in memory only', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    portal(() => json({ unread: 5 }))
    await screen.findByRole('link', { name: 'Notifications, 5 unread' })
    await minute()
    expect(setItem).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
  })
})
