import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { PRODUCT_NOTES, ProviderEnrollment } from './ProviderEnrollment'

/**
 * The portal's self-service provider enrollment (/provider/enroll), which the
 * public site's /provider/apply links to. hid-system's provider-enrollment
 * routes take the CAC, verify the administrator email and activate the account.
 */
const api = vi.hoisted(() => ({ availability: vi.fn(), start: vi.fn(), verify: vi.fn(), profile: vi.fn(), activate: vi.fn() }))
const staff = vi.hoisted(() => ({ verifyMfa: vi.fn(), sendEnrollmentCode: vi.fn(), startEnrollment: vi.fn(), activateEnrollment: vi.fn() }))
vi.mock('../api', () => ({ providerEnrollmentApi: api, staffApi: staff }))
// Clinician self sign-up's way in (hid-system ADR-066) asks Identity whether intake is open.
const clinician = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: clinician }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test', appOrigin: 'http://localhost:3200' }) }))
// The build's support contact (config/production.json chat.supportContact).
const staffEnvironment = vi.hoisted(() => ({ supportContact: 'mailto:support@healthidentitydirectory.com' as string | null }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test', supportContact: staffEnvironment.supportContact }) }))

/**
 * The portal's other tabs, as BroadcastChannel would connect them; `posted` is what this tab told them,
 * on which channel. The announcer is the real one: this page is outside the provider workspace and the
 * patient portal, so nothing on it listens, and it must still tell the tabs that do.
 */
class TabChannel extends EventTarget {
  static posted: Array<{ name: string; message: unknown }> = []
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage(message: unknown) { TabChannel.posted.push({ name: this.name, message }) }
  close() { TabChannel.open.delete(this) }
}
/** What the provider workspace and the patient portal listen for. */
const TOLD = { name: 'hid-session-change', message: 'changed' }

beforeEach(() => {
  vi.clearAllMocks()
  TabChannel.posted = []
  TabChannel.open.clear()
  vi.stubGlobal('BroadcastChannel', TabChannel)
  api.availability.mockResolvedValue({ open: true })
  api.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
  api.verify.mockResolvedValue({ verified: true })
  // Identity does not serve …/profile yet (P4 review): the page then shows the CAC number alone.
  api.profile.mockRejectedValue(new HidApiError(404, 'Cannot GET /api/v1/identity/provider-enrollments/profile', { code: 'NOT_FOUND' }))
  clinician.availability.mockResolvedValue({ open: false })
  staffEnvironment.supportContact = 'mailto:support@healthidentitydirectory.com'
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

function open(entry = '/provider/enroll') {
  render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/provider/enroll" element={<ProviderEnrollment />} />
    <Route path="/provider" element={<h1>Provider workspace</h1>} />
  </Routes></MemoryRouter>)
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement

function enterDetails() {
  fireEvent.change(screen.getByRole('textbox', { name: 'CAC registration number' }), { target: { value: 'rc 123 456' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Administrator full name' }), { target: { value: '  Ada Admin ' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }), { target: { value: ' Ada@Example.TEST ' } })
}

describe('provider enrollment', () => {
  it('opens with the product the public site linked to', () => {
    open('/provider/enroll?product=pharmacy')
    expect(select('Product').value).toBe('pharmacy')
    expect((screen.getByRole('radio', { name: 'Hospital' }) as HTMLInputElement).checked).toBe(true)
  })

  it('ignores a product the linked facility type cannot enroll for', () => {
    open('/provider/enroll?type=laboratory&product=ehr')
    expect((screen.getByRole('radio', { name: 'Laboratory' }) as HTMLInputElement).checked).toBe(true)
    expect(select('Product').value).toBe('laboratory')
  })

  it('offers only the products a facility type may enroll for', () => {
    open()
    expect([...select('Product').options].map(option => option.value)).toEqual(['ehr', 'laboratory', 'pharmacy', 'migrate'])
    fireEvent.click(screen.getByRole('radio', { name: 'Laboratory' }))
    expect([...select('Product').options].map(option => option.value)).toEqual(['laboratory'])
    expect(select('Product').value).toBe('laboratory')
    fireEvent.click(screen.getByRole('radio', { name: 'Clinic' }))
    expect(select('Product').value).toBe('laboratory')
  })

  it('sends the CAC in capitals with the facility details and the provider-enrollment check', async () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Pharmacy' }))
    enterDetails()
    expect((screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement).value).toBe('RC123456')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith({ productCode: 'pharmacy', organizationType: 'pharmacy',
      cacRegistrationNumber: 'RC123456', administratorName: 'Ada Admin', administratorEmail: 'ada@example.test',
      turnstileToken: 'local-turnstile-disabled' })
  })

  it('stops at the details and says so when hid-system sends the application to review', async () => {
    api.start.mockRejectedValueOnce(new HidApiError(409, 'This provider application requires manual resolution',
      { code: 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' }))
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The next step is said, with support's address, rather than Identity's "requires manual resolution".
    expect((await screen.findByRole('alert')).textContent).toBe('This organization needs a check by Health ID before it can be '
      + 'set up, for example because its CAC number is already linked to Health ID or another sign-up for it is in progress. '
      + 'Contact Health ID support at support@healthidentitydirectory.com, and give your CAC registration number.')
    expect(screen.getByRole('link', { name: 'support@healthidentitydirectory.com' }).getAttribute('href'))
      .toBe('mailto:support@healthidentitydirectory.com')
    expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('keeps main\'s four steps and its authenticator wording, and asks no availability (main has none)', async () => {
    open()
    expect([...screen.getByRole('list', { name: 'Provider enrollment steps' }).querySelectorAll('li')].map(item => item.textContent))
      .toEqual(['Organization', 'Email confirmation', 'Password', 'Authenticator'])
    expect(screen.queryByText(/sign-ups get the Provider Portal for now/)).toBeNull()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByLabelText('Password')
    expect(screen.getByText(/After activation, you will set up an authenticator app/)).toBeTruthy()
    expect(api.availability).not.toHaveBeenCalled()
    // The organization panel is Novu's (main serves no …/profile), and main keeps its fine print.
    expect(api.profile).not.toHaveBeenCalled()
    expect(screen.queryByText(/You’re registering/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'This isn’t my organization' })).toBeNull()
  })

  it('keeps main\'s fine print, which names its review before activation', () => {
    open()
    expect(screen.getByText('We check your CAC against the official registry. Registrations already linked to Health ID are '
      + 'reviewed by our team before activation.')).toBeTruthy()
  })

  it('verifies the six-digit code, then activates with a password of at least 12 characters', async () => {
    const reload = vi.fn()
    // An Identity before hid-system #71 signs the administrator in at activation, so the page reloads into the workspace.
    vi.stubGlobal('location', { ...window.location, hostname: 'localhost', reload })
    api.activate.mockResolvedValueOnce({ activated: true, organizationId: 'org-1', facilityId: 'facility-1', accountId: 'account-1',
      actor: { id: 'staff-1', roles: ['org_admin'], permissions: [], facilities: [] }, expiresAt: '2026-10-14T12:00:00.000Z' })
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const code = await screen.findByRole('textbox', { name: 'Email verification code' }) as HTMLInputElement
    fireEvent.change(code, { target: { value: '12a34' } })
    expect(code.value).toBe('1234')
    expect((screen.getByRole('button', { name: 'Verify email' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-1', '123456'))

    const password = await screen.findByLabelText('Password') as HTMLInputElement
    // It can be shown (@hid/ui PasswordInput), and the step's hint describes it.
    expect(screen.getByRole('button', { name: 'Show password', pressed: false }).getAttribute('aria-controls')).toBe(password.id)
    expect(password.getAttribute('aria-describedby')).toBe('provider-password-hint')
    fireEvent.change(password, { target: { value: 'short-pass' } })
    expect((screen.getByRole('button', { name: 'Create provider account' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(password, { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))

    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(api.activate).toHaveBeenCalledWith('a-long-enough-password')
    // The browser holds the session the activation answered with: the other tabs are told.
    expect(TabChannel.posted).toEqual([TOLD])
    expect(TabChannel.open.size).toBe(0)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('provider enrollment activation, then the authenticator (hid-system #71)', () => {
  const enrollment = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, periodSeconds: 30,
    otpauthUri: 'otpauth://totp/Health%20ID:ada%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Health+ID',
    expiresAt: '2026-10-14T09:10:00.000Z' }
  const session = { actor: { id: 'staff-1', roles: ['org_admin'], permissions: [], facilities: [] }, expiresAt: '2026-10-14T12:00:00.000Z' }
  const activation = (status: 'mfa_required' | 'mfa_enrollment_required') => ({ activated: true, organizationId: 'org-1',
    facilityId: 'facility-1', accountId: 'account-1', status, expiresAt: '2026-10-14T09:10:00.000Z' })

  async function activate(status: 'mfa_required' | 'mfa_enrollment_required') {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname: 'localhost', reload })
    api.activate.mockResolvedValueOnce(activation(status))
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))
    return reload
  }

  async function stepShown(name: string) {
    const heading = await screen.findByRole('heading', { name })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    return heading
  }

  it('continues into the authenticator setup with no emailed code, shows the recovery codes once, then opens the workspace', async () => {
    staff.startEnrollment.mockResolvedValueOnce(enrollment)
    staff.activateEnrollment.mockResolvedValueOnce({ ...session, recoveryCodes: ['ABCDE-FGHJK', 'MNPQR-STVWX'] })
    const reload = await activate('mfa_enrollment_required')

    await stepShown('Set up an authenticator app')
    expect(screen.getByText(/^Your provider account is active\./)).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Provider enrollment steps' }).querySelector('[aria-current="step"]')?.textContent).toBe('Authenticator')
    // Activation is not a sign-in: nothing opens until the authenticator is set up.
    expect(reload).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Provider workspace' })).toBeNull()
    expect(TabChannel.posted).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))

    await stepShown('Add Health ID to your authenticator app')
    // The activation is the enrolment's proof: no code is emailed (Identity would answer 409 PROOF_COMPLETE).
    expect(staff.startEnrollment).toHaveBeenCalledWith(undefined)
    expect(staff.sendEnrollmentCode).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'QR code of the setup key, for your authenticator app' })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Authenticator code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))

    await stepShown('Save your recovery codes')
    expect(staff.activateEnrollment).toHaveBeenCalledWith('123456')
    // The browser holds the session now: the other tabs are told at once, though nothing on this page listens,
    // on a channel opened for the message and closed again.
    expect(TabChannel.posted).toEqual([TOLD])
    expect(TabChannel.open.size).toBe(0)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('I have stored these recovery codes somewhere safe'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the Provider Portal' }))

    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(TabChannel.posted).toEqual([TOLD])
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('asks an account that already has an authenticator for its code (mfa_required), then opens the workspace', async () => {
    staff.verifyMfa.mockResolvedValueOnce(session)
    const reload = await activate('mfa_required')

    await stepShown('Verify it’s you')
    expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull()
    expect(TabChannel.posted).toEqual([])
    fireEvent.change(screen.getByRole('textbox', { name: 'Authenticator code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(staff.verifyMfa).toHaveBeenCalledWith({ code: '123456' })
    expect(TabChannel.posted).toEqual([TOLD])
    expect(TabChannel.open.size).toBe(0)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('sends the administrator to sign in when the setup step has expired (401 MFA_CHALLENGE_INVALID)', async () => {
    staff.startEnrollment.mockRejectedValueOnce(new HidApiError(401, 'Sign in again to continue', { code: 'MFA_CHALLENGE_INVALID' }))
    const reload = await activate('mfa_enrollment_required')
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))

    await stepShown('Sign in to finish setting up')
    expect((await screen.findByRole('alert')).textContent).toBe('This sign-in step expired or ran out of attempts. Sign in again.')
    expect(screen.getByText(/^Your provider account is active\. Sign in with your administrator email/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in to the Provider Portal' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(reload).not.toHaveBeenCalled()
    // No session was set.
    expect(TabChannel.posted).toEqual([])
  })
})

describe('clinician self sign-up from provider enrollment (hid-system ADR-066)', () => {
  it('sends a doctor or nurse to clinician sign-up while it is open: provider enrollment is for facility administrators', async () => {
    clinician.availability.mockResolvedValueOnce({ open: true })
    open()
    expect((await screen.findByRole('link', { name: 'Sign up as a clinician' })).getAttribute('href')).toBe('/provider/join')
    expect(screen.getByText(/Provider enrollment sets up a facility and its administrator's account/)).toBeTruthy()
  })

  it('says clinician sign-up is not open yet otherwise', async () => {
    open()
    expect(await screen.findByText(/Clinician sign-up isn't open yet\./)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign up as a clinician' })).toBeNull()
  })
})

/**
 * Facility self sign-up on Novu (novu-v1, the production backend; P4). Identity
 * answers every route 423 PROVIDER_ENROLLMENT_UNAVAILABLE while sign-up is
 * closed, says whether it is open at GET …/availability, and ends with the
 * password, which signs the administrator in (owner decision: no
 * authenticator). The production gateway replaces any 502, 503 or 504 body with
 * its own UPSTREAM_UNAVAILABLE, so the page reads every status of 500 or more as
 * "temporarily unavailable" and asks availability again.
 */
describe('facility self sign-up on Novu (P4)', () => {
  const problem = (status: number, code: string, detail = 'Identity’s own detail') => new HidApiError(status, detail, { code })
  const SUPPORT = 'support@healthidentitydirectory.com'
  const START_UNAVAILABLE = 'We couldn’t finish checking your details just now. Please try again in a minute. '
    + 'If an email with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.'
  const STEP_UNAVAILABLE = 'Facility sign-up is temporarily unavailable. Please try again in a few minutes.'
  const session = { activated: true, organizationId: 'org-1', facilityId: 'facility-1', accountId: 'account-1',
    actor: { id: 'staff-1', roles: ['org_admin'], permissions: [], facilities: [] }, expiresAt: '2026-10-24T20:00:00.000Z' }

  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  const continueButton = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
  const steps = () => [...screen.getByRole('list', { name: 'Provider enrollment steps' }).querySelectorAll('li')].map(item => item.textContent)

  async function toDetails(entry?: string) {
    open(entry)
    await screen.findByRole('button', { name: 'Continue' })
  }

  async function submitDetails() {
    enterDetails()
    fireEvent.click(continueButton())
  }

  async function toCode() {
    await toDetails()
    await submitDetails()
    await screen.findByRole('heading', { name: 'Confirm your administrator email' })
  }

  async function toPassword() {
    await toCode()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByLabelText('Password')
  }

  function createAccount() {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))
  }

  async function closedNoticeShown() {
    const heading = await screen.findByRole('heading', { name: 'Facility sign-up isn’t open right now' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText(/can’t sign themselves up on Health ID at the moment/).textContent).toBe('Hospitals, laboratories and '
      + `pharmacies can’t sign themselves up on Health ID at the moment. To register your facility, contact Health ID support at ${SUPPORT}.`)
    expect(screen.getByRole('link', { name: SUPPORT }).getAttribute('href')).toBe(`mailto:${SUPPORT}`)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'CAC registration number' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Provider enrollment steps' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  }

  describe('whether sign-up is open', () => {
    it('asks once on opening and shows the form while it is open', async () => {
      let answer!: (value: { open: boolean }) => void
      api.availability.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
      open()
      expect(screen.getByRole('status').textContent).toBe('Checking that facility sign-up is open…')
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
      await act(async () => { answer({ open: true }) })
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
      expect(api.availability).toHaveBeenCalledTimes(1)
    })

    it('shows the closed notice with support’s address, and no form, while it is closed', async () => {
      api.availability.mockResolvedValueOnce({ open: false })
      open()
      await closedNoticeShown()
      expect(api.start).not.toHaveBeenCalled()
    })

    it('says so without an address in a build with no support contact', async () => {
      staffEnvironment.supportContact = null
      api.availability.mockResolvedValueOnce({ open: false })
      open()
      expect((await screen.findByText(/can’t sign themselves up/)).textContent).toMatch(/To register your facility, contact Health ID support\.$/)
      expect(screen.queryByRole('link', { name: SUPPORT })).toBeNull()
    })

    it.each([
      ['404 from an Identity without self sign-up', problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/provider-enrollments/availability')],
      ['a lost connection', new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' })],
      ['a timeout', new HidApiError(408, 'The request took too long.', { code: 'REQUEST_TIMEOUT' })],
      ['the gateway’s 503', problem(503, 'UPSTREAM_UNAVAILABLE')],
    ])('shows the form after %s: the start answers for itself', async (_, failure) => {
      api.availability.mockRejectedValueOnce(failure)
      await toDetails()
      expect(screen.queryByRole('heading', { name: 'Facility sign-up isn’t open right now' })).toBeNull()
      await submitDetails()
      expect(await screen.findByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
    })
  })

  it('shows three steps ending with the password, and says the account is ready straight away', async () => {
    await toDetails()
    expect(steps()).toEqual(['Organization', 'Email confirmation', 'Password'])
    expect(screen.getByText('Verify your CAC registration, confirm your email and choose a password. Your administrator '
      + 'account is ready straight away.')).toBeTruthy()
    // Novu reviews nothing before activation: a CAC number already linked is refused, so the fine print does not say so.
    expect(screen.getByText('We check your CAC against the official registry, and Health ID support checks every new '
      + 'facility within one working day.')).toBeTruthy()
    expect(screen.queryByText(/reviewed by our team before activation/)).toBeNull()
    await submitDetails()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    expect((await screen.findByLabelText('Password')).getAttribute('aria-describedby')).toBe('provider-password-hint')
    expect(document.getElementById('provider-password-hint')?.textContent).toBe('Choose a password of at least 12 characters. '
      + 'You’ll use it with ada@example.test to sign in. Once your account is created, you go straight into the Provider Portal '
      + 'as your facility’s administrator.')
    expect(screen.queryByText(/authenticator/i)).toBeNull()
    expect(steps()).toEqual(['Organization', 'Email confirmation', 'Password'])
    // A password manager saves the new password with the administrator's email.
    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement
    expect(username.value).toBe('ada@example.test')
    expect(username.hidden).toBe(true)
  })

  it.each([
    ['Hospital', 'ehr', 'EHR sign-ups get the Provider Portal for now. The clinical record, and adding staff accounts for your '
      + 'doctors and nurses, aren’t available yet.'],
    ['Laboratory', 'laboratory', 'Laboratory sign-ups get the Provider Portal for now. The Laboratory workspace, and adding staff '
      + 'accounts for your team, aren’t available yet.'],
    ['Pharmacy', 'pharmacy', 'Pharmacy sign-ups get the Provider Portal for now. The Pharmacy workspace, and adding staff '
      + 'accounts for your team, aren’t available yet.'],
  ])('says honestly what a %s sign-up (%s) gets', async (type, product, note) => {
    await toDetails()
    fireEvent.click(screen.getByRole('radio', { name: type }))
    expect(select('Product').value).toBe(product)
    expect(document.getElementById('provider-product-note')?.textContent).toBe(note)
    expect(select('Product').getAttribute('aria-describedby')).toBe('provider-product-note')
  })

  it('says honestly what a migrate sign-up gets', async () => {
    await toDetails('/provider/enroll?product=migrate')
    expect(select('Product').value).toBe('migrate')
    expect(document.getElementById('provider-product-note')?.textContent).toBe('Migrate sign-ups get the Provider Portal for now. '
      + 'The document migration workspace, and adding staff accounts for your team, aren’t available yet.')
    expect(PRODUCT_NOTES.migrate).toBe(document.getElementById('provider-product-note')?.textContent)
  })

  it('signs the administrator in, says where staff sign in next time, then opens the workspace', async () => {
    const reload = vi.fn()
    api.activate.mockResolvedValueOnce(session)
    await toPassword()
    // Production: the portal is app.healthidentitydirectory.com, and staff sign in on the EHR site.
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com', reload })
    createAccount()

    const heading = await screen.findByRole('heading', { name: 'Your facility is set up' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(api.activate).toHaveBeenCalledWith('a-long-enough-password')
    expect(screen.getByText('You’re signed in as your facility’s administrator.')).toBeTruthy()
    expect(screen.getByText('Next time, sign in at ehr.healthidentitydirectory.com with ada@example.test and the password you just chose.')).toBeTruthy()
    expect(screen.getByText(PRODUCT_NOTES.ehr)).toBeTruthy()
    // The browser holds the session already: the other tabs are told at once; the page waits for the administrator.
    expect(TabChannel.posted).toEqual([TOLD])
    expect(reload).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the Provider Portal' }))

    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(TabChannel.posted).toEqual([TOLD])
  })

  it('outside production, says to sign in to the Provider Portal next time, and gives a laboratory its own note', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'localhost', reload: vi.fn() })
    api.activate.mockResolvedValueOnce(session)
    await toDetails('/provider/enroll?type=laboratory')
    await submitDetails()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByLabelText('Password')
    createAccount()

    await screen.findByRole('heading', { name: 'Your facility is set up' })
    expect(screen.getByText('Next time, sign in to the Provider Portal with ada@example.test and the password you just chose.')).toBeTruthy()
    expect(screen.getByText(PRODUCT_NOTES.laboratory)).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ productCode: 'laboratory', organizationType: 'laboratory' }))
  })

  describe('a refused start says what to do, and stays at the details', () => {
    it.each([
      [409, 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT', 'This browser is signed in to Health ID, for example to a patient account. '
        + 'Sign out of Health ID first, or open this page in a private (incognito) window, then try again.'],
      // Registered, held by another sign-up, closed on the way, or closed in the last 7 days for this email or network
      // (0086, A8 and R3): only support can say which, so no wait is promised.
      [409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'This organization can’t be set up automatically right now: its CAC number '
        + 'may already be linked to Health ID, or another sign-up for it may be in progress or recently closed. Contact '
        + `Health ID support at ${SUPPORT}, and give your CAC registration number.`],
      [409, 'ORGANIZATION_REVIEW_REQUIRED', 'This organization needs a check by Health ID before it can be set up, for example '
        + 'because its CAC number is already linked to Health ID or another sign-up for it is in progress. Contact Health ID '
        + `support at ${SUPPORT}, and give your CAC registration number.`],
      [409, 'PROVIDER_ALREADY_REGISTERED', 'This organization is already registered with Health ID. If you are its administrator, '
        + `sign in instead. Contact Health ID support at ${SUPPORT}.`],
      [409, 'PROVIDER_CAC_PROFILE_INCOMPLETE', 'We couldn’t set up your organization automatically from its CAC record: the '
        + 'record is missing details we need, or it doesn’t show the company as active. Contact Health ID support at '
        + `${SUPPORT}, and give your CAC registration number.`],
      [409, 'VERSION_CONFLICT', 'Your sign-up changed while we were working on it. Please try again.'],
      [422, 'CAC_NOT_VERIFIED', 'We couldn’t verify this CAC registration number. Check the number on your CAC certificate '
        + '(it starts with RC, BN or IT) and try again.'],
      [429, 'APPLICATION_RATE_LIMITED', 'There have been too many sign-up attempts from your network. Please try again later.'],
      [429, 'VERIFICATION_QUOTA_EXCEEDED', 'The limit on CAC checks has been reached for now. Please try again later.'],
      [403, 'ORIGIN_DENIED', 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from '
        + 'healthidentitydirectory.com and try again.'],
      [400, 'TURNSTILE_REQUIRED', 'The security check didn’t go through. Please complete it again, then retry.'],
      [403, 'TURNSTILE_REJECTED', 'The security check didn’t go through. Please complete it again, then retry.'],
      [403, 'TURNSTILE_EXPIRED_OR_REPLAYED', 'The security check didn’t go through. Please complete it again, then retry.'],
      [403, 'TURNSTILE_CONTEXT_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility '
        + 'from healthidentitydirectory.com and try again.'],
      [403, 'TURNSTILE_HOSTNAME_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility '
        + 'from healthidentitydirectory.com and try again.'],
      [400, 'VALIDATION_FAILED', 'Some of the details weren’t accepted. Check them and try again.'],
    ])('%i %s', async (status, code, text) => {
      api.start.mockRejectedValueOnce(problem(status, code))
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe(text)
      expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
      expect((screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement).value).toBe('RC123456')
      // Only an outage is followed by another availability read.
      expect(api.availability).toHaveBeenCalledTimes(1)
      // A refusal that was answered sent no code, so Continue can be pressed again at once (with a new check).
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      expect(screen.queryByText(/You can try again in/)).toBeNull()
    })
  })

  it.each([['start'], ['verify'], ['activate']] as const)('shows the closed notice when Identity answers 423 at %s', async step => {
    const closed = problem(423, 'PROVIDER_ENROLLMENT_UNAVAILABLE', 'Facility self sign-up is not open')
    if (step === 'start') {
      api.start.mockRejectedValueOnce(closed)
      await toDetails()
      await submitDetails()
    } else if (step === 'verify') {
      api.verify.mockRejectedValueOnce(closed)
      await toCode()
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    } else {
      api.activate.mockRejectedValueOnce(closed)
      await toPassword()
      createAccount()
    }
    await closedNoticeShown()
    // A 423 is the answer itself: availability is not asked again.
    expect(api.availability).toHaveBeenCalledTimes(1)
  })

  describe('an outage (any status of 500 or more, or the gateway’s UPSTREAM_UNAVAILABLE)', () => {
    it.each([
      [503, 'UPSTREAM_UNAVAILABLE'],
      [500, 'INTERNAL_ERROR'],
      [502, 'QOREID_PROVIDER_RESPONSE_INVALID'],
      [503, 'QOREID_DISABLED'],
      [503, 'PROVIDER_ENROLLMENT_UNAVAILABLE'],
      [503, 'TURNSTILE_UNAVAILABLE'],
      [504, 'QOREID_TIMEOUT'],
    ])('at the start (%i %s) asks availability again, and waits a minute while it is open', async (status, code) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockRejectedValueOnce(problem(status, code, 'The service could not complete the request.'))
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe(START_UNAVAILABLE)
      expect(api.availability).toHaveBeenCalledTimes(2)
      // Identity may have sent a code before the answer was lost; a start within a minute would send none.
      await waitFor(() => expect(screen.getByText(/^You can try again in \d+ seconds?\.$/)).toBeTruthy())
      expect(continueButton().disabled).toBe(true)
      await act(async () => { vi.advanceTimersByTime(61_000) })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      expect(screen.queryByText(/You can try again in/)).toBeNull()
      fireEvent.click(continueButton())
      expect(await screen.findByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
      expect(api.start).toHaveBeenCalledTimes(2)
    })

    it('at the start shows the closed notice when availability now says closed', async () => {
      api.start.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toDetails()
      api.availability.mockResolvedValueOnce({ open: false })
      await submitDetails()
      await closedNoticeShown()
      expect(api.availability).toHaveBeenCalledTimes(2)
    })

    it('at the start after a timeout or a lost connection says so, and waits a minute', async () => {
      api.start.mockRejectedValueOnce(new HidApiError(408, 'The request took too long.', { code: 'REQUEST_TIMEOUT' }))
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe(START_UNAVAILABLE)
      expect(continueButton().disabled).toBe(true)
    })

    it('at verify says sign-up is temporarily unavailable and keeps the code step', async () => {
      api.verify.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toCode()
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      expect((await screen.findByRole('alert')).textContent).toBe(STEP_UNAVAILABLE)
      expect(api.availability).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
    })

    it('at verify after a lost connection asks to check the connection', async () => {
      api.verify.mockRejectedValueOnce(new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' }))
      await toCode()
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t reach Health ID. Check your internet connection and try again.')
    })

    it('at activation keeps the password step, so the administrator can try again', async () => {
      api.activate.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toPassword()
      createAccount()
      expect((await screen.findByRole('alert')).textContent).toBe(STEP_UNAVAILABLE)
      expect(screen.getByLabelText('Password')).toBeTruthy()
    })
  })

  it('says a wrong or expired code plainly, and keeps the code step', async () => {
    api.verify.mockRejectedValueOnce(problem(401, 'ORGANIZATION_COMPLETION_CODE_INVALID', 'The confirmation code is invalid or expired'))
    await toCode()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That code isn’t right, or it has expired. Check the latest '
      + 'email from Health ID and try again, or send a new code.')
    expect(screen.getByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
  })

  describe('recovery at activation', () => {
    it('goes back to the details, kept, when the sign-up session has expired (401 ORGANIZATION_COMPLETION_SESSION_INVALID)', async () => {
      api.activate.mockRejectedValueOnce(problem(401, 'ORGANIZATION_COMPLETION_SESSION_INVALID'))
      await toPassword()
      createAccount()
      expect((await screen.findByRole('alert')).textContent).toBe('Your sign-up session has expired. Check your details and '
        + 'select Continue to get a new code.')
      expect((screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement).value).toBe('RC123456')
      expect((screen.getByRole('textbox', { name: 'Administrator email' }) as HTMLInputElement).value).toBe('Ada@Example.TEST')
      // The last code was sent less than a minute ago: a start now would send none.
      expect(screen.getByText(/^You can try again in \d+ seconds?\.$/)).toBeTruthy()
    })

    it('explains an administrator email that already has an account, and points to support (409)', async () => {
      api.activate.mockRejectedValueOnce(problem(409, 'PROVIDER_EMAIL_ALREADY_REGISTERED'))
      await toPassword()
      createAccount()
      const heading = await screen.findByRole('heading', { name: 'This email already has a Health ID account' })
      await waitFor(() => expect(document.activeElement).toBe(heading))
      // The refused sign-up keeps the CAC number for this email, and another email is refused (0086, A8 and R3).
      expect(heading.nextElementSibling?.textContent).toBe('The administrator email already belongs to a Health ID account, '
        + 'for example a patient account or a staff account, so it can’t also be this facility’s administrator, and this '
        + `sign-up can’t be moved to another email. Contact Health ID support at ${SUPPORT} to finish setting up your facility.`)
      expect(screen.queryByText(/24 hours/)).toBeNull()
      expect(screen.queryByLabelText('Password')).toBeNull()
      expect(screen.queryByRole('list', { name: 'Provider enrollment steps' })).toBeNull()
    })

    it('says an organization that needs Health ID’s check needs it, and points to support (409 ORGANIZATION_REVIEW_REQUIRED)', async () => {
      api.activate.mockRejectedValueOnce(problem(409, 'ORGANIZATION_REVIEW_REQUIRED'))
      await toPassword()
      createAccount()
      const heading = await screen.findByRole('heading', { name: 'Health ID needs to check this organization' })
      expect(heading.nextElementSibling?.textContent).toBe('This organization can’t be set up automatically. It may already be '
        + `registered with Health ID, for example for another product. Contact Health ID support at ${SUPPORT} to finish setting up your facility.`)
    })

    it.each([
      [401, 'AUTHENTICATION_REQUIRED'],
      [405, 'METHOD_NOT_ALLOWED'],
    ])('says the account may already be ready, and links to the EHR site in production (%i %s)', async (status, code) => {
      api.activate.mockRejectedValueOnce(problem(status, code, 'Invalid credentials'))
      await toPassword()
      vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com', reload: vi.fn() })
      createAccount()
      const heading = await screen.findByRole('heading', { name: 'Your account may already be ready' })
      await waitFor(() => expect(document.activeElement).toBe(heading))
      expect(heading.nextElementSibling?.textContent).toBe('We couldn’t confirm that your facility was set up, but it may have '
        + 'been. Sign in with ada@example.test and the password you chose. If you can’t sign in, contact '
        + `Health ID support at ${SUPPORT}.`)
      expect(screen.getByRole('link', { name: 'Sign in to the Provider Portal' }).getAttribute('href'))
        .toBe('https://ehr.healthidentitydirectory.com/provider/sign-in')
      expect(TabChannel.posted).toEqual([])
    })

    it('outside production links to this portal’s staff sign-in', async () => {
      api.activate.mockRejectedValueOnce(problem(401, 'AUTHENTICATION_REQUIRED'))
      await toPassword()
      createAccount()
      await screen.findByRole('heading', { name: 'Your account may already be ready' })
      expect(screen.getByRole('link', { name: 'Sign in to the Provider Portal' }).getAttribute('href')).toBe('/provider/sign-in')
    })

    it('says the account may already be ready when a retry after a lost answer finds the session used up', async () => {
      api.activate.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
        .mockRejectedValueOnce(problem(401, 'ORGANIZATION_COMPLETION_SESSION_INVALID'))
      await toPassword()
      createAccount()
      expect((await screen.findByRole('alert')).textContent).toBe(STEP_UNAVAILABLE)
      createAccount()
      expect(await screen.findByRole('heading', { name: 'Your account may already be ready' })).toBeTruthy()
      expect(screen.queryByRole('textbox', { name: 'CAC registration number' })).toBeNull()
    })
  })

  describe('a new code', () => {
    it('is offered once Identity’s wait has passed, with a new check, and the new code is the one verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
        .mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-2', expiresInSeconds: 600, resendAfterSeconds: 60 })
      await toCode()
      const resend = () => screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      expect(resend().disabled).toBe(true)
      expect(screen.getByText(/^You can ask for a new code in (60|59) seconds\.$/)).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(resend().disabled).toBe(true)
      await act(async () => { vi.advanceTimersByTime(31_000) })
      await waitFor(() => expect(resend().disabled).toBe(false))
      expect(screen.queryByText(/You can ask for a new code/)).toBeNull()
      fireEvent.click(resend())

      await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
      expect(api.start.mock.calls[1]?.[0]).toEqual(api.start.mock.calls[0]?.[0])
      expect((await screen.findByText('We’ve sent a new code to ada@example.test.')).parentElement?.getAttribute('role')).toBe('status')
      // The wait starts again for the new code.
      await waitFor(() => expect(resend().disabled).toBe(true))
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '222222' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-2', '222222'))
    })

    it('waits as long as Identity says', async () => {
      api.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 30 })
      await toCode()
      expect(screen.getByText(/^You can ask for a new code in (30|29) seconds\.$/)).toBeTruthy()
    })

    it('waits a minute when Identity does not say', async () => {
      await toCode()
      expect(screen.getByText(/^You can ask for a new code in (60|59) seconds\.$/)).toBeTruthy()
    })

    it('keeps the wait when the administrator starts again, so the next start is not one that sends no code', async () => {
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      expect(continueButton().disabled).toBe(true)
      expect(screen.getByText(/^You can try again in (60|59) seconds\.$/)).toBeTruthy()
    })

    /**
     * Identity sends at most 5 codes an hour for one sign-up, and 15 a day (hid-system 0056). Past that a start still
     * answers with a new challenge, but sends nothing and keeps the last code in force (P4 review).
     */
    it('stops at 5 codes an hour, says so, and keeps verifying against the last code sent', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let sent = 0
      api.start.mockImplementation(async () => ({ accepted: true, challengeId: `challenge-${++sent}`, resendAfterSeconds: 60 }))
      await toCode()
      const resend = () => screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      for (let code = 2; code <= 5; code += 1) {
        await act(async () => { vi.advanceTimersByTime(61_000) })
        await waitFor(() => expect(resend().disabled).toBe(false))
        fireEvent.click(resend())
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(code))
        await screen.findByText('We’ve sent a new code to ada@example.test.')
      }
      // Five codes in the hour: another start would send none, so the page offers none and says why.
      await act(async () => { vi.advanceTimersByTime(61_000) })
      expect(resend().disabled).toBe(true)
      expect(screen.getByText(/^We’ve sent as many codes as we can for now\. Use the code in the latest email from Health ID, or ask for a new one in (55|56) minutes\.$/)).toBeTruthy()
      expect(screen.queryByText(/You can ask for a new code in/)).toBeNull()

      // "Start again" with the same details goes back to the last code instead of a start that would send none.
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '555555' } })
      expect(api.start).toHaveBeenCalledTimes(5)
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-5', '555555'))
    })

    it('sends no start past the limit once the last code is used, and says when one can be sent', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let sent = 0
      api.start.mockImplementation(async () => ({ accepted: true, challengeId: `challenge-${++sent}`, resendAfterSeconds: 60 }))
      await toCode()
      const resend = () => screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      for (let code = 2; code <= 5; code += 1) {
        await act(async () => { vi.advanceTimersByTime(61_000) })
        await waitFor(() => expect(resend().disabled).toBe(false))
        fireEvent.click(resend())
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(code))
      }
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '555555' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await screen.findByLabelText('Password')
      fireEvent.click(screen.getByRole('button', { name: 'This isn’t my organization' }))
      await act(async () => { vi.advanceTimersByTime(61_000) })
      // The same details: Identity would send no code, and the last one is used.
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      expect((await screen.findByRole('alert')).textContent).toBe('We’ve sent as many codes for these details as we can for now.')
      expect(screen.getByText(/^You can try again in (54|55) minutes\.$/)).toBeTruthy()
      expect(continueButton().disabled).toBe(true)
      expect(api.start).toHaveBeenCalledTimes(5)
      expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
    })

    it('offers a new code again once the hour has passed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let sent = 0
      api.start.mockImplementation(async () => ({ accepted: true, challengeId: `challenge-${++sent}`, resendAfterSeconds: 60 }))
      await toCode()
      const resend = () => screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      for (let code = 2; code <= 5; code += 1) {
        await act(async () => { vi.advanceTimersByTime(61_000) })
        await waitFor(() => expect(resend().disabled).toBe(false))
        fireEvent.click(resend())
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(code))
      }
      await waitFor(() => expect(screen.getByText(/We’ve sent as many codes as we can for now/)).toBeTruthy())
      await act(async () => { vi.advanceTimersByTime(60 * 60_000 - 4 * 61_000 + 2_000) })
      await waitFor(() => expect(resend().disabled).toBe(false))
      expect(screen.queryByText(/We’ve sent as many codes as we can for now/)).toBeNull()
      fireEvent.click(resend())
      await waitFor(() => expect(api.start).toHaveBeenCalledTimes(6))
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '666666' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-6', '666666'))
    })
  })

  it('waits a minute when QoreID limits CAC checks (429 QOREID_RATE_LIMITED), as for an outage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.start.mockRejectedValueOnce(problem(429, 'QOREID_RATE_LIMITED', 'External verification is temporarily rate limited'))
    await toDetails()
    await submitDetails()
    // Not Identity's own sentence: the page's, and a wait, so the day's CAC checks are not spent at once.
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t check your CAC registration number just now. '
      + 'Please try again in a minute.')
    expect(api.availability).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByText(/^You can try again in \d+ seconds?\.$/)).toBeTruthy())
    expect(continueButton().disabled).toBe(true)
    await act(async () => { vi.advanceTimersByTime(61_000) })
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    expect(await screen.findByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
  })

  /**
   * Activation creates the organization under the legal name QoreID gives for the CAC number, and binds that
   * number: one mistyped digit can register another company. Novu's …/profile (P4 round 2, R13) says what the
   * confirmed sign-up registers, and the page shows it before the account is made.
   */
  describe('what the confirmed sign-up registers', () => {
    const registering = () => document.getElementById('provider-registering')?.textContent
    const PROFILE = { organizationName: 'IKEJA CARE LIMITED', registrationNumber: 'RC123456', productCode: 'ehr',
      organizationType: 'hospital', administratorName: 'Ada Admin', administratorEmail: 'ada@example.test' }

    it('is read from …/profile once the email is confirmed, and shown before the account is made', async () => {
      api.profile.mockResolvedValueOnce(PROFILE)
      api.activate.mockResolvedValueOnce(session)
      await toPassword()
      expect(registering()).toBe('You’re registering IKEJA CARE LIMITED, CAC number RC123456, as a hospital, with Ada Admin as '
        + 'its administrator. Check that this is your organization before you create the account.')
      expect(screen.getByText('IKEJA CARE LIMITED').tagName).toBe('STRONG')
      expect(api.profile).toHaveBeenCalledTimes(1)
      expect(api.profile).toHaveBeenCalledWith()
      expect(api.profile.mock.invocationCallOrder[0]).toBeGreaterThan(api.verify.mock.invocationCallOrder[0]!)
      expect(api.activate).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
      createAccount()
      await screen.findByRole('heading', { name: 'Your facility is set up' })
    })

    it('names the CAC number, administrator and email Identity holds for the sign-up the code confirmed', async () => {
      // The enrollment cookie is the browser's: a code confirmed in another tab replaces this tab's sign-up.
      api.profile.mockResolvedValueOnce({ ...PROFILE, organizationName: 'LEKKI LABS LTD', registrationNumber: 'RC7654321',
        administratorName: 'Dr Ada Obi', administratorEmail: 'ada.obi@example.test' })
      await toPassword()
      expect(registering()).toBe('You’re registering LEKKI LABS LTD, CAC number RC7654321, as a hospital, with Dr Ada Obi as '
        + 'its administrator. Check that this is your organization before you create the account.')
      expect(document.getElementById('provider-password-hint')?.textContent).toMatch(/You’ll use it with ada\.obi@example\.test to sign in\./)
      expect((document.querySelector('input[autocomplete="username"]') as HTMLInputElement).value).toBe('ada.obi@example.test')
    })

    it('leaves out the administrator when Identity names none', async () => {
      api.profile.mockResolvedValueOnce({ organizationName: 'IKEJA CARE LIMITED', registrationNumber: 'RC123456' })
      await toPassword()
      expect(registering()).toBe('You’re registering IKEJA CARE LIMITED, CAC number RC123456. Check that this is your '
        + 'organization before you create the account.')
    })

    /**
     * The facility type and administrator name are the confirmed code's (R6). A start that sent no code changed
     * neither (0086 stores them only with a code it sends), so the page shows both for the administrator to check.
     */
    it.each([
      ['clinic', 'a clinic'],
      ['laboratory', 'a laboratory'],
      ['pharmacy', 'a pharmacy'],
      ['other', 'another kind of healthcare provider'],
    ])('names the facility type the account will keep (%s)', async (organizationType, phrase) => {
      api.profile.mockResolvedValueOnce({ ...PROFILE, organizationType })
      await toPassword()
      expect(registering()).toBe(`You’re registering IKEJA CARE LIMITED, CAC number RC123456, as ${phrase}, with Ada Admin as `
        + 'its administrator. Check that this is your organization before you create the account.')
    })

    it('leaves out a facility type it does not know', async () => {
      api.profile.mockResolvedValueOnce({ ...PROFILE, organizationType: 'spaceport' })
      await toPassword()
      expect(registering()).toBe('You’re registering IKEJA CARE LIMITED, CAC number RC123456, with Ada Admin as its '
        + 'administrator. Check that this is your organization before you create the account.')
    })

    it('names the facility type and administrator with the CAC number when Identity gives no name', async () => {
      api.profile.mockResolvedValueOnce({ registrationNumber: 'RC123456', organizationType: 'clinic', administratorName: 'Ada Admin' })
      await toPassword()
      expect(registering()).toBe('You’re registering the organization with CAC number RC123456, as a clinic, with Ada Admin '
        + 'as its administrator. Check that this is your organization’s number before you create the account.')
    })

    it('shows the facility type the code in force carries, when that code was not sent from this page', async () => {
      // Another tab's start sent the code in force for a clinic; this tab's start, for a hospital, sent none.
      api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-other-tab', expiresInSeconds: 500,
        resendAfterSeconds: 30 })
      api.profile.mockResolvedValueOnce({ ...PROFILE, organizationType: 'clinic' })
      await toPassword()
      expect(api.verify).toHaveBeenCalledWith('challenge-other-tab', '123456')
      expect(registering()).toMatch(/^You’re registering IKEJA CARE LIMITED, CAC number RC123456, as a clinic, with Ada Admin/)
    })

    it('leaves the CAC number to check after a 404 from an Identity without the route, and the account can still be made', async () => {
      api.profile.mockRejectedValueOnce(problem(404, 'NOT_FOUND'))
      api.activate.mockResolvedValueOnce(session)
      await toPassword()
      expect(registering()).toBe('You’re registering the organization with CAC number RC123456. Check that this is your '
        + 'organization’s number before you create the account.')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      createAccount()
      await screen.findByRole('heading', { name: 'Your facility is set up' })
    })

    it.each([
      ['the gateway’s 503', problem(503, 'UPSTREAM_UNAVAILABLE')],
      ['a 503 from Identity', problem(503, 'ORGANIZATION_COMPLETION_UNAVAILABLE')],
      ['a lost connection', new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' })],
    ])('after %s, says the name could not be loaded, reads it again on request, and does not stop the account', async (_, failure) => {
      api.profile.mockRejectedValueOnce(failure).mockResolvedValueOnce(PROFILE)
      await toPassword()
      expect(registering()).toMatch(/^You’re registering the organization with CAC number RC123456\./)
      expect(screen.getByText(/^We couldn’t load your organization’s registered name just now\./)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Create provider account' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
      expect((screen.getByRole('button', { name: 'Create provider account' }) as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(registering()).toMatch(/^You’re registering IKEJA CARE LIMITED, CAC number RC123456,/))
      expect(api.profile).toHaveBeenCalledTimes(2)
      expect(screen.queryByText(/We couldn’t load your organization’s registered name/)).toBeNull()
      expect(api.activate).not.toHaveBeenCalled()
    })

    it('goes back to the details when the enrollment session is gone (401), as activation would', async () => {
      api.profile.mockRejectedValueOnce(problem(401, 'ORGANIZATION_COMPLETION_SESSION_INVALID'))
      await toCode()
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      expect((await screen.findByRole('alert')).textContent).toBe('Your sign-up session has expired. Check your details and '
        + 'select Continue to get a new code.')
      expect((screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement).value).toBe('RC123456')
      expect(screen.queryByLabelText('Password')).toBeNull()
      expect(api.activate).not.toHaveBeenCalled()
    })

    it('shows the closed notice when sign-up closed after the code (423)', async () => {
      api.profile.mockRejectedValueOnce(problem(423, 'PROVIDER_ENROLLMENT_UNAVAILABLE', 'Facility self sign-up is not open'))
      await toCode()
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await closedNoticeShown()
    })

    it('says to sign out first when the browser signed in meanwhile (409), at the password step', async () => {
      api.profile.mockRejectedValueOnce(problem(409, 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT'))
      await toPassword()
      expect((screen.getByRole('alert')).textContent).toMatch(/^This browser is signed in to Health ID/)
      expect(registering()).toMatch(/^You’re registering the organization with CAC number RC123456\./)
    })

    it.each([
      ['no name', { registrationNumber: 'RC123456' }],
      ['a blank name', { organizationName: '   ' }],
      ['no answer', null],
    ])('leaves the CAC number to check when …/profile gives %s', async (_, answer) => {
      api.profile.mockResolvedValueOnce(answer)
      await toPassword()
      expect(registering()).toMatch(/^You’re registering the organization with CAC number RC123456\./)
    })

    it('reads no name from verify’s answer, which says only that the code was right', async () => {
      api.verify.mockResolvedValueOnce({ verified: true, organizationName: 'NOT FROM VERIFY LTD' })
      api.profile.mockResolvedValueOnce(PROFILE)
      await toPassword()
      expect(registering()).toMatch(/^You’re registering IKEJA CARE LIMITED,/)
      expect(screen.queryByText(/NOT FROM VERIFY/)).toBeNull()
    })

    it('“This isn’t my organization” goes back to the details to correct the CAC number, with no account made', async () => {
      api.profile.mockResolvedValueOnce({ ...PROFILE, organizationName: 'OTHER COMPANY LTD' })
        .mockResolvedValueOnce({ ...PROFILE, registrationNumber: 'RC123465' })
      api.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 60 })
        .mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-2', resendAfterSeconds: 60 })
      await toPassword()
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'This isn’t my organization' }))

      // The confirmed sign-up stays open, holding the number (Identity has no way for the applicant to close it).
      expect((await screen.findByRole('alert')).textContent).toBe('Check your details, and the CAC registration number on your '
        + 'CAC certificate. Correct them, then select Continue. No account has been created. For up to 24 hours, nobody else '
        + 'can sign up with the CAC number you entered. If it belongs to another company, tell Health ID support at '
        + `${SUPPORT}, and give that number, so they can free it.`)
      expect(screen.getByRole('link', { name: SUPPORT }).getAttribute('href')).toBe(`mailto:${SUPPORT}`)
      const cacField = screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement
      expect(cacField.value).toBe('RC123456')
      expect(api.activate).not.toHaveBeenCalled()
      // Main's answers (no codeSent): the same CAC number is the same sign-up, whose last code is under a minute old.
      expect(continueButton().disabled).toBe(true)
      // Another CAC number is another sign-up, which can start at once.
      fireEvent.change(cacField, { target: { value: 'RC123465' } })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      expect(screen.queryByText(/You can try again in/)).toBeNull()
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ cacRegistrationNumber: 'RC123465',
        administratorEmail: 'ada@example.test' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: '222222' } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      await screen.findByLabelText('Password')
      expect(api.verify).toHaveBeenLastCalledWith('challenge-2', '222222')
      // The password typed for the wrong organization is not kept, and the new sign-up is read afresh.
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
      expect(api.profile).toHaveBeenCalledTimes(2)
      expect(registering()).toMatch(/^You’re registering IKEJA CARE LIMITED, CAC number RC123465,/)
    })
  })

  /**
   * Novu says whether a start sent a code (P4 round 2, R14): with codeSent false no email went out, challengeId names
   * the code still in force (absent when none can still be entered), and resendAfterSeconds is the real wait.
   */
  describe('when Identity sends no new code (codeSent false)', () => {
    const resend = () => screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
    const sent = (challengeId: string, resendAfterSeconds = 60) =>
      ({ accepted: true, codeSent: true, challengeId, expiresInSeconds: 600, resendAfterSeconds })
    const codeHint = () => screen.getByRole('heading', { name: 'Confirm your administrator email' }).nextElementSibling?.textContent

    async function verifyWith(code: string) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: code } })
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    }

    it('says a sent code was sent, and waits as long as Identity says', async () => {
      api.start.mockResolvedValueOnce(sent('challenge-1', 45))
      await toCode()
      expect(codeHint()).toBe('Enter the six digit code sent to ada@example.test.')
      expect(screen.getByText(/^You can ask for a new code in (45|44) seconds\.$/)).toBeTruthy()
    })

    it('at the start, goes to the code still in force and says no new code was sent', async () => {
      api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-in-force',
        expiresInSeconds: 417, resendAfterSeconds: 41 })
      await toCode()
      expect(codeHint()).toBe('We didn’t send a new code, because one was sent to ada@example.test less than a minute ago. '
        + 'Enter the six digit code from that email.')
      expect(screen.queryByText(/We’ve sent a new code/)).toBeNull()
      expect(screen.getByText(/^You can ask for a new code in (41|40) seconds\.$/)).toBeTruthy()
      expect(resend().disabled).toBe(true)
      await verifyWith('417417')
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-in-force', '417417'))
    })

    it('at the start past a limit, says so, and offers a new code only when Identity would send one', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-5', expiresInSeconds: 300,
        resendAfterSeconds: 3295 })
      await toCode()
      expect(codeHint()).toBe('We didn’t send a new code, because we’ve sent as many as we can for now. Enter the six digit '
        + 'code from the latest email Health ID sent to ada@example.test.')
      // Identity's own wait, not one clamped to 10 minutes.
      expect(screen.getByText(/^We’ve sent as many codes as we can for now\. Use the code in the latest email from Health ID, or ask for a new one in (55|54) minutes\.$/)).toBeTruthy()
      expect(resend().disabled).toBe(true)
      await act(async () => { vi.advanceTimersByTime(20 * 60_000) })
      expect(resend().disabled).toBe(true)
      await act(async () => { vi.advanceTimersByTime(35 * 60_000) })
      await waitFor(() => expect(resend().disabled).toBe(false))
    })

    it('at the start with no code left to enter, stays at the details and waits as long as Identity says', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: 38 })
        .mockResolvedValueOnce(sent('challenge-2'))
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe('We can’t send a new code for these details yet.')
      expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
      expect(screen.getByText(/^You can try again in (38|37) seconds\.$/)).toBeTruthy()
      expect(continueButton().disabled).toBe(true)
      await act(async () => { vi.advanceTimersByTime(39_000) })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      await verifyWith('222222')
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-2', '222222'))
    })

    it('at the start with no code left past the email’s daily limit, says so and how long', async () => {
      api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: 78_660 })
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe('We’ve sent as many codes for these details as we can for now.')
      expect(screen.getByText('You can try again in about 22 hours.')).toBeTruthy()
      expect(continueButton().disabled).toBe(true)
      // Other details are another sign-up.
      fireEvent.change(screen.getByRole('textbox', { name: 'CAC registration number' }), { target: { value: 'RC654321' } })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
    })

    it('“Send a new code” that sends none says the latest code still works, and keeps verifying it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockResolvedValueOnce(sent('challenge-1'))
        .mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-other-tab', expiresInSeconds: 560,
          resendAfterSeconds: 20 })
      await toCode()
      await act(async () => { vi.advanceTimersByTime(61_000) })
      await waitFor(() => expect(resend().disabled).toBe(false))
      fireEvent.click(resend())
      expect((await screen.findByText('We didn’t send a new code: the code in the latest email from Health ID still works.'))
        .parentElement?.getAttribute('role')).toBe('status')
      expect(screen.queryByText(/We’ve sent a new code/)).toBeNull()
      expect(screen.getByText(/^You can ask for a new code in (20|19) seconds\.$/)).toBeTruthy()
      await verifyWith('333333')
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-other-tab', '333333'))
    })

    it('“Send a new code” that sends none, with no code left, says so and how long until one', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.start.mockResolvedValueOnce(sent('challenge-1'))
        .mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: 80_000 })
      await toCode()
      await act(async () => { vi.advanceTimersByTime(61_000) })
      await waitFor(() => expect(resend().disabled).toBe(false))
      fireEvent.click(resend())
      expect((await screen.findByText('We didn’t send a new code, and the last one can no longer be used.'))
        .parentElement?.getAttribute('role')).toBe('status')
      expect(screen.getByText('We’ve sent as many codes as we can for now. You can ask for a new one in about 23 hours.')).toBeTruthy()
      expect(resend().disabled).toBe(true)
    })

    it('counts no codes itself: Identity’s answers decide, past 5 in an hour too', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let count = 0
      api.start.mockImplementation(async () => sent(`challenge-${++count}`))
      await toCode()
      for (let next = 2; next <= 6; next += 1) {
        await act(async () => { vi.advanceTimersByTime(61_000) })
        await waitFor(() => expect(resend().disabled).toBe(false))
        fireEvent.click(resend())
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(next))
      }
      expect(screen.queryByText(/We’ve sent as many codes as we can for now/)).toBeNull()
      await verifyWith('666666')
      await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-6', '666666'))
    })

    it('needs no wait after “Start again”: a start within the minute answers with the code in force', async () => {
      api.start.mockResolvedValueOnce(sent('challenge-1'))
        .mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 590,
          resendAfterSeconds: 50 })
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      expect(screen.queryByText(/You can try again in/)).toBeNull()
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      expect(codeHint()).toMatch(/^We didn’t send a new code, because one was sent to ada@example\.test less than a minute ago\./)
      expect(api.start).toHaveBeenCalledTimes(2)
    })

    it('needs no wait after an expired session either', async () => {
      api.start.mockResolvedValueOnce(sent('challenge-1'))
      api.activate.mockRejectedValueOnce(problem(401, 'ORGANIZATION_COMPLETION_SESSION_INVALID'))
      await toPassword()
      createAccount()
      expect((await screen.findByRole('alert')).textContent).toMatch(/^Your sign-up session has expired\./)
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      expect(screen.queryByText(/You can try again in/)).toBeNull()
    })

    it('still waits a minute after a start whose answer was lost', async () => {
      api.start.mockResolvedValueOnce(sent('challenge-1')).mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      expect((await screen.findByRole('alert')).textContent).toBe(START_UNAVAILABLE)
      expect(continueButton().disabled).toBe(true)
      expect(screen.getByText(/^You can try again in \d+ seconds?\.$/)).toBeTruthy()
    })
  })

  /**
   * Availability's reason (P4 round 2, R10): 'closed' when sign-up is switched off or not configured, 'unavailable'
   * when Identity could not tell because of a fault. A fault must not tell an applicant that sign-up is closed.
   */
  describe('availability’s reason', () => {
    const unavailableShown = async () => {
      const heading = await screen.findByRole('heading', { name: 'Facility sign-up is temporarily unavailable' })
      await waitFor(() => expect(document.activeElement).toBe(heading))
      expect(heading.nextElementSibling?.textContent).toBe('We can’t take facility sign-ups just now because of a problem on '
        + `our side. Please try again in a few minutes. If this keeps happening, contact Health ID support at ${SUPPORT}.`)
      expect(screen.queryByRole('heading', { name: 'Facility sign-up isn’t open right now' })).toBeNull()
      expect(screen.queryByText(/can’t sign themselves up/)).toBeNull()
      expect(screen.queryByRole('textbox', { name: 'CAC registration number' })).toBeNull()
      expect(screen.queryByRole('list', { name: 'Provider enrollment steps' })).toBeNull()
    }

    it('shows the closed notice for reason closed', async () => {
      api.availability.mockResolvedValueOnce({ open: false, reason: 'closed' })
      open()
      await closedNoticeShown()
    })

    it('says sign-up is temporarily unavailable, not closed, for reason unavailable, and asks again on request', async () => {
      api.availability.mockResolvedValueOnce({ open: false, reason: 'unavailable' }).mockResolvedValueOnce({ open: true })
      open()
      await unavailableShown()
      expect(api.start).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
      expect(api.availability).toHaveBeenCalledTimes(2)
    })

    it('treats a reason it does not know as unavailable, never as closed', async () => {
      api.availability.mockResolvedValueOnce({ open: false, reason: 'something-new' })
      open()
      await unavailableShown()
    })

    it('keeps the start’s own words after an outage when availability answers unavailable', async () => {
      api.start.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toDetails()
      api.availability.mockResolvedValueOnce({ open: false, reason: 'unavailable' })
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toBe(START_UNAVAILABLE)
      expect(api.availability).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('heading', { name: 'Facility sign-up isn’t open right now' })).toBeNull()
      expect(screen.getByRole('textbox', { name: 'CAC registration number' })).toBeTruthy()
    })

    it('shows the closed notice after an outage when availability answers closed', async () => {
      api.start.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toDetails()
      api.availability.mockResolvedValueOnce({ open: false, reason: 'closed' })
      await submitDetails()
      await closedNoticeShown()
    })

    it('says the account may already be ready, not closed, when sign-up closes after an activation’s answer was lost', async () => {
      api.activate.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
      await toPassword()
      api.availability.mockResolvedValueOnce({ open: false, reason: 'closed' })
      createAccount()
      expect(await screen.findByRole('heading', { name: 'Your account may already be ready' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Facility sign-up isn’t open right now' })).toBeNull()
    })

    it('says the account may already be ready when a retry after a lost answer finds sign-up closed (423)', async () => {
      api.activate.mockRejectedValueOnce(problem(503, 'UPSTREAM_UNAVAILABLE'))
        .mockRejectedValueOnce(problem(423, 'PROVIDER_ENROLLMENT_UNAVAILABLE', 'Facility self sign-up is not open'))
      await toPassword()
      createAccount()
      expect((await screen.findByRole('alert')).textContent).toBe(STEP_UNAVAILABLE)
      createAccount()
      expect(await screen.findByRole('heading', { name: 'Your account may already be ready' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Facility sign-up isn’t open right now' })).toBeNull()
    })
  })

  /**
   * An open sign-up keeps its CAC number and product for the email it was started with: Identity refuses another
   * email for it (409 PROVIDER_ENROLLMENT_REQUIRES_REVIEW) and, after it lapses 24 hours after it started, still
   * refuses one from the same network for 7 days (0086, A8 and R3). A changed administrator name or facility type is
   * kept with the next code and the account takes it (R6).
   */
  describe('starting again with other details', () => {
    const KEPT = 'A sign-up for RC123456 was started with ada@example.test, and only that email can finish it. You can '
      + 'still correct the CAC number.'
    const keptNote = () => screen.queryByText(/^A sign-up for RC123456 was started with/)
    const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement

    it('says another email can’t finish the sign-up, before and after the start, and offers the first one back', async () => {
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      expect(keptNote()).toBeNull()
      fireEvent.change(field('Administrator email'), { target: { value: 'ada@example.org' } })
      // Said before the start, too.
      expect(keptNote()?.textContent).toBe(KEPT)
      // Another email is another sign-up at Identity: no wait for the first one's code.
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      api.start.mockRejectedValueOnce(problem(409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'This provider organization requires manual resolution'))
      fireEvent.click(continueButton())

      expect((await screen.findByRole('alert')).textContent).toBe('This CAC number’s sign-up was started with ada@example.test, '
        + 'so it can’t use another email. Finish it with the code sent to ada@example.test. Otherwise, contact Health ID '
        + `support at ${SUPPORT}, and give your CAC registration number.`)
      expect(screen.queryByText(/24 hours/)).toBeNull()
      expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ administratorEmail: 'ada@example.org' }))

      fireEvent.click(screen.getByRole('button', { name: 'Use the email I first gave' }))
      expect(field('Administrator email').value).toBe('ada@example.test')
      expect(keptNote()).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('sends a changed administrator name or facility type, which the next code carries', async () => {
      api.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      fireEvent.click(screen.getByRole('radio', { name: 'Clinic' }))
      fireEvent.change(field('Administrator full name'), { target: { value: 'Dr Ada Obi' } })
      expect(keptNote()).toBeNull()
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      expect(api.start).toHaveBeenCalledTimes(2)
      expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ administratorName: 'Dr Ada Obi',
        organizationType: 'clinic', administratorEmail: 'ada@example.test' }))
    })

    it('stops saying so 24 hours after the first sign-up started (not after the last code)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await toCode()
      // A new code does not restart the 24 hours: Identity counts them from the sign-up's first start.
      await act(async () => { vi.advanceTimersByTime(61_000) })
      const resendButton = screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      await waitFor(() => expect(resendButton.disabled).toBe(false))
      fireEvent.click(resendButton)
      await screen.findByText('We’ve sent a new code to ada@example.test.')
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      fireEvent.change(field('Administrator email'), { target: { value: 'ada@example.org' } })
      expect(keptNote()).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(24 * 60 * 60_000 - 61_000 + 5_000) })
      // Re-rendered by the next change; the page no longer knows whether the first sign-up holds anything.
      fireEvent.change(field('Administrator full name'), { target: { value: 'Ada Obi' } })
      expect(keptNote()).toBeNull()
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ administratorName: 'Ada Obi',
        administratorEmail: 'ada@example.org' }))
    })

    it('keeps the general words for a sign-up this page did not start (409 PROVIDER_ENROLLMENT_REQUIRES_REVIEW)', async () => {
      api.start.mockRejectedValueOnce(problem(409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW'))
      await toDetails()
      await submitDetails()
      expect((await screen.findByRole('alert')).textContent).toMatch(/^This organization can’t be set up automatically right now:/)
      expect(keptNote()).toBeNull()
    })

    /**
     * A changed facility type or administrator name goes with the next code sent (R6), and only with it: a start that
     * sends no code (codeSent false) stores them nowhere, and the code in force keeps the type and name it was sent with,
     * which the account then takes (0086 begin_self_service_provider_enrollment). P4 round 2 review.
     */
    describe('when Identity sends no code for them (codeSent false)', () => {
      const sent = (challengeId: string, resendAfterSeconds = 60) =>
        ({ accepted: true, codeSent: true, challengeId, expiresInSeconds: 600, resendAfterSeconds })
      const inForce = (challengeId: string, resendAfterSeconds: number, expiresInSeconds = 590) =>
        ({ accepted: true, codeSent: false, challengeId, expiresInSeconds, resendAfterSeconds })
      const panel = () => screen.queryByText(/^A new facility type or administrator name takes effect only with a new code\./)
      const useEarlier = () => screen.queryByRole('button', { name: 'Use the details I gave before' })
      const codeHeading = () => screen.queryByRole('heading', { name: 'Confirm your administrator email' })
      const codeHint = () => codeHeading()?.nextElementSibling?.textContent
      const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

      async function startAgain() {
        fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
        await screen.findByRole('button', { name: 'Continue' })
        await waitFor(() => expect(continueButton().disabled).toBe(false))
      }

      async function verifyWith(code: string) {
        fireEvent.change(screen.getByRole('textbox', { name: 'Email verification code' }), { target: { value: code } })
        fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
      }

      it('stays at the details, says the change was not applied, and continues with it once a code can carry it', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        api.start.mockResolvedValueOnce(sent('challenge-1')).mockResolvedValueOnce(inForce('challenge-1', 50))
          .mockResolvedValueOnce(sent('challenge-2'))
        await toDetails()
        fireEvent.click(radio('Clinic'))
        await submitDetails()
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        await startAgain()
        fireEvent.click(radio('Hospital'))
        fireEvent.click(continueButton())

        expect((await screen.findByRole('alert')).textContent).toBe('We didn’t send a new code, because one was sent to '
          + 'ada@example.test less than a minute ago, so your changes haven’t been applied.')
        expect(api.start).toHaveBeenCalledTimes(2)
        expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ organizationType: 'hospital' }))
        // Not the code step: its code would register a clinic.
        expect(codeHeading()).toBeNull()
        expect(radio('Hospital').checked).toBe(true)
        expect(panel()?.textContent).toBe('A new facility type or administrator name takes effect only with a new code. The '
          + 'code already sent is for the facility type Clinic, with Ada Admin as administrator.')
        expect(useEarlier()).toBeTruthy()
        expect(screen.getByText(/^You can continue with your changes in (50|49) seconds\.$/)).toBeTruthy()
        expect(continueButton().disabled).toBe(true)
        // Nor does submitting the form another way, once the security check has a new token.
        await act(async () => { vi.advanceTimersByTime(1_000) })
        await act(async () => { fireEvent.submit(continueButton().closest('form')!) })
        expect(api.start).toHaveBeenCalledTimes(2)
        expect(codeHeading()).toBeNull()

        await act(async () => { vi.advanceTimersByTime(51_000) })
        await waitFor(() => expect(continueButton().disabled).toBe(false))
        expect(panel()).toBeNull()
        expect(screen.queryByText(/You can continue with your changes/)).toBeNull()
        fireEvent.click(continueButton())
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        expect(codeHint()).toBe('Enter the six digit code sent to ada@example.test.')
        expect(api.start).toHaveBeenCalledTimes(3)
        expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ organizationType: 'hospital',
          administratorName: 'Ada Admin' }))
        await verifyWith('222222')
        await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-2', '222222'))
      })

      it('offers the code already sent with the details it carries, and holds the changes again after “Start again”', async () => {
        api.start.mockResolvedValueOnce(sent('challenge-1')).mockResolvedValueOnce(inForce('challenge-1', 45))
        await toCode()
        await startAgain()
        fireEvent.change(field('Administrator full name'), { target: { value: 'Dr Ada Obi' } })
        fireEvent.click(radio('Clinic'))
        fireEvent.click(continueButton())
        await screen.findByRole('alert')
        expect(panel()?.textContent).toMatch(/The code already sent is for the facility type Hospital, with Ada Admin as administrator\.$/)

        fireEvent.click(useEarlier()!)
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        expect(codeHint()).toBe('We didn’t send a new code, because one was sent to ada@example.test less than a minute ago. '
          + 'Enter the six digit code from that email.')
        expect(screen.queryByRole('alert')).toBeNull()

        // The form holds the details the code carries: not held, and nothing more was sent.
        await startAgain()
        expect(field('Administrator full name').value).toBe('Ada Admin')
        expect(radio('Hospital').checked).toBe(true)
        expect(panel()).toBeNull()
        // Changed again, they wait as before, with no other start.
        fireEvent.click(radio('Clinic'))
        expect(panel()).toBeTruthy()
        expect(continueButton().disabled).toBe(true)
        expect(screen.getByText(/^You can continue with your changes in \d+ seconds?\.$/)).toBeTruthy()
        fireEvent.click(radio('Hospital'))
        expect(panel()).toBeNull()
        expect(continueButton().disabled).toBe(false)
        api.start.mockResolvedValueOnce(inForce('challenge-1', 30))
        fireEvent.click(continueButton())
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        expect(codeHint()).toMatch(/^We didn’t send a new code, because one was sent to ada@example\.test less than a minute ago\./)
        expect(api.start).toHaveBeenCalledTimes(3)
        await verifyWith('111111')
        await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-1', '111111'))
      })

      it('past a limit, says so, holds only the changed details, and stops offering the code once it has expired', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        api.start.mockResolvedValueOnce(sent('challenge-5', 3_300)).mockResolvedValueOnce(inForce('challenge-5', 3_295, 30))
          .mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: 3_260 })
        await toCode()
        await startAgain()
        fireEvent.change(field('Administrator full name'), { target: { value: 'Dr Ada Obi' } })
        fireEvent.click(continueButton())

        expect((await screen.findByRole('alert')).textContent).toBe('We didn’t send a new code, because we’ve sent as many as '
          + 'we can for now, so your changes haven’t been applied.')
        expect(panel()?.textContent).toMatch(/is for the facility type Hospital, with Ada Admin as administrator\.$/)
        expect(screen.getByText(/^You can continue with your changes in (55|54) minutes\.$/)).toBeTruthy()
        expect(useEarlier()).toBeTruthy()
        // The code in force expires: it is no longer offered, and the changes still wait.
        await act(async () => { vi.advanceTimersByTime(31_000) })
        await waitFor(() => expect(useEarlier()).toBeNull())
        expect(panel()).toBeTruthy()
        expect(continueButton().disabled).toBe(true)

        // The details the code carried are not held by the changes: Identity answers for them.
        fireEvent.change(field('Administrator full name'), { target: { value: 'Ada Admin' } })
        expect(panel()).toBeNull()
        await waitFor(() => expect(continueButton().disabled).toBe(false))
        fireEvent.click(continueButton())
        await waitFor(() => expect(screen.getByRole('alert').textContent)
          .toBe('We’ve sent as many codes for these details as we can for now.'))
        expect(api.start).toHaveBeenCalledTimes(3)
        expect(screen.getByText(/^You can try again in (55|54) minutes\.$/)).toBeTruthy()
      })

      it('goes to the code in force as before when it carries the same type and name', async () => {
        api.start.mockResolvedValueOnce(sent('challenge-1')).mockResolvedValueOnce(inForce('challenge-1', 40))
        await toCode()
        await startAgain()
        // A changed email is another sign-up, and a corrected one back is the same: neither is a type or name change.
        fireEvent.change(field('Administrator email'), { target: { value: 'ada@example.org' } })
        fireEvent.change(field('Administrator email'), { target: { value: 'ada@example.test' } })
        fireEvent.click(continueButton())
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        expect(codeHint()).toMatch(/^We didn’t send a new code, because one was sent to ada@example\.test less than a minute ago\./)
        expect(panel()).toBeNull()
      })

      it('holds nothing once the code in force has been used', async () => {
        api.start.mockResolvedValueOnce(sent('challenge-1')).mockResolvedValueOnce(inForce('challenge-1', 45))
          .mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: 20 })
        await toCode()
        await startAgain()
        fireEvent.click(radio('Clinic'))
        fireEvent.click(continueButton())
        await screen.findByRole('alert')
        fireEvent.click(useEarlier()!)
        await screen.findByRole('heading', { name: 'Confirm your administrator email' })
        await verifyWith('111111')
        await screen.findByLabelText('Password')
        fireEvent.click(screen.getByRole('button', { name: 'This isn’t my organization' }))
        await screen.findByRole('button', { name: 'Continue' })
        fireEvent.click(radio('Clinic'))
        expect(panel()).toBeNull()
        await waitFor(() => expect(continueButton().disabled).toBe(false))
        fireEvent.click(continueButton())
        expect((await screen.findByText('We can’t send a new code for these details yet.')).getAttribute('role')).toBe('alert')
        expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ organizationType: 'clinic' }))
      })
    })
  })
})

