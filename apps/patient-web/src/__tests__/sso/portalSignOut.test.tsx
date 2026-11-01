import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { json, problem, serve, type Sent } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, onSite } from '../sites/siteHarness'

/**
 * The patient portal's sign-out with single sign-on on (contract v2, item 4): today's sign-out, as POST
 * /api/v1/auth/sso/logout, whose answer names the provider's end-session address; the tab then leaves for it, which
 * signs every Health ID site out. Unset, today's sign-out exactly. Identity is a fake answering each route in turn; the
 * tab's departure is the test's stand-in for sso/leave.ts. The hosts are only names; every account is fictional.
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

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { left.mockClear(); environment.ssoEnabled = true; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const APP = 'app.healthidentitydirectory.com'
const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const SSO_LOGOUT = 'POST /api/v1/auth/sso/logout'
const END = 'https://auth.example.test/session/end?client_id=web&post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2F'

const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
  expiresAt: '2026-11-30T12:00:00.000Z' })
const ended = () => json({ endSessionUrl: END })
const gone = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')
const mismatch = () => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the staff application.')

/** A page holding the session, with the portal's sign-out. */
async function signedInOn(hostname: string, routes: Record<string, Array<() => Response>>) {
  const sent = serve({ [SESSION]: Array.from({ length: 4 }, () => patient), ...routes })
  onSite(hostname, '/')
  const { SessionProvider, useSession } = await import('../../session')
  function Probe() {
    const { state, signOut } = useSession()
    const [failure, setFailure] = useState('')
    return <>
      <output data-testid="status">{state.status}</output>
      <button type="button" onClick={() => { void signOut().catch((error: Error) => setFailure(error.message)) }}>Sign out</button>
      {failure && <p role="alert">{failure}</p>}
    </>
  }
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  return sent
}

async function signOut() {
  await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
}

const after = (sent: Sent[], from: number) => sent.slice(from).map(request => request.route).filter(route => route !== SESSION)

