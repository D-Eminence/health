import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * The provider workspace when its staff session ends mid-use. The real staff
 * App, API module and HTTP client run; only the network is replaced. hid-system
 * answers an ended, expired or revoked staff session with a generic
 * 401 AUTHENTICATION_REQUIRED and never says why, and its refresh endpoint
 * answers 403 CSRF_VALIDATION_FAILED once the browser has dropped the refresh
 * cookie at the idle or absolute limit.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const SESSION_ENDED = 'Your session has ended'
const PATIENT_NAME = 'Chidi Okafor'
const PATIENT_HID = 'HID-ABCDEF23'
const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'

type Answer = Response | (() => Response | Promise<Response>)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function problem(status: number, code: string, detail: string) {
  return new Response(JSON.stringify({ type: 'about:blank', title: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', status, detail, code }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
}
/** What every protected staff route answers once the session has ended, however it ended. */
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
/** The refresh endpoint refusing the refresh token (ended, revoked, reused, account disabled). */
const refreshRefused = (detail = 'Refresh session is no longer active') => problem(401, 'AUTHENTICATION_REQUIRED', detail)
/** The refresh endpoint once the browser no longer holds the refresh cookie. */
const refreshCookieGone = () => problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')

const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'lab.work-item.read']
const facility = (id = 'facility-1', name = 'Lagos General') => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary: id === 'facility-1' })
const staffSession = (displayName = 'Ada Clinician') => ({
  actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName, roles: ['clinician'], permissions: [],
    facilities: [facility(), facility('facility-2', 'Ikeja Clinic')], facility: facility() },
  expiresAt: '2026-10-10T12:00:00.000Z',
})
/** hid-system answers a sign-out with 204 No Content. */
const signedOut = () => new Response(null, { status: 204 })
const allowedLookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
  patient: { patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME } })

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGIN = 'POST /api/v1/auth/login'
const LOGOUT = 'POST /api/v1/auth/logout'
const FACILITY = 'POST /api/v1/auth/facility'
const REQUESTS = 'GET /api/v1/identity/access-requests'
const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const REQUEST_ACCESS = 'POST /api/v1/identity/access-requests'
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters`
const LAB_WORK = 'GET /api/v1/lab/work-items'

/** Answers each `METHOD /path` from its own queue, in order, and records the calls. */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    const next = routes[route]?.shift()
    if (!next) return json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
    return typeof next === 'function' ? next() : next
  }))
  return calls
}

function deferredResponse() {
  let respond: (response: Response) => void = () => undefined
  const promise = new Promise<Response>(resolve => { respond = resolve })
  return { answer: () => promise, respond: (response: Response) => respond(response) }
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}
const where = () => screen.getByTestId('where').textContent

/** Opens the real staff App at `path`; every commit's DOM is recorded. */
async function open(path: string) {
  const { App } = await import('./App')
  const commits: string[] = []
  render(<Profiler id="staff" onRender={() => { commits.push(document.body.innerHTML) }}>
    <MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>
  </Profiler>)
  return commits
}

/** The session-ended screen: fixed text, a sign-in action, and nothing of the workspace. */
async function expectSessionEnded() {
  const notice = await screen.findByRole('alert')
  expect(within(notice).getByRole('heading', { name: SESSION_ENDED })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Sign in again' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByText('Ada Clinician')).toBeNull()
  expect(screen.queryByText(/Valid authentication is required|Refresh|CSRF|AUTHENTICATION_REQUIRED/)).toBeNull()
  expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
  expect(document.body.innerHTML).not.toContain(PATIENT_HID)
  return notice
}

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery staple' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

async function openPatientRecord() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
}

describe('a staff page read refused because the session ended', () => {
  it.each([
    ['refuses the refresh token', () => refreshRefused()],
    ['no longer holds the refresh cookie', refreshCookieGone],
    ['was revoked (reuse detected)', () => refreshRefused('Refresh token reuse detected')],
  ])('shows the session-ended screen when the refresh %s', async (_label, refusal) => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [ended()], [REFRESH]: [refusal()] })
    const commits = await open('/provider')

    await expectSessionEnded()
    expect(where()).toBe('/provider')
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH])
    // No commit ever showed the server's own wording for the refusal.
    for (const html of commits) expect(html).not.toContain('Valid authentication is required')
  })

  it('removes the patient record already on screen and keeps it gone after the next sign-in', async () => {
    serve({
      [SESSION]: [json(staffSession())],
      [LOOKUP]: [allowedLookup(), allowedLookup()],
      [ENCOUNTERS]: [ended()],
      [REFRESH]: [refreshRefused()],
      [LOGIN]: [json(staffSession())],
    })
    await open('/provider/patients')
    await openPatientRecord()
    await waitFor(() => expect(where()).toBe('/provider/clinical'))

    await expectSessionEnded()
    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    await signIn()

    await waitFor(() => expect(where()).toBe('/provider/clinical'))
    expect(await screen.findByRole('navigation')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
    expect(document.body.innerHTML).not.toContain(PATIENT_HID)
  })
})

describe('an action or refresh refused because the session ended', () => {
  it('shows the session-ended screen when an access request is refused', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [REQUEST_ACCESS]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Clinical reason' }), { target: { value: 'Follow-up of abnormal result' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))

    await expectSessionEnded()
    expect(calls).toContain(REQUEST_ACCESS)
    expect(screen.queryByText(/Request .* is /)).toBeNull()
  })

  it('shows the session-ended screen when a page refresh is refused', async () => {
    serve({ [SESSION]: [json(staffSession())], [LAB_WORK]: [json({ items: [] }), ended()], [REFRESH]: [refreshCookieGone()] })
    await open('/provider/laboratory')
    expect(await screen.findByText('No accepted lab work')).toBeTruthy()
    const refresh = screen.getByRole('button', { name: 'Refresh work' }) as HTMLButtonElement
    await waitFor(() => expect(refresh.disabled).toBe(false))
    fireEvent.click(refresh)

    await expectSessionEnded()
    expect(where()).toBe('/provider/laboratory')
  })

  it('shows the session-ended screen when switching facility finds the session ended', async () => {
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [FACILITY]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    await expectSessionEnded()
  })
})

describe('signing in again', () => {
  it('goes to the real staff sign-in page, returning to the page the session ended on', async () => {
    serve({ [SESSION]: [json(staffSession())], [LAB_WORK]: [ended(), json({ items: [] })], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())] })
    await open('/provider/laboratory')
    await expectSessionEnded()

    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))

    expect(where()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    await signIn()
    await waitFor(() => expect(where()).toBe('/provider/laboratory'))
    expect(await screen.findByRole('heading', { name: 'Laboratory' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: SESSION_ENDED })).toBeNull()
  })

  it('offers no return path from a page that is not a provider workspace page', async () => {
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])] })
    await open('/provider/no-such-page')
    expect(await screen.findByText('This provider page is unavailable.')).toBeTruthy()
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())

    await expectSessionEnded()
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/provider/sign-in')
  })
})

describe('the return path after signing in', () => {
  it.each([
    ['an absolute URL', 'https://evil.example/provider/patients'],
    ['a protocol-relative URL', '//evil.example/provider/patients'],
    ['a backslash URL', '/\\evil.example'],
    ['a script URL', 'javascript:alert(1)'],
    ['a dot-segment escape', '/provider/../admin/overview'],
    ['an encoded escape', '/provider/%2e%2e/admin'],
    ['a page with a query', '/provider/patients?hid=HID-ABCDEF23'],
    ['a page outside the workspace', '/admin/overview'],
    ['the sign-in page itself', '/provider/sign-in'],
  ])('ignores %s and lands on the provider overview', async (_label, returnTo) => {
    serve({ [SESSION]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())], [REQUESTS]: [json([])] })
    await open(`/provider/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
    await signIn()

    await waitFor(() => expect(where()).toBe('/provider'))
    expect(await screen.findByRole('heading', { name: 'Good to see you, Ada.' })).toBeTruthy()
  })

  it('returns to a provider workspace page that is not a product landing page', async () => {
    serve({ [SESSION]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())] })
    await open(`/provider/sign-in?returnTo=${encodeURIComponent('/provider/patients')}`)
    await signIn()

    await waitFor(() => expect(where()).toBe('/provider/patients'))
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
  })
})

