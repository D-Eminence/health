import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

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
// Provider sign-in also asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/**
 * The portal's other tabs, as BroadcastChannel would connect them. A channel never
 * hears its own messages; `fromAnotherTab` delivers one as another tab would.
 */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  static posted: unknown[] = []
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage(message: unknown) { TabChannel.posted.push(message) }
  close() { TabChannel.open.delete(this) }
}
beforeEach(() => {
  TabChannel.open.clear()
  TabChannel.posted = []
  vi.stubGlobal('BroadcastChannel', TabChannel)
})
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

const SESSION_ENDED = 'Your session has ended'
const CHECKING = 'Checking your session…'
const UNCONFIRMED = 'We could not confirm your session'
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

const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'identity.patient-access-pin.verify',
  'ehr.encounter.read', 'ehr.document.read', 'lab.work-item.read']
// Emergency access is offered only to a role that can also open the record it grants: the
// patient lookup, and the emergency summary (ehr.encounter.read and ehr.note.read).
const EMERGENCY_PERMISSIONS = [...PERMISSIONS, 'ehr.note.read']
const facility = (id = 'facility-1', name = 'Lagos General', permissions = PERMISSIONS) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions, isPrimary: id === 'facility-1' })
const staffSession = (id = 'staff-1', displayName = 'Ada Clinician', permissions = PERMISSIONS) => ({
  actor: { kind: 'staff', id, email: 'ada@example.test', displayName, roles: ['clinician'], permissions: [],
    facilities: [facility(undefined, undefined, permissions), facility('facility-2', 'Ikeja Clinic', permissions)], facility: facility(undefined, undefined, permissions) },
  expiresAt: '2026-10-10T12:00:00.000Z',
})
const atIkeja = () => ({ ...staffSession(), actor: { ...staffSession().actor, facility: facility('facility-2', 'Ikeja Clinic') } })
/** A patient's session, as /auth/session answers once a patient signed in on this browser (the cookies are shared). */
const patientSession = () => ({ actor: { kind: 'patient', id: 'patient-subject-1', subject: 'patient-subject-1', patientId: PATIENT_ID, accountId: 'account-9' } })
/** Identity and EHR refuse a staff route with this when the request's valid session is a patient's. */
const patientScopeDenied = () => problem(403, 'PATIENT_SCOPE_DENIED', 'This operation requires workforce authorization')
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
const PIN = 'POST /api/v1/identity/standard-access/pin'
const UPLOAD_INTENT = 'POST /api/v1/ehr/documents/upload-intents'
const STORAGE_PUT = 'PUT /bucket/document-1'
const COMPLETE = 'POST /api/v1/ehr/documents/document-1/complete'

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
  const notice = heading.closest<HTMLElement>('section')
  if (!notice) throw new Error('Expected the session-ended notice to be a section.')
  // Announced once, through the focus on its heading: the notice is not also an alert,
  // and every page and its own messages are gone.
  expect(screen.queryAllByRole('alert')).toEqual([])
  expect(within(notice).getByRole('link', { name: 'Sign in again' })).toBeTruthy()
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

/** Whether `text` shows where a person can see it: anywhere but inside the hidden workspace. */
function shown(text: string) {
  return screen.queryAllByText(text, { exact: false }).some(element => !element.closest('[hidden]'))
}

/**
 * The workspace while the server is asked: hidden and inert, with focus on the
 * check's heading. Nothing of the workspace shows: no patient, no navigation and
 * no page error.
 */
async function expectWorkspaceLocked(heading: string = CHECKING) {
  const title = await screen.findByRole('heading', { name: heading })
  await waitFor(() => expect(document.activeElement).toBe(title))
  expect(screen.queryAllByRole('alert')).toEqual([])
  expect(screen.queryByRole('navigation')).toBeNull()
  const workspace = document.querySelector('[inert]')
  expect(workspace?.hasAttribute('hidden')).toBe(true)
  expect(shown(PATIENT_NAME)).toBe(false)
  expect(shown(PATIENT_HID)).toBe(false)
  expect(shown('Valid authentication is required')).toBe(false)
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
}

/**
 * The page's visibility and the clock, under the test's control. `pageHide` and
 * `pageShow` model the back/forward cache, with the visibility change that comes
 * with each (in the order least favourable to the portal on the way back, and as
 * separate tasks, so each may render on its own).
 */
function pageLifecycle() {
  let visibility: DocumentVisibilityState = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const become = (next: DocumentVisibilityState) => { visibility = next; document.dispatchEvent(new Event('visibilitychange')) }
  return {
    hide: () => act(() => become('hidden')),
    show: () => act(() => become('visible')),
    wait: (seconds: number) => { now += seconds * 1000 },
    pageHide: (persisted = true) => act(() => { visibility = 'hidden'; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted })) }),
    pageShow: () => {
      act(() => become('visible'))
      act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    },
    focus: () => act(() => { visibility = 'visible'; window.dispatchEvent(new FocusEvent('focus')) }),
  }
}

/** Opens a patient's clinical record through the Patients page; the name and HID show. */
async function openWithPatient(routes: Record<string, Answer[]>) {
  const calls = serve({ [LOOKUP]: [allowedLookup(), allowedLookup()], [ENCOUNTERS]: [json({ items: [] })], ...routes })
  await open('/provider/patients')
  await openPatientRecord()
  await waitFor(() => expect(where()).toBe('/provider/clinical'))
  await waitFor(() => expect(shown(PATIENT_NAME)).toBe(true))
  return calls
}

