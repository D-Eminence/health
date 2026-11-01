import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ORGANIZATION_TYPE_NOTES } from '../../../staff/routes/ProviderEnrollment'
import { focusWhenShown } from '../../focusWhenShown'
import { security } from './signupFakes'
import {
  actAgain, answer, button, choosePassword, deferred, EMAIL, expectFocusOnStep, NAME, open, step, submitRegistration, SUPPORT,
  TabChannel, textbox, toCode, TOLD, toPassword, toReview, verifyWith,
} from './signupHarness'

/**
 * After the blue registration is submitted: Registration submitted (design 08), the email code (09) with today's
 * "Didn't get the code?", today's password step after the code with the CAC record's name and "This isn't my
 * organization", today's panels, and today's ending. Every person, facility and address here is fictional.
 */
const api = vi.hoisted(() => ({ availability: vi.fn(), start: vi.fn(), verify: vi.fn(), profile: vi.fn(), activate: vi.fn(),
  withdraw: vi.fn() }))
vi.mock('../../../staff/api', () => ({ providerEnrollmentApi: api, staffApi: {} }))
const clinician = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: clinician }))
vi.mock('../../../staff/env', async () => {
  const { ENVIRONMENT } = await import('./signupFakes')
  return { getEnvironment: () => ENVIRONMENT }
})
vi.mock('../../../Turnstile', async () => ({ Turnstile: (await import('./signupFakes')).FakeTurnstile }))

const SESSION = { activated: true, organizationId: 'o-1', facilityId: 'f-1', accountId: 'a-1', expiresAt: '2026-10-30T20:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  vi.stubGlobal('BroadcastChannel', TabChannel)
  TabChannel.posted = []
  security.auto = true
  api.availability.mockResolvedValue({ open: true })
  api.start.mockResolvedValue({ accepted: true, codeSent: true, challengeId: 'challenge-1', expiresInSeconds: 600,
    resendAfterSeconds: 60 })
  api.verify.mockResolvedValue({ verified: true })
  // An Identity without …/profile: the password step then shows the CAC number alone.
  api.profile.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
  api.activate.mockResolvedValue(SESSION)
  api.withdraw.mockResolvedValue({ withdrawn: true })
  clinician.availability.mockResolvedValue({ open: false })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); actAgain() })

const code = () => textbox('Code from the email')
const hint = () => document.querySelector('.hid-ehr-signup-lede')?.textContent

describe('Registration submitted, then the email code', () => {
  it('goes from Registration submitted to the code, its heading focused, with today’s hint', async () => {
    await toCode()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Enter the code we emailed you' }))
    expect(hint()).toBe(`Enter the six digit code sent to ${EMAIL}.`)
    expect(code().getAttribute('autocomplete')).toBe('one-time-code')
    expect(code().getAttribute('inputmode')).toBe('numeric')
  })

  it('takes digits only, six at most, and verifies today’s challenge with them', async () => {
    await toCode()
    expect(button('Check code').disabled).toBe(true)
    fireEvent.change(code(), { target: { value: '12a 34-56789' } })
    expect(code().value).toBe('123456')
    expect(button('Check code').disabled).toBe(false)
    fireEvent.click(button('Check code'))
    await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
    expect(api.verify).toHaveBeenCalledWith('challenge-1', '123456')
    expect(api.profile).toHaveBeenCalledTimes(1)
  })

  it('says a wrong or expired code isn’t right, and stays on the code', async () => {
    api.verify.mockRejectedValueOnce(new HidApiError(401, 'Invalid', { code: 'ORGANIZATION_COMPLETION_CODE_INVALID' }))
    await toCode()
    await verifyWith('654321')
    expect((await screen.findByRole('alert')).textContent).toBe('That code is wrong or too old. Check the latest email '
      + 'from Health ID and try again, or send a new code.')
    expect(screen.getByRole('heading', { level: 1, name: 'Enter the code we emailed you' })).toBeTruthy()
  })

  it.each([
    [503, 'UPSTREAM_UNAVAILABLE', 'Facility sign-up isn’t working right now. Please try again in a few minutes.'],
    [0, 'NETWORK_ERROR', 'We couldn’t reach Health ID. Check your internet connection and try again.'],
  ])('a verify refused with %s %s says so in today’s words', async (status, reason, words) => {
    api.verify.mockRejectedValueOnce(new HidApiError(status, 'Gateway words', { code: reason }))
    await toCode()
    await verifyWith()
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(api.availability).toHaveBeenCalledTimes(2)
  })

  it('says when Identity sent no new code because one went out less than a minute ago', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 500,
      resendAfterSeconds: 40 })
    await toCode()
    expect(hint()).toBe(`We didn’t send a new code, because one was sent to ${EMAIL} less than a minute ago. Enter the six digit `
      + 'code from that email.')
  })

  it('says when Identity has sent as many codes as it can for now', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 500,
      resendAfterSeconds: 3600 })
    await toCode()
    expect(hint()).toBe('We didn’t send a new code, because we’ve sent as many as we can for now. Enter the six digit code from '
      + `the latest email Health ID sent to ${EMAIL}.`)
    expect(screen.getByText('We’ve sent as many codes as we can for now. Use the code in the latest email from Health ID, or ask '
      + 'for a new one in 60 minutes.')).toBeTruthy()
    expect(button('Resend code').disabled).toBe(true)
  })
})

