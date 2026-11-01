import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ProfilePage } from '../routes/Portal'
import { SAY } from '../copy'
import { described, json, problem, profile, renderPortal, shownText, type Handler } from './portalHarness'

/**
 * The patient's Access PIN, at the end of the profile's Bio-data (Settings is gone: the owner's decision of 2026-10-28;
 * a link to #access-pin opens Bio-data), POST and DELETE /identity/me/access-pin (hid-system
 * patient-self.controller.ts). The PIN is 4 to 8 digits
 * (set-patient-access-pin.dto.ts), and both commands need a sign-in within the
 * last 10 minutes (403 PATIENT_RECENT_AUTH_REQUIRED, recent-authentication.ts).
 */
function renderSettings(pin: Handler) {
  let configured = false
  return renderPortal(<ProfilePage />, (path, method, body) => {
    if (path === '/identity/me/access-pin') {
      const answer = pin(path, method, body) as Response
      if (answer.ok) configured = method === 'POST'
      return answer
    }
    if (path === '/identity/me') return json({ ...profile, accessPinConfigured: configured })
    if (path === '/identity/me/emergency-contacts') return json([])
    if (path === '/identity/me/account-deletion') return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
    return json({}, 404)
  }, {}, { at: '/profile#access-pin' })
}

const pinCard = () => within(screen.getByRole('heading', { name: 'Access PIN' }).closest('#access-pin') as HTMLElement)

describe('patient Access PIN', () => {
  it('sets a PIN of 4 to 8 digits, clears the field and shows it configured', async () => {
    const { sent } = renderSettings(() => json({ configured: true }))
    expect(await screen.findByText('Not set')).toBeTruthy()
    const input = pinCard().getByLabelText('Set PIN') as HTMLInputElement
    const save = pinCard().getByRole('button', { name: 'Save PIN' }) as HTMLButtonElement
    fireEvent.change(input, { target: { value: '12a' } })
    expect(input.value).toBe('12')
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '1234' } })
    fireEvent.click(save)

    expect(await screen.findByText('PIN saved.')).toBeTruthy()
    expect(await screen.findByText('Set')).toBeTruthy()
    expect((pinCard().getByLabelText('New PIN') as HTMLInputElement).value).toBe('')
    expect(sent.filter(request => request.path === '/identity/me/access-pin')).toEqual([
      { path: '/identity/me/access-pin', method: 'POST', body: { pin: '1234' } },
    ])
  })

  it('revokes a configured PIN with DELETE', async () => {
    const { sent } = renderSettings((_path, method) => method === 'POST' ? json({ configured: true }) : json({ revoked: true }))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '87654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove PIN' }))

    expect(await screen.findByText('PIN removed.')).toBeTruthy()
    expect(await screen.findByText('Not set')).toBeTruthy()
    expect(sent.filter(request => request.path === '/identity/me/access-pin').map(request => request.method)).toEqual(['POST', 'DELETE'])
    expect(screen.queryByRole('button', { name: 'Remove PIN' })).toBeNull()
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
    expect(shownText(await screen.findByRole('alert'))).toBe(SAY.signInAgain)
    expect(SAY.signInAgain).toContain('sign out, sign in again, then come back within 10 minutes')
    expect(screen.getByText('Not set')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Set PIN') as HTMLInputElement).value).toBe('1234'))
  })

  // P4c review (Identity, as main): setting a PIN is held for 24 hours after an OTP account recovery; revoking is not.
  it('says a PIN held after an account recovery in plain words, and keeps the status', async () => {
    const detail = 'This account was recovered with a verification code less than 24 hours ago; Access PIN changes are '
      + 'available again once that period ends'
    renderSettings(() => problem(403, 'PATIENT_RECENT_RECOVERY_HOLD', detail))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('For your safety, you can’t change your Access PIN for 24 hours after you recover your account.')
    expect(screen.queryByText(detail)).toBeNull()
    expect(screen.getByText('Not set')).toBeTruthy()
  })

  it('says how to sign in again when revoking the PIN needs a recent sign-in', async () => {
    renderSettings((_path, method) => method === 'POST' ? json({ configured: true })
      : problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before changing your Access PIN'))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove PIN' }))

    expect(shownText(await screen.findByRole('alert'))).toBe(SAY.signInAgain)
    expect(SAY.signInAgain).toContain('sign out, sign in again, then come back within 10 minutes')
    expect(screen.getByText('Set')).toBeTruthy()
  })

  it('is in About you (once Bio-data), after the email and phone, and a link to #access-pin opens it with focus on its heading', async () => {
    renderSettings(() => json({ configured: true }))
    const title = await screen.findByRole('heading', { name: 'Access PIN', level: 3 })
    const bio = document.getElementById('bio-data-content') as HTMLElement
    expect(bio.hidden).toBe(false)
    expect(bio.contains(title)).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(title))
    // The profile's Settings section holds this device's settings only: the PIN is not in it.
    const settings = screen.queryByRole('heading', { name: 'Settings' })?.closest('section')
    expect(settings?.contains(title) ?? false).toBe(false)
  })
})