/** The workspace open and usable, with no check showing. */
async function expectWorkspaceOpen() {
  expect(await screen.findByRole('navigation')).toBeTruthy()
  expect(document.querySelector('[inert]')).toBeNull()
  expect(screen.queryByRole('heading', { name: CHECKING })).toBeNull()
  expect(screen.queryByRole('heading', { name: UNCONFIRMED })).toBeNull()
  expect(screen.queryByText(SESSION_ENDED)).toBeNull()
}

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery staple' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

/**
 * Switches to Ikeja Clinic as a provider does: choosing it in the facility list
 * only proposes it (PEHR-02), and Switch facility confirms it.
 */
async function switchToIkeja(select: HTMLElement | Promise<HTMLElement>) {
  fireEvent.change(await select, { target: { value: 'facility-2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
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
    await expectWorkspaceOpen()
  })

  it('keeps the workspace locked when the server cannot be asked whether the session ended', async () => {
    // The session read is retried twice on a 503, so every attempt is answered and awaited.
    const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')
    const calls = serve({ [SESSION]: [json(staffSession()), unavailable(), unavailable(), unavailable()],
      [REQUESTS]: [ended()], [REFRESH]: [refreshRefused()] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, SESSION, SESSION]), { timeout: 5000 })
    await expectWorkspaceLocked(UNCONFIRMED)
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('keeps the workspace locked when the server cannot restore the session while being asked', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), ended()], [REQUESTS]: [ended()],
      [REFRESH]: [refreshRefused(), problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')] })
    await open('/provider')

    await waitFor(() => expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION, REFRESH]))
    await expectWorkspaceLocked(UNCONFIRMED)
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('does not end the next session when the server answers after the clinician signed out and in again', async () => {
    const asked = deferredResponse()
    // Sign-out from the lock screen first asks whose session the browser holds: this one, so it signs out.
    serve({ [SESSION]: [json(staffSession()), asked.answer, json(staffSession())], [REQUESTS]: [ended()], [REFRESH]: [refreshRefused(), refreshRefused()],
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
      [REQUESTS]: [ended(), ended()],
      [REFRESH]: [json(staffSession()), confirmedEnd.refresh()],
    })
    await open('/provider')
    // The overview's retry is refused as a refresh rotates the session: the server is asked.
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    await expectWorkspaceLocked()
    // Then the session is revoked, and another request of the session still in flight is refused.
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())

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
      // The third answer is sign-out's own check from the lock screen.
      [SESSION]: [json(staffSession()), previous.answer, json(staffSession()), confirmedEnd.session()],
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
      // The third answer is sign-out's own check from the lock screen.
      [SESSION]: [json(staffSession()), previous.answer, json(staffSession())],
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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))
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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

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

  // A self-signed-up facility's Staff page and the signed-in join page exist only on Novu (P4b).
  it.each([
    ['novu-v1', '/provider/staff', '/provider/staff'],
    ['novu-v1', '/provider/staff/join', '/provider/staff/join'],
    ['main-v1', '/provider/staff', '/provider'],
    ['main-v1', '/provider/staff/join', '/provider'],
  ])('on a %s build, returns from %s to %s', async (contract, page, landing) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    try {
      serve({ [SESSION]: [ended()], [REFRESH]: [refreshRefused()], [LOGIN]: [json(staffSession())], [REQUESTS]: [json([])] })
      await open(`/provider/sign-in?returnTo=${encodeURIComponent(page)}`)
      await signIn()

      await waitFor(() => expect(where()).toBe(landing))
      expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    } finally { vi.unstubAllEnvs() }
  })
})

