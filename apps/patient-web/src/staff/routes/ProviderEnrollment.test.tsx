import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ProviderEnrollment } from './ProviderEnrollment'

/**
 * The portal's self-service provider enrollment (/provider/enroll), which the
 * public site's /provider/apply links to. hid-system's provider-enrollment
 * routes take the CAC, verify the administrator email and activate the account.
 */
const api = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), activate: vi.fn() }))
const staff = vi.hoisted(() => ({ verifyMfa: vi.fn(), sendEnrollmentCode: vi.fn(), startEnrollment: vi.fn(), activateEnrollment: vi.fn() }))
vi.mock('../api', () => ({ providerEnrollmentApi: api, staffApi: staff }))
// Clinician self sign-up's way in (hid-system ADR-064) asks Identity whether intake is open.
const clinician = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: clinician }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test', appOrigin: 'http://localhost:3200' }) }))

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
  api.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
  api.verify.mockResolvedValue({ verified: true })
  clinician.availability.mockResolvedValue({ open: false })
})
afterEach(() => vi.unstubAllGlobals())

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

    expect((await screen.findByRole('alert')).textContent).toBe('This provider application requires manual resolution')
    expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
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

describe('clinician self sign-up from provider enrollment (hid-system ADR-064)', () => {
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
