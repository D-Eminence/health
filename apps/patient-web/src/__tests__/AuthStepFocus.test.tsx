import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Enrollment } from '../routes/Enrollment'
import { Recovery } from '../routes/Recovery'
import { PrincipalRecovery } from '../routes/PrincipalRecovery'
import { enterCode } from './codeBoxes'
import { shownText } from './portalHarness'
import { agreeToTerms } from './agreeToTerms'

/**
 * Enrollment and password recovery show one step at a time (PA-02, PA-03,
 * PA-04, A11Y-BR-04). Each step replaced the form before it and nothing moved
 * focus, so a keyboard or screen reader user was left on the page itself after
 * every step, and after a refused step (the busy submit button had been
 * disabled). A refusal about the step's field was announced only at the top of
 * the card (PA-06), the provider recovery mismatch was not announced at all
 * (PA-05), 'Request another code' emptied the contact (PA-10), and every page
 * kept the patient tab title (PA-12).
 */
const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), enrollmentStart: vi.fn(), enrollmentContact: vi.fn(),
  enrollmentVerify: vi.fn(), enrollmentActivate: vi.fn(), recoveryStart: vi.fn(), recoveryVerify: vi.fn(), recoveryComplete: vi.fn(),
  enrollmentAvailability: vi.fn(),
}))
const principal = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), complete: vi.fn() }))

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, acceptGoogleSession: vi.fn() }),
}))
vi.mock('../recoveryApi', () => ({ createPrincipalRecoveryApi: () => principal }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

const TAB_TITLE = 'Health ID: Patient'
beforeEach(() => {
  vi.clearAllMocks()
  document.title = TAB_TITLE
  api.enrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment'))
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
  api.enrollmentAvailability.mockResolvedValue({ open: true })
})
afterEach(() => { cleanup() })

/** Presses a submit button the way a keyboard user does: focused, then activated. */
async function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' | ')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('patient password recovery', () => {
  const open = () => render(<MemoryRouter><Recovery /></MemoryRouter>)

  async function toCode() {
    api.recoveryStart.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
    open()
    fireEvent.change(screen.getByLabelText('Email, phone or Health ID'), { target: { value: 'patient@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Send code')
  }

  it('names the tab, and gives it back on leaving', () => {
    const { unmount } = open()
    expect(document.title).toBe('Reset your password · Health ID')
    unmount()
    expect(document.title).toBe(TAB_TITLE)
  })

  it('moves focus to the code field once the code is sent, and to the password field once it is verified', async () => {
    await toCode()
    const code = screen.getByLabelText('Code')
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(described(code)).toBe('Enter the 6-digit code we sent.')

    api.recoveryVerify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
    // The sixth digit sends the code.
    await enterCode(code, '123456')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('New password')))

    api.recoveryComplete.mockResolvedValue({ completed: true })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } })
    await press('Reset password')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your password is reset.' })))
  })

  it('a wrong code: focus returns to the code field, which is marked invalid and described by the error', async () => {
    await toCode()
    api.recoveryVerify.mockRejectedValue(new HidApiError(403, 'The verification code is invalid or expired', { code: 'OTP_INVALID_OR_EXPIRED' }))
    const code = screen.getByLabelText('Code')
    // Sent by its sixth digit, from the last box: focus returns to the first, whose description says why.
    await enterCode(code, '000000')
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(code.getAttribute('aria-invalid')).toBe('true')
    expect(described(code)).toBe('Enter the 6-digit code we sent. | The verification code is invalid or expired')
    // Focus moved to the field, whose description says it: an alert as well would be spoken twice.
    expect(screen.queryByRole('alert')).toBeNull()

    // Correcting it clears the mark on the next attempt, sent with the button: a corrected code is not sent by itself.
    api.recoveryVerify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
    fireEvent.change(code, { target: { value: '123456' } })
    expect(api.recoveryVerify).toHaveBeenCalledTimes(1)
    await press('Check code')
    await waitFor(() => expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBeNull())
  })

  it('a refusal that is not about the code (rate limit): focus returns to the field, which stays valid', async () => {
    await toCode()
    api.recoveryVerify.mockRejectedValue(new HidApiError(429, 'Too many attempts. Try again later.'))
    const code = screen.getByLabelText('Code')
    await enterCode(code, '123456')
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(code.getAttribute('aria-invalid')).toBeNull()
    expect(described(code)).toBe('Enter the 6-digit code we sent.')
    expect(shownText(screen.getByRole('alert'))).toBe('Too many attempts. Try again later.')
  })

  it('opening the page moves no focus', () => {
    open()
    expect(document.activeElement).toBe(document.body)
  })

  it('a wrong code sent with Enter in the field, where focus stays, is announced as an alert', async () => {
    await toCode()
    api.recoveryVerify.mockRejectedValue(new HidApiError(403, 'The verification code is invalid or expired', { code: 'OTP_INVALID_OR_EXPIRED' }))
    const code = screen.getByLabelText('Code')
    await waitFor(() => expect(document.activeElement).toBe(code))
    await enterCode(code, '000000')
    await waitFor(() => expect(document.activeElement).toBe(code))
    // Corrected in its first box, which keeps focus, and sent with Enter there.
    fireEvent.change(code, { target: { value: '000001' } })
    code.focus()
    await act(async () => { fireEvent.submit(code.closest('form') as HTMLFormElement) })
    expect(api.recoveryVerify).toHaveBeenCalledTimes(2)
    expect(shownText(await screen.findByRole('alert'))).toBe('The verification code is invalid or expired')
    expect(code.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(code)
  })

  it('a verification that ran out before the new password was sent leaves the password field valid', async () => {
    await toCode()
    api.recoveryVerify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
    await enterCode(screen.getByLabelText('Code'), '123456')
    const password = screen.getByLabelText('New password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    // The completion token lasts as long as the code; a slow password step gets the code's refusal.
    api.recoveryComplete.mockRejectedValue(new HidApiError(403, 'The verification code is invalid or expired', { code: 'OTP_INVALID_OR_EXPIRED' }))
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    await press('Reset password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(password.getAttribute('aria-invalid')).toBeNull()
    expect(described(password)).toBe('At least 12 characters (done) Tip: a few words together is easy to remember.')
    expect(shownText(screen.getByRole('alert'))).toBe('The verification code is invalid or expired')
  })

  it('a missing security check (400 TURNSTILE_REQUIRED) is not about the identifier', async () => {
    api.recoveryStart.mockRejectedValue(new HidApiError(400, 'Complete the security check and try again.', { code: 'TURNSTILE_REQUIRED' }))
    open()
    const identifier = screen.getByLabelText('Email, phone or Health ID')
    fireEvent.change(identifier, { target: { value: 'patient@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Send code')
    await waitFor(() => expect(document.activeElement).toBe(identifier))
    expect(identifier.getAttribute('aria-invalid')).toBeNull()
    expect(shownText(screen.getByRole('alert'))).toBe('Complete the security check and try again.')
  })

  it('leaves focus where the person moved it while the step was running', async () => {
    await toCode()
    const reply = deferred<{ verified: true; challengeId: string; verificationToken: string }>()
    api.recoveryVerify.mockReturnValue(reply.promise)
    await enterCode(screen.getByLabelText('Code'), '123456')
    const back = screen.getByRole('link', { name: 'Back to sign in' })
    back.focus()
    await act(async () => { reply.resolve({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' }) })
    expect(screen.getByLabelText('New password')).toBeTruthy()
    expect(document.activeElement).toBe(back)
  })
})

describe('provider and platform password recovery', () => {
  const open = (audience: 'staff' | 'admin') => render(<MemoryRouter><PrincipalRecovery audience={audience} /></MemoryRouter>)

  async function toPassword() {
    principal.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
    principal.verify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
    open('staff')
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'clinician@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Send code')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Code')))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await press('Check code')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('New password')))
  }

  it('opening the page moves no focus', () => {
    open('staff')
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus on another field of the same form the person moved to while the step ran', async () => {
    await toPassword()
    let refuse!: (reason: unknown) => void
    principal.complete.mockReturnValue(new Promise((_, reject) => { refuse = reject }))
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-new-password' } })
    await press('Reset password')
    const confirm = screen.getByLabelText('Confirm new password')
    confirm.focus()
    await act(async () => { refuse(new HidApiError(429, 'Too many attempts. Try again later.')) })
    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Try again later.')
    expect(document.activeElement).toBe(confirm)
  })

  it('names the tab after the audience', () => {
    open('staff')
    expect(document.title).toBe('Reset your password · Health ID Provider')
    cleanup()
    open('admin')
    expect(document.title).toBe('Reset your password · Health ID Platform')
  })

  it('says, and ties to the field, that the passwords do not match', async () => {
    await toPassword()
    const confirm = screen.getByLabelText('Confirm new password')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } })
    // The polite region is there, empty, before anything is said in it.
    const region = confirm.closest('form')!.querySelector('[aria-live="polite"]')
    expect(region).toBeTruthy()
    expect(region!.textContent).toBe('')
    // Typing the confirmation, while it still agrees, says nothing.
    fireEvent.change(confirm, { target: { value: 'a-long' } })
    expect(confirm.getAttribute('aria-invalid')).toBeNull()
    expect(region!.textContent).toBe('')
    fireEvent.change(confirm, { target: { value: 'a-long-new-passwore' } })
    expect(confirm.getAttribute('aria-invalid')).toBe('true')
    expect(described(confirm)).toBe('Passwords do not match.')
    expect(screen.getByText('Passwords do not match.').closest('[aria-live="polite"]')).toBeTruthy()

    fireEvent.change(confirm, { target: { value: 'a-long-new-password' } })
    expect(confirm.getAttribute('aria-invalid')).toBeNull()
    expect(confirm.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
  })

  it.each(['Use a different work email', 'Start again for a new code'])("'%s' puts focus on the work email field", async name => {
    await toPassword()
    await press(name)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Work email')))
  })

  it('a malformed work email refused by the server: focus returns to the field, marked invalid', async () => {
    principal.start.mockRejectedValue(new HidApiError(400, 'identifier must be an email', { code: 'VALIDATION_FAILED' }))
    open('staff')
    const email = screen.getByLabelText('Work email')
    fireEvent.change(email, { target: { value: 'clinician@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Send code')
    await waitFor(() => expect(document.activeElement).toBe(email))
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(described(email)).toContain('identifier must be an email')
  })

  it('a completed reset moves focus to its confirmation', async () => {
    await toPassword()
    principal.complete.mockResolvedValue({ completed: true })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-new-password' } })
    await press('Reset password')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your password is reset.' })))
  })
})

describe('patient enrollment', () => {
  const open = () => render(<MemoryRouter><Enrollment /></MemoryRouter>)

  async function toContact() {
    api.enrollmentStart.mockResolvedValue({ stage: 'contact' })
    open()
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    expect(document.title).toBe('Get your Health ID · Health ID')
    fireEvent.change(nin, { target: { value: '12345678901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Continue')
  }

  it('says the NIN is 11 digits in the field\'s description, not only in its placeholder', async () => {
    open()
    expect(described(await screen.findByLabelText('National Identification Number (NIN)'))).toContain('11 digits.')
  })

  it('a start refused because the browser holds a sign-in asks for a sign-out instead of another attempt', async () => {
    api.enrollmentStart.mockRejectedValue(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    open()
    fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: '12345678901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Continue')
    // Focus moves to the note, which is read there once: it is not also an alert.
    const note = await screen.findByRole('group', { name: /Sign them out before you start a new Health ID\./ })
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(note))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a NIN that cannot be verified: focus returns to the NIN field, marked invalid and described by the error', async () => {
    api.enrollmentStart.mockRejectedValue(new HidApiError(422, 'The NIN could not be verified', { code: 'NIN_NOT_VERIFIED' }))
    open()
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    fireEvent.change(nin, { target: { value: '12345678901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press('Continue')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect(nin.getAttribute('aria-invalid')).toBe('true')
    expect(described(nin)).toContain('The NIN could not be verified')
    expect(described(nin)).toContain('We don’t keep it on this device.')
  })

  it('moves focus through each stage, and keeps the contact for another code', async () => {
    await toContact()
    const contact = screen.getByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))

    api.enrollmentContact.mockResolvedValue({ challengeId: 'challenge-1' })
    fireEvent.change(contact, { target: { value: '+2348000000000' } })
    await press('Send code')
    const code = screen.getByLabelText('Code')
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(described(code)).toBe('We sent a 6-digit code to +2348000000000.')

    await press('Get another code, or use another phone or email')
    const again = screen.getByLabelText('Phone number') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(again))
    expect(again.value).toBe('+2348000000000')

    await press('Send code')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Code')))
    expect(api.enrollmentContact).toHaveBeenLastCalledWith('phone', '+2348000000000')

    api.enrollmentVerify.mockRejectedValueOnce(new HidApiError(422, 'The verification code is invalid or expired', { code: 'OTP_INVALID' }))
      .mockResolvedValueOnce({ verified: true })
    await enterCode(screen.getByLabelText('Code'), '000000')
    await waitFor(() => expect(screen.getByLabelText('Code').getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(screen.getByLabelText('Code'))

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await press('Check code')
    const password = screen.getByLabelText('Password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(password.getAttribute('aria-invalid')).toBeNull()
    expect(described(password)).toBe('At least 12 characters (not yet) Tip: a few words together is easy to remember.')

    api.enrollmentActivate.mockResolvedValue({ hidCode: 'HID-ABCDEF23' })
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    agreeToTerms()
    await press('Get my Health ID')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your Health ID is ready' })))
    expect(screen.getByText('HID-ABCDEF23')).toBeTruthy()
  })

  it('a contact already used by a Health ID marks the contact field invalid', async () => {
    await toContact()
    const contact = screen.getByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))
    api.enrollmentContact.mockRejectedValue(new HidApiError(409, 'This contact is already associated with a Health ID', { code: 'CONTACT_ALREADY_REGISTERED' }))
    fireEvent.change(contact, { target: { value: '+2348000000000' } })
    await press('Send code')
    await waitFor(() => expect(contact.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(contact)
    // The page's error, which a kasuwa Alert opens with its intent, read as the field's description.
    expect(described(contact)).toBe('Error: This contact is already associated with a Health ID')
  })

  it("'Request another code' cannot be used while a code is being checked", async () => {
    await toContact()
    api.enrollmentContact.mockResolvedValue({ challengeId: 'challenge-1' })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press('Send code')
    api.enrollmentVerify.mockReturnValue(new Promise(() => {}))
    await enterCode(await screen.findByLabelText('Code'), '123456')
    expect((screen.getByRole('button', { name: 'Get another code, or use another phone or email' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not move focus when the page opens at a stage already reached', async () => {
    api.enrollmentCurrent.mockReset().mockResolvedValue({ stage: 'set_password' })
    open()
    expect(await screen.findByRole('heading', { name: 'Choose a password' })).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
  })
})
