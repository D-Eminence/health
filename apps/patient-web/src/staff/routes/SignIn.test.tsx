import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { SignIn } from './SignIn'
import { focusWhenShown } from '../../__tests__/focusWhenShown'

const calls = vi.hoisted(() => ({ login: vi.fn(), completeSignIn: vi.fn(), verifyMfa: vi.fn(),
  loginAction: vi.fn((_hostname: string) => 'staff-login'),
  state: { status: 'signed-out' } as { status: string; reason?: string; session?: unknown } }))

vi.mock('../App', () => ({ useStaff: () => ({ state: calls.state, login: calls.login, completeSignIn: calls.completeSignIn,
  verifyMfa: calls.verifyMfa }) }))
vi.mock('../env', () => ({ getEnvironment: () => ({ turnstileSiteKey: 'test-site-key' }) }))
vi.mock('../../productHostname', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  staffLoginAction: calls.loginAction,
}))

/** Serves the page from another host, as a product site would (jsdom's own is localhost). */
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
function serveFrom(hostname: string) { jsdom.reconfigure({ url: `https://${hostname}/provider/sign-in` }) }

beforeEach(() => { vi.clearAllMocks(); calls.state = { status: 'signed-out' } })

// Clinician self sign-up's way in (hid-system ADR-066) asks Identity whether intake is open.
const clinician = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: clinician }))
beforeEach(() => { clinician.availability.mockReset(); clinician.availability.mockResolvedValue({ open: false }) })
afterEach(() => { vi.unstubAllGlobals(); jsdom.reconfigure({ url: servedFrom }) })

it('renews the consumed provider login challenge while preserving credentials on failure', async () => {
  const challengeCallbacks: Array<(token: string) => void> = []
  const remove = vi.fn()
  const renderChallenge = vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
    challengeCallbacks.push(options.callback as (token: string) => void)
    return `widget-${challengeCallbacks.length}`
  })
  vi.stubGlobal('turnstile', { render: renderChallenge, remove, reset: vi.fn() })
  calls.login.mockRejectedValueOnce(new Error('Wrong password'))

  render(<MemoryRouter><SignIn /></MemoryRouter>)
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))

  fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'clinician@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'saved-typed-password' } })
  act(() => challengeCallbacks[0]?.('first-token'))
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong password')
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(2))
  expect(remove).toHaveBeenCalledWith('widget-1')
  expect(calls.login).toHaveBeenCalledWith('clinician@example.test', 'saved-typed-password', 'first-token')
  expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('clinician@example.test')
  expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('saved-typed-password')
  expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', true)

  act(() => challengeCallbacks[1]?.('fresh-token'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', false))
})

it('asks the challenge for the sign-in action of the host the portal is served on', async () => {
  calls.loginAction.mockReturnValue('ocr-login')
  const renderChallenge = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => 'widget-1')
  vi.stubGlobal('turnstile', { render: renderChallenge, remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))

  expect(renderChallenge.mock.calls[0]?.[1]).toMatchObject({ action: 'ocr-login' })
  expect(calls.loginAction).toHaveBeenCalledWith(window.location.hostname)
})