describe('the patient portal’s sign-out with single sign-on on, on app.', () => {
  it('ends the sign-in with the single sign-on sign-out, naming the portal, and leaves for the provider’s end-session address', async () => {
    const sent = await signedInOn(APP, { [SSO_LOGOUT]: [ended] })
    const before = sent.length
    await signOut()
    expect(after(sent, before)).toEqual([SSO_LOGOUT])
    const request = sent.find(item => item.route === SSO_LOGOUT)!
    expect(request.headers.get('X-HID-Client')).toBe('patient-web')
    expect(left.mock.calls).toEqual([[END]])
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, true])
  })

  it('restores an idle sign-in once and signs it out the same way', async () => {
    const sent = await signedInOn(APP, {
      [SSO_LOGOUT]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.'), ended], [REFRESH]: [patient] })
    const before = sent.length
    await signOut()
    expect(after(sent, before)).toEqual([SSO_LOGOUT, REFRESH, SSO_LOGOUT])
    expect(left.mock.calls).toEqual([[END]])
  })

  it.each([
    ['no address', () => json({})],
    ['an address it never leaves for', () => json({ endSessionUrl: 'javascript:alert(1)' })],
  ])('stays when the answer has %s, and the next sign-in from this page is asked for', async (_label, answer) => {
    await signedInOn(APP, { [SSO_LOGOUT]: [answer] })
    await signOut()
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, false])
  })

  it('stays when the browser holds another portal’s sign-in, which it leaves alone, and asks for the next sign-in', async () => {
    await signedInOn(APP, { [SSO_LOGOUT]: [() => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the staff application.')] })
    await signOut()
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect(sso.signedOutInThisPage()).toBe(true)
  })

  it('keeps the page and says so when the sign-out fails, leaving for nothing', async () => {
    await signedInOn(APP, { [SSO_LOGOUT]: [() => problem(503, 'UPSTREAM_UNAVAILABLE', 'Try again.')] })
    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect(sso.signedOutInThisPage()).toBe(false)
  })
})

describe('a sign-out that finds the patient’s sign-in already gone, with single sign-on on, on app.', () => {
  it.each([
    ['401', gone],
    ['403 CSRF_VALIDATION_FAILED (no refresh cookie left)', () => problem(403, 'CSRF_VALIDATION_FAILED', 'CSRF validation failed.')],
  ])('still ends the provider’s session once the refresh is refused with %s, and leaves for its end-session address', async (_label, refused) => {
    const sent = await signedInOn(APP, { [SESSION]: [patient, gone, gone], [REFRESH]: [refused], [SSO_LOGOUT]: [ended] })
    await signOut()
    expect(sent.map(request => request.route)).toEqual([SESSION, SESSION, REFRESH, SESSION, SSO_LOGOUT])
    expect(sent.find(request => request.route === SSO_LOGOUT)!.headers.get('X-HID-Client')).toBe('patient-web')
    expect(left.mock.calls).toEqual([[END]])
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, true])
  })

  it('leaves another portal’s sign-in alone when the refresh is refused as SESSION_CLIENT_MISMATCH, and asks for the next sign-in', async () => {
    const sent = await signedInOn(APP, { [SESSION]: [patient, gone, gone], [REFRESH]: [mismatch], [SSO_LOGOUT]: [ended] })
    await signOut()
    expect(sent.map(request => request.route)).toEqual([SESSION, SESSION, REFRESH])
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, false])
  })

  it('leaves alone a sign-in another window made meanwhile, and asks for the next sign-in', async () => {
    const someoneElse = () => json({ actor: { kind: 'patient', subject: 'subject-b', patientId: 'patient-b', accountId: 'account-b' },
      expiresAt: '2026-11-30T12:00:00.000Z' })
    const sent = await signedInOn(APP, { [SESSION]: [patient, gone, someoneElse], [REFRESH]: [gone], [SSO_LOGOUT]: [ended] })
    await signOut()
    expect(sent.map(request => request.route)).toEqual([SESSION, SESSION, REFRESH, SESSION])
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, false])
  })

  it('keeps the page and says so when the provider’s session cannot be ended', async () => {
    await signedInOn(APP, { [SESSION]: [patient, gone, gone], [REFRESH]: [gone],
      [SSO_LOGOUT]: [() => problem(503, 'UPSTREAM_UNAVAILABLE', 'Try again.')] })
    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(left).not.toHaveBeenCalled()
  })

  it('is today’s with the setting unset: nothing more is sent', async () => {
    environment.ssoEnabled = false
    const sent = await signedInOn(APP, { [SESSION]: [patient, gone, gone], [REFRESH]: [gone], [SSO_LOGOUT]: [ended] })
    await signOut()
    expect(sent.map(request => request.route)).toEqual([SESSION, SESSION, REFRESH])
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect(sso.signedOutInThisPage()).toBe(false)
  })
})

describe('a repeated sign-out, with single sign-on on, on app.', () => {
  it('asks for the next sign-in when the restored session’s sign-out finds another portal’s sign-in', async () => {
    const sent = await signedInOn(APP, { [SESSION]: [patient, gone, patient], [REFRESH]: [patient], [SSO_LOGOUT]: [mismatch] })
    await signOut()
    expect(sent.map(request => request.route)).toEqual([SESSION, SESSION, REFRESH, SESSION, SSO_LOGOUT])
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, false])
  })
})

describe('the patient portal’s sign-out where single sign-on does not hand off', () => {
  it.each([
    ['with the setting unset', false, APP],
    ['on a host that is not a product site', true, 'localhost'],
  ])('is today’s sign-out %s', async (_label, enabled, host) => {
    environment.ssoEnabled = enabled
    const sent = await signedInOn(host, { [LOGOUT]: [() => new Response(null, { status: 204 })] })
    const before = sent.length
    await signOut()
    expect(after(sent, before)).toEqual([LOGOUT])
    expect(left).not.toHaveBeenCalled()
    const sso = await import('../../sso/singleSignOn')
    expect(sso.signedOutInThisPage()).toBe(false)
  })
})

describe('signing out of the portal’s shell with single sign-on on', () => {
  it('leaves for the provider’s end-session address only, and the signed-out page that follows hands nothing off', async () => {
    serve({ [SESSION]: Array.from({ length: 4 }, () => patient), [SSO_LOGOUT]: [ended] })
    onSite(APP, '/records')
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/records']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /: account$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
    expect(await screen.findByText('Signing you out of every Health ID site…')).toBeTruthy()
    expect(left.mock.calls).toEqual([[END]])
  })
})
