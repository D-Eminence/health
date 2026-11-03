import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { json, problem, serve, type Sent } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, onSite, REFRESH, SESSION } from '../sites/siteHarness'

/**
 * A patient's session that ends in an open app. tab, with single sign-on on (sso/singleSignOn.ts noteSessionEndedHere):
 * signed out in another tab, or lapsed while the tab was away. The provider's session on auth. may outlive it (its
 * end-session page still waiting for the person in the tab that signed out, or a lifetime longer than the portal's
 * idle limit), so the hand-off that follows asks for a new sign-in (`prompt=login`) rather than bringing the same
 * records back without a word. Unset, the tab goes to today's sign-in page. A first visit with no session hands off
 * with no prompt (handOffPages.test.tsx). Identity is a fake answering each route in turn; the tab's departure is the
 * test's stand-in for sso/leave.ts; the other tab is a message on the session-change channel. Every account and host
 * here is fictional.
 */
const environment = vi.hoisted(() => ({
  name: 'production', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, ssoEnabled: true,
  patientChatEnabled: false, supportChatEnabled: false, supportContact: null,
}))
vi.mock('../../env', () => ({ getEnvironment: () => environment }))
vi.mock('../../staff/env', () => ({ getEnvironment: () => environment }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('../../openSite', () => ({ openSite: vi.fn() }))
const left = vi.hoisted(() => vi.fn())
vi.mock('../../sso/leave', () => ({ leavePage: left }))

const channels: EventTarget[] = []
class TabChannel extends EventTarget { constructor() { super(); channels.push(this) } postMessage() {} close() {} }
let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  left.mockClear(); environment.ssoEnabled = true; channels.length = 0; visibility = 'visible'
  vi.stubGlobal('BroadcastChannel', TabChannel)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState
  backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules()
})

const APP = 'app.healthidentitydirectory.com'
const START = '/api/v1/auth/sso/start'
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
  expiresAt: '2026-11-30T12:00:00.000Z' })
const gone = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')

function Address() {
  const { pathname, search } = useLocation()
  return <span data-testid="address" hidden>{pathname + search}</span>
}

/** The portal on app. at `path`, signed in; then the sign-in leaves the browser: every session read and refresh refused. */
async function signedInAt(path: string): Promise<Sent[]> {
  const sent = serve({ [SESSION]: [patient, gone, gone, gone], [REFRESH]: [gone, gone, gone] })
  onSite(APP, path)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Address /><App /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: /: account$/ })).toBeTruthy()
  expect(left).not.toHaveBeenCalled()
  return sent
}

/** Another tab of this origin says the browser's session changed (a sign-out there). */
async function anotherTabSignsOut() {
  await act(async () => { for (const channel of channels) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

/** The tab goes out of view, and comes back `minutes` later. */
async function awayFor(minutes: number) {
  visibility = 'hidden'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + minutes * 60_000)
  visibility = 'visible'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
}

const checks = (sent: Sent[]) => sent.map(request => request.route).filter(route => route === SESSION || route === REFRESH)

describe('a session that ends in an open app. tab, with single sign-on on', () => {
  it('asks for a new sign-in when another tab signs out', async () => {
    const sent = await signedInAt('/notifications')
    await anotherTabSignsOut()
    await waitFor(() => expect(left).toHaveBeenCalled())
    expect(checks(sent)).toEqual([SESSION, SESSION, REFRESH])
    expect(left.mock.calls).toEqual([[`${START}?return_to=%2Fnotifications&prompt=login`]])
    expect(screen.getByRole('link', { name: 'Continue to sign in' }).getAttribute('href')).toBe(`${START}?return_to=%2Fnotifications&prompt=login`)
  })

  it('asks for a new sign-in when the sign-in lapsed while the tab was away', async () => {
    const sent = await signedInAt('/notifications')
    await awayFor(31)
    await waitFor(() => expect(left).toHaveBeenCalled())
    expect(checks(sent)).toEqual([SESSION, SESSION, REFRESH])
    expect(left.mock.calls).toEqual([[`${START}?return_to=%2Fnotifications&prompt=login`]])
  })

  it('asks for a new sign-in when a page’s request finds the sign-in gone and its refresh is refused', async () => {
    const NOTIFICATIONS = 'GET /api/v1/identity/me/notifications'
    const sent = serve({ [SESSION]: [patient, gone, gone], [NOTIFICATIONS]: [gone, gone], [REFRESH]: [gone, gone, gone] })
    onSite(APP, '/notifications')
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/notifications']}><Address /><App /></MemoryRouter>)
    await waitFor(() => expect(left).toHaveBeenCalled())
    const routes = sent.map(request => request.route)
    expect(routes[0]).toBe(SESSION)
    expect(routes.indexOf(REFRESH)).toBeGreaterThan(routes.indexOf(NOTIFICATIONS))
    expect(routes.indexOf(NOTIFICATIONS)).toBeGreaterThan(0)
    expect(new Set(left.mock.calls.map(([to]) => to))).toEqual(new Set([`${START}?return_to=%2Fnotifications&prompt=login`]))
  })
})

describe('a session that ends in an open app. tab, with single sign-on unset', () => {
  it('goes to today’s sign-in page and hands nothing off', async () => {
    environment.ssoEnabled = false
    const sent = await signedInAt('/notifications')
    await anotherTabSignsOut()
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.getByTestId('address').textContent).toBe('/sign-in')
    expect(checks(sent)).toEqual([SESSION, SESSION, REFRESH])
    expect(left).not.toHaveBeenCalled()
    expect(sent.filter(request => request.route.includes('/auth/sso/'))).toEqual([])
    const sso = await import('../../sso/singleSignOn')
    expect(sso.signedOutInThisPage()).toBe(false)
  })
})
