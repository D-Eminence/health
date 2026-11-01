import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider, useSession } from '../session'
import { shownText } from './portalHarness'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * One browser, both portals. The patient portal and the provider portal share
 * one origin and so one set of session cookies: a sign-in in either replaces the
 * other's cookies. A tab that has not heard about it (no BroadcastChannel here)
 * still acts on the cookies the browser holds now.
 *
 * Identity is a fake that keeps hid-system #39's cookie contract
 * (docs/INTERFACE_CONTRACT.md, "Auth session contract"; auth.controller.ts
 * refresh and logout at 522fb2e): refresh tokens rotate, the CSRF token is
 * derived from the refresh token, and a refresh or cookie sign-out that names
 * the other application in X-HID-Client is refused with 403
 * SESSION_CLIENT_MISMATCH while that sign-in is renewable: nothing is rotated or
 * ended and the cookies are kept. It is a model of the contract, not the service.
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'https://portal.example.test', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))
vi.mock('../staff/env', () => ({ getEnvironment: () => environment }))

type Kind = 'staff' | 'patient'
interface SignIn { kind: Kind; actor: { subject: string }; ended: boolean; rotations: number; refresh: string; access: string; accessLive: boolean }

const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read']
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['clinician'], permissions: PERMISSIONS, isPrimary: true }
const ACTORS: Record<Kind, { subject: string }> = {
  // hid-system's staff actor carries no `kind`.
  staff: { id: 'staff-1', subject: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [], facilities: [facility], facility } as { subject: string },
  patient: { kind: 'patient', subject: 'subject-p', patientId: 'patient-p', accountId: 'account-p' } as { subject: string },
}
/** A second patient, signing in on the same browser. */
const PATIENT_B = { kind: 'patient', subject: 'subject-b', patientId: 'patient-b', accountId: 'account-b' }

