import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { json, press, problem, renderPortal, type Handler, shownText } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

afterEach(() => { vi.restoreAllMocks() })

const AVAILABILITY = '/identity/patient-enrollments/availability'
const START = '/identity/patient-enrollments'
const NIN = '12345678901'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const CLOSED = 'You can’t sign up for a new Health ID yet. If you already have a Health ID, sign in.'

function gateway(availability: unknown, start: Handler = (path, method) => problem(500, 'UNEXPECTED', `${method} ${path}`)): Handler {
  return (path, method, body) => {
    if (path === AVAILABILITY && method === 'GET') return json(availability)
    if (path === '/identity/patient-enrollments/current') return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === START && method === 'POST') return start(path, method, body)
    return problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const routes = () => screen.findByRole('region', { name: 'How you’ll show this NIN is yours' })

async function submitNin() {
  fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}

/**
 * hid-system main f9dbaf0 (#84, ADR-062; #85, ADR-063) answers availability with
 * `{ open, online, facility }`: `open` alone says whether a start may be made,
 * and `online` and `facility` which route proves that the person holds the NIN.
 * The owner's decision of 2026-10-14 asks for both routes to be discoverable from
 * the start, with a clear option for someone who cannot use the phone linked to
 * their NIN (Health-id alignment row 14).
 */
describe('how the NIN will be proved, told at the NIN step', () => {
  it('describes both routes when both are open, with the facility list, before anything is sent', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({ open: true, online: true, facility: true }), anonymous)
    const region = await routes()
    expect(region.textContent).toContain('we text a 6-digit code to the phone number linked to your NIN')
    expect(region.textContent).toContain('lost your SIM, changed your number, have no phone linked to your NIN, or can\'t get the code')
    expect(region.textContent).toContain('checks one original photo ID in person')
    expect(within(region).getByRole('link', { name: 'See the facilities and what to bring' }).getAttribute('href')).toBe('/enroll/facilities')
    expect(sent.filter(request => request.method !== 'GET')).toEqual([])
  })

  it('lists only the facility route while the code by text is off, without announcing the other', async () => {
    renderPortal(<Enrollment />, gateway({ open: true, online: false, facility: true }), anonymous)
    const region = await routes()
    expect(region.textContent).not.toContain('we text a 6-digit code')
    expect(region.textContent).not.toContain('available')
    expect(within(region).getByRole('link', { name: 'See the facilities and what to bring' })).toBeTruthy()
  })

  it('lists only the online route while registering at a facility is off, without announcing the other', async () => {
    renderPortal(<Enrollment />, gateway({ open: true, online: true, facility: false }), anonymous)
    const region = await routes()
    expect(region.textContent).not.toContain('participating facility')
    expect(region.textContent).not.toContain('available')
    expect(within(region).queryByRole('link')).toBeNull()
  })

  it('claims no route for an Identity before the holder step, which sends { open } only', async () => {
    renderPortal(<Enrollment />, gateway({ open: true }), anonymous)
    expect(await screen.findByLabelText('National Identification Number (NIN)')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'How you’ll show this NIN is yours' })).toBeNull()
  })

  it('keeps open as the only gate: the routes alone do not offer a start', async () => {
    renderPortal(<Enrollment />, gateway({ open: false, online: true, facility: true }), anonymous)
    const notice = await screen.findByRole('region', { name: 'Sign-ups are closed for now' })
    expect(within(notice).getByText('If you already have a Health ID, sign in.')).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
  })

  it('names the step\'s button for what it does, without claiming the NIN is verified', async () => {
    renderPortal(<Enrollment />, gateway({ open: true, online: true, facility: true }), anonymous)
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verify NIN' })).toBeNull()
  })
})

describe('the start\'s refusals since the holder step', () => {
  it('shows the closed notice, and no NIN field, on 503 PATIENT_REGISTRATION_NOT_OPEN', async () => {
    const signOut = vi.fn()
    const { sent } = renderPortal(<Enrollment />, gateway({ open: true, online: true, facility: true }, () =>
      problem(503, 'PATIENT_REGISTRATION_NOT_OPEN', CLOSED)), { ...anonymous, signOut })
    await submitNin()
    const notice = await screen.findByRole('region', { name: 'Sign-ups are closed for now' })
    expect(within(notice).getByText('If you already have a Health ID, sign in.')).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
    expect(sent.filter(request => request.path.startsWith('/auth/') && request.path !== '/auth/google/onboarding')).toEqual([])
  })

  it.each([
    ['a NIN lookup that could not be completed', () => problem(502, 'QOREID_UNAVAILABLE', 'We couldn’t check your NIN now. Try again later.')],
    ['an outage with the generic detail', () => problem(503, 'ENROLLMENT_UNAVAILABLE', 'The service could not complete the request.')],
    ['a lost connection', () => { throw new TypeError('Failed to fetch') }],
  ])('says to try again later, keeping the step and the session, on %s', async (_case, refusal) => {
    const signOut = vi.fn()
    const { sent } = renderPortal(<Enrollment />, gateway({ open: true, online: true, facility: true }, refusal), { ...anonymous, signOut })
    await submitNin()
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('We couldn’t check your NIN now. Try again later.')
    expect((screen.getByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe(NIN)
    expect(signOut).not.toHaveBeenCalled()
    expect(sent.filter(request => request.path.startsWith('/auth/') && request.path !== '/auth/google/onboarding')).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy())
  })
})
