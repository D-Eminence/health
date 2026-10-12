import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

/**
 * Windows of the portal take turns to refresh (sessionRefreshTurn.ts), and one
 * that waited reads the session first, since the window before it has usually
 * just refreshed it. A refresh answers for whichever sign-in the browser holds
 * then, so only this patient's session counts as restored: anything else ends
 * this tab's session and the read is not repeated as that account (SEC-PATIENT-XTAB).
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'locks') })

const SESSION = 'GET /api/v1/auth/session'
const PROFILE = 'GET /api/v1/identity/me'
const REFRESH = 'POST /api/v1/auth/refresh'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const patient = (subject: string) => () => json({ actor: { kind: 'patient', subject, patientId: `patient-${subject}`, accountId: `account-${subject}` } })
// hid-system's staff actor carries no `kind`.
const staff = () => json({ actor: { id: 'staff-1', subject: 'staff-1', accountId: 'account-s', roles: [], permissions: [] } })
const accessExpired = () => problem(401, 'AUTHENTICATION_REQUIRED')

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

/** Another window held the refresh turn, and has just released it. */
function turnHeldElsewhere() {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    return callback(options.ifAvailable ? null : {})
  }) } })
}

let outcome: string | undefined
function Probe() {
  const { state, api } = useSession()
  return <>
    <output data-testid="status">{state.status}</output>
    <button type="button" onClick={() => { void api.profile().then(() => { outcome = 'loaded' }, (error: { status?: number }) => { outcome = String(error.status) }) }}>Read profile</button>
  </>
}

async function readAfterWaiting(routes: Record<string, Array<() => Response>>) {
  turnHeldElsewhere()
  outcome = undefined
  const calls = serve(routes)
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
  await waitFor(() => expect(outcome).toBeDefined())
  return calls
}

describe('a read whose refresh waited for another window', () => {
  it('takes this patient\'s session, refreshed by the other window, and repeats the read', async () => {
    const calls = await readAfterWaiting({ [SESSION]: [patient('subject-a'), patient('subject-a')],
      [PROFILE]: [accessExpired, () => json({ hid: 'HID-A' })] })
    expect(outcome).toBe('loaded')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(calls).not.toContain(REFRESH)
  })

  it('refreshes when the session it read first has expired too, and keeps this patient signed in', async () => {
    const calls = await readAfterWaiting({ [SESSION]: [patient('subject-a'), accessExpired],
      [PROFILE]: [accessExpired, () => json({ hid: 'HID-A' })], [REFRESH]: [patient('subject-a')] })
    expect(outcome).toBe('loaded')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(calls.filter(call => call === REFRESH)).toHaveLength(1)
  })

  it('does not take another patient\'s session as restored, and repeats nothing', async () => {
    const calls = await readAfterWaiting({ [SESSION]: [patient('subject-a'), patient('subject-b')],
      [PROFILE]: [accessExpired, () => json({ hid: 'HID-B' })] })
    expect(outcome).toBe('401')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(calls.filter(call => call === PROFILE)).toHaveLength(1)
  })

  it('does not take a provider\'s session as restored: it asks Identity, which refuses, and repeats nothing', async () => {
    const calls = await readAfterWaiting({ [SESSION]: [patient('subject-a'), staff],
      [PROFILE]: [accessExpired, () => json({ hid: 'HID-STAFF' })], [REFRESH]: [() => problem(403, 'SESSION_CLIENT_MISMATCH')] })
    expect(outcome).toBe('401')
    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(calls.filter(call => call === PROFILE)).toHaveLength(1)
    expect(calls).toContain(REFRESH)
  })
})
