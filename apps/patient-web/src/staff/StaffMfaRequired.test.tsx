import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * A staff sign-in made without an authenticator (every sign-in from before
 * hid-system #71 and migration 0088, or one whose authenticator was reset) is
 * refused on every guarded route with 403 STAFF_MFA_REQUIRED: the session read,
 * the facility switch and every EHR, Lab, Pharmacy, OCR and Outreach route.
 * Its refresh answers the same, ends the sign-in and clears the cookies; sign-out
 * still works. The real staff App, API module and HTTP client run; only the
 * network is replaced.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// Provider sign-in also asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const FACILITY = 'POST /api/v1/auth/facility'
const REQUESTS = 'GET /api/v1/identity/access-requests'

type Answer = () => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
/** Identity's answer to a sign-in without MFA assurance (token.service.ts staffMfaRequired). */
const mfaRequired = () => problem(403, 'STAFF_MFA_REQUIRED', 'Sign in again with your authenticator code to continue')
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
/** The refresh once the refused refresh above cleared the cookies. */
const refreshCookieGone = () => problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')
const unavailable = () => problem(503, 'DEPENDENCY_UNAVAILABLE', 'Audit persistence is unavailable; request was denied')
const facility = (id: string, name: string) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name,
  roles: ['clinician'], permissions: ['identity.consent.write'], isPrimary: id === 'facility-1' })
const staffSession = () => json({ actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities: [facility('facility-1', 'Lagos General'), facility('facility-2', 'Ikeja Clinic')],
  facility: facility('facility-1', 'Lagos General') }, expiresAt: '2026-10-14T12:00:00.000Z', facilitySelection: 'selected' })

const SIGN_IN = 'Welcome back.'
const SESSION_ENDED = 'Your session has ended'
const UNCONFIRMED = 'We could not confirm your session'
const NOTICE = 'Staff now need a code from an authenticator app to sign in. Sign in again to set one up, or to use the one you have.'

/** Serves each `METHOD /path` from its own queue and records every request. */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    calls.push(route)
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return calls
}

/** The portal's other tabs, as BroadcastChannel would connect them. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage() {}
  close() { TabChannel.open.delete(this) }
}
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

beforeEach(() => { TabChannel.open.clear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/** Where the router is (not an <output>, whose implicit role is the status the notice has). */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

/** The workspace is replaced by the session-ended screen, which says why, and nothing of the server's wording. */
async function expectEndedForMfa() {
  const heading = await screen.findByRole('heading', { name: SESSION_ENDED })
  expect(heading.closest('section')?.textContent).toContain(NOTICE)
  expect(screen.queryByRole('heading', { name: UNCONFIRMED })).toBeNull()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByText(/STAFF_MFA_REQUIRED|authenticator code to continue/)).toBeNull()
}

async function expectSignInWithNotice() {
  expect(await screen.findByRole('heading', { name: SIGN_IN })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe(`Info: ${NOTICE}`)
  expect(screen.queryByText('Session unavailable')).toBeNull()
  expect(screen.getByTestId('where').textContent).toBe('/provider/sign-in')
}

describe('opening the workspace with a sign-in made without an authenticator', () => {
  it('goes to sign-in, saying an authenticator code is now needed, once the refresh ends that sign-in', async () => {
    const calls = serve({ [SESSION]: [mfaRequired], [REFRESH]: [mfaRequired] })
    await open('/provider')

    await expectSignInWithNotice()
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('says the same when the access token had expired and the refresh is what refuses it', async () => {
    const calls = serve({ [SESSION]: [ended], [REFRESH]: [mfaRequired] })
    await open('/provider/requests')

    await expectSignInWithNotice()
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('stays on the error screen, signed in, when the refresh cannot be answered (503)', async () => {
    const calls = serve({ [SESSION]: [mfaRequired], [REFRESH]: [unavailable] })
    await open('/provider')

    expect(await screen.findByRole('heading', { name: 'Session unavailable' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: SIGN_IN })).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('says nothing of authenticators when the sign-in simply ended', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended] })
    await open('/provider')

    expect(await screen.findByRole('heading', { name: SIGN_IN })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/authenticator/)).toBeNull()
  })
})

describe('a sign-in without an authenticator refused mid-session', () => {
  it('ends the workspace when a read is refused, once the server confirms it, instead of leaving it unconfirmed', async () => {
    const calls = serve({ [SESSION]: [staffSession, mfaRequired], [REQUESTS]: [mfaRequired], [REFRESH]: [mfaRequired] })
    await open('/provider')

    await expectEndedForMfa()
    expect(calls).toEqual([SESSION, REQUESTS, SESSION, REFRESH])
    expect(calls).not.toContain(LOGOUT)
  })

  it('says why after an expired access token, though the refresh that refused it also cleared the cookies', async () => {
    const calls = serve({ [SESSION]: [staffSession, ended], [REQUESTS]: [ended], [REFRESH]: [mfaRequired, refreshCookieGone] })
    await open('/provider')

    await expectEndedForMfa()
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, REFRESH])
  })

  it('ends the workspace when a facility switch is refused', async () => {
    const calls = serve({ [SESSION]: [staffSession, ended], [REQUESTS]: [() => json([])], [FACILITY]: [mfaRequired],
      [REFRESH]: [mfaRequired, refreshCookieGone] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))

    await expectEndedForMfa()
    expect(calls).toEqual([SESSION, REQUESTS, FACILITY, REFRESH, SESSION, REFRESH])
  })

  it('ends the workspace when another tab says the session changed and the server refuses it', async () => {
    const calls = serve({ [SESSION]: [staffSession, mfaRequired], [REQUESTS]: [() => json([])], [REFRESH]: [mfaRequired] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fromAnotherTab()

    await expectEndedForMfa()
    expect(calls).toEqual([SESSION, REQUESTS, SESSION, REFRESH])
  })

  it('says so again on the sign-in page the ended screen leads to', async () => {
    serve({ [SESSION]: [staffSession, mfaRequired], [REQUESTS]: [mfaRequired], [REFRESH]: [mfaRequired] })
    await open('/provider')
    await expectEndedForMfa()

    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    expect(await screen.findByRole('heading', { name: SIGN_IN })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(`Info: ${NOTICE}`)
  })

  it('names no authenticator for a later end once the server accepted the session again', async () => {
    // Another tab signed the same account in with an authenticator: the browser's session is accepted again.
    const calls = serve({ [SESSION]: [staffSession, staffSession, ended], [REQUESTS]: [mfaRequired], [REFRESH]: [ended] })
    await open('/provider')
    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, SESSION]))
    await waitFor(() => expect(document.querySelector('[inert]')).toBeNull())
    expect(screen.getByRole('navigation')).toBeTruthy()
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())

    const heading = await screen.findByRole('heading', { name: SESSION_ENDED })
    expect(heading.closest('section')?.textContent).not.toContain('authenticator')
    expect(calls).toEqual([SESSION, REQUESTS, SESSION, SESSION, REFRESH])
  })
})
