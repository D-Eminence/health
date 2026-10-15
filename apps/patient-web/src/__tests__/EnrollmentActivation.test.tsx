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

  it.each([
    ['an outage', () => new HidApiError(503, 'Health ID activation is unavailable', { code: 'ENROLLMENT_ACTIVATION_UNAVAILABLE' })],
    ['the activation limit', () => new HidApiError(429, 'Too many enrollment requests; try again later', { code: 'ENROLLMENT_RATE_LIMITED' })],
  ])('keeps a refusal for %s at the password step, without reading the stage again', async (_refusal, refusal) => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
    api.enrollmentActivate.mockRejectedValue(refusal())
    render(<MemoryRouter><Enrollment /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    await press('Activate Health ID')
    expect((await screen.findByRole('alert')).textContent).toBe(refusal().message)
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(api.enrollmentCurrent).toHaveBeenCalledTimes(1)
  })
})

const notAtPassword = (detail = 'Contact verification is required') => new HidApiError(409, detail, { code: 'ENROLLMENT_STAGE_INVALID' })
const REVERIFY_CONTACT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. '
  + 'Send a new code, enter it, then choose your password.'

async function activateFromPassword() {
  render(<MemoryRouter><Enrollment /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
  await press('Activate Health ID')
}

/**
 * The same return to the contact step, seen without its 409: that answer was
 * lost on the network, or the enrollment's activation in another tab of this
 * browser made it. Activation then answers any further try
 * `409 ENROLLMENT_STAGE_INVALID` ("Contact verification is required", the
 * refusal for an enrollment not at the password step), and the page stayed at
 * the password step until a reload.
 */
describe('activation that finds the enrollment no longer at the password step', () => {
  it('reads the stage again and goes back to the contact step when the first answer was lost', async () => {
    api.enrollmentCurrent.mockResolvedValueOnce({ stage: 'set_password' }).mockResolvedValue({ stage: 'verify_contact' })
    api.enrollmentActivate
      .mockRejectedValueOnce(new HidApiError(0, 'We could not reach the service. Check your connection and try again.', { code: 'NETWORK_ERROR' }))
      .mockRejectedValueOnce(notAtPassword())
      .mockResolvedValueOnce({ stage: 'active', hidCode: 'HID-ABCDEF23' })
    await activateFromPassword()
    expect((await screen.findByRole('alert')).textContent).toBe('We could not reach the service. Check your connection and try again.')
    await press('Activate Health ID')

    const contact = await screen.findByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))
    expect(screen.getByRole('alert').textContent).toBe(REVERIFY_CONTACT)
    expect(currentStep()).toBe('Contact')
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(api.enrollmentCurrent).toHaveBeenCalledTimes(2)

    const password = await proveContact() as HTMLInputElement
    expect(password.value).toBe('')
    fireEvent.change(password, { target: { value: 'a-long-enough-password' } })
    await press('Activate Health ID')
    expect(await screen.findByText('HID-ABCDEF23')).toBeTruthy()
  })

  it('goes to the code step when another tab has already sent a new code', async () => {
    api.enrollmentCurrent.mockResolvedValueOnce({ stage: 'set_password' })
      .mockResolvedValue({ stage: 'verify_contact', challengeId: 'challenge-2', maskedContact: '+234•••0000' })
    api.enrollmentActivate.mockRejectedValue(notAtPassword())
    await activateFromPassword()

    const code = await screen.findByLabelText('Verification code')
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(screen.getByText('Enter the six digit code sent to +234•••0000.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Your contact was verified more than 30 minutes ago, so it must be '
      + 'verified again before activation. Enter the new code sent to it, then choose your password.')
    expect(currentStep()).toBe('Code')
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('stays at the password step, with the refusal, when Identity still has the enrollment there', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
    api.enrollmentActivate.mockRejectedValue(notAtPassword('Enrollment conditions are not complete'))
    await activateFromPassword()
    expect((await screen.findByRole('alert')).textContent).toBe('Enrollment conditions are not complete')
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(api.enrollmentCurrent).toHaveBeenCalledTimes(2)
  })

  it('says the stage could not be read, and reads it again on the next try', async () => {
    api.enrollmentCurrent.mockResolvedValueOnce({ stage: 'set_password' })
      .mockRejectedValueOnce(new HidApiError(503, 'Enrollment is temporarily unavailable', { code: 'ENROLLMENT_UNAVAILABLE' }))
      .mockResolvedValue({ stage: 'verify_contact' })
    api.enrollmentActivate.mockRejectedValue(notAtPassword())
    await activateFromPassword()
    expect((await screen.findByRole('alert')).textContent).toBe('Enrollment is temporarily unavailable')
    expect(screen.getByLabelText('Password')).toBeTruthy()

    await press('Activate Health ID')
    expect(await screen.findByLabelText('Phone number')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(REVERIFY_CONTACT)
    expect(api.enrollmentCurrent).toHaveBeenCalledTimes(3)
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
