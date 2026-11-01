import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignIn } from '../routes/SignIn'
import { Recovery } from '../routes/Recovery'
import { shownText } from './portalHarness'

/**
 * Owner decision (2026-10-27): a Health ID is HID- and 6 characters. The review of 2026-10-31 took the prefill out of
 * sign-in and password reset on purpose (it got in the way of people who use an email or phone): those fields start
 * empty, with HID- in the placeholder, and a Health ID typed with its prefix is read as before. Sign-in and password reset take an email as well: the prefix can be deleted, an email typed
 * after it drops it and keeps its case, and anything else is sent as a Health ID in capitals, as Identity checks it.
 * Only the prefill is as empty as the field was before it was filled in, and nothing is sent.
 */
const api = vi.hoisted(() => ({ recoveryStart: vi.fn(), recoveryVerify: vi.fn(), recoveryComplete: vi.fn(), googleExchange: vi.fn() }))
const signIn = vi.hoisted(() => vi.fn())

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, signIn, acceptGoogleSession: vi.fn(),
    otherPortalSession: false, signedOutElsewhere: false, sessionError: null }),
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

beforeEach(() => {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', '')
  signIn.mockResolvedValue(undefined)
  api.recoveryStart.mockResolvedValue({ challengeId: 'challenge-1', resendAfterSeconds: 60 })
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

const show = (page: React.ReactElement) => render(<MemoryRouter>{page}</MemoryRouter>)
const field = () => screen.getByLabelText('Email, phone or Health ID') as HTMLInputElement
/** The sign-in page again, from nothing: a field already emptied of its prefix stays empty until it is focused. */
const cleanupAndShow = () => { cleanup(); show(<SignIn />); fireEvent.focus(field()) }

describe('patient sign-in', () => {
  async function signInWith(value: string) {
    show(<SignIn />)
    fireEvent.change(field(), { target: { value } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
  }

  it('stays empty when focused and sends a Health ID typed with its prefix in capitals', async () => {
    show(<SignIn />)
    // Empty, so a browser can still fill a saved sign-in, and an email or phone is typed without deleting anything.
    expect(field().value).toBe('')
    fireEvent.focus(field())
    expect(field().value).toBe('')
    // Nothing is put in capitals while typing: the field may yet hold an email.
    fireEvent.change(field(), { target: { value: 'HID-abc234' } })
    expect(field().value).toBe('HID-abc234')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(signIn).toHaveBeenCalledWith('HID-ABC234', 'typed-secret-123', 'turnstile-token')
  })

  it('keeps one prefix when a Health ID is pasted after it', async () => {
    await signInWith('HID-HID-7KQ2M9')
    expect(signIn).toHaveBeenCalledWith('HID-7KQ2M9', 'typed-secret-123', 'turnstile-token')
  })

  it('drops the prefix for an email typed after it, and sends the email as typed', async () => {
    show(<SignIn />)
    fireEvent.change(field(), { target: { value: 'HID-Ada@' } })
    expect(field().value).toBe('Ada@')
    fireEvent.change(field(), { target: { value: 'Ada@Example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(signIn).toHaveBeenCalledWith('Ada@Example.test', 'typed-secret-123', 'turnstile-token')
  })

  it('takes an email typed in place of the prefix', async () => {
    await signInWith('ada@example.test')
    expect(signIn).toHaveBeenCalledWith('ada@example.test', 'typed-secret-123', 'turnstile-token')
  })

  // hid-1.0 parity B2 (owner decision 2026-10-28): a phone number signs in too. The Health ID alphabet has no 0 and no
  // "+", so either typed after the prefix drops it, as "@" does, and the number goes as typed without spaces, dashes
  // or brackets; Identity reads 0… as +234….
  it.each([
    ['a Nigerian number written locally', 'HID-0', '0', '0803 123-4567', '08031234567'],
    ['an international number', 'HID-+', '+', '+44 (7700) 900-123', '+447700900123'],
  ])('drops the prefix for %s typed after it, and sends the number without its spacing', async (_, typed, kept, number, sent) => {
    show(<SignIn />)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: typed } })
    expect(field().value).toBe(kept)
    fireEvent.change(field(), { target: { value: number } })
    expect(field().value).toBe(number)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(signIn).toHaveBeenCalledWith(sent, 'typed-secret-123', 'turnstile-token')
  })

  it('takes a phone number pasted after the prefix, and keeps a Health ID of digits as a Health ID', async () => {
    show(<SignIn />)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'HID-+2348031234567' } })
    expect(field().value).toBe('+2348031234567')
    cleanupAndShow()
    // A Health ID can be all digits (2 to 9): only + and 0 start a phone number.
    fireEvent.change(field(), { target: { value: 'HID-234567' } })
    expect(field().value).toBe('HID-234567')
  })

  it('shows a phone number among the examples while empty', () => {
    show(<SignIn />)
    expect(field().placeholder).toBe('HID-…, you@example.com or 0803…')
  })

  it('sends nothing while only the prefix is there, and says what is missing', async () => {
    await signInWith('HID-')
    expect(signIn).not.toHaveBeenCalled()
    expect(shownText(await screen.findByRole('alert'))).toBe('Enter your email, phone number or Health ID.')
  })
})

describe('patient password reset', () => {
  async function startWith(value: string) {
    show(<Recovery />)
    fireEvent.change(field(), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    const send = screen.getByRole('button', { name: 'Send code' })
    send.focus()
    await act(async () => { fireEvent.click(send) })
  }

  it('stays empty when focused and sends a Health ID typed with its prefix in capitals', async () => {
    show(<Recovery />)
    fireEvent.focus(field())
    expect(field().value).toBe('')
    fireEvent.change(field(), { target: { value: 'HID-abc234' } })
    expect(field().value).toBe('HID-abc234')
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
    expect(api.recoveryStart).toHaveBeenCalledWith('HID-ABC234', 'turnstile-token')
    expect(await screen.findByRole('group', { name: 'Code' })).toBeTruthy()
  })

  it('drops the prefix for an email typed after it, and sends the email as typed', async () => {
    show(<Recovery />)
    fireEvent.change(field(), { target: { value: 'HID-ada@' } })
    expect(field().value).toBe('ada@')
    fireEvent.change(field(), { target: { value: 'ada@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
    expect(api.recoveryStart).toHaveBeenCalledWith('ada@example.test', 'turnstile-token')
  })

  it('drops the prefix for a phone number, sends it without its spacing, and says the code goes to the account\'s email', async () => {
    show(<Recovery />)
    expect(document.getElementById('recovery-start-hint')?.textContent)
      .toBe('We’ll send a code to the verified email on your account.')
    fireEvent.change(field(), { target: { value: 'HID-0' } })
    expect(field().value).toBe('0')
    fireEvent.change(field(), { target: { value: '(0803) 123 4567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
    expect(api.recoveryStart).toHaveBeenCalledWith('08031234567', 'turnstile-token')
    expect(await screen.findByRole('group', { name: 'Code' })).toBeTruthy()
  })

  it('sends nothing while only the prefix is there, and says so at the field, which takes focus', async () => {
    await startWith('HID-')
    expect(api.recoveryStart).not.toHaveBeenCalled()
    const input = field()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('recovery-error')?.textContent).toBe('Enter your email, phone number or Health ID.')
    expect(input.getAttribute('aria-describedby')).toContain('recovery-error')
    // Focus moved to the field, whose description says it: an alert as well would be spoken twice.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