it.each([
  ['lab.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ['pharmacy.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ['migrate.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ['outreach.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ['ehr.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/recover'],
  ['lab.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com/provider/recover'],
])('on %s, links password recovery to the main site, where hid-system accepts it', async (hostname, href) => {
  serveFrom(hostname)
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  const link = screen.getByRole('link', { name: 'Forgot password?' })
  expect(link.getAttribute('href')).toBe(href)
  expect(screen.getByText(/You reset it on the main Health ID site\./)).toBeTruthy()
})

it('on the production portal sends staff to the EHR site to sign in, with no form hid-system would refuse', () => {
  serveFrom('app.healthidentitydirectory.com')
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  expect(screen.getByRole('heading', { level: 1, name: 'Sign in on the provider site' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to staff sign in' }).getAttribute('href'))
    .toBe('https://ehr.healthidentitydirectory.com/provider/sign-in')
  expect(screen.queryByLabelText('Work email')).toBeNull()
  expect((window as unknown as { turnstile: { render: ReturnType<typeof vi.fn> } }).turnstile.render).not.toHaveBeenCalled()
})

it.each(['staging.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com'])(
  'on %s keeps its own staff sign-in form', hostname => {
    serveFrom(hostname)
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    expect(screen.getByLabelText(/Work email/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Continue to provider sign in' })).toBeNull()
  })

/**
 * Facility self sign-up's security check (`provider-enrollment`) is accepted only on the main site: a product
 * host accepts only its own sign-in action, so a sign-up started there would always be refused (P4, W1).
 */
it.each([
  ['ehr.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ['lab.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ['pharmacy.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ['migrate.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ['outreach.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/provider/enroll'],
  ['ehr.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com/provider/enroll'],
  ['lab.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com/provider/enroll'],
])('on %s, opens facility sign-up on the main site', (hostname, href) => {
  serveFrom(hostname)
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  expect(screen.getByRole('link', { name: 'Set up your facility' }).getAttribute('href')).toBe(href)
})

it.each(['staging.healthidentitydirectory.com', 'localhost'])('on %s keeps facility sign-up on this site', hostname => {
  if (hostname !== 'localhost') serveFrom(hostname)
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  expect(screen.getByRole('link', { name: 'Set up your facility' }).getAttribute('href')).toBe('/provider/enroll')
})

it('keeps password recovery on this site where the portal is not a product site', async () => {
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/provider/recover')
  expect(screen.queryByText(/Password resets are done on the main Health ID site/)).toBeNull()
})

it.each([
  [260, 'compact'],
  [320, 'normal'],
  [0, 'normal'],
])('fits the security check into a %ipx slot with the %s widget', async (slot, size) => {
  // Cloudflare's normal widget is 300px wide; at 320px the sign-in column leaves 280px.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => slot })
  const renderChallenge = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => 'widget-1')
  vi.stubGlobal('turnstile', { render: renderChallenge, remove: vi.fn(), reset: vi.fn() })
  try {
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))
    expect(renderChallenge.mock.calls[0]?.[1]).toMatchObject({ size })
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth') }
})

describe('a sign-in that Identity ended for want of an authenticator (403 STAFF_MFA_REQUIRED)', () => {
  const NOTICE = 'Staff now sign in with a code app on your phone (like Google Authenticator). Sign in again to set one up, or to use the one you have.'

  it.each([
    ['signed out at load', 'signed-out'],
    ['ended mid-session', 'ended'],
  ])('says an authenticator code is now needed when it was %s', (_label, status) => {
    calls.state = { status, reason: 'mfa-required' }
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)

    const notice = screen.getByRole('status')
    // An info notice: its intent is said before it, and nothing else shares the status role.
    expect(notice.textContent).toBe(`Info: ${NOTICE}`)
    expect(notice.getAttribute('data-intent')).toBe('info')
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
  })

  it.each([['signed-out'], ['ended']])('says nothing of authenticators for a session %s otherwise', status => {
    calls.state = { status }
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/authenticator/)).toBeNull()
  })
})

describe('clinician self sign-up from the provider sign-in page (hid-system ADR-066)', () => {
  it('offers clinician sign-up while Identity says it is open', async () => {
    clinician.availability.mockResolvedValueOnce({ open: true })
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    expect((await screen.findByRole('link', { name: 'Sign up as a clinician' })).getAttribute('href')).toBe('/provider/join')
    expect(screen.getByRole('link', { name: 'Check your application' }).getAttribute('href')).toBe('/provider/join/status')
  })

  it('offers no clinician sign-up otherwise, without saying it is not open', async () => {
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Check your application' })).toBeTruthy()
    expect(screen.queryByText(/open yet/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign up as a clinician' })).toBeNull()
  })

  it('tells an applicant not yet approved where to check the application (403 NO_ACTIVE_FACILITY_MEMBERSHIP)', async () => {
    const callbacks: Array<(token: string) => void> = []
    vi.stubGlobal('turnstile', { render: vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
      callbacks.push(options.callback as (token: string) => void)
      return `widget-${callbacks.length}`
    }), remove: vi.fn(), reset: vi.fn() })
    const detail = 'Your account has no active facility membership. Ask your organization administrator for access.'
    calls.login.mockRejectedValueOnce(new HidApiError(403, detail, { code: 'NO_ACTIVE_FACILITY_MEMBERSHIP' }))
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    await waitFor(() => expect(callbacks).toHaveLength(1))
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-password' } })
    act(() => callbacks[0]?.('token-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe(detail)
    const applied = screen.getByText(/Applied as a doctor or nurse\? You can sign in once your application is approved\./)
    expect(within(applied).getByRole('link', { name: 'Check your application' }).getAttribute('href')).toBe('/provider/join/status')
  })

  it('points nobody to a clinician application on Novu, which has none', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    try {
      const callbacks: Array<(token: string) => void> = []
      vi.stubGlobal('turnstile', { render: vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
        callbacks.push(options.callback as (token: string) => void)
        return `widget-${callbacks.length}`
      }), remove: vi.fn(), reset: vi.fn() })
      const detail = 'Your account has no active facility membership. Ask your organization administrator for access.'
      calls.login.mockRejectedValueOnce(new HidApiError(403, detail, { code: 'NO_ACTIVE_FACILITY_MEMBERSHIP' }))
      render(<MemoryRouter><SignIn /></MemoryRouter>)
      await waitFor(() => expect(callbacks).toHaveLength(1))
      fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-password' } })
      act(() => callbacks[0]?.('token-1'))
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

      expect((await screen.findByRole('alert')).textContent).toBe(detail)
      // Novu has neither sign-up nor applications: nothing about clinicians at all.
      await waitFor(() => expect(clinician.availability).toHaveBeenCalled())
      expect(screen.queryByText(/open yet/)).toBeNull()
      expect(screen.queryByText(/Applied as a doctor or nurse/)).toBeNull()
      expect(screen.queryByRole('link', { name: /clinician application|Check your application/ })).toBeNull()
    } finally { vi.unstubAllEnvs() }
  })
})

/**
 * A sign-in on a product host lands on that product's page, unless the working facility cannot use it: a facility
 * administrator who signed the facility up (org_admin on Novu) holds no ehr.encounter.read, so the EHR site's
 * Clinical record would only say "Choose a patient first" (P4 review). They land on the Overview instead.
 */
describe('where a sign-in on the EHR site lands', () => {
  const ORG_ADMIN = ['organization.manage', 'workforce.manage', 'audit.read', 'identity.registration.write',
    'identity.registration.approve', 'outreach.registration.read', 'outreach.registration.write']
  const sessionWith = (permissions: string[]) => {
    const facility = { id: 'facility-1', membershipId: 'membership-1', organizationId: 'org-1', name: 'Ikeja Care',
      roles: ['org_admin'], permissions, isPrimary: true }
    return { actor: { id: 'staff-1', roles: ['org_admin'], permissions: [], facilities: [facility], facility },
      facilitySelection: 'default' as const }
  }

  function openAt(entry: string) {
    serveFrom('ehr.healthidentitydirectory.com')
    render(<MemoryRouter initialEntries={[entry]}><Routes>
      <Route path="/provider/sign-in" element={<SignIn />} />
      <Route path="/provider" element={<h1>Overview page</h1>} />
      <Route path="/provider/clinical" element={<h1>Clinical record page</h1>} />
      <Route path="/provider/audit" element={<h1>Facility audit page</h1>} />
      <Route path="/provider/staff/join" element={<h1>Join page</h1>} />
    </Routes></MemoryRouter>)
  }

  async function signIn(permissions: string[], entry = '/provider/sign-in') {
    const callbacks: Array<(token: string) => void> = []
    vi.stubGlobal('turnstile', { render: vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
      callbacks.push(options.callback as (token: string) => void)
      return `widget-${callbacks.length}`
    }), remove: vi.fn(), reset: vi.fn() })
    calls.login.mockResolvedValueOnce({ kind: 'session', session: sessionWith(permissions) })
    openAt(entry)
    await waitFor(() => expect(callbacks).toHaveLength(1))
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@ikejacare.example' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-password' } })
    act(() => callbacks[0]?.('token-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('opens the Overview for a facility administrator, who cannot use the Clinical record', async () => {
    await signIn(ORG_ADMIN)
    expect(await screen.findByRole('heading', { name: 'Overview page' })).toBeTruthy()
    expect(calls.completeSignIn).toHaveBeenCalledTimes(1)
  })

  it('opens the Overview after the workspace sent a signed-out visit to sign in (returnTo the Clinical record)', async () => {
    await signIn(ORG_ADMIN, `/provider/sign-in?returnTo=${encodeURIComponent('/provider/clinical')}`)
    expect(await screen.findByRole('heading', { name: 'Overview page' })).toBeTruthy()
  })

  it('keeps any other page to return to: the page the person was on', async () => {
    await signIn([], `/provider/sign-in?returnTo=${encodeURIComponent('/provider/audit')}`)
    expect(await screen.findByRole('heading', { name: 'Facility audit page' })).toBeTruthy()
  })

  // Novu (P4b): an invitation link the workspace took out of the address is accepted first, whatever the return address.
  it.each([
    ['novu-v1', 'Join page'],
    ['main-v1', 'Clinical record page'],
  ] as const)('on %s, opens the join page while an invitation link is held', async (contract, page) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    const { captureStaffInvitationFragment, forgetStaffInvitation } = await import('../invitationCapture')
    try {
      jsdom.reconfigure({ url: `https://ehr.healthidentitydirectory.com/provider/staff/join#0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a.${'A'.repeat(43)}` })
      expect(captureStaffInvitationFragment()).toBe(true)
      await signIn([...ORG_ADMIN, 'ehr.encounter.read'], `/provider/sign-in?returnTo=${encodeURIComponent('/provider/clinical')}`)
      expect(await screen.findByRole('heading', { name: page })).toBeTruthy()
    } finally { forgetStaffInvitation(); vi.unstubAllEnvs() }
  })

  it('opens the Clinical record for staff who can use it', async () => {
    await signIn([...ORG_ADMIN, 'ehr.encounter.read'])
    expect(await screen.findByRole('heading', { name: 'Clinical record page' })).toBeTruthy()
  })

  it.each([
    ['a facility administrator', ORG_ADMIN, 'Overview page'],
    ['a clinician', ['ehr.encounter.read', 'identity.patient.read'], 'Clinical record page'],
  ])('sends %s who is already signed in to the page they can use', async (_, permissions, page) => {
    calls.state = { status: 'ready', session: sessionWith(permissions) }
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    openAt('/provider/sign-in')
    expect(await screen.findByRole('heading', { name: page })).toBeTruthy()
  })
})

