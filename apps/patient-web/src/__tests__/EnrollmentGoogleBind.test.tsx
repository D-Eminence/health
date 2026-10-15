import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Enrollment } from '../routes/Enrollment'

const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), googleExchange: vi.fn(), enrollmentBindGoogle: vi.fn(),
  enrollmentAvailability: vi.fn(),
}))

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, acceptGoogleSession: vi.fn() }),
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) => {
    return <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>
  },
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, disabled }: { onCredential: (token: string) => Promise<void>; disabled: boolean }) =>
    <button type="button" disabled={disabled} onClick={() => { void onCredential('google-id-token') }}>Sign up with Google</button>,
}))

beforeEach(() => {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
  api.enrollmentAvailability.mockResolvedValue({ open: true })
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

/**
 * Linking Google during enrollment answers only `{ bound: true }`. The page must
 * keep the patient at the step the enrollment has reached, not send them back to
 * the contact step, where a second contact is refused.
 */
describe('linking Google to an enrollment in progress', () => {
  it('keeps a patient who reached the password step at that step', async () => {
    api.enrollmentCurrent
      .mockResolvedValueOnce({ stage: 'set_password', googleOnboardingRequired: true })
      .mockResolvedValueOnce({ stage: 'set_password' })
    api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
    api.googleExchange.mockResolvedValue({ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY', expiresAt: '2099-01-01T00:00:00.000Z' })
    api.enrollmentBindGoogle.mockResolvedValue({ bound: true })
    render(<MemoryRouter><Enrollment /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Activate your account' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Complete check' }).at(-1)!)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' })) })

    expect(api.enrollmentBindGoogle).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Activate your account' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where should we send your code?' })).toBeNull()
    expect(screen.getByText('Google identity confirmed for this enrollment.')).toBeTruthy()
  })
})

describe('checking for an enrollment in progress', () => {
  it('starts enrollment when only the Google sign-up check fails', async () => {
    api.enrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment'))
    api.googleOnboarding.mockRejectedValue(new HidApiError(403, 'Request origin is not allowed', { code: 'ORIGIN_DENIED' }))
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    expect(screen.queryByText(/could not check for an enrollment in progress/)).toBeNull()
  })

  it('does not start while the enrollment’s own progress is unknown', async () => {
    api.enrollmentCurrent.mockRejectedValue(new HidApiError(503, 'Unavailable'))
    api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    expect(await screen.findByText(/could not check for an enrollment in progress/)).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
  })
})