describe('late answers after the session ended', () => {
  it('do not bring back a patient record or move to it', async () => {
    const lookup = deferredResponse()
    serve({ [SESSION]: [json(staffSession())], [LOOKUP]: [lookup.answer], [FACILITY]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())] })
    const commits = await open('/provider/patients')
    await openPatientRecord()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await expectSessionEnded()
    const endedAt = commits.length

    await act(async () => { lookup.respond(allowedLookup()) })

    await expectSessionEnded()
    expect(where()).toBe('/provider/patients')
    for (const html of commits.slice(endedAt)) expect(html).not.toContain(PATIENT_NAME)

    // A new session starts without the patient the late answer would have opened.
    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
  })
  it('do not restart the session or move away when a facility switch answers after the session ended', async () => {
    const switched = deferredResponse()
    serve({ [SESSION]: [json(staffSession())], [FACILITY]: [switched.answer] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())
    await expectSessionEnded()

    await act(async () => { switched.respond(json({ ...staffSession(), actor: { ...staffSession().actor, facility: facility('facility-2', 'Ikeja Clinic') } })) })

    await expectSessionEnded()
    expect(where()).toBe('/provider/patients')
    expect(screen.queryByText('Ikeja Clinic')).toBeNull()
  })
})

describe('refusals that do not end the session', () => {
  it('keeps the workspace when patient access is refused (403)', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [LOOKUP]: [problem(403, 'PATIENT_ACCESS_DENIED', 'Patient access is not authorized')] })
    await open('/provider/patients')
    await openPatientRecord()

    expect((await screen.findByRole('alert')).textContent).toBe('Patient access is not authorized')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls).not.toContain(REFRESH)
  })

  it('keeps the workspace when emergency access is refused (403)', async () => {
    serve({ [SESSION]: [json(staffSession())], ['POST /api/v1/identity/break-glass']: [problem(403, 'PERMISSION_DENIED', 'Emergency access is not permitted')] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('tab', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Emergency access is not permitted')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('keeps the workspace when only the access token had expired and the refresh restores the session', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [ended(), json([])], [REFRESH]: [json(staffSession())] })
    await open('/provider')

    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH, REQUESTS])
  })

  it('switches facility after restoring a session whose access token had expired', async () => {
    const calls = serve({
      [SESSION]: [json(staffSession())], [REQUESTS]: [json([]), json([])],
      [FACILITY]: [ended(), json({ ...staffSession(), actor: { ...staffSession().actor, facility: facility('facility-2', 'Ikeja Clinic') } })],
      [REFRESH]: [json(staffSession())],
    })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    expect(await screen.findByText('Working at Ikeja Clinic. All clinical activity uses your current membership and is checked by the backend.')).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls.filter(call => call === FACILITY)).toHaveLength(2)
  })
})

