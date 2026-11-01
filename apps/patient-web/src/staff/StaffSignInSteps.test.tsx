import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type * as AppModule from './App'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * Staff sign-in in two steps (hid-system #71, ADR-054, 0088). The password step
 * answers with the second step Identity asks for and only an httpOnly challenge
 * cookie; verify, or activation after a first enrolment, answers with the
 * session. An Identity before #71 answers the password step with the session, so
 * the portal accepts both and either may be deployed first. The real staff App,
 * API module and HTTP client run; only the network is replaced.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// Provider sign-in also asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGIN = 'POST /api/v1/auth/login'
const VERIFY = 'POST /api/v1/auth/mfa/verify'
const ACTIVATE = 'POST /api/v1/auth/mfa/enroll/activate'
const REQUESTS = 'GET /api/v1/identity/access-requests'

type Answer = () => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['clinician'],
  permissions: ['identity.consent.write'], isPrimary: true }
const sessionBody = (id = 'staff-1') => ({ actor: { id, email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'],
  permissions: [], facilities: [facility], facility }, expiresAt: '2026-10-14T12:00:00.000Z', facilitySelection: 'default' })
const challenge = (status: 'mfa_required' | 'mfa_enrollment_required') => () => json({ status, expiresAt: '2026-10-14T09:05:00.000Z' })

/** Serves each `METHOD /path` from its own queue and records every request. */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return calls
}

