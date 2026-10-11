import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }) }))

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
