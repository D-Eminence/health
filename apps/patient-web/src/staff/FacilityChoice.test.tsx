import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
 * behaves as before.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SESSION = 'GET /api/v1/auth/session'
const FACILITY = 'POST /api/v1/auth/facility'
const REQUESTS = 'GET /api/v1/identity/access-requests'

type Answer = () => Response | Promise<Response>
interface Sent { route: string; body: unknown; facility: string | null }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read']
const facility = (id: string, name: string, isPrimary: boolean) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary })
const LAGOS = facility('facility-1', 'Lagos General', true)
const IKEJA = facility('facility-2', 'Ikeja Clinic', false)
type Selection = 'selected' | 'default' | 'reselect' | undefined
const session = (current: typeof LAGOS, facilitySelection: Selection, facilities = [LAGOS, IKEJA]) => () => json({
  actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [], facilities, facility: current },
  expiresAt: '2026-10-12T12:00:00.000Z', ...(facilitySelection ? { facilitySelection } : {}),
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
const pageRequests = (sent: Sent[]) => sent.filter(call => call.route !== SESSION && call.route !== FACILITY)

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
    const refusal = await screen.findByText(/not active at this facility/)
    expect(refusal.getAttribute('role')).toBe('alert')
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const missing = screen.getByRole('alert')
    expect(missing.textContent).toBe('Choose a facility to continue.')
    expect(document.activeElement).toBe(option('Lagos General'))
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toContain(missing.id)
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
  })

  it('a page opened by its address waits for the choice too, then opens', async () => {
    const sent = serve({ [SESSION]: [session(LAGOS, 'reselect')], [FACILITY]: [session(IKEJA, 'selected')] })
    await open('/provider/clinical')
    await question()
    expect(screen.queryByText(/Select a patient/i)).toBeNull()
    fireEvent.click(option('Ikeja Clinic'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull())
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

  it('keeps this tab at its facility when a later session read reports another tab\'s choice', async () => {
    // The choice belongs to the sign-in, so another tab's switch is what the server reports next.
    // A tab adopts a session only on load, sign-in or its own choice: a refresh or check does not move it.
    const sent = serve({ [SESSION]: [session(LAGOS, 'selected'), session(IKEJA, 'selected'), session(IKEJA, 'selected')],
      'POST /api/v1/auth/refresh': [session(IKEJA, 'selected')],
      [REQUESTS]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required'), () => json([]), () => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    await waitFor(() => expect(sent.filter(call => call.route === REQUESTS).length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull())
    expect(screen.getByText(/Working at Lagos General\./)).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement).value).toBe('facility-1')
    expect(sent.filter(call => call.route === REQUESTS).every(call => call.facility === 'facility-1')).toBe(true)
    expect(sent.filter(call => call.route === FACILITY)).toEqual([])
  })
})
