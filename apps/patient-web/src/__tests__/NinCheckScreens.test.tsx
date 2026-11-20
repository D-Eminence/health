import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { ProfilePage } from '../routes/Portal'
import { PLAIN } from '@hid/http'
import { NIN_DETAILS_CHECK, NIN_HELD_FEW_MINUTES, NIN_IN_PROGRESS, NIN_STILL_CHECKING, NIN_TAKING_LONGER } from '../ninCheck'
import { NIN_STATES } from '../routes/NinVerificationCard'
import { json, openSection, press, problem, renderPortal, shownText, type Handler } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../GoogleButton', () => ({ GoogleButton: () => <button type="button">Sign up with Google</button> }))

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/*
 * The NIN check on the sign-up's NIN step and on the profile's "Verify your NIN" (ninCheck.ts; hid-system 0137 "One
 * QoreID check per NIN"): Identity's answers when it could not finish are said in plain words, never with a code; a
 * retry of the same details sends the same Idempotency-Key, changed details a new one; the page says it is still
 * checking after a few seconds. Every person and number here is fictional: Patient One, NIN 12345678901.
 */

const NIN = '12345678901'
const OTHER_NIN = '12345678902'
const BASE = '/identity/patient-enrollments'
const VERIFY = '/identity/me/verification/nin'
/** A problem as Identity writes it (common/problem.ts), with its `retryAfterSeconds` member where it sends one. */
const refused = (status: number, code: string, detail: string, retryAfterSeconds?: number) =>
  json({ type: `https://example.test/problems/${code.toLowerCase()}`, title: 'Refused', status, code, detail,
    correlationId: 'corr-nin-1', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }, status)

/** Each answer, the words the screen shows for it, and whether a retry reuses the key. */
const ANSWERS: Array<[string, () => Response, string]> = [
  ['409 NIN_CHECK_IN_PROGRESS', () => refused(409, 'NIN_CHECK_IN_PROGRESS', 'We are still checking this NIN. Please wait a minute, then try again.', 60), NIN_IN_PROGRESS],
  ['409 NIN_CHECK_HELD without a time', () => refused(409, 'NIN_CHECK_HELD', 'We could not finish checking this NIN. Please try again in 5 minutes.'), NIN_HELD_FEW_MINUTES],
  ['504 QOREID_TIMEOUT', () => refused(504, 'QOREID_TIMEOUT', 'The service could not complete the request.', 60), NIN_TAKING_LONGER],
  ['400 NIN_DETAILS_INVALID', () => refused(400, 'NIN_DETAILS_INVALID', 'Check the name and the date of birth.'), NIN_DETAILS_CHECK],
]
/** Nothing of Identity's own: no code, status, correlation id or its words. */
function expectNoCode() {
  expect(document.body.textContent).not.toMatch(/NIN_CHECK|QOREID|NIN_DETAILS|corr-nin|\b(400|409|504)\b|Please wait a minute|could not complete/)
}
const keysTo = (headers: Array<{ path: string; method: string; headers: Headers }>, path: string) =>
  headers.filter(request => request.path === path && request.method === 'POST').map(request => request.headers.get('Idempotency-Key'))

// ---- The sign-up's NIN step ---------------------------------------------------------------------------------------

function enrollmentGateway(start: Handler): Handler {
  return (path, method, body) => {
    if (path === `${BASE}/availability`) return json({ open: true, online: true, facility: true })
    if (path === `${BASE}/current`) return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === BASE && method === 'POST') return start(path, method, body)
    return problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const anonymous = { state: { status: 'anonymous', principal: null } } as const
async function continueWith(nin = NIN) {
  fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: nin } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}
const holder = { stage: 'verify_holder', expiresAt: '2026-11-19T10:00:00.000Z', googleOnboardingRequired: false,
  online: { available: true }, facility: { available: true } }

describe('the sign-up’s NIN step', () => {
  it.each(ANSWERS)('says %s plainly, with no code', async (_name, answer, text) => {
    renderPortal(<Enrollment />, enrollmentGateway(() => answer()), anonymous)
    await continueWith()
    await waitFor(() => expect(shownText(document.getElementById('enroll-error')!)).toBe(text))
    expectNoCode()
  })

  it.each([ANSWERS[0]!, ANSWERS[2]!])('after %s, Continue again sends the same key, and then goes on', async (_name, answer) => {
    let calls = 0
    const { headers } = renderPortal(<Enrollment />, enrollmentGateway(() => (++calls === 1 ? answer() : json(holder))), anonymous)
    await continueWith()
    await screen.findByText(answer === ANSWERS[0]![1] ? NIN_IN_PROGRESS : NIN_TAKING_LONGER)
    await continueWith()
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    const keys = keysTo(headers, BASE)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toBe(keys[0])
  })

  it('a different NIN is a new request, with a new key', async () => {
    const { headers } = renderPortal(<Enrollment />, enrollmentGateway(() => ANSWERS[2]![1]()), anonymous)
    await continueWith()
    await screen.findByText(NIN_TAKING_LONGER)
    await continueWith(OTHER_NIN)
    await waitFor(() => expect(keysTo(headers, BASE)).toHaveLength(2))
    const [first, second] = keysTo(headers, BASE)
    expect(second).not.toBe(first)
  })

  it('a held NIN says when to try again, and Continue stays off until then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPortal(<Enrollment />, enrollmentGateway(() => refused(409, 'NIN_CHECK_HELD', 'Please try again in 5 minutes.', 300)), anonymous)
    await continueWith()
    const said = await screen.findByText(/^This NIN check is on hold\. Try again after /)
    expect(said.textContent).toMatch(/^This NIN check is on hold\. Try again after \d{1,2}:\d{2}( [AP]M)?( tomorrow)?\.$/)
    expectNoCode()
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(button.disabled).toBe(false)
  })

  it('says it is still checking after a few seconds, and not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let answer: (response: Response) => void = () => {}
    renderPortal(<Enrollment />, enrollmentGateway(() => new Promise<Response>(resolve => { answer = resolve })), anonymous)
    await continueWith()
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText(NIN_STILL_CHECKING).closest('[role="status"]')).not.toBeNull()
    await act(async () => { answer(json(holder)) })
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
  })
})

