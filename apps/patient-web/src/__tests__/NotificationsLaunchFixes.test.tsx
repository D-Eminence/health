import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import type { PatientNotification } from '../api'
import { createPatientApi } from '../api'
import { NotificationsPage } from '../routes/Portal'
import { json, problem, renderPortal, type Sent } from './portalHarness'

/**
 * The notifications page's launch fixes (RN-09, RN-10, RN-11, RN-12, RN-18, RN-22). Fictional data only.
 */

const item = (n: number, overrides: Partial<PatientNotification> = {}): PatientNotification => ({
  id: `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`, notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request',
  resourceId: '70000000-0000-4000-8000-000000000001', metadata: {}, readAt: null, createdAt: `2026-10-08T10:${String(n % 60).padStart(2, '0')}:00Z`, ...overrides,
})
const INBOX = '/identity/me/notifications'
const IMPORTED = '/identity/me/imported-notifications'
const imported = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `Old notice ${n}`, message: 'A clinician closed their access session.',
  type: 'access', readAt: null, createdAt: '2026-03-02T09:30:00Z', ...overrides,
})
const posts = (sent: Sent[]) => sent.filter(request => request.method === 'POST')

describe('the inbox', () => {
  it('RN-09: after Mark as read, focus goes to the next unread one and a status says it was marked', async () => {
    const read = new Set<string>()
    renderPortal(<NotificationsPage />, (path, method) => {
      if (method === 'POST') { const id = path.split('/').at(-2)!; read.add(id); return json({ id, readAt: '2026-10-08T11:00:00Z' }) }
      return json([item(1), item(2)].map(row => read.has(row.id) ? { ...row, readAt: '2026-10-08T11:00:00Z' } : row))
    })
    const [first] = await screen.findAllByRole('button', { name: /^Mark as read/ })
    first!.focus()
    await act(async () => { fireEvent.click(first!) })
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Mark as read/ })).toHaveLength(1))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Mark as read/ })))
    expect(screen.getByRole('status').textContent).toBe('Marked as read.')
  })

  it('RN-10: gives a notice about access a way to act on it', async () => {
    renderPortal(<NotificationsPage />, () => json([
      item(1),
      item(2, { notificationCode: 'ORDER_ROUTE_SENT', resourceType: 'order-route', metadata: { kind: 'lab_request', receivingFacilityName: 'Example Lab' } }),
      item(3, { notificationCode: 'SECURITY_PASSWORD_CHANGED', resourceType: 'account' }),
    ]))
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]!).getByRole('link', { name: /^Review request/ }).getAttribute('href')).toBe('/access')
    expect(within(rows[1]!).getByRole('link', { name: /^Open Access & sharing/ }).getAttribute('href')).toBe('/access')
    expect(within(rows[2]!).queryByRole('link')).toBeNull()
  })

  it('RN-11: says only the newest 100 are shown when the list is full', async () => {
    renderPortal(<NotificationsPage />, path => json(path === INBOX ? Array.from({ length: 100 }, (_, n) => item(n + 1, { readAt: '2026-10-09T10:00:00Z' })) : []))
    expect(await screen.findByText('Showing your 100 most recent notifications. Older ones aren’t shown here.')).toBeTruthy()
  })

  it('RN-11: says nothing of older ones when the list is not full', async () => {
    renderPortal(<NotificationsPage />, () => json([item(1)]))
    await screen.findByRole('button', { name: /^Mark as read/ })
    expect(screen.queryByText(/most recent notifications/)).toBeNull()
  })

  it('RN-11: asks for the newest 100', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response('[]', { headers: { 'content-type': 'application/json' } }) })
    const api = createPatientApi(createRegisteredBrowserClient(createApiClient({ baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl }), 'patient-web'))
    await api.notifications()
    expect(urls).toEqual(['https://gateway.test/api/v1/identity/me/notifications?limit=100'])
  })

  it('RN-18: marks one at a time, and says which one is busy', async () => {
    let finish!: () => void
    const { sent } = renderPortal(<NotificationsPage />, (path, method) => method === 'POST'
      ? new Promise<Response>(resolve => { finish = () => resolve(json({ id: path.split('/').at(-2), readAt: '2026-10-08T11:00:00Z' })) })
      : json([item(1), item(2)]))
    const [first, second] = await screen.findAllByRole('button', { name: /^Mark as read/ })
    await act(async () => { fireEvent.click(first!) })
    expect(first!.getAttribute('aria-busy')).toBe('true')
    await act(async () => { fireEvent.click(second!) })
    await act(async () => { fireEvent.click(first!) })
    expect(posts(sent)).toHaveLength(1)
    await act(async () => { finish() })
  })
})