function fakeIdentity() {
  let counter = 0
  const signIns: SignIn[] = []
  /** The browser's cookies for this origin. Only the CSRF cookie is readable from script. */
  const jar: { access?: string; refresh?: string; csrf?: string } = {}
  const csrfOf = (refresh: string) => `csrf:${refresh}`
  const sent: { route: string; client: string | null }[] = []

  const issue = (signIn: SignIn) => {
    signIn.access = `access-${++counter}`
    signIn.refresh = `refresh-${counter}`
    signIn.accessLive = true
    jar.access = signIn.access; jar.refresh = signIn.refresh; jar.csrf = csrfOf(signIn.refresh)
  }
  const clear = () => { delete jar.access; delete jar.refresh; delete jar.csrf }
  const byAccess = () => signIns.find(signIn => signIn.access === jar.access && signIn.accessLive && !signIn.ended)
  const byRefresh = () => signIns.find(signIn => signIn.refresh === jar.refresh)
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  const problem = (status: number, code: string, detail = code) => json({ type: 'about:blank', title: code, status, code, detail }, status)
  const session = (signIn: SignIn) => json({ actor: signIn.actor, expiresAt: '2026-10-12T12:00:00.000Z' }, 200, { 'X-CSRF-Token': jar.csrf ?? '' })
  const namedKind = (client: string | null): Kind | undefined => client === 'staff-web' ? 'staff' : client === 'patient-web' ? 'patient' : undefined
  const mismatch = (kind: Kind, client: string | null) => problem(403, 'SESSION_CLIENT_MISMATCH', `This sign-in belongs to the ${kind} application, not ${client}`)

  function handle(route: string, headers: Headers): Response {
    const client = headers.get('X-HID-Client')
    const csrf = headers.get('X-CSRF-Token')
    sent.push({ route, client })
    switch (route) {
      case 'GET /api/v1/auth/session': {
        const live = byAccess()
        return live ? session(live) : problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
      }
      case 'POST /api/v1/auth/refresh': {
        const signIn = byRefresh()
        if (!jar.refresh || !csrf || csrf !== jar.csrf || csrf !== csrfOf(jar.refresh)) return problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')
        const expected = namedKind(client)
        // The other application's renewable sign-in: refused before rotation, cookies kept.
        if (expected && signIn && !signIn.ended && signIn.kind !== expected) return mismatch(signIn.kind, client)
        if (!signIn || signIn.ended) { clear(); return problem(401, 'AUTHENTICATION_REQUIRED', 'Refresh session is no longer active') }
        signIn.rotations += 1
        issue(signIn)
        return session(signIn)
      }
      case 'POST /api/v1/auth/logout': {
        const expected = namedKind(client)
        const live = byAccess()
        if (live) {
          if (!csrf || csrf !== jar.csrf) return problem(403, 'CSRF_VALIDATION_FAILED', 'CSRF validation failed')
          if (expected && live.kind !== expected) return mismatch(live.kind, client)
          live.ended = true; clear(); return new Response(null, { status: 204 })
        }
        if (!jar.refresh) { clear(); return new Response(null, { status: 204 }) }
        if (!csrf || csrf !== jar.csrf || csrf !== csrfOf(jar.refresh)) { clear(); return problem(403, 'CSRF_VALIDATION_FAILED', 'CSRF validation failed') }
        const signIn = byRefresh()
        if (signIn && !signIn.ended && expected && signIn.kind !== expected) return mismatch(signIn.kind, client)
        if (signIn) signIn.ended = true
        clear(); return new Response(null, { status: 204 })
      }
      case 'GET /api/v1/identity/me': {
        const live = byAccess()
        if (!live) return problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
        return live.kind === 'patient' ? json({ hid: `HID-${live.actor.subject.toUpperCase()}` }) : problem(403, 'PATIENT_SESSION_REQUIRED')
      }
      case 'GET /api/v1/identity/access-requests': {
        const live = byAccess()
        if (!live) return problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
        return live.kind === 'staff' ? json([]) : problem(403, 'PATIENT_SCOPE_DENIED', 'This operation requires workforce authorization')
      }
      default:
        return problem(418, 'UNEXPECTED_REQUEST', route)
    }
  }

  return {
    sent, jar,
    /** A sign-in from another tab: it replaces the browser's cookies. */
    signIn(kind: Kind, actor = ACTORS[kind]) {
      const signIn: SignIn = { kind, actor, ended: false, rotations: 0, refresh: '', access: '', accessLive: false }
      signIns.push(signIn)
      issue(signIn)
      return signIn
    },
    /** A sign-out from another tab: the session ends and the browser's cookies are cleared. */
    signOutElsewhere() {
      const signIn = byRefresh()
      if (signIn) signIn.ended = true
      clear()
    },
    /** The 15-minute access cookie lapses; the refresh cookie lasts hours. */
    expireAccess() { for (const signIn of signIns) signIn.accessLive = false },
    /**
     * The sign-in's own end, in no other tab: after 8 hours idle its refresh
     * cookie lapses too, and the browser drops every cookie.
     */
    lapse() { for (const signIn of signIns) signIn.accessLive = false; clear() },
    /** Identity ends the sign-in itself (revoked, or past its lifetime); the browser still sends its cookies. */
    endOnServer() { const signIn = byRefresh(); if (signIn) { signIn.ended = true; signIn.accessLive = false } },
    install() {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
        return handle(`${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`, new Headers(init?.headers))
      }))
      vi.spyOn(document, 'cookie', 'get').mockImplementation(() => jar.csrf ? `hid_access_csrf=${jar.csrf}` : '')
    },
  }
}