describe('provider enrollment on main keeps Identity’s words for a refused activation', () => {
  it('says nothing of a 24-hour lapse when another email is refused (main has none)', async () => {
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('textbox', { name: 'Email verification code' })
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Administrator email' }), { target: { value: 'ada@example.org' } })
    expect(screen.queryByText(/can’t be changed until 24 hours after it started/)).toBeNull()
    api.start.mockRejectedValueOnce(new HidApiError(409, 'This provider application requires manual resolution',
      { code: 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^This organization needs a check by Health ID before it can be set up/)
  })

  it('says an administrator email that already has an account can’t be used, as before (main has no 24-hour lapse)', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(409, 'The administrator email is already associated with an HID account',
      { code: 'PROVIDER_EMAIL_ALREADY_REGISTERED' }))
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))
    const heading = await screen.findByRole('heading', { name: 'This email already has a Health ID account' })
    expect(heading.nextElementSibling?.textContent).toBe('The administrator email already belongs to a Health ID account, '
      + 'for example a patient account, so it can’t also be this facility’s administrator. Signing up again with another '
      + 'email for the same CAC number won’t work either. Contact Health ID support at support@healthidentitydirectory.com '
      + 'to finish setting up your facility.')
  })

  it('shows a 401 at activation as it is, at the password step (no Novu sign-in after activation there)', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(401, 'Organization profile completion session is invalid or expired',
      { code: 'AUTHENTICATION_REQUIRED' }))
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email verification code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Organization profile completion session is invalid or expired')
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your account may already be ready' })).toBeNull()
  })
})

/**
 * hid-system accepts facility self sign-up's security check only on the main site (P4, W1), so the page on a staff
 * product host (a bookmark, an old link) sends the administrator there instead of showing a form that would be refused.
 */
describe('provider enrollment opened on a staff product host', () => {
  const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
  const servedFrom = window.location.href
  afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

  it.each([
    ['ehr.healthidentitydirectory.com', '/provider/enroll', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['lab.healthidentitydirectory.com', '/provider/enroll?product=laboratory', 'https://app.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/enroll?product=pharmacy', 'https://staging.healthidentitydirectory.com/provider/enroll?product=pharmacy'],
    ['ehr.healthidentitydirectory.com', '/provider/enroll?product=https://evil.example', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ])('on %s (%s) links to the main site, with no form', async (hostname, entry, href) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    jsdom.reconfigure({ url: `https://${hostname}${entry}` })
    open(entry)
    expect(screen.getByRole('link', { name: 'Continue to facility sign-up' }).getAttribute('href')).toBe(href)
    expect(screen.getByText('Facility sign-up is done on the main Health ID site.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'CAC registration number' })).toBeNull()
    expect(api.availability).not.toHaveBeenCalled()
  })
})