describe('late answers after the session ended', () => {
  it('do not bring back a patient record or move to it, while the session is ended or after the next sign-in', async () => {
    const lookup = deferredResponse()
    serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [lookup.answer], [FACILITY]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()], [LOGIN]: [json(staffSession())] })
    const commits = await open('/provider/patients')
    await openPatientRecord()
    await switchToIkeja(screen.getByRole('combobox', { name: 'Working at' }))
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
    await switchToIkeja(screen.getByRole('combobox', { name: 'Working at' }))
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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))
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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))
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
    'facility switch': { route: FACILITY, start: async () => { await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' })) } },
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
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [allowedLookup()],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    await endSessionNow()
    // A page of the ended session carries on (say, after an earlier step answered) and looks a patient up.
    const { staffApi } = await import('./api')
    const late = staffApi.lookupPatient('facility-1', PATIENT_HID).then(() => 'answered', (error: { code?: string }) => error.code)
    await settle()
    expect(calls).not.toContain(LOOKUP)
    await signInAgain('/provider/patients')

    // Held while no session was ready, and cancelled when the next one started: never sent with its cookies.
    expect(await late).toBe('REQUEST_CANCELLED')
    expect(calls).not.toContain(LOOKUP)
    expect(calls.filter(call => call === REFRESH)).toHaveLength(1)
  })

  it('do not repeat a write once the restore that would retry it shows the session belongs to another account', async () => {
    const restore = deferredResponse()
    const BREAK_GLASS = 'POST /api/v1/identity/break-glass'
    const calls = serve({ [SESSION]: [json(staffSession(undefined, undefined, EMERGENCY_PERMISSIONS)), json(staffSession('staff-2', 'Bola Nurse'))],
      [BREAK_GLASS]: [ended(), json({ grantId: 'grant-9' })], [REFRESH]: [restore.answer] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))
    await waitFor(() => expect(calls).toContain(REFRESH))

    // Restoring the session answers for another account (signed in from another tab).
    await act(async () => { restore.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    expect(calls.filter(call => call === BREAK_GLASS)).toHaveLength(1)
    expect(screen.queryByText('Bola Nurse')).toBeNull()
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
    await switchToIkeja(screen.getByRole('combobox', { name: 'Working at' }))
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
    const calls = serve({ [SESSION]: [json(staffSession(undefined, undefined, EMERGENCY_PERMISSIONS)), confirmedEnd.session()], [BREAK_GLASS]: [emergency.answer, json({ grantId: 'grant-9' })],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
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
    serve({ [SESSION]: [json(staffSession(undefined, undefined, EMERGENCY_PERMISSIONS))], ['POST /api/v1/identity/break-glass']: [problem(403, 'PERMISSION_DENIED', 'Emergency access is not permitted')] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Emergency access is not permitted')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByText(SESSION_ENDED)).toBeNull()
  })

  it('keeps the workspace when a facility switch is refused (403), without restoring the session', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [FACILITY]: [problem(403, 'FACILITY_ACCESS_DENIED', 'You are not a member of this facility')] })
    await open('/provider')
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

    expect((await screen.findByRole('alert')).textContent).toBe('You are no longer active at Ikeja Clinic. Choose another facility.')
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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

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
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

    await expectSessionEnded()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.getAllByRole('heading', { name: SESSION_ENDED })).toHaveLength(1)
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
    await switchToIkeja(screen.getByRole('combobox', { name: 'Working at' }))

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

describe('the workspace while the server is asked', () => {
  async function openRecordRefusedAfterRestore(routes: Record<string, Answer[]>) {
    const calls = serve({ [LOOKUP]: [allowedLookup(), allowedLookup()], ...routes })
    await open('/provider/patients')
    await openPatientRecord()
    await waitFor(() => expect(where()).toBe('/provider/clinical'))
    return calls
  }

  it('hides the open patient and locks the workspace as soon as a request is refused, before the server answers', async () => {
    const asked = deferredResponse()
    await openRecordRefusedAfterRestore({ [SESSION]: [json(staffSession()), asked.answer], [ENCOUNTERS]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })

    await expectWorkspaceLocked()

    await act(async () => { asked.respond(ended()) })
    await expectSessionEnded()
  })

  it('brings the workspace back as it was when the server still accepts the session', async () => {
    const asked = deferredResponse()
    const calls = await openRecordRefusedAfterRestore({ [SESSION]: [json(staffSession()), asked.answer],
      [ENCOUNTERS]: [ended(), ended()], [REFRESH]: [json(staffSession())] })
    await expectWorkspaceLocked()

    await act(async () => { asked.respond(json(staffSession())) })

    await expectWorkspaceOpen()
    expect(shown(PATIENT_NAME)).toBe(true)
    // Kept, not reloaded: the record was not looked up again.
    expect(calls.filter(call => call === LOOKUP)).toHaveLength(2)
  })

  it('lets the clinician ask again when the server could not answer', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), json({}), json(staffSession())], [REQUESTS]: [ended(), json([])],
      [REFRESH]: [refreshRefused()] })
    await open('/provider')
    // An answer the portal cannot read confirms nothing: the workspace stays locked.
    await expectWorkspaceLocked(UNCONFIRMED)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(3)
  })

  it('asks again on the next refusal after an answer it could not read', async () => {
    serve({ [SESSION]: [json(staffSession()), json({ actor: null }), confirmedEnd.session()], [REQUESTS]: [ended()],
      [REFRESH]: [refreshRefused(), confirmedEnd.refresh()] })
    await open('/provider')
    await expectWorkspaceLocked(UNCONFIRMED)

    // Not stuck until a reload: another refused request is asked about again.
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())

    await expectSessionEnded()
  })

  it('lets the clinician sign out while the session cannot be confirmed', async () => {
    // Sign-out first asks again, and the server now confirms this session.
    serve({ [SESSION]: [json(staffSession()), json({}), json(staffSession())], [REQUESTS]: [ended()], [REFRESH]: [refreshRefused()], [LOGOUT]: [signedOut()] })
    await open('/provider')
    await expectWorkspaceLocked(UNCONFIRMED)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  })

  it('does not lock the workspace for a 403', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [LOOKUP]: [problem(403, 'PATIENT_ACCESS_DENIED', 'Patient access is not authorized')] })
    await open('/provider/patients')
    await openPatientRecord()

    expect((await screen.findByRole('alert')).textContent).toBe('Patient access is not authorized')
    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
  })
})

