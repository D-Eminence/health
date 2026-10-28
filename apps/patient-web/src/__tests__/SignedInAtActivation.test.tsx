import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider, useSession } from '../session'
import { Enrollment } from '../routes/Enrollment'
import { enterCode } from './codeBoxes'

/**
 * Signed straight in after sign-up (hid-system, owner decision 2026-10-28). POST .../activate, on the sign-up without
 * a NIN and the NIN route alike, sets the cookies a patient sign-in sets and answers `signedIn: true` next to the
 * stage and the Health ID. The portal then reads the session, takes it up as sign-in does, and shows the Health ID
 * with "Proceed to profile" (hid-1.0 PatientAuth.tsx), never the overview first. An Identity before it sends no
 * `signedIn`, and a replay or a session that could not be made sends `false`: the patient signs in, as before.
 *
 * Identity here is a fake over fetch, with the real session provider: the session read answers 401 until an
 * activation that answered `signedIn: true` has set the cookies.
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'https://portal.example.test', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

class TabChannel {
  static posted: unknown[] = []
  constructor(readonly name: string) {}
  postMessage(message: unknown) { TabChannel.posted.push(message) }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

beforeEach(() => {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', '')
  TabChannel.posted = []
  vi.stubGlobal('BroadcastChannel', TabChannel)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const BASE = '/identity/patient-enrollments'
const PATIENT = { kind: 'patient', subject: 'patient:account-9', patientId: 'patient-9', accountId: 'account-9', authenticationMethod: 'local' }
const PASSWORD = 'correct horse battery'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, code: string, detail: string) => json({ type: 'about:blank', title: code, status, code, detail }, status)

interface Options {
  /** The activation's answer. */
  activation: Record<string, unknown>
  /** The NIN route (availability without `signup`, and an enrollment at its password step) instead of the sign-up. */
  nin?: boolean
  /** The session read after the activation: the patient's, or refused. */
  readAfter?: 'patient' | 'refused'
}

/** Identity: what was sent, in order, as `METHOD /path` without /api/v1. */
function identity({ activation, nin = false, readAfter = 'patient' }: Options) {
  const sent: string[] = []
  let cookies = false
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = new URL(String(url)).pathname.replace('/api/v1', '')
    sent.push(`${method} ${path}`)
    switch (`${method} ${path}`) {
      case 'GET /auth/session':
        return cookies && readAfter === 'patient' ? json({ actor: PATIENT, expiresAt: '2026-10-28T10:15:00.000Z' })
          : problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
      // The page's own session check restores a session once (session.tsx); with no refresh cookie, Identity refuses.
      case 'POST /auth/refresh': return problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')
      case `GET ${BASE}/availability`: return json(nin ? { open: true, online: true, facility: false } : { open: true, online: true, facility: false, signup: true })
      case `GET ${BASE}/current`: return nin ? json({ stage: 'set_password', requiredProfileFields: [] })
        : problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
      case 'GET /auth/google/onboarding': return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
      case `POST ${BASE}/signup`: return json({ stage: 'verify_contact', contactChannel: 'email', maskedContact: 'a•••@example.com',
        challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 0, expiresAt: '2026-10-28T10:00:00.000Z' })
      case `POST ${BASE}/contact/verify`: return json({ stage: 'set_password', requiredProfileFields: [] })
      case `POST ${BASE}/activate`:
        cookies = activation.signedIn === true
        return json(activation)
      default: return problem(500, 'UNEXPECTED', `${method} ${path}`)
    }
  }))
  return { sent }
}

/** Every page the router showed, in order: a redirect to the overview, however brief, is in it. */
let visited: string[] = []
function Visited() {
  const location = useLocation()
  useLayoutEffect(() => { visited.push(location.pathname) }, [location])
  return null
}
function SessionStatus() {
  return <output data-testid="session">{useSession().state.status}</output>
}

function openEnrollment() {
  visited = []
  render(<MemoryRouter initialEntries={['/enroll']}><SessionProvider>
    <Routes>
      <Route path="/enroll" element={<Enrollment />} />
      <Route path="/profile" element={<h1>Profile page</h1>} />
      <Route path="/" element={<h1>Overview page</h1>} />
      <Route path="/sign-in" element={<h1>Sign-in page</h1>} />
    </Routes>
    <Visited /><SessionStatus />
  </SessionProvider></MemoryRouter>)
}

