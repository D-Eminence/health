import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ClinicianApplicationStatus } from './ClinicianApplicationStatus'
import { focusWhenShown } from '../../__tests__/focusWhenShown'

/**
 * The clinician application status page at /provider/join/status (hid-system
 * ADR-066, P10-P15): an emailed code, then the applicant's authenticator (or
 * its setup), then the applications in fixed words, with withdraw, apply to
 * another facility and close. It never signs anyone in to the provider portal,
 * and an outage never sends the person back to the email step.
 */
const api = vi.hoisted(() => ({
  availability: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), searchFacilities: vi.fn(), submit: vi.fn(),
  authenticator: { sendEmailCode: vi.fn(), start: vi.fn(), activate: vi.fn(), verify: vi.fn(), reopen: vi.fn() },
  sendStatusCode: vi.fn(), verifyStatusCode: vi.fn(), current: vi.fn(), withdraw: vi.fn(), apply: vi.fn(), endSession: vi.fn(),
}))
const keys = vi.hoisted(() => ({ count: 0 }))
vi.mock('../clinicianApplicationApi', () => ({
  clinicianApplicationApi: api,
  newClinicianIdempotencyKey: () => `apply-key-${++keys.count}`,
  CLINICIAN_REGULATOR_OF: { doctor: 'MDCN', nurse: 'NMCN' },
}))
vi.mock('../../Turnstile', () => ({
  Turnstile: ({ action, onTokenChange, resetKey }: { action: string; onTokenChange: (token: string | null) => void; resetKey: number }) =>
    <button type="button" onClick={() => onTokenChange(`${action}-check-${resetKey}`)}>Complete check</button>,
}))

const problem = (status: number, code: string, message = code) => new HidApiError(status, message, { code })
const FACILITY = { facilityId: '7c0d5b8e-4c1a-4f0e-9a51-0d6b2f7e9a10', name: 'Lagos General Hospital', organizationName: 'Lagos General Ltd' }
const OTHER = { facilityId: '8d1e6c9f-5d2b-4a1f-8b62-1e7c3a8f0b21', name: 'Lagos Island Clinic', organizationName: 'Island Health' }
const VALID_UNTIL = `${new Date().getFullYear() + 1}-06-30`
const view = (overrides: Record<string, unknown> = {}) => ({ applicationId: 'a1', state: 'submitted', version: 2,
  facility: { id: FACILITY.facilityId, name: FACILITY.name }, profession: 'doctor',
  regulator: { code: 'MDCN', name: 'Medical and Dental Council of Nigeria' }, licenceNumberHint: '2345',
  submittedAt: '2026-10-15T09:00:00.000Z', expiresAt: '2026-11-14T09:00:00.000Z', decidedAt: null, decisionCode: null, accessState: null,
  canWithdraw: true, ...overrides })
const account = (overrides: Record<string, unknown> = {}) => ({ account: { email: 'ada@example.test', fullName: 'Ada Obi' }, stage: 'ready',
  applications: [view()], canApply: true, applyRefusal: null, ...overrides })

beforeEach(() => {
  // Answers queued for one call, and left unused by a test, must not reach the next.
  vi.resetAllMocks()
  keys.count = 0
  api.current.mockResolvedValue(account())
  api.sendStatusCode.mockResolvedValue({ accepted: true, challengeId: 'status-challenge', expiresInSeconds: 600, resendAfterSeconds: 60 })
  api.verifyStatusCode.mockResolvedValue({ next: 'authenticator_verify', expiresAt: '2026-10-15T09:30:00.000Z' })
  api.authenticator.verify.mockResolvedValue(account())
  api.authenticator.sendEmailCode.mockResolvedValue({ accepted: true, channel: 'email', expiresAt: '2026-10-15T09:10:00.000Z' })
  api.searchFacilities.mockResolvedValue([FACILITY, OTHER])
  api.apply.mockResolvedValue({ ...view({ applicationId: 'a2', facility: { id: OTHER.facilityId, name: OTHER.name } }), replayed: false })
  api.withdraw.mockResolvedValue(view({ state: 'withdrawn', version: 3, canWithdraw: false }))
  api.endSession.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// A request answered outside act, as a fetch's answer arrives, renders in one task and would run its effects in a later one.
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined })
function answer(settle: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  settle()
}

