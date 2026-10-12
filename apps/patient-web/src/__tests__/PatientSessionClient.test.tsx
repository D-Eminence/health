import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

/**
 * The patient portal names itself in X-HID-Client on its cookie refresh and
 * sign-out (hid-system #39). The provider portal shares the origin and its
 * cookies, so Identity refuses a refresh or sign-out of a provider's sign-in
 * from this portal with 403 SESSION_CLIENT_MISMATCH: nothing rotates or ends,
 * and the cookies are kept. The patient's sign-in has then left this browser.
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const PROFILE = 'GET /api/v1/identity/me'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) =>
  json({ type: 'about:blank', title: code, status, code, detail }, status)
const patient = () => json({
  actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
  expiresAt: '2026-10-12T12:00:00.000Z',
})
const accessExpired = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const providerHoldsCookies = () => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the staff application, not patient-web')
const noContent = () => new Response(null, { status: 204 })

type Answer = () => Response | Promise<Response>
interface Sent { route: string; headers: Headers }

/** Serves each `METHOD /path` from its own queue and records every request with its headers. */
function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push({ route, headers: new Headers(init?.headers) })
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
  return sent
}

/** Announcements to the origin's other tabs, as BroadcastChannel would carry them. */
let announced: unknown[] = []
class RecordingChannel {
  constructor(readonly name: string) {}
  postMessage(message: unknown) { announced.push(message) }
  close() {}
}

