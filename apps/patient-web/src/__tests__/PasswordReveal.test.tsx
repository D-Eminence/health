import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { SignIn } from '../routes/SignIn'
import { Enrollment } from '../routes/Enrollment'
import { Recovery } from '../routes/Recovery'
import { PrincipalRecovery } from '../routes/PrincipalRecovery'
import { SignIn as StaffSignIn } from '../staff/routes/SignIn'
import { AdminSignIn } from '../admin/SignIn'

/**
 * Every password a person types into Health ID can be shown and hidden with a
 * Show toggle (@hid/ui PasswordInput): patient sign-in, enrollment activation,
 * patient, provider and administrator password reset, provider sign-in and
 * administrator sign-in (provider enrollment and the patient's Google link are
 * covered beside their own pages). The field keeps its label, its value and its
 * submission; a refused attempt keeps what was typed and masks it again.
 */
const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), recoveryStart: vi.fn(), recoveryVerify: vi.fn(), recoveryComplete: vi.fn(),
}))
const signIn = vi.hoisted(() => vi.fn())
const principal = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), complete: vi.fn() }))
const staffLogin = vi.hoisted(() => vi.fn())
const adminApi = vi.hoisted(() => ({ login: vi.fn() }))

vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, signIn, acceptGoogleSession: vi.fn(),
    otherPortalSession: false, retrySessionCheck: vi.fn(), signedOutElsewhere: false, sessionError: null }),
}))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../recoveryApi', () => ({ createPrincipalRecoveryApi: () => principal }))
vi.mock('../staff/App', () => ({ useStaff: () => ({ state: { status: 'signed-out' }, login: staffLogin }) }))
vi.mock('../staff/env', () => ({ getEnvironment: () => ({ turnstileSiteKey: null }) }))
vi.mock('../admin/api', () => ({ adminApi }))
vi.mock('../admin/env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.test' }) }))

beforeEach(() => {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', '')
  api.enrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment', { code: 'ENROLLMENT_NOT_FOUND' }))
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

const show = (page: React.ReactElement) => render(<MemoryRouter>{page}</MemoryRouter>)

/** The field labelled `label`, typed into and shown with its toggle: the value and label stay. */
function typeAndShow(label: string, toggleName = 'Show password', value = 'typed-secret-123') {
  const input = screen.getByLabelText(label) as HTMLInputElement
  expect(input.type).toBe('password')
  const toggle = screen.getByRole('button', { name: toggleName, pressed: false })
  expect(toggle.getAttribute('aria-controls')).toBe(input.id)
  fireEvent.change(input, { target: { value } })
  fireEvent.click(toggle)
  expect(input.type).toBe('text')
  expect(input.value).toBe(value)
  expect(screen.getByRole('textbox', { name: label })).toBe(input)
  return input
}

describe('showing the password', () => {
  it('patient sign-in: a refused attempt keeps the password and masks it again', async () => {
    signIn.mockRejectedValue(new HidApiError(401, 'Email, Health ID or password is incorrect.'))
    show(<SignIn />)
    fireEvent.change(screen.getByLabelText('Email or Health ID'), { target: { value: 'ada@example.test' } })
    const password = typeAndShow('Password')
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(signIn).toHaveBeenCalledWith('ada@example.test', 'typed-secret-123', 'turnstile-token')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(password.type).toBe('password')
    expect(password.value).toBe('typed-secret-123')
  })

  it('enrollment activation', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'set_password' })
    show(<Enrollment />)
    await screen.findByRole('heading', { name: 'Activate your account' })
    const password = typeAndShow('Password')
    // Still described by the step's hint.
    expect(password.getAttribute('aria-describedby')).toBe('enroll-password-hint')
  })

  it('patient password reset', async () => {
    api.recoveryStart.mockResolvedValue({ challengeId: 'challenge-1', resendAfterSeconds: 60 })
    api.recoveryVerify.mockResolvedValue({ verificationToken: 'verified' })
    show(<Recovery />)
    fireEvent.change(screen.getByLabelText('Email or Health ID'), { target: { value: 'ada@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    fireEvent.change(await screen.findByLabelText('Recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await screen.findByLabelText('New password')
    typeAndShow('New password')
  })

  it('provider and administrator password reset: each field has its own toggle', async () => {
    principal.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
    principal.verify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified' })
    show(<PrincipalRecovery audience="staff" />)
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'nurse@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    fireEvent.change(await screen.findByLabelText('Recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await screen.findByLabelText('New password')
    typeAndShow('New password', 'Show new password')
    const confirm = screen.getByLabelText('Confirm new password') as HTMLInputElement
    expect(confirm.type).toBe('password')
    typeAndShow('Confirm new password', 'Show confirmed password')
  })

  it('provider sign-in: a refused attempt keeps the password and masks it again', async () => {
    staffLogin.mockRejectedValue(new Error('Wrong password'))
    show(<StaffSignIn />)
    fireEvent.change(screen.getByRole('textbox', { name: /^Work email/ }), { target: { value: 'nurse@example.test' } })
    // The Field marks the field required: its label reads 'Password*'.
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement
    fireEvent.change(password, { target: { value: 'typed-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show password', pressed: false }))
    expect(password.type).toBe('text')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(staffLogin).toHaveBeenCalledWith('nurse@example.test', 'typed-secret-123', undefined)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong password')
    expect(password.type).toBe('password')
    expect(password.value).toBe('typed-secret-123')
  })

  it('administrator sign-in: a refused attempt masks it again', async () => {
    adminApi.login.mockRejectedValue(new HidApiError(401, 'Refused', { code: 'AUTHENTICATION_REQUIRED' }))
    show(<AdminSignIn onSignedIn={async () => undefined} notice={null} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } })
    const password = typeAndShow('Password')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(adminApi.login).toHaveBeenCalledWith('admin@example.test', 'typed-secret-123', ''))
    expect(password.type).toBe('password')
  })
})