describe('repeated refusals', () => {
  it('show one session-ended screen, make no further requests of their own and never navigate', async () => {
    const lateRead = deferredResponse()
    const calls = serve({
      [SESSION]: [json(staffSession())],
      [REQUESTS]: [ended(), lateRead.answer],
      [REFRESH]: [refreshRefused(), refreshRefused()],
    })
    await open('/provider')
    await expectSessionEnded()
    const before = calls.length

    await act(async () => { lateRead.respond(ended()) })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: SESSION_ENDED })).toHaveLength(1)
    expect(where()).toBe('/provider')
    expect(calls.length).toBe(before)
  })

  it('stay on the sign-in page instead of bouncing back to the workspace', async () => {
    serve({ [SESSION]: [json(staffSession())], [LAB_WORK]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider/laboratory')
    await expectSessionEnded()
    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()

    const { reportStaffSessionEnded } = await import('./session')
    act(() => { reportStaffSessionEnded(); reportStaffSessionEnded() })

    expect(where()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  })
})

describe('opening the workspace with a session that already ended (reload, new tab)', () => {
  it('goes to sign-in, not an error, once the browser no longer holds the refresh cookie', async () => {
    const calls = serve({ [SESSION]: [ended()], [REFRESH]: [refreshCookieGone()] })
    await open('/provider/laboratory')

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.queryByText('Session unavailable')).toBeNull()
    expect(screen.queryByText(/CSRF/)).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH])
  })
})

describe('signing out', () => {
  it('ends the server session even after the access token expired, by restoring it first', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [LOGOUT]: [ended(), signedOut()], [REFRESH]: [json(staffSession())] })
    await open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls.slice(-3)).toEqual([LOGOUT, REFRESH, LOGOUT])
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('signs out when the server had already ended the session', async () => {
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [LOGOUT]: [ended()], [REFRESH]: [refreshCookieGone()] })
    await open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
