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
      // An open sign-up for the CAC number with another email lapses after 24 hours (0086, A8); support can't end it sooner.
      [409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'This organization can’t be set up automatically right now. Its CAC number '
        + 'may already be linked to Health ID, or a sign-up for it with another email may have started less than 24 hours '
        + 'ago: you can sign up again 24 hours after that one started. Otherwise, contact Health ID support at '
        + `${SUPPORT}, and give your CAC registration number.`],
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
      // The refused sign-up holds the CAC number for this email until it lapses, 24 hours after it began (0086, A8).
      expect(heading.nextElementSibling?.textContent).toBe('The administrator email already belongs to a Health ID account, '
        + 'for example a patient account or a staff account, so it can’t also be this facility’s administrator. To sign up '
        + 'with another email for the same CAC number, start again 24 hours after this sign-up began: until then the CAC '
        + `number is held for it. Contact Health ID support at ${SUPPORT} to finish setting up your facility.`)
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
   * number: one mistyped digit can register another company. The page shows that name before the account is made
   * (P4 review).
   */
  describe('the organization the CAC number names', () => {
    const registering = () => document.getElementById('provider-registering')?.textContent

    it('is shown from …/profile once the email is confirmed, before the account is made', async () => {
      api.profile.mockResolvedValueOnce({ organizationName: 'IKEJA CARE LIMITED', registrationNumber: 'RC••••56', productCode: 'ehr' })
      api.activate.mockResolvedValueOnce(session)
      await toPassword()
      expect(registering()).toBe('You’re registering IKEJA CARE LIMITED, CAC number RC123456. Check that this is your '
        + 'organization before you create the account.')
      expect(screen.getByText('IKEJA CARE LIMITED').tagName).toBe('STRONG')
      expect(api.profile).toHaveBeenCalledTimes(1)
      expect(api.profile.mock.invocationCallOrder[0]).toBeGreaterThan(api.verify.mock.invocationCallOrder[0]!)
      expect(api.activate).not.toHaveBeenCalled()
      createAccount()
      await screen.findByRole('heading', { name: 'Your facility is set up' })
    })

    it('is taken from verify’s answer when Identity says it there', async () => {
      api.verify.mockResolvedValueOnce({ verified: true, organizationName: 'LEKKI LABS LTD' })
      await toPassword()
      expect(registering()).toMatch(/^You’re registering LEKKI LABS LTD, CAC number RC123456\./)
      expect(api.profile).not.toHaveBeenCalled()
    })

    it('is read from the governed completion profile’s shape too', async () => {
      api.profile.mockResolvedValueOnce({ status: 'ready_for_review', registrationNumber: 'RC123456',
        fields: { companyName: { value: 'ABUJA PHARMACY LTD', source: 'qoreid' } } })
      await toPassword()
      expect(registering()).toMatch(/^You’re registering ABUJA PHARMACY LTD, CAC number RC123456\./)
    })

    it.each([
      ['404 from an Identity without the route', problem(404, 'NOT_FOUND')],
      ['the gateway’s 503', problem(503, 'UPSTREAM_UNAVAILABLE')],
      ['401 ORGANIZATION_COMPLETION_SESSION_INVALID', problem(401, 'ORGANIZATION_COMPLETION_SESSION_INVALID')],
    ])('leaves the CAC number to check after %s, and the account can still be made', async (_, failure) => {
      api.profile.mockRejectedValueOnce(failure)
      api.activate.mockResolvedValueOnce(session)
      await toPassword()
      expect(registering()).toBe('You’re registering the organization with CAC number RC123456. Check that this is your '
        + 'organization’s number before you create the account.')
      expect(screen.queryByRole('alert')).toBeNull()
      createAccount()
      await screen.findByRole('heading', { name: 'Your facility is set up' })
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

    it('“This isn’t my organization” goes back to the details to correct the CAC number, with no account made', async () => {
      api.profile.mockResolvedValueOnce({ organizationName: 'OTHER COMPANY LTD' })
      api.start.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 60 })
        .mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-2', resendAfterSeconds: 60 })
      await toPassword()
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'This isn’t my organization' }))

      expect((await screen.findByRole('alert')).textContent).toBe('Check the CAC registration number on your CAC certificate, '
        + 'correct it, then select Continue. No account has been created.')
      const cacField = screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement
      expect(cacField.value).toBe('RC123456')
      expect(api.activate).not.toHaveBeenCalled()
      // The same CAC number is the same sign-up, whose last code is under a minute old: it waits.
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
      // The password typed for the wrong organization is not kept.
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
      expect(registering()).toMatch(/CAC number RC123465\./)
    })
  })

  /**
   * An open sign-up holds its CAC number and product for the email it was started with, and keeps its
   * administrator name and facility type, until it lapses 24 hours after it started (0086, A8). Identity refuses
   * another email for it (409 PROVIDER_ENROLLMENT_REQUIRES_REVIEW) and answers the same email with the sign-up
   * unchanged, and support has no command to end it sooner (P4 review).
   */
  describe('starting again with other details', () => {
    const KEPT = 'A sign-up for RC123456 was started with ada@example.test, as Ada Admin (Hospital). Its email, administrator '
      + 'name and facility type can’t be changed until 24 hours after it started. You can still correct the CAC number.'
    const keptNote = () => screen.queryByText(/^A sign-up for RC123456 was started with/)
    const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement

    it('says another email can’t be used yet, and when it can, instead of pointing to support', async () => {
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
        + 'so it can’t use another email yet. Finish it with the code sent to ada@example.test, or sign up with the new email '
        + '24 hours after the first sign-up started.')
      expect(screen.queryByRole('link', { name: SUPPORT })).toBeNull()
      expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({ administratorEmail: 'ada@example.org' }))

      fireEvent.click(screen.getByRole('button', { name: 'Use the details I first gave' }))
      expect(field('Administrator email').value).toBe('ada@example.test')
      expect(keptNote()).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('does not send a changed name or facility type that Identity would drop, and offers the first ones back', async () => {
      api.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
      await toCode()
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      fireEvent.click(screen.getByRole('radio', { name: 'Clinic' }))
      expect(keptNote()?.textContent).toBe(KEPT)
      fireEvent.click(screen.getByRole('radio', { name: 'Hospital' }))
      expect(keptNote()).toBeNull()
      fireEvent.change(field('Administrator full name'), { target: { value: 'Ada Obi' } })
      expect(keptNote()?.textContent).toBe(KEPT)
      await waitFor(() => expect(continueButton().disabled).toBe(false))
      fireEvent.click(continueButton())

      expect((await screen.findByRole('alert')).textContent).toBe('This sign-up was started with the administrator name Ada '
        + 'Admin and the facility type Hospital. These can’t be changed until 24 hours after it started. Use the details you '
        + 'first gave to continue.')
      expect(api.start).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('button', { name: 'Use the details I first gave' }))
      expect(field('Administrator full name').value).toBe('Ada Admin')
      fireEvent.click(continueButton())
      await screen.findByRole('heading', { name: 'Confirm your administrator email' })
      expect(api.start).toHaveBeenCalledTimes(2)
      expect(api.start.mock.calls[1]?.[0]).toEqual(api.start.mock.calls[0]?.[0])
    })

    it('sends changed details once the first sign-up has lapsed, 24 hours after it started (not after the last code)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await toCode()
      // A new code does not restart the 24 hours: Identity counts them from the sign-up's first start.
      await act(async () => { vi.advanceTimersByTime(61_000) })
      const resend = screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
      await waitFor(() => expect(resend.disabled).toBe(false))
      fireEvent.click(resend)
      await screen.findByText('We’ve sent a new code to ada@example.test.')
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
      await screen.findByRole('button', { name: 'Continue' })
      fireEvent.change(field('Administrator full name'), { target: { value: 'Ada Obi' } })
      expect(keptNote()).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(24 * 60 * 60_000 - 61_000 + 5_000) })
      // Re-rendered by the next change; the first sign-up no longer holds anything.
      fireEvent.change(field('Administrator email'), { target: { value: 'ada@example.org' } })
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
      expect((await screen.findByRole('alert')).textContent).toMatch(/^This organization can’t be set up automatically right now\./)
      expect(keptNote()).toBeNull()
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
