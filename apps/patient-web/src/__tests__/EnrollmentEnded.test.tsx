import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Enrollment } from '../routes/Enrollment'

const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), enrollmentStart: vi.fn(), enrollmentContact: vi.fn(),
  enrollmentVerify: vi.fn(), enrollmentActivate: vi.fn(), enrollmentAvailability: vi.fn(),
}))

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, acceptGoogleSession: vi.fn(),
    otherPortalSession: false, retrySessionCheck: vi.fn() }),
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) => {
    return <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>
  },
}))

const NIN = '12345678901'
const ENDED = /This enrollment ended on this device/
const notFound = () => new HidApiError(404, 'No pending enrollment was found', { code: 'ENROLLMENT_NOT_FOUND' })
const signOutFirst = () => new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
  { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' })

beforeEach(() => {
  api.enrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment', { code: 'ENROLLMENT_NOT_FOUND' }))
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
  api.enrollmentAvailability.mockResolvedValue({ open: true })
  api.enrollmentStart.mockResolvedValue({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a***@example.com' })
})
afterEach(() => { vi.clearAllMocks() })

async function startEnrollment() {
  render(<MemoryRouter><Enrollment /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('National Identification Number'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
  return screen.findByLabelText('Verification code')
}

/**
 * Since hid-system #50 every sign-in, refresh and sign-out expires the
 * enrollment cookie (identity enrollment-cookie.ts clearEnrollmentCookie), and
 * without it each enrollment step answers 404 ENROLLMENT_NOT_FOUND
 * (patient-enrollment.service.ts requireEnrollment). A start sent again with the
 * same Idempotency-Key and NIN restores the cookie; a new key is refused as a
 * duplicate for 24 hours. So the page goes back to the NIN step, keeps the key it
 * started with, and says to enter the same NIN.
 */
describe('an enrollment that ended on this device', () => {
  it('goes back to the NIN step when a step finds it gone, and continues it with the same key', async () => {
    const code = await startEnrollment()
    api.enrollmentVerify.mockRejectedValue(notFound())
    fireEvent.change(code, { target: { value: '123456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })

    const nin = await screen.findByLabelText('National Identification Number')
    expect(screen.getByText(ENDED).textContent).toMatch(/Enter the same NIN to continue it\./)
    expect(screen.queryByLabelText('Verification code')).toBeNull()
    expect(screen.queryByText(/sent to a\*\*\*@example\.com/)).toBeNull()

    fireEvent.change(nin, { target: { value: NIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(api.enrollmentStart).toHaveBeenCalledTimes(2))
    expect(api.enrollmentStart.mock.calls[1]![2]).toBe(api.enrollmentStart.mock.calls[0]![2])
    expect(await screen.findByLabelText('Verification code')).toBeTruthy()
  })

  it('goes back to the NIN step when a check made after signing out finds no enrollment', async () => {
    const code = await startEnrollment()
    // Someone signed in on this device meanwhile: the step is refused until they sign out.
    api.enrollmentVerify.mockRejectedValue(signOutFirst())
    fireEvent.change(code, { target: { value: '123456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })
    const check = await screen.findByRole('button', { name: 'Check again' })

    // They signed out, which ended the enrollment here too.
    await act(async () => { fireEvent.click(check) })
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    expect(screen.getByText(ENDED)).toBeTruthy()
    expect(screen.queryByLabelText('Verification code')).toBeNull()
  })

  it('says, where it asks for a sign-out, that signing out ends an enrollment in progress here', async () => {
    api.enrollmentCurrent.mockRejectedValue(signOutFirst())
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    expect(await screen.findByText(/Signing out also ends an enrollment in progress on this device/)).toBeTruthy()
    expect(screen.getByText(/continue it by entering the same NIN before reloading this page/)).toBeTruthy()
  })
})
