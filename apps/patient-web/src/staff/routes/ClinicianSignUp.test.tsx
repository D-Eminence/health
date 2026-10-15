import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ClinicianSignUp } from './ClinicianSignUp'

/**
 * Clinician self sign-up at /provider/join (hid-system ADR-064, P0-P9): a
 * doctor or nurse proves a work email, gives a licence and a facility, chooses
 * a password, and sets up an authenticator before two HID administrators
 * review the application. No session is opened and nothing is said to be
 * verified or approved.
 */
const api = vi.hoisted(() => ({
  availability: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), searchFacilities: vi.fn(), submit: vi.fn(),
  authenticator: { sendEmailCode: vi.fn(), start: vi.fn(), activate: vi.fn(), verify: vi.fn(), reopen: vi.fn() },
  sendStatusCode: vi.fn(), verifyStatusCode: vi.fn(), current: vi.fn(), withdraw: vi.fn(), apply: vi.fn(), endSession: vi.fn(),
}))
const keys = vi.hoisted(() => ({ count: 0 }))
vi.mock('../clinicianApplicationApi', () => ({
  clinicianApplicationApi: api,
  newClinicianIdempotencyKey: () => `submission-key-${++keys.count}`,
  CLINICIAN_REGULATOR_OF: { doctor: 'MDCN', nurse: 'NMCN' },
}))
// The security check, as a button that hands over a token named for its action and its reset count.
vi.mock('../../Turnstile', () => ({
  Turnstile: ({ action, onTokenChange, resetKey }: { action: string; onTokenChange: (token: string | null) => void; resetKey: number }) =>
    <button type="button" onClick={() => onTokenChange(`${action}-check-${resetKey}`)}>Complete check</button>,
}))

const problem = (status: number, code: string, message = code) => new HidApiError(status, message, { code })
const FACILITY = { facilityId: '7c0d5b8e-4c1a-4f0e-9a51-0d6b2f7e9a10', name: 'Lagos General Hospital', organizationName: 'Lagos General Ltd' }
const OTHER = { facilityId: '8d1e6c9f-5d2b-4a1f-8b62-1e7c3a8f0b21', name: 'Lagos Island Clinic', organizationName: 'Island Health' }
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const SETUP = { secret: SECRET, otpauthUri: `otpauth://totp/Health%20ID%20Provider:ada%40example.test?secret=${SECRET}&issuer=Health%20ID`,
  algorithm: 'SHA1', digits: 6, periodSeconds: 30, expiresAt: '2026-10-15T09:10:00.000Z' }
const RECOVERY_CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX', '01234-56789']
/** A licence still valid next year, whenever the tests run. */
const VALID_UNTIL = `${new Date().getFullYear() + 1}-06-30`
const VIEW = { applicationId: 'a1', state: 'submitted', version: 2, facility: { id: FACILITY.facilityId, name: FACILITY.name },
  profession: 'doctor', regulator: { code: 'MDCN', name: 'Medical and Dental Council of Nigeria' }, licenceNumberHint: '2345',
  submittedAt: '2026-10-15T09:00:00.000Z', expiresAt: '2026-11-14T09:00:00.000Z', decidedAt: null, decisionCode: null, accessState: null,
  canWithdraw: true }
const ACCOUNT = { account: { email: 'ada@example.test', fullName: 'Ada Obi' }, stage: 'ready', applications: [VIEW], canApply: true, applyRefusal: null }
const SUBMITTED = { applicationId: 'a1', state: 'awaiting_authenticator', submittedAt: '2026-10-15T09:00:00.000Z',
  expiresAt: '2026-11-14T09:00:00.000Z', facility: { id: FACILITY.facilityId, name: FACILITY.name }, profession: 'doctor', version: 1,
  replayed: false, next: 'authenticator', authenticator: { purpose: 'enroll', expiresAt: '2026-10-15T09:10:00.000Z' } }