describe('another account in the same browser', () => {
  it('does not repeat a refused read as the account a refresh restored', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession('staff-2', 'Bola Nurse'))],
      [REQUESTS]: [ended(), json([{ accessRequestId: 'request-9', status: 'pending' }])],
      [REFRESH]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')

    await expectSessionEnded()
    expect(calls).toEqual([SESSION, REQUESTS, REFRESH, SESSION])
    expect(screen.queryByText('Bola Nurse')).toBeNull()
  })

  it.each([
    ['answers for another account', { [FACILITY]: [json({ ...staffSession('staff-2', 'Bola Nurse') })] }],
    ['is restored as another account', { [FACILITY]: [ended(), json(staffSession('staff-2', 'Bola Nurse'))],
      [REFRESH]: [json(staffSession('staff-2', 'Bola Nurse'))] }],
  ])('does not adopt a facility switch that %s', async (_label, routes) => {
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [json([])], ...routes })
    const commits = await open('/provider')
    await switchToIkeja(screen.findByRole('combobox', { name: 'Working at' }))

    await expectSessionEnded()
    expect(calls.filter(call => call === FACILITY)).toHaveLength(1)
    for (const html of commits) expect(html).not.toContain('Bola Nurse')
  })

  it('does not sign out another account whose session the restore found', async () => {
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])], [LOGOUT]: [ended(), signedOut()],
      [REFRESH]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls.filter(call => call.startsWith('POST /api/v1/auth/'))).toEqual([LOGOUT, REFRESH])
  })

  it('never sends a request made while the session-ended screen shows', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [LOOKUP]: [ended(), allowedLookup()],
      [REFRESH]: [confirmedEnd.refresh(), json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider/patients')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    await endSessionNow()
    const before = calls.length

    // A page of the ended session carries on (say, after an earlier step answered) and looks a patient up.
    const { staffApi } = await import('./api')
    void staffApi.lookupPatient('facility-1', PATIENT_HID).catch(() => undefined)
    await settle()

    expect(calls.slice(before)).toEqual([])
  })
})

describe('a document upload', () => {
  const intent = () => json({ document: { id: 'document-1' },
    upload: { method: 'PUT', url: 'https://storage.example.test/bucket/document-1', requiredHeaders: {}, expiresInSeconds: 300 } })

  it('is stopped when its session ends, and never completed as the next account', async () => {
    const stored = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([]), json([])],
      [UPLOAD_INTENT]: [intent()], [STORAGE_PUT]: [stored.answer], [COMPLETE]: [json(null)],
      [REFRESH]: [confirmedEnd.refresh()], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const { staffApi } = await import('./api')
    const upload = staffApi.uploadDocument('facility-1', PATIENT_ID, 'encounter-1', new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' }))
      .then(() => 'completed', (error: { code?: string }) => error.code)
    await waitFor(() => expect(calls).toContain(STORAGE_PUT))

    await endSessionNow()
    await signInAgain('/provider')
    await act(async () => { stored.respond(new Response(null, { status: 200 })) })
    await settle()

    expect(await upload).toBe('REQUEST_CANCELLED')
    expect(calls).not.toContain(COMPLETE)
    // The transfer itself was cancelled when the session ended, not merely left unfinished.
    const transfer = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/bucket/document-1'))
    expect(transfer?.[1]?.signal?.aborted).toBe(true)
  })
})

describe('opening the workspace', () => {
  it('scrolls only the narrow-screen navigation strip to show a link that gets keyboard focus', async () => {
    // Below 900px the navigation is a horizontal strip. Chromium does not scroll a focused link that is
    // partly showing, so tabbing backwards left one as a sliver at the strip's edge (measured at 390px).
    const pageScroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: pageScroll })
    try {
      serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])] })
      await open('/provider/patients')
      const link = await screen.findByRole('link', { name: /^Clinical record/ })
      const strip = link.closest('nav')!
      let left = 79
      Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value } })
      Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 556 })
      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 362 })
      strip.getBoundingClientRect = () => ({ left: 14, right: 376, top: 80, bottom: 121, width: 362, height: 41, x: 14, y: 80, toJSON: () => ({}) })
      link.getBoundingClientRect = () => ({ left: -65, right: 15, top: 80, bottom: 119, width: 80, height: 39, x: -65, y: 80, toJSON: () => ({}) })
      // Keyboard focus: jsdom never matches :focus-visible, Chromium does after Tab.
      link.matches = (selector: string) => selector === ':focus-visible' || Element.prototype.matches.call(link, selector)

      act(() => link.focus())

      expect(left).toBe(0)
      expect(pageScroll).not.toHaveBeenCalled()
    } finally { Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') }
  })

  it('keeps a newer sign-in when the opening session check answers late', async () => {
    const opening = deferredResponse()
    serve({ [SESSION]: [opening.answer], [LOGIN]: [json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [json([])] })
    await open('/provider/sign-in')
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Good to see you, Bola.' })).toBeTruthy()

    // The check sent when the page opened answers for the account the browser held then.
    await act(async () => { opening.respond(json(staffSession())) })
    await settle()

    expect(screen.getByRole('heading', { name: 'Good to see you, Bola.' })).toBeTruthy()
    expect(screen.queryByText('Ada Clinician')).toBeNull()
  })
})

