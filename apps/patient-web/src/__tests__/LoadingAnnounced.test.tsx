import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { AccessRequest } from '../api'
import { AccessPage, SettingsPage } from '../routes/Portal'
import { json, press, profile, renderPortal } from './portalHarness'

/**
 * A region marked aria-busy may have its changes held back by assistive
 * technology until it is no longer busy. The first load's status message is
 * the change to announce, so it never sits inside a busy region; content
 * already on screen is marked busy while it reloads (PR-03).
 */
const request: AccessRequest = {
  accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
}

function held() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>(done => { release = done })
  return { promise, release }
}

const busyAround = (element: Element) => element.closest('[aria-busy="true"]')

describe('the first load is announced', () => {
  it('on the access page, whose cards are not busy before they show anything', async () => {
    const requests = held()
    const history = held()
    renderPortal(<AccessPage />, path => path === '/identity/me/access-requests' ? requests.promise : history.promise)

    const loading = await screen.findAllByText('Loading your information…')
    expect(loading).toHaveLength(2)
    for (const status of loading) {
      expect(status.getAttribute('role')).toBe('status')
      expect(busyAround(status)).toBeNull()
    }
    await act(async () => { requests.release(json([request])); history.release(json({ items: [] })) })
    expect(await screen.findByText('Lagos General')).toBeTruthy()
  })

  it('on the settings page, for emergency contacts and account deletion', async () => {
    const contacts = held()
    const deletion = held()
    renderPortal(<SettingsPage />, path => path === '/identity/me' ? json(profile)
      : path === '/identity/me/emergency-contacts' ? contacts.promise : deletion.promise)

    for (const text of ['Loading your contacts…', 'Checking your account…']) {
      const status = await screen.findByText(text)
      expect(status.getAttribute('role')).toBe('status')
      expect(busyAround(status)).toBeNull()
    }
    await act(async () => {
      contacts.release(json([]))
      deletion.release(json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }))
    })
  })

  it('marks content already on screen busy while it reloads', async () => {
    let reload: ReturnType<typeof held> | null = null
    renderPortal(<AccessPage />, (path, method) => {
      if (method === 'POST') return json({ accessRequestId: request.accessRequestId, status: 'approved' })
      if (path === '/identity/me/access-requests') return reload?.promise ?? json([request])
      return json({ items: [] })
    })
    const requestsCard = (await screen.findByRole('heading', { name: 'Access requests' })).closest('.patient-card')!
    await waitFor(() => expect(screen.getByRole('button', { name: /^Approve / })).toBeTruthy())
    expect(requestsCard.getAttribute('aria-busy')).toBeNull()

    reload = held()
    await press(screen.getByRole('button', { name: /^Approve / }))
    await waitFor(() => expect(requestsCard.getAttribute('aria-busy')).toBe('true'))
    expect(screen.getByText('Lagos General')).toBeTruthy()
    await act(async () => { reload!.release(json([{ ...request, status: 'approved' }])) })
    await waitFor(() => expect(requestsCard.getAttribute('aria-busy')).toBeNull())
  })
})
