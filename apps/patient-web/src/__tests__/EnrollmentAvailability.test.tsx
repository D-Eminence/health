import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { json, press, problem, renderPortal, type Handler } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: () => <button type="button">Sign up with Google</button>,
}))

afterEach(() => { vi.unstubAllEnvs() })

const AVAILABILITY = '/identity/patient-enrollments/availability'
const CLOSED = 'New Health ID registration is not open yet. If you already have a Health ID, sign in.'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const none = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
/** The gateway's 503; Retry-After 0 lets the client spend its read retries without waiting. */
const outage = () => new Response(JSON.stringify({ type: 'about:blank', title: 'UPSTREAM_UNAVAILABLE', status: 503,
  code: 'UPSTREAM_UNAVAILABLE', detail: 'A required platform service is temporarily unavailable.' }),
{ status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' } })

function gateway(availability: () => Response, current: () => Response = none, other: Handler = (path, method) =>
  problem(500, 'UNEXPECTED', `${method} ${path}`)): Handler {
  return (path, method, body) => {
    if (path === AVAILABILITY && method === 'GET') return availability()
    if (path === '/identity/patient-enrollments/current') return current()
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    return other(path, method, body)
  }
}
const closedNotice = () => screen.findByRole('region', { name: 'Registration is not open yet' })
const availabilityReads = (sent: Array<{ path: string }>) => sent.filter(request => request.path === AVAILABILITY).length

/**
 * hid-system#68 (FE-4) answers `GET /identity/patient-enrollments/availability`
 * with `200 { open: boolean }` (since hid-system#84 also `online` and `facility`),
 * and a client treats any other answer as not open. With every flag at its
 * default each start answers 503 (since #84 `PATIENT_REGISTRATION_NOT_OPEN`), and
 * the page used to ask for a NIN and a security check anyway, only for the start
 * to answer 503. It now says registration is not open, with sign-in and recovery,
 * and asks for nothing; an enrollment already in progress continues, since only a
 * start is refused while registration is closed.
 */
describe('new Health ID registration (hid-system#68, FE-4)', () => {
  it('says registration is not open, with sign-in and recovery, instead of asking for a NIN', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(() => json({ open: false })), anonymous)

    const notice = await closedNotice()
    expect(within(notice).getByText(CLOSED)).toBeTruthy()
    expect(within(notice).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(within(notice).getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/recover')
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete check' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Enrollment steps' })).toBeNull()
    expect(sent).toContainEqual({ path: AVAILABILITY, method: 'GET', body: null })
    expect(sent.filter(request => request.method !== 'GET')).toEqual([])
  })

  it.each([[{}], [{ open: 'true' }], [{ open: null }]])('treats %j as not open', async answer => {
    renderPortal(<Enrollment />, gateway(() => json(answer)), anonymous)
    expect(await closedNotice()).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
  })

  it('does not offer a Google sign-up while registration is not open', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    renderPortal(<Enrollment />, gateway(() => json({ open: false })), anonymous)
    await closedNotice()
    expect(screen.queryByRole('button', { name: 'Sign up with Google' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Google enrollment' })).toBeNull()
  })

  it('asks for the NIN, as before, when registration is open', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    renderPortal(<Enrollment />, gateway(() => json({ open: true })), anonymous)
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    // One security check on the page: Google is a path of its own, opened by a button.
    expect(screen.getAllByRole('button', { name: 'Complete check' })).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Enrollment steps' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign up with Google' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Registration is not open yet' })).toBeNull()
  })

  it('continues an enrollment in progress while registration is not open', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: false }),
      () => json({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a•••@example.com' })), anonymous)
    expect(await screen.findByLabelText('Verification code')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Registration is not open yet' })).toBeNull()
  })

  it('shows the Health ID of an enrollment activated here while registration is not open', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: false }),
      () => json({ stage: 'active', hidCode: 'HID-ABCDEF23' })), anonymous)
    expect(await screen.findByRole('heading', { name: 'Your Health ID is ready.' })).toBeTruthy()
    expect(screen.getByText('HID-ABCDEF23')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Registration is not open yet' })).toBeNull()
  })

  it('says it could not check, without asking for a NIN, when the availability read fails; Try again reads it again', async () => {
    let open: () => Response = outage
    const { sent } = renderPortal(<Enrollment />, gateway(() => open()), anonymous)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('We could not check whether new Health ID registration is open. Try again before starting.')
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Registration is not open yet' })).toBeNull()
    const reads = availabilityReads(sent)

    open = () => json({ open: true })
    await press(within(alert).getByRole('button', { name: 'Try again' }))
    const nin = await screen.findByLabelText('National Identification Number')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect(availabilityReads(sent)).toBeGreaterThan(reads)
  })

  it('moves focus to the notice when Try again finds registration not open, and to Try again when the read fails again', async () => {
    let open: () => Response = outage
    renderPortal(<Enrollment />, gateway(() => open()), anonymous)
    const first = await screen.findByRole('button', { name: 'Try again' })
    await press(first)
    const second = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(second))

    open = () => json({ open: false })
    await press(second)
    await closedNotice()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Registration is not open yet' })))
  })

  it('does not ask for the NIN again when an enrollment in progress ends here while registration is not open', async () => {
    // A start with the same key is refused too while registration is closed (patient-enrollment.service.ts start).
    renderPortal(<Enrollment />, gateway(() => json({ open: false }),
      () => json({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a•••@example.com' }),
      () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })

    await closedNotice()
    expect(screen.getByText('This registration is no longer open on this device. It may have expired after 24 hours, been replaced by a newer registration for the same NIN, or ended when someone signed in or out in this browser.')).toBeTruthy()
    expect(screen.queryByText(/Enter your NIN to start again/)).toBeNull()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
  })

  it('moves focus to Try again, and asks for the NIN only once it is offered, when an enrollment in progress ends here and availability could not be read', async () => {
    let open: () => Response = outage
    let current = () => json({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a•••@example.com' })
    renderPortal(<Enrollment />, gateway(() => open(), () => current(),
      () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    // A sign-in or sign-out in another tab expired the enrollment cookie.
    current = none
    await press(screen.getByRole('button', { name: 'Verify code' }))

    const retry = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(retry))
    expect(screen.getByText('This registration is no longer open on this device. It may have expired after 24 hours, been replaced by a newer registration for the same NIN, or ended when someone signed in or out in this browser.')).toBeTruthy()
    expect(screen.queryByText(/Enter your NIN to start again/)).toBeNull()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()

    open = () => json({ open: true })
    await press(retry)
    const nin = await screen.findByLabelText('National Identification Number')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect(screen.getByText(/This registration is no longer open on this device/).textContent).toMatch(/Enter your NIN to start again\.$/)
  })

  it.each([
    ['is not open', () => json({ open: false })],
    ['could not be checked', outage],
  ])('does not ask to reconnect Google when an enrollment that required it ends here while registration %s', async (_state, availability) => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    renderPortal(<Enrollment />, gateway(availability,
      () => json({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a•••@example.com', googleOnboardingRequired: true }),
      () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    expect(screen.getByText('Reconnect the Google account used to start this enrollment.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Verify code' }))

    await screen.findByText(/This registration is no longer open on this device/)
    expect(screen.queryByText('Reconnect the Google account used to start this enrollment.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign up with Google' })).toBeNull()
  })

  it('asks again to reconnect Google, with the Google sign-up, once an enrollment that required it ended here and registration is found open', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    let open: () => Response = outage
    let current = () => json({ stage: 'verify_contact', challengeId: 'challenge-1', maskedContact: 'a•••@example.com', googleOnboardingRequired: true })
    renderPortal(<Enrollment />, gateway(() => open(), () => current(),
      () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    current = none
    await press(screen.getByRole('button', { name: 'Verify code' }))

    open = () => json({ open: true })
    await press(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    expect(screen.getByText('Reconnect the Google account used to start this enrollment.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Reconnect Google' }))
    expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeTruthy()
  })
})
