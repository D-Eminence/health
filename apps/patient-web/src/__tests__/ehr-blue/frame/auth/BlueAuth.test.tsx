import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type * as StaffApi from '../../../../staff/api'
import { BlueSignIn, SIGN_IN_DONE, SIGN_IN_LEDE } from '../../../../ehr-blue/frame/auth/BlueSignIn'
import { BlueRecovery } from '../../../../ehr-blue/frame/auth/BlueRecovery'
import { BlueStaffInvitation } from '../../../../ehr-blue/frame/auth/BlueStaffInvitation'
import { siteName } from '../../../../ehr-blue/frame/auth/BlueAuthLayout'
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: email } })
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
    // The classic page's words and links (staff/routes/SignIn.tsx, parity report 3.3-42).
    expect(screen.getByText('Sign in with your work account.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Set up your facility' }).getAttribute('href')).toBe('/provider/enroll')
    for (const gone of ['Register a hospital', 'Accept invitation', 'Forgot password?']) expect(screen.queryByRole('link', { name: gone })).toBeNull()
    for (const gone of ['New to Health ID?', 'Joining your team?']) expect(document.body.textContent).not.toContain(gone)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: ' demo.nurse@example.test ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(staff.completeSignIn).toHaveBeenCalledWith(SESSION))
    // Without a Turnstile site key there is no token, as today.
    expect(staff.login).toHaveBeenCalledWith('demo.nurse@example.test', 'fictional-password-1', undefined)
    // The page navigates right after completeSignIn, but the router draws the new address on a later render: wait for
    // it rather than read it at once, which failed on a loaded runner.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider'))
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/sign-in'],
  ])('on %s, which serves no staff pages, opens the EHR site\'s sign-in at once: no "Continue" step, no form', (hostname, ehr) => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    try {
      open('/provider/sign-in', <BlueSignIn />)
      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith(ehr)
      expect(screen.getByText('Opening Health ID EHR…').getAttribute('role')).toBe('status')
      expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(ehr)
      expect(screen.queryByText(/continue/i)).toBeNull()
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByRole('link', { name: 'Register a hospital' })).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'staging.healthidentitydirectory.com'])(
    'on %s keeps its own sign-in form and opens nothing else', hostname => {
      const replace = vi.fn()
      vi.stubGlobal('location', { ...window.location, hostname, replace })
      try {
        open('/provider/sign-in', <BlueSignIn />)
        expect(screen.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeDefined()
        expect(screen.getByRole('textbox', { name: 'Work email' })).toBeDefined()
        expect(replace).not.toHaveBeenCalled()
      } finally { vi.unstubAllGlobals() }
    })

  it.each([
    'ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com',
    'outreach.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com',
  ])('on %s asks for the work email as the classic page does, with no example address, and says who gives accounts', hostname => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      open('/provider/sign-in', <BlueSignIn />)
      expect(screen.getByRole('textbox', { name: 'Work email' }).hasAttribute('placeholder')).toBe(false)
      const recover = screen.getByRole('link', { name: 'Forgot your password?' })
      expect(recover.parentElement!.textContent).toBe('Forgot your password? Need a staff account? Ask your facility administrator.')
    } finally { vi.unstubAllGlobals() }
  })

  it.each([
    ['ehr.healthidentitydirectory.com', 'Set up your facility'],
    ['lab.healthidentitydirectory.com', 'Set up your facility'],
    ['pharmacy.healthidentitydirectory.com', 'Set up your facility'],
    ['migrate.healthidentitydirectory.com', 'Set up your facility'],
    // Open sign-up on outreach. (owner decisions of 11 November 2026): outreach.'s way in is the organiser sign-up,
    // so it keeps "Start running outreach" rather than the classic page's facility wording.
    ['outreach.healthidentitydirectory.com', 'Start running outreach'],
    ['outreach.staging.healthidentitydirectory.com', 'Start running outreach'],
    ['lab.staging.healthidentitydirectory.com', 'Set up your facility'],
  ])('on %s, every way in stays on the site itself: %s and Forgot your password?', (hostname, signUp) => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      open('/provider/sign-in', <BlueSignIn />)
      // The header's one link, as on the classic page: this site's own sign-up.
      expect(screen.getByRole('link', { name: signUp }).getAttribute('href')).toBe('/provider/enroll')
      expect(screen.getByRole('link', { name: signUp }).closest('header')).not.toBeNull()
      const other = signUp === 'Set up your facility' ? 'Start running outreach' : 'Set up your facility'
      expect(screen.queryByRole('link', { name: other })).toBeNull()
      expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/provider/recover')
      // Nothing here leads to another site, except a patient's way to the patient portal's own sign-in (app. is for
      // patients, each product site for its staff).
      const patients = hostname.includes('.staging.') ? 'https://staging.healthidentitydirectory.com/sign-in'
        : 'https://app.healthidentitydirectory.com/sign-in'
      expect(screen.getByRole('link', { name: 'Sign in to Health ID' }).getAttribute('href')).toBe(patients)
      expect(screen.getByText('Are you a patient?', { exact: false }).textContent).toBe('Are you a patient? Sign in to Health ID')
      for (const link of screen.getAllByRole('link')) {
        if (link.textContent !== 'Sign in to Health ID') expect(link.getAttribute('href')).toMatch(/^\/provider\//)
      }
      expect(screen.queryByText(/main Health ID site/)).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com',
    'outreach.healthidentitydirectory.com', 'migrate.staging.healthidentitydirectory.com'])('on %s, says the classic page\'s welcome line', hostname => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      open('/provider/sign-in', <BlueSignIn />)
      expect(SIGN_IN_LEDE).toBe('Sign in with your work account.')
      expect(screen.getByText(SIGN_IN_LEDE)).toBeDefined()
      expect(document.body.textContent).not.toMatch(/hospital workspace|Hospital EHR/)
    } finally { vi.unstubAllGlobals() }
  })

  // Parity report 3.3-44: the authenticator set-up ends with the classic page's "Continue", on every site.
  it('ends the authenticator set-up with "Continue", as the classic page does', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.healthidentitydirectory.com', replace: vi.fn() })
    try {
      staff.login.mockResolvedValue({ kind: 'challenge', challenge: { status: 'mfa_enrollment_required', expiresAt: '2026-11-30T12:05:00.000Z' } })
      staff.sendEnrollmentCode.mockResolvedValue({ accepted: true, channel: 'email', expiresAt: '2026-11-30T12:10:00.000Z' })
      staff.startEnrollment.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Health%20ID:demo?secret=JBSWY3DPEHPK3PXP',
        algorithm: 'SHA1', digits: 6, periodSeconds: 30, expiresAt: '2026-11-30T12:10:00.000Z' })
      staff.activateEnrollment.mockResolvedValue({ ...SESSION, recoveryCodes: ['ABCDE-FGHJK', 'MNPQR-STVWX'] })
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.nurse@example.test', 'fictional-password-1')
      fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }))
      fireEvent.change(await screen.findByLabelText(/Email code/), { target: { value: '654321' } })
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      fireEvent.change(await screen.findByLabelText(/Authenticator code/), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
      await screen.findByRole('heading', { level: 1, name: 'Save your recovery codes' })
      expect(SIGN_IN_DONE).toBe('Continue')
      expect(screen.queryByRole('button', { name: /^Continue to / })).toBeNull()
      fireEvent.click(screen.getByLabelText('I have stored these recovery codes somewhere safe'))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await waitFor(() => expect(staff.completeSignIn).toHaveBeenCalledWith(SESSION))
    } finally { vi.unstubAllGlobals() }
  })

  it.each([
    ['ehr.healthidentitydirectory.com', 'Health ID Hospital EHR'],
    ['lab.healthidentitydirectory.com', 'Health ID Lab'],
    ['pharmacy.staging.healthidentitydirectory.com', 'Health ID Pharmacy'],
    ['outreach.healthidentitydirectory.com', 'Health ID Outreach'],
    ['migrate.healthidentitydirectory.com', 'Health ID Migrate'],
  ])('on %s, names %s in the recovery and invitation tab titles', (hostname, name) => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      expect(siteName()).toBe(name)
      const recoveryPage = open('/provider/recover', <BlueRecovery />)
      expect(document.title).toBe(`Reset your password · ${name}`)
      recoveryPage.unmount()
      open('/provider/invitation', <BlueStaffInvitation />)
      expect(document.title).toBe(`Join your facility · ${name}`)
    } finally { vi.unstubAllGlobals() }
  })

  it('shows and hides the password with the design\'s button', () => {
    open('/provider/sign-in', <BlueSignIn />)
    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says a refusal in plain words, never Identity\'s, and in the portal\'s own for the authenticator', async () => {
    staff.login.mockRejectedValueOnce(new HidApiError(401, 'Email or password is incorrect.', { code: 'INVALID_CREDENTIALS' }))
    open('/provider/sign-in', <BlueSignIn />)
    signInWith('demo.nurse@example.test', 'fictional-password-1')
    // One alert, in the portal's words, below the human check and above the button, as on the classic page (3.3-42).
    const refusal = await screen.findByRole('alert')
    expect(refusal.textContent).toBe('That email address or password isn’t right. Try again.')
    expect(document.body.textContent).not.toContain('Email or password is incorrect.')
    expect(refusal.closest('form')).not.toBeNull()
    expect(refusal.nextElementSibling).toBe(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByLabelText('Password').compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    staff.login.mockRejectedValueOnce(new HidApiError(403, 'Factor unproven', { code: 'STAFF_MFA_FACTOR_UNPROVEN' }))
    signInWith('demo.nurse@example.test', 'fictional-password-1')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(STAFF_MFA_FACTOR_UNPROVEN))
  })

  // Owner's answer to Q88 (17 Nov 2026): a right password with no facility here is told so, never "isn't right".
  it.each([
    ['ehr.healthidentitydirectory.com', 'Health ID EHR'],
    ['lab.healthidentitydirectory.com', 'Health ID Lab'],
    ['pharmacy.healthidentitydirectory.com', 'Health ID Pharmacy'],
    ['migrate.staging.healthidentitydirectory.com', 'Health ID Migrate'],
    ['outreach.healthidentitydirectory.com', 'Health ID Outreach'],
  ])('on %s, says an account not set up for this product in the site\'s own name (403 PRODUCT_NOT_AUTHORISED)', async (hostname, name) => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      staff.login.mockRejectedValueOnce(new HidApiError(403, 'Not authorised for this product.', { code: 'PRODUCT_NOT_AUTHORISED' }))
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.scientist@example.test', 'fictional-password-1')
      const refusal = await screen.findByRole('alert')
      expect(refusal.textContent).toBe(`This account isn’t set up for ${name}.`)
      expect(document.body.textContent).not.toContain('Not authorised for this product.')
      expect(document.body.textContent).not.toContain('isn’t right')
      expect(staff.completeSignIn).not.toHaveBeenCalled()
      expect(screen.getByTestId('where').textContent).toBe('/provider/sign-in')
    } finally { vi.unstubAllGlobals() }
  })

  it('says a login that is part of no facility or outreach group yet so (403 NO_ACTIVE_FACILITY_MEMBERSHIP)', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.healthidentitydirectory.com', replace: vi.fn() })
    try {
      staff.login.mockRejectedValueOnce(new HidApiError(403, 'No active facility membership.', { code: 'NO_ACTIVE_FACILITY_MEMBERSHIP' }))
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.new@example.test', 'fictional-password-1')
      const refusal = await screen.findByRole('alert')
      expect(refusal.textContent).toMatch(/^You aren’t part of a facility or outreach group yet\./)
      expect(document.body.textContent).not.toContain('No active facility membership.')
      expect(staff.completeSignIn).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps the wrong-password words for a wrong password on every product site', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'outreach.healthidentitydirectory.com', replace: vi.fn() })
    try {
      staff.login.mockRejectedValueOnce(new HidApiError(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' }))
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.organiser@example.test', 'not-the-password')
      expect((await screen.findByRole('alert')).textContent).toBe('That email address or password isn’t right. Try again.')
    } finally { vi.unstubAllGlobals() }
  })

  it('goes back to the password step with the product\'s words when the authenticator step is refused for the product', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'pharmacy.healthidentitydirectory.com', replace: vi.fn() })
    try {
      staff.login.mockResolvedValue({ kind: 'challenge', challenge: { status: 'mfa_required', expiresAt: '2026-11-30T12:05:00.000Z' } })
      staff.verifyMfa.mockRejectedValueOnce(new HidApiError(403, 'Not authorised for this product.', { code: 'PRODUCT_NOT_AUTHORISED' }))
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.nurse@example.test', 'fictional-password-1')
      fireEvent.change(await screen.findByLabelText(/Authenticator code/), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
      expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back.' })).toBeDefined()
      expect(document.body.textContent).toContain('This account isn’t set up for Health ID Pharmacy.')
      expect(staff.completeSignIn).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  // An account-only session (Q88-2): outreach. lands straight on "Start an outreach group"; no other site gets one.
  it('lands an account with no facility yet on "Start an outreach group" on outreach.', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'outreach.healthidentitydirectory.com', replace: vi.fn() })
    try {
      staff.login.mockResolvedValue({ kind: 'session', session: SESSION })
      open('/provider/sign-in?returnTo=%2Fprovider%2Fpatients', <BlueSignIn />)
      signInWith('demo.nurse@example.test', 'fictional-password-1')
      await waitFor(() => expect(staff.completeSignIn).toHaveBeenCalledWith(SESSION))
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/start-outreach-group'))
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['lab.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com'])('on %s, lands a session with no facility as before', async hostname => {
    vi.stubGlobal('location', { ...window.location, hostname, replace: vi.fn() })
    try {
      staff.login.mockResolvedValue({ kind: 'session', session: SESSION })
      open('/provider/sign-in', <BlueSignIn />)
      signInWith('demo.nurse@example.test', 'fictional-password-1')
      await waitFor(() => expect(staff.completeSignIn).toHaveBeenCalledWith(SESSION))
      await waitFor(() => expect(screen.getByTestId('where').textContent).not.toBe('/provider/sign-in'))
      expect(screen.getByTestId('where').textContent).not.toBe('/provider/start-outreach-group')
    } finally { vi.unstubAllGlobals() }
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
  const CHALLENGE = { accepted: true, challengeId: 'challenge-1', deliveryChannels: ['email', 'sms'], expiresInSeconds: 600, resendAfterSeconds: 60 }
  const REFUSED = 'That code is wrong or has expired. Check the latest message, or start again for a new code.'
  const steps = () => [...screen.getByRole('list', { name: 'Steps to reset your password' }).querySelectorAll('li')]
  const currentStep = () => steps().find(step => step.getAttribute('aria-current') === 'step')?.textContent

  // Owner's answer to Q89 (17 Nov 2026): the staff reset looks and works as app.'s (routes/Recovery.tsx).
  it('runs as app.\'s reset: the steps, the work email, six boxes that send the code, one new password', async () => {
    recovery.start.mockResolvedValue(CHALLENGE)
    recovery.verify.mockResolvedValue({ verified: true, challengeId: 'challenge-1', verificationToken: 'verified-1' })
    recovery.complete.mockResolvedValue({ completed: true })
    open('/provider/recover', <BlueRecovery />)
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeDefined()
    expect(steps().map(step => step.textContent)).toEqual(['1Your account', '2Code', '3New password'])
    expect(currentStep()).toBe('1Your account')
    // The work email only, with app.'s hint; no lede, and no row of other ways in.
    expect(screen.getByRole('textbox', { name: 'Work email' }).getAttribute('type')).toBe('email')
    expect(screen.getByText('We’ll send a code to the verified email on your account.')).toBeDefined()
    expect(screen.queryByText('For staff accounts.')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Other ways in' })).toBeNull()
    for (const gone of ['Register a hospital', 'Recover access', 'Accept invitation']) expect(screen.queryByRole('link', { name: gone })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: ' demo.nurse@example.test ' } })
    // The local environment's Turnstile stand-in gives the token, as today.
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(recovery.start).toHaveBeenCalledWith('demo.nurse@example.test', 'local-turnstile-disabled'))
    // Six boxes; the sixth digit sends the code with no button pressed.
    const first = await screen.findByRole('textbox', { name: /Digit 1 of 6/ })
    expect(screen.getAllByRole('textbox', { name: /Digit \d of 6/ })).toHaveLength(6)
    expect(currentStep()).toBe('2Code')
    expect(screen.getByText('Enter the 6-digit code we sent.')).toBeDefined()
    await act(async () => { fireEvent.change(first, { target: { value: '123456' } }) })
    await waitFor(() => expect(recovery.verify).toHaveBeenCalledWith('challenge-1', '123456'))
    expect(recovery.verify).toHaveBeenCalledTimes(1)
    // One new password, with Show and app.'s hint; no confirmation to match.
    const password = await screen.findByLabelText('New password')
    expect(currentStep()).toBe('3New password')
    expect(screen.getByText('At least 12 characters. Tap Show to check it.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show new password' })).toBeDefined()
    expect(screen.queryByLabelText('Confirm new password')).toBeNull()
    fireEvent.change(password, { target: { value: 'too-short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(screen.getByText('Use at least 12 characters.')).toBeDefined()
    expect(recovery.complete).not.toHaveBeenCalled()
    fireEvent.change(password, { target: { value: 'a-fictional-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Your password is reset.' })).toBeDefined()
    expect(recovery.complete).toHaveBeenCalledWith('challenge-1', 'verified-1', 'a-fictional-passphrase')
    expect(screen.queryByRole('list', { name: 'Steps to reset your password' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
  })

  it('offers app.\'s way back during the code step: a different email, the wait, then a new code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      recovery.start.mockResolvedValue(CHALLENGE)
      open('/provider/recover', <BlueRecovery />)
      fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
      fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
      await screen.findByRole('textbox', { name: /Digit 1 of 6/ })
      const different = screen.getByRole('button', { name: 'Use a different email' })
      const wait = screen.getByText('Wait for a new code before starting again with the same email.')
      expect(different.getAttribute('aria-describedby')).toBe(wait.id)
      expect(screen.queryByRole('button', { name: 'Start again for a new code' })).toBeNull()
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(screen.getByText('No code? Start again to get a new one.')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: 'Start again for a new code' }))
      expect((await screen.findByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('demo.nurse@example.test')
    } finally { vi.useRealTimers() }
  })

  it('says a refused code in plain words, at the boxes, which are marked', async () => {
    recovery.start.mockResolvedValue(CHALLENGE)
    recovery.verify.mockRejectedValue(new HidApiError(403, 'The code is invalid or has expired.', { code: 'OTP_INVALID_OR_EXPIRED' }))
    open('/provider/recover', <BlueRecovery />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
    const first = await screen.findByRole('textbox', { name: /Digit 1 of 6/ })
    await act(async () => { fireEvent.change(first, { target: { value: '000000' } }) })
    expect(await screen.findByText(REFUSED)).toBeDefined()
    expect(document.body.textContent).not.toContain('The code is invalid or has expired.')
    for (const box of screen.getAllByRole('textbox', { name: /Digit \d of 6/ })) expect(box.getAttribute('aria-invalid')).toBe('true')
    // The wrong-code budget, as on app.
    expect(screen.getByText(/After 5 wrong codes within 15 minutes/)).toBeDefined()
  })

  it('says a refusal that is not about the code in a boxed alert, never Identity\'s words', async () => {
    recovery.start.mockRejectedValue(new HidApiError(503, 'Upstream unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open('/provider/recover', <BlueRecovery />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'demo.nurse@example.test' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('data-intent')).toBe('error')
    expect(document.body.textContent).not.toContain('Upstream unavailable')
    expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('demo.nurse@example.test')
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com',
    'outreach.healthidentitydirectory.com'])('on the product site %s, shows the recovery itself, which hid-system accepts there', hostname => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    try {
      open('/provider/recover', <BlueRecovery />)
      expect(screen.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeDefined()
      expect(screen.getByRole('textbox', { name: 'Work email' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Send code' })).toBeDefined()
      expect(replace).not.toHaveBeenCalled()
      expect(screen.queryByText(/main Health ID site|main site/)).toBeNull()
      // Its way back is this site's own sign-in.
      for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toMatch(/^\/provider\//)
    } finally { vi.unstubAllGlobals() }
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/recover'],
  ])('on %s, which serves no staff pages, opens %s at once, with no step of its own', (hostname, href) => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    try {
      open('/provider/recover', <BlueRecovery />)
      expect(replace).toHaveBeenCalledWith(href)
      expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(href)
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByText(/continue|main site/i)).toBeNull()
      expect(recovery.start).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('BlueStaffInvitation', () => {
  it('opens an invitation by email and code, and sets a new account\'s password, as today\'s page does', async () => {
    invitations.open.mockResolvedValue({ invitationId: 'invitation-1', facilityName: 'Demo Hospital', roleCode: 'nurse', inviterName: 'Demo Admin',
      inviteeName: 'Demo Nurse', email: 'new.nurse@example.test', expiresAt: '2026-11-02T12:00:00.000Z', accountCase: 'new', linkRequired: false })
    invitations.accept.mockResolvedValue({ accepted: true, facilityName: 'Demo Hospital', roleCode: 'nurse' })
    open('/provider/invitation', <BlueStaffInvitation />)
    expect(screen.getByRole('heading', { level: 1, name: 'Join your facility.' })).toBeDefined()
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

  it.each(['lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com', 'ehr.staging.healthidentitydirectory.com'])(
    'on the product site %s, opens invitations itself (no sign-in first), as hid-system accepts them there', hostname => {
      const replace = vi.fn()
      vi.stubGlobal('location', { ...window.location, hostname, replace })
      try {
        open('/provider/invitation', <BlueStaffInvitation />)
        // The invitation page, not the signed-in join page a product site used to send it to.
        expect(screen.getByTestId('where').textContent).toBe('/provider/invitation')
        expect(screen.getByRole('heading', { level: 1, name: 'Join your facility.' })).toBeDefined()
        expect(screen.getByRole('heading', { level: 2, name: 'Enter your invitation code' })).toBeDefined()
        expect(screen.getByRole('textbox', { name: 'Email address' })).toBeDefined()
        expect(screen.getByRole('textbox', { name: 'Invitation code' })).toBeDefined()
        expect(replace).not.toHaveBeenCalled()
        expect(screen.queryByText(/main Health ID site/)).toBeNull()
      } finally { vi.unstubAllGlobals() }
    })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com'],
  ])('on %s, which serves no staff pages, opens the EHR site\'s page at once, with the link', (hostname, origin) => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname, replace })
    try {
      open('/provider/invitation#3f1d2c4b-0000-4000-8000-000000000003.tok', <BlueStaffInvitation />)
      expect(replace).toHaveBeenCalledWith(`${origin}/provider/invitation#3f1d2c4b-0000-4000-8000-000000000003.tok`)
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByText(/continue|main site/i)).toBeNull()
      expect(invitations.open).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
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
