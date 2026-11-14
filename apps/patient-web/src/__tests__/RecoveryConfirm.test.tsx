import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Recovery } from '../routes/Recovery'
import { enterCode } from './codeBoxes'
import { described } from './portalHarness'

/**
 * hid-1.0's reset asked for the new password twice (PatientAuth.tsx 523-526, 774-777). Since the review of 2026-10-31
 * it is typed once, with Show to check it, and no second field to match. Nothing is sent until it is at least 12
 * characters; the field says why, and takes focus.
 */
const api = vi.hoisted(() => ({ recoveryStart: vi.fn(), recoveryVerify: vi.fn(), recoveryComplete: vi.fn() }))
vi.mock('../session', () => ({ useSession: () => ({ api }) }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
afterEach(() => { vi.clearAllMocks() })

async function toPassword() {
  api.recoveryStart.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 60 })
  api.recoveryVerify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
  render(<MemoryRouter><Recovery /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Email, phone or Health ID'), { target: { value: 'ada@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })) })
  await enterCode(await screen.findByLabelText('Code'), '123456')
  return screen.findByLabelText('New password') as Promise<HTMLInputElement>
}
const reset = () => screen.getByRole('button', { name: 'Reset password' }) as HTMLButtonElement
const SHORT = 'Use at least 12 characters.'

describe('the new password, typed once', () => {
  it('sends nothing while it is shorter than 12 characters, says why under the field, and moves focus to it', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'too-short' } })
    reset().focus()
    await act(async () => { fireEvent.click(reset()) })
    expect(api.recoveryComplete).not.toHaveBeenCalled()
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(described(password)).toContain(SHORT)
    expect(document.activeElement).toBe(password)

    api.recoveryComplete.mockResolvedValue({ completed: true })
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    expect(screen.queryByText(SHORT)).toBeNull()
    expect(password.getAttribute('aria-invalid')).toBeNull()
    await act(async () => { fireEvent.click(reset()) })
    expect(api.recoveryComplete).toHaveBeenCalledTimes(1)
    expect(api.recoveryComplete).toHaveBeenCalledWith('challenge-1', 'token-1', 'a-long-new-password')
    expect(await screen.findByRole('heading', { name: 'Your password is reset.' })).toBeTruthy()
  })

  it('sends nothing when Enter is pressed with a short password either', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'short' } })
    await act(async () => { fireEvent.submit(password.closest('form')!) })
    expect(api.recoveryComplete).not.toHaveBeenCalled()
    expect(screen.getByText(SHORT)).toBeTruthy()
  })

  it('asks for it once: there is no second field to match', async () => {
    await toPassword()
    expect(screen.queryByLabelText('Confirm new password')).toBeNull()
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
  })

  it('names the field\'s Show toggle for its own field, and it shows what was typed', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    const toggle = screen.getByRole('button', { name: 'Show new password' })
    expect(toggle.getAttribute('aria-controls')).toBe(password.id)
    fireEvent.click(toggle)
    expect(password.type).toBe('text')
    expect(password.value).toBe('a-long-new-password')
  })
})
