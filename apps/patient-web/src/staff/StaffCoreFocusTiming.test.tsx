import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { focusWhenShown } from '../__tests__/focusWhenShown'
import { EmailCode } from './clinician/EmailCode'
import { ErrorSummary, type Problem } from './clinician/ui'

/**
 * The provider workspace's own screens and the clinician pages' shared steps move focus in the commit that shows where
 * it goes. From an effect, focus moved a task after a render that followed a request, and a check made as soon as the
 * screen was shown (findBy on a busy runner, as on health#16's CI) found focus still where it was. Each test answers
 * the request outside act, as a fetch's answer arrives, and reads focus at the moment the screen is shown.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// Provider sign-in also asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
// The security check, as a button that hands over a token.
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('check-token')}>Complete check</button>,
}))

const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined; vi.unstubAllGlobals(); vi.resetModules() })

/** The portal's other tabs, as BroadcastChannel would connect them: none here. */
class TabChannel extends EventTarget {
  constructor(readonly name: string) { super() }
  postMessage() { /* no other tab hears this one */ }
  close() { /* nothing to close */ }
}
beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel) })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

/** Presses a button the way a keyboard user does: focused, then activated. */
async function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** Settles a request outside act: React renders the outcome in one task and would run its effects in a later one. */
function answer(settle: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  settle()
}

