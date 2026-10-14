import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

beforeEach(() => {
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
  api.enrollmentAvailability.mockResolvedValue({ open: true })
  api.enrollmentContact.mockResolvedValue({ challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
  api.enrollmentVerify.mockResolvedValue({ stage: 'set_password' })
})
// Reset, not cleared: a one-time answer a failed case left unused must not reach the next case.
afterEach(() => { vi.resetAllMocks() })

const reverify = () => new HidApiError(409, 'Verify your contact again before setting a password',
  { code: 'ENROLLMENT_CONTACT_REVERIFY_REQUIRED' })

/** Presses a submit button the way a keyboard user does: focused, then activated. */
async function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

async function proveContact() {
  fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
  await press('Send verification code')
  fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
  await press('Verify code')
  return screen.findByLabelText('Password')
}

const currentStep = () => screen.getByRole('list', { name: 'Enrollment steps' }).querySelector('[aria-current="step"]')?.textContent

/**
 * hid-system#68 (N2(c), ADR-048): a contact proved more than 30 minutes before
 * activation is proved again. Activation then answers
 * `409 ENROLLMENT_CONTACT_REVERIFY_REQUIRED` and has already sent the enrollment
 * back to the contact step, without its contact. The page showed the refusal at
 * the password step, where a second try was refused as
 * `409 ENROLLMENT_STAGE_INVALID`, so only a reload got the patient further.
 */
describe('activation that needs the contact proved again', () => {
  it('goes back to the contact step, says why, and activates once the contact is proved again', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'verify_contact' })
    api.enrollmentActivate.mockRejectedValueOnce(reverify()).mockResolvedValueOnce({ stage: 'active', hidCode: 'HID-ABCDEF23' })
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    fireEvent.change(await proveContact(), { target: { value: 'a-long-enough-password' } })
    await press('Activate Health ID')

    const contact = await screen.findByLabelText('Phone number') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(contact))
    expect(contact.value).toBe('+2348000000000')
    expect(contact.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Your contact was verified more than 30 minutes ago, so it must be '
      + 'verified again before activation. Send a new code, enter it, then choose your password.')
    expect(currentStep()).toBe('Contact')
    expect(screen.queryByLabelText('Password')).toBeNull()

    const password = await proveContact() as HTMLInputElement
    expect(password.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.enrollmentContact).toHaveBeenCalledTimes(2)
    fireEvent.change(password, { target: { value: 'a-long-enough-password' } })
    await press('Activate Health ID')
    expect(await screen.findByText('HID-ABCDEF23')).toBeTruthy()
    expect(api.enrollmentActivate).toHaveBeenCalledTimes(2)
  })

  it('keeps other activation refusals at the password step', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
    api.enrollmentActivate.mockRejectedValue(new HidApiError(409, 'Contact verification is required', { code: 'ENROLLMENT_STAGE_INVALID' }))
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    await press('Activate Health ID')
    expect((await screen.findByRole('alert')).textContent).toBe('Contact verification is required')
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
  })
})

/**
 * hid-system#68 (N2(a), N2(b), ADR-048): the activation response expires the
 * enrollment cookie, and if that response is lost `GET /current` shows the HID
 * for 15 minutes after activation only. Until the HID is also sent to the
 * verified contact, a patient who verified only a phone must keep the HID shown
 * here: it is how they sign in and reset their password.
 */
describe('the Health ID when it is shown', () => {
  it.each([
    ['at activation', () => {
      api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
      api.enrollmentActivate.mockResolvedValue({ stage: 'active', hidCode: 'HID-ABCDEF23' })
    }, true],
    ['again within 15 minutes of activation', () => {
      api.enrollmentCurrent.mockResolvedValue({ stage: 'active', hidCode: 'HID-ABCDEF23' })
    }, false],
  ])('asks the patient to save it %s', async (_when, arrange, activate) => {
    arrange()
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    if (activate) {
      fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
      await press('Activate Health ID')
    }
    const ready = await screen.findByRole('heading', { name: 'Your Health ID is ready.' })
    const shown = ready.closest<HTMLElement>('[role="status"]')!
    expect(within(shown).getByText('HID-ABCDEF23')).toBeTruthy()
    expect(within(shown).getByText('Save your Health ID now: write it down or keep it somewhere safe. This page may not show it '
      + 'again once you leave or reload it, and never more than 15 minutes after activation.')).toBeTruthy()
    expect(within(shown).getByText(/With a verified phone number, your Health ID is how you sign in and reset your password\./)).toBeTruthy()
  })
})
