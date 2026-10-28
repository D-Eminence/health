import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Enrollment } from '../routes/Enrollment'
import { enterCode } from './codeBoxes'

const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), enrollmentStart: vi.fn(), enrollmentContact: vi.fn(),
  enrollmentVerify: vi.fn(), enrollmentActivate: vi.fn(), enrollmentAvailability: vi.fn(),
}))

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, acceptGoogleSession: vi.fn(),
    otherPortalSession: false, retrySessionCheck: vi.fn() }),
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

beforeEach(() => {
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
  api.enrollmentAvailability.mockResolvedValue({ open: true })
})
afterEach(() => { vi.clearAllMocks() })

/**
 * Enrollment's limits (hid-system #61 and #50; INTERFACE_CONTRACT.md, public
 * patient enrollment). Wrong codes spend one failure budget per contact: by
 * default the fifth within 15 minutes makes /contact/verify answer 422
 * OTP_INVALID for every code, a correct one too, and /contact send no code, for
 * 15 minutes. Activation answers 429 ENROLLMENT_RATE_LIMITED once one enrollment
 * has had 15 attempts within 15 minutes.
 */
describe('enrollment limits', () => {
  it('says, once a code is refused, that a spent code budget refuses every code for that contact', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a***@example.com' })
    api.enrollmentVerify.mockRejectedValue(new HidApiError(422, 'The verification code is invalid or expired', { code: 'OTP_INVALID' }))
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    const code = await screen.findByLabelText('Verification code')
    expect(screen.queryByText(/every code is refused/)).toBeNull()
    await enterCode(code, '000000')
    expect((await screen.findByText(/every code is refused, even a correct one/)).textContent).toMatch(/no new code is sent/)
  })

  it('does not repeat the code budget note for the new code a person asks for', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a***@example.com' })
    api.enrollmentVerify.mockRejectedValue(new HidApiError(422, 'The verification code is invalid or expired', { code: 'OTP_INVALID' }))
    api.enrollmentContact.mockResolvedValue({ challengeId: 'challenge-2', expiresInSeconds: 600, resendAfterSeconds: 60 })
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    await enterCode(await screen.findByLabelText('Verification code'), '000000')
    await screen.findByText(/every code is refused, even a correct one/)

    fireEvent.click(screen.getByRole('button', { name: 'Request another code or change contact' }))
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send verification code' })) })
    await screen.findByLabelText('Verification code')
    expect(screen.queryByText(/every code is refused/)).toBeNull()
  })

  it('says to wait when activation is refused for too many attempts, and that the enrollment is kept', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
    api.enrollmentActivate.mockRejectedValue(new HidApiError(429, 'Too many enrollment requests; try again later', { code: 'ENROLLMENT_RATE_LIMITED' }))
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate Health ID' })) })
    const hint = await screen.findByText(/too many activation attempts/)
    expect(hint.textContent).toMatch(/15 minutes/)
    expect(hint.textContent).toMatch(/enrollment is kept/)
  })
})
