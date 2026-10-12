import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The console with its real API module and HTTP client; only the network is replaced.
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const refused = (code: string) => json({ code, detail: 'Valid authentication is required' }, 401)

/** Answers each `METHOD /path` from its own queue, in order, and records the calls. */
function serve(routes: Record<string, Response[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    return routes[route]?.shift() ?? json({ code: 'UNEXPECTED_REQUEST' }, 418)
  }))
  return calls
}

async function open() {
  const { App, SESSION_ENDED_MESSAGES } = await import('../App')
  render(<MemoryRouter initialEntries={['/admin/overview']}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
  return SESSION_ENDED_MESSAGES
}

const SESSION = 'GET /api/v1/admin/session'
const REFRESH = 'POST /api/v1/auth/admin/refresh'

describe('session end reasons the server gives when the console opens (reload or new tab)', () => {
  it('states that the session was revoked when the refresh says so', async () => {
    const calls = serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.getByText(messages.revoked)).toBeTruthy()
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('states that the session expired when the refresh says so', async () => {
    serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('PLATFORM_SESSION_EXPIRED')] })
    const messages = await open()
    expect(await screen.findByText(messages.expired)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  })

  it('states the reason the session request itself was refused with', async () => {
    serve({ [SESSION]: [refused('PLATFORM_SESSION_REVOKED')], [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
  })

  it('shows no session notice on a first visit, when the server names no session', async () => {
    const calls = serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('AUTHENTICATION_REQUIRED')] })
    await open()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH])
  })
})

