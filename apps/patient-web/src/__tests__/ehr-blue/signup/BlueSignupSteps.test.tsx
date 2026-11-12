import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ORGANIZATION_TYPE_NOTES, organizationTypeNote } from '../../../staff/routes/ProviderEnrollment'
import { focusWhenShown } from '../../focusWhenShown'
import { security } from './signupFakes'
import {
  actAgain, answer, button, COLLECTED, combobox, deferred, EMAIL, expectFocusOnStep, fillAccountExtras, fillFacilityDetails,
  NAME, next, open, step, stepHeading, submitButton, submitRegistration, SUPPORT, TabChannel, textbox, toForm, toReview,
} from './signupHarness'

/**
 * The blue facility registration (design screens 02-07) as today's live sign-up: the design's five steps, every field
 * collected and required (hid-system 0114), the confirm dialog, and today's start with today's payload and the collected
 * fields, and today's refusals. Every person, facility and address here is fictional.
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

/** The hint a field's aria-describedby names. */
const hintOf = (control: HTMLElement) => (control.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
const progress = () => screen.getByRole('group', { name: 'Registration progress' })

/**
 * Today's start body (staff/routes/ProviderEnrollment.tsx:615-623, api.ts:1486-1494), and the applicant's role and phone
 * and the facility's details that hid-system 0114 requires with it: nothing more.
 */
const PAYLOAD = { productCode: 'ehr', organizationType: 'hospital', cacRegistrationNumber: 'RC123456', administratorName: NAME,
  administratorEmail: EMAIL, turnstileToken: 'token-0', ...COLLECTED }

describe('the registration opens as today’s page does', () => {
  it('asks once whether sign-up is open, then shows step 1 of 5 with the design’s progress', async () => {
    open()
    expect(screen.getByRole('status').textContent).toBe('Checking that facility sign-up is open…')
    expect(screen.getByRole('heading', { level: 1, name: 'Register your facility' })).toBeTruthy()
    await step('Your account')
    expect(api.availability).toHaveBeenCalledTimes(1)
    expect(within(progress()).getByText('Step 1 of 5 · Your account')).toBeTruthy()
    expect(within(progress()).getAllByRole('listitem').map(item => item.textContent)).toEqual(['1. Your account',
      '2. Facility details', '3. Regulatory identity', '4. Platform setup', '5. Check and send'])
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

  it('takes the applicant’s phone and role, required, and the password as chosen after the email is confirmed', async () => {
    await toForm()
    for (const control of [textbox('Your phone'), combobox('Role at the facility')]) {
      expect(control.disabled).toBe(false)
      expect(control.required).toBe(true)
    }
    expect(textbox('Your phone').type).toBe('tel')
    expect(document.body.textContent).not.toContain('Not collected by Health ID yet')
    expect([...combobox('Role at the facility').options].map(option => [option.value, option.text])).toEqual([['', 'Select…'],
      ['owner', 'Owner'], ['medical_director', 'Medical Director'], ['administrator', 'Administrator'],
      ['other_authorised_representative', 'Other authorised representative']])
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
    expect(screen.getAllByText('This field is required.')).toHaveLength(3)
    expect(screen.getByText('Choose your role at the facility.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('Full name'))
    expect(textbox('Full name').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Your phone'), { target: { value: '12345' } })
    fireEvent.change(textbox('Email'), { target: { value: 'not-an-email' } })
    next()
    expect(screen.getByText('Enter a phone number, for example 0803 123 4567 or +234 803 123 4567.')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('Your phone'))
    expect(stepHeading().textContent).toBe('Your account')
    fireEvent.change(textbox('Full name'), { target: { value: ' D ' } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    fillAccountExtras()
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
    fillAccountExtras()
    next()
    await expectFocusOnStep('Facility details')
    expect(within(progress()).getByText('Step 2 of 5 · Facility details')).toBeTruthy()
    fillFacilityDetails()
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
  it('takes today’s five facility types, Hospital first, and every other design field as a required input', async () => {
    await toReview()
    fireEvent.click(button('Edit facility details'))
    await step('Facility details')
    const type = combobox('Facility type')
    expect([...type.options].map(option => [option.value, option.text])).toEqual([['hospital', 'Hospital'],
      ['clinic', 'Clinic'], ['laboratory', 'Laboratory'], ['pharmacy', 'Pharmacy'], ['other', 'Other healthcare provider']])
    expect(type.value).toBe('hospital')
    expect(hintOf(textbox('Facility name (the name people use)'))).toBe('Your registered name comes from your CAC record. '
      + 'Enter the name patients know you by, even if it is the same.')
    for (const name of ['Facility name (the name people use)', 'Address', 'City or town', 'Local government area',
      'GPS latitude', 'GPS longitude', 'Facility phone', 'Facility email', 'Bed count', 'Operating hours', 'Services offered']) {
      expect(textbox(name).disabled).toBe(false)
      expect(textbox(name).required).toBe(true)
      expect(textbox(name).value).not.toBe('')
    }
    for (const name of ['Ownership', 'Level of care', 'State', '24-hour emergency']) {
      expect(combobox(name).required).toBe(true)
    }
    // The 37 states as Identity keeps them, the FCT by its full and short names, sent as FC.
    const states = [...combobox('State').options].slice(1)
    expect(states).toHaveLength(37)
    expect(states.find(option => option.value === 'FC')?.text).toBe('Federal Capital Territory (FCT)')
    const departments = screen.getByRole('group', { name: 'Departments' })
    expect(within(departments).getAllByRole('checkbox')).toHaveLength(15)
    expect((within(departments).getByRole('checkbox', { name: 'Laboratory' }) as HTMLInputElement).checked).toBe(true)
    // Nothing on the step is shown disabled or said not to be collected.
    expect(document.body.textContent).not.toContain('Not collected by Health ID yet')
  })

  it('stops Continue at each missing or wrong facility detail, in plain words, and focuses the first', async () => {
    await toForm()
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    fillAccountExtras()
    next()
    await step('Facility details')
    next()
    expect(document.activeElement).toBe(textbox('Facility name (the name people use)'))
    expect(screen.getByText('Choose who owns the facility.')).toBeTruthy()
    expect(screen.getByText('Choose at least one department.')).toBeTruthy()
    fillFacilityDetails()
    fireEvent.change(textbox('GPS latitude'), { target: { value: '20' } })
    fireEvent.change(textbox('Facility email'), { target: { value: 'not-an-email' } })
    next()
    expect(screen.getByText('Enter a latitude between 4 and 14, with up to six decimal places.')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(document.activeElement).toBe(textbox('GPS latitude'))
    expect(stepHeading().textContent).toBe('Facility details')
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
  it('takes the CAC number as today’s field does, with today’s fine print, the rest as required inputs, and no uploads', async () => {
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
    for (const name of ['State Ministry of Health licence number', 'Medical Director’s full name',
      'Medical Director’s MDCN number', 'NHIA accreditation number']) {
      expect(textbox(name).required).toBe(true)
      expect(textbox(name).disabled).toBe(false)
    }
    // A registry ID is asked for only once the facility says it has one.
    expect(screen.queryByRole('textbox', { name: 'National facility registry ID' })).toBeNull()
    fireEvent.change(combobox('Does the facility have a national facility registry ID?'), { target: { value: 'yes' } })
    expect(textbox('National facility registry ID').required).toBe(true)
    // The uploads wait for the document store and its virus scanner: not shown at all, not even disabled.
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0)
    expect(screen.queryByText(/Operating licence|CAC certificate|Proof of address/)).toBeNull()
  })

  it('needs the registry ID once the facility says it has one, and an MDCN number in the licence format', async () => {
    await toReview()
    fireEvent.click(button('Edit regulatory identity'))
    await step('Regulatory identity')
    fireEvent.change(combobox('Does the facility have a national facility registry ID?'), { target: { value: 'yes' } })
    fireEvent.change(textbox('Medical Director’s MDCN number'), { target: { value: '#' } })
    next()
    expect(document.activeElement).toBe(textbox('National facility registry ID'))
    expect(screen.getByText('Enter the MDCN number as it is written, using letters, digits, /, . or -, for example MDCN/12345.'))
      .toBeTruthy()
    expect(stepHeading().textContent).toBe('Regulatory identity')
  })

  it('offers a Medical Director signing up their own name as the Medical Director’s', async () => {
    await toForm()
    fireEvent.change(textbox('Full name'), { target: { value: NAME } })
    fireEvent.change(combobox('Role at the facility'), { target: { value: 'medical_director' } })
    fireEvent.change(textbox('Your phone'), { target: { value: '08031234567' } })
    fireEvent.change(textbox('Email'), { target: { value: EMAIL } })
    next()
    await step('Facility details')
    fillFacilityDetails()
    next()
    await step('Regulatory identity')
    expect(textbox('Medical Director’s full name').value).toBe(NAME)
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
    for (const name of ['Will you bring records from an older system?', 'Do you need to exchange records with other systems?']) {
      expect(combobox(name).required).toBe(true)
      expect(combobox(name).value).not.toBe('')
    }
    expect(textbox('Expected number of staff').value).toBe('25')
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

describe('step 5, Check and send', () => {
  it('reviews each section with its Edit, and lists every value given', async () => {
    await toReview({ product: 'migrate' })
    expect(within(progress()).getByText('Step 5 of 5 · Check and send')).toBeTruthy()
    const facts = [...document.querySelectorAll('.hid-ehr-signup-facts > div')].map(row => row.textContent)
    expect(facts).toEqual([`Full name${NAME}`, 'Your phone+2348031234567', `Email${EMAIL}`, 'Role at the facilityOwner',
      'Facility name (the name people use)Demo Hospital', 'Facility typeHospital', 'OwnershipPrivate', 'Level of careSecondary',
      'Address1 Example Road', 'City or townIkeja', 'StateLagos', 'Local government areaIkeja', 'GPS latitude6.601234',
      'GPS longitude3.351234', 'Facility phone+23412345678', 'Facility emaildesk@demo-hospital.example.test', 'Bed count40',
      'Operating hoursMon-Sun 24 hours', '24-hour emergencyYes', 'DepartmentsGeneral Outpatient, Laboratory',
      'Services offeredOutpatient care and laboratory tests',
      'State Ministry of Health licence numberLA/SMOH/1234', 'Does the facility have a national facility registry ID?No',
      'CAC registration numberRC123456', 'Medical Director’s full nameDr Demo Director',
      'Medical Director’s MDCN numberMDCN/12345', 'Is the facility accredited by the NHIA?Yes',
      'NHIA accreditation numberNHIA-1234',
      'Expected number of staff25', 'ProductHealth ID Migrate', 'Will you bring records from an older system?No',
      'Do you need to exchange records with other systems?Yes'])
    fireEvent.click(button('Edit your account'))
    await expectFocusOnStep('Your account')
  })

  // Parity report 3.2: the start has no field for an agreement, so Health ID cannot record one. The page draws no box
  // that blocks Submit and is then forgotten; it shows the two documents beside Submit instead.
  it('has no agreement boxes, and links the Terms of Service and Privacy Policy beside Submit', async () => {
    await toReview()
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    // Nor is the step named for agreements it no longer asks for: no heading or step in the progress says so.
    expect(screen.queryAllByRole('heading', { name: /agreement/i })).toEqual([])
    expect(progress().textContent).not.toMatch(/agreement/i)
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

  it('no longer waits for any box: Submit is ready with the security check, and sends today’s payload and the collected fields', async () => {
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
    expect(stepHeading().textContent).toBe('Check and send')
  })

  it('runs today’s start once with today’s payload and the collected fields, then says the registration is submitted', async () => {
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

  it('sends the type, product and changed phone chosen, and never an upload or logo', async () => {
    await toReview({ type: 'clinic', product: 'pharmacy' })
    fireEvent.click(button('Edit your account'))
    await step('Your account')
    fireEvent.change(textbox('Your phone'), { target: { value: '0801 234 5678' } })
    for (let index = 0; index < 4; index++) next()
    await step('Check and send')
    await submitRegistration()
    await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
    expect(api.start).toHaveBeenCalledWith({ ...PAYLOAD, organizationType: 'clinic', productCode: 'pharmacy',
      administratorPhone: '+2348012345678' })
    expect(JSON.stringify(api.start.mock.calls)).not.toMatch(/logo|licence"|certificate|proofOfAddress|allerg/i)
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
    next(); await step('Check and send')
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
    [409, 'SOMETHING_NEW', 'We couldn’t complete facility sign-up. Please try again.'],
  ])('%s %s stays on Check and send with today’s words', async (status, code, words) => {
    api.start.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own words', { code }))
    await toReview()
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(document.body.textContent).not.toContain('Identity’s own words')
    expect(stepHeading().textContent).toBe('Check and send')
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
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t complete facility sign-up. Please try again.')
    expect(document.body.textContent).not.toContain('script error')
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
    expect(screen.queryByRole('heading', { level: 2, name: 'Check and send' })).toBeNull()
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
    expect(stepHeading().textContent).toBe('Check and send')
    expect(screen.queryByRole('heading', { level: 1, name: 'Facility registration submitted' })).toBeNull()
  })
})

/**
 * A changed facility type or administrator name, or changed collected details (hid-system 0114), go only with a new code
 * (R6): when Identity sends none (codeSent false) and the code in force carries the earlier ones, today's page holds the change and offers that code
 * (ProviderEnrollment.tsx:726-735, 1058-1064). The blue registration shows it on Check and send.
 */
describe('a changed facility type that Identity sent no code for', () => {
  it('stays on Check and send, says the change was not applied, waits, and offers the code already sent', async () => {
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
    for (const name of ['Regulatory identity', 'Platform setup', 'Check and send']) { next(); await step(name) }
    expect(screen.queryByText(/^Changed details take effect/)).toBeNull()

    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 590,
      resendAfterSeconds: 45 })
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(`We didn’t send a new code, because one was sent to ${EMAIL} less `
      + 'than a minute ago, so your changes haven’t been applied.')
    expect(api.start).toHaveBeenCalledTimes(2)
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, organizationType: 'clinic', turnstileToken: 'token-1' })
    // Not the code: its code would register a hospital.
    expect(stepHeading().textContent).toBe('Check and send')
    expect(screen.getByText(/^Changed details take effect/).textContent).toBe('Changed details take effect only with a new '
      + 'code. The code already sent is for the details you gave before: the facility type Hospital, with '
      + `${NAME} as administrator.`)
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
    await step('Check and send')
    expect(screen.getByText(`A sign-up for RC123456 was started with ${EMAIL}, and only that email can finish it until 24 hours `
      + 'after it started. You can still correct the CAC number.')).toBeTruthy()

    api.start.mockRejectedValueOnce(new HidApiError(409, 'Requires review', { code: 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' }))
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toBe(`This CAC number’s sign-up was started with ${EMAIL}, so it can’t `
      + `use another email yet. Finish it with the code sent to ${EMAIL}, or sign up with the new email 24 hours after the first `
      + `sign-up started. Otherwise, contact Health ID support at ${SUPPORT}, and give your CAC registration number.`)
    // It is about the email, not the number: the registration stays where it was submitted.
    expect(stepHeading().textContent).toBe('Check and send')
    fireEvent.click(button('Use the email I first gave'))
    expect(screen.queryByText(/only that email can finish it/)).toBeNull()
    expect(document.querySelector('.hid-ehr-signup-facts')?.textContent).toContain(EMAIL)
  })
})

describe('changed facility details that Identity sent no code for (hid-system 0114)', () => {
  it('holds them as a changed type is held, and the code already sent brings back the details it carries', async () => {
    api.start.mockResolvedValueOnce({ accepted: true, codeSent: true, challengeId: 'challenge-1', expiresInSeconds: 600,
      resendAfterSeconds: 0 })
    await toReview()
    await submitRegistration()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change unverified email' }))
    await step('Your account')
    next()
    await step('Facility details')
    fireEvent.change(textbox('Bed count'), { target: { value: '55' } })
    for (const name of ['Regulatory identity', 'Platform setup', 'Check and send']) { next(); await step(name) }

    api.start.mockResolvedValueOnce({ accepted: true, codeSent: false, challengeId: 'challenge-1', expiresInSeconds: 590,
      resendAfterSeconds: 45 })
    await submitRegistration()
    expect((await screen.findByRole('alert')).textContent).toContain('so your changes haven’t been applied.')
    expect(api.start).toHaveBeenLastCalledWith({ ...PAYLOAD, turnstileToken: 'token-1',
      facilityProfile: { ...COLLECTED.facilityProfile, bedCount: 55 } })
    expect(screen.getByText(/^Changed details take effect/)).toBeTruthy()
    fireEvent.click(button('Use the details I gave before'))
    await screen.findByRole('heading', { level: 1, name: 'Enter your verification code' })
    fireEvent.click(button('Change unverified email'))
    await step('Your account')
    next()
    await step('Facility details')
    expect(textbox('Bed count').value).toBe('40')
  })
})
