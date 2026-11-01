import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEMO_LABORATORY, facility, json, problem, serve, sessionAt } from '../ehr-blue/frame/blueHarness'
import { address, backToTestSite, LOGIN, onSite, openPortalOn, REFRESH, SESSION } from './siteHarness'

/**
 * One sign-in for every staff site (authHandoff.ts, a draft behind VITE_HID_CENTRAL_SIGN_IN): OpenID Connect, each product
 * its own client behind its own server. A staff site that finds no session goes to its own server's sign-in start, naming
 * only a page of its own; the auth. site signs in for an authorization request it knows by an opaque id, then hands it to
 * its server to continue. Every account here is fictional, and nothing is requested from any Health ID host: the
 * browser's move is the test's stand-in for openSite.ts.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel); vi.stubEnv('VITE_HID_CENTRAL_SIGN_IN', 'true') })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const LAB = 'lab.healthidentitydirectory.com'
const AUTH = 'auth.healthidentitydirectory.com'
const startAt = (page: string) => `/api/v1/auth/oidc/start?return_to=${encodeURIComponent(page)}`
const REQUEST = 'Zq3x9K0bW2mN7pR4tV6yA8cE1gH5jL'
const CONTINUE = `/api/v1/auth/oidc/authorize/continue?request=${REQUEST}`
const EHR = 'https://ehr.healthidentitydirectory.com/provider'
const signedOut = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')
const demo = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])

/** The auth. site at `path`, as the browser opens it there, with Identity answering as `answers` say. */
async function openAuthAt(path: string, answers: Parameters<typeof serve>[0]) {
  const sent = serve(answers)
  onSite(AUTH, path)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  return sent
}

describe('a staff site that finds no session', () => {
  it('starts the sign-in at its own server, naming the page to come back to', async () => {
    await openPortalOn(LAB, '/provider/audit')
    expect(await screen.findByRole('heading', { name: 'Opening Health ID sign-in…' })).toBeTruthy()
    const href = startAt('/provider/audit')
    expect(screen.getByRole('link', { name: 'Continue to sign-in' }).getAttribute('href')).toBe(href)
    await waitFor(() => expect(opened).toHaveBeenCalledWith(href))
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('keeps nothing of a record’s address but its page', async () => {
    await openPortalOn(LAB, '/provider/laboratory/5a020001')
    await waitFor(() => expect(opened).toHaveBeenCalledWith(startAt('/provider/laboratory')))
  })

  it('keeps its own sign-in while the build leaves the switch off', async () => {
    vi.stubEnv('VITE_HID_CENTRAL_SIGN_IN', '')
    await openPortalOn(LAB, '/provider/audit')
    await waitFor(() => expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Faudit'))
    expect(opened).not.toHaveBeenCalled()
  })

  it('keeps its own sign-in on the join page, where the invitation waits in the page', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openPortalOn(LAB, '/provider/staff/join')
    await waitFor(() => expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fstaff%2Fjoin'))
    expect(opened).not.toHaveBeenCalled()
  })
})

describe('the auth. site', () => {
  it('continues the request at once for someone already signed in there, with no sign-in shown', async () => {
    await openAuthAt(`/signin?request=${REQUEST}`, { [SESSION]: [sessionAt(demo, [demo])] })
    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTINUE))
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(CONTINUE)
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('signs in someone signed out, then continues the request', async () => {
    const sent = await openAuthAt(`/signin?request=${REQUEST}`, {
      [SESSION]: [signedOut], [REFRESH]: [signedOut], [LOGIN]: [sessionAt(demo, [demo])],
    })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'demo.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional passphrase for tests' } })
    expect(opened).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTINUE))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(sent.some(request => request.route === LOGIN)).toBe(true)
  })

  it('says in plain words when the sign-in cannot be checked, never the server’s own text', async () => {
    const failing = () => problem(503, 'UPSTREAM_TIMEOUT', 'Gateway timeout at identity-api /api/v1/auth/session (ref 7f3a)')
    await openAuthAt(`/signin?request=${REQUEST}`, { [SESSION]: [failing, failing, failing], [REFRESH]: [failing, failing] })
    expect(await screen.findByText('We couldn’t check your sign-in. Please try again.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/UPSTREAM_TIMEOUT|identity-api|\/api\/v1|7f3a|Gateway timeout/)
    expect(opened).not.toHaveBeenCalled()
  })

  it('takes no address from its query: it goes to the Hospital EHR instead', async () => {
    await openAuthAt(`/signin?request=${encodeURIComponent('https://example.com/callback')}&return_to=${encodeURIComponent('https://example.com/')}`,
      { [SESSION]: [sessionAt(demo, [demo])] })
    await waitFor(() => expect(opened).toHaveBeenCalledWith(EHR))
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('opens its sign-in at any other address it is given', async () => {
    await openAuthAt('/provider/audit', { [SESSION]: [sessionAt(demo, [demo])] })
    await waitFor(() => expect(opened).toHaveBeenCalledWith(EHR))
  })

  it('serves nothing of it while the build leaves the switch off', async () => {
    vi.stubEnv('VITE_HID_CENTRAL_SIGN_IN', '')
    await openAuthAt('/provider', { [SESSION]: [sessionAt(demo, [demo])], 'GET /api/v1/identity/access-requests': [() => json([])] })
    // The staff workspace, as on any host this build does not know.
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Checking your sign-in…' })).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })
})