describe('signing out of a session the server has already ended', () => {
  const signedIn = () => ({
    [SESSION]: [json({ actor: { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada Admin', email: 'ada@example.test',
      platformRoles: [], platformPermissions: ['platform.admin.access'] } })],
    'GET /api/v1/admin/mfa': [json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null,
      recoveryCodesRemaining: 10, session: null })],
    'GET /api/v1/admin/overview': [json({ registeredPatients: 0, facilities: 0, verifiedFacilities: 0, suspendedFacilities: 0,
      activeStaffMemberships: 0, pendingIdentityReviews: 0 })],
  })

  it('keeps the revoked notice instead of saying the administrator signed out', async () => {
    serve({ ...signedIn(), 'POST /api/v1/auth/admin/logout': [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
    expect(screen.queryByText('You have signed out of platform administration.')).toBeNull()
  })

  it('says the administrator signed out when the server gives no reason', async () => {
    serve({ ...signedIn(), 'POST /api/v1/auth/admin/logout': [refused('AUTHENTICATION_REQUIRED')] })
    await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    await waitFor(() => expect(screen.getByText('You have signed out of platform administration.')).toBeTruthy())
  })
})

/**
 * Platform sessions use their own cookies (hid_access_admin*), shared by every
 * admin tab in the browser. A workspace belongs to the administrator who opened
 * it: once the cookies hold another administrator's session, or none, it ends
 * instead of showing the first administrator's pages or sending requests as the
 * second.
 */
describe('a workspace bound to the administrator who opened it', () => {
  const CHANNEL = 'hid-admin-session-change'
  const MFA = 'GET /api/v1/admin/mfa'
  const OVERVIEW = 'GET /api/v1/admin/overview'
  const actor = (accountId: string) => ({ accountId, subject: `staff:${accountId}`, displayName: `Admin ${accountId}`,
    email: `${accountId}@example.test`, platformRoles: [], platformPermissions: ['platform.admin.access'] })
  const sessionOf = (accountId: string) => json({ actor: actor(accountId) })
  const grantFor = (accountId: string) => json({ actor: { ...actor(accountId), kind: 'platform', sessionId: `session-${accountId}` },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), idleExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString() })
  const mfa = () => json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null, recoveryCodesRemaining: 10, session: null })
  /** The MFA status of a live session, which reports its idle and absolute expiry. */
  const mfaOfLiveSession = () => json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null,
    recoveryCodesRemaining: 10, session: { mfaVerifiedAt: new Date().toISOString(), mfaMethod: 'totp', stepUpExpiresAt: null,
      idleExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString() } })
  const overview = () => json({ registeredPatients: 7, facilities: 0, verifiedFacilities: 0, suspendedFacilities: 0,
    activeStaffMemberships: 0, pendingIdentityReviews: 0 })
  const unavailable = () => json({ code: 'SERVICE_UNAVAILABLE', detail: 'The service could not complete the request.' }, 503)

  /** The origin's other admin tabs, as BroadcastChannel would connect them. A channel never hears its own messages. */
  class TabChannel extends EventTarget {
    static open = new Set<TabChannel>()
    static posted: Array<{ name: string; message: unknown }> = []
    constructor(readonly name: string) { super(); TabChannel.open.add(this) }
    postMessage(message: unknown) { TabChannel.posted.push({ name: this.name, message }) }
    close() { TabChannel.open.delete(this) }
  }
  function fromAnotherTab() {
    act(() => {
      for (const channel of TabChannel.open) {
        if (channel.name === CHANNEL) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' }))
      }
    })
  }
  beforeEach(() => {
    TabChannel.open.clear()
    TabChannel.posted = []
    vi.stubGlobal('BroadcastChannel', TabChannel)
  })

  async function openAs(routes: Record<string, Response[]>) {
    const calls = serve({ [MFA]: [mfa()], ...routes })
    const messages = await open()
    return { calls, messages }
  }

  /**
   * The console's questions about whose session the browser holds, from here
   * on. `settled(n)` waits until n were asked and every answer was handled,
   * whatever the server said, so a check that nothing changed is not run early.
   */
  async function sessionChecks() {
    const { adminApi } = await import('../api')
    const asked = vi.spyOn(adminApi, 'session')
    return async function settled(count: number) {
      await waitFor(() => expect(asked).toHaveBeenCalledTimes(count), { timeout: 4000 })
      await act(async () => { await Promise.allSettled(asked.mock.results.map(result => result.value as Promise<unknown>)) })
    }
  }

  it('does not repeat a request as another administrator whose session a refresh returned', async () => {
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1')],
      [OVERVIEW]: [refused('AUTHENTICATION_REQUIRED'), overview()], [REFRESH]: [grantFor('admin-2')] })
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.getByText(messages.switched)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull()
    expect(calls.filter(call => call === OVERVIEW)).toHaveLength(1)
  })

  it('repeats the request once when the refresh restores the same administrator', async () => {
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1')],
      [OVERVIEW]: [refused('AUTHENTICATION_REQUIRED'), overview()], [REFRESH]: [grantFor('admin-1')] })
    expect(await screen.findByText('7')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(calls.filter(call => call === OVERVIEW)).toHaveLength(2)
  })

  it('ends the workspace when another tab signs a different administrator in', async () => {
    const { messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fromAnotherTab()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.getByText(messages.switched)).toBeTruthy()
    expect(screen.queryByText('Admin admin-1')).toBeNull()
  })

  // The other tab's sign-out cleared the platform cookies, so neither request
  // reaches a session: both answer the generic 401 (hid-system
  // platform-auth.controller.ts refresh, with no refresh cookie). The notice is
  // read from the expiry the live session last reported.
  it('ends the workspace when another tab signs this administrator out', async () => {
    const { messages } = await openAs({ [MFA]: [mfaOfLiveSession()],
      [SESSION]: [sessionOf('admin-1'), refused('AUTHENTICATION_REQUIRED')],
      [OVERVIEW]: [overview()], [REFRESH]: [refused('AUTHENTICATION_REQUIRED')] })
    expect(await screen.findByText('7')).toBeTruthy()
    const { currentSessionWindow } = await import('../session-window')
    await waitFor(() => expect(currentSessionWindow().idleExpiresAt).not.toBeNull())
    fromAnotherTab()
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.queryByText('Admin admin-1')).toBeNull()
  })

  it('keeps the workspace when the browser still holds the same administrator', async () => {
    await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-1')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    const settled = await sessionChecks()
    fromAnotherTab()
    await settled(1)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Administration sign in' })).toBeNull()
  })

  it('never reads an outage as a change of administrator', async () => {
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1'), unavailable(), unavailable(), unavailable()],
      [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    const settled = await sessionChecks()
    fromAnotherTab()
    await settled(1)
    expect(calls.filter(call => call === SESSION)).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Administration sign in' })).toBeNull()
  })

  it('asks whose session the browser holds when the page returns after a while away', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const become = (next: DocumentVisibilityState) => act(() => { visibility = next; document.dispatchEvent(new Event('visibilitychange')) })
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()

    // A brief look at another tab asks nothing.
    become('hidden')
    become('visible')
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)

    become('hidden')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now + 61_000)
    become('visible')
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it('asks again when the page is restored from the back/forward cache', async () => {
    const { messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(await screen.findByText(messages.switched)).toBeTruthy()
  })

  it('tells the other admin tabs when this one signs out', async () => {
    serve({ [MFA]: [mfa()], [SESSION]: [sessionOf('admin-1')], [OVERVIEW]: [overview()],
      'POST /api/v1/auth/admin/logout': [new Response(null, { status: 204 })] })
    await open()
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText('You have signed out of platform administration.')).toBeTruthy()
    expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }])
  })
})
