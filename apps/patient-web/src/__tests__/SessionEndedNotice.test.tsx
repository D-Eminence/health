import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

/**
 * HCS-06: a patient's session that ends while they use the portal (its refresh refused) sends them to sign-in, which
 * used to say nothing of why. The session now notes that it ended on its own, so sign-in can say so; a sign-out the
 * patient asked for, and the next sign-in, leave nothing to say.
 */
vi.mock('../env', () => {
  const environment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }
  return { getEnvironment: () => environment }
})
afterEach(() => { vi.unstubAllGlobals() })

const PROFILE = 'GET /api/v1/identity/me'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const LOGIN = 'POST /api/v1/auth/patient/login'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' }, expiresAt: '2026-11-03T12:00:00.000Z' })

function serve(routes: Record<string, Array<() => Response>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
}

function Probe() {
  const { state, api, sessionEnded, signOut, signIn } = useSession()
  return <>
    <output data-testid="status">{state.status}</output>
    <output data-testid="ended">{String(sessionEnded)}</output>
    <button type="button" onClick={() => { void api.profile().catch(() => undefined) }}>Read profile</button>
    <button type="button" onClick={() => { void signOut().catch(() => undefined) }}>Sign out</button>
    <button type="button" onClick={() => { void signIn('ada@example.com', 'typed-secret-123', 'turnstile-token').catch(() => undefined) }}>Sign in</button>
  </>
}

async function signedIn(routes: Record<string, Array<() => Response>>) {
  // The page reads the session when it opens, and a sign-out asks again.
  serve({ 'GET /api/v1/auth/session': [patient, patient], ...routes })
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  expect(screen.getByTestId('ended').textContent).toBe('false')
}
const press = async (name: string) => { await act(async () => { screen.getByRole('button', { name }).click() }) }

describe('a session that ends while the patient uses the portal', () => {
  it('is noted as ended when a read finds it gone and its refresh is refused', async () => {
    await signedIn({ [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    await press('Read profile')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(screen.getByTestId('ended').textContent).toBe('true')
  })

  it('is not noted as ended after the patient signs out', async () => {
    await signedIn({ [LOGOUT]: [() => new Response(null, { status: 204 })] })
    await press('Sign out')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(screen.getByTestId('ended').textContent).toBe('false')
  })

  it('is forgotten once the patient signs in again', async () => {
    await signedIn({ [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')],
      [LOGIN]: [patient] })
    await press('Read profile')
    await waitFor(() => expect(screen.getByTestId('ended').textContent).toBe('true'))
    await press('Sign in')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('ended').textContent).toBe('false')
  })

  it('is not noted on a first visit that finds no session', async () => {
    serve({ 'GET /api/v1/auth/session': [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    render(<SessionProvider><Probe /></SessionProvider>)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(screen.getByTestId('ended').textContent).toBe('false')
  })
})