describe('the provider workspace (App)', () => {
  const SESSION = 'GET /api/v1/auth/session'
  const REFRESH = 'POST /api/v1/auth/refresh'
  const FACILITY = 'POST /api/v1/auth/facility'
  const REQUESTS = 'GET /api/v1/identity/access-requests'

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const problem = (status: number, code: string, detail: string) => new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
  /** A protected route, or the refresh endpoint, refusing a request without a usable session. */
  const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
  const facility = (id: string, name: string, isPrimary: boolean) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name,
    roles: ['clinician'], permissions: ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read'], isPrimary })
  const LAGOS = facility('facility-1', 'Lagos General', true)
  const IKEJA = facility('facility-2', 'Ikeja Clinic', false)
  const session = (current: typeof LAGOS, facilitySelection: 'selected' | 'reselect') => json({
    actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [],
      facilities: [LAGOS, IKEJA], facility: current },
    expiresAt: '2026-10-12T12:00:00.000Z', facilitySelection,
  })

  /** Answers each `METHOD /path` from its own queue, in order; an answer may wait on a promise the test settles. */
  function serve(routes: Record<string, (() => Response | Promise<Response>)[]>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
      const next = routes[route]?.shift()
      return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
    }))
  }

  async function open() {
    const { App } = await import('./App')
    render(<MemoryRouter initialEntries={['/provider']}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
  }

  const heading = (name: string | RegExp) => () => screen.queryByRole('heading', { name })

  /**
   * Opens the overview, whose access requests are refused (401) once the test says so: the refresh is refused too, so
   * the workspace locks while the server is asked, and `check` is that question's session read.
   */
  async function openThenLock(refresh: () => Response) {
    const requests = deferred<Response>()
    const check = deferred<Response>()
    serve({ [SESSION]: [() => session(LAGOS, 'selected'), () => check.promise], [REQUESTS]: [() => requests.promise, () => json([])],
      [REFRESH]: [ended, refresh] })
    await open()
    await screen.findByRole('heading', { level: 1, name: /Good to see you/ })
    return { lock: () => requests.resolve(ended()), check }
  }

  async function locked() {
    const title = await screen.findByRole('heading', { name: 'Checking your session…' })
    await waitFor(() => expect(document.activeElement).toBe(title))
  }

  it('has focus on the facility question as soon as it is shown (FacilityChoice)', async () => {
    const read = deferred<Response>()
    serve({ [SESSION]: [() => read.promise] })
    await open()
    const shown = focusWhenShown(heading('Where are you working?'))
    answer(() => read.resolve(session(LAGOS, 'reselect')))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the overview\'s heading as soon as the facility chosen opens it (Shell)', async () => {
    const chosen = deferred<Response>()
    serve({ [SESSION]: [() => session(LAGOS, 'reselect')], [FACILITY]: [() => chosen.promise], [REQUESTS]: [() => json([])] })
    await open()
    await screen.findByRole('heading', { name: 'Where are you working?' })
    fireEvent.click(screen.getByRole('radio', { name: 'Ikeja Clinic' }))
    await press('Continue')
    const shown = focusWhenShown(heading(/Good to see you/))
    answer(() => chosen.resolve(session(IKEJA, 'selected')))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the session check\'s heading as soon as a refusal locks the workspace (SessionCheck)', async () => {
    const workspace = await openThenLock(ended)
    screen.getByRole('combobox', { name: 'Working at' }).focus()
    const shown = focusWhenShown(heading('Checking your session…'))
    answer(workspace.lock)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the heading as soon as it says the session could not be confirmed (SessionCheck)', async () => {
    const workspace = await openThenLock(() => problem(503, 'UPSTREAM_UNAVAILABLE', 'The service could not complete the request.'))
    await act(async () => { workspace.lock() })
    await locked()
    // Moved on while the server is asked: the answer that it could not say takes focus back to the heading that says so.
    screen.getByRole('button', { name: 'Sign out' }).focus()
    const shown = focusWhenShown(heading('We could not confirm your session'))
    answer(() => workspace.check.resolve(ended()))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the session-ended heading as soon as it is shown (SessionEnded)', async () => {
    const workspace = await openThenLock(ended)
    await act(async () => { workspace.lock() })
    await locked()
    const shown = focusWhenShown(heading('Your session has ended'))
    answer(() => workspace.check.resolve(ended()))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('gives focus back to where it was as soon as the workspace opens again (StaffProvider)', async () => {
    const workspace = await openThenLock(ended)
    const list = screen.getByRole('combobox', { name: 'Working at' })
    list.focus()
    await act(async () => { workspace.lock() })
    await locked()
    const shown = focusWhenShown(() => list.closest('[hidden]') ? null : list)
    answer(() => workspace.check.resolve(session(LAGOS, 'selected')))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})

describe('the clinician pages\' email steps (EmailCode)', () => {
  const sentCode = { accepted: true as const, challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 }

  function Steps({ verify }: { verify: () => Promise<unknown> }) {
    const [email, setEmail] = useState('ada@example.test')
    return <EmailCode idPrefix="timing" action="clinician-application" email={email} onEmail={setEmail} focusFirst={false}
      copy={{ emailHeading: 'Confirm your email', emailIntro: null, sent: address => `We sent a code to ${address}.`,
        codeInvalid: 'That code was not accepted.' }}
      send={() => Promise.resolve(sentCode)} verify={verify} refused={() => 'Something went wrong.'} onStage={() => undefined}
      onVerified={() => undefined} />
  }

  it('has focus on the code field as soon as its refused code is said', async () => {
    const checked = deferred<unknown>()
    render(<Steps verify={() => checked.promise} />)
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('heading', { name: 'Enter the 6-digit code' })
    fireEvent.change(screen.getByLabelText(/^6-digit code/), { target: { value: '123456' } })
    await press('Verify email')
    const shown = focusWhenShown(() => screen.queryByText('That code was not accepted.'))
    answer(() => checked.reject(new HidApiError(400, 'Invalid code', { code: 'CLINICIAN_APPLICATION_CODE_INVALID' })))
    const { focused } = await shown
    expect(focused).toBe(screen.getByLabelText(/^6-digit code/))
  })
})

describe('the clinician pages\' error summary (ErrorSummary)', () => {
  // Its pages show it from a submit handler today, where React runs every effect before the browser goes on; shown
  // after a request it takes focus as soon as it is shown too.
  function Checked({ check }: { check: () => Promise<Problem[]> }) {
    const [problems, setProblems] = useState<Problem[]>([])
    const [key, setKey] = useState(0)
    return <form onSubmit={event => { event.preventDefault(); void check().then(found => { setProblems(found); setKey(value => value + 1) }) }}>
      <ErrorSummary problems={problems} focusKey={key} />
      <label htmlFor="timing-name">Full name</label><input id="timing-name" />
      <button type="submit">Continue</button>
    </form>
  }

  it('has focus on the summary as soon as it is shown', async () => {
    const checked = deferred<Problem[]>()
    render(<Checked check={() => checked.promise} />)
    await press('Continue')
    const shown = focusWhenShown(() => screen.queryByRole('alert'))
    answer(() => checked.resolve([{ field: 'timing-name', message: 'Enter your full name.' }]))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