/**
 * Each step's heading, and a refused code's field, take focus in the commit that shows them: from an effect a task later,
 * a check made as soon as one was shown found focus still where it was (health#16's CI, on another page). Each request
 * is answered outside act, as a fetch's answer arrives.
 */
describe('focus as soon as it is shown', () => {
  const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined })
  function answer(settle: () => void) {
    environment.IS_REACT_ACT_ENVIRONMENT = false
    settle()
  }
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
  }
  const CHALLENGE = { kind: 'challenge', challenge: { status: 'mfa_required', expiresAt: '2026-10-14T09:10:00.000Z' } }
  const heading = (name: string) => () => screen.queryByRole('heading', { name })

  /** Sends the password step, whose answer `login` gives. */
  async function signIn() {
    const callbacks: Array<(token: string) => void> = []
    vi.stubGlobal('turnstile', { render: vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
      callbacks.push(options.callback as (token: string) => void)
      return `widget-${callbacks.length}`
    }), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    await waitFor(() => expect(callbacks).toHaveLength(1))
    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-password' } })
    act(() => callbacks[0]?.('token-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  /** Sends a code from the authenticator, whose answer `verifyMfa` gives. */
  async function verify() {
    await screen.findByRole('heading', { name: 'Confirm it’s you' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Sign-in code' }), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  }

  it('has focus on the second step’s heading as soon as the password step opens it (StaffMfaSteps)', async () => {
    const sent = deferred<unknown>()
    calls.login.mockReturnValueOnce(sent.promise)
    await signIn()
    const shown = focusWhenShown(heading('Confirm it’s you'))
    answer(() => sent.resolve(CHALLENGE))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on a refused code’s field as soon as it says why (StaffMfaSteps)', async () => {
    calls.login.mockResolvedValueOnce(CHALLENGE)
    const verified = deferred<never>()
    calls.verifyMfa.mockReturnValueOnce(verified.promise)
    await signIn()
    await verify()
    const shown = focusWhenShown(() => screen.queryByText(/^That code didn’t work\./))
    answer(() => verified.reject(new HidApiError(401, 'Invalid code', { code: 'MFA_INVALID_CODE' })))
    const { focused } = await shown
    expect(focused).toBe(screen.getByRole('textbox', { name: 'Sign-in code' }))
  })

  it('has focus on the password step’s heading as soon as a spent challenge goes back to it', async () => {
    calls.login.mockResolvedValueOnce(CHALLENGE)
    const verified = deferred<never>()
    calls.verifyMfa.mockReturnValueOnce(verified.promise)
    await signIn()
    await verify()
    // Shown as a paragraph while the second step is: a heading again once back at the password step.
    const shown = focusWhenShown(heading('Welcome back'))
    answer(() => verified.reject(new HidApiError(401, 'Sign in again', { code: 'MFA_CHALLENGE_INVALID' })))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