// ---- The profile's Verify your NIN --------------------------------------------------------------------------------

const verifiedAnswer = { entityType: 'patient', verificationType: 'nin', provider: 'qoreid', state: 'verified', recordedAt: '2026-11-18T10:00:00.000Z' }
function profileGateway(verify: () => Response | Promise<Response>): Handler {
  return (path, method) => {
    if (path === '/identity/me' && method === 'GET') {
      return json({ id: 'patient-1', hid: 'HID-ZDEMAAA2', firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02',
        email: 'patient.one@example.test', assuranceState: 'SELF_ASSERTED', ninVerified: false })
    }
    if (path === VERIFY && method === 'POST') return verify()
    if (path === '/identity/me/account-deletion' && method === 'GET') {
      return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
    }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const ninField = () => screen.getByRole('textbox', { name: 'NIN (11 digits)' })
async function verify(nin = NIN, dateOfBirth?: string) {
  fireEvent.change(ninField(), { target: { value: nin } })
  if (dateOfBirth) fireEvent.change(screen.getByLabelText('Date of birth, as on your NIN'), { target: { value: dateOfBirth } })
  await press(screen.getByRole('button', { name: 'Verify NIN' }))
}

describe('Verify your NIN, on the profile', () => {
  it.each(ANSWERS)('says %s plainly, with no code', async (_name, answer, text) => {
    renderPortal(<ProfilePage />, profileGateway(answer))
    const section = await openSection('Verify your NIN')
    await verify()
    await waitFor(() => expect(within(section).getByText(text)).toBeTruthy())
    expectNoCode()
    // Details Identity refused are marked at the NIN field; the other answers are not about what was typed.
    expect(ninField().getAttribute('aria-invalid')).toBe(text === NIN_DETAILS_CHECK ? 'true' : null)
  })

  it.each([ANSWERS[0]!, ANSWERS[2]!])('after %s, Verify NIN again sends the same key, and then verifies', async (_name, answer) => {
    let calls = 0
    const { headers } = renderPortal(<ProfilePage />, profileGateway(() => (++calls === 1 ? answer() : json(verifiedAnswer))))
    await openSection('Verify your NIN')
    await verify()
    await screen.findByText(answer === ANSWERS[0]![1] ? NIN_IN_PROGRESS : NIN_TAKING_LONGER)
    await press(screen.getByRole('button', { name: 'Verify NIN' }))
    await screen.findByText('Your NIN is verified.')
    const keys = keysTo(headers, VERIFY)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toBe(keys[0])
  })

  it.each([['the NIN', OTHER_NIN, undefined], ['the date of birth', NIN, '1990-01-03']])('a changed %s gets a new key', async (_name, nin, dateOfBirth) => {
    const { headers } = renderPortal(<ProfilePage />, profileGateway(() => ANSWERS[2]![1]()))
    await openSection('Verify your NIN')
    await verify()
    await screen.findByText(NIN_TAKING_LONGER)
    await verify(nin, dateOfBirth)
    await waitFor(() => expect(keysTo(headers, VERIFY)).toHaveLength(2))
    const [first, second] = keysTo(headers, VERIFY)
    expect(second).not.toBe(first)
  })

  it('details refused are a new request next time, even unchanged', async () => {
    const { headers } = renderPortal(<ProfilePage />, profileGateway(() => ANSWERS[3]![1]()))
    await openSection('Verify your NIN')
    await verify()
    await screen.findByText(NIN_DETAILS_CHECK)
    await press(screen.getByRole('button', { name: 'Verify NIN' }))
    await waitFor(() => expect(keysTo(headers, VERIFY)).toHaveLength(2))
    const [first, second] = keysTo(headers, VERIFY)
    expect(second).not.toBe(first)
  })

  it('a held NIN says when to try again, and Verify NIN stays off until then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPortal(<ProfilePage />, profileGateway(() => refused(409, 'NIN_CHECK_HELD', 'Please try again in 6 hours.', 21_600)))
    await openSection('Verify your NIN')
    await verify()
    await screen.findByText(/^This NIN check is on hold\. Try again after \d{1,2}:\d{2}( [AP]M)?( tomorrow)?\.$/)
    expectNoCode()
    const button = screen.getByRole('button', { name: 'Verify NIN' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(21_600_000) })
    expect(button.disabled).toBe(false)
  })

  it('says it is still checking after a few seconds, and not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let answer: (response: Response) => void = () => {}
    renderPortal(<ProfilePage />, profileGateway(() => new Promise<Response>(resolve => { answer = resolve })))
    await openSection('Verify your NIN')
    await verify()
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText(NIN_STILL_CHECKING).closest('[role="status"]')).not.toBeNull()
    await act(async () => { answer(json(verifiedAnswer)) })
    await screen.findByText('Your NIN is verified.')
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
  })
})

