import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { googleProfileOf } from '../routes/enrollment/googleProfile'
import { described, json, press, problem, renderPortal, type Handler } from './portalHarness'
import { enterCode } from './codeBoxes'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
/** Google's button, standing in: pressing it hands the page the credential the test chose. */
let googleCredential = ''
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, text }: { onCredential: (token: string) => Promise<void>; text: string }) =>
    <button type="button" onClick={() => void onCredential(googleCredential)}>{text === 'continue_with' ? 'Continue with Google' : 'Sign up with Google'}</button>,
}))

afterEach(() => { vi.unstubAllEnvs(); googleCredential = '' })

const BASE = '/identity/patient-enrollments'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const SERVED = { open: true, online: true, facility: false, signup: true }
const PROGRESS = { stage: 'verify_contact', contactChannel: 'email', maskedContact: 'a•••@example.com', challengeId: 'challenge-1',
  expiresInSeconds: 600, resendAfterSeconds: 0, expiresAt: '2026-10-28T10:00:00.000Z' }
const PASSWORD = 'correct horse battery'

/** Identity serving the sign-up: no registration in progress, and `other` for every other request. */
function gateway(other: Handler, availability: unknown = SERVED): Handler {
  return (path, method, body) => {
    if (path === `${BASE}/availability` && method === 'GET') return json(availability)
    if (path === `${BASE}/current`) return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    return other(path, method, body)
  }
}
/** Each step answered as Identity would, the activation with this Health ID. */
const happy: Handler = (path, method) => {
  if (path === `${BASE}/signup` && method === 'POST') return json(PROGRESS)
  if (path === `${BASE}/contact` && method === 'POST') return json({ challengeId: 'challenge-2', expiresInSeconds: 600, resendAfterSeconds: 0 })
  if (path === `${BASE}/contact/verify` && method === 'POST') return json({ stage: 'set_password', requiredProfileFields: [] })
  if (path === `${BASE}/activate` && method === 'POST') return json({ stage: 'active', hidCode: 'HID-NEW234' })
  return problem(500, 'UNEXPECTED', `${method} ${path}`)
}

const field = (name: string) => screen.getByLabelText(name, { selector: 'input, select' })
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })

async function fillDetails({ email = 'ada@example.com', phone = '0801 234 5678' } = {}) {
  await screen.findByRole('heading', { name: 'Your details' })
  type('First name', 'Ada'); type('Last name', 'Obi'); type('Email address', email); type('Phone number', phone)
  fireEvent.change(field('Gender'), { target: { value: 'female' } })
  type('Hospital you currently use (optional)', 'Lagos General')
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to the Terms of Service and Privacy Policy' }))
}
async function toPassword() {
  await fillDetails()
  await press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Create a secure password' })
}
async function sendPassword(password = PASSWORD, confirm = password) {
  type('Password', password); type('Confirm password', confirm)
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Create account' }))
}
/** An unsigned ID token with this payload, as Google's button hands it over. */
const idToken = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

