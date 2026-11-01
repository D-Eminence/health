import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ORGANIZATION_TYPE_NOTES, organizationTypeNote } from '../../../staff/routes/ProviderEnrollment'
import { focusWhenShown } from '../../focusWhenShown'
import { security } from './signupFakes'
import {
  actAgain, agreeToAll, AGREEMENT_LABELS, answer, button, combobox, deferred, EMAIL, expectFocusOnStep, NAME, next, open, step,
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

/** Fields of the design that Health ID does not take: none is drawn (no "not collected yet"). */
const NOT_TAKEN = ['Phone', 'Role at the facility', 'Facility name', 'Ownership', 'Level of care', 'Address', 'State',
  'Local government area', 'GPS pin (latitude, longitude)', 'Facility phone', 'Facility email', 'Bed count', 'Operating hours',
  '24-hour emergency', 'Departments', 'Services offered', 'State Ministry of Health licence number', 'MDCN number',
  'Operating licence (image/PDF, max 2 MB)', 'Expected number of staff', 'Migrating existing records?']
const noneOfTheUntaken = () => {
  for (const label of NOT_TAKEN) expect(screen.queryByLabelText(label)).toBeNull()
  expect(screen.queryByText(/Not collected/)).toBeNull()
}
/** The hint a field's aria-describedby names. */
const hintOf = (control: HTMLElement) => (control.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
const progress = () => screen.getByRole('group', { name: 'Sign-up progress' })

/** Today's start body (staff/routes/ProviderEnrollment.tsx:615-623, api.ts:1486-1494): the six fields, nothing more. */
const PAYLOAD = { productCode: 'ehr', organizationType: 'hospital', cacRegistrationNumber: 'RC123456', administratorName: NAME,
  administratorEmail: EMAIL, turnstileToken: 'token-0' }

describe('the registration opens as today’s page does', () => {
  it('asks once whether sign-up is open, then shows step 1 of 5 with the design’s progress', async () => {
    open()
    expect(screen.getByRole('status').textContent).toBe('Checking that facility sign-up is open…')
    expect(screen.getByRole('heading', { level: 1, name: 'Register a facility' })).toBeTruthy()
    expect(screen.getByText('Sign up your clinic, hospital, lab or pharmacy.')).toBeTruthy()
    await step('Your account')
    expect(api.availability).toHaveBeenCalledTimes(1)
    expect(progress().textContent).toBe('Step 1 of 5 · Your account')
    expect(document.title).toBe('Facility sign-up · Health ID Provider')
    // The page itself sends nothing until it is submitted, and does not take focus when the form first shows.
    expect(api.start).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
  })

  it('opens in the shared sign-in layout, with one way in (Sign in) and no paragraphs or "not open yet"', async () => {
    await toForm()
    expect(screen.queryByText(/Provider enrollment sets up a facility/)).toBeNull()
    expect(screen.queryByText(/open yet/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.queryByRole('link', { name: 'Recover access' })).toBeNull()
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

  it('draws no field Health ID does not take, and no password before the email is confirmed', async () => {
    await toForm()
    noneOfTheUntaken()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('Confirm password')).toBeNull()
  })

  it('stops Continue at a missing or wrong value with the design’s words, and focuses the field', async () => {
    await toForm()
    next()
    expect(screen.getAllByText('Fill in this field.')).toHaveLength(2)
    expect(document.activeElement).toBe(textbox('Full name'))
    expect(textbox('Full name').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Email'), { target: { value: 'not-an-email' } })
    next()
    expect(screen.getByText('Enter an email address, like name@example.com.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('Email'))
    expect(stepHeading().textContent).toBe('Your account')
    fireEvent.change(textbox('Full name'), { target: { value: ' D ' } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    next()
    expect(screen.getByText('Enter at least two characters.')).toBeTruthy()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('offers no draft, and says nothing about it', async () => {
    await toForm()
    expect(screen.queryByRole('button', { name: 'Save & continue later' })).toBeNull()
    expect(screen.queryByText(/Not available yet/)).toBeNull()
  })
})

describe('moving between steps', () => {
  it('puts focus on the step heading after each step change, forward and back', async () => {
    await toForm()
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    next()
    await expectFocusOnStep('Facility type')
    expect(progress().textContent).toBe('Step 2 of 5 · Facility type')
    next()
    await expectFocusOnStep('CAC number')
    fireEvent.click(button('Back'))
    await expectFocusOnStep('Facility type')
    fireEvent.click(button('Back'))
    await expectFocusOnStep('Your account')
    // Values are kept in the page while it is open.
    expect(textbox('Full name').value).toBe(NAME)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})

describe('step 2, Facility type', () => {
  it('takes today’s five facility types, Hospital first, and draws no other design field', async () => {
    await toReview()
    fireEvent.click(button('Edit facility type'))
    await step('Facility type')
    const type = combobox('Facility type')
    expect([...type.options].map(option => [option.value, option.text])).toEqual([['hospital', 'Hospital'],
      ['clinic', 'Clinic'], ['laboratory', 'Laboratory'], ['pharmacy', 'Pharmacy'], ['other', 'Other healthcare provider']])
    expect(type.value).toBe('hospital')
    noneOfTheUntaken()
  })

  it('preselects ?type= and ?product= as today’s page does, keeping only a product the type allows', async () => {
    await toReview({ entry: '/provider/enroll?type=laboratory&product=ehr' })
    fireEvent.click(button('Edit product'))
    await step('Product')
    expect(combobox('Product to start with').value).toBe('laboratory')
    fireEvent.click(button('Back'))
    await step('CAC number')
    fireEvent.click(button('Back'))
    await step('Facility type')
    expect(combobox('Facility type').value).toBe('laboratory')
  })
})

describe('step 3, CAC number', () => {
  it('takes the CAC number as today’s field does, with today’s fine print, and nothing else', async () => {
    await toReview()
    fireEvent.click(button('Edit CAC number'))
    await step('CAC number')
    const cac = textbox('CAC number')
    expect(cac.value).toBe('RC123456')
    expect(cac.required).toBe(true)
    expect(cac.getAttribute('pattern')).toBe('(RC|BN|IT)[0-9]{4,20}')
    expect(cac.maxLength).toBe(22)
    expect(cac.placeholder).toBe('RC123456')
    expect(cac.getAttribute('autocomplete')).toBe('off')
    expect(hintOf(cac)).toBe('From your business registration certificate. Health ID support checks every new facility '
      + 'within one working day.')
    noneOfTheUntaken()
  })

  it('needs a CAC number in today’s pattern before Continue', async () => {
    await toReview()
    fireEvent.click(button('Edit CAC number'))
    await step('CAC number')
    fireEvent.change(textbox('CAC number'), { target: { value: '' } })
    next()
    expect(screen.getByText('Fill in this field.')).toBeTruthy()
    fireEvent.change(textbox('CAC number'), { target: { value: 'ab 12' } })
    expect(textbox('CAC number').value).toBe('AB12')
    next()
    expect(screen.getByText('Enter the number on your CAC certificate: RC, BN or IT, then its digits, for example RC123456.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('CAC number'))
    expect(stepHeading().textContent).toBe('CAC number')
  })
})

describe('step 4, Product', () => {
  it.each([
    ['hospital', ['ehr', 'laboratory', 'pharmacy', 'migrate']],
    ['laboratory', ['laboratory']],
    ['pharmacy', ['pharmacy']],
    ['other', ['ehr', 'laboratory', 'pharmacy', 'migrate']],
  ])('offers a %s today’s products, with the type’s note', async (type, codes) => {
    await toReview({ type })
    fireEvent.click(button('Edit product'))
    await step('Product')
    const product = combobox('Product to start with')
    expect([...product.options].map(option => option.value)).toEqual(codes)
    expect(hintOf(product)).toBe(ORGANIZATION_TYPE_NOTES[type as keyof typeof ORGANIZATION_TYPE_NOTES])
    expect([...combobox('Product to start with').options].map(option => option.text)[0])
      .toBe(type === 'laboratory' ? 'Health ID Laboratory' : type === 'pharmacy' ? 'Health ID Pharmacy' : 'Health ID EHR')
    noneOfTheUntaken()
  })

  it('says what a laboratory’s note says when orders between facilities are on (P4c)', async () => {
    api.availability.mockResolvedValue({ open: true, crossFacilityOrders: true })
    await toReview({ type: 'laboratory' })
    fireEvent.click(button('Edit product'))
    await step('Product')
    expect(organizationTypeNote('laboratory', true)).not.toBe(ORGANIZATION_TYPE_NOTES.laboratory)
    expect(hintOf(combobox('Product to start with'))).toBe(organizationTypeNote('laboratory', true))
  })
})

describe('step 5, Agreements', () => {
  it('reviews each section with its Edit, and lists only what Health ID takes', async () => {
    await toReview({ product: 'migrate' })
    expect(progress().textContent).toBe('Step 5 of 5 · Agreements')
    const facts = [...document.querySelectorAll('.hid-ehr-signup-facts > div')].map(row => row.textContent)
    expect(facts).toEqual([`Full name${NAME}`, `Email${EMAIL}`, 'Facility typeHospital', 'CAC numberRC123456',
      'ProductHealth ID Migrate'])
    fireEvent.click(button('Edit your account'))
    await expectFocusOnStep('Your account')
  })

  it('shows the agreements and needs all four boxes ticked before it can be submitted', async () => {
    await toReview()
    fireEvent.click(screen.getByText('Read the agreements'))
    expect(screen.getByRole('link', { name: 'Health ID Terms of Service' }).getAttribute('href'))
      .toBe('https://healthidentitydirectory.com/terms')
    expect(screen.getByRole('link', { name: 'Health ID Privacy Policy' }).getAttribute('href'))
      .toBe('https://healthidentitydirectory.com/privacy')
    // Nothing on the page says that the ticks are recorded: Health ID does not record them yet.
    expect(document.body.textContent).not.toMatch(/record(ed)? (your|the) (agreement|acceptance)|we keep a record/i)
    // Health ID has no Data Processing Agreement: no box and no paragraph name one.
    expect(document.body.textContent).not.toMatch(/Data Processing Agreement/)
    expect(screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent?.replace('*', '')))
      .toEqual(['I have read the Terms of Service', 'I have read the Privacy Policy',
        'I acknowledge data protection and patient consent responsibilities', 'I am authorised to register this facility'])
    expect(submitButton().disabled).toBe(true)
    for (const name of AGREEMENT_LABELS.slice(0, 3)) fireEvent.click(screen.getByRole('checkbox', { name }))
    expect(submitButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: AGREEMENT_LABELS[3] }))
    expect(submitButton().disabled).toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('keeps the ticks while the page is open, through an Edit and back', async () => {
    await toReview()
    agreeToAll()
    fireEvent.click(button('Edit product'))
    await step('Product')
    next()
    await step('Agreements')
    expect(submitButton().disabled).toBe(false)
  })
})

describe('submitting', () => {
  it('asks in the design’s dialog first; Cancel sends nothing', async () => {
    await toReview()
    agreeToAll()
    fireEvent.click(submitButton())
    const dialog = await screen.findByRole('alertdialog', { name: 'Send these details?' })
    // Health ID records no acceptance: the dialog asks to confirm the details, not to accept anything.
    expect(dialog.textContent).toContain('Check the details above, then send them. Health ID checks your CAC number '
      + 'and emails you a 6-digit code.')
    expect(dialog.textContent).not.toMatch(/accept/i)
    expect(within(dialog).getByRole('button', { name: 'Yes, send them' })).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
    expect(stepHeading().textContent).toBe('Agreements')
  })

  it('runs today’s start once with exactly today’s payload, then says the registration is submitted', async () => {
    await toReview()
    await submitRegistration()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith(PAYLOAD)
    expect(Object.keys(api.start.mock.calls[0]![0] as object).sort()).toEqual(Object.keys(PAYLOAD).sort())
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText('We’ve checked your CAC number. Confirm your email next, then choose your password. '
      + 'Full access begins once Health ID support has checked your facility, usually within one working day.')).toBeTruthy()
  })

  it('sends the type and product chosen, and never a field Health ID does not take', async () => {
    await toReview({ type: 'clinic', product: 'pharmacy' })
    // No field Health ID doesn't take is drawn, so none can be filled in.
    fireEvent.click(button('Edit your account'))
    await step('Your account')
    expect(screen.queryByLabelText('Phone')).toBeNull()
    for (let index = 0; index < 4; index++) next()
    await step('Agreements')
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
    expect(api.start).toHaveBeenCalledWith({ ...PAYLOAD, organizationType: 'clinic', productCode: 'pharmacy' })
    expect(JSON.stringify(api.start.mock.calls)).not.toContain('08012345678')
  })

  it('sends nothing without the security check, which sits right above the submit', async () => {
    security.auto = false
    await toReview()
    agreeToAll()
    expect(submitButton().disabled).toBe(true)
    fireEvent.submit(submitButton().closest('form')!)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const check = button('Complete the security check')
    expect(check.getAttribute('data-turnstile-action')).toBe('provider-enrollment')
    // Right above the buttons, in the same form.
    expect(check.closest('form')).toBe(submitButton().closest('form'))
    expect(check.closest('.hid-ehr-signup-turnstile')?.nextElementSibling).toBe(submitButton().closest('.hid-ehr-signup-actions'))
    fireEvent.click(check)
    expect(submitButton().disabled).toBe(false)
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
    expect(api.start).toHaveBeenCalledTimes(1)
  })

  it('says the CAC check is running while the start waits for it', async () => {
    const started = deferred<unknown>()
    api.start.mockReturnValueOnce(started.promise)
    await toReview()
    await submitRegistration()
    await waitFor(() => expect(button('Checking CAC…').getAttribute('aria-busy')).toBe('true'))
    answer(() => started.resolve({ accepted: true, codeSent: true, challengeId: 'challenge-1' }))
    await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
  })
})

const SIGN_OUT = 'Someone is signed in to Health ID on this device, for example to a patient account. Sign out first, or open '
  + 'this page in a private (incognito) window, then try again.'

describe('a refusal of the start, in today’s words', () => {
  // The organization behind the CAC number: back to CAC number, the words at the CAC field.
  it.each([
    [422, 'CAC_NOT_VERIFIED', 'We couldn’t check this CAC number. Check the number on your CAC certificate (it '
      + 'starts with RC, BN or IT) and try again.'],
    [409, 'PROVIDER_CAC_PROFILE_INCOMPLETE', 'We couldn’t set up your organization from its CAC record. The record '
      + `is missing details we need, or it doesn’t show the company as active. Contact Health ID support at ${SUPPORT}, and give `
      + 'your CAC number.'],
    [409, 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'We can’t set up this organization by ourselves right now. Its CAC number may '
      + 'already be on Health ID, someone else may be signing it up, or Health ID support may have recently '
      + `closed a sign-up for it. Contact Health ID support at ${SUPPORT}, and give your CAC number.`],
    [409, 'ORGANIZATION_REVIEW_REQUIRED', 'Health ID must check this organization before it can be set up. For example, '
      + 'its CAC number may already be on Health ID, or someone else may be signing it up. Contact Health ID '
      + `support at ${SUPPORT}, and give your CAC number.`],
    [409, 'PROVIDER_ALREADY_REGISTERED', 'This organization is already on Health ID. If you are its administrator, '
      + `sign in instead. Contact Health ID support at ${SUPPORT}.`],
  ])('%s %s returns to CAC number with the words at the CAC field', async (status, code, words) => {
    const refused = deferred<unknown>()
    api.start.mockReturnValueOnce(refused.promise)
    await toReview()
    await submitRegistration()
    const shown = focusWhenShown(() => screen.queryByRole('heading', { level: 2, name: 'CAC number' }))
    answer(() => refused.reject(new HidApiError(status, 'Identity’s own words', { code })))
    const { element, focused } = await shown
    // Focus is on the step heading in the commit that shows it.
    expect(focused).toBe(element)
    actAgain()
    const cac = textbox('CAC number')
    expect(cac.getAttribute('aria-invalid')).toBe('true')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(words)
    expect(hintOf(cac)).toContain(words)
    expect(cac.value).toBe('RC123456')
    if (words.includes(SUPPORT)) expect(within(alert).getByRole('link', { name: SUPPORT }).getAttribute('href')).toBe(`mailto:${SUPPORT}`)
    // Correcting the number and coming back sends again, with a fresh security check.
    fireEvent.change(cac, { target: { value: 'RC654321' } })
    next(); await step('Product')
    next(); await step('Agreements')
    expect(screen.queryByRole('alert')).toBeNull()
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, cacRegistrationNumber: 'RC654321', turnstileToken: 'token-1' })
  })

  // Anything else stays where the registration was submitted, with the form as it was.
  it.each([
    [409, 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT', SIGN_OUT],
    [429, 'APPLICATION_RATE_LIMITED', 'Too many sign-up tries from your internet connection. Please try again later.'],
    [429, 'VERIFICATION_QUOTA_EXCEEDED', 'We can’t check more CAC numbers for now. Please try again later.'],
    [409, 'VERSION_CONFLICT', 'Your sign-up changed while we were working on it. Please try again.'],
    [403, 'ORIGIN_DENIED', 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_CONTEXT_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_HOSTNAME_MISMATCH', 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.'],
    [403, 'TURNSTILE_REJECTED', 'The security check didn’t work. Please do it again, then try again.'],
    [400, 'TURNSTILE_REQUIRED', 'The security check didn’t work. Please do it again, then try again.'],
    [403, 'PROVIDER_ENROLLMENT_DENIED', 'Facility sign-up isn’t working right now. Please try again in a few minutes.'],
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
    await screen.findByRole('heading', { level: 1, name: 'Facility details sent' })
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, turnstileToken: 'token-1' })
  })

  it('says so when the refusal is not Identity’s', async () => {
    api.start.mockRejectedValueOnce(new Error('script error'))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong with facility sign-up. Please try again.')
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
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t check your CAC number just now. '
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
    expect(screen.queryByRole('heading', { level: 1, name: 'Facility details sent' })).toBeNull()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different email' }))
    await step('Your account')
    next()
    await step('Facility type')
    fireEvent.change(combobox('Facility type'), { target: { value: 'clinic' } })
    for (const name of ['CAC number', 'Product', 'Agreements']) { next(); await step(name) }
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
    await screen.findByRole('heading', { level: 1, name: 'Enter the code we emailed you' })
    expect(document.querySelector('.hid-ehr-signup-lede')?.textContent).toBe(`We didn’t send a new code, because one was sent to `
      + `${EMAIL} less than a minute ago. Enter the six digit code from that email.`)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.start).toHaveBeenCalledTimes(2)
    fireEvent.change(textbox('Code from the email'), { target: { value: '111111' } })
    fireEvent.click(button('Check code'))
    await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
    expect(api.verify).toHaveBeenCalledWith('challenge-1', '111111')
  })
})

describe('another email for a sign-up that is open', () => {
  it('warns before sending, offers the first email, and says only it can finish the sign-up', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', resendAfterSeconds: 0 })
    await toReview()
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different email' }))
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
      + `sign-up started. Otherwise, contact Health ID support at ${SUPPORT}, and give your CAC number.`)
    // It is about the email, not the number: the registration stays where it was submitted.
    expect(stepHeading().textContent).toBe('Agreements')
    fireEvent.click(button('Use the email I first gave'))
    expect(screen.queryByText(/only that email can finish it/)).toBeNull()
    expect(document.querySelector('.hid-ehr-signup-facts')?.textContent).toContain(EMAIL)
  })
})
