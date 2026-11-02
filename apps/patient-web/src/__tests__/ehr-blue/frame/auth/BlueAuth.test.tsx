import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type * as StaffApi from '../../../../staff/api'
import { BlueSignIn } from '../../../../ehr-blue/frame/auth/BlueSignIn'
import { BlueRecovery } from '../../../../ehr-blue/frame/auth/BlueRecovery'
import { BlueStaffInvitation } from '../../../../ehr-blue/frame/auth/BlueStaffInvitation'
import { STAFF_MFA_FACTOR_UNPROVEN } from '../../../../staff/routes/StaffMfaSteps'

/**
 * The blue sign-in drafts: the design's pages, working as today's do, on today's calls (mocked here) and in today's
 * words. Every account and facility here is fictional. They open only once the clinic switch is on
 * (EhrBlueAuthRoutes.test.tsx).
 */
const staff = vi.hoisted(() => ({
  state: { status: 'signed-out' } as { status: string; reason?: string },
  login: vi.fn(), completeSignIn: vi.fn(), verifyMfa: vi.fn(), sendEnrollmentCode: vi.fn(), startEnrollment: vi.fn(), activateEnrollment: vi.fn(),
}))
const recovery = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), complete: vi.fn() }))
const invitations = vi.hoisted(() => ({ open: vi.fn(), accept: vi.fn() }))

