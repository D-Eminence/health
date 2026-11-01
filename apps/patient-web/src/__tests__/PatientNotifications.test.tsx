import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientNotification } from '../api'
import { NotificationsPage } from '../routes/Portal'
import { json, press, problem, renderPortal, type Sent } from './portalHarness'

/**
 * The patient inbox, GET /identity/me/notifications and
 * POST /identity/me/notifications/:id/read (hid-system patient-self.controller.ts).
 * Identity writes two codes (0037_patient_notification_inbox.sql):
 * ACCESS_REQUEST_RECEIVED for an access request and EMERGENCY_ACCESS_ACTIVATED
 * for a break-glass grant; on Novu hid-system #109 adds EMERGENCY_CONTACT_OPTED_OUT
 * when support removes a contact who asked to stop receiving alerts. A code is a
 * machine name, never patient copy.
 */
/** Whether a row says it is read: said to a screen reader after its date (the dot and the weight show it to the eye). */
const readState = (row: HTMLElement) => within(row).getByText(/^, (read|unread)$/).textContent?.replace(', ', '')

const item = (overrides: Partial<PatientNotification>): PatientNotification => ({
  id: '80000000-0000-4000-8000-000000000001', notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request',
  resourceId: '70000000-0000-4000-8000-000000000001', metadata: {}, readAt: null, createdAt: '2026-10-08T10:00:00Z', ...overrides,
})