describe('other tabs and returning to the tab', () => {
  async function openPatient(routes: Record<string, Answer[]>) {
    const calls = serve({ [LOOKUP]: [allowedLookup()], ...routes })
    await open('/provider/patients')
    await openPatientRecord()
    await waitFor(() => expect(shown(PATIENT_NAME)).toBe(true))
    return calls
  }

  it('locks the workspace and asks the server when another tab signs out', async () => {
    const asked = deferredResponse()
    await openPatient({ [SESSION]: [json(staffSession()), asked.answer], [REFRESH]: [refreshCookieGone()], [ENCOUNTERS]: [json({ items: [] })] })

    fromAnotherTab()

    await expectWorkspaceLocked()
    await act(async () => { asked.respond(ended()) })
    await expectSessionEnded()
  })

  it('tells the other tabs when this tab signs in or out, naming no one', async () => {
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([]), json([])], [LOGOUT]: [signedOut()], [LOGIN]: [json(staffSession())] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(TabChannel.posted).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await signIn()
    expect(await screen.findByText('0 pending requests')).toBeTruthy()

    expect(TabChannel.posted).toEqual(['changed', 'changed'])
  })

  it('asks the server when the page comes back from the back/forward cache', async () => {
    const asked = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), asked.answer], [REQUESTS]: [json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()

    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })

    await expectWorkspaceLocked()
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it('asks the server when the tab returns after a minute or more, not after a brief switch', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const calls = serve({ [SESSION]: [json(staffSession()), confirmedEnd.session()], [REQUESTS]: [json([])], [REFRESH]: [confirmedEnd.refresh()] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const switchTab = (seconds: number) => act(() => {
      visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
      now += seconds * 1000
      visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
    })

    switchTab(5)
    await settle()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
    await expectWorkspaceOpen()

    switchTab(61)

    await expectSessionEnded()
  })
})

describe('leaving the page and coming back', () => {
  it('locks the workspace as soon as the page is hidden, and opens it again after a brief absence without asking the server', async () => {
    const page = pageLifecycle()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession())] })

    const refresh = screen.getByRole('button', { name: 'Refresh encounters' })
    refresh.focus()

    page.hide()
    page.hide()
    await expectWorkspaceLocked()

    page.wait(5)
    page.show()
    await expectWorkspaceOpen()
    expect(shown(PATIENT_NAME)).toBe(true)
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
    // Focus goes back where it was before the workspace locked.
    expect(document.activeElement).toBe(refresh)
  })

  it('opens a page left without the event that brings it back on its next focus, as on a brief return', async () => {
    const page = pageLifecycle()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession())] })

    page.pageHide(false)
    await expectWorkspaceLocked()
    page.wait(3)
    page.focus()

    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
  })

  it('asks the server before it opens the workspace again after a minute or more hidden', async () => {
    const page = pageLifecycle()
    const asked = deferredResponse()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession()), asked.answer] })

    page.hide()
    page.wait(61)
    page.show()

    await expectWorkspaceLocked()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
    expect(shown(PATIENT_NAME)).toBe(true)
  })

  it('locks on pagehide, and asks the server when restored from the back/forward cache, however brief the absence', async () => {
    const page = pageLifecycle()
    const asked = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), asked.answer], [LOOKUP]: [allowedLookup(), allowedLookup()], [ENCOUNTERS]: [json({ items: [] })] })
    const commits = await open('/provider/patients')
    await openPatientRecord()
    await waitFor(() => expect(shown(PATIENT_NAME)).toBe(true))

    page.pageHide()
    await expectWorkspaceLocked()
    const lockedAt = commits.length

    page.wait(2)
    page.pageShow()

    await expectWorkspaceLocked()
    // Not even one render of the workspace in between: the restored page is checked before it opens.
    for (const html of commits.slice(lockedAt)) expect(html).toContain(CHECKING)
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
  })

  it('does not open the workspace on an answer that arrives while the page is hidden', async () => {
    const page = pageLifecycle()
    const asked = deferredResponse()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession()), asked.answer] })
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())
    await expectWorkspaceLocked()

    page.hide()
    await act(async () => { asked.respond(json(staffSession())) })
    await settle()
    expect(document.querySelector('[inert]')?.hasAttribute('hidden')).toBe(true)

    page.wait(5)
    page.show()
    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it('lets a later account change decide over an earlier answer still on its way', async () => {
    const earlier = deferredResponse()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession()), earlier.answer, json(patientSession())] })
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())
    await expectWorkspaceLocked()

    // A patient signs in on another tab while the earlier question is still on its way.
    fromAnotherTab()
    await act(async () => { earlier.respond(json(staffSession())) })

    await expectSessionEnded()
    expect(calls.filter(call => call === SESSION)).toHaveLength(3)
  })

  it('stops listening once the provider portal is closed', async () => {
    const page = pageLifecycle()
    const calls = serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    cleanup()
    const before = calls.length

    page.hide()
    page.wait(61)
    page.show()
    page.pageShow()
    fromAnotherTab()
    await settle()

    expect(calls.slice(before)).toEqual([])
    expect(TabChannel.open.size).toBe(0)
  })
})

describe('a patient account in the same browser', () => {
  it('asks the server when a staff request is refused for a patient session, and ends the workspace once it shows one', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), json(patientSession())], [LOOKUP]: [allowedLookup(), allowedLookup()],
      [ENCOUNTERS]: [patientScopeDenied()] })
    await open('/provider/patients')
    await openPatientRecord()

    await expectSessionEnded()
    // Nothing restored or repeated: the refusal is a 403, and the browser's session is a patient's.
    expect(calls).not.toContain(REFRESH)
    expect(calls.filter(call => call === ENCOUNTERS)).toHaveLength(1)
  })

  it('keeps the workspace when the server still holds this staff session after a patient-scope refusal', async () => {
    const calls = serve({ [SESSION]: [json(staffSession()), json(staffSession())], [LOOKUP]: [patientScopeDenied()] })
    await open('/provider/patients')
    await openPatientRecord()

    expect((await screen.findByRole('alert')).textContent).toBe('This operation requires workforce authorization')
    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
  })

  it.each([
    ['PATIENT_ACCESS_DENIED', 'Patient access is not authorized'],
    ['FACILITY_ACCESS_DENIED', 'The actor is not active at this facility'],
    ['PERMISSION_DENIED', 'Permission denied'],
    ['CSRF_VALIDATION_FAILED', 'CSRF validation failed'],
    ['ORIGIN_DENIED', 'Origin is not allowed'],
  ])('does not take an unrelated 403 (%s) as a sign of another account', async (code, detail) => {
    const calls = serve({ [SESSION]: [json(staffSession())], [LOOKUP]: [problem(403, code, detail)] })
    await open('/provider/patients')
    await openPatientRecord()

    expect((await screen.findByRole('alert')).textContent).toBe(detail)
    await expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
    expect(calls).not.toContain(REFRESH)
  })

  it('locks the workspace when a patient signs in on another tab, and ends it once the server shows the patient session', async () => {
    const asked = deferredResponse()
    await openWithPatient({ [SESSION]: [json(staffSession()), asked.answer] })

    fromAnotherTab()

    await expectWorkspaceLocked()
    await act(async () => { asked.respond(json(patientSession())) })
    await expectSessionEnded()
  })
})

