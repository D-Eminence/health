import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SettingsPage } from '../routes/Portal'
import { described, json, problem, profile, renderPortal, type Handler } from './portalHarness'

/**
 * The patient's Access PIN, POST and DELETE /identity/me/access-pin (hid-system
 * patient-self.controller.ts). The PIN is 4 to 8 digits
 * (set-patient-access-pin.dto.ts), and both commands need a sign-in within the
 * last 10 minutes (403 PATIENT_RECENT_AUTH_REQUIRED, recent-authentication.ts).
 */
function renderSettings(pin: Handler) {
  let configured = false
  return renderPortal(<SettingsPage />, (path, method, body) => {
    if (path === '/identity/me/access-pin') {
      const answer = pin(path, method, body) as Response
      if (answer.ok) configured = method === 'POST'
      return answer
    }
    if (path === '/identity/me') return json({ ...profile, accessPinConfigured: configured })
    if (path === '/identity/me/emergency-contacts') return json([])
    if (path === '/identity/me/account-deletion') return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
    return json({}, 404)
  })
}

const pinCard = () => within(screen.getByRole('heading', { name: 'Access PIN' }).closest('.patient-card') as HTMLElement)

describe('patient Access PIN', () => {
  it('sets a PIN of 4 to 8 digits, clears the field and shows it configured', async () => {
    const { sent } = renderSettings(() => json({ configured: true }))
    expect(await screen.findByText('Not configured')).toBeTruthy()
    const input = pinCard().getByLabelText('Set PIN') as HTMLInputElement
    const save = pinCard().getByRole('button', { name: 'Save PIN' }) as HTMLButtonElement
    fireEvent.change(input, { target: { value: '12a' } })
    expect(input.value).toBe('12')
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '1234' } })
    fireEvent.click(save)

    expect(await screen.findByText('Access PIN configured.')).toBeTruthy()
    expect(await screen.findByText('Configured')).toBeTruthy()
    expect((pinCard().getByLabelText('Replace PIN') as HTMLInputElement).value).toBe('')
    expect(sent.filter(request => request.path === '/identity/me/access-pin')).toEqual([
      { path: '/identity/me/access-pin', method: 'POST', body: { pin: '1234' } },
    ])
  })

  it('revokes a configured PIN with DELETE', async () => {
    const { sent } = renderSettings((_path, method) => method === 'POST' ? json({ configured: true }) : json({ revoked: true }))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '87654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Access PIN' }))

    expect(await screen.findByText('Access PIN revoked.')).toBeTruthy()
    expect(await screen.findByText('Not configured')).toBeTruthy()
    expect(sent.filter(request => request.path === '/identity/me/access-pin').map(request => request.method)).toEqual(['POST', 'DELETE'])
    expect(screen.queryByRole('button', { name: 'Revoke Access PIN' })).toBeNull()
  })

  it('states the 10-minute sign-in rule beside the PIN', async () => {
    renderSettings(() => json({ configured: true }))
    expect(described(await screen.findByLabelText('Set PIN'))).toContain('You must have signed in within the last 10 minutes to change it.')
  })

  it('keeps the status and says how to sign in again when a recent sign-in is required', async () => {
    renderSettings(() => problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before changing your Access PIN'))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    // As for account deletion: the patient is signed in, so 'sign in again' alone does not say how.
    expect((await screen.findByRole('alert')).textContent)
      .toBe('For your security, sign out, sign in again, and return here within 10 minutes to change your Access PIN.')
    expect(screen.getByText('Not configured')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Set PIN') as HTMLInputElement).value).toBe('1234'))
  })

  // P4c review (Identity, as main): setting a PIN is held for 24 hours after an OTP account recovery; revoking is not.
  it('says Identity’s words when a PIN is held after an account recovery, and keeps the status', async () => {
    const detail = 'This account was recovered with a verification code less than 24 hours ago; Access PIN changes are '
      + 'available again once that period ends'
    renderSettings(() => problem(403, 'PATIENT_RECENT_RECOVERY_HOLD', detail))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    expect((await screen.findByRole('alert')).textContent).toBe(detail)
    expect(screen.getByText('Not configured')).toBeTruthy()
  })

  it('says how to sign in again when revoking the PIN needs a recent sign-in', async () => {
    renderSettings((_path, method) => method === 'POST' ? json({ configured: true })
      : problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before changing your Access PIN'))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Access PIN' }))

    expect((await screen.findByRole('alert')).textContent)
      .toBe('For your security, sign out, sign in again, and return here within 10 minutes to change your Access PIN.')
    expect(screen.getByText('Configured')).toBeTruthy()
  })
})
