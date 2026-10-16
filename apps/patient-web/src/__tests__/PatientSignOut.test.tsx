import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

// One environment object, as the real getter caches it: a new one each render would
// rebuild the client and check the session again on every render.
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'locks') })

const LOGOUT = 'POST /api/v1/auth/logout'
const REFRESH = 'POST /api/v1/auth/refresh'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const patient = (subject: string) => json({
  actor: { kind: 'patient', subject, patientId: `patient-${subject}`, accountId: `account-${subject}` },
  expiresAt: '2026-10-11T12:00:00.000Z',
})
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const accessExpired = () => problem(401, 'AUTHENTICATION_REQUIRED')
const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE')
const noContent = () => new Response(null, { status: 204 })
// hid-system's staff actor carries no `kind`; one account can hold a patient and a staff session.
const staff = (subject: string) => json({ actor: { id: subject, subject, accountId: `account-${subject}`, roles: [], permissions: [] } })
const SESSION = 'GET /api/v1/auth/session'

/** Serves each route's answers in order and records every request, as `METHOD /path`. */
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

function Probe() {
  const { state, signOut } = useSession()
  const [failure, setFailure] = useState<string | null>(null)
  return <>
    <output data-testid="status">{state.status}</output>
    <button type="button" onClick={() => { setFailure(null); void signOut().catch((error: Error) => setFailure(error.message)) }}>Sign out</button>
    {failure && <p role="alert">{failure}</p>}
  </>
}

async function signedInAs(subject: string, routes: Record<string, Array<() => Response>>) {
  // The page reads the session when it opens, and a sign-out asks again.
  const calls = serve({ [SESSION]: Array.from({ length: 3 }, () => () => patient(subject)), ...routes })
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  return calls
}

/** Another window of the portal holding the session turn until released. */
function lockHeldElsewhere() {
  let release: () => void = () => {}
  const held = new Promise<void>(done => { release = done })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable) return callback(null)
    await held
    return callback({})
  }) } })
  return { release }
}

/** Web Locks with no other window holding the session turn. */
function freeTurn() {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    return callback({})
  }) } })
}

async function signOut() {
  await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
}

/**
 * Logout needs the 15-minute access token, while the refresh cookie lasts hours.
 * A patient who signs out after a longer idle must still end the server session,
 * or it stays restorable from this browser.
 */
describe('patient sign-out', () => {
  it('ends the server session with one logout while the access token is live', async () => {
    const calls = await signedInAs('subject-a', { [LOGOUT]: [noContent] })
    await signOut()
    expect(calls.filter(call => call !== 'GET /api/v1/auth/session')).toEqual([LOGOUT])
  })

  it('restores an idle session once and ends it on the server', async () => {
    const calls = await signedInAs('subject-a', { [LOGOUT]: [accessExpired, noContent], [REFRESH]: [() => patient('subject-a')] })
    await signOut()
    await waitFor(() => expect(calls.filter(call => call === LOGOUT)).toHaveLength(2))
    expect(calls.filter(call => call !== 'GET /api/v1/auth/session')).toEqual([LOGOUT, REFRESH, LOGOUT])
  })

  it('never revokes another account restored by the refresh', async () => {
    const calls = await signedInAs('subject-a', { [LOGOUT]: [accessExpired, noContent], [REFRESH]: [() => patient('subject-b')] })
    await signOut()
    await waitFor(() => expect(calls).toContain(REFRESH))
    await act(async () => { await Promise.resolve() })
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
  })

  it.each([
    ['still holds this patient\'s session', 'subject-a', [LOGOUT]],
    ['now holds another patient\'s session', 'subject-b', []],
  ])('waits for another window\'s turn, then signs out only while the browser %s', async (_label, holder, sent) => {
    let inBrowser = 'subject-a'
    const calls = await signedInAs('subject-a', {
      'GET /api/v1/auth/session': Array.from({ length: 5 }, () => () => patient(inBrowser)), [LOGOUT]: [noContent] })
    const before = calls.length
    const other = lockHeldElsewhere()
    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    expect(calls.slice(before)).toEqual([])

    inBrowser = holder
    other.release()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(calls.slice(before)).toEqual(['GET /api/v1/auth/session', ...sent])
  })

  it.each([
    ['another patient', 'a free turn', () => patient('subject-b'), freeTurn],
    ['the same person\'s staff session', 'a free turn', () => staff('subject-a'), freeTurn],
    ['another patient', 'no Web Locks', () => patient('subject-b'), () => {}],
    ['the same person\'s staff session', 'no Web Locks', () => staff('subject-a'), () => {}],
  ])('asks first, and leaves alone %s signed in from another window, with %s', async (_label, _turn, holder, setUpTurn) => {
    // The patient portal does not hear other windows sign in, so this window may be out of date.
    const calls = await signedInAs('subject-a', { [SESSION]: [() => patient('subject-a'), holder], [LOGOUT]: [noContent] })
    const before = calls.length
    setUpTurn()
    await signOut()
    expect(calls.slice(before)).toEqual([SESSION])
  })

  it('leaves alone the same person\'s staff session signed in while it waited its turn', async () => {
    const calls = await signedInAs('subject-a', { [SESSION]: [() => patient('subject-a'), () => staff('subject-a')], [LOGOUT]: [noContent] })
    const before = calls.length
    const other = lockHeldElsewhere()
    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    other.release()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(calls.slice(before)).toEqual([SESSION])
  })

  it('treats a refused check as it does a refused sign-out: restores this session and only then signs out', async () => {
    // A 401 there is not proof the session is this patient's: the server also sends it when it cannot check.
    const calls = await signedInAs('subject-a', {
      [SESSION]: [() => patient('subject-a'), accessExpired, () => patient('subject-a')],
      [REFRESH]: [() => patient('subject-a')], [LOGOUT]: [noContent] })
    const before = calls.length
    await signOut()
    await waitFor(() => expect(calls).toContain(LOGOUT))
    expect(calls.slice(before)).toEqual([SESSION, REFRESH, SESSION, LOGOUT])
  })

  it('never revokes the same person\'s staff session restored by the refresh', async () => {
    const calls = await signedInAs('subject-a', { [LOGOUT]: [accessExpired, noContent], [REFRESH]: [() => staff('subject-a')] })
    await signOut()
    await waitFor(() => expect(calls).toContain(REFRESH))
    await act(async () => { await Promise.resolve() })
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
  })

  it.each([
    ['the refresh that would restore it fails', {
      [SESSION]: [() => patient('subject-a'), accessExpired], [REFRESH]: [unavailable] }],
    ['the sign-out fails once it is restored', {
      [SESSION]: [() => patient('subject-a'), accessExpired, () => patient('subject-a')], [REFRESH]: [() => patient('subject-a')], [LOGOUT]: [unavailable] }],
    ['the sign-out itself is refused and the refresh that would restore it fails', {
      [SESSION]: [() => patient('subject-a'), () => patient('subject-a')], [LOGOUT]: [accessExpired], [REFRESH]: [unavailable] }],
  ])('keeps the patient signed in, and says so, when the access token expired and %s', async (_label, routes) => {
    // The 401 that starts the restore is the sign-out's to judge: had it signed the
    // tab out, the portal would show sign-in while the server session stayed live.
    await signedInAs('subject-a', routes)
    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    expect((await screen.findByRole('alert')).textContent).toBe('UPSTREAM_UNAVAILABLE')
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
  })

  it('signs out locally when no session is left to restore', async () => {
    const calls = await signedInAs('subject-a', { [LOGOUT]: [accessExpired], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    await signOut()
    await waitFor(() => expect(calls).toContain(REFRESH))
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
  })
})
