import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { RequireAccess } from '../RequireAccess'
import { SessionProvider, useSession } from '../session'

// One environment for the whole run, as the app's own: a new one each render would make a new client, and check the
// session again on every render.
vi.mock('../env', () => {
  const environment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }
  return { getEnvironment: () => environment }
})

afterEach(() => { vi.unstubAllGlobals() })

const PROFILE = 'GET /api/v1/identity/me'
const REFRESH = 'POST /api/v1/auth/refresh'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const patient = () => json({
  actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
  expiresAt: '2026-10-11T12:00:00.000Z',
})

function serve(routes: Record<string, Array<() => Response>>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
  return calls
}

let outcome: string | undefined
function Probe() {
  const { state, api } = useSession()
  return <>
    <output data-testid="status">{state.status}</output>
    <button type="button" onClick={() => {
      void api.profile().then(() => { outcome = 'loaded' }, (error: { status?: number }) => { outcome = String(error.status) })
    }}>Read profile</button>
  </>
}

async function signedIn(routes: Record<string, Array<() => Response>>) {
  outcome = undefined
  const calls = serve({ 'GET /api/v1/auth/session': [patient], ...routes })
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
  await waitFor(() => expect(outcome).toBeDefined())
  return calls
}

/**
 * The access token lasts 15 minutes; a read after that refreshes once. Without a
 * refresh cookie (expired, or cleared by a sign-out in another tab) the backend
 * refuses the refresh with 403 CSRF_VALIDATION_FAILED, which means the session
 * has ended: the patient returns to sign-in rather than seeing the refusal.
 */
describe('a read after the access token expired', () => {
  it('ends the session when the refresh is refused for want of a refresh cookie', async () => {
    const calls = await signedIn({ [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    expect(outcome).toBe('401')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(calls.filter(call => call !== 'GET /api/v1/auth/session')).toEqual([PROFILE, REFRESH])
  })

  it('repeats the read once after a successful refresh', async () => {
    await signedIn({ [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED'), () => json({ hid: 'HID-ABCDEF' })],
      [REFRESH]: [patient] })
    expect(outcome).toBe('loaded')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
  })

  it('keeps the session when the refresh could not be made', async () => {
    await signedIn({ [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      [REFRESH]: [() => problem(503, 'IDENTITY_SERVICE_UNAVAILABLE')] })
    expect(outcome).toBe('503')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
  })
})

/**
 * The access cookie expires with its 15-minute token, while the refresh cookie lasts the patient's sign-in (7 days
 * idle, 30 at most: owner decision 2026-10-28). A page opened after that idle finds no access cookie, and the client
 * never refreshes for an auth/ path itself, so the first session check restores the session once before it is judged.
 */
describe('a page opened after the access token expired', () => {
  const SESSION = 'GET /api/v1/auth/session'

  function Checked() {
    const { state, sessionError, otherPortalSession } = useSession()
    return <>
      <output data-testid="status">{state.status}</output>
      <output data-testid="error">{sessionError ?? ''}</output>
      <output data-testid="other-portal">{String(otherPortalSession)}</output>
    </>
  }

  let signInShown = false
  function SignInPage() { signInShown = true; return <p>Sign-in page</p> }

  function open(routes: Record<string, Array<() => Response>>) {
    signInShown = false
    const calls = serve(routes)
    render(<SessionProvider><MemoryRouter initialEntries={['/profile']}><Routes>
      <Route path="/profile" element={<RequireAccess requirement={PATIENT_ROUTE}><p>Profile page</p></RequireAccess>} />
      <Route path="/sign-in" element={<SignInPage />} />
    </Routes><Checked /></MemoryRouter></SessionProvider>)
    return calls
  }

  it('restores the patient session with the refresh cookie instead of sending the patient to sign-in', async () => {
    const calls = open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [patient] })
    await screen.findByText('Profile page')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(signInShown).toBe(false)
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('signs out when the refresh is refused for want of a live refresh cookie', async () => {
    const calls = open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    await screen.findByText('Sign-in page')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(screen.getByTestId('other-portal').textContent).toBe('false')
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('signs out on a refused refresh that answers 401', async () => {
    open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(401, 'AUTHENTICATION_REQUIRED')] })
    await screen.findByText('Sign-in page')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(screen.getByTestId('error').textContent).toBe('')
  })

  it("says the browser holds a provider's sign-in when Identity refuses the refresh as another portal's", async () => {
    open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'SESSION_CLIENT_MISMATCH')] })
    await screen.findByText('Sign-in page')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(screen.getByTestId('other-portal').textContent).toBe('true')
  })

  it("never takes up a provider's restored session as a patient's", async () => {
    open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      [REFRESH]: [() => json({ actor: { kind: 'staff', subject: 'staff-1' }, expiresAt: '2026-10-11T12:00:00.000Z' })] })
    await screen.findByText('Sign-in page')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(screen.getByTestId('other-portal').textContent).toBe('true')
  })

  it('says the session could not be checked when the refresh could not be made', async () => {
    open({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(503, 'IDENTITY_SERVICE_UNAVAILABLE')] })
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('We could not check your session. Try again.'))
    expect(screen.getByText('We could not check your session')).toBeTruthy()
    expect(signInShown).toBe(false)
  })
})
