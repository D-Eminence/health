import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * The working facility across reloads (hid-system ADR-046, migration 0080).
 * Identity keeps the facility a sign-in chose with POST /auth/facility and says,
 * on staff session reads and refresh, where the reported facility comes from:
 * 'selected', 'default' (none chosen: the primary, else the first by name) or
 * 'reselect' (the chosen facility is no longer one of the actor's active
 * facilities, so the default is reported). Before, a reload silently moved the
 * user back to the primary facility.
 *
 * The portal opens no page while the facility is unresolved: on 'reselect', or on
 * 'default' for someone who works at more than one facility, it asks where they
 * are working, with nothing preselected, and sends the same POST /auth/facility
 * as a switch. An Identity without the contract reports no field, and the portal
 * behaves as before. A value the portal does not know is not taken as a choice
 * made: it asks. A tab keeps its facility across a refresh or session check while
 * that facility is still one of the actor's, and asks again once it is gone.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

/** The portal's other tabs, as BroadcastChannel would connect them; `fromAnotherTab` delivers what another tab announces. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage() { /* this tab's own announcements reach no other tab here */ }
  close() { TabChannel.open.delete(this) }
}
beforeEach(() => { TabChannel.open.clear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGIN = 'POST /api/v1/auth/login'
const FACILITY = 'POST /api/v1/auth/facility'
const REQUESTS = 'GET /api/v1/identity/access-requests'
const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters`
const PATIENT_NAME = 'Chidi Okafor'

type Answer = () => Response | Promise<Response>
interface Sent { route: string; body: unknown; facility: string | null }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read']
const facility = (id: string, name: string, isPrimary: boolean) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary })
const LAGOS = facility('facility-1', 'Lagos General', true)
const IKEJA = facility('facility-2', 'Ikeja Clinic', false)
const YABA = facility('facility-3', 'Yaba Clinic', false)
/** What Identity reports, including a value a later contract could add and a null no build sends today. */
type Selection = 'selected' | 'default' | 'reselect' | 'something-new' | null | undefined
const session = (current: typeof LAGOS, facilitySelection: Selection, facilities = [LAGOS, IKEJA]) => () => json({
  actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [], facilities, facility: current },
  expiresAt: '2026-10-12T12:00:00.000Z', ...(facilitySelection !== undefined ? { facilitySelection } : {}),
})

function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      facility: new Headers(init?.headers).get('X-Facility-ID') })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}</output>
}

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

const question = () => screen.findByRole('heading', { level: 1, name: 'Where are you working?' })
const option = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement
/** Every request outside /api/v1/auth/: what a page sends, at a facility. */
const pageRequests = (sent: Sent[]) => sent.filter(call => !call.route.includes(' /api/v1/auth/'))
/** A protected route, or the refresh endpoint, refusing a request without a usable session. */
const unauthenticated = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery staple' } })
  // Pressed as a person does, so focus is on it while the sign-in runs.
  const button = screen.getByRole('button', { name: 'Sign in' })
  button.focus()
  fireEvent.click(button)
}

function deferredResponse() {
  let respond: (response: Response) => void = () => undefined
  const promise = new Promise<Response>(resolve => { respond = resolve })
  return { answer: () => promise, respond: (response: Response) => respond(response) }
}

describe('a facility chosen earlier that is no longer available (reselect)', () => {
  it('opens no page and asks, with nothing chosen for the user, then works at the facility chosen', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    const heading = await question()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText(/The facility you chose for this sign-in is no longer available to you\./)).toBeTruthy()
    expect(option('Lagos General').checked).toBe(false)
    expect(option('Ikeja Clinic').checked).toBe(false)
    // No page, no page request and no facility control while it is unresolved.
    expect(screen.queryByText(/Good to see you/)).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Working at' })).toBeNull()
    expect(pageRequests(sent)).toEqual([])

    fireEvent.click(option('Ikeja Clinic'))
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: 'facility-2' }])
    // Every page request now names the facility chosen.
    await waitFor(() => expect(pageRequests(sent).length).toBeGreaterThan(0))
    expect(pageRequests(sent).every(call => call.facility === 'facility-2')).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /Good to see you/ })))
  })

  it('still asks when the only facility left is the default one, as after a membership ends', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect', [LAGOS])], [FACILITY]: [session(LAGOS, 'selected', [LAGOS])], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    expect(screen.queryByRole('radio', { name: 'Ikeja Clinic' })).toBeNull()
    fireEvent.click(option('Lagos General'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: 'facility-1' }])
  })

  it('keeps asking when the choice is refused, as when the membership ended meanwhile, and says why', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')],
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility')] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Said in words the person can act on, at the options: Identity's own detail speaks of "the actor".
    const refusal = await screen.findByText('You are no longer active at Ikeja Clinic. Choose another facility.')
    expect(refusal.getAttribute('role')).toBe('alert')
    expect(screen.queryByText(/actor/)).toBeNull()
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toContain(refusal.id)
    expect(screen.getByRole('heading', { name: 'Where are you working?' })).toBeTruthy()
    expect(screen.queryByText(/Good to see you/)).toBeNull()
    expect(pageRequests(sent)).toEqual([])
  })

  it('keeps asking when the choice is refused as invalid', async () => {
    serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [() => problem(400, 'VALIDATION_FAILED', 'facilityId must be a UUID')] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByText(/facilityId must be a UUID/)).getAttribute('role')).toBe('alert')
    expect(screen.getByRole('heading', { name: 'Where are you working?' })).toBeTruthy()
  })

  it('Continue with nothing chosen says so at the options and sends nothing', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')] })
    await open('/provider')
    await question()
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)
    // Focus moves into the options, whose description says it: as an alert too it would be spoken twice.
    const missing = screen.getByText('Choose a facility to continue.')
    expect(missing.getAttribute('role')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(option('Lagos General'))
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toContain(missing.id)
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
  })

  it('says so as an alert when sent with Enter on an option and nothing chosen, as focus does not move', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')] })
    await open('/provider')
    await question()
    option('Lagos General').focus()
    // Enter on a radio submits its form (implicit submission); nothing is checked.
    fireEvent.submit(option('Lagos General').form!)
    const missing = screen.getByRole('alert')
    expect(missing.textContent).toBe('Choose a facility to continue.')
    expect(document.activeElement).toBe(option('Lagos General'))

    // Each refusal is a new alert, so Enter pressed again says it again.
    fireEvent.submit(option('Lagos General').form!)
    expect(screen.getByRole('alert')).not.toBe(missing)
    expect(screen.getByRole('alert').textContent).toBe('Choose a facility to continue.')
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
  })

  it('a page opened by its address waits for the choice too, then opens', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(IKEJA, 'selected')] })
    await open('/provider/clinical')
    await question()
    // The clinical page (with no patient open, it asks for one) is not there alongside the question.
    expect(screen.queryByRole('heading', { name: 'Choose a patient first.' })).toBeNull()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a patient first.' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/provider/clinical')
    expect(pageRequests(sent)).toEqual([])
  })
})

describe('no facility chosen yet for this sign-in (default)', () => {
  it('asks someone who works at more than one facility', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'default')], [FACILITY]: [session(LAGOS, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    expect(screen.getByText(/You work at more than one facility\./)).toBeTruthy()
    expect(pageRequests(sent)).toEqual([])
    fireEvent.click(option('Lagos General'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
  })

  it('does not ask someone with one facility: there is nothing to choose', async () => {
    serve({ [SESSION]: [session(LAGOS, 'default', [LAGOS])], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
  })
})

describe('a facility chosen for this sign-in (selected), and an Identity without the contract', () => {
  it('a reload keeps the facility chosen, without asking or switching again', async () => {
    const sent = serve({ [SESSION]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-2')
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
    await waitFor(() => expect(pageRequests(sent).length).toBeGreaterThan(0))
    expect(pageRequests(sent).every(call => call.facility === 'facility-2')).toBe(true)
  })

  it('an Identity that reports no selection behaves as before: the facility it reports, no question', async () => {
    serve({ [SESSION]: [session(LAGOS, undefined)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
  })

  it('a switch made later is the one a reload reports', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'selected')], [FACILITY]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([]), () => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch facility' })) })
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: 'facility-2' }])
  })

  it('keeps this tab at its facility when a refresh reports another tab\'s choice', async () => {
    // The choice belongs to the sign-in, so another tab's switch is what the server reports next.
    // A tab adopts a session only on load, sign-in or its own choice: a refresh does not move it.
    const sent = serve({ [SESSION]: [session(LAGOS, 'selected')],
      [REFRESH]: [session(IKEJA, 'selected')],
      [REQUESTS]: [unauthenticated, () => json([]), () => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    await waitFor(() => expect(sent.filter(call => call.route === REQUESTS).length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull())
    expect(screen.getByText(/Working at Lagos General\./)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-1')
    expect(sent.filter(call => call.route === REQUESTS).every(call => call.facility === 'facility-1')).toBe(true)
    expect(sent.filter(call => call.route === REFRESH)).toHaveLength(1)
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
  })

  it('keeps this tab at its facility when a session check reports another tab\'s choice', async () => {
    // Another tab announces a change; this tab asks the server, which reports that tab's switch.
    const sent = serve({ [SESSION]: [session(LAGOS, 'selected'), session(IKEJA, 'selected')], [REQUESTS]: [() => json([]), () => json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()

    fromAnotherTab()
    expect(await screen.findByRole('heading', { name: 'Checking your session…' })).toBeTruthy()

    await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull())
    expect(sent.filter(call => call.route === SESSION)).toHaveLength(2)
    expect(screen.getByText(/Working at Lagos General\./)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-1')
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
    expect(pageRequests(sent).every(call => call.facility === 'facility-1')).toBe(true)
  })
})

describe('the other ways a session arrives', () => {
  it('asks after a sign-in, which reports no facility chosen yet, before any page opens', async () => {
    const sent = serve({ [SESSION]: [unauthenticated], [REFRESH]: [unauthenticated], [LOGIN]: [session(LAGOS, 'default')],
      [FACILITY]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider/sign-in')
    await signIn()
    await question()
    expect(screen.getByText(/You work at more than one facility\./)).toBeTruthy()
    expect(screen.queryByText(/Good to see you/)).toBeNull()
    expect(pageRequests(sent)).toEqual([])

    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    await waitFor(() => expect(pageRequests(sent).length).toBeGreaterThan(0))
    expect(pageRequests(sent).every(call => call.facility === 'facility-2')).toBe(true)
  })

  it('asks after a reload whose session read is refused and restored by a refresh', async () => {
    // The access token expired while the page was closed: the read is refused, and the refresh's answer is adopted.
    const sent = serve({ [SESSION]: [unauthenticated], [REFRESH]: [session(LAGOS, 'reselect')] })
    await open('/provider')
    await question()
    expect(screen.getByText(/The facility you chose for this sign-in is no longer available to you\./)).toBeTruthy()
    expect(sent.map(call => call.route)).toEqual([SESSION, REFRESH])
  })
})

describe('a selection this portal does not know (a later contract)', () => {
  // Only 'selected' is a choice made; a value the portal cannot read is not taken as one.
  it('asks rather than open the reported facility, without claiming a reason it cannot know', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'something-new')], [FACILITY]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    expect(screen.getByText(/The facility for this sign-in is not confirmed\./)).toBeTruthy()
    expect(screen.queryByText(/no longer available|more than one facility/)).toBeNull()
    expect(option('Lagos General').checked).toBe(false)
    expect(pageRequests(sent)).toEqual([])

    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    await waitFor(() => expect(pageRequests(sent).length).toBeGreaterThan(0))
    expect(pageRequests(sent).every(call => call.facility === 'facility-2')).toBe(true)
  })

  it('asks someone with one facility too', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'something-new', [LAGOS])] })
    await open('/provider')
    await question()
    expect(screen.getByText(/The facility for this sign-in is not confirmed\./)).toBeTruthy()
    expect(pageRequests(sent)).toEqual([])
  })

  it('takes a null selection as no selection reported: the facility Identity reports, no question', async () => {
    serve({ [SESSION]: [session(LAGOS, null)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
  })
})

describe('focus when the question first shows while the workspace is locked', () => {
  // The question is the page: it takes focus when it can first be reached, not while it is hidden.
  it('takes focus once a page hidden when the session became ready is seen', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')] })
    await open('/provider')
    // Ready while hidden, the workspace is locked from the start: the question is there, hidden and inert.
    await waitFor(() => expect(document.querySelector('[inert]')?.textContent).toContain('Where are you working?'))

    act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })

    const heading = await question()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(pageRequests(sent)).toEqual([])
  })

  it('takes focus once the check a sign-in waits on is answered', async () => {
    // Another tab announced a change while the sign-in was answered, so the new session is checked first.
    const signingIn = deferredResponse()
    const asked = deferredResponse()
    const sent = serve({ [SESSION]: [unauthenticated, asked.answer], [REFRESH]: [unauthenticated], [LOGIN]: [signingIn.answer] })
    await open('/provider/sign-in')
    await signIn()
    await waitFor(() => expect(sent.map(call => call.route)).toContain(LOGIN))
    fromAnotherTab()
    await act(async () => { signingIn.respond(await session(LAGOS, 'default')()) })
    // Signed in, and locked while the server is asked: the question is there, hidden and inert.
    expect(await screen.findByRole('heading', { name: 'Checking your session…' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[inert]')?.textContent).toContain('Where are you working?'))

    await act(async () => { asked.respond(await session(LAGOS, 'default')()) })

    const heading = await question()
    expect(sent.filter(call => call.route === SESSION)).toHaveLength(2)
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(pageRequests(sent)).toEqual([])
  })
})

describe('the shell while the question shows', () => {
  it('offers no navigation or role built from a facility nobody chose, and offers them once one is chosen', async () => {
    serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(IKEJA, 'selected')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    // The links and the role badge would come from the reported facility, which no one chose.
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Patient access' })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Clinical record/ })).toBeNull()
    expect(screen.queryByText('clinician')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()

    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const navigation = await screen.findByRole('navigation')
    expect(within(navigation).getByRole('link', { name: 'Patient access' })).toBeTruthy()
    expect(within(navigation).getByRole('link', { name: /^Clinical record/ })).toBeTruthy()
    expect(screen.getAllByText('clinician').length).toBeGreaterThan(0)
  })

  it('shows no refusal of a switch made before the question once the sidebar is back', async () => {
    // A switch to Lagos General is refused (that membership ended); then a check finds Ikeja Clinic gone too.
    serve({ [SESSION]: [session(IKEJA, 'selected', [LAGOS, IKEJA, YABA]), session(YABA, 'reselect', [YABA])],
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility'), session(YABA, 'selected', [YABA])],
      [REQUESTS]: [() => json([]), () => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch facility' })) })
    expect(await screen.findByText('You are no longer active at Lagos General. Choose another facility.')).toBeTruthy()

    fromAnotherTab()
    await question()
    fireEvent.click(option('Yaba Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The refusal was about a facility the sidebar no longer offers, and is not announced again out of context.
    expect(await screen.findByText(/Working at Yaba Clinic\./)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Working at' })).toBeTruthy()
    expect(screen.queryByText(/no longer active at Lagos General/)).toBeNull()
  })
})

describe('the question while a choice is saved or refused', () => {
  it('clears a refusal once another facility is picked', async () => {
    serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility')] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(option('Lagos General'))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toBe('staff-facility-choice-why')
  })

  it('keeps the options as they are while the choice is saved, with focus on Continue', async () => {
    const saving = deferredResponse()
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [saving.answer], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)
    await screen.findByRole('button', { name: 'Saving…' })

    // The option checked is the facility being saved: no other can be picked meanwhile.
    expect(option('Lagos General').matches(':disabled')).toBe(true)
    expect(option('Ikeja Clinic').matches(':disabled')).toBe(true)
    expect(option('Ikeja Clinic').checked).toBe(true)
    expect(document.activeElement).toBe(proceed)

    await act(async () => { saving.respond(await session(IKEJA, 'selected')()) })
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: 'facility-2' }])
  })

  it('moves focus to Continue, not to the page, when the choice is sent with Enter on an option', async () => {
    const saving = deferredResponse()
    serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [saving.answer] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    option('Ikeja Clinic').focus()
    // Enter on a radio submits its form (implicit submission); the option it was on is then disabled.
    fireEvent.submit(option('Ikeja Clinic').form!)

    const proceed = await screen.findByRole('button', { name: 'Saving…' })
    expect(option('Ikeja Clinic').matches(':disabled')).toBe(true)
    expect(document.activeElement).toBe(proceed)

    await act(async () => { saving.respond(problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility')) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(option('Ikeja Clinic').matches(':disabled')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' }))
  })

  it('works at the facility chosen whatever selection the answer to the choice reports, rather than ask again', async () => {
    // Identity accepted the choice for the facility sent: asking again straight after would leave no way on.
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(IKEJA, 'something-new')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
    await waitFor(() => expect(pageRequests(sent).length).toBeGreaterThan(0))
    expect(pageRequests(sent).every(call => call.facility === 'facility-2')).toBe(true)
  })

  it('still asks when the answer to the choice reports another facility than the one chosen, with a selection it does not know', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(LAGOS, 'something-new')] })
    await open('/provider')
    await question()
    fireEvent.click(option('Ikeja Clinic'))
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)

    expect(await screen.findByText(/The facility for this sign-in is not confirmed\./)).toBeTruthy()
    const heading = screen.getByRole('heading', { name: 'Where are you working?' })
    expect(pageRequests(sent)).toEqual([])
    // Asked afresh, for the new reason: nothing is left picked from the answer just refused, and the heading
    // takes focus, so the new reason is read rather than changed in place unannounced.
    expect(option('Ikeja Clinic').checked).toBe(false)
    expect(option('Lagos General').checked).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})

describe('the facility this tab works at, found gone mid-session', () => {
  // Identity checks X-Facility-ID against the actor's active memberships on every request. A tab keeps
  // the facility it works at across a refresh or check only while it is still one of the actor's
  // (hid-system#47 interface contract); it never moves to the facility the answer reports, which may
  // be another tab's choice. Once it is gone the open patient closes, and the tab asks.
  const allowedLookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
    patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: PATIENT_NAME } })

  /** A patient's record open at Ikeja Clinic; `sessions` are the session reads that follow the first. */
  async function openPatientAtIkeja(routes: Record<string, Answer[]>, sessions: Answer[] = []) {
    const sent = serve({ [SESSION]: [session(IKEJA, 'selected'), ...sessions], [LOOKUP]: [allowedLookup, allowedLookup], ...routes })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/clinical'))
    return sent
  }

  it.each([
    ['still reports the selection lost', 'reselect'],
    ['reports another tab\'s choice', 'selected'],
    ['comes from an Identity without the contract', undefined],
  ] as const)('asks once a refresh that %s shows it gone, closing the patient and sending nothing more for it', async (_label, selection) => {
    const sent = await openPatientAtIkeja({ [ENCOUNTERS]: [unauthenticated], [REFRESH]: [session(LAGOS, selection, [LAGOS])],
      [FACILITY]: [session(LAGOS, 'selected', [LAGOS])] })

    const heading = await question()
    expect(screen.getByText(/The facility you were working at is no longer available to you\./)).toBeTruthy()
    // What was on screen is gone with it, so the person is told, rather than left to believe it was saved.
    expect(screen.getByText(/The page you had open was closed, along with any patient record, and anything not yet saved there was not sent\./)).toBeTruthy()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    expect(screen.queryByRole('radio', { name: 'Ikeja Clinic' })).toBeNull()
    expect(option('Lagos General').checked).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(heading))
    // The read refused before the refresh is not repeated for the facility that is gone.
    const refreshed = sent.findIndex(call => call.route === REFRESH)
    expect(refreshed).toBeGreaterThan(-1)
    expect(sent.slice(refreshed + 1).filter(call => call.facility === 'facility-2')).toEqual([])

    fireEvent.click(option('Lagos General'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // The page opens again at the facility chosen, with no patient open.
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a patient first.' })).toBeTruthy()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: 'facility-1' }])
    expect(sent.slice(refreshed + 1).filter(call => call.facility === 'facility-2')).toEqual([])
  })

  it('asks once a session check shows it gone, before the workspace opens again, and never sends what waited for it', async () => {
    const asked = deferredResponse()
    const sent = await openPatientAtIkeja({ [ENCOUNTERS]: [() => json({ items: [] })], [FACILITY]: [session(LAGOS, 'selected', [LAGOS])] },
      [asked.answer])
    expect(await screen.findByRole('heading', { name: PATIENT_NAME })).toBeTruthy()

    fromAnotherTab()
    expect(await screen.findByRole('heading', { name: 'Checking your session…' })).toBeTruthy()
    // A request made for Ikeja Clinic while the session is checked waits for it.
    const { staffApi } = await import('./api')
    const waiting = staffApi.listAccessRequests('facility-2').then(() => 'sent', (error: { code?: string }) => error.code)
    // Another tab switched to Lagos General, and the Ikeja Clinic membership has ended.
    await act(async () => { asked.respond(await session(LAGOS, 'selected', [LAGOS])()) })

    const heading = await question()
    expect(screen.getByText(/The facility you were working at is no longer available to you\./)).toBeTruthy()
    expect(screen.getByText(/anything not yet saved there was not sent\./)).toBeTruthy()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(await waiting).toBe('REQUEST_CANCELLED')
    expect(sent.filter(call => call.route === REQUESTS)).toEqual([])

    fireEvent.click(option('Lagos General'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a patient first.' })).toBeTruthy()
  })

  /** The 'lost' sentence the heading is described by, as a screen reader reads it when the heading takes focus. */
  const headingDescription = (heading: HTMLElement) =>
    (heading.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')

  it('takes focus from the header, and says what closed, when a check finds it gone', async () => {
    // Focus on Sign out, still on screen, is not given back to it: the page it was beside is gone.
    await openPatientAtIkeja({ [ENCOUNTERS]: [() => json({ items: [] })] }, [session(LAGOS, 'selected', [LAGOS])])
    expect(await screen.findByRole('heading', { name: PATIENT_NAME })).toBeTruthy()
    screen.getByRole('button', { name: 'Sign out' }).focus()

    fromAnotherTab()

    const heading = await question()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(headingDescription(heading)).toContain('The page you had open was closed, along with any patient record, and anything not yet saved there was not sent.')
  })

  it('takes focus from the header when a refresh finds it gone', async () => {
    const encounters = deferredResponse()
    await openPatientAtIkeja({ [ENCOUNTERS]: [encounters.answer], [REFRESH]: [session(LAGOS, 'selected', [LAGOS])] })
    screen.getByRole('button', { name: 'Sign out' }).focus()

    await act(async () => { encounters.respond(unauthenticated()) })

    const heading = await question()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(headingDescription(heading)).toContain('The facility you were working at is no longer available to you.')
  })

  it('opens no patient from a page\'s answer that arrives once the facility is found gone', async () => {
    // The patient lookup was sent at Ikeja Clinic before the check; its answer arrives while the question shows.
    const looking = deferredResponse()
    const sent = serve({ [SESSION]: [session(IKEJA, 'selected'), session(LAGOS, 'selected', [LAGOS])], [LOOKUP]: [looking.answer],
      [FACILITY]: [session(LAGOS, 'selected', [LAGOS])] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(sent.map(call => call.route)).toContain(LOOKUP))

    fromAnotherTab()
    await question()
    await act(async () => { looking.respond(allowedLookup()) })

    // The patient period closed with the facility: the late answer neither opens the record nor moves to it.
    expect(screen.getByTestId('where').textContent).toBe('/provider/patients')
    fireEvent.click(option('Lagos General'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('textbox', { name: 'Health ID' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/provider/patients')
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
  })

  it('leaves the question it asked as it is when a later read finds more gone; choosing a facility gone says so', async () => {
    // Ikeja Clinic ends; then, while the question shows, Lagos General (the facility Identity reported) ends too.
    serve({ [SESSION]: [session(IKEJA, 'selected', [LAGOS, IKEJA, YABA]), session(LAGOS, 'selected', [LAGOS, YABA]), session(YABA, 'selected', [YABA])],
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility')], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    fromAnotherTab()
    await question()
    fireEvent.click(option('Lagos General'))

    fromAnotherTab()
    await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull())

    // Nothing the person picked is taken away while they choose; the server refuses a facility gone, and the refusal says so.
    expect(screen.getByText(/The facility you were working at is no longer available to you\./)).toBeTruthy()
    expect(option('Lagos General').checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('You are no longer active at Lagos General. Choose another facility.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Where are you working?' })).toBeTruthy()
  })

  it('leaves a question already asked as it is: the facility reported then was never the tab\'s own', async () => {
    // Asked at load (none chosen yet), then another tab switches to Ikeja Clinic and Lagos General ends.
    const sent = serve({ [SESSION]: [session(LAGOS, 'default'), session(IKEJA, 'selected', [IKEJA])] })
    await open('/provider')
    await question()
    fromAnotherTab()
    await waitFor(() => expect(sent.filter(call => call.route === SESSION)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull())

    expect(await question()).toBeTruthy()
    expect(screen.getByText(/You work at more than one facility\./)).toBeTruthy()
    expect(screen.queryByText(/were working at/)).toBeNull()
    expect(option('Ikeja Clinic').checked).toBe(false)
    expect(pageRequests(sent)).toEqual([])
  })
})