beforeEach(() => {
  // Neither tab hears the other: the case each portal must survive on its own.
  vi.stubGlobal('BroadcastChannel', undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

let profileOutcome: string | undefined
function PatientTab() {
  const { state, api, signOut } = useSession()
  return <section aria-label="Patient tab">
    <output data-testid="patient-status">{state.status}</output>
    <button type="button" onClick={() => { void api.profile().then(() => { profileOutcome = 'loaded' }, (error: { status?: number }) => { profileOutcome = String(error.status) }) }}>Read profile</button>
    <button type="button" onClick={() => { void signOut().catch(() => undefined) }}>Patient sign out</button>
  </section>
}

async function openPatientTab() {
  render(<SessionProvider><PatientTab /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('patient-status').textContent).toBe('authenticated'))
}

async function openProviderTab() {
  const { App } = await import('../staff/App')
  render(<section aria-label="Provider tab"><MemoryRouter initialEntries={['/provider']}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter></section>)
  expect(await screen.findByText('0 pending requests')).toBeTruthy()
}

const providerTab = () => within(screen.getByRole('region', { name: 'Provider tab' }))
const patientStatus = () => screen.getByTestId('patient-status').textContent
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe('one browser, both portals (hid-system #39 contract)', () => {
  it('a provider signing out after a patient signed in elsewhere leaves the patient\'s sign-in alone', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('staff')
    await openProviderTab()
    // A patient signs in from another tab; the provider tab does not hear of it.
    const patient = identity.signIn('patient')
    await openPatientTab()

    fireEvent.click(providerTab().getByRole('button', { name: 'Sign out' }))
    expect(await providerTab().findByRole('heading', { name: 'Welcome back' })).toBeTruthy()
    await settle()

    expect(identity.sent.filter(call => call.route === 'POST /api/v1/auth/logout')).toEqual([{ route: 'POST /api/v1/auth/logout', client: 'staff-web' }])
    expect(patient.ended).toBe(false)
    expect(patient.rotations).toBe(0)
    expect(identity.jar.access).toBe(patient.access)
    expect(patientStatus()).toBe('authenticated')
    profileOutcome = undefined
    await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
    await waitFor(() => expect(profileOutcome).toBe('loaded'))
  })

  it('a patient signing out after an idle period, with a provider signed in elsewhere, neither rotates nor ends the provider\'s sign-in', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openPatientTab()
    const provider = identity.signIn('staff')
    await openProviderTab()
    identity.expireAccess()

    await act(async () => { screen.getByRole('button', { name: 'Patient sign out' }).click() })
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    await settle()

    const auth = identity.sent.filter(call => call.route.startsWith('POST /api/v1/auth/'))
    expect(auth).toEqual([{ route: 'POST /api/v1/auth/refresh', client: 'patient-web' }])
    expect(provider.ended).toBe(false)
    expect(provider.rotations).toBe(0)
    expect(identity.jar.refresh).toBe(provider.refresh)
    // The provider's own next read restores the provider's sign-in as usual.
    fireEvent.click(providerTab().getByRole('link', { name: 'Access requests' }))
    await waitFor(() => expect(provider.rotations).toBe(1))
    expect(providerTab().queryByRole('heading', { name: 'Your session has ended' })).toBeNull()
  })

  it('a provider\'s read after a patient signed in elsewhere ends only the provider\'s workspace, and the patient\'s sign-in is not rotated', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('staff')
    await openProviderTab()
    const patient = identity.signIn('patient')
    await openPatientTab()
    identity.expireAccess()

    fireEvent.click(providerTab().getByRole('link', { name: 'Access requests' }))
    expect(await providerTab().findByRole('heading', { name: 'Your session has ended' })).toBeTruthy()
    await settle()

    const auth = identity.sent.filter(call => call.route.startsWith('POST /api/v1/auth/'))
    expect(auth.length).toBeGreaterThan(0)
    expect(auth.every(call => call.route === 'POST /api/v1/auth/refresh' && call.client === 'staff-web')).toBe(true)
    expect(patient.rotations).toBe(0)
    expect(patient.ended).toBe(false)
    expect(patientStatus()).toBe('authenticated')
    // The patient's own next read restores the patient's sign-in.
    profileOutcome = undefined
    await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
    await waitFor(() => expect(profileOutcome).toBe('loaded'))
    expect(patient.rotations).toBe(1)
  })
})

