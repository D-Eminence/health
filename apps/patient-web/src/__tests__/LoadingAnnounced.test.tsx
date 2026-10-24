import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AccessRequest, EmergencyContact } from '../api'
import { AccessPage, SettingsPage } from '../routes/Portal'
import { AccountDeletionCard, EmergencyContactsCard } from '../routes/AccountSafety'
import { json, press, problem, profile, renderPortal } from './portalHarness'

/**
 * A region marked aria-busy may have its changes held back by assistive
 * technology until it is no longer busy. The first load's status message and an
 * action's notice never sit inside a busy region; content already on screen is
 * marked busy while it reloads (PR-03).
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

describe('busy regions while content loads (PR-03)', () => {
  it('keeps the first load\'s status out of a busy region on the access page, whose cards are not busy before they show anything', async () => {
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

  it('keeps the first load\'s status out of a busy region on the settings page, for emergency contacts and account deletion', async () => {
    const contacts = held()
    const deletion = held()
    renderPortal(<SettingsPage />, path => path === '/identity/me' ? json(profile)
      // hid-system main serves no availability read: the read held is the list's, and the deletion read has its own answer.
      : path.endsWith('/availability') ? problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`)
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
    expect(await screen.findByText('You have no emergency contacts.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Continue to delete account' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
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

const contact: EmergencyContact = {
  contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms',
  destinationHint: '+234•••••567', status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true,
  eligibleForEmergencyNotification: false, version: 1, pendingVerification: null, lastNotification: null,
}
const scheduled = { waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: { requestId: 'req-1', state: 'pending',
  requestedAt: '2026-10-08T10:00:00Z', confirmationExpiresAt: null, scheduledFor: '2026-10-22T10:00:00Z', blockedReasonCode: null,
  cancelledAt: null, cancellable: true } }

/**
 * Each action sets its notice and then reloads what it changed. The reload is
 * held here, so the content it replaces is still busy when the notice is checked.
 */
describe('an action\'s notice is not inside the region that reloads', () => {
  function heldReload(first: () => Response) {
    const reload = held()
    let reads = 0
    return { read: () => ++reads === 1 ? first() : reload.promise, release: reload.release }
  }
  async function noticeOutsideBusy(notice: string, reloading: string) {
    const shown = await screen.findByText(notice)
    expect(shown.closest('[role="status"]')).not.toBeNull()
    expect(busyAround(screen.getByText(reloading))).not.toBeNull()
    expect(busyAround(shown)).toBeNull()
  }
  const contacts = (first: () => Response) => {
    const reads = heldReload(first)
    renderPortal(<EmergencyContactsCard />, (path, method) => {
      // hid-system main serves no availability read (the card then keeps main's behaviour): the reads held are the list's.
      if (path.endsWith('/availability')) return problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`)
      if (method === 'GET') return reads.read()
      if (path.endsWith('/verification')) return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-08T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
      if (path.endsWith('/verification/confirm')) return json({ contactId: contact.contactId, status: 'verified' })
      if (path.endsWith('/deactivate')) return json({ contactId: contact.contactId, status: 'deactivated', replayed: false })
      return json(contact)
    })
    return reads
  }

  it('Contact added', async () => {
    contacts(() => json([]))
    await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Contact name' }), { target: { value: 'Chidi Okafor' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '+2348012345567' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    await noticeOutsideBusy('Contact added. Send a verification code so they can be notified in an emergency.', 'You have no emergency contacts.')
  })

  it('Contact verified', async () => {
    contacts(() => json([contact]))
    await press(await screen.findByRole('button', { name: /^Send verification code/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: /Code from Chidi Okafor/ }), { target: { value: '482913' } })
    await press(screen.getByRole('button', { name: 'Verify contact' }))
    await noticeOutsideBusy('Contact verified. They will be notified if emergency access to your record is used.', 'Chidi Okafor')
  })

  it('Contact updated', async () => {
    contacts(() => json([contact]))
    await press(await screen.findByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi O.' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    await noticeOutsideBusy('Contact updated.', 'Chidi Okafor')
  })

  it('Contact removed', async () => {
    contacts(() => json([contact]))
    await press(await screen.findByRole('button', { name: /^Remove/ }))
    await press(screen.getByRole('button', { name: 'Confirm removal' }))
    await noticeOutsideBusy('Contact removed. They will no longer be notified.', 'Chidi Okafor')
  })

  it('Account deletion cancelled', async () => {
    const reads = heldReload(() => json(scheduled))
    renderPortal(<AccountDeletionCard />, (_path, method) => method === 'GET' ? reads.read() : json({ requestId: 'req-1', state: 'cancelled', replayed: false }))
    await press(await screen.findByRole('button', { name: 'Cancel deletion' }))
    await noticeOutsideBusy('Account deletion cancelled. Your account stays open.',
      'Until then you can keep using Health ID and cancel at any time. After that date this cannot be undone.')
  })
})
