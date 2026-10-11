import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { isHidApiError } from '@hid/http'
import { SessionProvider, useSession } from '../session'
import { RequireAccess } from '../RequireAccess'
import { SignIn } from '../routes/SignIn'

// One environment object, as the real getEnvironment caches it: the session's API is built from it.
vi.mock('../env', () => {
  const environment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }
  return { getEnvironment: () => environment }
})

afterEach(() => { vi.unstubAllGlobals() })

/**
 * The patient and provider portals share one origin and its session cookies.
 * When the provider workspace signs in while a patient tab is open, the patient
 * tab's next refresh names `patient-web` and Identity (hid-system #39) refuses
 * to rotate the staff sign-in: 403 SESSION_CLIENT_MISMATCH. That is not an
 * expired session, and the patient portal must not sign anyone out over it.
 */

const SESSION = 'GET /api/v1/auth/session'
const PROFILE = 'GET /api/v1/identity/me'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const LOGIN = 'POST /api/v1/auth/patient/login'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) => json({ status, code, title: code, detail }, status)
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' } })
const accessExpired = () => problem(401, 'AUTHENTICATION_REQUIRED')
const staffOwnsSession = () => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the staff application, not patient-web')

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

/** A portal page: reads the profile once it opens, and shows what it got. */
function ProfilePage() {
  const { api, state } = useSession()
  const [shown, setShown] = useState('loading')
  useEffect(() => {
    void api.profile().then(() => setShown('profile'), (error: Error) => setShown(`error: ${error.message}`))
  }, [api])
  return <>
    <output data-testid="page">{shown}</output>
    <output data-testid="page-status">{state.status}</output>
  </>
}

/** What this tab believes about its own patient sign-in, whatever the route shows. */
function SessionStatus() {
  return <output data-testid="status">{useSession().state.status}</output>
}

function renderPortal() {
  return render(<MemoryRouter initialEntries={['/']}>
    <SessionProvider>
      <SessionStatus />
      <Routes>
        <Route path="/" element={<RequireAccess requirement={PATIENT_ROUTE}><ProfilePage /></RequireAccess>} />
        <Route path="/sign-in" element={<SignIn />} />
      </Routes>
    </SessionProvider>
  </MemoryRouter>)
}

/** Reads the profile on request, outside any route guard, and shows how the read ended. */
function ProfileRead() {
  const { api } = useSession()
  const [outcome, setOutcome] = useState('not read')
  return <>
    <output data-testid="read">{outcome}</output>
    <button type="button" onClick={() => {
      void api.profile().then(() => setOutcome('profile'),
        (error: unknown) => setOutcome(isHidApiError(error) ? `${error.status} ${error.code ?? ''}` : 'other'))
    }}>Read profile</button>
  </>
}

const NOTICE = 'This browser is signed in to the Health ID provider workspace'
const signInForm = () => screen.queryByRole('heading', { name: 'Welcome back.' })

describe('patient portal when the provider workspace holds the browser session', () => {
  it('names patient-web on the refresh and says the browser is signed in to the provider workspace, without signing out', async () => {
    const calls = serve({ [SESSION]: [patient], [PROFILE]: [accessExpired], [REFRESH]: [staffOwnsSession] })
    renderPortal()
    expect((await screen.findByRole('alert')).textContent).toContain(NOTICE)
    expect(calls.filter(call => call.route === REFRESH).map(call => call.client)).toEqual(['patient-web'])
    // No sign-out of either app: nothing asks the server to end the session the provider workspace holds.
    expect(calls.map(call => call.route)).not.toContain(LOGOUT)
    // Not sent to sign-in as if the session had expired; offered a deliberate way back in instead.
    expect(signInForm()).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in as a patient' }).getAttribute('href')).toBe('/sign-in')
    // No way into the provider workspace from here: on a shared device it is someone else's.
    expect(screen.queryByRole('link', { name: /provider workspace/i })).toBeNull()
    // The raw backend wording never reaches the page.
    expect(screen.queryByText(/staff application, not patient-web/)).toBeNull()
    // This tab forgets its patient sign-in locally, so sign-in can open.
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
  })

  it('opens the sign-in form from the notice, keeps the notice on the portal until a patient signs in, then opens the portal', async () => {
    const calls = serve({
      [SESSION]: [patient], [PROFILE]: [accessExpired, () => json({ patientId: 'patient-a' })], [REFRESH]: [staffOwnsSession],
      [LOGIN]: [patient],
    })
    renderPortal()
    await screen.findByText(NOTICE, { exact: false })

    fireEvent.click(screen.getByRole('link', { name: 'Sign in as a patient' }))
    expect(signInForm()).toBeTruthy()
    // Back to the portal without signing in: the notice again, not a loop of refreshes.
    fireEvent.click(screen.getByRole('link', { name: 'Health ID' }))
    expect((await screen.findByRole('alert')).textContent).toContain(NOTICE)
    expect(calls.filter(call => call.route === REFRESH)).toHaveLength(1)

    fireEvent.click(screen.getByRole('link', { name: 'Sign in as a patient' }))
    fireEvent.change(screen.getByLabelText('Email or Health ID'), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('profile'))
    expect(screen.queryByText(NOTICE, { exact: false })).toBeNull()
    expect(calls.map(call => call.route)).toEqual([SESSION, PROFILE, REFRESH, LOGIN, PROFILE])
  })

  it('fails the read that met the refusal with the mismatch, not as an ended session', async () => {
    // A refresh refused for want of a refresh cookie ends the session as a 401
    // (D-Eminence/Health-id#27). This refusal ends nothing, so the read says what happened.
    const calls = serve({ [SESSION]: [patient], [PROFILE]: [accessExpired], [REFRESH]: [staffOwnsSession] })
    render(<MemoryRouter><SessionProvider><SessionStatus /><ProfileRead /></SessionProvider></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'Read profile' }))
    await waitFor(() => expect(screen.getByTestId('read').textContent).toBe('403 SESSION_CLIENT_MISMATCH'))
    // Forgotten locally, so sign-in can open; nothing asked the server to sign out.
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(calls.map(call => call.route)).toEqual([SESSION, PROFILE, REFRESH])
  })

  it('still treats an ended patient session as expiry: back to sign-in, no provider notice', async () => {
    const calls = serve({ [SESSION]: [patient], [PROFILE]: [accessExpired], [REFRESH]: [accessExpired] })
    renderPortal()
    await waitFor(() => expect(signInForm()).toBeTruthy())
    expect(screen.queryByText(NOTICE, { exact: false })).toBeNull()
    expect(calls.filter(call => call.route === REFRESH).map(call => call.client)).toEqual(['patient-web'])
    expect(calls.map(call => call.route)).not.toContain(LOGOUT)
  })

  it('opens the portal normally once the refresh restores this patient', async () => {
    serve({ [SESSION]: [patient], [PROFILE]: [accessExpired, () => json({ patientId: 'patient-a' })], [REFRESH]: [patient] })
    renderPortal()
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('profile'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
