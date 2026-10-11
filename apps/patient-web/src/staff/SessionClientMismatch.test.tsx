import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: 'test-site-key' }) }))

// The staff client binds fetch when its module loads, so each test loads the workspace afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/**
 * The provider and patient portals share one origin and its session cookies.
 * Opening the provider workspace while the browser holds a patient sign-in, its
 * refresh names `staff-web` and Identity (hid-system #39) refuses to rotate the
 * patient's sign-in: 403 SESSION_CLIENT_MISMATCH. That is not an expired staff
 * session, and the workspace must not sign anyone out over it.
 */

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const LOGIN = 'POST /api/v1/auth/login'
const ACCESS_REQUESTS = 'GET /api/v1/identity/access-requests'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) => json({ status, code, title: code, detail }, status)
const accessExpired = () => problem(401, 'AUTHENTICATION_REQUIRED')
const patientOwnsSession = () => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the patient application, not staff-web')
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'General Hospital',
  roles: ['doctor'], permissions: ['identity.consent.write'], isPrimary: true }
const staffSession = () => json({ actor: { kind: 'staff', id: 'staff:ada', displayName: 'Ada Clinician', roles: ['doctor'],
  permissions: facility.permissions, facilities: [facility], facility } })

/** Serves each route's answers in order and records every request with its X-HID-Client header. */
function serve(routes: Record<string, Array<() => Response>>) {
  const calls: Array<{ route: string; client: string | null }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push({ route, client: new Headers(init?.headers).get('X-HID-Client') })
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
  return calls
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

async function renderWorkspace() {
  const { App } = await import('./App')
  return render(<MemoryRouter initialEntries={['/provider']}>
    <CurrentPath />
    <Routes>
      <Route path="/provider/*" element={<App />} />
      <Route path="/" element={<p>Patient portal</p>} />
    </Routes>
  </MemoryRouter>)
}

const OTHER_PORTAL = 'This browser is signed in to a Health ID patient account'
const signInForm = () => screen.queryByRole('textbox', { name: 'Work email' })

/** A Turnstile widget that passes at once, so the real sign-in form can be submitted. */
function passHumanCheck() {
  vi.stubGlobal('turnstile', {
    render: (_host: HTMLElement, options: Record<string, unknown>) => { (options.callback as (token: string) => void)('turnstile-token'); return 'widget' },
    remove: vi.fn(), reset: vi.fn(),
  })
}

describe('provider workspace when the patient portal holds the browser session', () => {
  it('names staff-web on the refresh as it opens and says so, without signing out or sending to sign-in', async () => {
    const calls = serve({ [SESSION]: [accessExpired], [REFRESH]: [patientOwnsSession] })
    await renderWorkspace()
    expect(await screen.findByText(OTHER_PORTAL, { exact: false })).toBeTruthy()
    expect(calls.filter(call => call.route === REFRESH).map(call => call.client)).toEqual(['staff-web'])
    expect(calls.map(call => call.route)).not.toContain(LOGOUT)
    expect(screen.getByTestId('path').textContent).toBe('/provider')
    expect(screen.getByRole('link', { name: 'Sign in to the provider workspace' }).getAttribute('href')).toBe('/provider/sign-in')
    // No way into the patient portal from here: on a shared device it is someone else's.
    expect(screen.queryByRole('link', { name: /patient portal/i })).toBeNull()
    // No Sign out button that would end the patient's sign-in, and no raw backend wording.
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.queryByText(/patient application, not staff-web/)).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Sign in to the provider workspace' }))
    expect(screen.getByTestId('path').textContent).toBe('/provider/sign-in')
    expect(signInForm()).toBeTruthy()
    expect(calls.map(call => call.route)).toEqual([SESSION, REFRESH])
  })

  it('still treats an ended staff session as expiry: straight to sign-in', async () => {
    const calls = serve({ [SESSION]: [accessExpired], [REFRESH]: [accessExpired] })
    await renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/provider/sign-in'))
    expect(screen.queryByText(OTHER_PORTAL, { exact: false })).toBeNull()
    expect(calls.filter(call => call.route === REFRESH).map(call => call.client)).toEqual(['staff-web'])
    expect(calls.map(call => call.route)).not.toContain(LOGOUT)
  })

  it('stops the open workspace when a later refresh finds the patient portal holds the session', async () => {
    const calls = serve({ [SESSION]: [staffSession], [ACCESS_REQUESTS]: [accessExpired], [REFRESH]: [patientOwnsSession] })
    await renderWorkspace()
    expect(await screen.findByText(OTHER_PORTAL, { exact: false })).toBeTruthy()
    expect(calls.map(call => call.route)).toEqual([SESSION, ACCESS_REQUESTS, REFRESH])
    expect(calls.filter(call => call.route === REFRESH).map(call => call.client)).toEqual(['staff-web'])
    expect(screen.queryByText('Good to see you, Ada.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('opens the sign-in form from that notice without the workspace or its Sign out, then opens the workspace once staff sign in', async () => {
    passHumanCheck()
    const calls = serve({
      [SESSION]: [staffSession], [ACCESS_REQUESTS]: [accessExpired, () => json([])], [REFRESH]: [patientOwnsSession],
      [LOGIN]: [staffSession],
    })
    await renderWorkspace()
    await screen.findByText(OTHER_PORTAL, { exact: false })

    fireEvent.click(screen.getByRole('link', { name: 'Sign in to the provider workspace' }))
    // The form, not a bounce back to the workspace or the notice.
    expect(screen.getByTestId('path').textContent).toBe('/provider/sign-in')
    expect(signInForm()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.queryByText('Good to see you, Ada.')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct-horse' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Good to see you, Ada.')).toBeTruthy()
    expect(screen.queryByText(OTHER_PORTAL, { exact: false })).toBeNull()
    expect(calls.map(call => call.route)).toEqual([SESSION, ACCESS_REQUESTS, REFRESH, LOGIN, ACCESS_REQUESTS])
  })
})
