import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { AccessRequest, EmergencyContact } from '../api'
import { AccessPage, NotificationsPage } from '../routes/Portal'
import { EmergencyContactsCard } from '../routes/AccountSafety'
import { json, press, renderPortal } from './portalHarness'

/**
 * NEW-AMBIGUOUS-ACTION-NAMES (advisory). Each item of a list repeated the same
 * button names, so in a screen reader's list of buttons, or moving from button to
 * button, nothing said which facility, grant, notification or contact a button
 * acted on. Each name now starts with the visible text and goes on to name its
 * item, with something unique to it: one facility can send several requests.
 */
const names = (pattern: RegExp) => screen.getAllByRole('button', { name: pattern }).map(button => button.textContent ?? '')
const distinct = (values: string[]) => new Set(values).size === values.length

const request = (id: string, facilityName: string, requestedAt: string): AccessRequest => ({
  accessRequestId: id, facilityId: 'facility-1', facilityName, scope: 'read_records', reason: 'Follow-up', status: 'pending',
  requestedDurationMinutes: 60, requestedAt, approvedAt: null, deniedAt: null, deniedReason: null,
})
const grant = (id: string, facilityName: string, startsAt: string) => ({
  consentGrantId: id, scope: 'read_records', purpose: 'direct-care', status: 'active', startsAt, expiresAt: '2026-10-09T10:00:00Z',
  reason: null, facilityName, breakGlass: false, patientRevocable: true,
})

describe('per-item action names', () => {
  it('names the request or grant each access action is for', async () => {
    renderPortal(<AccessPage />, path => path === '/identity/me/access-requests' ? json([
      request('70000000-0000-4000-8000-000000000001', 'Lagos General', '2026-10-08T09:00:00Z'),
      request('70000000-0000-4000-8000-000000000002', 'Lagos General', '2026-10-08T14:30:00Z'),
      request('70000000-0000-4000-8000-000000000003', 'Ikeja Clinic', '2026-10-08T09:00:00Z'),
    ]) : json({ items: [
      grant('60000000-0000-4000-8000-000000000001', 'Lagos General', '2026-10-08T09:00:00Z'),
      grant('60000000-0000-4000-8000-000000000002', 'Lagos General', '2026-10-08T15:00:00Z'),
    ] }))
    await screen.findAllByText('Lagos General')
    // The redesign lists each request as one Review button; Approve and Deny are in the drawer it opens.
    expect(distinct(names(/ Review the request from /))).toBe(true)
    expect(names(/ Review the request from Ikeja Clinic/)).toHaveLength(1)
    expect(names(/ Review the request from Lagos General/)).toHaveLength(2)
    await press(screen.getAllByRole('button', { name: / Review the request from Lagos General/ })[1]!)
    expect(names(/^Approve the request from Lagos General, read_records, /)).toHaveLength(1)
    expect(names(/^Deny the request from Lagos General, read_records, /)).toHaveLength(1)
    await press(screen.getByRole('button', { name: /^Who has access/ }))
    expect(distinct(names(/^End access /))).toBe(true)
    expect(names(/^End access for Lagos General/)).toHaveLength(2)
  })

  it('names the notification each Mark as read is for', async () => {
    renderPortal(<NotificationsPage />, () => json([
      { id: 'n-1', notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request', resourceId: null, metadata: {}, readAt: null, createdAt: '2026-10-08T09:00:00Z' },
      { id: 'n-2', notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request', resourceId: null, metadata: {}, readAt: null, createdAt: '2026-10-08T14:30:00Z' },
    ]))
    await screen.findAllByRole('listitem')
    const marks = names(/^Mark as read: A hospital or clinic asked to see your health records/)
    expect(marks).toHaveLength(2)
    expect(distinct(marks)).toBe(true)
  })

  it('names the contact each contact action is for', async () => {
    const contact = (index: number, name: string): EmergencyContact => ({
      contactId: `a0000000-0000-4000-8000-00000000000${index}`, name, relationship: 'sibling', channel: 'sms',
      destinationHint: `+234•••••56${index}`, status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true,
      eligibleForEmergencyNotification: false, version: 1, pendingVerification: null, lastNotification: null,
    })
    renderPortal(<EmergencyContactsCard />, () => json([contact(1, 'Chidi Okafor'), contact(2, 'Ngozi Eze')]))
    await screen.findByText('Ngozi Eze')
    expect(screen.getByRole('button', { name: 'Send code to Chidi Okafor, +234•••••561' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Ngozi Eze, +234•••••562' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Chidi Okafor, +234•••••561' })).toBeTruthy()
  })
})
