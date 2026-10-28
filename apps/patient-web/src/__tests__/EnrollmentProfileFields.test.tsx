import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { described, json, press, problem, renderPortal, type Handler } from './portalHarness'
import { enterCode } from './codeBoxes'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

const anonymous = { state: { status: 'anonymous', principal: null } } as const
const ACTIVATE = '/identity/patient-enrollments/activate'
const PASSWORD = 'a-long-enough-password'

afterEach(() => { vi.restoreAllMocks() })

/** Identity at the password step, answering /current with `current` and activation with `activate`. */
function gateway(current: () => Response, activate: Handler = () => json({ stage: 'active', hidCode: 'HID-ABCDEF23' }), other: Handler = (path, method) =>
  problem(500, 'UNEXPECTED', `${method} ${path}`)): Handler {
  return (path, method, body) => {
    if (path === '/identity/patient-enrollments/availability') return json({ open: true })
    if (path === '/identity/patient-enrollments/current') return current()
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === ACTIVATE && method === 'POST') return activate(path, method, body)
    return other(path, method, body)
  }
}
const atPassword = (requiredProfileFields?: string[]) => () => json({ stage: 'set_password',
  ...(requiredProfileFields ? { requiredProfileFields } : {}) })
const activations = (sent: Array<{ path: string; method: string; body: unknown }>) => sent.filter(request => request.path === ACTIVATE)
const activateButton = () => screen.getByRole('button', { name: 'Activate Health ID' }) as HTMLButtonElement
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * hid-system ADR-061 (on main since #82, migration 0092): a NIN record may lack a
 * date of birth or gender. Every progress answer before activation names what it
 * lacks in `requiredProfileFields` (`dateOfBirth`, `gender`, in that order), and
 * `POST .../activate` takes `{ password, dateOfBirth?, gender? }`. The page sent
 * only the password, so such a record got `400 ENROLLMENT_PROFILE_REQUIRED` at
 * every try and could not activate.
 */
describe('a NIN record without a date of birth or gender (ADR-061)', () => {
  it('asks for both on the password step and sends them with the password', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { sent } = renderPortal(<Enrollment />, gateway(atPassword(['dateOfBirth', 'gender'])), anonymous)

    const dob = await screen.findByLabelText('Date of birth') as HTMLInputElement
    expect(dob.type).toBe('date')
    expect(dob.min).toBe('1900-01-01')
    expect(dob.max).toBe(today())
    const gender = screen.getByLabelText('Gender') as HTMLSelectElement
    expect([...gender.options].map(option => option.value)).toEqual(['', 'female', 'male', 'intersex', 'other', 'unknown'])
    expect(described(dob)).toContain('Your NIN record does not include your date of birth or gender')

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
    // The button says why it waits.
    expect(activateButton().disabled).toBe(true)
    expect(described(activateButton())).toBe('Enter your date of birth and gender to activate.')
    fireEvent.change(dob, { target: { value: '1990-02-03' } })
    fireEvent.change(gender, { target: { value: 'intersex' } })
    expect(activateButton().disabled).toBe(false)
    expect(activateButton().getAttribute('aria-describedby')).toBeNull()

    await press(activateButton())
    expect(await screen.findByText('HID-ABCDEF23')).toBeTruthy()
    expect(activations(sent).map(request => request.body)).toEqual([{ password: PASSWORD, dateOfBirth: '1990-02-03', gender: 'intersex' }])
    expect(setItem).not.toHaveBeenCalled()
  })

  it('asks only for what the record lacks, and sends only that', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(atPassword(['gender'])), anonymous)
    fireEvent.change(await screen.findByLabelText('Gender'), { target: { value: 'female' } })
    expect(screen.queryByLabelText('Date of birth')).toBeNull()
    expect(described(screen.getByLabelText('Gender'))).toContain('Your NIN record does not include your gender')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
    await press(activateButton())
    await screen.findByText('HID-ABCDEF23')
    expect(activations(sent).map(request => request.body)).toEqual([{ password: PASSWORD, gender: 'female' }])
  })

  it.each<[string, string[] | undefined]>([
    ['names none', []],
    ['is from an Identity before ADR-061', undefined],
  ])('sends only the password when the record %s', async (_case, fields) => {
    const { sent } = renderPortal(<Enrollment />, gateway(atPassword(fields)), anonymous)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
    expect(screen.queryByLabelText('Date of birth')).toBeNull()
    expect(screen.queryByLabelText('Gender')).toBeNull()
    await press(activateButton())
    await screen.findByText('HID-ABCDEF23')
    expect(activations(sent).map(request => request.body)).toEqual([{ password: PASSWORD }])
  })

  it('carries the fields named by the contact proof to the password step', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ stage: 'verify_contact', challengeId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a',
      maskedContact: 'a•••@example.com', requiredProfileFields: [] }), undefined, (path, method) =>
      path === '/identity/patient-enrollments/contact/verify' && method === 'POST'
        ? json({ stage: 'set_password', requiredProfileFields: ['dateOfBirth'] })
        : problem(500, 'UNEXPECTED', `${method} ${path}`)), anonymous)
    await enterCode(await screen.findByLabelText('Verification code'), '123456')
    const dob = await screen.findByLabelText('Date of birth')
    await waitFor(() => expect(document.activeElement).toBe(dob))
    expect(screen.queryByLabelText('Gender')).toBeNull()
  })

  it('refuses a date outside 1900 to today before sending it, at the field', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(atPassword(['dateOfBirth'])), anonymous)
    const dob = await screen.findByLabelText('Date of birth')
    fireEvent.change(dob, { target: { value: '1899-12-31' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
    await press(activateButton())
    await waitFor(() => expect(dob.getAttribute('aria-invalid')).toBe('true'))
    expect(described(dob)).toContain('Enter a real date of birth. It cannot be before 1 January 1900 or in the future.')
    expect(document.activeElement).toBe(dob)
    expect(activations(sent)).toEqual([])
  })

  it('shows 400 DATE_OF_BIRTH_INVALID at the date field, not the password', async () => {
    const detail = 'Enter a real date of birth. It cannot be before 1 January 1900 or in the future.'
    renderPortal(<Enrollment />, gateway(atPassword(['dateOfBirth', 'gender']), () => problem(400, 'DATE_OF_BIRTH_INVALID', detail)), anonymous)
    const dob = await screen.findByLabelText('Date of birth')
    // A date the browser accepts and Identity refuses: today here, already tomorrow for Identity's UTC check, say.
    fireEvent.change(dob, { target: { value: '1990-02-03' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'male' } })
    const password = screen.getByLabelText('Password')
    fireEvent.change(password, { target: { value: PASSWORD } })
    await press(activateButton())
    await waitFor(() => expect(dob.getAttribute('aria-invalid')).toBe('true'))
    expect(described(dob)).toContain(detail)
    expect(document.activeElement).toBe(dob)
    expect(password.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText('Gender').getAttribute('aria-invalid')).toBeNull()
    // Read where focus is, not also as an alert.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads the fields again on 400 ENROLLMENT_PROFILE_REQUIRED, and asks for them at the field', async () => {
    let current = atPassword([])
    const { sent } = renderPortal(<Enrollment />, gateway(() => current(), (_path, _method, body) =>
      (body as { gender?: string }).gender ? json({ stage: 'active', hidCode: 'HID-ABCDEF23' })
        : problem(400, 'ENROLLMENT_PROFILE_REQUIRED', 'Enter your gender')), anonymous)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
    current = atPassword(['gender'])
    await press(activateButton())

    const gender = await screen.findByLabelText('Gender')
    await waitFor(() => expect(document.activeElement).toBe(gender))
    expect(gender.getAttribute('aria-invalid')).toBe('true')
    expect(described(gender)).toContain('Enter your gender')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(PASSWORD)

    fireEvent.change(gender, { target: { value: 'other' } })
    await press(activateButton())
    await screen.findByText('HID-ABCDEF23')
    expect(activations(sent).map(request => request.body)).toEqual([{ password: PASSWORD }, { password: PASSWORD, gender: 'other' }])
  })

  it('reads the fields again on 400 ENROLLMENT_PROFILE_FIELD_VERIFIED, and stops sending the one the record gives', async () => {
    const detail = 'Your date of birth comes from your NIN record and cannot be changed here'
    let current = atPassword(['dateOfBirth', 'gender'])
    const { sent } = renderPortal(<Enrollment />, gateway(() => current(), (_path, _method, body) =>
      (body as { dateOfBirth?: string }).dateOfBirth ? problem(400, 'ENROLLMENT_PROFILE_FIELD_VERIFIED', detail)
        : json({ stage: 'active', hidCode: 'HID-ABCDEF23' })), anonymous)
    fireEvent.change(await screen.findByLabelText('Date of birth'), { target: { value: '1990-02-03' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'female' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
    current = atPassword(['gender'])
    await press(activateButton())

    await waitFor(() => expect(screen.queryByLabelText('Date of birth')).toBeNull())
    const gender = screen.getByLabelText('Gender') as HTMLSelectElement
    expect(gender.value).toBe('female')
    expect(screen.getByRole('alert').textContent).toBe(detail)
    await press(activateButton())
    await screen.findByText('HID-ABCDEF23')
    expect(activations(sent).map(request => request.body)).toEqual([
      { password: PASSWORD, dateOfBirth: '1990-02-03', gender: 'female' }, { password: PASSWORD, gender: 'female' }])
  })

  it('does not keep the date of birth or gender once activated', async () => {
    renderPortal(<Enrollment />, gateway(atPassword(['dateOfBirth', 'gender'])), anonymous)
    fireEvent.change(await screen.findByLabelText('Date of birth'), { target: { value: '1990-02-03' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'female' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
    await press(activateButton())
    const ready = await screen.findByRole('heading', { name: 'Your Health ID is ready.' })
    expect(within(ready.closest<HTMLElement>('[role="status"]')!).queryByText(/1990/)).toBeNull()
    expect(document.body.textContent).not.toContain('1990-02-03')
  })
})

/**
 * With a profile field on the step, focus goes to that field, not the password.
 * A patient who sends the step with Enter in the password field keeps focus
 * there, so a refusal is read only if it is an alert: its field's description
 * is not read again, and a description on the focused field is not re-read
 * when it changes.
 */
describe('sending the password step with Enter in the password field', () => {
  const DATE_DETAIL = 'Enter a real date of birth. It cannot be before 1 January 1900 or in the future.'
  async function enterInPassword(date: string) {
    fireEvent.change(await screen.findByLabelText('Date of birth'), { target: { value: date } })
    const password = screen.getByLabelText('Password')
    fireEvent.change(password, { target: { value: PASSWORD } })
    password.focus()
    await act(async () => { fireEvent.submit(password.closest('form')!) })
    return password
  }

  it.each<[string, string, Handler, string]>([
    ['a date outside 1900 to today, refused here', '1899-12-31', () => json({ stage: 'active', hidCode: 'HID-ABCDEF23' }), DATE_DETAIL],
    ['400 DATE_OF_BIRTH_INVALID', '1990-02-03', () => problem(400, 'DATE_OF_BIRTH_INVALID', DATE_DETAIL), DATE_DETAIL],
    ['400 PASSWORD_INVALID', '1990-02-03', () => problem(400, 'PASSWORD_INVALID', 'Choose a password that is harder to guess'), 'Choose a password that is harder to guess'],
  ])('announces %s as an alert', async (_case, date, activate, text) => {
    renderPortal(<Enrollment />, gateway(atPassword(['dateOfBirth']), activate), anonymous)
    const password = await enterInPassword(date)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(document.activeElement).toBe(password)
  })

  it('announces 400 ENROLLMENT_PROFILE_REQUIRED for a field it now names as an alert', async () => {
    let current = atPassword(['dateOfBirth'])
    renderPortal(<Enrollment />, gateway(() => current(), () => problem(400, 'ENROLLMENT_PROFILE_REQUIRED', 'Enter your gender')), anonymous)
    await screen.findByLabelText('Date of birth')
    current = atPassword(['dateOfBirth', 'gender'])
    await enterInPassword('1990-02-03')
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your gender')
    expect(screen.getByLabelText('Gender').getAttribute('aria-invalid')).toBe('true')
  })
})
