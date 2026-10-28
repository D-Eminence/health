import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Recovery } from '../routes/Recovery'
import { enterCode } from './codeBoxes'

/**
 * hid-1.0's reset asked for the new password twice and refused "Passwords do not match" (PatientAuth.tsx 523-526,
 * 774-777). Nothing is sent until both agree, as on the provider and administrator reset (PA-05).
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
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
  await enterCode(await screen.findByLabelText('Recovery code'), '123456')
  return screen.findByLabelText('New password')
}
const confirm = () => screen.getByLabelText('Confirm new password')
const reset = () => screen.getByRole('button', { name: 'Reset password' }) as HTMLButtonElement

describe('confirming the new password', () => {
  it('sends nothing until both fields agree, and says when they do not', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    expect(reset().disabled).toBe(true)
    // Not while the confirmation is still being typed and agrees so far.
    fireEvent.change(confirm(), { target: { value: 'a-long-new' } })
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    expect(confirm().getAttribute('aria-invalid')).toBeNull()

    fireEvent.change(confirm(), { target: { value: 'a-long-new-passwore' } })
    expect(confirm().getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(confirm().getAttribute('aria-describedby')!)?.textContent).toBe('Passwords do not match.')
    expect(screen.getByText('Passwords do not match.').closest('[aria-live="polite"]')).toBeTruthy()
    expect(reset().disabled).toBe(true)
    // Enter in a field sends nothing either.
    await act(async () => { fireEvent.submit(reset().closest('form')!) })
    expect(api.recoveryComplete).not.toHaveBeenCalled()

    api.recoveryComplete.mockResolvedValue({ completed: true })
    fireEvent.change(confirm(), { target: { value: 'a-long-new-password' } })
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    expect(reset().disabled).toBe(false)
    await act(async () => { fireEvent.click(reset()) })
    expect(api.recoveryComplete).toHaveBeenCalledWith('challenge-1', 'token-1', 'a-long-new-password')
    expect(await screen.findByRole('heading', { name: 'Password reset complete.' })).toBeTruthy()
  })

  it('says so once the confirmation is left, though the new password begins with it', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    // Passed through empty, it is still not told while it is typed.
    fireEvent.blur(confirm())
    // A character short: it agrees so far while it is typed, and is told once the field is left.
    fireEvent.change(confirm(), { target: { value: 'a-long-new-passwor' } })
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    fireEvent.blur(confirm())
    expect(screen.getByText('Passwords do not match.').closest('[aria-live="polite"]')).toBeTruthy()
    expect(confirm().getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(confirm(), { target: { value: 'a-long-new-password' } })
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    expect(reset().disabled).toBe(false)
    // A character added to the new password once it was confirmed.
    fireEvent.change(password, { target: { value: 'a-long-new-password!' } })
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect(reset().disabled).toBe(true)
  })

  it('says so when Enter is pressed, which sends nothing while the button is off', async () => {
    const password = await toPassword()
    fireEvent.change(password, { target: { value: 'a-long-new-password' } })
    fireEvent.change(confirm(), { target: { value: 'a-long-new' } })
    fireEvent.keyDown(confirm(), { key: 'Enter' })
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect(api.recoveryComplete).not.toHaveBeenCalled()
  })

  it('names each field\'s toggle for its own field', async () => {
    await toPassword()
    expect(screen.getByRole('button', { name: 'Show new password' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show confirmed password' })).toBeTruthy()
  })
})
