import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Enrollment } from '../routes/Enrollment'
import { RouteChoice } from '../routes/enrollment/RouteChoice'
import { HolderCodeStep } from '../routes/enrollment/HolderCodeStep'
import { FacilityStep } from '../routes/enrollment/FacilityStep'
import { AlreadyRegistered, RegistrationCompleted, RegistrationEnded } from '../routes/enrollment/Outcomes'
import { REGISTRATION_CLOSED } from '../routes/enrollment/RegistrationClosed'
import { described, json, problem, renderPortal, shownText, type Handler } from './portalHarness'
import { enterCode } from './codeBoxes'
import type { PatientApi } from '../api'

/**
 * The sign-up for a full launch (launch audit, signed-out area): no NIN steps while the page is still finding out
 * which sign-up to show, none at the end, closed registration said as a pause, step headings that look like
 * headings, the reason the NIN step's button is disabled, and a wrong contact code said as such.
 */
let token: ((value: string | null) => void) | null = null
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (value: string | null) => void }) => {
    token = onTokenChange
    return <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>
  },
}))
vi.mock('../GoogleButton', () => ({ GoogleButton: () => <button type="button">Sign up with Google</button> }))
afterEach(() => { vi.unstubAllEnvs(); token = null })

const AVAILABILITY = '/identity/patient-enrollments/availability'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const none = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')

function gateway(availability: () => Response | Promise<Response>, current: () => Response = none, other: Handler = (path, method) =>
  problem(500, 'UNEXPECTED', `${method} ${path}`)): Handler {
  return (path, method, body) => {
    if (path === AVAILABILITY && method === 'GET') return availability()
    if (path === '/identity/patient-enrollments/current') return current()
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    return other(path, method, body)
  }
}
const stepsList = () => screen.queryByRole('list', { name: /steps/ })

describe('while the page finds out which sign-up to show (SO-07)', () => {
  it('shows no steps and no description of the NIN sign-up, then the sign-up Identity serves', async () => {
    let answer: (response: Response) => void = () => undefined
    renderPortal(<Enrollment />, gateway(() => new Promise<Response>(resolve => { answer = resolve })), anonymous)
    expect(await screen.findByRole('heading', { level: 1, name: 'Get your Health ID.' })).toBeTruthy()
    expect(screen.getByRole('status', { name: /Checking for an enrollment in progress/ })).toBeTruthy()
    expect(stepsList()).toBeNull()
    expect(screen.queryByText('Verify who you are, confirm a contact, and choose a password.')).toBeNull()

    await act(async () => { answer(json({ open: true, online: true, facility: true, signup: true })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Create your Health ID.' })).toBeTruthy()
    expect(within(stepsList()!).getAllByRole('listitem').map(item => item.textContent)).toEqual(['1Your details', '2Password', '3Email code'])
  })

  it('shows no NIN steps when it could not find out, only Try again', async () => {
    renderPortal(<Enrollment />, gateway(() => problem(503, 'SERVICE_UNAVAILABLE', 'Down')), anonymous)
    expect(await screen.findByText(/We couldn’t check whether new sign-ups are open/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(stepsList()).toBeNull()
    expect(screen.queryByText('Verify who you are, confirm a contact, and choose a password.')).toBeNull()
  })

  it('shows the NIN steps once the NIN sign-up is the one served', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: true })), anonymous)
    await screen.findByLabelText('National Identification Number (NIN)')
    expect(stepsList()).toBeTruthy()
    expect(screen.getByText('Verify who you are, confirm a contact, and choose a password.')).toBeTruthy()
  })
})

describe('the end of the NIN sign-up (SO-15)', () => {
  it('shows the Health ID without the step list or the steps\' description', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: true }), () => json({ stage: 'active', hidCode: 'HID-SMP4821' })), anonymous)
    expect(await screen.findByRole('heading', { name: /Your Health ID is ready/ })).toBeTruthy()
    expect(stepsList()).toBeNull()
    expect(screen.queryByText('Verify who you are, confirm a contact, and choose a password.')).toBeNull()
  })
})

