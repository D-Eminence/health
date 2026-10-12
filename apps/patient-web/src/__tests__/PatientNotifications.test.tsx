import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientNotification } from '../api'
import { NotificationsPage } from '../routes/Portal'
import { json, renderPortal } from './portalHarness'

/**
 * The patient inbox, GET /identity/me/notifications and
 * POST /identity/me/notifications/:id/read (hid-system patient-self.controller.ts).
 * Identity writes two codes today (0037_patient_notification_inbox.sql):
 * ACCESS_REQUEST_RECEIVED for an access request and EMERGENCY_ACCESS_ACTIVATED
 * for a break-glass grant. A code is a machine name, never patient copy.
 */
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
    expect(within(items[0]!).getByText('A facility asked to access your health information')).toBeTruthy()
    expect(within(items[0]!).getByText(/^Access request · /)).toBeTruthy()
    expect(within(items[1]!).getByText('A provider used emergency access to your health information')).toBeTruthy()
    expect(within(items[1]!).getByText(/^Access grant · .* · Read$/)).toBeTruthy()
    expect(within(items[2]!).getByText('An update about your Health ID account')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ACCESS.REQUEST.RECEIVED|EMERGENCY.ACCESS.ACTIVATED|SOMETHING.NEW/)
  })

  it('marks an unread notification read through the patient route, then shows it read', async () => {
    let readAt: string | null = null
    const { sent } = renderPortal(<NotificationsPage />, (path, method) => {
      if (method === 'POST') { readAt = '2026-10-08T10:05:00Z'; return json({ id: item({}).id, readAt }) }
      return json([item({ readAt })])
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Mark as read/ }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mark as read/ })).toBeNull())
    expect(screen.getByText(/ · Read$/)).toBeTruthy()
    expect(sent.filter(request => request.method === 'POST')).toEqual([
      { path: `/identity/me/notifications/${item({}).id}/read`, method: 'POST', body: null },
    ])
    expect(sent.filter(request => request.method === 'GET')).toHaveLength(2)
  })

  it('says when there are none', async () => {
    renderPortal(<NotificationsPage />, () => json([]))
    expect(await screen.findByText('You have no notifications.')).toBeTruthy()
  })
})