beforeEach(() => {
  announced = []
  vi.stubGlobal('BroadcastChannel', RecordingChannel)
  // The readable CSRF cookie the portal sends back on its writes.
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('hid_access_csrf=csrf-a')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

let outcome: string | undefined
function Probe() {
  const { state, api, signOut, signedOutElsewhere } = useSession()
  return <>
    <output data-testid="status">{state.status}</output>
    <output data-testid="elsewhere">{String(signedOutElsewhere)}</output>
    <button type="button" onClick={() => {
      void api.profile().then(() => { outcome = 'loaded' }, (error: { status?: number; code?: string }) => { outcome = `${error.status} ${error.code}` })
    }}>Read profile</button>
    <button type="button" onClick={() => { void signOut().then(() => { outcome = 'signed out' }, (error: { status?: number }) => { outcome = `failed ${error.status}` }) }}>Sign out</button>
  </>
}

async function signedIn(routes: Record<string, Answer[]>) {
  outcome = undefined
  const sent = serve({ ...routes, [SESSION]: [patient, ...(routes[SESSION] ?? [])] })
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  return sent
}

async function press(name: string) {
  await act(async () => { screen.getByRole('button', { name }).click() })
  await waitFor(() => expect(outcome).toBeDefined())
  // Let anything the answer schedules run, so a loop would show.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const status = () => screen.getByTestId('status').textContent
const routes = (sent: Sent[]) => sent.map(call => call.route).filter(route => route !== SESSION)
const client = (sent: Sent[], route: string) => sent.filter(call => call.route === route).map(call => call.headers.get('X-HID-Client'))

describe('the patient portal names itself on its cookie refresh and sign-out', () => {
  it('sends X-HID-Client: patient-web, with its CSRF token, on the refresh for an expired read, and not on the read', async () => {
    const sent = await signedIn({ [PROFILE]: [accessExpired, () => json({ hid: 'HID-ABCDEF' })], [REFRESH]: [patient] })
    await press('Read profile')
    expect(outcome).toBe('loaded')
    expect(client(sent, REFRESH)).toEqual(['patient-web'])
    expect(sent.find(call => call.route === REFRESH)?.headers.get('X-CSRF-Token')).toBe('csrf-a')
    expect(client(sent, PROFILE)).toEqual([null, null])
    expect(client(sent, SESSION).every(value => value === null)).toBe(true)
  })

  it('sends X-HID-Client: patient-web, with its CSRF token, on sign-out', async () => {
    const sent = await signedIn({ [SESSION]: [patient], [LOGOUT]: [noContent] })
    await press('Sign out')
    expect(outcome).toBe('signed out')
    expect(client(sent, LOGOUT)).toEqual(['patient-web'])
    expect(sent.find(call => call.route === LOGOUT)?.headers.get('X-CSRF-Token')).toBe('csrf-a')
    expect(announced).toEqual(['changed'])
  })
})

describe('SESSION_CLIENT_MISMATCH: the browser holds a provider\'s sign-in now', () => {
  it('ends only this portal\'s session when the refresh for a read is refused, and repeats nothing', async () => {
    const sent = await signedIn({ [PROFILE]: [accessExpired], [REFRESH]: [providerHoldsCookies] })
    await press('Read profile')
    expect(outcome).toBe('401 AUTHENTICATION_REQUIRED')
    expect(status()).toBe('anonymous')
    // Another account's sign-in, as a return to view finds it: sign-in says the sign-in changed elsewhere.
    expect(screen.getByTestId('elsewhere').textContent).toBe('true')
    expect(routes(sent)).toEqual([PROFILE, REFRESH])
    // The cookies were kept: no other tab is told they changed.
    expect(announced).toEqual([])
    expect(screen.queryByText(/staff application|patient-web|SESSION_CLIENT_MISMATCH/)).toBeNull()
  })

  it('blames no other tab when a refresh is refused for a tab that showed no patient', async () => {
    outcome = undefined
    serve({ [SESSION]: [accessExpired], [PROFILE]: [accessExpired], [REFRESH]: [providerHoldsCookies] })
    render(<SessionProvider><Probe /></SessionProvider>)
    await waitFor(() => expect(status()).toBe('anonymous'))
    await press('Read profile')
    expect(outcome).toBe('401 AUTHENTICATION_REQUIRED')
    expect(screen.getByTestId('elsewhere').textContent).toBe('false')
  })

  it('signs out locally when the sign-out itself is refused, without retrying or refreshing', async () => {
    const sent = await signedIn({ [SESSION]: [patient], [LOGOUT]: [providerHoldsCookies] })
    await press('Sign out')
    expect(outcome).toBe('signed out')
    expect(status()).toBe('anonymous')
    expect(routes(sent)).toEqual([LOGOUT])
    expect(announced).toEqual([])
  })

  it('signs out locally after an idle period when the restoring refresh is refused, and sends no sign-out', async () => {
    const sent = await signedIn({ [SESSION]: [accessExpired], [REFRESH]: [providerHoldsCookies] })
    await press('Sign out')
    expect(outcome).toBe('signed out')
    expect(status()).toBe('anonymous')
    expect(routes(sent)).toEqual([REFRESH])
    expect(client(sent, REFRESH)).toEqual(['patient-web'])
    expect(announced).toEqual([])
  })

  it('signs out locally when the sign-out after a restoring refresh is refused', async () => {
    const sent = await signedIn({ [SESSION]: [accessExpired, patient], [REFRESH]: [patient], [LOGOUT]: [providerHoldsCookies] })
    await press('Sign out')
    expect(outcome).toBe('signed out')
    expect(status()).toBe('anonymous')
    expect(routes(sent)).toEqual([REFRESH, LOGOUT])
    expect(announced).toEqual([])
  })
})

describe('other refusals keep their own handling', () => {
  it('ends the session when the refresh cookie is gone (403 CSRF_VALIDATION_FAILED)', async () => {
    const sent = await signedIn({ [PROFILE]: [accessExpired], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    await press('Read profile')
    expect(status()).toBe('anonymous')
    expect(routes(sent)).toEqual([PROFILE, REFRESH])
  })

  it('ends the session when the refresh is refused (401)', async () => {
    const sent = await signedIn({ [PROFILE]: [accessExpired], [REFRESH]: [accessExpired] })
    await press('Read profile')
    expect(status()).toBe('anonymous')
    expect(routes(sent)).toEqual([PROFILE, REFRESH])
  })

  it('keeps the session when the refresh could not reach the server', async () => {
    const sent = await signedIn({ [PROFILE]: [accessExpired], [REFRESH]: [() => { throw new TypeError('Failed to fetch') }] })
    await press('Read profile')
    expect(outcome).toMatch(/^0 /)
    expect(status()).toBe('authenticated')
    expect(routes(sent)).toEqual([PROFILE, REFRESH])
  })

  it('keeps the session and says so when the sign-out fails (503), without retrying', async () => {
    const sent = await signedIn({ [SESSION]: [patient], [LOGOUT]: [() => problem(503, 'UPSTREAM_UNAVAILABLE')] })
    await press('Sign out')
    expect(outcome).toBe('failed 503')
    expect(status()).toBe('authenticated')
    expect(routes(sent)).toEqual([LOGOUT])
  })
})
