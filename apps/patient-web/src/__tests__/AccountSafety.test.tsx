import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccountDeletionStatus, type EmergencyContact } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccountDeletionCard, EmergencyContactsCard } from '../routes/AccountSafety'
import { AccessPage } from '../routes/Portal'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

type Handler = (path: string, method: string, body: unknown) => Response | Promise<Response>

function renderWith(ui: React.ReactElement, handler: Handler) {
  const requests: Array<{ path: string; method: string; body: unknown }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
    requests.push({ path, method, body })
    return handler(path, method, body)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}>{ui}</SessionContext.Provider></MemoryRouter>)
  return requests
}

const noRequest: AccountDeletionStatus = { waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }
const token = 'A'.repeat(43)

describe('patient account deletion', () => {
  it('explains consequences, requires acknowledgement and the typed phrase, then schedules a cancellable deletion', async () => {
    let status: AccountDeletionStatus = noRequest
    const requests = renderWith(<AccountDeletionCard />, (path, method) => {
      if (path.endsWith('/account-deletion') && method === 'GET') return json(status)
      if (path.endsWith('/account-deletion') && method === 'POST') {
        return json({ requestId: 'req-1', confirmationToken: token, confirmationExpiresAt: '2026-10-08T10:10:00Z', waitingPeriodSeconds: 1_209_600 }, 201)
      }
      if (path.endsWith('/account-deletion/confirm')) {
        status = { ...noRequest, request: { requestId: 'req-1', state: 'pending', requestedAt: '2026-10-08T10:00:00Z',
          confirmationExpiresAt: null, scheduledFor: '2026-10-22T10:00:00Z', blockedReasonCode: null, cancelledAt: null, cancellable: true } }
        return json({ requestId: 'req-1', state: 'pending', scheduledFor: '2026-10-22T10:00:00Z', blockedReasonCode: null })
      }
      if (path.endsWith('/account-deletion/cancel')) {
        status = { ...noRequest, request: { ...status.request!, state: 'cancelled', cancellable: false, cancelledAt: '2026-10-08T10:05:00Z' } }
        return json({ requestId: 'req-1', state: 'cancelled', replayed: false })
      }
      return json({}, 404)
    })

    expect(await screen.findByText(/medical records facilities hold about you are kept/)).toBeTruthy()
    expect(screen.getByText(/You have 14 days to change your mind/)).toBeTruthy()
    expect(screen.getByText(/Some security and audit records must be kept/)).toBeTruthy()
    const proceed = screen.getByRole('button', { name: 'Continue to delete account' }) as HTMLButtonElement
    expect(proceed.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
    fireEvent.click(proceed)

    const phrase = await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })
    const remove = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    fireEvent.change(phrase, { target: { value: 'delete' } })
    expect(remove.disabled).toBe(true)
    fireEvent.change(phrase, { target: { value: 'delete my account' } })
    fireEvent.click(remove)

    expect(await screen.findByText(/scheduled for deletion on/)).toBeTruthy()
    expect(requests.find(request => request.path.endsWith('/confirm'))?.body)
      .toEqual({ requestId: 'req-1', confirmationToken: token, confirmation: 'delete my account' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(await screen.findByText('Account deletion cancelled. Your account stays open.')).toBeTruthy()
    expect(requests.find(request => request.path.endsWith('/cancel'))?.body).toEqual({ requestId: 'req-1' })
  })

  it('asks for a fresh sign-in when the backend requires recent authentication', async () => {
    renderWith(<AccountDeletionCard />, (path, method) => method === 'GET' ? json(noRequest)
      : json({ code: 'PATIENT_RECENT_AUTH_REQUIRED', detail: 'Sign in again before deleting your account' }, 403))
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to delete account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('sign in again, and return here within 10 minutes')
    expect(screen.queryByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })).toBeNull()
  })

  it('explains a retention or legal-hold block without exposing internal terms', async () => {
    renderWith(<AccountDeletionCard />, () => json({ ...noRequest, request: { requestId: 'req-2', state: 'blocked',
      requestedAt: '2026-10-08T10:00:00Z', confirmationExpiresAt: null, scheduledFor: null, blockedReasonCode: 'LEGAL_HOLD',
      cancelledAt: null, cancellable: false } }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('must be kept for a legal or regulatory reason')
    expect(alert.textContent).not.toMatch(/LEGAL_HOLD|legal_holds|retention_policies/)
  })

  it('shows the terminal state when deletion completes immediately', async () => {
    renderWith(<AccountDeletionCard />, (path, method) => {
      if (method === 'GET') return json({ ...noRequest, waitingPeriodSeconds: 0 })
      if (path.endsWith('/confirm')) return json({ requestId: 'req-3', state: 'completed', scheduledFor: '2026-10-08T10:00:00Z', blockedReasonCode: null })
      return json({ requestId: 'req-3', confirmationToken: token, confirmationExpiresAt: '2026-10-08T10:10:00Z', waitingPeriodSeconds: 0 }, 201)
    })
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to delete account' }))
    fireEvent.change(await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ }), { target: { value: 'DELETE MY ACCOUNT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(await screen.findByText('Your account has been deleted')).toBeTruthy()
    expect(screen.getByText(/signed out everywhere/)).toBeTruthy()
  })
})

const contact = (overrides: Partial<EmergencyContact> = {}): EmergencyContact => ({
  contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms',
  destinationHint: '+234•••••567', status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true,
  eligibleForEmergencyNotification: false, version: 1, pendingVerification: null, lastNotification: null, ...overrides,
})

describe('patient emergency contacts', () => {
  it('shows verification state and never presents an unverified contact as an emergency recipient', async () => {
    renderWith(<EmergencyContactsCard />, () => json([
      contact(),
      contact({ contactId: 'a0000000-0000-4000-8000-000000000002', name: 'Ngozi', status: 'verified',
        verifiedAt: '2026-10-08T10:00:00Z', eligibleForEmergencyNotification: true }),
      contact({ contactId: 'a0000000-0000-4000-8000-000000000003', name: 'Tunde', status: 'verified',
        verifiedAt: '2026-10-08T10:00:00Z', notifyOnEmergencyAccess: false, eligibleForEmergencyNotification: false }),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('Not verified · will not be notified')).toBeTruthy()
    expect(within(items[1]!).getByText('Verified · will be notified in an emergency')).toBeTruthy()
    expect(within(items[2]!).getByText('Verified · notifications off')).toBeTruthy()
    expect(screen.getByText(/never receive medical details/)).toBeTruthy()
  })

  it('adds a contact, sends a code, and verifies it with the challenge', async () => {
    let listed: EmergencyContact[] = []
    const requests = renderWith(<EmergencyContactsCard />, (path, method, body) => {
      if (path.endsWith('/emergency-contacts') && method === 'GET') return json(listed)
      if (path.endsWith('/emergency-contacts') && method === 'POST') { listed = [contact()]; return json(contact(), 201) }
      if (path.endsWith('/verification')) return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-08T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
      if (path.endsWith('/verification/confirm')) {
        expect(body).toEqual({ challengeId: 'b0000000-0000-4000-8000-000000000001', code: '482913' })
        listed = [contact({ status: 'verified', eligibleForEmergencyNotification: true, verifiedAt: '2026-10-08T10:01:00Z' })]
        return json({ contactId: listed[0]!.contactId, status: 'verified' })
      }
      return json({}, 404)
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Add emergency contact' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Contact name' }), { target: { value: ' Chidi Okafor ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '0803 123 4567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText(/Contact added/)).toBeTruthy()
    expect(requests.find(request => request.method === 'POST' && request.path.endsWith('/emergency-contacts'))?.body)
      .toEqual({ name: 'Chidi Okafor', relationship: 'relative', channel: 'sms', destination: '0803 123 4567', notifyOnEmergencyAccess: true })

    fireEvent.click(await screen.findByRole('button', { name: 'Send verification code to Chidi Okafor, +234•••••567' }))
    fireEvent.change(await screen.findByRole('textbox', { name: /Code from Chidi Okafor/ }), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify contact' }))
    expect(await screen.findByText('Verified · will be notified in an emergency')).toBeTruthy()
  })

  it('keeps the contact unverified when delivery is not yet available', async () => {
    renderWith(<EmergencyContactsCard />, (path, method) => method === 'GET' ? json([contact()])
      : json({ code: 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE', detail: 'Emergency contact verification is not yet available' }, 503))
    fireEvent.click(await screen.findByRole('button', { name: 'Send verification code to Chidi Okafor, +234•••••567' }))
    expect((await screen.findByRole('alert')).textContent).toContain('stays unverified and will not be notified')
    expect(screen.queryByRole('textbox', { name: /Code from/ })).toBeNull()
  })

  it('removes a contact only after confirmation', async () => {
    const requests = renderWith(<EmergencyContactsCard />, (path, method) => method === 'GET' ? json([contact()])
      : json({ contactId: contact().contactId, status: 'deactivated', replayed: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Chidi Okafor, +234•••••567' }))
    expect(requests.some(request => request.path.endsWith('/deactivate'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(requests.some(request => request.path.endsWith('/deactivate'))).toBe(true))
  })
})

describe('patient access revocation', () => {
  it('revokes through the patient route and never offers revocation of emergency access', async () => {
    const requests = renderWith(<AccessPage />, (path, method) => {
      if (path.endsWith('/me/access-requests')) return json([])
      if (path.endsWith('/me/access-history')) return json({ items: [
        { consentGrantId: '60000000-0000-4000-8000-000000000001', scope: 'read_records', purpose: 'direct-care', status: 'active',
          startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T11:00:00Z', reason: 'Follow-up', facilityName: 'Lagos General',
          breakGlass: false, patientRevocable: true },
        { consentGrantId: '60000000-0000-4000-8000-000000000002', scope: 'break_glass', purpose: 'emergency', status: 'active',
          startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T10:30:00Z', reason: 'Unconscious patient', facilityName: 'Ikeja ER',
          breakGlass: true, patientRevocable: false },
      ] })
      if (method === 'POST') return json({ consentGrantId: '60000000-0000-4000-8000-000000000001', status: 'revoked', replayed: false })
      return json({}, 404)
    })
    expect(await screen.findByText('Emergency access · emergency')).toBeTruthy()
    expect(screen.getByText(/cannot be revoked here/)).toBeTruthy()
    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke access for / })
    expect(revokeButtons).toHaveLength(1)
    fireEvent.click(revokeButtons[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for revocation' }), { target: { value: 'No longer needed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }))
    expect(await screen.findByText('Access grant revoked.')).toBeTruthy()
    const revoke = requests.find(request => request.method === 'POST')
    expect(revoke).toEqual({ path: '/api/v1/identity/me/consent-grants/60000000-0000-4000-8000-000000000001/revoke',
      method: 'POST', body: { reason: 'No longer needed' } })
    expect(requests.some(request => request.path.includes('/consent-grants/') && request.path.endsWith('/close'))).toBe(false)
  })
})