beforeEach(() => {
  // Answers queued for one call, and left unused by a test, must not reach the next.
  vi.resetAllMocks()
  keys.count = 0
  api.availability.mockResolvedValue({ open: true })
  api.sendCode.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
  api.verifyCode.mockResolvedValue({ verified: true, expiresAt: '2026-10-15T10:00:00.000Z' })
  api.searchFacilities.mockResolvedValue([FACILITY, OTHER])
  api.submit.mockResolvedValue(SUBMITTED)
  api.authenticator.sendEmailCode.mockResolvedValue({ accepted: true, channel: 'email', expiresAt: '2026-10-15T09:10:00.000Z' })
  api.authenticator.start.mockResolvedValue(SETUP)
  api.authenticator.activate.mockResolvedValue({ ...ACCOUNT, recoveryCodes: RECOVERY_CODES })
  api.authenticator.reopen.mockResolvedValue({ purpose: 'enroll', expiresAt: '2026-10-15T09:20:00.000Z' })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function Where() {
  return <span data-testid="where">{useLocation().pathname}{useLocation().search}{useLocation().hash}</span>
}

function open() {
  render(<MemoryRouter initialEntries={['/provider/join']}><Where /><Routes>
    <Route path="/provider/join" element={<ClinicianSignUp />} />
    <Route path="/provider/join/status" element={<h1>Status page</h1>} />
  </Routes></MemoryRouter>)
}

/** The step now shown, found by its heading, which has taken focus. */
async function stepShown(name: string) {
  const heading = await screen.findByRole('heading', { name })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  return heading
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const currentStep = () => screen.getByRole('list', { name: 'Clinician sign-up steps' }).querySelector('[aria-current="step"]')?.textContent

async function toCode(email = ' Ada@Example.TEST ') {
  open()
  type(await screen.findByRole('textbox', { name: 'Work email' }), email)
  press('Complete check')
  press('Send code')
  await stepShown('Enter the 6-digit code')
}

async function toDetails() {
  await toCode()
  type(textbox('6-digit code'), '123456')
  press('Verify email')
  await stepShown('Your details')
}

async function fillDetails() {
  type(textbox('Full name as on your licence'), '  Ada   Obi ')
  fireEvent.click(screen.getByRole('radio', { name: 'Doctor (medical or dental practitioner)' }))
  type(textbox('Licence or registration number'), ' mdcn/12345')
  type(screen.getByLabelText(/^Licence valid until/), VALID_UNTIL)
  type(screen.getByRole('searchbox', { name: 'Your facility' }), 'Lagos')
  press('Search facilities')
  fireEvent.click(await screen.findByRole('radio', { name: /Lagos General Hospital/ }))
}

async function toPassword() {
  await toDetails()
  await fillDetails()
  press('Continue')
  await stepShown('Password and declarations')
}

function fillPassword(password = 'a-long-enough-password', confirm = password) {
  type(screen.getByLabelText(/^Password\*?$/), password)
  type(screen.getByLabelText(/^Confirm password\*?$/), confirm)
  fireEvent.click(screen.getByRole('checkbox', { name: /accurate, and this licence is mine/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /HID may check my licence/ }))
}

async function toAuthenticator() {
  await toPassword()
  fillPassword()
  press('Submit application')
  await stepShown('Set up your authenticator')
}

describe('clinician sign-up availability', () => {
  it('says sign-up is not open, with sign-in and the status page, and asks for nothing', async () => {
    api.availability.mockResolvedValueOnce({ open: false })
    open()
    expect(screen.getByRole('status').textContent).toBe('Checking whether clinician sign-up is open…')
    expect(await screen.findByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
    expect(screen.getByText("You can't apply as a clinician on Health ID yet. If you already have a provider account, sign in.")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Check an application' }).getAttribute('href')).toBe('/provider/join/status')
    expect(screen.queryByRole('textbox', { name: 'Work email' })).toBeNull()
    expect(screen.queryByText("We couldn't check right now.")).toBeNull()
    await waitFor(() => expect(document.title).toBe("Clinician sign-up isn't open yet · Health ID Provider"))
  })

  it('treats a 404 as not open, with no retry', async () => {
    api.availability.mockRejectedValueOnce(problem(404, 'NOT_FOUND'))
    open()
    expect(await screen.findByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('says it could not check on an outage, and checks again on Retry', async () => {
    api.availability.mockRejectedValueOnce(problem(503, 'PLATFORM_CONTROL_UNAVAILABLE'))
    open()
    expect(await screen.findByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
    expect(screen.getByText("We couldn't check right now.")).toBeTruthy()
    press('Retry')
    expect(await screen.findByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(api.availability).toHaveBeenCalledTimes(2)
  })

  it('opens at the email step when sign-up is open', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply as a doctor or nurse' })).toBeTruthy()
    expect(currentStep()).toBe('Email')
    await waitFor(() => expect(document.title).toBe('Clinician sign-up – Email · Health ID Provider'))
    expect(screen.getByText(/A facility administrator account can't also hold a clinical role at the same facility/)).toBeTruthy()
  })

  it('links to the main site on a staff product host, with no form and no request', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'ehr.healthidentitydirectory.com' })
    open()
    expect(screen.getByRole('link', { name: 'Continue on the Health ID site' }).getAttribute('href'))
      .toBe('https://www.healthidentitydirectory.com/provider/join')
    expect(screen.queryByRole('textbox', { name: 'Work email' })).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(api.availability).not.toHaveBeenCalled()
  })
})

describe('the email steps', () => {
  it('sends the address with a new security check, and says the same for every address', async () => {
    await toCode()
    expect(api.sendCode).toHaveBeenCalledWith('ada@example.test', 'clinician-application-check-0')
    expect(screen.getByText("If this address can be used, we've sent a 6-digit code to ada@example.test. It expires in 10 minutes.")).toBeTruthy()
    expect(currentStep()).toBe('Code')
    await waitFor(() => expect(document.title).toBe('Clinician sign-up – Code · Health ID Provider'))
    const code = textbox('6-digit code')
    expect(code.getAttribute('inputmode')).toBe('numeric')
    expect(code.getAttribute('autocomplete')).toBe('one-time-code')
    expect(screen.getByTestId('where').textContent).toBe('/provider/join')
  })

  it.each([
    ['TURNSTILE_REJECTED', 403, 'Complete the security check again.'],
    ['TURNSTILE_REQUIRED', 400, 'Complete the security check again.'],
    ['CLINICIAN_APPLICATION_RATE_LIMITED', 429, 'Too many sign-up attempts from your network. Try again later.'],
    ['PLATFORM_MAINTENANCE', 503, 'Health ID is under maintenance. Try again later.'],
    ['CLINICIAN_APPLICATION_REQUIRES_SIGN_OUT', 409, "You're signed in to Health ID in this browser. Sign out, then come back to apply."],
    ['CLINICIAN_APPLICATION_UNAVAILABLE', 503, "We couldn't send a code right now. Try again in a few minutes."],
  ])('says why a send was refused (%s), keeps the address and asks for a new check', async (code, status, message) => {
    api.sendCode.mockRejectedValueOnce(problem(status, code))
    open()
    type(await screen.findByRole('textbox', { name: 'Work email' }), 'ada@example.test')
    press('Complete check')
    press('Send code')
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(textbox('Work email').value).toBe('ada@example.test')
    expect(screen.queryByText(/seconds|minutes? left|countdown/i)).toBeNull()
    expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(true)
    press('Complete check')
    press('Send code')
    await waitFor(() => expect(api.sendCode).toHaveBeenLastCalledWith('ada@example.test', 'clinician-application-check-1'))
  })

  it('shows the not-open screen when the send finds sign-up closed', async () => {
    api.sendCode.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
    open()
    type(await screen.findByRole('textbox', { name: 'Work email' }), 'ada@example.test')
    press('Complete check')
    press('Send code')
    expect(await screen.findByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
  })

  it('clears and focuses a wrong code', async () => {
    api.verifyCode.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_CODE_INVALID'))
    await toCode()
    type(textbox('6-digit code'), '111111')
    press('Verify email')
    await waitFor(() => expect(document.activeElement).toBe(textbox('6-digit code')))
    expect(textbox('6-digit code').value).toBe('')
    expect(screen.getByText('That code is wrong or has expired. Check your latest email or send a new code.')).toBeTruthy()
    expect(textbox('6-digit code').getAttribute('aria-invalid')).toBe('true')
    expect(api.verifyCode).toHaveBeenCalledWith('challenge-1', 'ada@example.test', '111111')
  })

  it('offers a new code once the wait has passed, says so once, and sends it with a new check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.sendCode.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
      .mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-2', expiresInSeconds: 600, resendAfterSeconds: 60 })
    await toCode()
    expect(screen.queryByRole('button', { name: 'Send a new code' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByRole('status').textContent).toBe('You can send a new code now.')
    press('Complete check')
    press('Send a new code')
    await waitFor(() => expect(api.sendCode).toHaveBeenLastCalledWith('ada@example.test', 'clinician-application-check-1'))
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe("If this address can be used, we've sent a 6-digit code to ada@example.test. It expires in 10 minutes."))
    type(textbox('6-digit code'), '222222')
    press('Verify email')
    await waitFor(() => expect(api.verifyCode).toHaveBeenCalledWith('challenge-2', 'ada@example.test', '222222'))
  })

  it('goes back to the email step on "Use a different email"', async () => {
    await toCode()
    press('Use a different email')
    await stepShown('Your work email')
    expect(textbox('Work email').value).toBe('ada@example.test')
  })

  it('explains an address that already has an account, only after a correct code', async () => {
    api.verifyCode.mockRejectedValueOnce(problem(409, 'CLINICIAN_EMAIL_IN_USE'))
    await toCode()
    type(textbox('6-digit code'), '123456')
    press('Verify email')
    await stepShown('Use a different email address')
    expect(screen.getByRole('alert').textContent).toBe('This email address already has a Health ID account.')
    expect(screen.getByText(/Clinician accounts need their own address/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Check an application' }).getAttribute('href')).toBe('/provider/join/status')
    press('Use a different email address')
    await stepShown('Your work email')
    expect(textbox('Work email').value).toBe('')
  })
})

describe('your details', () => {
  it('derives the regulator from the profession and never asks for one', async () => {
    await toDetails()
    expect(currentStep()).toBe('Your details')
    expect(screen.queryByRole('textbox', { name: /regulator/i })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Nurse or midwife' }))
    expect(screen.getByText('Nursing and Midwifery Council of Nigeria (NMCN)')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor (medical or dental practitioner)' }))
    expect(screen.getByText('Medical and Dental Council of Nigeria (MDCN)')).toBeTruthy()
    expect(screen.getByText(/Other professions can't apply here yet/)).toBeTruthy()
  })

  it('searches for a facility from 3 letters, announces the count and offers help when it is not listed', async () => {
    await toDetails()
    const search = screen.getByRole('searchbox', { name: 'Your facility' })
    type(search, 'La')
    expect((screen.getByRole('button', { name: 'Search facilities' }) as HTMLButtonElement).disabled).toBe(true)
    type(search, '  Lagos   General ')
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(api.searchFacilities).toHaveBeenCalledWith('Lagos General'))
    expect(await screen.findByText('2 facilities found.')).toBeTruthy()
    const choices = within(screen.getByRole('group', { name: 'Choose your facility' })).getAllByRole('radio')
    expect(choices).toHaveLength(2)
    expect(screen.getByText("My facility isn't listed")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'provider enrollment' }).getAttribute('href')).toBe('/provider/enroll')
  })

  it('says when there are too many searches, with no countdown', async () => {
    api.searchFacilities.mockRejectedValueOnce(problem(429, 'CLINICIAN_APPLICATION_RATE_LIMITED'))
    await toDetails()
    type(screen.getByRole('searchbox', { name: 'Your facility' }), 'Lagos')
    press('Search facilities')
    expect((await screen.findByRole('alert')).textContent).toBe('Too many searches. Try again later.')
  })

  it('lists every missing detail, linked to its field, and marks each field', async () => {
    await toDetails()
    press('Continue')
    const summary = await screen.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(summary))
    const links = within(summary).getAllByRole('link').map(link => link.textContent)
    expect(links).toEqual(['Enter your full name as it is on your licence.', 'Choose your profession.',
      'Enter your licence or registration number.', 'Enter the date your licence is valid until.', 'Search for your facility and choose it.'])
    expect(textbox('Full name as on your licence').getAttribute('aria-invalid')).toBe('true')
    expect(textbox('Licence or registration number').getAttribute('aria-describedby')).toBe('clinician-licence-number-error')
    fireEvent.click(within(summary).getByRole('link', { name: 'Enter your licence or registration number.' }))
    expect(document.activeElement).toBe(textbox('Licence or registration number'))
    expect(screen.getByTestId('where').textContent).toBe('/provider/join')
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('refuses a licence that has expired', async () => {
    await toDetails()
    await fillDetails()
    type(screen.getByLabelText(/^Licence valid until/), '2020-01-01')
    press('Continue')
    expect(within(await screen.findByRole('alert')).getByRole('link', { name: 'Your licence must still be valid after today.' })).toBeTruthy()
  })
})

describe('the password, declarations and submit', () => {
  it('needs a password of 12 characters, typed twice, and both declarations', async () => {
    await toPassword()
    expect(currentStep()).toBe('Password')
    type(screen.getByLabelText(/^Password\*?$/), 'short')
    type(screen.getByLabelText(/^Confirm password\*?$/), 'shorter')
    press('Submit application')
    const summary = await screen.findByRole('alert')
    expect(within(summary).getAllByRole('link').map(link => link.textContent)).toEqual([
      'Choose a password of at least 12 characters.', 'Type the same password again.',
      'Confirm that the information is accurate and the licence is yours.', 'Agree to the licence, identity and employment checks.'])
    expect(screen.getByText(/HID may check my licence with Medical and Dental Council of Nigeria \(MDCN\), contact me by video call/)).toBeTruthy()
    expect(screen.getByText(/contact Lagos General Hospital to confirm that I work there/)).toBeTruthy()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('submits the application as Identity takes it, once, and clears the password', async () => {
    await toPassword()
    fillPassword()
    press('Submit application')
    await stepShown('Set up your authenticator')
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.submit).toHaveBeenCalledWith({ email: 'ada@example.test', fullName: 'Ada Obi', password: 'a-long-enough-password',
      profession: 'doctor', regulator: 'MDCN', licenceNumber: 'MDCN/12345', licenceValidUntil: VALID_UNTIL,
      facilityId: FACILITY.facilityId, declarations: { accurate: true, verificationConsent: true } }, 'submission-key-1')
    expect(document.body.innerHTML).not.toContain('a-long-enough-password')
    expect(currentStep()).toBe('Authenticator')
  })

  it('keeps everything on an outage and sends the same submission again with its key', async () => {
    api.submit.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    await toPassword()
    fillPassword()
    press('Submit application')
    expect((await screen.findByRole('alert')).textContent)
      .toBe("We couldn't submit your application right now. Your details are still here; try again.")
    // The password is typed again; the declarations and details are kept.
    expect((screen.getByLabelText(/^Password\*?$/) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('checkbox', { name: /accurate, and this licence is mine/ }) as HTMLInputElement).checked).toBe(true)
    type(screen.getByLabelText(/^Password\*?$/), 'a-long-enough-password')
    type(screen.getByLabelText(/^Confirm password\*?$/), 'a-long-enough-password')
    press('Submit application')
    await stepShown('Set up your authenticator')
    expect(api.submit.mock.calls.map(call => call[1])).toEqual(['submission-key-1', 'submission-key-1'])
  })

  it('sends another password as a new submission after a lost answer, so the first one is never kept unsaid', async () => {
    // The first submit committed but its answer was lost; Identity refuses a new key for a draft already used.
    api.submit.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    await toPassword()
    fillPassword()
    press('Submit application')
    await screen.findByRole('alert')
    type(screen.getByLabelText(/^Password\*?$/), 'another-long-password')
    type(screen.getByLabelText(/^Confirm password\*?$/), 'another-long-password')
    press('Submit application')
    await stepShown('Confirm your email again')
    expect(api.submit.mock.calls.map(call => call[1])).toEqual(['submission-key-1', 'submission-key-2'])
    expect(api.submit.mock.calls[1]![0]).toMatchObject({ password: 'another-long-password' })
  })

  it('says a replayed submission was already received, with the password entered then', async () => {
    api.submit.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ ...SUBMITTED, replayed: true })
    await toPassword()
    fillPassword()
    press('Submit application')
    await screen.findByRole('alert')
    type(screen.getByLabelText(/^Password\*?$/), 'a-long-enough-password')
    type(screen.getByLabelText(/^Confirm password\*?$/), 'a-long-enough-password')
    press('Submit application')
    await stepShown('Set up your authenticator')
    expect(api.submit.mock.calls.map(call => call[1])).toEqual(['submission-key-1', 'submission-key-1'])
    const said = screen.getByText('Your application was already received from your earlier attempt, with the password you entered then.')
    expect(said.getAttribute('role')).toBe('status')
  })

  it('says nothing of an earlier attempt when the submission is new', async () => {
    await toAuthenticator()
    expect(screen.queryByText(/already received from your earlier attempt/)).toBeNull()
  })

  it('uses a new key once the details change', async () => {
    api.submit.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    await toPassword()
    fillPassword()
    press('Submit application')
    await screen.findByRole('alert')
    press('Back')
    await stepShown('Your details')
    type(textbox('Licence or registration number'), 'MDCN/54321')
    press('Continue')
    await stepShown('Password and declarations')
    type(screen.getByLabelText(/^Password\*?$/), 'a-long-enough-password')
    type(screen.getByLabelText(/^Confirm password\*?$/), 'a-long-enough-password')
    press('Submit application')
    await stepShown('Set up your authenticator')
    expect(api.submit.mock.calls.map(call => call[1])).toEqual(['submission-key-1', 'submission-key-2'])
  })

  it('offers the status page or the email step when the email confirmation has expired, keeping the details', async () => {
    api.submit.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    await toPassword()
    fillPassword()
    press('Submit application')
    await stepShown('Confirm your email again')
    expect(screen.getByText(/Your email confirmation expired. If you already submitted, check your application status; otherwise confirm your email again. Your other details are kept on this page./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Check application status' }).getAttribute('href')).toBe('/provider/join/status')
    press('Confirm email again')
    await stepShown('Your work email')
    expect(textbox('Work email').value).toBe('ada@example.test')
    press('Complete check')
    press('Send code')
    await stepShown('Enter the 6-digit code')
    type(textbox('6-digit code'), '123456')
    press('Verify email')
    await stepShown('Your details')
    expect(textbox('Licence or registration number').value).toBe('MDCN/12345')
    expect(textbox('Full name as on your licence').value).toBe('  Ada   Obi ')
  })

  it('goes back to the facility when it cannot accept clinicians', async () => {
    api.submit.mockRejectedValueOnce(problem(409, 'CLINICIAN_APPLICATION_FACILITY_UNAVAILABLE'))
    await toPassword()
    fillPassword()
    press('Submit application')
    await stepShown('Your details')
    expect(screen.getByRole('alert').textContent)
      .toBe("This facility can't accept clinicians on Health ID right now. Choose another or ask your facility administrator.")
    expect(screen.queryByText(/Chosen:/)).toBeNull()
    expect((screen.getByRole('radio', { name: /Lagos General Hospital/ }) as HTMLInputElement).checked).toBe(false)
  })

  it.each([
    ['CLINICIAN_APPLICATION_FACILITY_BUSY', 409, 'This facility has many applications waiting. Try again in a few days or contact HID support.'],
    ['CLINICIAN_APPLICATION_RATE_LIMITED', 429, 'Too many applications were sent from your network. Try again later.'],
    ['PLATFORM_MAINTENANCE', 503, 'Health ID is under maintenance. Your details are still here; try again later.'],
    ['CLINICIAN_SIGNUP_CLOSED', 503, "New clinician applications aren't open right now. Your details are still here; try again later."],
    ['CLINICIAN_APPLICATION_REQUIRES_SIGN_OUT', 409, "You're signed in to Health ID in this browser. Sign out, then come back to apply."],
    ['PASSWORD_INVALID', 400, 'Choose a password of 12 to 256 characters.'],
  ])('says why a submit was refused (%s) and stays', async (code, status, message) => {
    api.submit.mockRejectedValueOnce(problem(status, code))
    await toPassword()
    fillPassword()
    press('Submit application')
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.getByRole('heading', { name: 'Password and declarations' })).toBeTruthy()
  })

  it('explains an address that already has an account at submit too', async () => {
    api.submit.mockRejectedValueOnce(problem(409, 'CLINICIAN_EMAIL_IN_USE'))
    await toPassword()
    fillPassword()
    press('Submit application')
    await stepShown('Use a different email address')
    expect(screen.getByRole('alert').textContent).toBe('This email address already has a Health ID account.')
  })
})

describe('the authenticator, before any review', () => {
  it('sets it up with an emailed code, a QR code and its first code, shows the recovery codes once, then says what happens next', async () => {
    await toAuthenticator()
    expect(screen.getByText(/One more step: set up an authenticator app. First we'll email another 6-digit code to ada@example.test/)).toBeTruthy()
    press('Email me a code')
    await stepShown('Enter the code we emailed you')
    type(textbox('Email code'), '654321')
    press('Continue')
    await stepShown('Add Health ID to your authenticator app')
    expect(api.authenticator.start).toHaveBeenCalledWith('654321')
    expect(screen.getByRole('img', { name: 'QR code of the setup key, for your authenticator app' })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    type(textbox('Authenticator code'), '112233')
    press('Activate authenticator')
    await stepShown('Save your recovery codes')
    expect(api.authenticator.activate).toHaveBeenCalledWith('112233')
    expect(document.body.textContent).not.toContain(SECRET.slice(0, 4) + ' ' + SECRET.slice(4, 8))
    for (const code of RECOVERY_CODES) expect(screen.getByText(code)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have stored these recovery codes somewhere safe' }))
    press('Continue to your application')
    await stepShown('Application submitted')
    expect(currentStep()).toBe('Done')
    await waitFor(() => expect(document.title).toBe('Clinician sign-up – Done · Health ID Provider'))
    for (const code of RECOVERY_CODES) expect(screen.queryByText(code)).toBeNull()
    const text = document.body.textContent ?? ''
    expect(text).toContain("Your application is in HID's verification queue.")
    expect(text).not.toMatch(/approved|verified/i)
    expect(screen.getByRole('link', { name: 'View application status' }).getAttribute('href')).toBe('/provider/join/status')
  })

  it('opens the step again when it expired', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(401, 'MFA_CHALLENGE_INVALID'))
    await toAuthenticator()
    press('Email me a code')
    await stepShown('Start the authenticator step')
    expect(screen.getByRole('alert').textContent).toBe('This step expired. Start it again.')
    press('Start again')
    await stepShown('Set up your authenticator')
    expect(api.authenticator.reopen).toHaveBeenCalledTimes(1)
  })

  it('starts by opening the step when the submit could not open one', async () => {
    api.submit.mockResolvedValueOnce({ ...SUBMITTED, authenticator: null })
    await toPassword()
    fillPassword()
    press('Submit application')
    await stepShown('Start the authenticator step')
    press('Start again')
    await stepShown('Set up your authenticator')
  })

  it('stays on the step through an outage, and never leaves the page', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(503, 'MFA_UNAVAILABLE'))
    await toAuthenticator()
    press('Email me a code')
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't complete this step right now. Try again in a few minutes.")
    expect(screen.getByRole('heading', { name: 'Set up your authenticator' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/provider/join')
  })

  it('says the authenticator cannot be used when it was set up at platform sign-in', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(403, 'STAFF_MFA_FACTOR_UNPROVEN'))
    await toAuthenticator()
    press('Email me a code')
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Your authenticator was set up at platform sign-in. Contact HID support to reset it.')
  })

  it('sends the person to the status page when the application page has closed', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    await toAuthenticator()
    press('Email me a code')
    await stepShown('This page has closed')
    expect(screen.getByText(/Your application is saved/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Check your application' }).getAttribute('href')).toBe('/provider/join/status')
  })
})

describe('nothing kept in the browser', () => {
  it('writes nothing to local or session storage and puts nothing identifying in the address', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await toAuthenticator()
    expect(setItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('where').textContent).toBe('/provider/join')
  })
})
