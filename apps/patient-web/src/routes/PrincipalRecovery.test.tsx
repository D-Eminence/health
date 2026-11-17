import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PrincipalRecovery } from './PrincipalRecovery'
import { enterCode } from '../__tests__/codeBoxes'
import { shownText } from '../__tests__/portalHarness'

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
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    expect(shownText(await screen.findByRole('alert'))).toBe('We couldn’t complete that step. Please try again.')
    expect(screen.getByRole('alert').textContent).not.toContain('Gateway unavailable')
    expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('clinician@example.test')
    expect(screen.getByRole('button', { name: 'Complete staff-reset security check 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send code' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Complete staff-reset security check 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByLabelText('Code'), '123456')
    expect(calls.start).toHaveBeenLastCalledWith('clinician@example.test', 'siteverify-token')

    expect(await screen.findByLabelText('New password')).toBeTruthy()
    expect(calls.verify).toHaveBeenCalledWith('challenge-1', '123456')

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(screen.getByText('Your password is reset.')).toBeTruthy())
    expect(calls.complete).toHaveBeenCalledWith('challenge-1', 'verification-token', 'long-enough-password')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
  })

  it.each(['lab.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com'])(
    'on the product site %s, runs the reset itself (hid-system accepts it there) and returns to its own sign-in', async hostname => {
      jsdom.reconfigure({ url: `https://${hostname}/provider/recover` })
      calls.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1' })
      calls.verify.mockResolvedValueOnce({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified' })
      calls.complete.mockResolvedValueOnce({ completed: true })
      open('staff', '/provider/recover')

      expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/provider/sign-in')
      expect(screen.queryByText(/main Health ID site/)).toBeNull()
      fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'nurse@example.test' } })
      fireEvent.click(screen.getByRole('button', { name: /Complete staff-reset security check/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
      await enterCode(await screen.findByLabelText('Code'), '123456')
      expect(calls.start).toHaveBeenCalledWith('nurse@example.test', 'siteverify-token')
      fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } })
      fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

      await screen.findByText('Your password is reset.')
      for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/provider/sign-in')
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
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByLabelText('Code'), '123456')
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await screen.findByText('Your password is reset.')
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/provider/sign-in')
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/recover'],
  ])('opened on %s, which serves no staff pages, opens %s at once instead of a reset hid-system refuses there', (hostname, href) => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    try {
      open('staff', '/provider/recover')
      expect(replace).toHaveBeenCalledWith(href)
      expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(href)
      expect(screen.queryByLabelText('Work email')).toBeNull()
      expect(screen.queryByRole('button', { name: /security check/ })).toBeNull()
      expect(screen.queryByText(/continue|main site/i)).toBeNull()
      expect(calls.start).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps the platform reset on the admin site, which accepts it', () => {
    jsdom.reconfigure({ url: 'https://admin.healthidentitydirectory.com/admin/recover' })
    open('admin', '/admin/recover')
    expect(screen.getByLabelText('Work email')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Complete admin-reset security check/ })).toBeTruthy()
  })

  it('uses the admin reset action and returns to the platform sign-in', () => {
    open('admin')
    expect(screen.getByRole('button', { name: 'Complete admin-reset security check 0' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/admin/sign-in')
  })

  // Owner's answer to Q89 (17 Nov 2026): the platform administrators' reset looks and works as app.'s.
  it('draws the admin reset as app.\'s: the steps, the work email, six boxes, one new password, then done', async () => {
    jsdom.reconfigure({ url: 'https://admin.healthidentitydirectory.com/admin/recover' })
    calls.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    calls.verify.mockResolvedValueOnce({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified' })
    calls.complete.mockResolvedValueOnce({ completed: true })
    open('admin', '/admin/recover')
    expect(document.title).toBe('Reset your password · Health ID Platform')
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeTruthy()
    const steps = () => [...screen.getByRole('list', { name: 'Steps to reset your password' }).querySelectorAll('li')]
    expect(steps().map(step => step.textContent)).toEqual(['1Your account', '2Code', '3New password'])
    expect(screen.queryByText('For platform accounts.')).toBeNull()
    expect(screen.getByText('We’ll send a code to the verified email on your account.')).toBeTruthy()
    expect(screen.getByText('Complete the security check to continue.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'admin@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /Complete admin-reset security check/ }))
    expect(screen.queryByText('Complete the security check to continue.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    const first = await screen.findByLabelText('Code')
    expect(first.closest('fieldset')!.querySelectorAll('input')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeTruthy()
    // No wait named: a new code may be asked for at once.
    expect(screen.getByRole('button', { name: 'Start again for a new code' })).toBeTruthy()
    await enterCode(first, '654321')
    expect(calls.verify).toHaveBeenCalledWith('challenge-1', '654321')
    const password = await screen.findByLabelText('New password')
    expect(screen.queryByLabelText('Confirm new password')).toBeNull()
    expect(screen.getByText('At least 12 characters. Tap Show to check it.')).toBeTruthy()
    fireEvent.change(password, { target: { value: 'an-admin-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Your password is reset.' })).toBeTruthy()
    expect(calls.complete).toHaveBeenCalledWith('challenge-1', 'verified', 'an-admin-passphrase')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/admin/sign-in')
    expect(screen.queryByRole('link', { name: 'Back to sign in' })).toBeNull()
  })
})
