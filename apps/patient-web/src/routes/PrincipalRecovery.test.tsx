import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

function open(audience: 'staff' | 'admin', path = '/') {
  render(<MemoryRouter initialEntries={[path]}><PrincipalRecovery audience={audience} /></MemoryRouter>)
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

  it('on the production portal links staff to the EHR site to sign in after the reset', async () => {
    jsdom.reconfigure({ url: 'https://app.healthidentitydirectory.com/provider/recover' })
    calls.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1' })
    calls.verify.mockResolvedValueOnce({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified' })
    calls.complete.mockResolvedValueOnce({ completed: true })
    open('staff', '/provider/recover')

    const ehr = 'https://ehr.healthidentitydirectory.com/provider/sign-in'
    expect(screen.getByRole('link', { name: 'Back to provider sign in' }).getAttribute('href')).toBe(ehr)
    // The logo too: the portal serves patients only, so nothing here leads to a staff sign-in of its own.
    expect(screen.getByRole('link', { name: 'Health ID' }).getAttribute('href')).toBe(ehr)
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'nurse@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /Complete staff-reset security check/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    fireEvent.change(await screen.findByLabelText('Recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await screen.findByText('Password reset complete.')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(ehr)
  })

  it('follows no return address given in the link, so it cannot send anyone to another site', async () => {
    // Product sites link here without one; a crafted link must not turn this page into a redirect.
    calls.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1' })
    calls.verify.mockResolvedValueOnce({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified' })
    calls.complete.mockResolvedValueOnce({ completed: true })
    open('staff', '/provider/recover?returnTo=https%3A%2F%2Fevil.example%2Fsign-in&next=%2F%2Fevil.example')

    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/provider/sign-in')
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'nurse@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /Complete staff-reset security check/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    fireEvent.change(await screen.findByLabelText('Recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await screen.findByText('Password reset complete.')
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/provider/sign-in')
  })

  it.each([
    ['lab.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
    ['ehr.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
    ['outreach.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com/provider/recover'],
    ['admin.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ])('opened directly on %s, sends staff to the main site instead of a reset hid-system refuses there', (hostname, href) => {
    // A bookmark, history or a typed address can still reach this page on a product site.
    jsdom.reconfigure({ url: `https://${hostname}/provider/recover` })
    open('staff', '/provider/recover')

    expect(screen.queryByLabelText('Work email')).toBeNull()
    expect(screen.queryByRole('button', { name: /security check/ })).toBeNull()
    expect(screen.getByText(/Password resets are done on the main Health ID site/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reset your password on the main site' }).getAttribute('href')).toBe(href)
    expect(calls.start).not.toHaveBeenCalled()
  })

  it('keeps the platform reset on the admin site, which accepts it', () => {
    jsdom.reconfigure({ url: 'https://admin.healthidentitydirectory.com/admin/recover' })
    open('admin', '/admin/recover')
    expect(screen.getByLabelText('Work email')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Complete admin-reset security check/ })).toBeTruthy()
  })

  it('uses the admin reset action and returns to platform sign in', () => {
    open('admin')
    expect(screen.getByRole('button', { name: 'Complete admin-reset security check 0' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to platform sign in' }).getAttribute('href')).toBe('/admin/sign-in')
  })
})