vi.mock('../../../../staff/App', () => ({ useStaff: () => staff }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, name: 'local' }) }))
vi.mock('../../../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, name: 'local' }) }))
vi.mock('../../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: vi.fn().mockResolvedValue({ open: false }) } }))
vi.mock('../../../../recoveryApi', () => ({ createPrincipalRecoveryApi: () => recovery }))
vi.mock('../../../../staff/api', async importOriginal => ({ ...await importOriginal<typeof StaffApi>(), staffInvitationApi: invitations }))

beforeEach(() => { vi.clearAllMocks(); staff.state = { status: 'signed-out' } })
afterEach(() => { window.history.replaceState(null, '', '/') })

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function open(path: string, page: React.ReactElement) {
  return render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="*" element={page} /></Routes></MemoryRouter>)
}

/** Fills both required fields (the form submits only then) and signs in. */
function signInWith(email: string, password: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

const SESSION = { actor: { id: 'staff-demo-1', email: 'demo.nurse@example.test', displayName: 'Demo Nurse', roles: [], permissions: [], facilities: [] },
  expiresAt: '2026-11-30T12:00:00.000Z' }

describe('BlueSignIn', () => {
  it('draws the design\'s sign-in, and signs in as today\'s page does', async () => {
    staff.login.mockResolvedValue({ kind: 'session', session: SESSION })
    open('/provider/sign-in', <BlueSignIn />)
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeDefined()
    expect(screen.getByText('Sign in to your hospital workspace.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Register a hospital' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Accept invitation' }).getAttribute('href')).toBe('/provider/invitation')
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: ' demo.nurse@example.test ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(staff.completeSignIn).toHaveBeenCalledWith(SESSION))
    // Without a Turnstile site key there is no token, as today.
    expect(staff.login).toHaveBeenCalledWith('demo.nurse@example.test', 'fictional-password-1', undefined)
    // The page navigates right after completeSignIn, but the router draws the new address on a later render: wait for
    // it rather than read it at once, which failed on a loaded runner.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider'))
  })

  it('shows and hides the password with the design\'s button', () => {
    open('/provider/sign-in', <BlueSignIn />)
    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says a refusal in Identity\'s words, and in the portal\'s own for the authenticator', async () => {
    staff.login.mockRejectedValueOnce(new HidApiError(401, 'Email or password is incorrect.', { code: 'INVALID_CREDENTIALS' }))
    open('/provider/sign-in', <BlueSignIn />)
    signInWith('demo.nurse@example.test', 'fictional-password-1')
    // One alert (the redesign's boxed Alert, which names itself "Error:" to a screen reader), in Identity's words.
    const refusal = await screen.findByRole('alert')
    expect(refusal.textContent).toBe('Error: Email or password is incorrect.')
    expect(refusal.getAttribute('data-intent')).toBe('error')
    staff.login.mockRejectedValueOnce(new HidApiError(403, 'Factor unproven', { code: 'STAFF_MFA_FACTOR_UNPROVEN' }))
    signInWith('demo.nurse@example.test', 'fictional-password-1')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(`Error: ${STAFF_MFA_FACTOR_UNPROVEN}`))
  })

  it('goes on to today\'s authenticator step, which takes the page\'s heading', async () => {
    staff.login.mockResolvedValue({ kind: 'challenge', challenge: { status: 'mfa_required', expiresAt: '2026-11-30T12:05:00.000Z' } })
    open('/provider/sign-in', <BlueSignIn />)
    signInWith('demo.nurse@example.test', 'fictional-password-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Verify it’s you' })).toBeDefined()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // The step takes the redesign's provider sign-in look: its classes, inside the shared auth panel.
    const heading = screen.getByRole('heading', { level: 1, name: 'Verify it’s you' })
    expect(heading.classList.contains('hid-mfa-heading')).toBe(true)
    expect(heading.closest('.staff-form.staff-mfa')).not.toBeNull()
    expect(heading.closest('.hid-ehr-blue-auth .auth-panel')).not.toBeNull()
  })
})

describe('BlueRecovery', () => {
  it('runs today\'s recovery: work email, code, then a new password', async () => {
    recovery.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', deliveryChannels: ['email', 'sms'], expiresInSeconds: 600, resendAfterSeconds: 60 })
    recovery.verify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified-1' })
    recovery.complete.mockResolvedValue({ completed: true })
    open('/provider/recover', <BlueRecovery />)
    expect(screen.getByRole('heading', { level: 1, name: 'Recover account access' })).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
    // The local environment's Turnstile stand-in gives the token, as today.
    fireEvent.click(await screen.findByRole('button', { name: 'Send recovery code' }))
    await waitFor(() => expect(recovery.start).toHaveBeenCalledWith('demo.nurse@example.test', 'local-turnstile-disabled'))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Recovery code' }), { target: { value: '12a3456' } })
    expect((screen.getByRole('textbox', { name: 'Recovery code' }) as HTMLInputElement).value).toBe('123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(recovery.verify).toHaveBeenCalledWith('challenge-1', '123456'))
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'a-fictional-passphrase' } })
    // While the confirmation still agrees with the start of the password, nothing is said; then the mismatch is.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-fictional-pass' } })
    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-fictional-wrong' } })
    expect(screen.getByText('Passwords do not match.')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-fictional-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Password reset complete.' })).toBeDefined()
    expect(recovery.complete).toHaveBeenCalledWith('challenge-1', 'verified-1', 'a-fictional-passphrase')
  })

  it('says a refused code in Identity\'s words, on the code field', async () => {
    recovery.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', deliveryChannels: ['email', 'sms'], expiresInSeconds: 600, resendAfterSeconds: 60 })
    recovery.verify.mockRejectedValue(new HidApiError(400, 'The code is invalid or has expired.', { code: 'OTP_INVALID_OR_EXPIRED' }))
    open('/provider/recover', <BlueRecovery />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send recovery code' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Recovery code' }), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('The code is invalid or has expired.')).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Recovery code' }).getAttribute('aria-invalid')).toBe('true')
    // Boxed as a refusal (the redesign's Alert), whether or not it is announced (role=alert is not on every path).
    expect(screen.getByText('The code is invalid or has expired.').closest('[data-intent="error"]')).not.toBeNull()
  })

  it('boxes a refused code the same when the form is sent with Enter', async () => {
    recovery.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', deliveryChannels: ['email', 'sms'], expiresInSeconds: 600, resendAfterSeconds: 60 })
    recovery.verify.mockRejectedValue(new HidApiError(400, 'The code is invalid or has expired.', { code: 'OTP_INVALID_OR_EXPIRED' }))
    open('/provider/recover', <BlueRecovery />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send recovery code' }))
    const code = await screen.findByRole('textbox', { name: 'Recovery code' })
    fireEvent.change(code, { target: { value: '000000' } })
    fireEvent.submit(code.closest('form')!)
    expect((await screen.findByText('The code is invalid or has expired.')).closest('[data-intent="error"]')).not.toBeNull()
  })
})