describe('protected steps that follow another while the session is checked', () => {
  const intent = () => json({ document: { id: 'document-1' },
    upload: { method: 'PUT', url: 'https://storage.example.test/bucket/document-1', requiredHeaders: {}, expiresInSeconds: 300 } })

  async function startUpload(routes: Record<string, Answer[]>) {
    const stored = deferredResponse()
    const calls = serve({ [REQUESTS]: [json([])], [UPLOAD_INTENT]: [intent()], [STORAGE_PUT]: [stored.answer], [COMPLETE]: [json({ id: 'document-1', status: 'uploaded' })], ...routes })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const { staffApi } = await import('./api')
    const upload = staffApi.uploadDocument('facility-1', PATIENT_ID, 'encounter-1', new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' }))
      .then(() => 'completed', (error: { code?: string }) => error.code)
    await waitFor(() => expect(calls).toContain(STORAGE_PUT))
    return { calls, upload, stored }
  }

  it('completes an upload only once the server confirms the session', async () => {
    const asked = deferredResponse()
    const { calls, upload, stored } = await startUpload({ [SESSION]: [json(staffSession()), asked.answer] })
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())

    await act(async () => { stored.respond(new Response(null, { status: 200 })) })
    await settle()
    expect(calls).not.toContain(COMPLETE)

    await act(async () => { asked.respond(json(staffSession())) })
    expect(await upload).toBe('completed')
    expect(calls.filter(call => call === COMPLETE)).toHaveLength(1)
  })

  it('abandons an upload whose storage step finished after a second account became active', async () => {
    const asked = deferredResponse()
    const { calls, upload, stored } = await startUpload({ [SESSION]: [json(staffSession()), asked.answer] })

    // Another staff member signs in on another tab while the file is being stored.
    fromAnotherTab()
    await act(async () => { stored.respond(new Response(null, { status: 200 })) })
    await settle()
    expect(calls).not.toContain(COMPLETE)
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    expect(await upload).toBe('REQUEST_CANCELLED')
    expect(calls).not.toContain(COMPLETE)
  })

  it('never completes an upload while the session cannot be confirmed, nor after the clinician signs out', async () => {
    // The third answer is sign-out's own check from the lock screen.
    const { calls, upload, stored } = await startUpload({ [SESSION]: [json(staffSession()), json({}), json(staffSession())], [LOGOUT]: [signedOut()] })
    const { reportStaffSessionEnded } = await import('./session')
    act(() => reportStaffSessionEnded())
    await expectWorkspaceLocked(UNCONFIRMED)

    await act(async () => { stored.respond(new Response(null, { status: 200 })) })
    await settle()
    expect(calls).not.toContain(COMPLETE)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(await upload).toBe('REQUEST_CANCELLED')
    expect(calls).not.toContain(COMPLETE)
  })

  it('never stores the file once a second account became active while the upload was being prepared', async () => {
    const prepared = deferredResponse()
    const asked = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), asked.answer], [REQUESTS]: [json([])], [UPLOAD_INTENT]: [prepared.answer] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const { staffApi } = await import('./api')
    const upload = staffApi.uploadDocument('facility-1', PATIENT_ID, 'encounter-1', new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' }))
      .then(() => 'completed', (error: { code?: string }) => error.code)
    await waitFor(() => expect(calls).toContain(UPLOAD_INTENT))

    fromAnotherTab()
    await expectWorkspaceLocked()
    await act(async () => { prepared.respond(intent()) })
    await settle()
    // The storage link answers no cookie, so only the portal can hold the file back.
    expect(calls).not.toContain(STORAGE_PUT)
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    expect(await upload).toBe('REQUEST_CANCELLED')
    expect(calls).not.toContain(STORAGE_PUT)
    expect(calls).not.toContain(COMPLETE)
  })

  const DOCUMENTS = 'GET /api/v1/ehr/documents'
  const DOWNLOAD = 'GET /api/v1/ehr/documents/document-9/download'
  const LINK = 'https://storage.example.test/bucket/document-9'

  async function startDownload(routes: Record<string, Answer[]>) {
    const downloaded = deferredResponse()
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const encounter = { id: 'encounter-1', patientId: PATIENT_ID, facilityId: 'facility-1', encounterType: 'outpatient', status: 'in_progress',
      startedAt: '2026-10-10T09:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
    const document = { id: 'document-9', patientId: PATIENT_ID, encounterId: 'encounter-1', fileName: 'referral.pdf', mediaType: 'application/pdf',
      sizeBytes: 2048, status: 'uploaded', scanStatus: 'clean', createdAt: '2026-10-10T09:05:00.000Z' }
    const calls = await openWithPatient({ [LOOKUP]: [allowedLookup(), allowedLookup(), allowedLookup()], [ENCOUNTERS]: [json({ items: [encounter] })],
      [DOCUMENTS]: [json({ items: [document] })], [DOWNLOAD]: [downloaded.answer], ...routes })
    fireEvent.click(await screen.findByRole('button', { name: 'Open file' }))
    await waitFor(() => expect(calls).toContain(DOWNLOAD))
    return { opened, downloaded }
  }

  it('opens a downloaded document only once the server confirms the session', async () => {
    const asked = deferredResponse()
    const { opened, downloaded } = await startDownload({ [SESSION]: [json(staffSession()), asked.answer] })
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { downloaded.respond(json({ url: LINK, expiresAt: null })) })
    await settle()
    expect(opened).not.toHaveBeenCalled()

    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
    await waitFor(() => expect(opened).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer'))
  })

  it('never opens a downloaded document once a second account is active', async () => {
    const asked = deferredResponse()
    const { opened, downloaded } = await startDownload({ [SESSION]: [json(staffSession()), asked.answer] })
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { downloaded.respond(json({ url: LINK, expiresAt: null })) })
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    await settle()
    expect(opened).not.toHaveBeenCalled()
  })

  async function verifyPin(routes: Record<string, Answer[]>) {
    const pinned = deferredResponse()
    const calls = serve({ [PIN]: [pinned.answer], [LOOKUP]: [allowedLookup(), allowedLookup()], [ENCOUNTERS]: [json({ items: [] })], ...routes })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Patient PIN' }))
    fireEvent.change(screen.getByLabelText(/^Patient access PIN/), { target: { value: '4821' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    await waitFor(() => expect(calls).toContain(PIN))
    return { calls, pinned }
  }

  it('opens the patient after PIN verification only once the server confirms the session', async () => {
    const asked = deferredResponse()
    const { calls, pinned } = await verifyPin({ [SESSION]: [json(staffSession()), asked.answer] })
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { pinned.respond(json({ grantId: 'grant-7' })) })
    await settle()
    expect(calls).not.toContain(LOOKUP)

    await act(async () => { asked.respond(json(staffSession())) })
    await waitFor(() => expect(where()).toBe('/provider/clinical'))
    await expectWorkspaceOpen()
    expect(shown(PATIENT_NAME)).toBe(true)
  })

  it('never opens the patient after PIN verification once a second account is active', async () => {
    const asked = deferredResponse()
    const { calls, pinned } = await verifyPin({ [SESSION]: [json(staffSession()), asked.answer] })
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { pinned.respond(json({ grantId: 'grant-7' })) })
    await settle()
    expect(calls).not.toContain(LOOKUP)
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    await settle()
    expect(calls).not.toContain(LOOKUP)
    expect(document.body.innerHTML).not.toContain(PATIENT_NAME)
  })
})