/** A request's answer, settled from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname}{location.search}{location.hash}</span>
}

function open() {
  render(<MemoryRouter initialEntries={['/provider/join/status']}><Where /><Routes>
    <Route path="/provider/join/status" element={<ClinicianApplicationStatus />} />
    <Route path="/provider/join" element={<h1>Sign-up page</h1>} />
  </Routes></MemoryRouter>)
}

async function headingFocused(name: string, level?: number) {
  const heading = await screen.findByRole('heading', { name, ...level ? { level } : {} })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  return heading
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const article = (facility: string) => screen.getByRole('article', { name: facility })

async function throughEmail() {
  api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
  open()
  type(await screen.findByRole('textbox', { name: 'Work email' }), ' Ada@Example.test')
  press('Complete check')
  press('Send code')
  await headingFocused('Enter the 6-digit code')
  type(textbox('6-digit code'), '123456')
  press('Verify email')
}

async function listShown(current = account()) {
  api.current.mockResolvedValueOnce(current)
  open()
  return screen.findByRole('heading', { level: 1, name: 'Your clinician applications' })
}

describe('opening the status page', () => {
  it('asks for the email address when no application page is open', async () => {
    api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your clinician application' })).toBeTruthy()
    expect(screen.getByText("Enter the email address you applied with. We'll send it a code. This doesn't sign you in to the provider portal.")).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
    await waitFor(() => expect(document.title).toBe('Clinician application · Health ID Provider'))
  })

  it('asks for the authenticator code when the page is open but not yet verified', async () => {
    api.current.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED'))
    open()
    expect(await screen.findByRole('heading', { name: 'Enter a code from your authenticator app' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Work email' })).toBeNull()
  })

  it('says it could not load on an outage, never asks for the email, and loads again on Retry', async () => {
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't load your application right now.")
    expect(screen.queryByRole('textbox', { name: 'Work email' })).toBeNull()
    press('Retry')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your clinician applications' })).toBeTruthy()
    expect(api.current).toHaveBeenCalledTimes(2)
  })

  it('asks for the email with nothing said about a closed page when Retry after an outage finds none open', async () => {
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
      .mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    open()
    await screen.findByRole('alert')
    press('Retry')
    expect(await screen.findByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(screen.queryByText(/this page closed after 30 minutes/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still says the page closed when one was open and a later read finds it gone', async () => {
    api.authenticator.verify.mockRejectedValueOnce(problem(409, 'CLINICIAN_APPLICATION_AUTHENTICATOR_READY'))
    await throughEmail()
    await headingFocused('Enter a code from your authenticator app')
    api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    type(textbox('Authenticator code'), '445566')
    press('Verify')
    expect(await screen.findByText('For your security, this page closed after 30 minutes. Enter your email to continue.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
  })

  it('says again that it could not load when Retry meets the outage again, and gives focus back to Retry', async () => {
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
      .mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    open()
    const first = await screen.findByRole('alert')
    press('Retry')
    await waitFor(() => expect(api.current).toHaveBeenCalledTimes(2))
    // A new alert, so the same words are announced again.
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe("We couldn't load your application right now.")
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry' })))
  })

  it('says the account cannot be used, with the email form and no Retry, when Identity refuses it (403 ..._ACCOUNT_INELIGIBLE)', async () => {
    // The page's account was disabled or is no longer active: reading again cannot help.
    api.current.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE'))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe("This account can't be used for clinician applications. Contact HID support.")
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(api.current).toHaveBeenCalledTimes(1)
  })

  it('on a product site, is the site’s own page and opens nothing else', () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.staging.healthidentitydirectory.com', replace })
    open()
    expect(replace).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Continue on the Health ID site' })).toBeNull()
  })

  it('on an admin site, which serves no staff pages, opens the EHR site’s page at once, with no request', () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hostname: 'admin.staging.healthidentitydirectory.com', replace })
    open()
    expect(replace).toHaveBeenCalledWith('https://ehr.staging.healthidentitydirectory.com/provider/join/status')
    expect(api.current).not.toHaveBeenCalled()
  })
})

describe('the email code and the authenticator', () => {
  it('sends the status code with its own security check and the same words for every address', async () => {
    await throughEmail()
    expect(api.sendStatusCode).toHaveBeenCalledWith('ada@example.test', 'clinician-application-status-check-0')
    expect(api.verifyStatusCode).toHaveBeenCalledWith('status-challenge', 'ada@example.test', '123456')
    await headingFocused('Enter a code from your authenticator app')
  })

  it('verifies a code from the authenticator, then shows the applications', async () => {
    await throughEmail()
    await headingFocused('Enter a code from your authenticator app')
    type(textbox('Authenticator code'), '445566')
    press('Verify')
    await headingFocused('Your clinician applications', 1)
    expect(api.authenticator.verify).toHaveBeenCalledWith({ code: '445566' })
    expect(screen.getByRole('article', { name: FACILITY.name })).toBeTruthy()
  })

  it('takes one recovery code instead', async () => {
    await throughEmail()
    await headingFocused('Enter a code from your authenticator app')
    press('Use a recovery code instead')
    type(textbox('Recovery code'), ' ABCDE-FGHJK ')
    press('Verify')
    await headingFocused('Your clinician applications', 1)
    expect(api.authenticator.verify).toHaveBeenCalledWith({ recoveryCode: 'ABCDE-FGHJK' })
  })

  it('opens the authenticator setup when the account has none, and lets the person see the applications first', async () => {
    api.verifyStatusCode.mockResolvedValueOnce({ next: 'authenticator_setup', expiresAt: '2026-10-15T09:30:00.000Z' })
    await throughEmail()
    await headingFocused('Set up your authenticator')
    api.current.mockResolvedValueOnce(account({ stage: 'enrolment_required', canApply: false,
      applyRefusal: 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED', applications: [view({ state: 'awaiting_authenticator' })] }))
    expect(screen.getByText(/Set up an authenticator app to send your application for review. First we'll email a 6-digit code to ada@example.test/)).toBeTruthy()
    press('See your applications first')
    await headingFocused('Your clinician applications', 1)
    expect(within(article(FACILITY.name)).getByText('Waiting for your authenticator')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply to another facility' })).toBeNull()
    expect(screen.getByText('Set up your authenticator before applying to another facility.')).toBeTruthy()
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: 'Set up authenticator' }))
    await headingFocused('Set up your authenticator')
    press('Email me a code')
    await headingFocused('Enter the code we emailed you')
  })

  it('gives focus to the email step when the person goes back to use a different email', async () => {
    api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    open()
    type(await screen.findByRole('textbox', { name: 'Work email' }), 'ada@example.test')
    press('Complete check')
    press('Send code')
    await headingFocused('Enter the 6-digit code')
    press('Use a different email')
    await headingFocused('Your work email')
    expect(textbox('Work email').value).toBe('ada@example.test')
  })

  it.each([
    ['an application HID is reviewing', [view()],
      "Your account has no authenticator app set up. HID can't go on with your applications until you set one up."],
    ['only closed applications', [view({ state: 'withdrawn', canWithdraw: false })], 'Your account has no authenticator app set up.'],
  ])('offers to set up the authenticator from the list when the account needs one and no application waits for it (%s)',
    async (_case, applications, copy) => {
      // An authenticator reset after submitting, or applications closed while they waited for one: none shows the card's button.
      await listShown(account({ stage: 'enrolment_required', canApply: false,
        applyRefusal: 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED', applications }))
      expect(screen.getByText(copy)).toBeTruthy()
      expect(screen.getByText('Set up your authenticator before applying to another facility.')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Set up authenticator' })).toHaveLength(1)
      press('Set up authenticator')
      await headingFocused('Set up your authenticator')
      press('Email me a code')
      await headingFocused('Enter the code we emailed you')
    })

  it('offers one way to set up the authenticator when an application waits for it', async () => {
    await listShown(account({ stage: 'enrolment_required', canApply: false, applyRefusal: 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED',
      applications: [view({ state: 'awaiting_authenticator' }), view({ applicationId: 'a2', facility: { id: OTHER.facilityId, name: OTHER.name } })] }))
    expect(within(article(FACILITY.name)).getByRole('button', { name: 'Set up authenticator' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Set up authenticator' })).toHaveLength(1)
    expect(screen.queryByText(/Your account has no authenticator app set up/)).toBeNull()
  })

  it.each([
    ['set up', 'authenticator_setup', 'Set up your authenticator'],
    ['verified', 'authenticator_verify', 'Enter a code from your authenticator app'],
  ] as const)('offers to close the page while the authenticator is to be %s', async (_case, next, heading) => {
    api.verifyStatusCode.mockResolvedValueOnce({ next, expiresAt: '2026-10-15T09:30:00.000Z' })
    await throughEmail()
    await headingFocused(heading)
    expect(screen.getByText(/This page stays open on this device for up to 30 minutes/)).toBeTruthy()
    press('Close this page')
    expect(await screen.findByText('This page is closed.')).toBeTruthy()
    await headingFocused('Check your clinician application', 1)
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(api.endSession).toHaveBeenCalledTimes(1)
  })

  it('keeps "This page is closed." when an authenticator answer arrives after the page was closed', async () => {
    api.verifyStatusCode.mockResolvedValueOnce({ next: 'authenticator_setup', expiresAt: '2026-10-15T09:30:00.000Z' })
    let refuse: (reason: unknown) => void = () => {}
    api.authenticator.sendEmailCode.mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject }))
    await throughEmail()
    await headingFocused('Set up your authenticator')
    press('Email me a code')
    press('Close this page')
    expect(await screen.findByText('This page is closed.')).toBeTruthy()
    await act(async () => { refuse(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID')) })
    expect(screen.getByText('This page is closed.')).toBeTruthy()
    expect(screen.queryByText(/this page closed after 30 minutes/)).toBeNull()
  })

  it('clears a wrong code and says so', async () => {
    api.verifyStatusCode.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_CODE_INVALID'))
    await throughEmail()
    await waitFor(() => expect(document.activeElement).toBe(textbox('6-digit code')))
    expect(screen.getByText('That code is wrong or has expired.')).toBeTruthy()
    expect(textbox('6-digit code').value).toBe('')
  })

  it.each([
    ['STAFF_MFA_FACTOR_UNPROVEN', 403, 'Your authenticator was set up at platform sign-in. Contact HID support to reset it.'],
    ['CLINICIAN_APPLICATION_RATE_LIMITED', 429, 'Too many attempts from your network. Try again later.'],
    ['PLATFORM_MAINTENANCE', 503, 'Health ID is under maintenance. Try again later.'],
    ['CLINICIAN_APPLICATION_UNAVAILABLE', 503, "We couldn't check the code right now. Try again."],
  ])('says why the code check was refused (%s)', async (code, status, message) => {
    api.verifyStatusCode.mockRejectedValueOnce(problem(status, code))
    await throughEmail()
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeTruthy()
  })

  // A reset authenticator of an account with an approved application or a staff membership is set up again only at staff
  // sign-in (P11, after a correct code, with no capability opened): another code here would meet the same answer.
  it('sends an account whose authenticator is set up at staff sign-in to provider sign-in, with no code step', async () => {
    api.verifyStatusCode.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED'))
    await throughEmail()
    await headingFocused("Your authenticator can't be set up here")
    expect(screen.getByRole('alert').textContent)
      .toBe('Your authenticator was reset. Sign in to the provider portal to set it up again, or contact HID support.')
    expect(screen.getByRole('link', { name: 'Sign in to the provider portal' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.queryByRole('textbox', { name: '6-digit code' })).toBeNull()
    // Another address can still be checked from here.
    press('Check another email address')
    await headingFocused('Check your clinician application', 1)
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says why a status code was not sent, with no countdown', async () => {
    api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    api.sendStatusCode.mockRejectedValueOnce(problem(429, 'CLINICIAN_APPLICATION_RATE_LIMITED'))
    open()
    type(await screen.findByRole('textbox', { name: 'Work email' }), 'ada@example.test')
    press('Complete check')
    press('Send code')
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts from your network. Try again later.')
  })
})

describe('the applications', () => {
  const approved = (accessState: string) => view({ state: 'approved', decidedAt: '2026-10-20T10:00:00.000Z', accessState, canWithdraw: false })
  const rejected = (decisionCode: string) => view({ state: 'rejected', decidedAt: '2026-10-20T10:00:00.000Z', decisionCode, canWithdraw: false })

  it.each([
    [view({ state: 'awaiting_authenticator' }), 'Waiting for your authenticator',
      "Set up your authenticator app to send this application for review. We can't review it until you do. We keep applications open for 30 days (until 14 November 2026)."],
    [view(), 'Received', "Application received. Health ID will check your licence with MDCN, call you to confirm it's you, and check with Lagos General Hospital that you work there. You can sign in once it's approved."],
    [view({ state: 'under_review' }), 'Licence checked', 'Your licence has been checked. One more check, then you can sign in.'],
    [approved('active'), 'Approved', 'Approved on 20 October 2026. You can sign in to the provider portal as a doctor at Lagos General Hospital with your password and authenticator app.'],
    [approved('lapsed'), 'Approved', 'Approved on 20 October 2026. Your access at Lagos General Hospital is paused because its licence check has expired. Contact HID support to renew it.'],
    [approved('ended'), 'Approved', 'Approved on 20 October 2026. Your access at Lagos General Hospital has ended.'],
    [approved('account_unavailable'), 'Approved', "Approved on 20 October 2026. Your account can't sign in at the moment. Contact HID support."],
    [rejected('licence_not_verified'), 'Not approved', 'We could not confirm your licence on the MDCN register.'],
    [rejected('licence_not_current'), 'Not approved', 'Your licence is not current on the MDCN register.'],
    [rejected('details_mismatch'), 'Not approved', "The licence details you gave don't match the MDCN register. Apply again with the details exactly as on your licence."],
    [rejected('employment_not_confirmed'), 'Not approved', 'Lagos General Hospital did not confirm that you work there.'],
    [rejected('facility_not_available'), 'Not approved', 'Lagos General Hospital cannot accept new clinicians on Health ID at the moment.'],
    [rejected('duplicate'), 'Not approved', 'You already have access, or another application, for this facility.'],
    [rejected('existing_account'), 'Not approved', 'This licence already belongs to another Health ID account. Sign in with that account, or contact HID support to add this facility to it.'],
    [rejected('other'), 'Not approved', 'Your application was not approved. Contact HID support for details.'],
    [view({ state: 'withdrawn', canWithdraw: false }), 'Withdrawn', 'You withdrew this application.'],
    [view({ state: 'expired', canWithdraw: false }), 'Closed', "This application closed because it wasn't decided within 30 days. You can apply again."],
  ])('says what %# means in fixed words', async (application, badge, copy) => {
    await listShown(account({ applications: [application] }))
    const shown = article(FACILITY.name)
    expect(within(shown).getByText(badge)).toBeTruthy()
    expect(within(shown).getByText(copy)).toBeTruthy()
    const reapply = within(shown).queryByText('You can apply again once the problem is fixed.')
    expect(reapply !== null).toBe(application.state === 'rejected')
    expect(within(shown).getByText('ending 2345')).toBeTruthy()
    expect(within(shown).queryByRole('button', { name: /Withdraw/ }) !== null).toBe(application.canWithdraw)
  })

  it('offers no new application after an identity refusal', async () => {
    await listShown(account({ applications: [rejected('identity_not_confirmed')], canApply: false,
      applyRefusal: 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE' }))
    const shown = article(FACILITY.name)
    expect(within(shown).getByText('We could not confirm that this licence belongs to you. Contact HID support if you think this is wrong.')).toBeTruthy()
    expect(within(shown).queryByText('You can apply again once the problem is fixed.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply to another facility' })).toBeNull()
    expect(screen.getByText("This account can't apply for a clinical role. Contact HID support.")).toBeTruthy()
  })

  it('offers sign-in only for an approved, active application', async () => {
    await listShown(account({ applications: [approved('active'), { ...approved('lapsed'), applicationId: 'a2',
      facility: { id: OTHER.facilityId, name: OTHER.name } }] }))
    expect(within(article(FACILITY.name)).getByRole('link', { name: 'Sign in to the provider portal' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(within(article(OTHER.name)).queryByRole('link', { name: 'Sign in to the provider portal' })).toBeNull()
  })

  it('withdraws in a dialog that holds and returns focus, with the version shown, then reloads', async () => {
    await listShown()
    api.current.mockResolvedValueOnce(account({ applications: [view({ state: 'withdrawn', version: 3, canWithdraw: false })] }))
    const withdraw = within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ })
    withdraw.focus()
    fireEvent.click(withdraw)
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this application?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByText('HID will stop reviewing it. You can apply again later.')).toBeTruthy()
    const keep = within(dialog).getByRole('button', { name: 'Keep application' })
    const confirm = within(dialog).getByRole('button', { name: 'Withdraw application' })
    await waitFor(() => expect(document.activeElement).toBe(keep))
    // Tab from the last control comes back to the first, and Shift+Tab from the first goes to the last.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(keep)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(withdraw)
    expect(api.withdraw).not.toHaveBeenCalled()

    fireEvent.click(withdraw)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    await waitFor(() => expect(within(article(FACILITY.name)).getByText('You withdrew this application.')).toBeTruthy())
    expect(api.withdraw).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'a1', version: 2 }))
    expect(screen.getByRole('status').textContent).toBe('You withdrew your application to Lagos General Hospital.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['VERSION_CONFLICT', 'CLINICIAN_APPLICATION_STATE_INVALID'])('reloads the list when the application changed (%s)', async code => {
    await listShown()
    api.withdraw.mockRejectedValueOnce(problem(409, code))
    api.current.mockResolvedValueOnce(account({ applications: [view({ state: 'under_review', version: 5 })] }))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    expect(await screen.findByText('This application changed; here is its current state.')).toBeTruthy()
    expect(within(article(FACILITY.name)).getByText('Licence checked')).toBeTruthy()
    expect(api.current).toHaveBeenCalledTimes(2)
  })

  it('keeps the dialog and the list through an outage', async () => {
    await listShown()
    api.withdraw.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw application' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe("We couldn't withdraw it right now. Try again.")
    expect(screen.getByRole('heading', { level: 1, name: 'Your clinician applications' })).toBeTruthy()
  })

  it('keeps focus in the dialog while a withdrawal is sent and after it is refused, so Tab and Escape still work there', async () => {
    await listShown()
    let refuse: (reason: unknown) => void = () => {}
    api.withdraw.mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject }))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Withdraw application' }) as HTMLButtonElement
    confirm.focus()
    fireEvent.click(confirm)
    expect(within(dialog).getByRole('button', { name: 'Withdrawing…' })).toBe(confirm)
    // A browser takes focus away from a button disabled while it has focus (jsdom does not): this one is only marked so.
    expect(confirm.disabled).toBe(false)
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(confirm)
    // Pressed again while it runs, it sends nothing more; Escape does not close the dialog yet.
    fireEvent.click(confirm)
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(api.withdraw).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBe(dialog)
    await act(async () => { refuse(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE')) })
    expect((await within(dialog).findByRole('alert')).textContent).toBe("We couldn't withdraw it right now. Try again.")
    expect(confirm.getAttribute('aria-disabled')).toBeNull()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Withdraw application' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for the email again, saying why, once the page has closed after 30 minutes', async () => {
    await listShown()
    api.withdraw.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    expect(await screen.findByText('For your security, this page closed after 30 minutes. Enter your email to continue.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
  })

  it.each([
    ['withdrawing', 'withdraw'],
    ['reading the list again', 'current'],
  ] as const)('leaves the list for the email form when the account can no longer be used, at %s', async (_case, call) => {
    await listShown()
    const ineligible = problem(403, 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE')
    if (call === 'withdraw') api.withdraw.mockRejectedValueOnce(ineligible)
    else {
      api.withdraw.mockRejectedValueOnce(problem(409, 'VERSION_CONFLICT'))
      api.current.mockRejectedValueOnce(ineligible)
    }
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    await headingFocused('Check your clinician application', 1)
    expect(screen.getByRole('alert').textContent).toBe("This account can't be used for clinician applications. Contact HID support.")
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
  })

  it('says again when the list still cannot be read, and gives focus back to its Retry', async () => {
    await listShown()
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
      .mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe("We couldn't load your application right now. Try again.")
    press('Retry')
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe("We couldn't load your application right now. Try again.")
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry' })))
  })

  it('says the withdrawal went through, and shows it, when the list cannot be read again just after', async () => {
    await listShown()
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't load your application right now. Try again.")
    expect(screen.getByRole('status').textContent).toBe('You withdrew your application to Lagos General Hospital.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')))
    // The card as Identity answered the withdrawal, not the open application it was.
    const shown = article(FACILITY.name)
    expect(within(shown).getByText('Withdrawn')).toBeTruthy()
    expect(within(shown).getByText('You withdrew this application.')).toBeTruthy()
    expect(within(shown).queryByRole('button', { name: /Withdraw/ })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says when the page could not be closed, offers no Retry that would only reload, and closes on the next press', async () => {
    await listShown()
    api.endSession.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    press('Close this page')
    expect((await screen.findByRole('alert')).textContent).toBe("This page couldn't be closed right now. Try again.")
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close this page' })))
    press('Close this page')
    expect(await screen.findByText('This page is closed.')).toBeTruthy()
    expect(api.endSession).toHaveBeenCalledTimes(2)
    expect(api.current).toHaveBeenCalledTimes(1)
  })

  it('closes the page on request and asks for the email again', async () => {
    await listShown()
    press('Close this page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your clinician application' })).toBeTruthy()
    expect(api.endSession).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This page is closed.')).toBeTruthy()
  })

  // Focus moves in the commit that shows where it goes: from an effect a task later, a check made as soon as that was
  // shown found focus still where it was (health#16's CI, on another page).
  it('gives focus back to Withdraw as soon as the withdrawal closes the dialog', async () => {
    await listShown()
    const withdrawn = deferred<unknown>()
    api.withdraw.mockReturnValueOnce(withdrawn.promise)
    // The list read again after it: not answered here.
    api.current.mockReturnValueOnce(new Promise(() => {}))
    const opener = within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    const shown = focusWhenShown(() => screen.queryByRole('dialog') ? null : opener)
    answer(() => withdrawn.resolve(view({ state: 'withdrawn', version: 3, canWithdraw: false })))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on what the page says as soon as the list read again says the withdrawal', async () => {
    await listShown()
    const reread = deferred<unknown>()
    api.current.mockReturnValueOnce(reread.promise)
    fireEvent.click(within(article(FACILITY.name)).getByRole('button', { name: /Withdraw/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw application' }))
    await waitFor(() => expect(api.current).toHaveBeenCalledTimes(2))
    const shown = focusWhenShown(() => screen.queryByText('You withdrew your application to Lagos General Hospital.')?.closest('[role="status"]'))
    answer(() => reread.resolve(account({ applications: [view({ state: 'withdrawn', version: 3, canWithdraw: false })] })))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('gives focus back to “Close this page” as soon as it says the page could not be closed', async () => {
    await listShown()
    const ended = deferred<undefined>()
    api.endSession.mockReturnValueOnce(ended.promise)
    // Not focused first: a browser takes focus from a button disabled while its request runs (jsdom does not).
    const close = screen.getByRole('button', { name: 'Close this page' })
    fireEvent.click(close)
    const shown = focusWhenShown(() => screen.queryByText("This page couldn't be closed right now. Try again."))
    answer(() => ended.reject(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE')))
    const { focused } = await shown
    expect(focused).toBe(close)
  })
})

describe('applying to another facility', () => {
  async function applyForm() {
    await listShown()
    press('Apply to another facility')
    await headingFocused('Apply to another facility')
    fireEvent.click(screen.getByRole('radio', { name: 'Nurse or midwife' }))
    type(textbox('Licence or registration number'), 'nmcn 778899')
    type(screen.getByLabelText(/^Licence valid until/), VALID_UNTIL)
    type(screen.getByRole('searchbox', { name: 'Your facility' }), 'Island')
    press('Search facilities')
    fireEvent.click(await screen.findByRole('radio', { name: /Lagos Island Clinic/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /accurate, and this licence is mine/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /HID may check my licence with Nursing and Midwifery Council of Nigeria \(NMCN\)/ }))
  }

  it('sends the licence and facility with a key, then shows the new application', async () => {
    await applyForm()
    expect(screen.queryByRole('textbox', { name: /Full name/ })).toBeNull()
    api.current.mockResolvedValueOnce(account({ applications: [view({ applicationId: 'a2', facility: { id: OTHER.facilityId, name: OTHER.name } }), view()] }))
    press('Send application')
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe("Your application to Lagos Island Clinic was sent. It is in HID's verification queue."))
    expect(api.apply).toHaveBeenCalledWith({ profession: 'nurse', regulator: 'NMCN', licenceNumber: 'NMCN 778899', licenceValidUntil: VALID_UNTIL,
      facilityId: OTHER.facilityId, declarations: { accurate: true, verificationConsent: true } }, 'apply-key-1')
    expect(screen.getByRole('article', { name: OTHER.name })).toBeTruthy()
  })

  it('says the application was sent, and shows it, when the list cannot be read again just after', async () => {
    await applyForm()
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    press('Send application')
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't load your application right now. Try again.")
    expect(screen.getByRole('status').textContent).toBe("Your application to Lagos Island Clinic was sent. It is in HID's verification queue.")
    expect(within(article(OTHER.name)).getByText('Received')).toBeTruthy()
    expect(article(FACILITY.name)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Apply to another facility' })).toBeNull()
  })

  it.each([
    ['CLINICIAN_APPLICATION_ROLE_CONFLICT', 409, "A facility administrator account can't hold a clinical role at its own facility. Sign up again with a different email address for your clinician account."],
    ['CLINICIAN_APPLICATION_MEMBERSHIP_EXISTS', 409, 'You already work at this facility on Health ID.'],
    ['CLINICIAN_APPLICATION_ALREADY_OPEN', 409, 'You already have an open application for this facility.'],
    ['CLINICIAN_APPLICATION_LIMIT_REACHED', 409, 'You have too many applications open. Wait for a decision or withdraw one.'],
    ['CLINICIAN_APPLICATION_FACILITY_BUSY', 409, 'This facility has many applications waiting. Try again in a few days or contact HID support.'],
    ['CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE', 403, "This account can't apply for a clinical role. Contact HID support."],
    // A quota of the network or of Health ID, or (since hid-system 9e981e4) the platform's daily cap met as the application is created.
    ['CLINICIAN_APPLICATION_RATE_LIMITED', 429, 'Too many applications have been sent, from your network or to Health ID today. '
      + 'Your details are still here; try again later.'],
    ['CLINICIAN_APPLICATION_UNAVAILABLE', 503, "We couldn't send your application right now. Your details are still here; try again."],
  ])('says why another application was refused (%s), keeping the details', async (code, status, message) => {
    await applyForm()
    api.apply.mockRejectedValueOnce(problem(status, code))
    press('Send application')
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(textbox('Licence or registration number').value).toBe('NMCN 778899')
  })

  // Since hid-system 9e981e4 (354917c) a closed intake is answered before the capability, whatever cookie is sent, so it
  // no longer shows that this page is still open: the page reads the applications again, which says both.
  it.each([['sending', 'Send application'], ['searching', 'Search facilities']] as const)(
    'closes the form and reads the applications again when intake has closed (%s)', async (_case, button) => {
      await applyForm()
      if (button === 'Send application') api.apply.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
      else api.searchFacilities.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
      api.current.mockResolvedValueOnce(account({ canApply: false, applyRefusal: 'CLINICIAN_SIGNUP_CLOSED' }))
      press(button)
      const notice = await screen.findByText("New clinician applications aren't open right now, so no application was sent.")
      await waitFor(() => expect(document.activeElement).toBe(notice.closest('p')))
      expect(api.current).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('heading', { name: 'Apply to another facility' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Apply to another facility' })).toBeNull()
      expect(screen.getByText("New clinician applications aren't open right now.")).toBeTruthy()
      expect(api.apply).toHaveBeenCalledTimes(button === 'Send application' ? 1 : 0)
    })

  it.each([['sending', 'Send application'], ['searching', 'Search facilities']] as const)(
    'offers no Close while the applications are read again after intake closed (%s)', async (_case, button) => {
      await applyForm()
      if (button === 'Send application') api.apply.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
      else api.searchFacilities.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
      let answer: (value: unknown) => void = () => {}
      api.current.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
      press(button)
      await waitFor(() => expect(api.current).toHaveBeenCalledTimes(2))
      // Every answer but the read's has been drawn: the refused request's own end included.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      const close = screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement
      expect(close.disabled).toBe(true)
      fireEvent.click(close)
      expect(api.endSession).not.toHaveBeenCalled()
      await act(async () => { answer(account({ canApply: false, applyRefusal: 'CLINICIAN_SIGNUP_CLOSED' })) })
      await waitFor(() => expect((screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement).disabled).toBe(false))
    })

  it('asks for the email again when intake has closed and this page has closed too', async () => {
    await applyForm()
    api.apply.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
    api.current.mockRejectedValueOnce(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    press('Send application')
    await headingFocused('Check your clinician application', 1)
    expect(screen.getByRole('alert').textContent).toBe('For your security, this page closed after 30 minutes. Enter your email to continue.')
  })

  it('says intake has closed, and keeps the list, when the applications cannot be read again', async () => {
    await applyForm()
    api.apply.mockRejectedValueOnce(problem(503, 'CLINICIAN_SIGNUP_CLOSED'))
    api.current.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    press('Send application')
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't load your application right now. Try again.")
    expect(screen.getByRole('status').textContent).toBe("New clinician applications aren't open right now, so no application was sent.")
    expect(screen.queryByRole('heading', { name: 'Apply to another facility' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply to another facility' })).toBeNull()
    expect(article(FACILITY.name)).toBeTruthy()
  })

  it.each([
    ['CLINICIAN_APPLICATION_UNAVAILABLE', 503, () => screen.getByRole('button', { name: 'Send application' })],
    ['CLINICIAN_APPLICATION_LIMIT_REACHED', 409, () => screen.getByRole('button', { name: 'Send application' })],
    ['IDEMPOTENCY_CONFLICT', 409, () => screen.getByRole('button', { name: 'Send application' })],
    ['CLINICIAN_APPLICATION_FACILITY_UNAVAILABLE', 409, () => screen.getByRole('searchbox', { name: 'Your facility' })],
    ['CLINICIAN_APPLICATION_INVALID', 400, () => textbox('Licence or registration number')],
  ])('puts focus where a refusal that keeps the form can be dealt with (%s)', async (code, status, target) => {
    await applyForm()
    api.apply.mockRejectedValueOnce(problem(status, code))
    press('Send application')
    await screen.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(target()))
  })

  // Since hid-system 7cd8038 a ready capability's 30 searches, once spent, are answered 429
  // CLINICIAN_APPLICATION_SEARCH_LIMITED with no Retry-After: only a new capability (the email code again) searches again.
  it('says the searches for this page are used up and how to search again, and keeps the form and Close', async () => {
    await applyForm()
    api.searchFacilities.mockRejectedValueOnce(problem(429, 'CLINICIAN_APPLICATION_SEARCH_LIMITED',
      'Too many searches in this session. Verify your email address again to continue.'))
    type(screen.getByRole('searchbox', { name: 'Your facility' }), 'General')
    press('Search facilities')
    expect((await screen.findByRole('alert')).textContent).toBe("You've used all the facility searches for this page. To search "
      + "again, close this page, then enter your email for a new code; what you've typed here isn't kept.")
    expect((screen.getByRole('button', { name: 'Search facilities' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('heading', { name: 'Apply to another facility' })).toBeTruthy()
    expect(textbox('Licence or registration number').value).toBe('NMCN 778899')
    expect(api.current).toHaveBeenCalledTimes(1)
    // Close waits for the search's answer, which the page learns of once the form has drawn it.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement).disabled).toBe(false))
    press('Close this page')
    await headingFocused('Check your clinician application', 1)
    expect(api.endSession).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This page is closed.')).toBeTruthy()
  })

  it('still sends a facility chosen before the searches were used up', async () => {
    await applyForm()
    api.searchFacilities.mockRejectedValueOnce(problem(429, 'CLINICIAN_APPLICATION_SEARCH_LIMITED'))
    type(screen.getByRole('searchbox', { name: 'Your facility' }), 'General')
    press('Search facilities')
    await screen.findByRole('alert')
    press('Send application')
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({ facilityId: OTHER.facilityId }), 'apply-key-1'))
  })

  it('gives focus back to "Apply to another facility" when the form is cancelled', async () => {
    await listShown()
    press('Apply to another facility')
    await headingFocused('Apply to another facility')
    press('Cancel')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply to another facility' })))
  })

  it('offers no Close while the application is being sent, so its answer never reaches a closed page', async () => {
    await applyForm()
    let answer: (value: unknown) => void = () => {}
    api.apply.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    press('Send application')
    const close = screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    fireEvent.click(close)
    expect(api.endSession).not.toHaveBeenCalled()
    await act(async () => { answer({ ...view({ applicationId: 'a2', facility: { id: OTHER.facilityId, name: OTHER.name } }), replayed: false }) })
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe("Your application to Lagos Island Clinic was sent. It is in HID's verification queue."))
    expect((screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers no Close while a facility search runs', async () => {
    await listShown()
    press('Apply to another facility')
    await headingFocused('Apply to another facility')
    let answer: (value: unknown) => void = () => {}
    api.searchFacilities.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    type(screen.getByRole('searchbox', { name: 'Your facility' }), 'Island')
    press('Search facilities')
    const close = screen.getByRole('button', { name: 'Close this page' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    fireEvent.click(close)
    expect(api.endSession).not.toHaveBeenCalled()
    await act(async () => { answer([OTHER]) })
    expect(await screen.findByText('1 facility found.')).toBeTruthy()
    expect(close.disabled).toBe(false)
  })

  it('sends the same key again after an outage', async () => {
    await applyForm()
    api.apply.mockRejectedValueOnce(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE'))
    press('Send application')
    await screen.findByRole('alert')
    press('Send application')
    await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(2))
    expect(api.apply.mock.calls.map(call => call[1])).toEqual(['apply-key-1', 'apply-key-1'])
  })

  it('gives focus back to “Send application” as soon as it says the application was not sent', async () => {
    await applyForm()
    const sent = deferred<never>()
    api.apply.mockReturnValueOnce(sent.promise)
    // Not focused first: a browser takes focus from a button disabled while its request runs (jsdom does not).
    const send = screen.getByRole('button', { name: 'Send application' })
    fireEvent.click(send)
    const shown = focusWhenShown(() => screen.queryByText(/^We couldn't send your application right now\./))
    answer(() => sent.reject(problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE')))
    const { focused } = await shown
    expect(focused).toBe(send)
  })
})

describe('nothing kept in the browser', () => {
  it('writes nothing to local or session storage and puts nothing identifying in the address', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await throughEmail()
    await headingFocused('Enter a code from your authenticator app')
    type(textbox('Authenticator code'), '445566')
    press('Verify')
    await headingFocused('Your clinician applications', 1)
    expect(setItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('where').textContent).toBe('/provider/join/status')
  })
})
