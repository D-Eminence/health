import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { AdminSignIn, formatSetupKey } from '../SignIn'

const api = vi.hoisted(() => ({ login: vi.fn(), verifyMfa: vi.fn(), startEnrollment: vi.fn(), activateEnrollment: vi.fn() }))
vi.mock('../api', () => ({ adminApi: api }))
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../download', () => ({ saveFile: vi.fn() }))

const problem = (status: number, code: string) => new HidApiError(status, 'Backend detail', { code })
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX', '01234-56789']

function open(onSignedIn = vi.fn(async () => undefined), notice: string | null = null) {
  render(<MemoryRouter><AdminSignIn onSignedIn={onSignedIn} notice={notice} /></MemoryRouter>)
  return onSignedIn
}

function signInWithPassword() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' admin@example.test ' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => { vi.clearAllMocks() })

describe('platform administration sign-in', () => {
  it('requires an authenticator code after the password before opening the workspace', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    api.verifyMfa.mockResolvedValueOnce({})
    const onSignedIn = open()
    signInWithPassword()
    expect(await screen.findByRole('heading', { name: 'Verify it’s you' })).toBeTruthy()
    expect(api.login).toHaveBeenCalledWith('admin@example.test', 'correct horse battery', '')
    expect(screen.getByText(/Email codes are not accepted for administrators/)).toBeTruthy()
    expect(onSignedIn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '12a34 56' } })
    expect((screen.getByLabelText('Authenticator code') as HTMLInputElement).value).toBe('123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    expect(api.verifyMfa).toHaveBeenCalledWith({ code: '123456' })
  })

  it('signs in with a one-time recovery code and explains its limits', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    api.verifyMfa.mockResolvedValueOnce({})
    const onSignedIn = open()
    signInWithPassword()
    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }))
    expect(screen.getByText(/high-risk actions still\s+need your authenticator app/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: ' ABCDE-FGHJK ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    expect(api.verifyMfa).toHaveBeenCalledWith({ recoveryCode: 'ABCDE-FGHJK' })
  })

  it('shows the backend reasons for rejected, replayed and rate-limited codes', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    api.verifyMfa.mockRejectedValueOnce(problem(401, 'MFA_INVALID_CODE'))
      .mockRejectedValueOnce(problem(429, 'MFA_RATE_LIMITED'))
    const onSignedIn = open()
    signInWithPassword()
    const code = await screen.findByLabelText('Authenticator code')
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/Each code works only once/)).toBeTruthy()
    expect((screen.getByLabelText('Authenticator code') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/locked for up to 15 minutes/)).toBeTruthy()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('returns to the password step when the MFA challenge has expired', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    api.verifyMfa.mockRejectedValueOnce(problem(401, 'MFA_CHALLENGE_INVALID'))
    open()
    signInWithPassword()
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/expired or ran out of attempts/)).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })

  it('gives one message for a wrong password or an account without platform access', async () => {
    api.login.mockRejectedValueOnce(problem(401, 'AUTHENTICATION_REQUIRED'))
    open()
    signInWithPassword()
    expect(await screen.findByText(/Sign-in failed\. Check your email and password/)).toBeTruthy()
  })

  it('reports MFA being unavailable instead of offering a weaker sign-in', async () => {
    api.login.mockRejectedValueOnce(problem(503, 'MFA_UNAVAILABLE'))
    open()
    signInWithPassword()
    expect(await screen.findByText(/Administrator MFA is temporarily unavailable/)).toBeTruthy()
    expect(api.verifyMfa).not.toHaveBeenCalled()
  })

  it('enrolls an authenticator, shows the setup key only during setup and the recovery codes once', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_enrollment_required', expiresAt: '2026-10-08T12:10:00.000Z' })
    api.startEnrollment.mockResolvedValueOnce({ secret: SECRET, otpauthUri: `otpauth://totp/Health%20ID:admin?secret=${SECRET}`,
      algorithm: 'SHA1', digits: 6, periodSeconds: 30, expiresAt: '2026-10-08T12:10:00.000Z' })
    api.activateEnrollment.mockResolvedValueOnce({ recoveryCodes: CODES })
    const onSignedIn = open()
    signInWithPassword()

    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeTruthy()
    // Enrollment start is rate limited by the backend; it runs only on request.
    expect(api.startEnrollment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))
    expect((await screen.findByLabelText('Setup key')).textContent).toBe(formatSetupKey(SECRET))
    expect(screen.getByRole('link', { name: 'open it in the app' }).getAttribute('href')).toMatch(/^otpauth:\/\/totp\//)
    expect(screen.getByText(/SHA1 · 6 digits · every 30 seconds/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    expect(await screen.findByRole('heading', { name: 'Save your recovery codes' })).toBeTruthy()
    expect(api.activateEnrollment).toHaveBeenCalledWith('123456')
    expect(screen.queryByText(formatSetupKey(SECRET))).toBeNull()
    expect(document.body.textContent).not.toContain(SECRET)
    for (const code of CODES) expect(screen.getByText(code)).toBeTruthy()

    const proceed = screen.getByRole('button', { name: 'Continue to platform administration' })
    expect(proceed).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('I have stored these recovery codes somewhere safe'))
    fireEvent.click(proceed)
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    expect(document.body.textContent).not.toContain(CODES[0])
  })

  it('keeps the setup step when an activation code is wrong', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_enrollment_required', expiresAt: '2026-10-08T12:10:00.000Z' })
    api.startEnrollment.mockResolvedValueOnce({ secret: SECRET, otpauthUri: 'otpauth://totp/x', algorithm: 'SHA1',
      digits: 6, periodSeconds: 30, expiresAt: '2026-10-08T12:10:00.000Z' })
    api.activateEnrollment.mockRejectedValueOnce(problem(401, 'MFA_INVALID_CODE'))
    open()
    signInWithPassword()
    fireEvent.click(await screen.findByRole('button', { name: 'Begin setup' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    expect(await screen.findByText(/Each code works only once/)).toBeTruthy()
    expect(screen.getByLabelText('Setup key')).toBeTruthy()
  })

  it('shows why the previous session ended and returns to sign-in if the workspace cannot open', async () => {
    api.login.mockResolvedValueOnce({ status: 'mfa_required', expiresAt: '2026-10-08T12:05:00.000Z' })
    api.verifyMfa.mockResolvedValueOnce({})
    open(vi.fn(async () => { throw new Error('This account has no platform administration access.') }),
      'Your platform session expired.')
    expect(screen.getByText('Your platform session expired.')).toBeTruthy()
    signInWithPassword()
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('This account has no platform administration access.')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })
})