describe('from your old Health ID account', () => {
  it('RN-22: a first read that fails does not tell a new patient they had an old account', async () => {
    renderPortal(<NotificationsPage />, path => path === IMPORTED ? problem(503, 'UPSTREAM_UNAVAILABLE', 'unavailable') : json([]), {}, { parityB2: true })
    expect(await screen.findByText('If you had an old Health ID account, its notifications couldn’t be loaded.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'From your old Health ID account' })).toBeNull()
    expect(screen.queryByText(/Couldn’t load old notifications/)).toBeNull()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })

  it('RN-22: a Try again that finds no old account says so and keeps the keyboard there', async () => {
    let down = true
    renderPortal(<NotificationsPage />, path => path === IMPORTED && down ? problem(503, 'UPSTREAM_UNAVAILABLE', 'unavailable') : json([]), {}, { parityB2: true })
    await screen.findByText('If you had an old Health ID account, its notifications couldn’t be loaded.')
    const retry = screen.getByRole('button', { name: /Try again/ })
    retry.focus()
    down = false
    await act(async () => { fireEvent.click(retry) })
    const said = await screen.findByText('No notifications from an old account.')
    expect(said.getAttribute('role')).toBe('status')
    await waitFor(() => expect(document.activeElement).toBe(said))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('RN-12: says a failed Show older beside the button, and keeps the button where the keyboard is', async () => {
    let calls = 0
    renderPortal(<NotificationsPage />, path => {
      if (path !== IMPORTED) return json([])
      calls += 1
      return calls === 1 ? json(Array.from({ length: 100 }, (_, n) => imported(n, { readAt: '2026-03-03T09:30:00Z' })))
        : problem(503, 'UPSTREAM_UNAVAILABLE', 'unavailable')
    }, {}, { parityB2: true })
    const older = await screen.findByRole('button', { name: 'Show older' })
    older.focus()
    await act(async () => { fireEvent.click(older) })
    const alert = await screen.findByRole('alert')
    expect(older.parentElement!.contains(alert)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show older' }))
  })

  it('RN-12: after Show older, focus goes to the first row it added', async () => {
    let calls = 0
    renderPortal(<NotificationsPage />, path => {
      if (path !== IMPORTED) return json([])
      calls += 1
      return json(calls === 1 ? Array.from({ length: 100 }, (_, n) => imported(n, { readAt: '2026-03-03T09:30:00Z' }))
        : [imported(100, { readAt: '2026-03-03T09:30:00Z' }), imported(101, { readAt: '2026-03-03T09:30:00Z' })])
    }, {}, { parityB2: true })
    const older = await screen.findByRole('button', { name: 'Show older' })
    older.focus()
    await act(async () => { fireEvent.click(older) })
    await screen.findByText('Old notice 100')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Old notice 100').closest('li')))
  })

  it('RN-12: says a failed Mark as read in its own row', async () => {
    renderPortal(<NotificationsPage />, (path, method) => path.startsWith(IMPORTED)
      ? (method === 'POST' ? problem(503, 'UPSTREAM_UNAVAILABLE', 'unavailable') : json([imported(1), imported(2)]))
      : json([]), {}, { parityB2: true })
    const card = await screen.findByRole('region', { name: 'From your old Health ID account' })
    const [first] = within(card).getAllByRole('button', { name: /^Mark as read/ })
    first!.focus()
    await act(async () => { fireEvent.click(first!) })
    const alert = await within(card).findByRole('alert')
    expect(alert.closest('li')).toBe(first!.closest('li'))
    expect(document.activeElement).toBe(within(card).getAllByRole('button', { name: /^Mark as read/ })[0])
  })
})