describe('requests the HTTP client sends again on its own', () => {
  const AUDIT = 'GET /api/v1/audit/events'
  const auditPage = () => json({ items: [], nextBeforeSequenceId: null })
  const unavailable = () => new Response(JSON.stringify({ status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'Try again' }),
    { status: 503, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '0' } })

  async function readStarted(routes: Record<string, Answer[]>) {
    const calls = serve({ [REQUESTS]: [json([])], ...routes })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    const { staffApi } = await import('./api')
    const read = staffApi.facilityAudit('facility-1').then(() => 'ok', (error: { code?: string }) => error.code)
    await waitFor(() => expect(calls).toContain(AUDIT))
    return { calls, read }
  }

  it('holds a read retried after a backoff while the session is checked, and sends it once confirmed', async () => {
    const first = deferredResponse()
    const asked = deferredResponse()
    const { calls, read } = await readStarted({ [SESSION]: [json(staffSession()), asked.answer], [AUDIT]: [first.answer, auditPage] })
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { first.respond(unavailable()) })
    await settle()
    expect(calls.filter(call => call === AUDIT)).toHaveLength(1)

    await act(async () => { asked.respond(json(staffSession())) })
    expect(await read).toBe('ok')
    expect(calls.filter(call => call === AUDIT)).toHaveLength(2)
  })

  it('never sends a retried read once a second account is active', async () => {
    const first = deferredResponse()
    const asked = deferredResponse()
    const { calls, read } = await readStarted({ [SESSION]: [json(staffSession()), asked.answer], [AUDIT]: [first.answer, auditPage] })
    fromAnotherTab()
    await expectWorkspaceLocked()
    await act(async () => { first.respond(unavailable()) })
    await act(async () => { asked.respond(json(staffSession('staff-2', 'Bola Nurse'))) })

    await expectSessionEnded()
    expect(await read).toBe('REQUEST_CANCELLED')
    expect(calls.filter(call => call === AUDIT)).toHaveLength(1)
  })

  it('holds the repeat after a refresh while the session is checked', async () => {
    const refreshed = deferredResponse()
    const asked = deferredResponse()
    const { calls, read } = await readStarted({ [SESSION]: [json(staffSession()), asked.answer], [AUDIT]: [ended, auditPage],
      [REFRESH]: [refreshed.answer] })
    await waitFor(() => expect(calls).toContain(REFRESH))
    fromAnotherTab()
    await expectWorkspaceLocked()

    await act(async () => { refreshed.respond(json(staffSession())) })
    await settle()
    expect(calls.filter(call => call === AUDIT)).toHaveLength(1)

    await act(async () => { asked.respond(json(staffSession())) })
    expect(await read).toBe('ok')
    expect(calls.filter(call => call === AUDIT)).toHaveLength(2)
  })
})