describe('Didn’t get the code?', () => {
  it('waits as Identity says before another code, then resends today’s start with a fresh security check', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toCode()
    const resend = within(screen.getByRole('region', { name: 'Didn’t get the code?' }))
    expect(resend.getByText('Check your spam or junk folder first. A new code replaces the last one.')).toBeTruthy()
    expect(resend.getByRole('button', { name: 'Complete the security check' }).getAttribute('data-turnstile-action'))
      .toBe('provider-enrollment')
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-2', resendAfterSeconds: 60 })
    fireEvent.change(code(), { target: { value: '12' } })
    fireEvent.click(button('Resend code'))
    expect((await screen.findByText(`We’ve sent a new code to ${EMAIL}.`)).closest('[role="status"]')).toBeTruthy()
    expect(api.start).toHaveBeenCalledTimes(2)
    expect(api.start).toHaveBeenLastCalledWith({ productCode: 'ehr', organizationType: 'hospital',
      cacRegistrationNumber: 'RC123456', administratorName: NAME, administratorEmail: EMAIL, turnstileToken: 'token-1' })
    expect(code().value).toBe('')
    expect(screen.getByText(/^You can ask for a new code in (60|59) seconds\.$/)).toBeTruthy()
    expect(button('Resend code').disabled).toBe(true)
    // The new code is the one verified.
    await verifyWith()
    await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
    expect(api.verify).toHaveBeenLastCalledWith('challenge-2', '123456')
  })

  it('says when no new code was sent and the last one still works', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toCode()
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', resendAfterSeconds: 30 })
    fireEvent.click(button('Resend code'))
    expect(await screen.findByText('We didn’t send a new code: the code in the latest email from Health ID still works.')).toBeTruthy()
  })

  it('sends no new code without the security check', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toCode()
    security.auto = false
    // Back and forth, so the check is asked again and this time not answered.
    fireEvent.click(button('Use a different email'))
    await step('Your account')
    for (let index = 0; index < 4; index++) fireEvent.click(button('Continue'))
    await step('Agreements')
    fireEvent.click(button('Complete the security check'))
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 1, name: 'Enter the code we emailed you' })
    expect(button('Resend code').disabled).toBe(true)
    fireEvent.click(button('Resend code'))
    expect(api.start).toHaveBeenCalledTimes(2)
  })

  it.each([
    [429, 'APPLICATION_RATE_LIMITED', 'Too many sign-up tries from your internet connection. Please try again later.', 1],
    [409, 'CAC_NOT_VERIFIED', 'We couldn’t check this CAC number. Check the number on your CAC certificate (it '
      + 'starts with RC, BN or IT) and try again.', 1],
    [503, 'UPSTREAM_UNAVAILABLE', 'We couldn’t finish checking your details just now. Please try again in a minute. If an email '
      + 'with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.', 2],
  ])('keeps the code step when a new code is refused (%s %s), in today’s words', async (status, reason, words, asked) => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toCode()
    api.start.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own words', { code: reason }))
    fireEvent.click(button('Resend code'))
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(screen.getByRole('heading', { level: 1, name: 'Enter the code we emailed you' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Sign-up progress' })).toBeNull()
    expect(api.availability).toHaveBeenCalledTimes(asked)
    if (asked === 2) {
      // An outage may have sent a code: a new one waits a minute.
      expect(screen.getByText(/^You can ask for a new code in (60|59) seconds\.$/)).toBeTruthy()
      expect(button('Resend code').disabled).toBe(true)
    }
  })

  it('“Use a different email” goes back to Your account with every detail kept, its heading focused', async () => {
    await toCode()
    fireEvent.click(button('Use a different email'))
    const heading = await step('Your account')
    expect(document.activeElement).toBe(heading)
    expect(textbox('Full name').value.trim()).toBe(NAME)
    expect(textbox('Email').value.trim().toLowerCase()).toBe(EMAIL)
  })
})