describe('patient notifications', () => {
  it('names each notification in words, never by its code', async () => {
    renderPortal(<NotificationsPage />, () => json([
      item({}),
      item({ id: '80000000-0000-4000-8000-000000000002', notificationCode: 'EMERGENCY_ACCESS_ACTIVATED', resourceType: 'consent-grant', readAt: '2026-10-08T11:00:00Z' }),
      item({ id: '80000000-0000-4000-8000-000000000003', notificationCode: 'SOMETHING_NEW', resourceType: null }),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('A hospital or clinic asked to see your health records')).toBeTruthy()
    expect(within(items[0]!).getByText(/^Access request · /)).toBeTruthy()
    expect(readState(items[0]!)).toBe('unread')
    expect(within(items[1]!).getByText('A health worker opened your records in an emergency')).toBeTruthy()
    expect(within(items[1]!).getByText(/^Access given · /)).toBeTruthy()
    expect(readState(items[1]!)).toBe('read')
    expect(within(items[2]!).getByText('An update about your Health ID account')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ACCESS.REQUEST.RECEIVED|EMERGENCY.ACCESS.ACTIVATED|SOMETHING.NEW/)
  })

  it('says a contact who opted out was removed, and never shows its payload (hid-system #109)', async () => {
    renderPortal(<NotificationsPage />, () => json([item({ notificationCode: 'EMERGENCY_CONTACT_OPTED_OUT', resourceType: 'emergency-contact',
      resourceId: 'a0000000-0000-4000-8000-000000000001', metadata: { relationship: 'sibling', channel: 'email' } })]))
    const [opted] = await screen.findAllByRole('listitem')
    expect(within(opted!).getByText('An emergency contact asked to stop getting alerts, so we removed them')).toBeTruthy()
    expect(within(opted!).getByText(/^Emergency contact · /)).toBeTruthy()
    expect(readState(opted!)).toBe('unread')
    expect(document.body.textContent).not.toMatch(/EMERGENCY.CONTACT.OPTED.OUT|sibling|email|a0000000/)
  })

  it('marks an unread notification read through the patient route, then shows it read', async () => {
    let readAt: string | null = null
    const { sent } = renderPortal(<NotificationsPage />, (path, method) => {
      if (method === 'POST') { readAt = '2026-10-08T10:05:00Z'; return json({ id: item({}).id, readAt }) }
      return json([item({ readAt })])
    })
    await press(await screen.findByRole('button', { name: /^Mark as read/ }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mark as read/ })).toBeNull())
    expect(readState(screen.getByRole('listitem'))).toBe('read')
    // The button is gone: focus goes to the page's heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notifications', level: 1 }))
    expect(sent.filter(request => request.method === 'POST')).toEqual([
      { path: `/identity/me/notifications/${item({}).id}/read`, method: 'POST', body: null },
    ])
    expect(sent.filter(request => request.method === 'GET' && !request.path.startsWith('/identity/me/web-push'))).toHaveLength(2)
  })

  it('says when there are none', async () => {
    renderPortal(<NotificationsPage />, () => json([]))
    expect(await screen.findByText('No notifications')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
  })
})

/**
 * hid-1.0 parity B2 (hid-system 0093): Identity writes account security notices (resource 'account'; no health
 * information and nothing secret in them) and a notice when a clinician ends their own access before it was due to end
 * (resource 'consent-grant', metadata { facilityName } only).
 */
describe('account security and early-ending notices', () => {
  it('names each in the patient\'s words', async () => {
    renderPortal(<NotificationsPage />, () => json([
      item({ id: '80000000-0000-4000-8000-000000000011', notificationCode: 'SECURITY_PASSWORD_RESET_REQUESTED', resourceType: 'account', resourceId: null }),
      item({ id: '80000000-0000-4000-8000-000000000012', notificationCode: 'SECURITY_PASSWORD_CHANGED', resourceType: 'account', resourceId: null }),
      item({ id: '80000000-0000-4000-8000-000000000013', notificationCode: 'SECURITY_GOOGLE_LINKED', resourceType: 'account', resourceId: null }),
      item({ id: '80000000-0000-4000-8000-000000000014', notificationCode: 'CONSENT_GRANT_ENDED_BY_CLINICIAN', resourceType: 'consent-grant',
        resourceId: '60000000-0000-4000-8000-000000000001', metadata: { facilityName: 'Lagos General' } }),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('Someone asked to reset your Health ID password')).toBeTruthy()
    expect(within(items[0]!).getByText(/^Account security · /)).toBeTruthy()
    expect(readState(items[0]!)).toBe('unread')
    expect(within(items[1]!).getByText('Your Health ID password was changed')).toBeTruthy()
    expect(within(items[2]!).getByText('A Google account was linked to your Health ID')).toBeTruthy()
    expect(within(items[3]!).getByText('Lagos General ended its access to your health records early')).toBeTruthy()
    expect(within(items[3]!).getByText(/^Access given · /)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/SECURITY_|CONSENT.GRANT|60000000/)
  })

  it('says "A hospital" when the early ending names none, and never shows anything else from its metadata', async () => {
    renderPortal(<NotificationsPage />, () => json([
      item({ notificationCode: 'CONSENT_GRANT_ENDED_BY_CLINICIAN', resourceType: 'consent-grant', metadata: { facilityName: '  ', reason: 'Discharged' } }),
      item({ id: '80000000-0000-4000-8000-000000000002', notificationCode: 'CONSENT_GRANT_ENDED_BY_CLINICIAN', resourceType: 'consent-grant',
        metadata: { facilityName: 42 } }),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('A hospital ended its access to your health records early')).toBeTruthy()
    expect(within(items[1]!).getByText('A hospital ended its access to your health records early')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Discharged')
  })
})

/**
 * The patient's notifications carried over from hid-1.0 (hid-system 0062, GET and POST .../imported-notifications):
 * counted by the bell while unread, so they are listed here, read once per visit and marked read through their own
 * route. Their text is hid-1.0's, shown as plain text.
 */
describe('notifications from hid-1.0', () => {
  const imported = (overrides: Record<string, unknown> = {}) => ({
    id: '90000000-0000-4000-8000-000000000001', title: 'Access session closed', message: 'A clinician closed their access session to your record.',
    type: 'access', readAt: null, createdAt: '2026-03-02T09:30:00Z', ...overrides,
  })
  const IMPORTED = '/identity/me/imported-notifications'
  const OLD = 'From your old Health ID account'
  const gets = (sent: Sent[]) => sent.filter(request => request.path === IMPORTED && request.method === 'GET')

  it('lists them under their own heading, as plain text, with the date and time and whether they are read', async () => {
    const { sent } = renderPortal(<NotificationsPage />, path => path === IMPORTED ? json([
      imported(), imported({ id: '90000000-0000-4000-8000-000000000002', title: '<b>Bold</b>', message: '<img src=x onerror=alert(1)>',
        readAt: '2026-03-03T09:30:00Z' }),
    ]) : json([]), {}, { parityB2: true })
    const card = await screen.findByRole('region', { name: OLD })
    const rows = within(card).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('Access session closed')).toBeTruthy()
    expect(within(rows[0]!).getByText('A clinician closed their access session to your record.')).toBeTruthy()
    expect(within(rows[0]!).getByText(/^2 Mar 2026, \d{2}:30$/)).toBeTruthy()
    expect(readState(rows[0]!)).toBe('unread')
    expect(within(rows[1]!).getByText('<b>Bold</b>')).toBeTruthy()
    expect(readState(rows[1]!)).toBe('read')
    expect(card.querySelector('img, b')).toBeNull()
    expect(gets(sent)).toEqual([{ path: IMPORTED, method: 'GET', body: null }])
  })

  it('marks one read through its own route and shows it read, without listing them again', async () => {
    const { sent } = renderPortal(<NotificationsPage />, (path, method) => {
      if (path === IMPORTED) return json([imported()])
      if (method === 'POST') return json({ id: imported().id, readAt: '2026-10-28T10:00:00Z' })
      return json([])
    }, {}, { parityB2: true })
    await screen.findByRole('heading', { name: OLD })
    await press(screen.getByRole('button', { name: /^Mark as read: Access session closed/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mark as read/ })).toBeNull())
    expect(readState(within(screen.getByRole('region', { name: OLD })).getByRole('listitem'))).toBe('read')
    expect(sent.filter(request => request.method === 'POST')).toEqual([
      { path: `${IMPORTED}/${imported().id}/read`, method: 'POST', body: null },
    ])
    expect(gets(sent)).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: OLD }))
  })

  it('is not shown when there are none, or where Identity does not serve them (404)', async () => {
    const empty = renderPortal(<NotificationsPage />, () => json([]), {}, { parityB2: true })
    expect(await screen.findByText('No notifications')).toBeTruthy()
    await waitFor(() => expect(gets(empty.sent)).toHaveLength(1))
    expect(screen.queryByRole('heading', { name: OLD })).toBeNull()
    empty.view.unmount()

    const unserved = renderPortal(<NotificationsPage />, path => path === IMPORTED
      ? problem(404, 'NOT_FOUND', 'Cannot GET') : json([]), {}, { parityB2: true })
    expect(await screen.findByText('No notifications')).toBeTruthy()
    await waitFor(() => expect(gets(unserved.sent)).toHaveLength(1))
    expect(screen.queryByRole('heading', { name: OLD })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers older ones a page at a time when a full page came', async () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_, index) => imported({
      id: `90000000-0000-4000-8000-${String(from + index).padStart(12, '0')}`, title: `Notice ${from + index}`, readAt: '2026-03-03T09:30:00Z' }))
    const { sent } = renderPortal(<NotificationsPage />, (path, method, body) => {
      void body
      if (path !== IMPORTED) return json([])
      const offset = sent.filter(request => request.path === IMPORTED).length === 1 ? 0 : 100
      return json(offset === 0 ? page(0, 100) : page(100, 3))
    }, {}, { parityB2: true })
    await screen.findByText('Notice 0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show older' })) })
    expect(await screen.findByText('Notice 102')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
    expect(gets(sent)).toHaveLength(2)
  })

  it('says a failed read, with Try again', async () => {
    let fail = true
    renderPortal(<NotificationsPage />, path => path === IMPORTED
      ? (fail ? problem(503, 'UPSTREAM_UNAVAILABLE', 'Your hid-1.0 notifications are unavailable right now.') : json([imported()]))
      : json([]), {}, { parityB2: true })
    expect(await screen.findByText('Your hid-1.0 notifications are unavailable right now.')).toBeTruthy()
    fail = false
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByText('Access session closed')).toBeTruthy()
  })
})