// ---- A NIN QoreID has no record of (owner Q117; hid-system #279) ---------------------------------------------------

/** The owner's sentence, written out here so a change to it is seen. */
const NOT_VERIFIED = 'This NIN could not be verified. Check the number and try again.'
const notVerified = () => refused(422, 'NIN_NOT_VERIFIED', 'This NIN could not be verified. Check the number and try again.')
function expectNoNotVerifiedCode() {
  expect(document.body.textContent).not.toMatch(/NIN_NOT_VERIFIED|corr-nin|\b422\b/)
}

describe('a NIN QoreID has no record of, on the sign-up’s NIN step', () => {
  it('says the owner’s sentence, with no code, and marks the NIN field', async () => {
    renderPortal(<Enrollment />, enrollmentGateway(() => notVerified()), anonymous)
    await continueWith()
    await waitFor(() => expect(shownText(document.getElementById('enroll-error')!)).toBe(NOT_VERIFIED))
    expectNoNotVerifiedCode()
    expect(screen.getByLabelText('National Identification Number (NIN)').getAttribute('aria-invalid')).toBe('true')
  })

  it('the next Continue is a new request, with a new key, and the button stays on', async () => {
    let calls = 0
    const { headers } = renderPortal(<Enrollment />, enrollmentGateway(() => (++calls === 1 ? notVerified() : json(holder))), anonymous)
    await continueWith()
    await screen.findByText(NOT_VERIFIED)
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
    await continueWith()
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    const keys = keysTo(headers, BASE)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('another 422 is not said with the sentence', async () => {
    renderPortal(<Enrollment />, enrollmentGateway(() => refused(422, 'NIN_VERIFICATION_FAILED', 'The NIN could not be verified.')), anonymous)
    await continueWith()
    await waitFor(() => expect(shownText(document.getElementById('enroll-error')!)).toBe('Check what you entered and try again.'))
  })
})

describe('a NIN QoreID has no record of, on the profile’s Verify your NIN', () => {
  it('says the owner’s sentence, with no code, and marks the NIN field', async () => {
    renderPortal(<ProfilePage />, profileGateway(notVerified))
    const section = await openSection('Verify your NIN')
    await verify()
    await waitFor(() => expect(within(section).getByText(NOT_VERIFIED)).toBeTruthy())
    expectNoNotVerifiedCode()
    expect(ninField().getAttribute('aria-invalid')).toBe('true')
  })

  it('the next Verify NIN is a new request, with a new key, and the button stays on', async () => {
    let calls = 0
    const { headers } = renderPortal(<ProfilePage />, profileGateway(() => (++calls === 1 ? notVerified() : json(verifiedAnswer))))
    await openSection('Verify your NIN')
    await verify()
    await screen.findByText(NOT_VERIFIED)
    const button = screen.getByRole('button', { name: 'Verify NIN' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await press(button)
    await screen.findByText('Your NIN is verified.')
    const keys = keysTo(headers, VERIFY)
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
  })

  it.each<[string, () => Response, string, boolean]>([
    ['200 not_verified', () => json({ ...verifiedAnswer, state: 'not_verified' }), NIN_STATES.not_verified, true],
    ['200 incomplete', () => json({ ...verifiedAnswer, state: 'incomplete' }), NIN_STATES.incomplete, false],
    ['409 PATIENT_NIN_DETAILS_MISMATCH', () => refused(409, 'PATIENT_NIN_DETAILS_MISMATCH', 'refused'),
      'This NIN doesn’t match your name and date of birth. Check them and try again.', false],
    ['502 QOREID_PROVIDER_REJECTED', () => refused(502, 'QOREID_PROVIDER_REJECTED', 'refused'), PLAIN.unavailable, false],
  ])('keeps its old words for %s', async (_name, answer, text, marked) => {
    renderPortal(<ProfilePage />, profileGateway(answer))
    const section = await openSection('Verify your NIN')
    await verify()
    await waitFor(() => expect(within(section).getByText(text)).toBeTruthy())
    expect(document.body.textContent).not.toContain(NOT_VERIFIED)
    expect(ninField().getAttribute('aria-invalid')).toBe(marked ? 'true' : null)
  })
})