/** The origin's tabs, as BroadcastChannel connects them: a channel never hears its own messages. */
class TabBus extends EventTarget {
  static open = new Set<TabBus>()
  constructor(readonly name: string) { super(); TabBus.open.add(this) }
  postMessage(data: unknown) {
    for (const other of TabBus.open) {
      if (other !== this && other.name === this.name) setTimeout(() => other.dispatchEvent(new MessageEvent('message', { data })), 0)
    }
  }
  close() { TabBus.open.delete(this) }
}
/** Another tab of the origin saying the browser's session changed. */
const anotherTab = async () => { await act(async () => { new TabBus('hid-session-change').postMessage('changed'); await new Promise(resolve => setTimeout(resolve, 0)) }) }

let visibility: DocumentVisibilityState = 'visible'
/** The tab goes out of view, and back `awayMs` later. */
function becomeVisible(awayMs = 2 * 60_000) {
  hide()
  show(awayMs)
}
function hide() { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) }
function show(awayMs: number) {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + awayMs)
  try { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) } finally { now.mockRestore() }
}
const sessionReads = (identity: { sent: { route: string }[] }) => identity.sent.filter(call => call.route === 'GET /api/v1/auth/session').length

/** A patient tab showing the patient's own data while it is signed in. */
function RecordsTab() {
  const { state, api, signedOutElsewhere } = useSession()
  const [hid, setHid] = useState<string | null>(null)
  useEffect(() => {
    if (state.status !== 'authenticated') { setHid(null); return }
    void api.profile().then(profile => setHid((profile as { hid: string }).hid), () => undefined)
  }, [state.status, api])
  return <section aria-label="Patient tab">
    <output data-testid="patient-status">{state.status}</output>
    {state.status === 'authenticated' && hid && <p>{hid}</p>}
    {signedOutElsewhere && <p>Signed out in another tab</p>}
    <button type="button" onClick={() => { void api.profile().then(() => { profileOutcome = 'loaded' }, (error: { status?: number }) => { profileOutcome = String(error.status) }) }}>Read profile</button>
  </section>
}

async function openRecordsTab() {
  render(<SessionProvider><RecordsTab /></SessionProvider>)
  expect(await screen.findByText('HID-SUBJECT-P')).toBeTruthy()
}

