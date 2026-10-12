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

/**
 * Answers each `METHOD /path` from its own queue, in order, and records the
 * calls. A queued promise is an answer that arrives when the test settles it.
 */
function serve(routes: Record<string, Array<Response | Promise<Response>>>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    return await (routes[route]?.shift() ?? json({ code: 'UNEXPECTED_REQUEST' }, 418))
  }))
  return calls
}

/** An answer the test gives later, with `answer`. */
function later() {
  let answer!: (response: Response) => void
  const response = new Promise<Response>(resolve => { answer = resolve })
  return { response, answer }
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
  const ada = () => json({ actor: { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada Admin', email: 'ada@example.test',
    platformRoles: [], platformPermissions: ['platform.admin.access'] } })
  // The console opens, then asks whose session the browser holds before it signs out.
  const signedIn = () => ({
    [SESSION]: [ada(), ada()],
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

  // The access cookie lasts 5 minutes (hid-system PLATFORM_ACCESS_TTL_SECONDS), so
  // after a short idle the check before signing out gets the generic 401, and
  // the refresh says why the server ended the session.
  it('keeps the reason the refresh gives when the access token had lapsed', async () => {
    const calls = serve({ ...signedIn(), [SESSION]: [ada(), refused('AUTHENTICATION_REQUIRED')],
      [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    await act(async () => {})
    expect(screen.getByText(messages.revoked)).toBeTruthy()
    expect(screen.queryByText('You have signed out of platform administration.')).toBeNull()
    expect(calls).not.toContain('POST /api/v1/auth/admin/logout')
  })

  it('sends no sign-out once the server has refused the session, and keeps its reason', async () => {
    const calls = serve({ ...signedIn(), [SESSION]: [ada(), refused('PLATFORM_SESSION_REVOKED')],
      [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(calls).not.toContain('POST /api/v1/auth/admin/logout')
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
  const grantFor = (accountId: string, extra: Record<string, unknown> = {}) => json({
    actor: { ...actor(accountId), kind: 'platform', sessionId: `session-${accountId}` },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), idleExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...extra })
  const mfa = () => json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null, recoveryCodesRemaining: 10, session: null })
  /** The MFA status of a live session, which reports its idle and absolute expiry. */
  const mfaOfLiveSession = () => json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null,
    recoveryCodesRemaining: 10, session: { mfaVerifiedAt: new Date().toISOString(), mfaMethod: 'totp', stepUpExpiresAt: null,
      idleExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString() } })
  const LOGOUT = 'POST /api/v1/auth/admin/logout'
  const signedOut = () => new Response(null, { status: 204 })
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

  async function openAs(routes: Record<string, Array<Response | Promise<Response>>>) {
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

  // The closing workspace's other requests may be refused only after the refresh
  // that found another administrator has settled. A second refresh would then
  // answer for them too, and the client would repeat the request as them: a read
  // or a command alike.
  it('restores no session for a request still in flight from a closed workspace', async () => {
    const { adminApi } = await import('../api')
    const statusChecks = vi.spyOn(adminApi, 'mfaStatus')
    const status = later()
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1')], [MFA]: [status.response, mfa()],
      [OVERVIEW]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [grantFor('admin-2'), grantFor('admin-2')] })
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    await act(async () => {
      status.answer(refused('AUTHENTICATION_REQUIRED'))
      await Promise.allSettled(statusChecks.mock.results.map(result => result.value as Promise<unknown>))
    })
    expect(calls.filter(call => call === REFRESH)).toHaveLength(1)
    expect(calls.filter(call => call === MFA)).toHaveLength(1)
    const { currentSessionWindow } = await import('../session-window')
    expect(currentSessionWindow().idleExpiresAt).toBeNull()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
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

  // The answer that opens the workspace may predate the change another tab announced meanwhile.
  it('asks again once the workspace opens when another tab spoke while its session was checked', async () => {
    const opening = later()
    const { messages } = await openAs({ [SESSION]: [opening.response, sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('Checking your platform session…')).toBeTruthy()
    fromAnotherTab()
    await act(async () => { opening.answer(sessionOf('admin-1')) })
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  })

  it('asks again once the workspace opens when another tab spoke while a sign-in opened it', async () => {
    const opening = later()
    const asked = later()
    const { messages } = await openAs({
      [SESSION]: [refused('AUTHENTICATION_REQUIRED'), opening.response, asked.response],
      [REFRESH]: [refused('AUTHENTICATION_REQUIRED')], [OVERVIEW]: [overview()],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-1')] })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-1@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Opening platform administration…')).toBeTruthy()
    fromAnotherTab()
    await act(async () => { opening.answer(sessionOf('admin-1')) })
    expect(await screen.findByText('7')).toBeTruthy()
    await act(async () => { asked.answer(sessionOf('admin-2')) })
    expect(await screen.findByText(messages.switched)).toBeTruthy()
  })

  // Nothing is pending then: the sign-in that follows asks whose session the browser holds anyway.
  it('does not ask again for a change heard before the sign-in began', async () => {
    const { calls } = await openAs({ [MFA]: [mfa()], [SESSION]: [refused('AUTHENTICATION_REQUIRED'), sessionOf('admin-1')],
      [REFRESH]: [refused('AUTHENTICATION_REQUIRED')], [OVERVIEW]: [overview()],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-1')] })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-1@example.test' } })
    fromAnotherTab()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('7')).toBeTruthy()
    await act(async () => {})
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it('asks whose session the browser holds when the page returns after a while away', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const become = (next: DocumentVisibilityState) => act(() => { visibility = next; document.dispatchEvent(new Event('visibilitychange')) })
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    const { adminApi } = await import('../api')
    const asked = vi.spyOn(adminApi, 'session')

    // A brief look at another tab asks nothing, and the workspace stays as it was.
    become('hidden')
    become('visible')
    await act(async () => {})
    expect(asked).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()

    become('hidden')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now + 61_000)
    become('visible')
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    expect(asked).toHaveBeenCalledTimes(1)
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it('asks again when the page is restored from the back/forward cache', async () => {
    const { messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')], [OVERVIEW]: [overview()] })
    expect(await screen.findByText('7')).toBeTruthy()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(await screen.findByText(messages.switched)).toBeTruthy()
  })

  it('tells the other admin tabs when this one signs out', async () => {
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-1')], [OVERVIEW]: [overview()],
      [LOGOUT]: [signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText('You have signed out of platform administration.')).toBeTruthy()
    expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }])
    expect(calls.slice(-2)).toEqual([SESSION, LOGOUT])
  })

  // The check before logout can take a second of retries; a second press starts nothing more.
  it('signs out once however often Sign out is pressed meanwhile', async () => {
    const asked = later()
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1'), asked.response], [OVERVIEW]: [overview()],
      [LOGOUT]: [signedOut(), signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    const [sidebar, header] = screen.getAllByRole('button', { name: 'Sign out' }) as HTMLButtonElement[]
    fireEvent.click(sidebar!)
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    expect(sidebar!.disabled).toBe(true)
    expect(header!.disabled).toBe(true)
    fireEvent.click(sidebar!)
    fireEvent.click(header!)
    await act(async () => { asked.answer(sessionOf('admin-1')) })
    expect(await screen.findByText('You have signed out of platform administration.')).toBeTruthy()
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
    expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }])
  })

  // Logout ends whichever platform session the browser's cookies carry
  // (hid-system platform-auth.controller.ts revokes request.actor's session) and
  // needs no step-up, so a tab that has not yet heard of another administrator's
  // sign-in asks the server first.
  it('leaves another administrator\'s session alone when this tab signs out', async () => {
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), sessionOf('admin-2')],
      [OVERVIEW]: [overview()], [LOGOUT]: [signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(calls).not.toContain(LOGOUT)
  })

  it('leaves another administrator\'s session alone when restoring the session finds theirs', async () => {
    const { calls, messages } = await openAs({ [SESSION]: [sessionOf('admin-1'), refused('AUTHENTICATION_REQUIRED')],
      [REFRESH]: [grantFor('admin-2')], [OVERVIEW]: [overview()], [LOGOUT]: [signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(messages.switched)).toBeTruthy()
    expect(screen.queryByText('You have signed out of platform administration.')).toBeNull()
    expect(calls).not.toContain(LOGOUT)
  })

  // The access cookie lasts 5 minutes and the session 15 idle minutes (hid-system
  // PLATFORM_ACCESS_TTL_SECONDS, PLATFORM_IDLE_TIMEOUT_SECONDS). A logout without
  // it is refused and leaves the session alive.
  it('restores a lapsed access token before signing out, so the server ends the session', async () => {
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1'), refused('AUTHENTICATION_REQUIRED'), sessionOf('admin-1')],
      [REFRESH]: [grantFor('admin-1')], [OVERVIEW]: [overview()], [LOGOUT]: [signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText('You have signed out of platform administration.')).toBeTruthy()
    expect(calls.slice(-4)).toEqual([SESSION, REFRESH, SESSION, LOGOUT])
  })

  it('does not sign out blindly when the server cannot say whose session the browser holds', async () => {
    const { calls } = await openAs({ [SESSION]: [sessionOf('admin-1'), unavailable(), unavailable(), unavailable()],
      [OVERVIEW]: [overview()], [LOGOUT]: [signedOut()] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(/^Sign-out could not be completed\./, {}, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(calls).not.toContain(LOGOUT)
  })

  it('carries no sign-out error into the next workspace when the check itself ended the session', async () => {
    const required = json({ code: 'PLATFORM_SESSION_REQUIRED', detail: 'Platform session required' }, 403)
    await openAs({ [MFA]: [mfa(), mfa()], [SESSION]: [sessionOf('admin-1'), required, sessionOf('admin-1')],
      [OVERVIEW]: [overview(), overview()],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-1')] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-1@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('7')).toBeTruthy()
    expect(screen.queryByText(/MFA-verified platform administration session/)).toBeNull()
  })

  it('carries no sign-out error into the next workspace when the session ends after an outage', async () => {
    await openAs({ [MFA]: [mfa(), mfa()],
      [SESSION]: [sessionOf('admin-1'), unavailable(), unavailable(), unavailable(), refused('AUTHENTICATION_REQUIRED'),
        sessionOf('admin-1')],
      [REFRESH]: [refused('AUTHENTICATION_REQUIRED')], [OVERVIEW]: [overview(), overview()],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-1')] })
    expect(await screen.findByText('7')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(/^Sign-out could not be completed\./, {}, { timeout: 4000 })).toBeTruthy()
    // Another tab signs out; asked again, the server no longer knows this session.
    fromAnotherTab()
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-1@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('7')).toBeTruthy()
    expect(screen.queryByText(/Sign-out could not be completed/)).toBeNull()
  })

  // MFA verification has already replaced the browser's platform cookies, so the
  // other tabs must hear of it even when this workspace then fails to open.
  it('tells the other admin tabs of a sign-in that could not open the workspace', async () => {
    await openAs({ [SESSION]: [refused('AUTHENTICATION_REQUIRED'), unavailable(), unavailable(), unavailable()],
      [REFRESH]: [refused('AUTHENTICATION_REQUIRED')],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-2')] })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-2@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }]), { timeout: 4000 })
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  })

  it('tells the other admin tabs of a sign-in as soon as the code is verified, and once', async () => {
    const opening = later()
    await openAs({ [MFA]: [mfa(), mfa()], [SESSION]: [refused('AUTHENTICATION_REQUIRED'), opening.response],
      [REFRESH]: [refused('AUTHENTICATION_REQUIRED')], [OVERVIEW]: [overview()],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_required', expiresAt: new Date(Date.now() + 300_000).toISOString() })],
      'POST /api/v1/auth/admin/mfa/verify': [grantFor('admin-2')] })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-2@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    // The workspace check has not answered yet.
    expect(await screen.findByText('Opening platform administration…')).toBeTruthy()
    await waitFor(() => expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }]))
    await act(async () => { opening.answer(sessionOf('admin-2')) })
    expect(await screen.findByText('7')).toBeTruthy()
    expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }])
  })

  // Activation signs the administrator in: hid-system platform-auth.controller.ts
  // activateEnrollment sets the platform cookies before the recovery codes show,
  // and the administrator may read them for minutes, or close the tab there.
  it('tells the other admin tabs of a sign-in as soon as an authenticator is activated', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString()
    await openAs({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('AUTHENTICATION_REQUIRED')],
      'POST /api/v1/auth/admin/login': [json({ status: 'mfa_enrollment_required', expiresAt })],
      'POST /api/v1/auth/admin/mfa/enroll/start': [json({ secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/Health%20ID:admin-3?secret=JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6,
        periodSeconds: 30, expiresAt })],
      'POST /api/v1/auth/admin/mfa/enroll/activate': [grantFor('admin-3', { recoveryCodes: ['AAAA-BBBB-CC', 'DDDD-EEEE-FF'] })] })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin-3@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin setup' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    expect(await screen.findByRole('heading', { name: 'Save your recovery codes' })).toBeTruthy()
    expect(TabChannel.posted).toEqual([{ name: CHANNEL, message: 'changed' }])
  })
})
