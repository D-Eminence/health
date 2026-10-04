import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PrincipalRecovery } from './PrincipalRecovery'

const calls = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), complete: vi.fn() }))

vi.mock('../recoveryApi', () => ({
  createPrincipalRecoveryApi: () => calls,
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ action, onTokenChange, resetKey }: {
    action: string
    onTokenChange: (token: string) => void
    resetKey: number
  }) => <button type="button" onClick={() => onTokenChange('siteverify-token')}>
    Complete {action} security check {resetKey}
  </button>,
}))

function open(audience: 'staff' | 'admin') {
  render(<MemoryRouter><PrincipalRecovery audience={audience} /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks() })

describe('staff and admin password recovery', () => {
  it('preserves the work email after failure, resets Turnstile, and completes the OTP flow', async () => {
    calls.start.mockRejectedValueOnce(new Error('Gateway unavailable'))
      .mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1' })
    calls.verify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'verification-token' })
    calls.complete.mockResolvedValue({ completed: true })
    open('staff')

    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'clinician@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete staff-reset security check 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'We could not complete that step. Please try again.')
    expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('clinician@example.test')
    expect(screen.getByRole('button', { name: 'Complete staff-reset security check 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send recovery code' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Complete staff-reset security check 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    expect(await screen.findByLabelText('Recovery code')).toBeTruthy()
    expect(calls.start).toHaveBeenLastCalledWith('clinician@example.test', 'siteverify-token')

    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByLabelText('New password')).toBeTruthy()
    expect(calls.verify).toHaveBeenCalledWith('challenge-1', '123456')

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(screen.getByText('Password reset complete.')).toBeTruthy())
    expect(calls.complete).toHaveBeenCalledWith('challenge-1', 'verification-token', 'long-enough-password')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
  })

  it('uses the admin reset action and returns to platform sign in', () => {
    open('admin')
    expect(screen.getByRole('button', { name: 'Complete admin-reset security check 0' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to platform sign in' }).getAttribute('href')).toBe('/admin/sign-in')
  })
})
