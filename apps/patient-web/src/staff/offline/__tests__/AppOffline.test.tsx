import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { OfflineCore } from '@hid/offline'
import { fakeOffline, openVault, PASSWORD, PILOT, snapshotOf } from './offlineFixture'

/**
 * The real staff App with Stream A's in-memory offline runtime (`@hid/offline/testing`) and the network replaced:
 * the offline cold start, the idle lock over a form in progress, the one-time choice (A5), and a facility that is
 * not in the pilot seeing nothing new.
 */
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The shell's update hook is Stream C's; here only its unsaved-form plug is watched.
const shellPlug = vi.hoisted(() => ({ source: null as (() => boolean) | null }))
vi.mock('../shellUpdateAdapter', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  setUnsavedFormsSource: (source: () => boolean) => { shellPlug.source = source; return () => { shellPlug.source = null } },
}))
vi.mock('../../clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const REAL = '11111111-0000-4000-8000-000000000001'
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read', 'ehr.note.read', 'ehr.note.write']
const facility = (id: string, name: string) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'],
  permissions: PERMISSIONS, isPrimary: true })
const staffSession = (id = PILOT, name = 'Demo Hospital') => ({
  actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [],
    facilities: [facility(id, name)], facility: facility(id, name) },
  facilitySelection: 'selected',
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

class TabChannel extends EventTarget { postMessage() { /* other tabs are not modelled */ } close() { /* nothing to release */ } }

let calls: string[] = []
function serve(answer: (route: string) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    return answer(route)
  }))
}
/** Signed out, then signing in answers `session`. */
const signingIn = (session: unknown) => (route: string) =>
  route === 'GET /api/v1/auth/session' || route === 'POST /api/v1/auth/refresh' ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    : route === 'POST /api/v1/auth/login' ? json(session) : json([])

async function open(runtime: OfflineCore | null, environment: Record<string, unknown> | null, path = '/provider') {
  const { setOfflineRuntimeForTests } = await import('../runtime')
  const { setOfflineEnvironmentForTests } = await import('../environment')
  setOfflineEnvironmentForTests(environment)
  setOfflineRuntimeForTests(runtime)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
  // There is no offline checkbox on the sign-in page (A5), whatever the facility.
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByText(/offline/i)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => { vi.resetModules(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('offline cold start', () => {
  it('offers the offline sign-in when Health ID cannot be reached and opens the restored session offline', async () => {
    serve(() => { throw new TypeError('Failed to fetch') })
    const { runtime, controls } = fakeOffline({ connectivity: 'offline' })
    controls.seedVault(snapshotOf(PILOT, staffSession(), PERMISSIONS), PASSWORD)
    const unlock = vi.spyOn(runtime, 'unlockOffline')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })

    expect(await screen.findByRole('heading', { name: 'Health ID can’t be reached' }, { timeout: 8000 })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /Work email/ }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))

    expect(await screen.findByText(/Working offline\. Changes are saved on this device/)).toBeTruthy()
    expect(unlock).toHaveBeenCalledWith('ada@example.test', PASSWORD)
    expect(screen.getByRole('heading', { level: 1, name: /Good to see you, Ada/ })).toBeTruthy()
    expect(runtime.summary().vault).toBe('unlocked')
    expect(runtime.restoreSession()?.facilityId).toBe(PILOT)
    // Offline is in use: the top bar says so, as a polite status.
    expect(await screen.findByText('Offline and sync')).toBeTruthy()
    expect(screen.getAllByRole('status').some(node => node.textContent === 'Offline')).toBe(true)
  }, 15000)

  it('says so, and opens nothing, for a wrong password', async () => {
    serve(() => { throw new TypeError('Failed to fetch') })
    const { runtime, controls } = fakeOffline({ connectivity: 'offline' })
    controls.seedVault(snapshotOf(PILOT, staffSession(), PERMISSIONS), PASSWORD)
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 8000 }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'not the password at all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That email and password do not open an offline copy on this device.')
    expect(controls.failedUnlocks()).toBe(1)
  }, 15000)

  it('keeps today’s error screen when no offline copy is on this device', async () => {
    serve(() => { throw new TypeError('Failed to fetch') })
    await open(fakeOffline({ connectivity: 'offline' }).runtime, { mode: 'pilot', facilities: [PILOT] })
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Health ID can’t be reached' })).toBeNull()
  }, 15000)
})