/** The portal's other tabs, as BroadcastChannel would connect them; `posted` is what this tab told them. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  static posted: unknown[] = []
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage(message: unknown) { TabChannel.posted.push(message) }
  close() { TabChannel.open.delete(this) }
}
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

beforeEach(() => { TabChannel.open.clear(); TabChannel.posted = []; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

async function openSignIn(path = '/provider/sign-in') {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy()
}

function signIn() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery staple' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('the password step', () => {
  it('opens the workspace when an Identity before staff MFA answers with the session', async () => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [() => json(sessionBody())], [REQUESTS]: [() => json([])] })
    await openSignIn('/provider/sign-in?returnTo=%2Fprovider%2Frequests')
    signIn()

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/requests'))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, REQUESTS])
    expect(TabChannel.posted).toEqual(['changed'])
  })

  it.each([
    ['mfa_required', 'Confirm it’s you'],
    ['mfa_enrollment_required', 'Set up sign-in codes'],
  ] as const)('asks for the second step Identity names (%s), opening nothing yet', async (status, step) => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge(status)] })
    await openSignIn()
    signIn()

    expect(await screen.findByRole('heading', { name: step })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/provider/sign-in')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH, LOGIN])
    // The password step set no session cookie: the other tabs are told nothing.
    expect(TabChannel.posted).toEqual([])
  })

  // STAFF_MFA_FACTOR_UNPROVEN, the other right-password refusal, is said in the portal's words (StaffMfaSignIn.test.tsx).
  it.each([
    ['NO_ACTIVE_FACILITY_MEMBERSHIP', 'Your account has no active facility membership. Ask your organization administrator for access.'],
  ])('shows Identity\'s own words for a right password it refuses (403 %s), and stays', async (code, detail) => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [() => problem(403, code, detail)] })
    await openSignIn()
    signIn()

    expect((await screen.findByRole('alert')).textContent).toBe(detail)
    expect(screen.getByTestId('where').textContent).toBe('/provider/sign-in')
    expect(calls).toEqual([SESSION, REFRESH, LOGIN])
  })

  it('opens nothing on an answer that is neither a second step nor a session', async () => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [() => json({ status: 'mfa_method_choice', expiresAt: '2026-10-14T09:05:00.000Z' })] })
    await openSignIn()
    signIn()

    expect((await screen.findByRole('alert')).textContent).toBe('The service returned an unreadable response.')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH, LOGIN])
  })

  it('offers no Google sign-in: Identity refuses a staff Google exchange (403 GOOGLE_STAFF_SIGN_IN_DISABLED)', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended] })
    await openSignIn()

    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByText(/google/i)).toBeNull()
    const { staffApi } = await import('./api')
    expect(Object.keys(staffApi).filter(name => /google|oidc/i.test(name))).toEqual([])
  })
})

/** The provider's sign-in steps, as the MFA screens use them; `staff` is the context of the latest render. */
let staff: ReturnType<typeof AppModule.useStaff>
async function openProvider() {
  const { StaffProvider, useStaff } = await import('./App')
  function Probe() {
    staff = useStaff()
    return <span data-testid="status">{staff.state.status}</span>
  }
  render(<StaffProvider><Probe /></StaffProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'))
}

describe('the second step and completeSignIn', () => {
  it('opens the session verify answered with, and tells the other tabs once', async () => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')], [VERIFY]: [() => json(sessionBody())] })
    await openProvider()

    let answer: Awaited<ReturnType<typeof staff.login>> | undefined
    await act(async () => { answer = await staff.login('ada@example.test', 'correct horse battery staple') })
    expect(answer).toEqual({ kind: 'challenge', challenge: { status: 'mfa_required', expiresAt: '2026-10-14T09:05:00.000Z' } })
    expect(screen.getByTestId('status').textContent).toBe('signed-out')

    await act(async () => { staff.completeSignIn(await staff.verifyMfa({ code: '123456' })) })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(staff.state.status === 'ready' && staff.state.session.actor.id).toBe('staff-1')
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, VERIFY])
    expect(TabChannel.posted).toEqual(['changed'])
  })

  it('asks the server once open when another tab changed the session while verify was on its way', async () => {
    let verifyAnswers: (response: Response) => void = () => {}
    const calls = serve({ [SESSION]: [ended, () => json(sessionBody())], [REFRESH]: [ended],
      [VERIFY]: [() => new Promise<Response>(resolve => { verifyAnswers = resolve })] })
    await openProvider()

    let verifying: Promise<unknown> = Promise.resolve()
    act(() => { verifying = staff.verifyMfa({ code: '123456' }).then(session => staff.completeSignIn(session)) })
    await waitFor(() => expect(calls).toContain(VERIFY))
    fromAnotherTab()
    verifyAnswers(json(sessionBody()))
    await act(async () => { await verifying })

    await waitFor(() => expect(calls).toEqual([SESSION, REFRESH, VERIFY, SESSION]))
    await waitFor(() => expect(document.querySelector('[data-testid="status"]')?.textContent).toBe('ready'))
  })

  it('does not ask for a change another tab made before verify was sent: the new cookies came after it', async () => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [VERIFY]: [() => json(sessionBody())] })
    await openProvider()
    fromAnotherTab()

    await act(async () => { staff.completeSignIn(await staff.verifyMfa({ code: '123456' })) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(calls).toEqual([SESSION, REFRESH, VERIFY])
    expect(screen.getByTestId('status').textContent).toBe('ready')
  })

  it('tells the other tabs as soon as activation sets the session, and opens it only when asked', async () => {
    const recoveryCodes = ['ABCDE-FGHJK', 'MNPQR-STVWX']
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [ended], [ACTIVATE]: [() => json({ ...sessionBody(), recoveryCodes })] })
    await openProvider()

    let activated: Awaited<ReturnType<typeof staff.activateEnrollment>> | undefined
    await act(async () => { activated = await staff.activateEnrollment('123456') })
    expect(activated?.recoveryCodes).toEqual(recoveryCodes)
    // The recovery codes are shown before the workspace opens; the browser already holds the session.
    expect(screen.getByTestId('status').textContent).toBe('signed-out')
    expect(TabChannel.posted).toEqual(['changed'])

    act(() => { staff.completeSignIn(activated!) })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(calls).toEqual([SESSION, REFRESH, ACTIVATE])
  })

  it('opens no workspace for a patient\'s session', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended] })
    await openProvider()

    expect(() => act(() => { staff.completeSignIn({ actor: { kind: 'patient', id: 'patient-1', roles: [], permissions: [], facilities: [] } }) }))
      .toThrow('A staff account is required for this portal.')
    expect(screen.getByTestId('status').textContent).toBe('signed-out')
    expect(TabChannel.posted).toEqual([])
  })
})