describe('a patient tab is bound to the patient it shows (SEC-PATIENT-XTAB)', () => {
  beforeEach(() => {
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  it('a sign-out in another tab, heard on the channel, signs this tab out and takes the patient\'s data off screen', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()

    identity.signOutElsewhere()
    await anotherTab()

    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
    expect(screen.getByText('Signed out in another tab')).toBeTruthy()
  })

  it('another patient\'s sign-in, heard on the channel, signs this tab out without reading as that patient', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()

    identity.signIn('patient', PATIENT_B)
    await anotherTab()

    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    expect(document.body.textContent).not.toMatch(/HID-SUBJECT-[PB]/)
    expect(identity.sent.filter(call => call.route === 'GET /api/v1/identity/me')).toHaveLength(1)
  })

  it('a provider\'s sign-in, heard on the channel, signs this tab out', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()

    identity.signIn('staff')
    await anotherTab()
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
  })

  it('a patient read refused because a provider signed in elsewhere (403 PATIENT_SESSION_REQUIRED) asks the server, and signs this tab out', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    // A provider signs in from another tab; this tab does not hear of it, and the provider's access cookie is live.
    const provider = identity.signIn('staff')

    profileOutcome = undefined
    await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
    await waitFor(() => expect(profileOutcome).toBeDefined())

    expect(profileOutcome).toBe('403')
    // The refusal says the session is not a patient's; the server is asked whose it is before the page hears of it.
    const routes = identity.sent.map(call => call.route)
    expect(routes.slice(routes.lastIndexOf('GET /api/v1/identity/me'))).toEqual(['GET /api/v1/identity/me', 'GET /api/v1/auth/session'])
    expect(patientStatus()).toBe('anonymous')
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
    expect(screen.getByText('Signed out in another tab')).toBeTruthy()
    expect(provider.ended).toBe(false)
    expect(provider.rotations).toBe(0)
  })

  it('a refresh that answers for another patient is not this tab\'s session: nothing is repeated as that patient', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openPatientTab()
    identity.signIn('patient', PATIENT_B)
    identity.expireAccess()

    profileOutcome = undefined
    await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
    await waitFor(() => expect(profileOutcome).toBeDefined())

    expect(profileOutcome).toBe('401')
    expect(patientStatus()).toBe('anonymous')
    expect(identity.sent.filter(call => call.route === 'GET /api/v1/identity/me')).toHaveLength(1)
  })

  it('coming back into view after another patient signed in, with their access cookie live, signs this tab out', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    identity.signIn('patient', PATIENT_B)

    await act(async () => { becomeVisible() })
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
    expect(identity.sent.filter(call => call.route === 'GET /api/v1/identity/me')).toHaveLength(1)
  })

  it('coming back into view after the access token expired restores this patient\'s session and keeps the tab', async () => {
    const identity = fakeIdentity()
    identity.install()
    const patient = identity.signIn('patient')
    await openRecordsTab()
    identity.expireAccess()

    await act(async () => { becomeVisible() })
    await waitFor(() => expect(patient.rotations).toBe(1))
    await settle()
    expect(patientStatus()).toBe('authenticated')
    expect(screen.getByText('HID-SUBJECT-P')).toBeTruthy()
  })

  it.each([
    ['its refresh cookie lapsed, so the refresh is refused with 403', 'lapse', 403],
    ['Identity ended it, so the refresh is refused with 401', 'endOnServer', 401],
  ] as const)('coming back into view after this patient\'s own sign-in ended (%s) signs this tab out, and does not say another tab did', async (_, end, refused) => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    identity[end]()

    await act(async () => { becomeVisible() })
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    const answered = (fetch as unknown as { mock: { results: { value: Promise<Response> }[] } }).mock.results
    expect((await answered.at(-1)!.value).status).toBe(refused)
    expect(identity.sent.at(-1)?.route).toBe('POST /api/v1/auth/refresh')
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
    expect(screen.queryByText('Signed out in another tab')).toBeNull()
  })

  it('coming back into view after a provider signed in elsewhere, once the access tokens expired, says the sign-in changed elsewhere', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    identity.signIn('staff')
    identity.expireAccess()

    await act(async () => { becomeVisible() })
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    expect(screen.getByText('Signed out in another tab')).toBeTruthy()
    expect(identity.sent.filter(call => call.route === 'POST /api/v1/auth/refresh')).toEqual([{ route: 'POST /api/v1/auth/refresh', client: 'patient-web' }])
  })

  it('a brief look away, with nothing announced meanwhile, asks the server nothing on return', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    const before = sessionReads(identity)

    await act(async () => { becomeVisible(20_000) })
    await settle()
    expect(sessionReads(identity)).toBe(before)
    expect(identity.sent.filter(call => call.route === 'POST /api/v1/auth/refresh')).toEqual([])
    expect(patientStatus()).toBe('authenticated')
  })

  it('a brief look away during which another tab announced a change asks once, as it is heard, and not again on return', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    const before = sessionReads(identity)

    await act(async () => { hide() })
    await anotherTab()
    await waitFor(() => expect(sessionReads(identity)).toBe(before + 1))
    await act(async () => { show(20_000) })
    await settle()
    expect(sessionReads(identity)).toBe(before + 1)
    expect(patientStatus()).toBe('authenticated')
  })

  it('a brief look away during which an announced change could not be checked asks again on return', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    const before = sessionReads(identity)
    // The question asked as the change is heard finds the service unavailable.
    const asked = vi.mocked(fetch)
    const calls = asked.mock.calls.length
    asked.mockImplementationOnce(async () => new Response(JSON.stringify({ type: 'about:blank', title: 'Unavailable', status: 503,
      code: 'UPSTREAM_UNAVAILABLE', detail: 'Unavailable', retryable: false }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    await act(async () => { hide() })
    await anotherTab()
    await waitFor(() => expect(asked.mock.calls.length).toBe(calls + 1))
    await settle()
    expect(sessionReads(identity)).toBe(before)
    await act(async () => { show(20_000) })
    await waitFor(() => expect(sessionReads(identity)).toBe(before + 1))
    expect(patientStatus()).toBe('authenticated')
  })

  it('a page restored from the back/forward cache asks, however brief its absence, and only once', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    const before = sessionReads(identity)

    await act(async () => {
      hide()
      show(5_000)
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await settle()
    expect(sessionReads(identity)).toBe(before + 1)
  })

  it('coming back into view while the service cannot be reached keeps the tab', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    await openRecordsTab()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    await act(async () => { becomeVisible() })
    await settle()
    expect(patientStatus()).toBe('authenticated')
    expect(screen.getByText('HID-SUBJECT-P')).toBeTruthy()
  })

  it('the portal leaves the patient\'s pages for sign-in, which says why', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    const { App } = await import('../App')
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByText('HID-SUBJECT-P')).toBeTruthy()

    identity.signOutElsewhere()
    await anotherTab()

    expect(shownText(await screen.findByRole('alert')))
      .toBe('You were signed out because someone signed in or out on this device in another tab. Sign in again to continue.')
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy()
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
  })

  it('sign-in stops saying a provider is signed in once the provider signs out in another tab', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('staff')
    const { App } = await import('../App')
    render(<MemoryRouter initialEntries={['/sign-in']}><App /></MemoryRouter>)
    const note = /^A provider is signed in on this device\. Signing in here will sign them out\./
    expect(await screen.findByText(note)).toBeTruthy()

    identity.signOutElsewhere()
    await anotherTab()

    await waitFor(() => expect(screen.queryByText(note)).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the portal leaves the patient\'s pages for sign-in when the patient\'s own sign-in ended, and blames no other tab', async () => {
    const identity = fakeIdentity()
    identity.install()
    identity.signIn('patient')
    const { App } = await import('../App')
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByText('HID-SUBJECT-P')).toBeTruthy()

    identity.lapse()
    await act(async () => { becomeVisible() })

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/changed in another tab/)).toBeNull()
    expect(screen.queryByText('HID-SUBJECT-P')).toBeNull()
  })

  it('a tab does not hear its own sign-in, and asks the server nothing more', async () => {
    vi.stubGlobal('BroadcastChannel', TabBus)
    const identity = fakeIdentity()
    identity.install()
    function SignInTab() {
      const { state, signIn } = useSession()
      return <><output data-testid="patient-status">{state.status}</output>
        <button type="button" onClick={() => { void signIn('patient@example.test', 'correct horse', 'token').catch(() => undefined) }}>Sign in</button></>
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
      identity.sent.push({ route, client: null })
      if (route === 'POST /api/v1/auth/patient/login') { identity.signIn('patient'); return new Response(JSON.stringify({ actor: ACTORS.patient }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
      return new Response(JSON.stringify({ status: 401, code: 'AUTHENTICATION_REQUIRED', detail: 'Valid authentication is required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }))
    render(<SessionProvider><SignInTab /></SessionProvider>)
    await waitFor(() => expect(patientStatus()).toBe('anonymous'))
    await act(async () => { screen.getByRole('button', { name: 'Sign in' }).click() })
    await waitFor(() => expect(patientStatus()).toBe('authenticated'))
    await settle()
    expect(identity.sent.filter(call => call.route === 'GET /api/v1/auth/session')).toHaveLength(1)
  })
})