describe('Create your provider account (today’s password step, after the code)', () => {
  it('shows the CAC number to check when Identity has no profile, and today’s hint', async () => {
    await toPassword()
    expect(document.getElementById('hid-ehr-signup-registering')?.textContent).toBe('You’re registering the organization with '
      + 'CAC number RC123456. Check that this is your organization’s number before you create the account.')
    expect(document.getElementById('hid-ehr-signup-account-hint')?.textContent).toBe(`You’ll sign in with ${EMAIL} and this `
      + 'password. Then you go straight into the Provider Portal as your facility’s administrator.')
    expect(document.getElementById('hid-ehr-signup-password-hint')?.textContent).toContain('At least 12 characters (not yet)')
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toContain('hid-ehr-signup-account-hint')
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toContain('hid-ehr-signup-password-hint')
    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement
    expect(username.value).toBe(EMAIL)
    expect(username.hidden).toBe(true)
  })

  it('names the CAC record’s legal name, type and administrator when Identity has them', async () => {
    api.profile.mockResolvedValueOnce({ organizationName: 'Demo Hospital Limited', registrationNumber: 'RC123456',
      productCode: 'ehr', organizationType: 'hospital', administratorName: NAME, administratorEmail: EMAIL })
    await toPassword()
    expect(document.getElementById('hid-ehr-signup-registering')?.textContent).toBe('You’re registering Demo Hospital Limited, '
      + `CAC number RC123456, as a hospital, with ${NAME} as its administrator. Check that this is your organization before `
      + 'you create the account.')
    expect(screen.getByText('Demo Hospital Limited').tagName).toBe('STRONG')
  })

  it('goes back to Your account, kept, when the sign-up session has gone before the name is read (401)', async () => {
    api.profile.mockRejectedValueOnce(new HidApiError(401, 'Expired', { code: 'ORGANIZATION_COMPLETION_SESSION_INVALID' }))
    await toCode()
    await verifyWith()
    await expectFocusOnStep('Your account')
    expect((await screen.findByRole('alert')).textContent).toBe('Your sign-up timed out. Check your details and select '
      + 'Continue to get a new code.')
    expect(screen.queryByRole('heading', { level: 1, name: 'Create your provider account' })).toBeNull()
    expect(textbox('Email').value.trim().toLowerCase()).toBe(EMAIL)
  })

  it('shows the closed panel when sign-up closed before the name is read (423)', async () => {
    api.profile.mockRejectedValueOnce(new HidApiError(423, 'Closed', { code: 'PROVIDER_ENROLLMENT_UNAVAILABLE' }))
    await toCode()
    await verifyWith()
    expect(await screen.findByRole('heading', { level: 1, name: 'Facility sign-up isn’t open right now' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: 'Create your provider account' })).toBeNull()
  })

  it('says to sign out first when reading the name finds this browser signed in, and stays at the password', async () => {
    api.profile.mockRejectedValueOnce(new HidApiError(409, 'Sign out', { code: 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    await toPassword()
    expect(screen.getByRole('alert').textContent).toBe('Someone is signed in to Health ID on this device, for example to a patient account. '
      + 'Sign out first, or open this page in a private (incognito) window, then try again.')
  })

  it('offers to try the name again when reading it failed', async () => {
    api.profile.mockRejectedValueOnce(new HidApiError(503, 'Down', { code: 'UPSTREAM_UNAVAILABLE' }))
    await toPassword()
    expect(screen.getByText(/^We couldn’t load your organization’s registered name just now\./)).toBeTruthy()
    api.profile.mockResolvedValueOnce({ organizationName: 'Demo Hospital Limited', registrationNumber: 'RC123456',
      productCode: 'ehr', organizationType: 'hospital', administratorName: NAME, administratorEmail: EMAIL })
    fireEvent.click(button('Try again'))
    expect(await screen.findByText('Demo Hospital Limited')).toBeTruthy()
  })

  it('needs at least 12 characters, matching the confirmation, and sends the password alone', async () => {
    await toPassword()
    const password = screen.getByLabelText('Password') as HTMLInputElement
    expect(password.minLength).toBe(12)
    expect(password.maxLength).toBe(256)
    expect(password.getAttribute('autocomplete')).toBe('new-password')
    fireEvent.change(password, { target: { value: 'too-short' } })
    expect(button('Create provider account').disabled).toBe(true)
    choosePassword('a-long-enough-password', 'a-different-password')
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect(api.activate).not.toHaveBeenCalled()
    choosePassword()
    await screen.findByRole('heading', { level: 1, name: 'Your facility is set up' })
    expect(api.activate).toHaveBeenCalledTimes(1)
    expect(api.activate).toHaveBeenCalledWith('a-long-enough-password')
  })

  it('shows the password on request, and masks it again when the form is sent', async () => {
    api.activate.mockReturnValueOnce(new Promise(() => {}))
    await toPassword()
    const password = screen.getByLabelText('Password') as HTMLInputElement
    // Each eye has its own name and names the field it shows.
    const toggle = button('Show password')
    expect(toggle.getAttribute('aria-controls')).toBe(password.id)
    expect(button('Show password confirmation').getAttribute('aria-controls'))
      .toBe((screen.getByLabelText('Confirm password') as HTMLInputElement).id)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(password.type).toBe('text')
    choosePassword()
    await waitFor(() => expect(password.type).toBe('password'))
  })

  it('“This isn’t my organization” closes the sign-up and returns to CAC number, nothing created', async () => {
    await toPassword()
    fireEvent.click(button('This isn’t my organization'))
    const heading = await step('CAC number')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(api.withdraw).toHaveBeenCalledTimes(1)
    expect(api.activate).not.toHaveBeenCalled()
    expect((await screen.findByRole('alert')).textContent).toBe('Check your details, and the CAC number on your CAC '
      + 'certificate. Correct them, then select Continue. No account has been created. We’ve closed that sign-up, so the CAC '
      + 'number you entered is free again.')
    expect(textbox('CAC number').value).toBe('RC123456')
  })

  it.each([
    [404, 'NOT_FOUND', ''],
    [503, 'UPSTREAM_UNAVAILABLE', 'We couldn’t close that sign-up just now. '],
  ])('when the sign-up can’t be closed (%s), says the number is held for up to 24 hours', async (status, reason, lead) => {
    api.withdraw.mockRejectedValueOnce(new HidApiError(status, 'Words', { code: reason }))
    await toPassword()
    fireEvent.click(button('This isn’t my organization'))
    await step('CAC number')
    expect((await screen.findByRole('alert')).textContent).toBe(`${lead}Check your details, and the CAC number on `
      + 'your CAC certificate. Correct them, then select Continue. No account has been created. For up to 24 hours, nobody '
      + `else can sign up with the CAC number you entered. If it belongs to another company, tell Health ID support at ${SUPPORT}, `
      + 'and give that number, so they can free it.')
  })

  it('shows the closed panel when sign-up closed before the sign-up could be withdrawn (423)', async () => {
    api.withdraw.mockRejectedValueOnce(new HidApiError(423, 'Closed', { code: 'PROVIDER_ENROLLMENT_UNAVAILABLE' }))
    await toPassword()
    fireEvent.click(button('This isn’t my organization'))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Facility sign-up isn’t open right now' })
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Sign-up progress' })).toBeNull()
  })

  it('stays at the password when this browser is signed in to Health ID', async () => {
    api.withdraw.mockRejectedValueOnce(new HidApiError(409, 'Sign out', { code: 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    await toPassword()
    fireEvent.click(button('This isn’t my organization'))
    expect((await screen.findByRole('alert')).textContent).toBe('Someone is signed in to Health ID on this device, for example to a patient '
      + 'account. Sign out first, or open this page in a private (incognito) window, then try again.')
    expect(screen.getByRole('heading', { level: 1, name: 'Create your provider account' })).toBeTruthy()
  })
})

describe('the ending, and the panels in place of a step', () => {
  it('signs the administrator in, tells the other tabs, says where to sign in next time, then opens the workspace', async () => {
    const reload = vi.fn()
    const kept = vi.spyOn(Storage.prototype, 'setItem')
    await toPassword()
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com', reload })
    const shown = focusWhenShown(() => screen.queryByRole('heading', { level: 1, name: 'Your facility is set up' }))
    const activated = deferred<unknown>()
    api.activate.mockReturnValueOnce(activated.promise)
    choosePassword()
    answer(() => activated.resolve(SESSION))
    const { element, focused } = await shown
    expect(focused).toBe(element)
    actAgain()
    expect(screen.getByText('You’re signed in as your facility’s administrator.')).toBeTruthy()
    expect(screen.getByText(`Next time, sign in at ehr.healthidentitydirectory.com with ${EMAIL} and the password you just chose.`))
      .toBeTruthy()
    expect(screen.getByText(ORGANIZATION_TYPE_NOTES.hospital)).toBeTruthy()
    expect(TabChannel.posted).toEqual([TOLD])
    expect(reload).not.toHaveBeenCalled()
    // The whole sign-up lived in the page's memory: nothing in browser storage, no cookie written by the page.
    expect(kept).not.toHaveBeenCalled()
    expect(document.cookie).toBe('')
    fireEvent.click(button('Continue to the Provider Portal'))
    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('outside production says to sign in to the Provider Portal next time, with the laboratory’s note', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'localhost', reload: vi.fn() })
    await toReview({ type: 'laboratory' })
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 1, name: 'Enter the code we emailed you' })
    await verifyWith()
    await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
    choosePassword()
    await screen.findByRole('heading', { level: 1, name: 'Your facility is set up' })
    expect(screen.getByText(`Next time, sign in to the Provider Portal with ${EMAIL} and the password you just chose.`)).toBeTruthy()
    expect(screen.getByText(ORGANIZATION_TYPE_NOTES.laboratory)).toBeTruthy()
  })

  it('offers a new start with another email when the email already has an account (the email emptied)', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(409, 'Registered', { code: 'PROVIDER_EMAIL_ALREADY_REGISTERED' }))
    await toPassword()
    choosePassword()
    const heading = await screen.findByRole('heading', { level: 1, name: 'This email already has a Health ID account' })
    expect(document.activeElement).toBe(heading)
    expect(heading.nextElementSibling?.textContent).toBe('The administrator email already belongs to a Health ID account, for '
      + 'example a patient account or a staff account, so it can’t also be this facility’s administrator. This sign-up has been '
      + 'closed, so you can start again at once with another email address for the administrator. If you need help, contact '
      + `Health ID support at ${SUPPORT}.`)
    fireEvent.click(button('Start again with another email'))
    await expectFocusOnStep('Your account')
    expect(textbox('Email').value).toBe('')
    expect(textbox('Full name').value.trim()).toBe(NAME)
  })

  it('says Health ID needs to check the organization when activation says so', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(409, 'Review', { code: 'ORGANIZATION_REVIEW_REQUIRED' }))
    await toPassword()
    choosePassword()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Health ID needs to check this organization' })
    expect(heading.nextElementSibling?.textContent).toBe('We can’t set up this organization by ourselves. It may already be '
      + `on Health ID, for example for another product. Contact Health ID support at ${SUPPORT} to finish setting up `
      + 'your facility.')
  })

  it('never says the administrator is signed in when activation answers with an authenticator challenge', async () => {
    api.activate.mockResolvedValueOnce({ ...SESSION, status: 'mfa_enrollment_required' })
    await toPassword()
    choosePassword()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your account may already be ready' })
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByText('You’re signed in as your facility’s administrator.')).toBeNull()
    // No session was set, so the other tabs are told nothing.
    expect(TabChannel.posted).toEqual([])
    expect(api.activate).toHaveBeenCalledTimes(1)
  })

  it('links to the EHR site’s sign-in in production when the account may already be ready', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }))
    await toPassword()
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com', reload: vi.fn() })
    choosePassword()
    await screen.findByRole('heading', { level: 1, name: 'Your account may already be ready' })
    expect(screen.getByRole('link', { name: 'Sign in to the Provider Portal' }).getAttribute('href'))
      .toBe('https://ehr.healthidentitydirectory.com/provider/sign-in')
  })

  it('says the account may already be ready when the sign-in after activation failed', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(401, 'Unauthorized', { code: 'AUTHENTICATION_REQUIRED' }))
    await toPassword()
    choosePassword()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your account may already be ready' })
    expect(document.activeElement).toBe(heading)
    expect(heading.nextElementSibling?.textContent).toBe(`We couldn’t confirm that your facility was set up, but it may have been. `
      + `Sign in with ${EMAIL} and the password you chose. If you can’t sign in, contact Health ID support at ${SUPPORT}.`)
    expect(screen.getByRole('link', { name: 'Sign in to the Provider Portal' }).getAttribute('href')).toBe('/provider/sign-in')
  })

  it('goes back to Your account, kept, when the sign-up session has expired', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(401, 'Expired', { code: 'ORGANIZATION_COMPLETION_SESSION_INVALID' }))
    await toPassword()
    choosePassword()
    const heading = await step('Your account')
    expect(document.activeElement).toBe(heading)
    expect((await screen.findByRole('alert')).textContent).toBe('Your sign-up timed out. Check your details and select '
      + 'Continue to get a new code.')
    expect(textbox('Email').value.trim().toLowerCase()).toBe(EMAIL)
  })

  it('keeps the password step when activation’s answer is lost, and never creates a second account', async () => {
    api.activate.mockRejectedValueOnce(new HidApiError(503, 'Down', { code: 'UPSTREAM_UNAVAILABLE' }))
    await toPassword()
    choosePassword()
    expect((await screen.findByRole('alert')).textContent).toBe('Facility sign-up isn’t working right now. Please try again in '
      + 'a few minutes.')
    api.activate.mockRejectedValueOnce(new HidApiError(401, 'Expired', { code: 'ORGANIZATION_COMPLETION_SESSION_INVALID' }))
    choosePassword()
    expect(await screen.findByRole('heading', { level: 1, name: 'Your account may already be ready' })).toBeTruthy()
  })

  it('shows the closed panel, focused, when Identity says sign-up is closed, and no form', async () => {
    const asked = deferred<unknown>()
    api.availability.mockReturnValueOnce(asked.promise)
    open()
    const shown = focusWhenShown(() => screen.queryByRole('heading', { level: 1, name: 'Facility sign-up isn’t open right now' }))
    answer(() => asked.resolve({ open: false, reason: 'closed' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
    actAgain()
    expect(element.nextElementSibling?.textContent).toBe('Hospitals, laboratories and pharmacies can’t sign themselves up on '
      + `Health ID at the moment. To register your facility, contact Health ID support at ${SUPPORT}.`)
    expect(screen.getByText('If your facility already uses Health ID, sign in instead.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Sign-up progress' })).toBeNull()
  })

  it('says sign-up is temporarily unavailable when Identity could not tell, and asks again on Try again', async () => {
    api.availability.mockResolvedValueOnce({ open: false, reason: 'unavailable' })
    open()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Facility sign-up is temporarily unavailable' })
    expect(document.activeElement).toBe(heading)
    expect(heading.nextElementSibling?.textContent).toBe('We can’t take facility sign-ups just now because of a problem on our '
      + `side. Please try again in a few minutes. If this keeps happening, contact Health ID support at ${SUPPORT}.`)
    fireEvent.click(button('Try again'))
    await step('Your account')
    expect(api.availability).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a 404', new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })],
    ['an outage', new HidApiError(503, 'Down', { code: 'UPSTREAM_UNAVAILABLE' })],
  ])('shows the form when the availability read fails with %s: the start answers for itself', async (_, reason) => {
    api.availability.mockRejectedValueOnce(reason)
    open()
    await step('Your account')
  })
})