describe('the one-time choice at a pilot facility (amendment A5)', () => {
  it('asks once after sign-in on a device with no copy, and keeps one only when chosen', async () => {
    serve(signingIn(staffSession()))
    const { runtime } = fakeOffline()
    const prepare = vi.spyOn(runtime, 'prepareFromSignIn')
    const attach = vi.spyOn(runtime, 'attachSession')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    await signIn()

    expect(await screen.findByRole('heading', { name: 'Keep an offline copy on this device (personal devices only)' })).toBeTruthy()
    expect(prepare).toHaveBeenCalledWith('ada@example.test', PASSWORD)
    // Nothing is attached, or written, until the person answers.
    expect(attach).not.toHaveBeenCalled()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep an offline copy' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: /Keep an offline copy on this device/ })).toBeNull())
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ facilityId: PILOT }), { optIn: true, online: true })
    expect(runtime.summary().vault).toBe('unlocked')
    expect(await screen.findByText('Offline and sync')).toBeTruthy()
  })

  it('declined, keeps nothing and shows nothing more', async () => {
    serve(signingIn(staffSession()))
    const { runtime } = fakeOffline()
    const attach = vi.spyOn(runtime, 'attachSession')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    await signIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Not on this device' }))
    await waitFor(() => expect(attach).toHaveBeenCalledWith(expect.objectContaining({ facilityId: PILOT }), { optIn: false, online: true }))
    expect(await runtime.hasVaults()).toBe(false)
    expect(screen.queryByText('Offline and sync')).toBeNull()
  })
})

describe('idle lock', () => {
  it('locks after 5 minutes without use, keeps the form text beneath, and reopens with the password', async () => {
    serve(signingIn(staffSession()))
    const { runtime, controls } = fakeOffline()
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    await signIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep an offline copy' }))
    await screen.findByText('Offline and sync')
    const reason = await screen.findByRole('textbox', { name: /Clinical reason/ })
    fireEvent.change(reason, { target: { value: 'Follow-up for the cough seen last week' } })
    // The shell's "Update now" waits for this form (A9): the workspace told it which forms hold unsaved edits.
    expect(shellPlug.source?.()).toBe(true)

    await act(async () => { await controls.advance(5 * 60_000 + 1) })
    expect(await screen.findByRole('heading', { name: 'Health ID is locked' })).toBeTruthy()
    expect(screen.getByText(/locked after 5 minutes without use/)).toBeTruthy()
    // Hidden and inert, but mounted: what was typed is still there.
    expect((document.getElementById('request-reason') as HTMLTextAreaElement).value).toBe('Follow-up for the cough seen last week')

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Health ID is locked' })).toBeNull())
    expect(runtime.summary().vault).toBe('unlocked')
    expect((screen.getByRole('textbox', { name: /Clinical reason/ }) as HTMLTextAreaElement).value).toBe('Follow-up for the cough seen last week')
  })
})

describe('a facility that is not in the pilot', () => {
  it('signing in changes nothing they can see: no checkbox, no question, no offline status', async () => {
    serve(signingIn(staffSession(REAL, 'Lagos General')))
    const { runtime } = fakeOffline()
    const read = vi.spyOn(runtime.reads, 'read')
    const save = vi.spyOn(runtime.commands, 'save')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    await signIn()
    expect(await screen.findByRole('heading', { level: 1, name: /Good to see you, Ada/ })).toBeTruthy()
    await waitFor(() => expect(runtime.policy()).toMatchObject({ enabled: false, reason: 'facility-off' }))
    expect(screen.queryByText(/Keep an offline copy/)).toBeNull()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByText(/On this device/)).toBeNull()
    expect(screen.queryByText(/Offline use is paused/)).toBeNull()
    expect(await runtime.hasVaults()).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(calls.filter(route => route.includes('/offline/'))).toEqual([])
  })

  it('an online reload shows no offline UI either', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json(staffSession(REAL, 'Lagos General')) : json([]))
    await open(fakeOffline().runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByText(/On this device/)).toBeNull()
    expect(screen.queryByLabelText('Access for')).toBeNull()
  })

  it('in a build with offline off, the workspace has no runtime and no offline UI at all', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json(staffSession(REAL, 'Lagos General')) : json([]))
    await open(null, null, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByLabelText('Access for')).toBeNull()
  })
})

