import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccountDeletionStatus, type EmergencyContact } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccountDeletionCard, EmergencyContactsCard } from '../routes/AccountSafety'
import { AccessPage } from '../routes/Portal'
import { ToastProvider } from '../kasuwa/toast'
import { described, shownText } from './portalHarness'
import { enterCode } from './codeBoxes'

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

    expect(await screen.findByText(/^This signs you out everywhere and removes your Access PIN.* and the access you gave\. Your Health ID and medical records are kept\. You have 14 days to change your mind; after that, it can’t be undone\.$/)).toBeTruthy()
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

    expect(await screen.findByText(/^Your account will be deleted on/)).toBeTruthy()
    expect(requests.find(request => request.path.endsWith('/confirm'))?.body)
      .toEqual({ requestId: 'req-1', confirmationToken: token, confirmation: 'delete my account' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(await screen.findByText('Deletion cancelled. Your account stays open.')).toBeTruthy()
    expect(requests.find(request => request.path.endsWith('/cancel'))?.body).toEqual({ requestId: 'req-1' })
  })

  it('asks for a fresh sign-in when the backend requires recent authentication', async () => {
    renderWith(<AccountDeletionCard />, (path, method) => method === 'GET' ? json(noRequest)
      : json({ code: 'PATIENT_RECENT_AUTH_REQUIRED', detail: 'Sign in again before deleting your account' }, 403))
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to delete account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('For your safety, sign out, sign in again, then come back within 10 minutes.')
    expect(screen.queryByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })).toBeNull()
  })

  it('explains a retention or legal-hold block without exposing internal terms', async () => {
    renderWith(<AccountDeletionCard />, () => json({ ...noRequest, request: { requestId: 'req-2', state: 'blocked',
      requestedAt: '2026-10-08T10:00:00Z', confirmationExpiresAt: null, scheduledFor: null, blockedReasonCode: 'LEGAL_HOLD',
      cancelledAt: null, cancellable: false } }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('some records are on legal hold')
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
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
    expect(screen.getByText(/signed out on all devices/)).toBeTruthy()
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
    expect(within(items[0]!).getByText('Not verified · won’t be told')).toBeTruthy()
    expect(within(items[1]!).getByText('Verified · will be told in an emergency')).toBeTruthy()
    expect(within(items[2]!).getByText('Verified · alerts off')).toBeTruthy()
    // What hid-system main's alert carries: the first name, the facility and the time.
    expect(screen.getByText('If a hospital opens your records in an emergency, verified contacts are told your first name, where and when. Never your medical details.')).toBeTruthy()
    expect(screen.queryByText(/last four characters of your Health ID/)).toBeNull()
  })

  it('keeps main\'s card where availability is not served (main-v1, 404): the list, every action and both channels', async () => {
    const requests = renderWith(<EmergencyContactsCard />, path => path.endsWith('/availability')
      ? json({ code: 'NOT_FOUND', detail: 'Cannot GET /api/v1/identity/me/emergency-contacts/availability' }, 404) : json([contact()]))
    expect(await screen.findByText('Not verified · won’t be told')).toBeTruthy()
    expect(requests.map(request => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v1/identity/me/emergency-contacts/availability', 'GET /api/v1/identity/me/emergency-contacts'])
    expect(screen.queryByRole('alert')).toBeNull()
    for (const name of [/^Send code/, /^Edit/, /^Remove/]) expect(screen.getByRole('button', { name })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add emergency contact' }))
    const reach = screen.getByRole('combobox', { name: 'How should we reach them?' }) as HTMLSelectElement
    expect([...reach.options].map(option => option.textContent)).toEqual(['SMS', 'Email'])
    expect(reach.value).toBe('sms')
    expect(described(screen.getByRole('textbox', { name: 'Phone number' }))).toBe('Like 0803 123 4567 or +234 803 123 4567.')
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: ' Chidi Okafor ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '0803 123 4567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText(/Contact added/)).toBeTruthy()
    expect(requests.find(request => request.method === 'POST' && request.path.endsWith('/emergency-contacts'))?.body)
      .toEqual({ name: 'Chidi Okafor', relationship: 'relative', channel: 'sms', destination: '0803 123 4567', notifyOnEmergencyAccess: true })

    fireEvent.click(await screen.findByRole('button', { name: 'Send code to Chidi Okafor, +234•••••567' }))
    // Six boxes, as every code a patient types (CodeBoxes.tsx): the sixth digit sends it, once.
    const code = await screen.findByRole('textbox', { name: /Code from Chidi Okafor/ })
    expect(screen.getByRole('group', { name: 'Code from Chidi Okafor' }).querySelectorAll('input')).toHaveLength(6)
    await enterCode(code, '482913')
    expect(await screen.findByText('Verified · will be told in an emergency')).toBeTruthy()
    expect(requests.filter(request => request.path.endsWith('/verification/confirm')).map(request => request.body))
      .toEqual([{ challengeId: expect.any(String), code: '482913' }])
  })

  it('keeps the contact unverified when delivery is not yet available', async () => {
    const requests = renderWith(<EmergencyContactsCard />, (path, method) => method === 'GET' ? json([contact()])
      : json({ code: 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE', detail: 'Emergency contact verification is not yet available' }, 503))
    fireEvent.click(await screen.findByRole('button', { name: 'Send code to Chidi Okafor, +234•••••567' }))
    // Main's 503 carries its code: it is said as switched off, not as a send to try again later.
    expect(shownText(await screen.findByRole('alert')))
      .toBe('Codes can’t be sent right now. They stay unverified and won’t be told in an emergency.')
    expect(screen.queryByRole('textbox', { name: /Code from/ })).toBeNull()
    await waitFor(() => expect(requests.filter(request => request.path.endsWith('/availability'))).toHaveLength(2))
  })

  it('says a code could not be sent right now when the gateway answers 503 UPSTREAM_UNAVAILABLE', async () => {
    renderWith(<EmergencyContactsCard />, (path, method) => method === 'GET' ? json([contact()])
      : json({ code: 'UPSTREAM_UNAVAILABLE', detail: 'A required platform service is temporarily unavailable.', retryable: false }, 503))
    fireEvent.click(await screen.findByRole('button', { name: 'Send code to Chidi Okafor, +234•••••567' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('The code couldn’t be sent. They stay unverified and won’t be told '
      + 'in an emergency. Try again later.')
    expect(screen.queryByRole('textbox', { name: /Code from/ })).toBeNull()
  })

  it('removes a contact only after confirmation', async () => {
    const requests = renderWith(<EmergencyContactsCard />, (path, method) => method === 'GET' ? json([contact()])
      : json({ contactId: contact().contactId, status: 'deactivated', replayed: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Chidi Okafor, +234•••••567' }))
    expect(requests.some(request => request.path.endsWith('/deactivate'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(requests.some(request => request.path.endsWith('/deactivate'))).toBe(true))
  })
})

describe('patient access revocation', () => {
  it('revokes through the patient route and never offers revocation of emergency access', async () => {
    // The outcome is said in a toast (the shell's ToastProvider).
    const requests = renderWith(<ToastProvider><AccessPage /></ToastProvider>, (path, method) => {
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
    // Who has access: its own tab since the redesign.
    fireEvent.click(await screen.findByRole('button', { name: /^Who has access/ }))
    expect(await screen.findByText(/^Emergency access · until /)).toBeTruthy()
    expect(screen.getByText(/you can’t end it here/)).toBeTruthy()
    const revokeButtons = screen.getAllByRole('button', { name: /^End access for / })
    expect(revokeButtons).toHaveLength(1)
    expect(revokeButtons[0]!.textContent).toMatch(/Lagos General/)
    fireEvent.click(revokeButtons[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Why are you ending it?' }), { target: { value: 'No longer needed' } })
    const drawer = screen.getByRole('dialog')
    fireEvent.click(within(drawer).getByRole('button', { name: 'End access' }))
    expect(await screen.findByText('Lagos General can no longer see your records.')).toBeTruthy()
    const revoke = requests.find(request => request.method === 'POST')
    expect(revoke).toEqual({ path: '/api/v1/identity/me/consent-grants/60000000-0000-4000-8000-000000000001/revoke',
      method: 'POST', body: { reason: 'No longer needed' } })
    expect(requests.some(request => request.path.includes('/consent-grants/') && request.path.endsWith('/close'))).toBe(false)
  })

  // hid-system has no review of emergency access (it only marks one as needing review), so the portal claims none.
  it('says emergency access is time-limited and audited, and claims no review', async () => {
    renderWith(<AccessPage />, path => {
      if (path.endsWith('/me/access-requests')) return json([])
      if (path.endsWith('/me/access-history')) return json({ items: [
        { consentGrantId: '60000000-0000-4000-8000-000000000002', scope: 'break_glass', purpose: 'emergency', status: 'active',
          startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T10:30:00Z', reason: 'Unconscious patient', facilityName: 'Ikeja ER',
          breakGlass: true, patientRevocable: false },
      ] })
      return json({}, 404)
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Who has access/ }))
    const explanation = await screen.findByText(/^Used in an emergency\./)
    // Time-limited (it ends by itself), and not the patient's to end; every view is recorded, as the page says.
    expect(explanation.textContent).toBe('Used in an emergency. It ends by itself, and you can’t end it here.')
    expect(screen.queryByText(/reviewed/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^End access/ })).toBeNull()
  })
})