describe('BlueStaffInvitation', () => {
  it('opens an invitation by email and code, and sets a new account\'s password, as today\'s page does', async () => {
    invitations.open.mockResolvedValue({ invitationId: 'invitation-1', facilityName: 'Demo Hospital', roleCode: 'nurse', inviterName: 'Demo Admin',
      inviteeName: 'Demo Nurse', email: 'new.nurse@example.test', expiresAt: '2026-11-02T12:00:00.000Z', accountCase: 'new', linkRequired: false })
    invitations.accept.mockResolvedValue({ accepted: true, facilityName: 'Demo Hospital', roleCode: 'nurse' })
    open('/provider/invitation', <BlueStaffInvitation />)
    expect(screen.getByRole('heading', { level: 1, name: 'Accept your invitation' })).toBeDefined()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert').textContent).toBe('Error: Enter the email address the invitation was sent to, and the 6-digit code from the email.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'New.Nurse@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitation code' }), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Choose a password' })).toBeDefined()
    expect(invitations.open).toHaveBeenCalledWith({ email: 'new.nurse@example.test', code: '654321' }, 'local-turnstile-disabled')
    expect(screen.getByText(/Demo Admin invited you to join/).textContent).toContain('Demo Hospital')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Demo Hospital' }))
    expect(screen.getByRole('alert').textContent).toBe('Error: Choose a password of at least 12 characters.')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-fictional-passphrase' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-fictional-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Demo Hospital' }))
    const done = await screen.findByRole('heading', { level: 2, name: 'You’ve joined Demo Hospital' })
    expect(invitations.accept).toHaveBeenCalledWith('a-fictional-passphrase')
    expect(within(done.closest('section')!).getByRole('link', { name: 'Go to staff sign-in' })).toBeDefined()
  })

  it('sends existing staff to sign in on their own site to accept', async () => {
    invitations.open.mockResolvedValue({ invitationId: 'invitation-2', facilityName: 'Demo Laboratory', roleCode: 'lab_scientist', inviterName: null,
      inviteeName: 'Demo Scientist', email: 'demo.scientist@example.test', expiresAt: null, accountCase: 'existing_staff', linkRequired: false })
    open('/provider/invitation', <BlueStaffInvitation />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'demo.scientist@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitation code' }), { target: { value: '123456' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in to accept' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Sign in to accept' }).getAttribute('href')).toBe('/provider/staff/join')
    // A role Health ID has no name for is "a staff member", never its code (parity report 3.1 #16).
    expect(screen.getByText(/invited you to join/).textContent).toBe('The facility administrator invited you to join Demo Laboratory as a staff member.')
    expect(document.body.textContent).not.toContain('lab_scientist')
  })

  // Owner decision 20: the outreach officer has a name, and reads with "an" in the sentence.
  it('names an outreach officer in its sentence', async () => {
    invitations.open.mockResolvedValue({ invitationId: 'invitation-3', facilityName: 'Demo Hospital', roleCode: 'outreach_officer',
      inviterName: null, inviteeName: 'Demo Outreach', email: 'demo.outreach@example.test', expiresAt: null, accountCase: 'existing_staff',
      linkRequired: false })
    open('/provider/invitation', <BlueStaffInvitation />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'demo.outreach@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitation code' }), { target: { value: '123456' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in to accept' })).toBeDefined()
    expect(screen.getByText(/invited you to join/).textContent).toBe('The facility administrator invited you to join Demo Hospital as an outreach officer.')
    expect(document.body.textContent).not.toContain('outreach_officer')
  })
})

describe('the redesign\'s look', () => {
  it('draws every page in the shared auth layout, with no EHR stylesheet of its own', () => {
    for (const [path, page] of [['/provider/sign-in', <BlueSignIn />], ['/provider/recover', <BlueRecovery />],
      ['/provider/invitation', <BlueStaffInvitation />]] as const) {
      const { unmount } = open(path, page)
      expect(document.querySelector('.hid-ehr-blue-auth .auth-page .auth-panel')).not.toBeNull()
      expect(document.querySelector('.hid-ehr')).toBeNull()
      unmount()
    }
    const here = dirname(fileURLToPath(import.meta.url))
    const folder = resolve(here, '../../../../ehr-blue/frame/auth')
    for (const name of readdirSync(folder).filter(file => /\.tsx?$/.test(file))) {
      expect(readFileSync(join(folder, name), 'utf8')).not.toMatch(/@hid\/ui\/ehr|\.css'/)
    }
  })
})

describe('the blue sign-in pages', () => {
  it('are loaded only by today\'s two route files, lazily, so no page bundle carries them before the switch', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = resolve(here, '../../../..')
    const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path)
      return /\.(ts|tsx)$/.test(name) ? [path] : []
    })
    const importers = files(source)
      .filter(path => !relative(source, path).startsWith(join('ehr-blue', 'frame', 'auth')))
      .filter(path => /frame\/auth\//.test(readFileSync(path, 'utf8')))
    expect(importers.map(path => relative(source, path)).sort()).toEqual(['App.tsx', join('staff', 'App.tsx')])
    for (const path of importers) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(line => /frame\/auth\//.test(line))
      for (const line of lines) expect(line).toMatch(/lazy\(async \(\) => \(\{ default: \(await import\('[^']*frame\/auth\//)
    }
    // App.tsx is the entry bundle's own module: its lazy() calls are marked pure, so while the switch is off and the
    // routes never use them the build drops them, and the entry names no blue chunk (React.lazy is not known pure).
    const entry = readFileSync(join(source, 'App.tsx'), 'utf8').split('\n').filter(line => /frame\/auth\//.test(line))
    expect(entry.length).toBeGreaterThan(0)
    for (const line of entry) expect(line).toMatch(/= \/\* @__PURE__ \*\/ lazy\(/)
  })
})
