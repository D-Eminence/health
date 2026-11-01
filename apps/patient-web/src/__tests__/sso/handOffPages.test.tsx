import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { facility, json, problem, REQUESTS, serve, sessionAt, type Sent } from '../ehr-blue/frame/blueHarness'
import { address, backToTestSite, onSite, openPortalOn, REFRESH, SESSION } from '../sites/siteHarness'

/**
 * Single sign-on's hand-off in the portal (contract v2, "health"): a signed-out product page sends the whole tab to its
 * own host's /api/v1/auth/sso/start; unset, every sign-in page is today's. The portal is opened as each Health ID host
 * serves it, signed out, against a fake Identity; the browser's departure is the test's stand-in for sso/leave.ts. The
 * product hosts are only names here (jsdom's address), as in the sites tests; nothing reaches them. Every account,
 * record and address is fictional.
 */
const environment = vi.hoisted(() => ({
  name: 'production', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, ssoEnabled: false,
  patientChatEnabled: false, supportChatEnabled: false, supportContact: null,
}))
vi.mock('../../env', () => ({ getEnvironment: () => environment }))
vi.mock('../../staff/env', () => ({ getEnvironment: () => environment }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))
const left = vi.hoisted(() => vi.fn())
vi.mock('../../sso/leave', () => ({ leavePage: left }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); left.mockClear(); environment.ssoEnabled = false; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const APP = 'app.healthidentitydirectory.com'
const EHR = 'ehr.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const ENCOUNTER = '3f1c2b7a-9d4e-4c1b-8a2f-6e5d4c3b2a10'
const START = '/api/v1/auth/sso/start'

/** The provider workspace at `path` on `hostname`, signed out, as the browser opens it there. */
async function openSignedOut(hostname: string, path: string): Promise<Sent[]> {
  return openPortalOn(hostname, path)
}

/** Where the portal is now, within this site, as siteHarness's `address()` reads it. */
function Address() {
  const { pathname, search } = useLocation()
  return <span data-testid="address" hidden>{pathname + search}</span>
}

/** Every request the page sent to a single sign-on route. */
const ssoRequests = (sent: Sent[]) => sent.filter(request => request.route.includes('/auth/sso/'))

/** The page handed the whole tab off to `href`, once, and says so while it goes. */
async function expectHandedOff(href: string) {
  await waitFor(() => expect(left).toHaveBeenCalled())
  expect(left).toHaveBeenLastCalledWith(href)
  expect(new Set(left.mock.calls.map(([to]) => to))).toEqual(new Set([href]))
  expect(screen.getByRole('status').textContent).toBe('Opening Health ID sign-in…')
  expect(screen.getByRole('link', { name: 'Continue to sign in' }).getAttribute('href')).toBe(href)
  expect(document.title).toBe('Signing in · Health ID')
  expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
}

/** Today's sign-in page, with no hand-off and no single sign-on request. */
async function expectTodaysSignIn(sent: Sent[]) {
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  expect(left).not.toHaveBeenCalled()
  expect(ssoRequests(sent)).toEqual([])
  expect(screen.queryByText('Opening Health ID sign-in…')).toBeNull()
}

describe('with single sign-on unset (dark)', () => {
  it.each([
    [EHR, '/provider/patients', '/provider/sign-in?returnTo=%2Fprovider%2Fpatients'],
    [EHR, '/provider/sign-in?returnTo=%2Fprovider%2Fclinical', '/provider/sign-in?returnTo=%2Fprovider%2Fclinical'],
    [LAB, '/provider', '/provider/sign-in?returnTo=%2Fprovider'],
    [APP, '/records', '/sign-in'],
    [APP, '/sign-in', '/sign-in'],
  ])('shows today’s sign-in on %s for %s, at today’s address', async (host, path, signInAddress) => {
    const sent = await openSignedOut(host, path)
    await expectTodaysSignIn(sent)
    expect(address()).toBe(signInAddress)
  })
})

describe('with single sign-on on, on a staff site', () => {
  beforeEach(() => { environment.ssoEnabled = true })

  it('hands a signed-out page off with the page the staff Gate came back to', async () => {
    const sent = await openSignedOut(EHR, '/provider/patients')
    await expectHandedOff(`${START}?return_to=%2Fprovider%2Fpatients`)
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(ssoRequests(sent)).toEqual([])
  })

  it('comes back to a clinical record page once the sign-in address carries it', async () => {
    await openSignedOut(EHR, `/provider/sign-in?returnTo=${encodeURIComponent(`/provider/clinical/${ENCOUNTER}`)}`)
    await expectHandedOff(`${START}?return_to=${encodeURIComponent(`/provider/clinical/${ENCOUNTER}`)}`)
  })

  it('comes back to the product’s own page from a record page the staff Gate does not carry yet', async () => {
    await openSignedOut(EHR, `/provider/clinical/${ENCOUNTER}`)
    await expectHandedOff(`${START}?return_to=%2Fprovider%2Fclinical`)
  })

  it.each([
    ['another site’s page', LAB, '/provider/patients', '%2Fprovider%2Flaboratory'],
    ['another host', EHR, '//evil.example/provider', '%2Fprovider%2Fclinical'],
    ['an absolute address', EHR, 'https://evil.example/provider', '%2Fprovider%2Fclinical'],
    ['a page with a Health ID', EHR, '/provider/patients?q=HID-ZDEMAAA2', '%2Fprovider%2Fclinical'],
    ['a sign-in page', EHR, '/provider/sign-in', '%2Fprovider%2Fclinical'],
  ])('comes back to the product’s own page in place of %s', async (_label, host, returnTo, home) => {
    await openSignedOut(host, `/provider/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
    await expectHandedOff(`${START}?return_to=${home}`)
  })

  it('comes back to the product’s own page when the address names two pages', async () => {
    await openSignedOut(EHR, '/provider/sign-in?returnTo=%2Fprovider%2Fpatients&returnTo=%2Fprovider%2Faudit')
    await expectHandedOff(`${START}?return_to=%2Fprovider%2Fclinical`)
  })

  it('opens the workspace as today for a person signed in: only the sign-in page hands off, whatever another page’s address holds', async () => {
    const clinic = facility('f0000000-0000-4000-8000-0000000051e5', 'Fictional Clinic', ['identity.patient.read', 'identity.consent.write'])
    serve({ [SESSION]: [sessionAt(clinic, [clinic])], [REQUESTS]: [() => json([])] })
    onSite(EHR, '/provider/requests?returnTo=%2Fprovider%2Fpatients')
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/provider/requests?returnTo=%2Fprovider%2Fpatients']}><Address /><App /></MemoryRouter>)
    expect(await screen.findByRole('complementary', { name: 'Provider navigation' })).toBeTruthy()
    expect(address()).toBe('/provider/requests?returnTo=%2Fprovider%2Fpatients')
    expect(left).not.toHaveBeenCalled()
  })

  it('keeps today’s form on the sign-in page with nothing to come back to: where a failed hand-off lands, it never hands off again', async () => {
    const sent = await openSignedOut(EHR, '/provider/sign-in')
    await expectTodaysSignIn(sent)
    expect(address()).toBe('/provider/sign-in')
  })

  it('keeps today’s sign-in in this page for an invitation’s join page, whose link lives only in its memory', async () => {
    const sent = await openSignedOut(EHR, '/provider/sign-in?returnTo=%2Fprovider%2Fstaff%2Fjoin')
    await expectTodaysSignIn(sent)
  })

  it('asks for a new sign-in after a sign-out in this page', async () => {
    onSite(EHR)
    const { leaveAfterSignOut } = await import('../../sso/singleSignOn')
    leaveAfterSignOut(null)
    await openSignedOut(EHR, '/provider/patients')
    await expectHandedOff(`${START}?return_to=%2Fprovider%2Fpatients&prompt=login`)
  })

  it('goes nowhere else while the tab leaves for the provider’s end-session address', async () => {
    const end = 'https://auth.example.test/session/end?client_id=ehr'
    onSite(EHR)
    const { leaveAfterSignOut } = await import('../../sso/singleSignOn')
    leaveAfterSignOut(end)
    await openSignedOut(EHR, '/provider/patients')
    expect((await screen.findByText('Signing you out of every Health ID site…')).getAttribute('role')).toBe('status')
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(document.title).toBe('Signing out · Health ID')
    expect(screen.queryByRole('link', { name: 'Continue to sign in' })).toBeNull()
    expect(left.mock.calls).toEqual([[end]])
  })
})

describe('with single sign-on on, on app.', () => {
  beforeEach(() => { environment.ssoEnabled = true })

  it.each([['/records', '%2Frecords'], ['/card/preview', '%2Fcard%2Fpreview'], ['/access/share', '%2Faccess%2Fshare']])(
    'hands a signed-out %s off, coming back to it', async (path, returnTo) => {
      const sent = await openSignedOut(APP, path)
      await expectHandedOff(`${START}?return_to=${returnTo}`)
      expect(address()).toBe(path)
      expect(ssoRequests(sent)).toEqual([])
    })

  it('hands its sign-in entrance off, coming back Home, once the session check finds none', async () => {
    await openSignedOut(APP, '/sign-in')
    await expectHandedOff(`${START}?return_to=%2F`)
  })

  it('checks the session before handing off, and hands nothing off for a patient already signed in', async () => {
    const patient = () => new Response(JSON.stringify({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
      expiresAt: '2026-11-30T12:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    serve({ [SESSION]: [patient, patient, patient] })
    onSite(APP, '/sign-in')
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/sign-in']}><Address /><App /></MemoryRouter>)
    await waitFor(() => expect(address()).toBe('/'))
    expect(left).not.toHaveBeenCalled()
  })

  it('hands nothing off for a page that does not need a session', async () => {
    const sent = await openSignedOut(APP, '/enroll')
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(left).not.toHaveBeenCalled()
    expect(ssoRequests(sent)).toEqual([])
  })
})

describe('with single sign-on on, on a host that is not a product site', () => {
  beforeEach(() => { environment.ssoEnabled = true })

  it.each([['localhost', '/provider/patients', '/provider/sign-in'], ['localhost', '/records', '/sign-in'],
    ['admin.healthidentitydirectory.com', '/provider/patients', '/provider/sign-in']])('shows today’s sign-in on %s for %s', async (host, path, signInAddress) => {
    const sent = await openSignedOut(host, path)
    await expectTodaysSignIn(sent)
    expect(address()).toBe(signInAddress)
  })
})

describe('the session check before a hand-off', () => {
  beforeEach(() => { environment.ssoEnabled = true })

  it('asks Identity first, and hands off only once it finds no session', async () => {
    const sent = serve({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')],
      [REFRESH]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')] })
    onSite(EHR, '/provider/patients')
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/provider/patients']}><Address /><App /></MemoryRouter>)
    await waitFor(() => expect(left).toHaveBeenCalled())
    expect(sent.map(request => request.route).slice(0, 2)).toEqual([SESSION, REFRESH])
  })
})