const field = (name: string) => screen.getByLabelText(name, { selector: 'input, select' })
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
async function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The sign-up without a NIN, from its details to the email code, which activates. */
async function signUp() {
  await screen.findByRole('heading', { name: 'Your details' })
  type('First name', 'Ada'); type('Last name', 'Obi'); type('Email address', 'ada@example.com'); type('Phone number', '08012345678')
  fireEvent.change(field('Gender'), { target: { value: 'female' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to the Terms of Service and Privacy Policy' }))
  await press('Continue')
  await screen.findByRole('heading', { name: 'Create a secure password' })
  type('Password', PASSWORD); type('Confirm password', PASSWORD)
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press('Create account')
  await enterCode(await screen.findByLabelText('Verification code'), '123456')
}

/** The NIN route, from its password step. */
async function activateNinRoute() {
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
  await press('Activate Health ID')
}

const shown = async () => (await screen.findByRole('heading', { name: 'Your Health ID is ready.' })).closest<HTMLElement>('[role="status"]')!
const session = () => screen.getByTestId('session').textContent

describe.each([
  ['the sign-up without a NIN', false, signUp],
  ['the NIN route', true, activateNinRoute],
])('an activation that signs the patient in, on %s', (_route, nin, activate) => {
  it('takes up the session, shows the Health ID with Copy HID and "Proceed to profile", and only then opens the profile', async () => {
    const { sent } = identity({ activation: { stage: 'active', hidCode: 'HID-NEW234', signedIn: true }, nin })
    openEnrollment()
    await waitFor(() => expect(session()).toBe('anonymous'))
    await activate()

    const done = await shown()
    expect(within(done).getByText('HID-NEW234')).toBeTruthy()
    expect(within(done).getByRole('button', { name: 'Copy HID' })).toBeTruthy()
    expect(within(done).getByText('You are signed in on this device. If other people use it, sign out when you finish.')).toBeTruthy()
    expect(within(done).queryByRole('link', { name: /Sign in/ })).toBeNull()
    // Signed in as sign-in signs in: the session read once after the activation, taken up, the other tabs told.
    expect(session()).toBe('authenticated')
    expect(sent.slice(sent.indexOf(`POST ${BASE}/activate`))).toEqual([`POST ${BASE}/activate`, 'GET /auth/session'])
    expect(TabChannel.posted).toEqual(['changed'])
    // The Health ID stays: the session did not open the overview first.
    expect(visited).toEqual(['/enroll'])

    await press('Proceed to profile')
    expect(await screen.findByRole('heading', { name: 'Profile page' })).toBeTruthy()
    expect(visited).toEqual(['/enroll', '/profile'])
    expect(session()).toBe('authenticated')
  })

  it.each([
    ['sends no signedIn (an Identity before it)', { stage: 'active', hidCode: 'HID-NEW234' }],
    ['answers signedIn: false (a replay, or no session made)', { stage: 'active', hidCode: 'HID-NEW234', signedIn: false }],
  ])('keeps the link to sign in when Identity %s, and reads no session', async (_when, activation) => {
    const { sent } = identity({ activation, nin })
    openEnrollment()
    await waitFor(() => expect(session()).toBe('anonymous'))
    await activate()

    const done = await shown()
    expect(within(done).getByText('HID-NEW234')).toBeTruthy()
    expect(within(done).getByRole('link', { name: nin ? 'Sign in' : 'Sign in to continue' }).getAttribute('href')).toBe('/sign-in')
    expect(within(done).queryByRole('button', { name: 'Proceed to profile' })).toBeNull()
    expect(within(done).queryByText(/You are signed in on this device/)).toBeNull()
    expect(sent.slice(sent.indexOf(`POST ${BASE}/activate`))).toEqual([`POST ${BASE}/activate`])
    expect(session()).toBe('anonymous')
    expect(TabChannel.posted).toEqual([])
    expect(visited).toEqual(['/enroll'])
  })

  it('still shows the Health ID, with the link to sign in, when the session it made cannot be read', async () => {
    identity({ activation: { stage: 'active', hidCode: 'HID-NEW234', signedIn: true }, nin, readAfter: 'refused' })
    openEnrollment()
    await waitFor(() => expect(session()).toBe('anonymous'))
    await activate()

    const done = await shown()
    expect(within(done).getByText('HID-NEW234')).toBeTruthy()
    expect(within(done).getByRole('link', { name: nin ? 'Sign in' : 'Sign in to continue' })).toBeTruthy()
    expect(within(done).queryByRole('button', { name: 'Proceed to profile' })).toBeNull()
    expect(session()).toBe('anonymous')
    // The cookies may have changed all the same: the other tabs are told.
    expect(TabChannel.posted).toEqual(['changed'])
  })
})

describe('a reload of the Health ID after the activation signed the patient in', () => {
  it('opens the portal without first showing the note to sign out', async () => {
    let answerSession: () => void = () => {}
    const sessionRead = new Promise<void>(resolve => { answerSession = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const route = `${init?.method ?? 'GET'} ${new URL(String(url)).pathname.replace('/api/v1', '')}`
      if (route === 'GET /auth/session') { await sessionRead; return json({ actor: PATIENT }) }
      if (route === `GET ${BASE}/availability`) return json({ open: true, online: true, facility: false, signup: true })
      // Identity refuses enrollment calls while the browser holds a sign-in: here, the patient's own.
      if (route === `GET ${BASE}/current`) return problem(409, 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT', 'Sign out before starting a new enrollment')
      if (route === 'GET /auth/google/onboarding') return problem(409, 'GOOGLE_ONBOARDING_REQUIRES_SIGN_OUT', 'Sign out first')
      return problem(500, 'UNEXPECTED', route)
    }))
    const noted = vi.fn()
    const watcher = new MutationObserver(() => { if (document.body.textContent?.includes('still signed in to Health ID')) noted() })
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true })
    openEnrollment()

    // The enrollment check has answered; the session read has not.
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(4))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.getByText('Checking for an enrollment in progress…').getAttribute('role')).toBe('status')
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => { answerSession() })
    expect(await screen.findByRole('heading', { name: 'Overview page' })).toBeTruthy()
    watcher.disconnect()
    expect(noted).not.toHaveBeenCalled()
  })
})
