import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * The provider workspace when its staff session ends mid-use. The real staff
 * App, API module and HTTP client run; only the network is replaced. hid-system
 * answers an ended, expired or revoked staff session with a generic
 * 401 AUTHENTICATION_REQUIRED and never says why; its refresh endpoint answers
 * 403 CSRF_VALIDATION_FAILED once the browser has dropped the refresh cookie at
 * the idle or absolute limit. Every refresh rotates the session, so a 401 alone
 * does not prove the session ended: the portal asks the server before ending it.
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
/** A protected route refusing a request without a usable session (Identity's wording; other services word it differently). */
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
/** The refresh endpoint refusing the refresh token (ended, revoked, reused, account disabled). */
const refreshRefused = (detail = 'Refresh session is no longer active') => problem(401, 'AUTHENTICATION_REQUIRED', detail)
/** The refresh endpoint once the browser no longer holds the refresh cookie. */
const refreshCookieGone = () => problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')
/** hid-system answers a sign-out with 204 No Content. */
const signedOut = () => new Response(null, { status: 204 })
/** Answers after `ms`, as the network does, so React never merges the answers into one render. */
const later = (ms: number, answer: () => Response) => () => new Promise<Response>(resolve => setTimeout(() => resolve(answer()), ms))

const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'lab.work-item.read']
const facility = (id = 'facility-1', name = 'Lagos General') => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary: id === 'facility-1' })
const staffSession = (id = 'staff-1', displayName = 'Ada Clinician') => ({
  actor: { kind: 'staff', id, email: 'ada@example.test', displayName, roles: ['clinician'], permissions: [],
    facilities: [facility(), facility('facility-2', 'Ikeja Clinic')], facility: facility() },
  expiresAt: '2026-10-10T12:00:00.000Z',
})
const atIkeja = () => ({ ...staffSession(), actor: { ...staffSession().actor, facility: facility('facility-2', 'Ikeja Clinic') } })
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

/**
 * Answers each `METHOD /path` from its own queue, in order, and records the calls.
 * Like a browser's fetch it never sends a request already cancelled, and a request
 * cancelled on its way rejects at once, whenever the server would have answered.
 */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    const cancelled = () => new DOMException('The operation was aborted.', 'AbortError')
    const signal = init.signal
    if (signal?.aborted) throw cancelled()
    calls.push(route)
    const next = routes[route]?.shift()
    const answer = Promise.resolve(!next ? json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418) : typeof next === 'function' ? next() : next)
    if (!signal) return answer
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(cancelled())
      signal.addEventListener('abort', abort, { once: true })
      answer.then(response => { signal.removeEventListener('abort', abort); resolve(response) }, reject)
    })
  }))
  return calls
}

/**
 * The check the portal makes before it ends a session: the session read is
 * refused and so is the refresh. Queue these after the answers that open the
 * workspace.
 */
const confirmedEnd = { session: ended, refresh: () => refreshRefused() }

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

/** Lets every answer already due, and everything it schedules, run. */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

/** The session-ended screen: fixed text, focus on its heading, a sign-in action, and nothing of the workspace. */
async function expectSessionEnded() {
  const heading = await screen.findByRole('heading', { name: SESSION_ENDED })
  const notice = heading.closest<HTMLElement>('[role="alert"]')
  if (!notice) throw new Error('Expected the session-ended notice to be an alert.')
  // The notice is the only alert left: every page and its own messages are gone.
  expect(screen.getAllByRole('alert')).toEqual([notice])
  expect(within(notice).getByRole('heading', { name: SESSION_ENDED })).toBe(heading)
  await waitFor(() => expect(document.activeElement).toBe(heading))
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

/** Ends the session from outside any page, as a refused request would, once the server confirms it. */
async function endSessionNow() {
  const { reportStaffSessionEnded } = await import('./session')
  act(() => reportStaffSessionEnded())
  await expectSessionEnded()
}

async function signInAgain(returnTo: string) {
  fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
  await signIn()
  await waitFor(() => expect(where()).toBe(returnTo))
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
}

describe('a staff page read refused because the session ended', () => {
  it.each([
    ['refuses the refresh token', () => refreshRefused()],
    ['no longer holds the refresh cookie', refreshCookieGone],
    ['was revoked (reuse detected)', () => refreshRefused('Refresh token reuse detected')],
  ])('shows the session-ended screen once the server confirms it, when the refresh %s', async (_label, refusal) => {
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [ended()], [REFRESH]: [refusal(), refusal()] })
    await open('/provider')

    await expectSessionEnded()
    expect(where()).toBe('/provider')
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, REFRESH])
  })

  it('removes the patient record already on screen and keeps it gone after the next sign-in', async () => {
    serve({
      [SESSION]: [json(staffSession()), confirmedEnd.session()],
      [LOOKUP]: [allowedLookup(), allowedLookup()],
      [ENCOUNTERS]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()],
      [LOGIN]: [json(staffSession())],
    })
    await open('/provider/patients')
    await openPatientRecord()
    await waitFor(() => expect(where()).toBe('/provider/clinical'))

    await expectSessionEnded()
    await signInAgain('/provider/clinical')

    expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
    expect(document.body.innerHTML).not.toContain(PATIENT_HID)
  })
})

