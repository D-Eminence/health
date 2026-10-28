import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignIn } from '../routes/SignIn'
import { Recovery } from '../routes/Recovery'

/**
 * Owner decision (2026-10-27): a Health ID is HID- and 6 characters, and every field a Health ID is typed into starts
 * with HID- filled in. Sign-in and password reset take an email as well: the prefix can be deleted, an email typed
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
const field = () => screen.getByLabelText('Email or Health ID') as HTMLInputElement

describe('patient sign-in', () => {
  async function signInWith(value: string) {
    show(<SignIn />)
    fireEvent.change(field(), { target: { value } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
  }

  it('starts at HID- once focused and sends what follows it as a Health ID in capitals', async () => {
    show(<SignIn />)
    // Empty until focused, so a browser can still fill a saved sign-in.
    expect(field().value).toBe('')
    fireEvent.focus(field())
    expect(field().value).toBe('HID-')
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

  it('sends nothing while only the prefix is there, and says what is missing', async () => {
    await signInWith('HID-')
    expect(signIn).not.toHaveBeenCalled()
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your email or Health ID.')
  })
})

describe('patient password reset', () => {
  async function startWith(value: string) {
    show(<Recovery />)
    fireEvent.change(field(), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    const send = screen.getByRole('button', { name: 'Send recovery code' })
    send.focus()
    await act(async () => { fireEvent.click(send) })
  }

  it('starts at HID- once focused and sends what follows it as a Health ID in capitals', async () => {
    show(<Recovery />)
    fireEvent.focus(field())
    expect(field().value).toBe('HID-')
    fireEvent.change(field(), { target: { value: 'HID-abc234' } })
    expect(field().value).toBe('HID-abc234')
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
    expect(api.recoveryStart).toHaveBeenCalledWith('HID-ABC234', 'turnstile-token')
    expect(await screen.findByLabelText('Recovery code')).toBeTruthy()
  })

  it('drops the prefix for an email typed after it, and sends the email as typed', async () => {
    show(<Recovery />)
    fireEvent.change(field(), { target: { value: 'HID-ada@' } })
    expect(field().value).toBe('ada@')
    fireEvent.change(field(), { target: { value: 'ada@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
    expect(api.recoveryStart).toHaveBeenCalledWith('ada@example.test', 'turnstile-token')
  })

  it('sends nothing while only the prefix is there, and says so at the field, which takes focus', async () => {
    await startWith('HID-')
    expect(api.recoveryStart).not.toHaveBeenCalled()
    const input = field()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('recovery-error')?.textContent).toBe('Enter your email or Health ID.')
    expect(input.getAttribute('aria-describedby')).toContain('recovery-error')
    // Focus moved to the field, whose description says it: an alert as well would be spoken twice.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
