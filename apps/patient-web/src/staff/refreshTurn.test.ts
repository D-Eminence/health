import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as SessionModule from './session'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); Reflect.deleteProperty(navigator, 'locks') })

/** Another window of the portal holding the refresh lock until released. */
function lockHeldElsewhere() {
  let release: () => void = () => {}
  const held = new Promise<void>(done => { release = done })
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable) return callback(null)
    await held
    return callback({})
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return { release }
}

describe('a staff session refresh while another window refreshes', () => {
  it('waits its turn and uses the session the other window restored, sending no second refresh', async () => {
    const other = lockHeldElsewhere()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push(`${String(init.method)} ${new URL(String(url)).pathname}`)
      return new Response(JSON.stringify({ actor: { id: 'staff-1', kind: 'staff' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { staffApi } = await import('./api')

    const refreshed = staffApi.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()

    await expect(refreshed).resolves.toMatchObject({ actor: { id: 'staff-1' } })
    expect(calls).toEqual(['GET /api/v1/auth/session'])
  })
})

describe('a staff sign-in while another window refreshes', () => {
  it('is sent only once that refresh has finished', async () => {
    const other = lockHeldElsewhere()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push(`${String(init.method)} ${new URL(String(url)).pathname}`)
      return new Response(JSON.stringify({ actor: { id: 'staff-1', kind: 'staff' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { staffApi } = await import('./api')

    const signedIn = staffApi.login('ada@example.test', 'correct horse battery staple', 'turnstile-token')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()

    await signedIn
    expect(calls).toEqual(['POST /api/v1/auth/login'])
  })
})

/** Another window holding the session turn until released; after that the turn is free, as a browser's would be. */
function turnHeldUntilReleased() {
  let held = true
  let release: () => void = () => {}
  const released = new Promise<void>(done => { release = () => { held = false; done() } })
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable && held) return callback(null)
    await released
    return callback({})
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return { release }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// hid-system's staff actor carries no `kind`; only patient and platform actors do.
const staff = (id: string) => ({ actor: { id, subject: id, accountId: `account-${id}`, roles: [], permissions: [] } })

/** Serves each route's answers in order and records every request, as `METHOD /path`. */
function serve(routes: Record<string, Array<() => Response>>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    const next = routes[route]?.shift()
    return next ? next() : json({ status: 418, code: 'UNEXPECTED_REQUEST' }, 418)
  }))
  return calls
}

const SESSION = 'GET /api/v1/auth/session'
const LOGOUT = 'POST /api/v1/auth/logout'
const REFRESH = 'POST /api/v1/auth/refresh'

describe('a staff sign-out while another window signs in', () => {
  async function signOutAfterAnotherWindow(holder: unknown, actWhileWaiting: (session: typeof SessionModule) => void = () => {}) {
    const other = turnHeldUntilReleased()
    const calls = serve({ [SESSION]: [() => json(holder)], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    const session = await import('./session')
    const { staffApi } = await import('./api')
    session.setStaffSessionActor('staff-1')

    const signedOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    actWhileWaiting(session)
    other.release()
    await signedOut
    return calls
  }

  it('signs out once its turn comes while the browser still holds this session', async () => {
    expect(await signOutAfterAnotherWindow(staff('staff-1'))).toEqual([SESSION, LOGOUT])
  })

  it.each([
    ['another staff account', staff('staff-2')],
    ['a patient', { actor: { id: 'staff-1', subject: 'staff-1', kind: 'patient', patientId: 'patient-1', accountId: 'account-9' } }],
  ])('leaves alone the session of %s signed in meanwhile', async (_label, holder) => {
    expect(await signOutAfterAnotherWindow(holder)).toEqual([SESSION])
  })

  it('ends the session it was asked to end even if the workspace closes while it waits', async () => {
    // Leaving the provider portal clears the account it shows; the sign-out already under way still names it.
    const calls = await signOutAfterAnotherWindow(staff('staff-1'), session => session.setStaffSessionActor(null))
    expect(calls).toEqual([SESSION, LOGOUT])
  })

  it('treats a refused check as it does a refused sign-out: restores this session and only then signs out', async () => {
    // A 401 there is not proof the session is this account's: the server also sends it when it cannot check.
    const other = turnHeldUntilReleased()
    const calls = serve({
      [SESSION]: [() => json({ status: 401, code: 'AUTHENTICATION_REQUIRED' }, 401)],
      [REFRESH]: [() => json(staff('staff-1'))],
      [LOGOUT]: [() => new Response(null, { status: 204 })],
    })
    const { setStaffSessionActor } = await import('./session')
    const { staffApi } = await import('./api')
    setStaffSessionActor('staff-1')

    const signedOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    other.release()
    await signedOut
    expect(calls).toEqual([SESSION, REFRESH, LOGOUT])
  })

  it('leaves alone another account found when a refused check restores the session', async () => {
    const other = turnHeldUntilReleased()
    const calls = serve({
      [SESSION]: [() => json({ status: 401, code: 'AUTHENTICATION_REQUIRED' }, 401)],
      [REFRESH]: [() => json(staff('staff-2'))],
    })
    const { setStaffSessionActor } = await import('./session')
    const { staffApi } = await import('./api')
    setStaffSessionActor('staff-1')

    const signedOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    other.release()
    await signedOut
    expect(calls).toEqual([SESSION, REFRESH])
  })
})

describe('a staff sign-out whose workspace closes while it waits', () => {
  it('still leaves alone another account found when a refused check restores the session', async () => {
    // Leaving the provider portal clears the account it shows; the restore still checks against the one being signed out.
    const other = turnHeldUntilReleased()
    const calls = serve({
      [SESSION]: [() => json({ status: 401, code: 'AUTHENTICATION_REQUIRED' }, 401)],
      [REFRESH]: [() => json(staff('staff-2'))],
      [LOGOUT]: [() => new Response(null, { status: 204 })],
    })
    const { setStaffSessionActor } = await import('./session')
    const { staffApi } = await import('./api')
    setStaffSessionActor('staff-1')

    const signedOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    setStaffSessionActor(null)
    other.release()
    await signedOut
    expect(calls).toEqual([SESSION, REFRESH])
  })
})

describe('provider enrollment activation while another window signs out', () => {
  it('waits its turn, so that sign-out cannot clear or end the new session', async () => {
    const other = lockHeldElsewhere()
    const calls = serve({ 'POST /api/v1/identity/provider-enrollments/activate': [() => json({ activated: true })] })
    const { providerEnrollmentApi } = await import('./api')

    const activated = providerEnrollmentApi.activate('correct horse battery staple')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()

    await activated
    expect(calls).toEqual(['POST /api/v1/identity/provider-enrollments/activate'])
  })
})