describe('a page hidden before its session is ready', () => {
  const sessionCalls = (calls: string[]) => calls.filter(call => call === SESSION).length
  const workspaceHidden = () => document.querySelector('[inert]')?.hasAttribute('hidden') === true

  it('locks a session read while the page is hidden, and asks the server when it comes back after a long absence', async () => {
    const page = pageLifecycle()
    const opening = deferredResponse()
    const asked = deferredResponse()
    const calls = serve({ [SESSION]: [opening.answer, asked.answer], [REQUESTS]: [json([])] })
    await open('/provider')
    page.hide()
    await act(async () => { opening.respond(json(staffSession())) })
    await waitFor(() => expect(workspaceHidden()).toBe(true))

    page.wait(3600)
    page.show()
    await expectWorkspaceLocked()
    expect(sessionCalls(calls)).toBe(2)
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
  })

  it('locks a sign-in answered while the page is hidden', async () => {
    const page = pageLifecycle()
    const signingIn = deferredResponse()
    const asked = deferredResponse()
    const calls = serve({ [SESSION]: [ended(), asked.answer], [REFRESH]: [refreshRefused()], [LOGIN]: [signingIn.answer], [REQUESTS]: [json([])] })
    await open('/provider/sign-in')
    await signIn()
    await waitFor(() => expect(calls).toContain(LOGIN))
    page.hide()
    await act(async () => { signingIn.respond(json(staffSession())) })
    await waitFor(() => expect(workspaceHidden()).toBe(true))

    page.wait(3600)
    page.show()
    await expectWorkspaceLocked()
    expect(sessionCalls(calls)).toBe(2)
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
  })

  it('keeps the workspace locked when the server answers while the page is still hidden', async () => {
    const page = pageLifecycle()
    const opening = deferredResponse()
    const asked = deferredResponse()
    serve({ [SESSION]: [opening.answer, asked.answer], [REQUESTS]: [json([])] })
    await open('/provider')
    page.hide()
    await act(async () => { opening.respond(json(staffSession())) })
    fromAnotherTab()
    await act(async () => { asked.respond(json(staffSession())) })
    await settle()

    expect(document.visibilityState).toBe('hidden')
    expect(workspaceHidden()).toBe(true)
  })

  it('treats a back/forward-cache restore reported while still hidden as no return', async () => {
    const page = pageLifecycle()
    const asked = deferredResponse()
    const calls = await openWithPatient({ [SESSION]: [json(staffSession()), asked.answer] })
    page.pageHide()
    await expectWorkspaceLocked()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    await settle()
    expect(sessionCalls(calls)).toBe(1)
    expect(workspaceHidden()).toBe(true)

    page.show()
    await expectWorkspaceLocked()
    expect(sessionCalls(calls)).toBe(2)
    await act(async () => { asked.respond(json(staffSession())) })
    await expectWorkspaceOpen()
  })
})

describe('a browser that refuses the session-change channel', () => {
  it('still opens the portal and locks it when the page is hidden', async () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
    const page = pageLifecycle()
    serve({ [SESSION]: [json(staffSession())], [REQUESTS]: [json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    page.hide()
    await expectWorkspaceLocked()
    page.wait(5)
    page.show()
    await expectWorkspaceOpen()
  })
})

describe('the session review before landing', () => {
  it('checks the workspace when another tab signed in while this tab was still opening', async () => {
    const opening = deferredResponse()
    const calls = serve({ [SESSION]: [opening.answer, json(staffSession('staff-2', 'Bola Nurse'))], [REQUESTS]: [json([])] })
    await open('/provider')
    await waitFor(() => expect(calls).toEqual([SESSION]))

    fromAnotherTab()
    await act(async () => { opening.respond(json(staffSession())) })

    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(2))
    await expectSessionEnded()
    expect(calls).not.toContain(REQUESTS)
  })

  it('never ends another account’s session from the lock screen', async () => {
    const question = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), question.answer, json(staffSession('staff-2', 'Bola Nurse'))],
      [REQUESTS]: [json([])], [LOGOUT]: [signedOut()] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fromAnotherTab()
    await expectWorkspaceLocked()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls).not.toContain(LOGOUT)
  })

  it('does not sign out blindly from the lock screen when the session cannot be confirmed', async () => {
    const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.')
    const calls = serve({ [SESSION]: [json(staffSession()), unavailable(), unavailable()], [REQUESTS]: [json([])], [LOGOUT]: [signedOut()] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fromAnotherTab()
    await expectWorkspaceLocked(UNCONFIRMED)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Sign-out could not be completed')
    expect(calls).not.toContain(LOGOUT)
  })

  it('signs out from the lock screen once the check finds this session', async () => {
    const question = deferredResponse()
    const calls = serve({ [SESSION]: [json(staffSession()), question.answer, json(staffSession())],
      [REQUESTS]: [json([])], [LOGOUT]: [signedOut()] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fromAnotherTab()
    await expectWorkspaceLocked()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls.filter(call => call === LOGOUT)).toHaveLength(1)
  })
})
