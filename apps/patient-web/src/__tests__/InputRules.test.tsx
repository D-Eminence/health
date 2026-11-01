import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { EmergencyContact } from '../api'
import { AccessPage, ProfilePage } from '../routes/Portal'
import { EmergencyContactsCard } from '../routes/AccountSafety'
import { described, json, press, problem, profile, renderPortal, type Handler } from './portalHarness'

/**
 * A rule the server enforces is stated where it is typed, not left to a button
 * that stays disabled until it is met (PR-07, PR-08, NEW-UNSTATED-INPUT-RULES).
 * The rules are hid-system's: an Access PIN of 4 to 8 digits
 * (set-patient-access-pin.dto.ts), a reason of 3 to 500 characters to deny or
 * revoke (deny-access-request.dto.ts, revoke-consent-grant.dto.ts), a contact
 * name of 2 to 120 characters (emergency-contact.dto.ts) and up to five contacts
 * (emergency-contact.service.ts). The profile's 11-digit NIN is not offered
 * until P27 (ProfileNinVerification.test.tsx).
 * A refusal about the value is tied to its field.
 */
const settings = (pin: Handler) => renderPortal(<ProfilePage />, (path, method, body) => {
  if (path === '/identity/me/access-pin') return pin(path, method, body)
  if (path === '/identity/me') return json(profile)
  if (path === '/identity/me/emergency-contacts') return json([])
  return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
}, {}, { at: '/profile#access-pin' })

describe('Access PIN', () => {
  it('says the PIN is 4 to 8 digits', async () => {
    settings(() => json({ configured: true }))
    expect(described(await screen.findByLabelText('Set PIN'))).toContain('4 to 8 digits.')
  })

  it('ties a refused PIN to the field, and returns focus to it', async () => {
    settings(() => problem(400, 'VALIDATION_FAILED', 'The PIN must be 4 to 8 digits'))
    const input = await screen.findByLabelText('Set PIN')
    fireEvent.change(input, { target: { value: '1234' } })
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
    expect(described(input)).toContain('Your PIN must be 4 to 8 digits.')
    expect(document.activeElement).toBe(input)
  })

  it('does not mark the PIN invalid for a refusal about something else', async () => {
    settings(() => problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before changing your Access PIN'))
    const input = await screen.findByLabelText('Set PIN')
    fireEvent.change(input, { target: { value: '1234' } })
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    expect((await screen.findByRole('alert')).textContent).toContain('sign in again')
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })
})

/** Opens the pending request, then Deny, then "Other…", as the patient does. */
async function denyWithOwnWords() {
  await press(await screen.findByRole('button', { name: / Review the request from Lagos General/ }))
  await press(screen.getByRole('button', { name: /^Deny the request/ }))
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Other…' })) })
}
/** Opens Who has access, then End access on the grant, as the patient does. */
async function endAccess() {
  await press(await screen.findByRole('button', { name: /^Who has access/ }))
  await press(await screen.findByRole('button', { name: /^End access for Ikeja Clinic/ }))
}

describe('reasons and contacts', () => {
  it('says a denial or revocation needs a reason of at least 3 characters', async () => {
    renderPortal(<AccessPage />, path => path === '/identity/me/access-requests'
      ? json([{ accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
        reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z', approvedAt: null, deniedAt: null, deniedReason: null }])
      : json({ items: [{ consentGrantId: '60000000-0000-4000-8000-000000000001', scope: 'read_records', purpose: 'direct-care', status: 'active',
        startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T11:00:00Z', reason: 'Follow-up', facilityName: 'Ikeja Clinic', breakGlass: false, patientRevocable: true }] }))
    // The redesign: Deny is in the request's drawer, with one-tap reasons; "Other" takes the patient's own words.
    await denyWithOwnWords()
    expect(described(screen.getByRole('textbox', { name: 'Your reason' }))).toContain('At least 3 characters.')
    await endAccess()
    expect(described(screen.getByRole('textbox', { name: 'Why are you ending it?' }))).toContain('At least 3 characters.')
  })

  // Revoking a grant leaves the Access PIN valid (hid-system, as main), so a facility that knows it can use it again.
  it('says a revoked facility can use a known Access PIN again, and where to change it; a denial does not', async () => {
    renderPortal(<AccessPage />, path => path === '/identity/me/access-requests'
      ? json([{ accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
        reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z', approvedAt: null, deniedAt: null, deniedReason: null }])
      : json({ items: [{ consentGrantId: '60000000-0000-4000-8000-000000000001', scope: 'read_records', purpose: 'direct-care', status: 'active',
        startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T11:00:00Z', reason: 'Follow-up', facilityName: 'Ikeja Clinic', breakGlass: false, patientRevocable: true }] }))
    await endAccess()
    expect(described(screen.getByRole('textbox', { name: 'Why are you ending it?' }))).toBe('At least 3 characters. | If they have your '
      + 'Access PIN, they can use it to get access again. Change it in your profile too.')
    await press(screen.getByRole('button', { name: 'Cancel' }))
    await press(screen.getByRole('button', { name: /^Requests/ }))
    await denyWithOwnWords()
    expect(described(screen.getByRole('textbox', { name: 'Your reason' }))).toBe('At least 3 characters.')
  })

  it('says a contact name needs at least 2 characters, and that five contacts is the limit', async () => {
    const contact = (index: number): EmergencyContact => ({
      contactId: `a0000000-0000-4000-8000-00000000000${index}`, name: `Contact ${index}`, relationship: 'sibling', channel: 'sms',
      destinationHint: '+234•••••567', status: 'verified', verifiedAt: '2026-10-08T10:00:00Z', notifyOnEmergencyAccess: true,
      eligibleForEmergencyNotification: true, version: 1, pendingVerification: null, lastNotification: null,
    })
    renderPortal(<EmergencyContactsCard />, () => json([1, 2, 3, 4, 5].map(contact)))
    const add = await screen.findByRole('button', { name: 'Add emergency contact' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(described(add)).toContain('Up to 5 contacts.')
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit/ })[0]!)
    expect(described(screen.getByRole('textbox', { name: 'Name' }))).toContain('At least 2 characters.')
  })

  it('says a new contact name needs at least 2 characters', async () => {
    renderPortal(<EmergencyContactsCard />, () => json([]))
    fireEvent.click(await screen.findByRole('button', { name: 'Add emergency contact' }))
    expect(described(screen.getByRole('textbox', { name: 'Name' }))).toContain('At least 2 characters.')
  })
})
