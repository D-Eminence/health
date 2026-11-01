import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ORGANIZATION_TYPE_NOTES, organizationTypeNote } from '../../../staff/routes/ProviderEnrollment'
import { focusWhenShown } from '../../focusWhenShown'
import { security } from './signupFakes'
import {
  actAgain, answer, button, combobox, deferred, EMAIL, expectFocusOnStep, NAME, next, open, step,
  stepHeading, submitButton, submitRegistration, SUPPORT, TabChannel, textbox, toForm, toReview,
} from './signupHarness'

/**
 * The blue facility registration (design screens 02-07) as today's live sign-up: the design's five steps over today's
 * details form, the confirm dialog, and today's start with exactly today's payload and refusals. Every person, facility
 * and address here is fictional.
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
  api.profile.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
  api.withdraw.mockResolvedValue({ withdrawn: true })
  clinician.availability.mockResolvedValue({ open: false })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); actAgain() })

const NOT_COLLECTED = 'Not collected by Health ID yet'
/** The hint a field's aria-describedby names. */
const hintOf = (control: HTMLElement) => (control.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
const progress = () => screen.getByRole('group', { name: 'Registration progress' })

/** Today's start body (staff/routes/ProviderEnrollment.tsx:615-623, api.ts:1486-1494): the six fields, nothing more. */
const PAYLOAD = { productCode: 'ehr', organizationType: 'hospital', cacRegistrationNumber: 'RC123456', administratorName: NAME,
  administratorEmail: EMAIL, turnstileToken: 'token-0' }

describe('the registration opens as today’s page does', () => {
  it('asks once whether sign-up is open, then shows step 1 of 5 with the design’s progress', async () => {
    open()
    expect(screen.getByRole('status').textContent).toBe('Checking that facility sign-up is open…')
    expect(screen.getByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    await step('Your account')
    expect(api.availability).toHaveBeenCalledTimes(1)
    expect(within(progress()).getByText('Step 1 of 5 · Your account')).toBeTruthy()
    expect(within(progress()).getAllByRole('listitem').map(item => item.textContent)).toEqual(['1. Your account',
      '2. Facility details', '3. Regulatory identity', '4. Platform setup', '5. Agreements'])
    expect(within(progress()).getByText('1. Your account').getAttribute('aria-current')).toBe('step')
    expect(document.title).toBe('Provider enrollment · Health ID Provider')
    // The page itself sends nothing until it is submitted, and does not take focus when the form first shows.
    expect(api.start).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
  })

  it('keeps today’s footer, and offers sign-in, recovery and invitations', async () => {
    await toForm()
    expect(screen.getByText('Provider enrollment sets up a facility and its administrator’s account. Once Health ID support has '
      + 'checked the facility, its administrator adds the doctors, nurses and other staff on the Staff page.')).toBeTruthy()
    expect(await screen.findByText('Clinician sign-up isn\'t open yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Recover access' }).getAttribute('href')).toBe('/provider/recover')
    expect(screen.getByRole('link', { name: 'Accept invitation' }).getAttribute('href')).toBe('/provider/invitation')
  })
})

describe('step 1, Your account', () => {
  it('takes the administrator’s name and email, as today’s fields', async () => {
    await toForm()
    const name = textbox('Full name')
    expect(name.required).toBe(true)
    expect(name.minLength).toBe(2)
    expect(name.maxLength).toBe(200)
    expect(name.getAttribute('autocomplete')).toBe('name')
    const email = textbox('Email')
    expect(email.type).toBe('email')
    expect(email.required).toBe(true)
    expect(email.maxLength).toBe(254)
    expect(email.getAttribute('autocomplete')).toBe('email')
  })

  it('shows Phone and Role disabled, not collected, and the password as chosen after the email is confirmed', async () => {
    await toForm()
    for (const control of [textbox('Phone'), combobox('Role at the facility')]) {
      expect(control.disabled).toBe(true)
      expect(control.getAttribute('name')).toBeNull()
      expect(hintOf(control)).toBe(NOT_COLLECTED)
    }
    expect([...combobox('Role at the facility').options].map(option => option.text)).toEqual(['Select…', 'Owner',
      'Medical Director', 'Administrator', 'Other authorised representative'])
    for (const label of ['Password', 'Confirm password']) {
      const field = screen.getByLabelText(label) as HTMLInputElement
      expect(field.disabled).toBe(true)
      expect(field.type).toBe('password')
      expect(hintOf(field)).toBe('You choose your password after confirming your email.')
    }
  })

  it('stops Continue at a missing or wrong value with the design’s words, and focuses the field', async () => {
    await toForm()
    next()
    expect(screen.getAllByText('This field is required.')).toHaveLength(2)
    expect(document.activeElement).toBe(textbox('Full name'))
    expect(textbox('Full name').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Email'), { target: { value: 'not-an-email' } })
    next()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('Email'))
    expect(stepHeading().textContent).toBe('Your account')
    fireEvent.change(textbox('Full name'), { target: { value: ' D ' } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    next()
    expect(screen.getByText('Enter at least two characters.')).toBeTruthy()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('offers no draft: Save & continue later is shown disabled and says why', async () => {
    await toForm()
    const later = button('Save & continue later')
    expect(later.disabled).toBe(true)
    expect(document.getElementById(later.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Not available yet: Health ID doesn’t save drafts of a registration.')
  })
})

describe('moving between steps', () => {
  it('puts focus on the step heading after each step change, forward and back', async () => {
    await toForm()
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    next()
    await expectFocusOnStep('Facility details')
    expect(within(progress()).getByText('Step 2 of 5 · Facility details')).toBeTruthy()
    next()
    await expectFocusOnStep('Regulatory identity')
    fireEvent.click(button('Back'))
    await expectFocusOnStep('Facility details')
    fireEvent.click(button('Back'))
    await expectFocusOnStep('Your account')
    // Values are kept in the page while it is open.
    expect(textbox('Full name').value).toBe(NAME)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})

describe('step 2, Facility details', () => {
  it('takes today’s five facility types, Hospital first, and shows every other design field disabled', async () => {
    await toReview()
    fireEvent.click(button('Edit facility details'))
    await step('Facility details')
    const type = combobox('Facility type')
    expect([...type.options].map(option => [option.value, option.text])).toEqual([['hospital', 'Hospital'],
      ['clinic', 'Clinic'], ['laboratory', 'Laboratory'], ['pharmacy', 'Pharmacy'], ['other', 'Other healthcare provider']])
    expect(type.value).toBe('hospital')
    expect(hintOf(textbox('Facility name'))).toBe(`${NOT_COLLECTED}: your facility’s registered name comes from its CAC record.`)
    for (const name of ['Address', 'GPS pin (latitude, longitude)', 'Facility phone', 'Facility email', 'Operating hours',
      'Services offered']) {
      expect(textbox(name).disabled).toBe(true)
      expect(hintOf(textbox(name))).toBe(NOT_COLLECTED)
    }
    for (const name of ['Ownership', 'Level of care', 'State', 'Local government area', '24-hour emergency']) {
      expect(combobox(name).disabled).toBe(true)
      expect(hintOf(combobox(name))).toBe(NOT_COLLECTED)
    }
    const departments = screen.getByRole('listbox', { name: 'Departments' }) as HTMLSelectElement
    expect(departments.disabled).toBe(true)
    expect(departments.multiple).toBe(true)
    expect((screen.getByRole('spinbutton', { name: 'Bed count' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('preselects ?type= and ?product= as today’s page does, keeping only a product the type allows', async () => {
    await toReview({ entry: '/provider/enroll?type=laboratory&product=ehr' })
    fireEvent.click(button('Edit platform setup'))
    await step('Platform setup')
    expect(combobox('Product to start with').value).toBe('laboratory')
    fireEvent.click(button('Back'))
    await step('Regulatory identity')
    fireEvent.click(button('Back'))
    await step('Facility details')
    expect(combobox('Facility type').value).toBe('laboratory')
  })
})

describe('step 3, Regulatory identity', () => {
  it('takes the CAC number as today’s field does, with today’s fine print, and shows the rest disabled', async () => {
    await toReview()
    fireEvent.click(button('Edit regulatory identity'))
    await step('Regulatory identity')
    const cac = textbox('CAC registration number')
    expect(cac.value).toBe('RC123456')
    expect(cac.required).toBe(true)
    expect(cac.getAttribute('pattern')).toBe('(RC|BN|IT)[0-9]{4,20}')
    expect(cac.maxLength).toBe(22)
    expect(cac.placeholder).toBe('RC123456')
    expect(cac.getAttribute('autocomplete')).toBe('off')
    expect(hintOf(cac)).toBe('We check your CAC against the official registry, and Health ID support checks every new facility '
      + 'within one working day.')
    for (const name of ['State Ministry of Health licence number', 'National facility registry ID (optional)',
      'Medical Director’s full name', 'MDCN number', 'NHIA accreditation (optional)']) {
      expect(textbox(name).disabled).toBe(true)
      expect(hintOf(textbox(name))).toBe(NOT_COLLECTED)
    }
    for (const label of ['Operating licence (image/PDF, max 2 MB)', 'CAC certificate (image/PDF, max 2 MB)',
      'Proof of address (image/PDF, max 2 MB)']) {
      const file = screen.getByLabelText(label) as HTMLInputElement
      expect(file.type).toBe('file')
      expect(file.disabled).toBe(true)
      expect(hintOf(file)).toBe(NOT_COLLECTED)
    }
  })

  it('needs a CAC number in today’s pattern before Continue', async () => {
    await toReview()
    fireEvent.click(button('Edit regulatory identity'))
    await step('Regulatory identity')
    fireEvent.change(textbox('CAC registration number'), { target: { value: '' } })
    next()
    expect(screen.getByText('This field is required.')).toBeTruthy()
    fireEvent.change(textbox('CAC registration number'), { target: { value: 'ab 12' } })
    expect(textbox('CAC registration number').value).toBe('AB12')
    next()
    expect(screen.getByText('Enter the number on your CAC certificate: RC, BN or IT, then its digits, for example RC123456.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('CAC registration number'))
    expect(stepHeading().textContent).toBe('Regulatory identity')
  })
})

describe('step 4, Platform setup', () => {
  it.each([
    ['hospital', ['ehr', 'laboratory', 'pharmacy', 'migrate']],
    ['laboratory', ['laboratory']],
    ['pharmacy', ['pharmacy']],
    ['other', ['ehr', 'laboratory', 'pharmacy', 'migrate']],
  ])('offers a %s today’s products, with the type’s note', async (type, codes) => {
    await toReview({ type })
    fireEvent.click(button('Edit platform setup'))
    await step('Platform setup')
    const product = combobox('Product to start with')
    expect([...product.options].map(option => option.value)).toEqual(codes)
    expect(hintOf(product)).toBe(ORGANIZATION_TYPE_NOTES[type as keyof typeof ORGANIZATION_TYPE_NOTES])
    expect([...combobox('Product to start with').options].map(option => option.text)[0])
      .toBe(type === 'laboratory' ? 'Health ID Laboratory' : type === 'pharmacy' ? 'Health ID Pharmacy' : 'Health ID EHR')
    for (const name of ['Migrating existing records?', 'Need interoperability with other facilities?']) {
      expect(combobox(name).disabled).toBe(true)
      expect(hintOf(combobox(name))).toBe(NOT_COLLECTED)
    }
    expect((screen.getByRole('spinbutton', { name: 'Expected number of staff' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('says what a laboratory’s note says when orders between facilities are on (P4c)', async () => {
    api.availability.mockResolvedValue({ open: true, crossFacilityOrders: true })
    await toReview({ type: 'laboratory' })
    fireEvent.click(button('Edit platform setup'))
    await step('Platform setup')
    expect(organizationTypeNote('laboratory', true)).not.toBe(ORGANIZATION_TYPE_NOTES.laboratory)
    expect(hintOf(combobox('Product to start with'))).toBe(organizationTypeNote('laboratory', true))
  })
})

describe('step 5, Agreements', () => {
  it('reviews each section with its Edit, and lists only what Health ID takes', async () => {
    await toReview({ product: 'migrate' })
    expect(within(progress()).getByText('Step 5 of 5 · Agreements')).toBeTruthy()
    const facts = [...document.querySelectorAll('.hid-ehr-signup-facts > div')].map(row => row.textContent)
    expect(facts).toEqual([`Full name${NAME}`, `Email${EMAIL}`, 'Facility typeHospital', 'CAC registration numberRC123456',
      'ProductHealth ID Migrate'])
    fireEvent.click(button('Edit your account'))
    await expectFocusOnStep('Your account')
  })

  // Parity report 3.2: the start has no field for an agreement, so Health ID cannot record one. The page draws no box
  // that blocks Submit and is then forgotten; it shows the two documents beside Submit instead.
  it('has no agreement boxes, and links the Terms of Service and Privacy Policy beside Submit', async () => {
    await toReview()
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    const terms = screen.getByRole('link', { name: 'Health ID Terms of Service' })
    const privacy = screen.getByRole('link', { name: 'Health ID Privacy Policy' })
    expect(terms.getAttribute('href')).toBe('https://healthidentitydirectory.com/terms')
    expect(privacy.getAttribute('href')).toBe('https://healthidentitydirectory.com/privacy')
    for (const link of [terms, privacy]) {
      // In the form that Submit sends, shown rather than folded away, and opening in a new tab as the page says.
      expect(link.closest('form')).toBe(submitButton().closest('form'))
      expect(link.closest('details')).toBeNull()
      expect(link.getAttribute('target')).toBe('_blank')
    }
    expect(terms.closest('p')?.textContent).toBe('Before you submit, please read the Health ID Terms of Service and the '
      + 'Health ID Privacy Policy (each opens in a new tab).')
    expect(screen.getByText('Facility users are responsible for appropriate data protection and patient consent.'))
      .toBeTruthy()
    // Nothing on the page asks for an acceptance or says that one is recorded.
    expect(document.body.textContent)
      .not.toMatch(/record(ed)? (your|the) (agreement|acceptance)|we keep a record|I agree|you agree|by submitting|acknowledge/i)
    // Health ID has no Data Processing Agreement: no paragraph names one.
    expect(document.body.textContent).not.toMatch(/Data Processing Agreement/)
  })

  it('no longer waits for any box: Submit is ready with the security check, and sends today’s payload alone', async () => {
    await toReview()
    expect(submitButton().disabled).toBe(false)
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(submitButton())
    const dialog = await screen.findByRole('alertdialog', { name: 'Submit this registration?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }))
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith(PAYLOAD)
    expect(Object.keys(api.start.mock.calls[0]![0] as object).sort()).toEqual(Object.keys(PAYLOAD).sort())
  })
})

describe('submitting', () => {
  it('asks in the design’s dialog first; Cancel sends nothing', async () => {
    await toReview()
    fireEvent.click(submitButton())
    const dialog = await screen.findByRole('alertdialog', { name: 'Submit this registration?' })
    // Health ID records no acceptance: the dialog asks to confirm the details, not to accept anything.
    expect(dialog.textContent).toContain('Check the details above, then submit. Health ID checks your CAC registration number '
      + 'and emails you a six digit code.')
    expect(dialog.textContent).not.toMatch(/accept/i)
    expect(within(dialog).getByRole('button', { name: 'Confirm and submit' })).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
    expect(stepHeading().textContent).toBe('Agreements')
  })

  it('runs today’s start once with exactly today’s payload, then says the registration is submitted', async () => {
    await toReview()
    await submitRegistration()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith(PAYLOAD)
    expect(Object.keys(api.start.mock.calls[0]![0] as object).sort()).toEqual(Object.keys(PAYLOAD).sort())
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText('We’ve checked your CAC registration number. Confirm your email next, then choose your password. '
      + 'Full access begins once Health ID support has checked your facility, usually within one working day.')).toBeTruthy()
  })

  it('sends the type and product chosen, and never a field Health ID does not take', async () => {
    await toReview({ type: 'clinic', product: 'pharmacy' })
    // Even a value forced into a disabled design field stays on the page.
    fireEvent.click(button('Edit your account'))
    await step('Your account')
    fireEvent.change(textbox('Phone'), { target: { value: '08012345678' } })
    for (let index = 0; index < 4; index++) next()
    await step('Agreements')
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenCalledWith({ ...PAYLOAD, organizationType: 'clinic', productCode: 'pharmacy' })
    expect(JSON.stringify(api.start.mock.calls)).not.toContain('08012345678')
  })

  it('sends nothing without the security check, which sits beside the submit', async () => {
    security.auto = false
    await toReview()
    expect(submitButton().disabled).toBe(true)
    fireEvent.submit(submitButton().closest('form')!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const check = button('Complete the security check')
    expect(check.getAttribute('data-turnstile-action')).toBe('provider-enrollment')
    expect(check.closest('.hid-ehr-signup-actions')).toBe(submitButton().closest('.hid-ehr-signup-actions'))
    fireEvent.click(check)
    expect(submitButton().disabled).toBe(false)
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenCalledTimes(1)
  })

  it('says the CAC check is running while the start waits for it', async () => {
    const started = deferred<unknown>()
    api.start.mockReturnValueOnce(started.promise)
    await toReview()
    await submitRegistration()
    await waitFor(() => expect(button('Verifying CAC…').getAttribute('aria-busy')).toBe('true'))
    answer(() => started.resolve({ accepted: true, codeSent: true, challengeId: 'challenge-1' }))
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
  })
})

const SIGN_OUT = 'This browser is signed in to Health ID, for example to a patient account. Sign out of Health ID first, or open '
  + 'this page in a private (incognito) window, then try again.'

describe('a refusal of the start, in today’s words', () => {
  // The organization behind the CAC number: back to Regulatory identity, the words at the CAC field.
  it.each([
    [422, 'CAC_NOT_VERIFIED', 'We couldn’t verify this CAC registration number. Check the number on your CAC certificate (it '
      + 'starts with RC, BN or IT) and try again.'],
    [409, 'PROVIDER_CAC_PROFILE_INCOMPLETE', 'We couldn’t set up your organization automatically from its CAC record: the record '
      + `is missing details we need, or it doesn’t show the company as active. Contact Health ID support at ${SUPPORT}, and give `
      + 'your CAC registration number.'],
    [409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'This organization can’t be set up automatically right now: its CAC number may '
      + 'already be linked to Health ID, another sign-up for it may be in progress, or Health ID support may have recently '
      + `closed a sign-up for it. Contact Health ID support at ${SUPPORT}, and give your CAC registration number.`],
    [409, 'ORGANIZATION_REVIEW_REQUIRED', 'This organization needs a check by Health ID before it can be set up, for example '
      + 'because its CAC number is already linked to Health ID or another sign-up for it is in progress. Contact Health ID '
      + `support at ${SUPPORT}, and give your CAC registration number.`],
    [409, 'PROVIDER_ALREADY_REGISTERED', 'This organization is already registered with Health ID. If you are its administrator, '
      + `sign in instead. Contact Health ID support at ${SUPPORT}.`],
  ])('%s %s returns to Regulatory identity with the words at the CAC field', async (status, code, words) => {
    const refused = deferred<unknown>()
    api.start.mockReturnValueOnce(refused.promise)
    await toReview()
    await submitRegistration()
    const shown = focusWhenShown(() => screen.queryByRole('heading', { level: 2, name: 'Regulatory identity' }))
    answer(() => refused.reject(new HidApiError(status, 'Identity’s own words', { code })))
    const { element, focused } = await shown
    // Focus is on the step heading in the commit that shows it.
    expect(focused).toBe(element)
    actAgain()
    const cac = textbox('CAC registration number')
    expect(cac.getAttribute('aria-invalid')).toBe('true')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(words)
    expect(hintOf(cac)).toContain(words)
    expect(cac.value).toBe('RC123456')
    if (words.includes(SUPPORT)) expect(within(alert).getByRole('link', { name: SUPPORT }).getAttribute('href')).toBe(`mailto:${SUPPORT}`)
    // Correcting the number and coming back sends again, with a fresh security check.
    fireEvent.change(cac, { target: { value: 'RC654321' } })
    next(); await step('Platform setup')
    next(); await step('Agreements')
    expect(screen.queryByRole('alert')).toBeNull()
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, cacRegistrationNumber: 'RC654321', turnstileToken: 'token-1' })
  })

  // Anything else stays where the registration was submitted, with the form as it was.
  it.each([
    [409, 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT', SIGN_OUT],
    [429, 'APPLICATION_RATE_LIMITED', 'There have been too many sign-up attempts from your network. Please try again later.'],
    [429, 'VERIFICATION_QUOTA_EXCEEDED', 'The limit on CAC checks has been reached for now. Please try again later.'],
    [409, 'VERSION_CONFLICT', 'Your sign-up changed while we were working on it. Please try again.'],
    [403, 'ORIGIN_DENIED', 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_CONTEXT_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_HOSTNAME_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_REJECTED', 'The security check didn’t go through. Please complete it again, then retry.'],
    [400, 'TURNSTILE_REQUIRED', 'The security check didn’t go through. Please complete it again, then retry.'],
    [403, 'PROVIDER_ENROLLMENT_DENIED', 'Facility sign-up is temporarily unavailable. Please try again in a few minutes.'],
    [400, 'VALIDATION_FAILED', 'Some of the details weren’t accepted. Check them and try again.'],
    [409, 'SOMETHING_NEW', 'Identity’s own words'],
  ])('%s %s stays on Agreements with today’s words', async (status, code, words) => {
    api.start.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own words', { code }))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(stepHeading().textContent).toBe('Agreements')
    // A new security check for the next try (today: the token is cleared and the widget reset after every start).
    await waitFor(() => expect(submitButton().disabled).toBe(false))
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, turnstileToken: 'token-1' })
  })

  it('says so when the refusal is not Identity’s', async () => {
    api.start.mockRejectedValueOnce(new Error('script error'))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe('We could not complete facility sign-up. Please try again.')
  })

  it.each([
    [503, 'UPSTREAM_UNAVAILABLE'], [504, 'QOREID_TIMEOUT'], [503, 'TURNSTILE_UNAVAILABLE'], [0, 'NETWORK_ERROR'], [408, 'REQUEST_TIMEOUT'],
  ])('reads %s %s as an outage: asks again whether sign-up is open, and waits a minute', async (status, code) => {
    api.start.mockRejectedValueOnce(new HidApiError(status, 'Gateway words', { code }))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t finish checking your details just now. Please try '
      + 'again in a minute. If an email with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.')
    expect(api.availability).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/^You can try again in (60|59) seconds\.$/)).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
  })

  it('waits a minute when QoreID is limiting CAC checks', async () => {
    api.start.mockRejectedValueOnce(new HidApiError(429, 'Rate limited', { code: 'QOREID_RATE_LIMITED' }))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t check your CAC registration number just now. '
      + 'Please try again in a minute.')
    expect(screen.getByText(/^You can try again in (60|59) seconds\.$/)).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
  })

  it('shows the closed panel when sign-up has closed meanwhile (423), focused', async () => {
    api.start.mockRejectedValueOnce(new HidApiError(423, 'Closed', { code: 'PROVIDER_ENROLLMENT_UNAVAILABLE' }))
    await toReview()
    await submitRegistration()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Facility sign-up isn’t open right now' })
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByRole('heading', { level: 2, name: 'Agreements' })).toBeNull()
  })

  it.each([
    [45, 'We can’t send a new code for these details yet.', /^You can try again in (45|44) seconds\.$/],
    [3_300, 'We’ve sent as many codes for these details as we can for now.', /^You can try again in 55 minutes\.$/],
  ])('waits for a new code when Identity sent none and none can be entered (%s s)', async (wait, words, hint) => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, resendAfterSeconds: wait })
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(screen.getByText(hint)).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
    expect(stepHeading().textContent).toBe('Agreements')
    expect(screen.queryByRole('heading', { level: 1, name: 'Facility registration submitted' })).toBeNull()
  })
})

/**
 * A changed facility type or administrator name goes only with a new code (R6): when Identity sends none (codeSent
 * false) and the code in force carries the earlier ones, today's page holds the change and offers that code
 * (ProviderEnrollment.tsx:726-735, 1058-1064). The blue registration shows it on Agreements.
 */
describe('a changed facility type that Identity sent no code for', () => {
  it('stays on Agreements, says the change was not applied, waits, and offers the code already sent', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', expiresInSeconds: 600,
      resendAfterSeconds: 0 })
    await toReview()
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change unverified email' }))
    await step('Your account')
    next()
    await step('Facility details')
    fireEvent.change(combobox('Facility type'), { target: { value: 'clinic' } })
    for (const name of ['Regulatory identity', 'Platform setup', 'Agreements']) { next(); await step(name) }
    expect(screen.queryByText(/^A new facility type or administrator name/)).toBeNull()

    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 590,
      resendAfterSeconds: 45 })
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(`We didn’t send a new code, because one was sent to ${EMAIL} less `
      + 'than a minute ago, so your changes haven’t been applied.')
    expect(api.start).toHaveBeenCalledTimes(2)
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, organizationType: 'clinic', turnstileToken: 'token-1' })
    // Not the code: its code would register a hospital.
    expect(stepHeading().textContent).toBe('Agreements')
    expect(screen.getByText(/^A new facility type or administrator name/).textContent).toBe('A new facility type or '
      + `administrator name takes effect only with a new code. The code already sent is for the facility type Hospital, with ${NAME} `
      + 'as administrator.')
    expect(screen.getByText(/^You can continue with your changes in (45|44) seconds\.$/)).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
    fireEvent.submit(submitButton().closest('form')!)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(button('Use the details I gave before'))
    await screen.findByRole('heading', { level: 1, name: 'Enter your verification code' })
    expect(document.querySelector('.hid-ehr-signup-lede')?.textContent).toBe(`We didn’t send a new code, because one was sent to `
      + `${EMAIL} less than a minute ago. Enter the six digit code from that email.`)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.start).toHaveBeenCalledTimes(2)
    fireEvent.change(textbox('Verification code'), { target: { value: '111111' } })
    fireEvent.click(button('Verify code'))
    await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
    expect(api.verify).toHaveBeenCalledWith('challenge-1', '111111')
  })
})

describe('another email for a sign-up that is open', () => {
  it('warns before sending, offers the first email, and says only it can finish the sign-up', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toReview()
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change unverified email' }))
    await expectFocusOnStep('Your account')
    expect(textbox('Email').value.trim().toLowerCase()).toBe(EMAIL)
    fireEvent.change(textbox('Email'), { target: { value: 'other@demo-hospital.example.test' } })
    for (let index = 0; index < 4; index++) next()
    await step('Agreements')
    expect(screen.getByText(`A sign-up for RC123456 was started with ${EMAIL}, and only that email can finish it until 24 hours `
      + 'after it started. You can still correct the CAC number.')).toBeTruthy()

    api.start.mockRejectedValueOnce(new HidApiError(409, 'Requires review', { code: 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' }))
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(`This CAC number’s sign-up was started with ${EMAIL}, so it can’t `
      + `use another email yet. Finish it with the code sent to ${EMAIL}, or sign up with the new email 24 hours after the first `
      + `sign-up started. Otherwise, contact Health ID support at ${SUPPORT}, and give your CAC registration number.`)
    // It is about the email, not the number: the registration stays where it was submitted.
    expect(stepHeading().textContent).toBe('Agreements')
    fireEvent.click(button('Use the email I first gave'))
    expect(screen.queryByText(/only that email can finish it/)).toBeNull()
    expect(document.querySelector('.hid-ehr-signup-facts')?.textContent).toContain(EMAIL)
  })
})