describe('a refused request while the server still accepts the session', () => {
  it('keeps the workspace when another refresh rotated the session under a retry', async () => {
    // The retry carried a token that a later refresh had already rotated away; the session lives on.
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession())], [REQUESTS]: [ended(), ended()], [REFRESH]: [json(staffSession())] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH, REQUESTS, SESSION]))
    await settle()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('keeps the workspace when the server cannot be asked whether the session ended', async () => {
    // The session read is retried twice on a 503, so every attempt is answered and awaited.
    const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')
    const calls = serve({ [SESSION]: [json(staffSession()), unavailable(), unavailable(), unavailable()],
      [REQUESTS]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, SESSION, SESSION]), { timeout: 5000 })
    await settle()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('keeps the workspace when the server cannot restore the session while being asked', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), ended()], [REQUESTS]: [ended()],
      [REFRESH]: [refreshRefused(), problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, REFRESH]))
    await settle()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('does not end the next session when the server answers after the clinician signed out and in again', async () => {
    const asked = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), asked.answer], [REQUESTS]: [ended()], [REFRESH]: [refreshRefused(), refreshRefused()],
      [LOGOUT]: [signedOut()], [LOGIN]: [json(staffSession())] })
    await open('/provider')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    await signIn()
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()

    // Read before the new sign-in, the answer names another account: it was about the previous session.
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })
    await settle()

    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('ends the workspace when restoring the session for the check yields another account', async () => {
    serve({ [SESSION]: [json(staffSession()), ended()], [REQUESTS]: [ended()],
      [REFRESH]: [refreshRefused(), json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')

    await expectSessionEnded()
    expect(screen.queryByText('Bola Nurse')).toBeNull()
  })

  it('ends the workspace when the browser\'s session now belongs to another account', async () => {
    serve({ [SESSION]: [json(staffSession()), json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider')

    await expectSessionEnded()
    expect(screen.queryByText('Bola Nurse')).toBeNull()
  })
})

describe('asking the server', () => {
  it('asks again when another refusal arrives while an earlier answer is on its way', async () => {
    const firstAnswer = deferredResponse()
    const calls = serve({
      [SESSION]: [json(staffSession()), firstAnswer.answer, confirmedEnd.session()],
      [REQUESTS]: [ended(), ended()], [FACILITY]: [ended()],
      [REFRESH]: [json(staffSession()), refreshRefused(), confirmedEnd.refresh()],
    })
    await open('/provider')
    // The overview's retry is refused as a refresh rotates the session: the server is asked.
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    // Then the session is revoked: a facility switch is refused and cannot be restored.
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await waitFor(() => expect(calls.filter(call => call === REFRESH)).toHaveLength(2))

    // The first answer was read before the revocation and still accepts the session.
    await act(async () => { firstAnswer.respond(json(staffSession())) })

    await expectSessionEnded()
    expect(calls.filter(call => call === SESSION)).toHaveLength(3)
  })

  it.each([
    ['still waiting', false],
    ['already answered', true],
  ])('asks about the next session even while a question about the previous one is %s', async (_label, answerFirst) => {
    const previous = deferredResponse()
    const calls = serve({
      [SESSION]: [json(staffSession()), previous.answer, confirmedEnd.session()],
      [REQUESTS]: [ended(), ended(), json([])],
      [REFRESH]: [json(staffSession()), confirmedEnd.refresh()],
      [LOGOUT]: [signedOut()], [LOGIN]: [json(staffSession())],
    })
    await open('/provider')
    // The previous session's overview retry is refused: its question is on its way.
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await signIn()
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    if (answerFirst) await act(async () => { previous.respond(json(staffSession())) })

    // A request of the new session is refused, as a revoked session's would be.
    await endSessionNow()

    if (!answerFirst) await act(async () => { previous.respond(json(staffSession())) })
    await expectSessionEnded()
  })

  it('never restores the next session to answer a question about the previous one', async () => {
    const previous = deferredResponse()
    const calls = serve({
      [SESSION]: [json(staffSession()), previous.answer],
      [REQUESTS]: [ended(), ended(), json([])],
      [REFRESH]: [json(staffSession())],
      [LOGOUT]: [signedOut()], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))],
    })
    await open('/provider')
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await signIn()
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const before = calls.length

    await act(async () => { previous.respond(ended()) })
    await settle()

    expect(calls.slice(before)).toEqual([])
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('counts a refusal of a request sent before a facility switch', async () => {
    const read = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [read.answer, json([])], [FACILITY]: [json(atIkeja())],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    expect(await screen.findByText(/^Working at Ikeja Clinic\./)).toBeTruthy()

    await act(async () => { read.respond(ended()) })

    await expectSessionEnded()
  })
})

describe('an action or refresh refused because the session ended', () => {
  it('shows the session-ended screen when an access request is refused', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUEST_ACCESS]: [ended()], [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Clinical reason' }), { target: { value: 'Follow-up of abnormal result' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))

    await expectSessionEnded()
    expect(calls).toContain(REQUEST_ACCESS)
    expect(screen.queryByText(/Request .* is /)).toBeNull()
  })

  it('shows the session-ended screen when a page refresh is refused', async () => {
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LAB_WORK]: [json({ items: [] }), ended()], [REFRESH]: [refreshCookieGone(), refreshCookieGone()] })
    await open('/provider/laboratory')
    expect(await screen.findByText('No accepted lab work')).toBeTruthy()
    const refresh = screen.getByRole('button', { name: 'Refresh work' }) as HTMLButtonElement
    await waitFor(() => expect(refresh.disabled).toBe(false))
    fireEvent.click(refresh)

    await expectSessionEnded()
    expect(where()).toBe('/provider/laboratory')
  })

  it('shows the session-ended screen when switching facility finds the session ended', async () => {
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([])], [FACILITY]: [ended()], [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    await expectSessionEnded()
  })
})

