import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SettingsPage } from '../routes/Portal'
import { json, problem, profile, renderPortal } from './portalHarness'

/**
 * Linking Google in Settings asks for the current password, which can be shown
 * like any other (@hid/ui PasswordInput). Google's own button sends it, not a
 * form, so each attempt masks it again by remounting the field.
 */
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, disabled }: { onCredential: (token: string) => Promise<void>; disabled: boolean }) =>
    <button type="button" disabled={disabled} onClick={() => { void onCredential('google-id-token') }}>Continue with Google</button>,
}))

beforeEach(() => { vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client') })
afterEach(() => { vi.unstubAllEnvs() })

describe('the Google link card’s current password', () => {
  it('can be shown, and is masked again after an attempt, keeping what was typed', async () => {
    const { sent } = renderPortal(<SettingsPage />, path => {
      if (path === '/identity/me') return json(profile)
      if (path === '/identity/me/emergency-contacts') return json([])
      if (path === '/identity/me/account-deletion') return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
      if (path === '/auth/google/link') return problem(401, 'AUTHENTICATION_FAILED', 'The current password is incorrect.')
      return json({}, 404)
    })
    const card = within((await screen.findByRole('heading', { name: 'Link a Google account' })).closest('.patient-card') as HTMLElement)
    fireEvent.change(card.getByLabelText('Email or Health ID'), { target: { value: 'ada@example.test' } })
    const password = card.getByLabelText('Current password') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'typed-secret-123' } })
    const toggle = card.getByRole('button', { name: 'Show password', pressed: false })
    expect(toggle.getAttribute('aria-controls')).toBe(password.id)
    fireEvent.click(toggle)
    expect(password.type).toBe('text')

    fireEvent.click(card.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(card.getByRole('button', { name: 'Continue with Google' })) })
    await waitFor(() => expect(sent.some(request => request.path === '/auth/google/link')).toBe(true))
    expect(await screen.findByText('The current password is incorrect.')).toBeTruthy()
    const after = card.getByLabelText('Current password') as HTMLInputElement
    expect(after.type).toBe('password')
    expect(after.value).toBe('typed-secret-123')
    expect(card.getByRole('button', { name: 'Show password', pressed: false })).toBeTruthy()
  })
})