describe('registration closed after launch (SO-10)', () => {
  it('says new sign-ups are paused, not that they are not open yet', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: false })), anonymous)
    const notice = await screen.findByRole('region', { name: 'New sign-ups are paused' })
    expect(within(notice).getByText('New sign-ups are paused right now. Please try again later. If you already have a Health ID, sign in.')).toBeTruthy()
    expect(REGISTRATION_CLOSED).not.toMatch(/yet/)
    expect(shownText(document.body)).not.toMatch(/not open yet|aren’t open yet/)
  })

  it('gives its Forgot password link a 44px target (SO-13)', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: false })), anonymous)
    const notice = await screen.findByRole('region', { name: 'New sign-ups are paused' })
    const link = within(notice).getByRole('link', { name: 'Forgot password?' })
    expect(link.className.split(' ')).toEqual(expect.arrayContaining(['inline-flex', 'min-h-11', 'items-center']))
  })
})

describe('step headings (SO-12)', () => {
  // text-title-2 is a plain class (packages/ui tokens.css), so a parent's `[&_h2]:text-title-2` makes no CSS: each
  // step's heading carries it itself, as the contact step's does.
  const noop = () => undefined
  const focusTarget = () => undefined
  const api = { participatingFacilities: () => new Promise(() => undefined) } as unknown as PatientApi
  it.each([
    ['the choice', <RouteChoice focusTarget={focusTarget} busy={false} online onlineNote="" facility onSend={noop} onFacility={noop} onDifferentNin={noop} />],
    ['the texted code', <HolderCodeStep focusTarget={focusTarget} busy={false} codeError={false} errorId={undefined} expiresInSeconds={600} code=""
      onCode={noop} onSubmit={noop} resendReady resendWaitSeconds={0} onResend={noop} onOtherWay={noop} onDifferentNin={noop} />],
    ['the facility step', <FacilityStep focusTarget={focusTarget} api={api} busy={false} deskCode={null} deskCodeExpiresAt={null} notRecordedYet={false}
      online onGetCode={noop} onChecked={noop} onOnline={noop} onDifferentNin={noop} />],
    ['already registered', <AlreadyRegistered focusTarget={focusTarget} />],
    ['registration ended', <RegistrationEnded focusTarget={focusTarget} onStartAgain={noop} />],
    ['registration completed', <RegistrationCompleted focusTarget={focusTarget} />],
  ])('%s has a title-sized heading of its own', (_name, step) => {
    render(<MemoryRouter>{step}</MemoryRouter>)
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) expect(heading.className.split(' ')).toEqual(expect.arrayContaining(['m-0', 'text-title-2', 'text-ink', 'outline-none']))
  })
})

describe('the NIN step\'s Continue while the security check runs (SO-16)', () => {
  it('says why it is disabled, until the check is done', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: true })), anonymous)
    await screen.findByLabelText('National Identification Number (NIN)')
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(described(button)).toBe('Complete the security check to continue.')
    act(() => { token?.('turnstile-token') })
    expect(button.getAttribute('aria-describedby')).toBeNull()
  })
})

describe('a wrong contact code (SO-19)', () => {
  it('says the code is wrong or has expired, as the sign-up without a NIN does', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ open: true }),
      () => json({ stage: 'verify_contact', challengeId: 'cc-1', maskedContact: 'a***@example.com' }),
      (path, method) => path === '/identity/patient-enrollments/contact/verify'
        ? problem(422, 'OTP_INVALID', 'The verification code is invalid or expired') : problem(500, 'UNEXPECTED', `${method} ${path}`)), anonymous)
    await enterCode(await screen.findByLabelText('Code'), '654321')
    const error = document.getElementById('enroll-error')
    expect(error?.textContent).toMatch('That code is wrong or has expired. Check the latest message, or ask for a new code.')
    expect(error?.textContent).not.toMatch('Check what you entered')
  })
})