describe('a sign-out made offline reaches Health ID (A12.2)', () => {
  const LOGOUT = 'POST /api/v1/auth/logout'
  const SESSION = 'GET /api/v1/auth/session'
  const signedOut = () => new Response(null, { status: 204 })

  /** Signed in offline from the cold start, then Sign out pressed: the copy closes and the sign-out is noted. */
  async function signOutOffline() {
    serve(() => { throw new TypeError('Failed to fetch') })
    const fake = fakeOffline({ connectivity: 'offline' })
    fake.controls.seedVault(snapshotOf(PILOT, staffSession(), PERMISSIONS), PASSWORD)
    await open(fake.runtime, { mode: 'pilot', facilities: [PILOT] })
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 8000 }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))
    await screen.findByRole('heading', { level: 1, name: /Good to see you, Ada/ })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(fake.controls.logoutPending()).toBe(true))
    expect(calls).not.toContain(LOGOUT)
    return fake
  }

  /** The page loaded again, with `answer` for the network. */
  async function reload(runtime: OfflineCore, answer: (route: string) => Response | Promise<Response>) {
    cleanup()
    vi.resetModules()
    serve(answer)
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })
  }

  it('sends the logout first on the next online load, before any session is read', async () => {
    const { runtime, controls } = await signOutOffline()
    controls.setConnectivity('online')
    await reload(runtime, route => route === LOGOUT ? signedOut() : json(staffSession()))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' }, { timeout: 8000 })).toBeTruthy()
    expect(calls[0]).toBe(LOGOUT)
    expect(calls).not.toContain(SESSION)
    expect(controls.logoutPending()).toBe(false)
  }, 20000)

  it('restores the session once when the first logout is refused with 401, and sends it again', async () => {
    const { runtime, controls } = await signOutOffline()
    controls.setConnectivity('online')
    let logouts = 0
    await reload(runtime, route => {
      if (route === LOGOUT) { logouts += 1; return logouts === 1 ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401) : signedOut() }
      return route === 'POST /api/v1/auth/refresh' ? json(staffSession()) : json(staffSession())
    })
    expect(await screen.findByRole('heading', { name: 'Welcome back.' }, { timeout: 8000 })).toBeTruthy()
    expect(calls.slice(0, 3)).toEqual([LOGOUT, 'POST /api/v1/auth/refresh', LOGOUT])
    expect(calls).not.toContain(SESSION)
    expect(controls.logoutPending()).toBe(false)
  }, 20000)

  it('still sends the logout when another window holds the session turn', async () => {
    const { runtime, controls } = await signOutOffline()
    controls.setConnectivity('online')
    // Another window is refreshing: the turn is not free at first, then given.
    const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
      const task = rest[rest.length - 1] as (lock: unknown) => Promise<unknown>
      const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
      return task(options.ifAvailable ? null : { name: _name })
    })
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    await reload(runtime, route => route === LOGOUT ? signedOut() : json(staffSession()))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' }, { timeout: 8000 })).toBeTruthy()
    expect(request).toHaveBeenCalled()
    expect(calls[0]).toBe(LOGOUT)
    expect(controls.logoutPending()).toBe(false)
  }, 20000)

  it('a load while still offline reads no session and keeps the sign-out noted', async () => {
    const { runtime, controls } = await signOutOffline()
    await reload(runtime, () => { throw new TypeError('Failed to fetch') })
    expect(await screen.findByRole('heading', { name: 'Health ID can’t be reached' }, { timeout: 8000 })).toBeTruthy()
    expect(calls).not.toContain(SESSION)
    expect(controls.logoutPending()).toBe(true)
  }, 20000)

  it('online, then the connection drops: Sign out closes the copy and notes the sign-out instead of failing', async () => {
    // The client keeps the fetch it was made with: the dropped connection is a switch in the one network.
    let down = false
    const online = signingIn(staffSession())
    serve(route => { if (down) throw new TypeError('Failed to fetch'); return online(route) })
    const { runtime, controls } = fakeOffline()
    const signOut = vi.spyOn(runtime, 'signOut')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    await signIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep an offline copy' }))
    await screen.findByText('Offline and sync')
    down = true
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ online: false }))
    expect(runtime.summary().vault).not.toBe('unlocked')
    expect(runtime.restoreSession()).toBeNull()
    expect(controls.logoutPending()).toBe(true)
  }, 20000)

  it('with no offline copy, a dropped connection still says the sign-out failed', async () => {
    let down = false
    serve(route => { if (down) throw new TypeError('Failed to fetch'); return route === SESSION ? json(staffSession(REAL, 'Lagos General')) : json([]) })
    await open(fakeOffline().runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/patients')
    await screen.findByRole('heading', { name: 'Open a patient record.' })
    down = true
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
  }, 20000)
})