describe('the sign-up without a NIN (owner decision, 2026-10-27)', () => {
  it('asks for the details, a password, then the email code, and shows the Health ID', async () => {
    const { sent, headers } = renderPortal(<Enrollment />, gateway(happy), anonymous)

    expect(await screen.findByRole('list', { name: 'Sign-up steps' })).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('https://healthidentitydirectory.com/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('https://healthidentitydirectory.com/privacy')
    await toPassword()
    expect(document.activeElement).toBe(field('Password'))
    await sendPassword()

    const codeField = await screen.findByLabelText('Verification code')
    expect(document.activeElement).toBe(codeField)
    expect(described(codeField)).toContain('We sent a 6-digit code to a•••@example.com.')
    const signup = sent.find(request => request.path === `${BASE}/signup`)
    expect(signup?.body).toEqual({ firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08012345678', gender: 'female',
      hospitalCurrentlyUsing: 'Lagos General', termsAccepted: true, turnstileToken: 'turnstile-token', turnstileAction: 'patient-enrollment' })
    expect(headers.find(request => request.path === `${BASE}/signup`)?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)

    await enterCode(codeField, '123456')

    const ready = await screen.findByRole('heading', { name: 'Your Health ID is ready.' })
    await waitFor(() => expect(document.activeElement).toBe(ready))
    expect(screen.getByText('HID-NEW234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in to continue' }).getAttribute('href')).toBe('/sign-in')
    expect(sent.find(request => request.path === `${BASE}/contact/verify`)?.body).toEqual({ challengeId: 'challenge-1', code: '123456' })
    expect(sent.find(request => request.path === `${BASE}/activate`)?.body).toEqual({ password: PASSWORD })
    expect(screen.queryByRole('list', { name: 'Sign-up steps' })).toBeNull()
  })

  it('marks each detail that is missing or invalid, with focus on the first, and sends nothing', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(happy), anonymous)
    await screen.findByRole('heading', { name: 'Your details' })
    type('First name', 'Ada'); type('Email address', 'not-an-email'); type('Phone number', '12')

    await press(screen.getByRole('button', { name: 'Continue' }))

    const lastName = field('Last name')
    expect(document.activeElement).toBe(lastName)
    expect(lastName.getAttribute('aria-invalid')).toBe('true')
    expect(described(lastName)).toBe('Enter your last name.')
    expect(field('First name').getAttribute('aria-invalid')).toBeNull()
    expect(described(field('Email address'))).toContain('Enter a valid email address, like name@example.com.')
    expect(described(field('Phone number'))).toContain('Enter a valid phone number')
    expect(described(field('Gender'))).toBe('Select your gender.')
    expect(described(screen.getByRole('checkbox', { name: 'I agree to the Terms of Service and Privacy Policy' })))
      .toBe('Agree to the Terms of Service and Privacy Policy to create an account.')
    expect(screen.queryByRole('heading', { name: 'Create a secure password' })).toBeNull()
    expect(sent.filter(request => request.method === 'POST')).toEqual([])

    // A field's mark goes once it is changed.
    type('Last name', 'Obi')
    expect(field('Last name').getAttribute('aria-invalid')).toBeNull()
  })

  it('needs a password of at least 12 characters, typed twice, and the security check', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(happy), anonymous)
    await toPassword()
    expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Complete the security check to continue.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    type('Password', 'too short'); type('Confirm password', 'too short')
    await press(screen.getByRole('button', { name: 'Create account' }))
    expect(document.activeElement).toBe(field('Password'))
    expect(described(field('Password'))).toContain('Choose a password of at least 12 characters.')
    expect(field('Password').getAttribute('aria-invalid')).toBe('true')

    type('Password', PASSWORD); type('Confirm password', `${PASSWORD}!`)
    await press(screen.getByRole('button', { name: 'Create account' }))
    expect(document.activeElement).toBe(field('Confirm password'))
    expect(described(field('Confirm password'))).toBe('Type the same password again.')
    expect(sent.filter(request => request.method === 'POST')).toEqual([])

    // Back keeps what was typed.
    await press(screen.getByRole('button', { name: 'Back' }))
    expect((field('First name') as HTMLInputElement).value).toBe('Ada')
  })

  it('offers Female, Male and Other, as hid-1.0 did, and sends Other as Identity takes it', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(happy), anonymous)
    await fillDetails()
    const gender = field('Gender') as HTMLSelectElement
    expect([...gender.options].map(option => [option.value, option.textContent])).toEqual([['', 'Select…'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']])
    fireEvent.change(gender, { target: { value: 'other' } })
    await press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Create a secure password' })
    await sendPassword()
    await screen.findByLabelText('Verification code')
    expect(sent.find(request => request.path === `${BASE}/signup`)?.body).toMatchObject({ gender: 'other' })
  })

  it('sends the code again to the same email, and says a wrong code at its field', async () => {
    let verify = () => problem(422, 'OTP_INVALID', 'The code is invalid or expired')
    const { sent } = renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/contact/verify` ? verify() : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()
    const codeField = await screen.findByLabelText('Verification code')

    await press(screen.getByRole('button', { name: 'Send code again' }))
    expect(sent.find(request => request.path === `${BASE}/contact`)?.body).toEqual({ channel: 'email', contact: 'ada@example.com' })
    expect(await screen.findByText('A new code was sent to a•••@example.com.')).toBeTruthy()

    await enterCode(codeField, '000000')
    await waitFor(() => expect(codeField.getAttribute('aria-invalid')).toBe('true'))
    expect(described(codeField)).toContain('That code is wrong or has expired. Check the latest email, or send a new code.')
    // The new code's challenge is the one checked.
    expect(sent.find(request => request.path === `${BASE}/contact/verify`)?.body).toEqual({ challengeId: 'challenge-2', code: '000000' })

    // A code corrected after a refusal is sent with the button, not by itself: a slip spends no other try.
    verify = () => json({ stage: 'set_password' })
    fireEvent.change(codeField, { target: { value: '654321' } })
    expect(sent.filter(request => request.path === `${BASE}/contact/verify`)).toHaveLength(1)
    await press(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('HID-NEW234')).toBeTruthy()
  })

  it('waits before another code while Identity says one was sent recently', async () => {
    renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/signup`
      ? json({ ...PROGRESS, resendAfterSeconds: 60 }) : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()
    await screen.findByLabelText('Verification code')
    const again = screen.getByRole('button', { name: 'Send code again' }) as HTMLButtonElement
    expect(again.disabled).toBe(true)
    expect(described(again)).toBe('A new code can be sent 60 seconds after the last one.')
  })

  it('says an email already registered at its field, with a way to sign in, back on the details', async () => {
    renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/signup`
      ? problem(409, 'PATIENT_EMAIL_ALREADY_REGISTERED', 'This email address already has a Health ID account. Sign in instead.')
      : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()

    await screen.findByRole('heading', { name: 'Your details' })
    const email = field('Email address')
    await waitFor(() => expect(document.activeElement).toBe(email))
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(described(email)).toContain('This email address already has a Health ID account. Sign in instead.')
    const error = document.getElementById('signup-email-error')!
    expect(within(error).getByRole('link', { name: 'Sign in instead.' }).getAttribute('href')).toBe('/sign-in')
    expect((field('First name') as HTMLInputElement).value).toBe('Ada')
  })

  it('says a phone number already registered at its field', async () => {
    renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/signup`
      ? problem(409, 'PATIENT_PHONE_ALREADY_REGISTERED', 'This phone number already has a Health ID account.')
      : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()
    const phone = await waitFor(() => field('Phone number'))
    await waitFor(() => expect(document.activeElement).toBe(phone))
    expect(described(phone)).toContain('This phone number already has a Health ID account.')
  })

  it('marks the fields Identity refused (400 VALIDATION_FAILED) on the details', async () => {
    renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/signup`
      ? json({ type: 'about:blank', title: 'VALIDATION_FAILED', status: 400, code: 'VALIDATION_FAILED', detail: 'One or more request fields are invalid.',
        errors: [{ field: 'phone', messages: ['phone must match'] }] }, 400)
      : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()
    const phone = await waitFor(() => field('Phone number'))
    expect(phone.getAttribute('aria-invalid')).toBe('true')
    expect(field('Email address').getAttribute('aria-invalid')).toBeNull()
  })

  it('says a refused security check on the password step, and asks for a new check', async () => {
    renderPortal(<Enrollment />, gateway((path, method, body) => path === `${BASE}/signup`
      ? problem(403, 'TURNSTILE_FAILED', 'The security check failed. Try again.') : happy(path, method, body)), anonymous)
    await toPassword()
    await sendPassword()
    expect((await screen.findByRole('alert')).textContent).toBe('The security check failed. Try again.')
    expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fills in the name and email from Google, with nothing sent for it', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    googleCredential = idToken({ given_name: 'Adaeze', family_name: 'Okafor', name: 'Adaeze Okafor', email: 'adaeze@gmail.com' })
    const { sent } = renderPortal(<Enrollment />, gateway(happy), anonymous)
    await screen.findByRole('heading', { name: 'Your details' })

    await press(screen.getByRole('button', { name: 'Continue with Google' }))

    expect((field('First name') as HTMLInputElement).value).toBe('Adaeze')
    expect((field('Last name') as HTMLInputElement).value).toBe('Okafor')
    expect((field('Email address') as HTMLInputElement).value).toBe('adaeze@gmail.com')
    expect(screen.getByText('Google details added. Check them and complete the form to continue.')).toBeTruthy()
    expect(sent.filter(request => request.method === 'POST')).toEqual([])
    expect(sent.some(request => request.path.startsWith('/auth/oidc'))).toBe(false)
  })

  it('shows the NIN-first enrollment, as before, while availability does not say signup: true', async () => {
    renderPortal(<Enrollment />, gateway(happy, { open: true, online: true, facility: false }), anonymous)
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your details' })).toBeNull()
    expect(screen.getByRole('list', { name: 'Enrollment steps' })).toBeTruthy()
  })

  it('says registration is not open, as before, when availability is closed even with signup: true', async () => {
    renderPortal(<Enrollment />, gateway(happy, { open: false, signup: true }), anonymous)
    expect(await screen.findByRole('region', { name: 'Registration is not open yet' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your details' })).toBeNull()
  })
})

describe('reading a Google credential (googleProfileOf)', () => {
  it('takes the given and family names, or splits the full name, and the email', () => {
    expect(googleProfileOf(idToken({ given_name: 'Ada', family_name: 'Obi', email: 'a@example.com' })))
      .toEqual({ firstName: 'Ada', lastName: 'Obi', email: 'a@example.com' })
    expect(googleProfileOf(idToken({ name: 'Chinonso Ada Obi', email: 'c@example.com' })))
      .toEqual({ firstName: 'Chinonso', lastName: 'Ada Obi', email: 'c@example.com' })
    expect(googleProfileOf(idToken({ given_name: 'Ọlá', family_name: 'Àdìsá' }))).toEqual({ firstName: 'Ọlá', lastName: 'Àdìsá', email: '' })
  })

  it('reads nothing from a token that is not a JWT', () => {
    expect(googleProfileOf('not-a-token')).toBeNull()
    expect(googleProfileOf('a.%%%.c')).toBeNull()
  })
})