describe('signing in again', () => {
  it('goes to the real staff sign-in page, returning to the page the session ended on', async () => {
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LAB_WORK]: [ended(), json({ items: [] })],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()], [LOGIN]: [json(staffSession())] })
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
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REFRESH]: [confirmedEnd.refresh()] })
    await open('/provider/no-such-page')
    expect(await screen.findByText('This provider page is unavailable.')).toBeTruthy()

    await endSessionNow()
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
    ['an unknown provider page', '/provider/admin'],
    ['a workspace page with a trailing slash', '/provider/patients/'],
    ['a workspace page in another case', '/provider/Patients'],
    ['a longer name that starts like a workspace page', '/provider/patientsx'],
  ])('ignores %s and lands on the provider overview', async (_label, returnTo) => {
    serve({ [SESSION]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())], [REQUESTS]: [json([])] })
    await open(`/provider/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
    await signIn()

    await waitFor(() => expect(where()).toBe('/provider'))
    expect(await screen.findByRole('heading', { name: 'Good to see you, Ada.' })).toBeTruthy()
  })

  it.each([
    '/provider', '/provider/patients', '/provider/registration', '/provider/requests', '/provider/audit',
    '/provider/clinical', '/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/outreach', '/provider/migrate',
  ])('returns to the workspace page %s', async page => {
    serve({ [SESSION]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())] })
    await open(`/provider/sign-in?returnTo=${encodeURIComponent(page)}`)
    await signIn()

    await waitFor(() => expect(where()).toBe(page))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
  })
})

describe('late answers after the session ended', () => {
  it('do not bring back a patient record or move to it, while the session is ended or after the next sign-in', async () => {
    const lookup = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [lookup.answer], [FACILITY]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()], [LOGIN]: [json(staffSession())] })
    const commits = await open('/provider/patients')
    await openPatientRecord()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await expectSessionEnded()
    await signInAgain('/provider/patients')
    const signedInAt = commits.length

    await act(async () => { lookup.respond(allowedLookup()) })

    expect(where()).toBe('/provider/patients')
    for (const html of commits.slice(signedInAt)) expect(html).not.toContain(PATIENT_NAME)
    expect(screen.queryByText('Current authorized record')).toBeNull()
  })

  it('do not open a patient looked up at the facility the clinician has since left', async () => {
    const lookup = deferredResponse()
    serve({ [SESSION]: [json(staffSession())], [LOOKUP]: [lookup.answer], [FACILITY]: [json(atIkeja())] })
    const commits = await open('/provider/patients')
    await openPatientRecord()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await waitFor(() => expect(where()).toBe('/provider'))
    const switchedAt = commits.length

    await act(async () => { lookup.respond(allowedLookup()) })

    expect(where()).toBe('/provider')
    for (const html of commits.slice(switchedAt)) expect(html).not.toContain(PATIENT_NAME)
  })

  it('do not restart the session or move away when a facility switch answers after the session ended', async () => {
    const switched = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [FACILITY]: [switched.answer], [REFRESH]: [confirmedEnd.refresh()] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await endSessionNow()

    await act(async () => { switched.respond(json(atIkeja())) })

    await expectSessionEnded()
    expect(where()).toBe('/provider/patients')
    expect(screen.queryByText('Ikeja Clinic')).toBeNull()
  })

  it.each([
    ['accepted', () => json(atIkeja())],
    ['refused with 401', ended],
  ])('do not switch the next session when a facility switch from the ended one is %s after sign-in', async (_label, answer) => {
    const switched = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [FACILITY]: [switched.answer],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession())], [LOGIN]: [json(staffSession())] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await endSessionNow()
    await signInAgain('/provider/patients')
    const before = calls.length

    await act(async () => { switched.respond(answer()) })
    await settle()

    expect(where()).toBe('/provider/patients')
    expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-1')
    // Nothing is retried with the next session's cookies.
    expect(calls.slice(before)).toEqual([])
  })

  it('sign in only once a sign-out from the ended session has finished, whose answer clears the session cookies', async () => {
    const leaving = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([]), json([])], [LOGOUT]: [leaving.answer],
      [REFRESH]: [confirmedEnd.refresh()], [LOGIN]: [json(staffSession())] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await endSessionNow()
    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    await signIn()
    await settle()
    expect(calls).not.toContain(LOGIN)

    await act(async () => { leaving.respond(signedOut()) })

    await waitFor(() => expect(where()).toBe('/provider'))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
    expect(calls.indexOf(LOGIN)).toBeGreaterThan(calls.indexOf(LOGOUT))
  })

  const actions = {
    'facility switch': { route: FACILITY, start: async () => { fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } }) } },
    'sign-out': { route: LOGOUT, start: async () => { fireEvent.click(await screen.findByRole('button', { name: 'Sign out' })) } },
  } as const
  it.each([
    ['facility switch', 'while the session-ended screen shows'],
    ['sign-out', 'while the session-ended screen shows'],
    ['facility switch', 'as the next sign-in waits for it'],
    ['sign-out', 'as the next sign-in waits for it'],
  ] as const)('do not repeat a %s with cookies that belong to someone else when its restore answers %s', async (action, when) => {
    const { route, start } = actions[action]
    const restore = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [json([]), json([])],
      [route]: [ended(), signedOut()], [REFRESH]: [restore.answer], [LOGIN]: [json(staffSession())] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    await start()
    await waitFor(() => expect(calls).toContain(REFRESH))
    // The browser now holds another account's session (signed in from another tab): this one has ended.
    await endSessionNow()
    if (when === 'as the next sign-in waits for it') {
      fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
      await signIn()
      await settle()
      expect(calls).not.toContain(LOGIN)
    }
    const before = calls.length

    await act(async () => { restore.respond(json(staffSession('staff-2', 'Bola Nurse'))) })
    await settle()

    expect(calls.slice(before).filter(call => call === route)).toEqual([])
    if (when === 'as the next sign-in waits for it') {
      await waitFor(() => expect(where()).toBe('/provider'))
      expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
      expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-1')
    } else if (action === 'sign-out') {
      // The person asked to sign out and the session is gone: they reach sign-in.
      expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    } else {
      await expectSessionEnded()
    }
  })

  it('do not send, restore or repeat as the next account a request made while the session-ended screen showed', async () => {
    const lookup = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [lookup.answer, allowedLookup()],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    await endSessionNow()
    // A page of the ended session carries on (say, after an earlier step answered) and looks a patient up.
    const { staffApi } = await import('./api')
    const late = staffApi.lookupPatient('facility-1', PATIENT_HID).then(() => 'answered', (error: { code?: string }) => error.code)
    await waitFor(() => expect(calls).toContain(LOOKUP))
    await signInAgain('/provider/patients')

    await act(async () => { lookup.respond(ended()) })
    await settle()

    // Cancelled when the next session started: never restored with its cookies or sent again.
    expect(await late).toBe('REQUEST_CANCELLED')
    expect(calls.filter(call => call === LOOKUP)).toHaveLength(1)
    expect(calls.filter(call => call === REFRESH)).toHaveLength(1)
  })

  it('do not repeat a write once the restore that would retry it shows the session belongs to another account', async () => {
    const restore = deferredResponse()
    const BREAK_GLASS = 'POST /api/v1/identity/break-glass'
    const calls = serve({ [SESSION]: [json(staffSession()), ended()], [BREAK_GLASS]: [ended(), json({ grantId: 'grant-9' })],
      [REFRESH]: [restore.answer] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('tab', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Unconscious on arrival' } })
    // The server is already being asked about this session, and restoring it is on its way.
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())
    await waitFor(() => expect(calls).toContain(REFRESH))
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))
    await waitFor(() => expect(calls).toContain(BREAK_GLASS))

    // The restore both requests share yields another account's session (signed in from another tab).
    await act(async () => { restore.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    expect(calls.filter(call => call === BREAK_GLASS)).toHaveLength(1)
  })

  it('give the next account a read of its own, never one still in flight from the account before', async () => {
    const adasRead = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [adasRead.answer, json([])], [LOGOUT]: [signedOut()],
      [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await signIn()

    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(calls.filter(call => call === REQUESTS)).toHaveLength(2)
    await act(async () => { adasRead.respond(json([{ accessRequestId: 'request-1', status: 'pending' }])) })
    expect(screen.getByText('0 pending requests')).toBeTruthy()
    expect(screen.queryByText('1 pending request')).toBeNull()
  })

  it('do not end the next session, or repeat the request as its account, when a request from the ended one is refused after sign-in', async () => {
    const lookup = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [lookup.answer, allowedLookup()], [FACILITY]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    await openPatientRecord()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await expectSessionEnded()
    await signInAgain('/provider/patients')
    const before = calls.length

    await act(async () => { lookup.respond(ended()) })
    await settle()

    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    // Neither restored with the next account's session and sent again, nor questioned.
    expect(calls.slice(before)).toEqual([])
    expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
  })

  it('do not repeat an emergency access from the ended session as the next account', async () => {
    const emergency = deferredResponse()
    const BREAK_GLASS = 'POST /api/v1/identity/break-glass'
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [BREAK_GLASS]: [emergency.answer, json({ grantId: 'grant-9' })],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('tab', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))
    await waitFor(() => expect(calls).toContain(BREAK_GLASS))
    await endSessionNow()
    await signInAgain('/provider/patients')
    const before = calls.length

    await act(async () => { emergency.respond(ended()) })
    await settle()

    expect(calls.slice(before)).toEqual([])
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('do not restore a sign-out refused after the session ended with the cookies the browser now holds', async () => {
    const leaving = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [json([])],
      [LOGOUT]: [leaving.answer, signedOut()], [REFRESH]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // The browser now holds another account's session (signed in from another tab): this one has ended.
    await endSessionNow()
    const before = calls.length

    await act(async () => { leaving.respond(ended()) })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls.slice(before)).toEqual([])
  })

  it('finish a deliberate sign-out that the server confirms while the session-ended screen shows', async () => {
    const leaving = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([])], [LOGOUT]: [leaving.answer], [REFRESH]: [confirmedEnd.refresh()] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await endSessionNow()

    await act(async () => { leaving.respond(signedOut()) })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('do not turn a deliberate sign-out into a session-ended screen', async () => {
    const read = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [read.answer], [LOGOUT]: [signedOut()], [REFRESH]: [refreshCookieGone()] })
    await open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()

    await act(async () => { read.respond(ended()) })
    await settle()

    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
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

  it('keeps the workspace when a facility switch is refused (403), without restoring the session', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [FACILITY]: [problem(403, 'FACILITY_ACCESS_DENIED', 'You are not a member of this facility')] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    expect((await screen.findByRole('alert')).textContent).toBe('You are not a member of this facility')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(calls.filter(call => call === FACILITY)).toHaveLength(1)
    expect(calls).not.toContain(REFRESH)
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
  })

  it('keeps the workspace when the refresh is refused for a reason other than a missing cookie (403)', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [ended()], [REFRESH]: [problem(403, 'ORIGIN_DENIED', 'Origin is not allowed')] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH]))
    await settle()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('keeps the workspace when only the access token had expired and the refresh restores the session', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [ended(), json([])], [REFRESH]: [json(staffSession())] })
    await open('/provider')

    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH, REQUESTS])
  })

  it('restores the session each time the access token expires', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [LAB_WORK]: [json({ items: [] }), ended(), json({ items: [] }), ended(), json({ items: [] })],
      [REFRESH]: [json(staffSession()), json(staffSession())] })
    await open('/provider/laboratory')
    for (let expiry = 1; expiry <= 2; expiry += 1) {
      expect(await screen.findByText('No accepted lab work')).toBeTruthy()
      const refresh = screen.getByRole('button', { name: 'Refresh work' }) as HTMLButtonElement
      await waitFor(() => expect(refresh.disabled).toBe(false))
      fireEvent.click(refresh)
      await waitFor(() => expect(calls.filter(call => call === LAB_WORK)).toHaveLength(1 + 2 * expiry))
    }

    expect(await screen.findByText('No accepted lab work')).toBeTruthy()
    expect(calls.filter(call => call === REFRESH)).toHaveLength(2)
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('restores the session once for requests refused together', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [later(10, ended), json([])],
      [FACILITY]: [later(10, ended), json(atIkeja())], [REFRESH]: [later(40, () => json(staffSession()))] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    expect(await screen.findByText(/^Working at Ikeja Clinic\./)).toBeTruthy()
    expect(calls.filter(call => call === REFRESH)).toHaveLength(1)
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('switches facility after restoring a session whose access token had expired', async () => {
    const calls = serve({
      [SESSION]: [json(staffSession())], [REQUESTS]: [json([]), json([])],
      [FACILITY]: [ended(), json(atIkeja())],
      [REFRESH]: [json(staffSession())],
    })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    expect(await screen.findByText(/^Working at Ikeja Clinic\./)).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
    expect(calls.filter(call => call === FACILITY)).toHaveLength(2)
    // A 401 under /api/v1/auth/ is the caller's to handle: the session was not questioned.
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
  })
})

describe('repeated refusals', () => {
  it('show one session-ended screen, ask the server once and never navigate', async () => {
    const calls = serve({
      [SESSION]: [json(staffSession()), later(30, confirmedEnd.session)],
      [REQUESTS]: [later(10, ended)],
      [FACILITY]: [later(10, ended)],
      [REFRESH]: [later(20, () => refreshRefused()), confirmedEnd.refresh()],
    })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    await expectSessionEnded()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(where()).toBe('/provider')
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
    expect(calls.filter(call => call === REFRESH)).toHaveLength(2)
  })

  it('stay on the sign-in page instead of bouncing back to the workspace', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LAB_WORK]: [ended()], [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })
    await open('/provider/laboratory')
    await expectSessionEnded()
    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    const before = calls.length

    const { reportStaffSessionEnded } = await import('./session')
    act(() => { reportStaffSessionEnded(); reportStaffSessionEnded() })
    await settle()

    expect(where()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls.length).toBe(before)
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
  const authCalls = (calls: string[]) => calls.filter(call => call.startsWith('POST /api/v1/auth/'))

  async function openAndSignOut(routes: Record<string, Answer[]>) {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], ...routes })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    return calls
  }

  it('ends the server session even after the access token expired, by restoring it first', async () => {
    const calls = await openAndSignOut({ [LOGOUT]: [ended(), signedOut()], [REFRESH]: [json(staffSession())] })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(authCalls(calls)).toEqual([LOGOUT, REFRESH, LOGOUT])
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('restores the session again when another refresh rotated it before the sign-out arrived', async () => {
    const calls = await openAndSignOut({ [LOGOUT]: [ended(), ended(), signedOut()], [REFRESH]: [json(staffSession()), json(staffSession())] })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(authCalls(calls)).toEqual([LOGOUT, REFRESH, LOGOUT, REFRESH, LOGOUT])
  })

  it('says so, and keeps the workspace, when the server never confirms the sign-out', async () => {
    const calls = await openAndSignOut({ [LOGOUT]: [ended(), ended(), ended()], [REFRESH]: [json(staffSession()), json(staffSession())] })

    expect((await screen.findByRole('alert')).textContent).toBe('Sign-out could not be completed. Try again.')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
    expect(authCalls(calls)).toEqual([LOGOUT, REFRESH, LOGOUT, REFRESH, LOGOUT])
  })

  it('completes when a facility switch is answered while it runs', async () => {
    const switched = deferredResponse()
    const leaving = deferredResponse()
    await openAndSignOut({ [FACILITY]: [switched.answer], [LOGOUT]: [leaving.answer] })
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })

    await act(async () => { switched.respond(json(atIkeja())) })
    await act(async () => { leaving.respond(signedOut()) })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  })

  it('signs out when the server had already ended the session', async () => {
    await openAndSignOut({ [LOGOUT]: [ended()], [REFRESH]: [refreshCookieGone()] })

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the workspace and says so when the sign-out fails (503)', async () => {
    const calls = await openAndSignOut({ [LOGOUT]: [problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')] })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
    expect(authCalls(calls)).toEqual([LOGOUT])
  })

  it('lets a later sign-in through after a sign-out that failed', async () => {
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([]), json([])],
      [LOGOUT]: [problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')],
      [REFRESH]: [confirmedEnd.refresh()], [LOGIN]: [json(staffSession())] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    await endSessionNow()

    await signInAgain('/provider')
  })

  it('leaves the session\'s requests running when the sign-out fails', async () => {
    const read = deferredResponse()
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [read.answer], [LOGOUT]: [problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')] })
    await open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    await act(async () => { read.respond(json([])) })

    expect(await screen.findByText('0 pending requests')).toBeTruthy()
  })

  it('signs in only once a refresh still in flight has answered, whose answer can clear the session cookies', async () => {
    const restore = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [ended()], [REFRESH]: [restore.answer], [LOGOUT]: [signedOut()],
      [LOGIN]: [json(staffSession())] })
    await open('/provider')
    await waitFor(() => expect(calls).toContain(REFRESH))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await signIn()
    await settle()
    expect(calls).not.toContain(LOGIN)

    await act(async () => { restore.respond(refreshRefused()) })

    await waitFor(() => expect(where()).toBe('/provider'))
    expect(calls.indexOf(LOGIN)).toBeGreaterThan(calls.indexOf(REFRESH))
  })

  it('keeps the workspace and says so when the session cannot be restored to sign out (503)', async () => {
    const calls = await openAndSignOut({ [LOGOUT]: [ended()], [REFRESH]: [problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')] })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
    expect(authCalls(calls)).toEqual([LOGOUT, REFRESH])
  })
})