describe('sending is bound to the account Health ID confirmed (A12.3)', () => {
  const bola = () => {
    const session = staffSession()
    return { ...session, actor: { ...session.actor, id: 'staff-2', email: 'bola@example.test', displayName: 'Bola Clinician' } }
  }

  it('after an offline cold start, sends nothing until Health ID confirms the same account', async () => {
    let online = false
    serve(route => {
      if (!online) throw new TypeError('Failed to fetch')
      return route === 'GET /api/v1/auth/session' ? json(staffSession()) : json([])
    })
    const { runtime, controls } = fakeOffline({ connectivity: 'offline' })
    controls.seedVault(snapshotOf(PILOT, staffSession(), PERMISSIONS), PASSWORD)
    const ready = vi.spyOn(runtime, 'setSessionReady')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 8000 }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))
    await screen.findByRole('heading', { level: 1, name: /Good to see you, Ada/ })
    // The workspace is open offline, but the account is not confirmed: sending stays closed.
    expect(ready.mock.calls.every(([open]) => open === false)).toBe(true)

    online = true
    await act(async () => { controls.setConnectivity('online') })
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true, 'staff-1'))
    expect(calls).toContain('GET /api/v1/auth/session')
  }, 20000)

  it('a different account answering the background read locks the vault and sends nothing', async () => {
    let online = false
    serve(route => {
      if (!online) throw new TypeError('Failed to fetch')
      return route === 'GET /api/v1/auth/session' ? json(bola()) : json([])
    })
    const { runtime, controls } = fakeOffline({ connectivity: 'offline' })
    controls.seedVault(snapshotOf(PILOT, staffSession(), PERMISSIONS), PASSWORD)
    const ready = vi.spyOn(runtime, 'setSessionReady')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 8000 }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))
    await screen.findByRole('heading', { level: 1, name: /Good to see you, Ada/ })
    online = true
    await act(async () => { controls.setConnectivity('online') })
    await waitFor(() => expect(runtime.summary().vault).not.toBe('unlocked'))
    expect(ready.mock.calls.some(([open]) => open === true)).toBe(false)
  }, 20000)

  it('another account signing in on the tab locks the vault left open before attaching its own', async () => {
    serve(signingIn(bola()))
    const { runtime } = await openVaultFor()
    const lock = vi.spyOn(runtime, 'lock')
    const attach = vi.spyOn(runtime, 'attachSession')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    await signIn()
    await screen.findByRole('heading', { level: 1, name: /Good to see you, Bola/ })
    expect(lock).toHaveBeenCalledWith('session')
    if (attach.mock.calls.length > 0) expect(lock.mock.invocationCallOrder[0]).toBeLessThan(attach.mock.invocationCallOrder[0]!)
    expect(runtime.restoreSession()?.accountId).not.toBe('staff-1')
  }, 20000)

  it('a session Health ID says has ended locks the vault', async () => {
    serve(route => route === 'GET /api/v1/auth/session' || route === 'POST /api/v1/auth/refresh'
      ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401) : json([]))
    const { runtime } = await openVaultFor()
    const lock = vi.spyOn(runtime, 'lock')
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })
    await screen.findByRole('heading', { name: 'Welcome back.' }, { timeout: 8000 })
    expect(lock).toHaveBeenCalledWith('session')
  }, 20000)

  /** Ada's vault, open on this tab as after her online sign-in with a copy kept. */
  function openVaultFor() { return openVault(snapshotOf(PILOT, staffSession(), PERMISSIONS)) }
})
