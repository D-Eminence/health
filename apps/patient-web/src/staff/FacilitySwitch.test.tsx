import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * PEHR-02 (WCAG 3.2.2 On Input, failure F37). The "Working at" list switched the
 * working facility as soon as its value changed: it sent POST /auth/facility,
 * opened the overview and closed the open patient. On a closed list one arrow
 * key changes the value, so a keyboard user browsing the options lost their
 * place. Choosing a facility now only proposes it. Switch facility confirms it,
 * Cancel keeps the current one, and the request (POST /api/v1/auth/facility
 * with { facilityId }) is unchanged.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const SESSION = 'GET /api/v1/auth/session'
const FACILITY = 'POST /api/v1/auth/facility'
const REQUESTS = 'GET /api/v1/identity/access-requests'
const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters`
const PATIENT_NAME = 'Chidi Okafor'

type Answer = () => Response | Promise<Response>
interface Sent { route: string; body: unknown }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'ehr.encounter.read', 'ehr.document.read']
const facility = (id: string, name: string, isPrimary: boolean) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary })
const LAGOS = facility('facility-1', 'Lagos General', true)
const IKEJA = facility('facility-2', 'Ikeja Clinic', false)
const sessionAt = (current: typeof LAGOS) => () => json({ actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities: [LAGOS, IKEJA], facility: current }, expiresAt: '2026-10-12T12:00:00.000Z' })
const allowedLookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
  patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: PATIENT_NAME } })

function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}</output>
}
const where = () => screen.getByTestId('where').textContent

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

/** The clinical record open on a patient, reached through Patient access. */
async function openPatient(routes: Record<string, Answer[]> = {}) {
  const sent = serve({ [SESSION]: [sessionAt(LAGOS)], [LOOKUP]: [allowedLookup, allowedLookup], [ENCOUNTERS]: [() => json({ items: [] })], ...routes })
  await open('/provider/patients')
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
  await waitFor(() => expect(where()).toBe('/provider/clinical'))
  expect(await screen.findByRole('heading', { name: PATIENT_NAME })).toBeTruthy()
  return sent
}

const list = () => screen.getByRole('combobox', { name: 'Working at' }) as HTMLSelectElement
const posted = (sent: Sent[]) => sent.filter(call => call.route === FACILITY)
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe('PEHR-02: choosing a facility only proposes it', () => {
  it('keeps the facility, the page and the open patient when the value changes, as one arrow key does', async () => {
    const sent = await openPatient()
    list().focus()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    await settle()

    expect(posted(sent)).toEqual([])
    expect(where()).toBe('/provider/clinical')
    expect(screen.getByRole('heading', { name: PATIENT_NAME })).toBeTruthy()
    expect(document.activeElement).toBe(list())
    // It says what is current, what is proposed and what a switch would do.
    const question = screen.getByRole('group', { name: /Switch to Ikeja Clinic\?/ })
    expect(question.textContent).toContain('You are working at Lagos General. Switch to Ikeja Clinic? The open patient record will close.')
    expect(list().getAttribute('aria-describedby')).toBe('staff-facility-question')
  })

  it('does not mention a patient record when none is open', async () => {
    serve({ [SESSION]: [sessionAt(LAGOS)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    expect(screen.getByRole('group', { name: /Switch to Ikeja Clinic\?/ }).textContent).not.toContain('patient record')
  })

  it('Cancel keeps the current facility, removes the question and returns focus to the list, sending nothing', async () => {
    const sent = await openPatient()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(list().value).toBe('facility-1')
    expect(screen.queryByRole('group', { name: /Switch to/ })).toBeNull()
    expect(list().hasAttribute('aria-describedby')).toBe(false)
    expect(document.activeElement).toBe(list())
    expect(posted(sent)).toEqual([])
    expect(screen.getByRole('heading', { name: PATIENT_NAME })).toBeTruthy()
  })

  it('choosing the current facility again withdraws the question', async () => {
    await openPatient()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    fireEvent.change(list(), { target: { value: 'facility-1' } })
    expect(screen.queryByRole('button', { name: 'Switch facility' })).toBeNull()
  })
})

describe('PEHR-02: Switch facility confirms it', () => {
  it('switches with the same request, opens the overview at the new facility and moves focus to its heading', async () => {
    const sent = await openPatient({ [FACILITY]: [sessionAt(IKEJA)], [REQUESTS]: [() => json([])] })
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    const confirm = screen.getByRole('button', { name: 'Switch facility' })
    confirm.focus()
    fireEvent.click(confirm)

    await waitFor(() => expect(where()).toBe('/provider'))
    expect(posted(sent)).toEqual([{ route: FACILITY, body: { facilityId: 'facility-2' } }])
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    expect(list().value).toBe('facility-2')
    expect(screen.queryByRole('group', { name: /Switch to/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: PATIENT_NAME })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /Good to see you/ })))
  })

  it('sends one request however often it is pressed while the switch runs, keeping focus on it', async () => {
    let answer: (response: Response) => void = () => {}
    const sent = await openPatient({ [FACILITY]: [() => new Promise<Response>(resolve => { answer = resolve })], [REQUESTS]: [() => json([])] })
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    const confirm = screen.getByRole('button', { name: 'Switch facility' })
    confirm.focus()
    fireEvent.click(confirm)
    const running = await screen.findByRole('button', { name: 'Switching…' })
    expect(running.getAttribute('aria-disabled')).toBe('true')
    expect(running.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(running)
    fireEvent.click(running)
    await act(async () => { answer(sessionAt(IKEJA)()) })
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(posted(sent)).toHaveLength(1)
  })

  it('keeps the current facility, the proposal and the patient when the switch is refused, and says so', async () => {
    const sent = await openPatient({ [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at this facility')] })
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    const confirm = screen.getByRole('button', { name: 'Switch facility' })
    confirm.focus()
    fireEvent.click(confirm)

    const refusal = await screen.findByText(/not active at this facility/)
    expect(refusal.getAttribute('role')).toBe('alert')
    expect(where()).toBe('/provider/clinical')
    expect(screen.getByRole('heading', { name: PATIENT_NAME })).toBeTruthy()
    expect(screen.getByRole('group', { name: /Switch to Ikeja Clinic\?/ })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Switch facility' })))
    expect(posted(sent)).toHaveLength(1)
  })
})

describe('PEHR-02: after a reload', () => {
  // hid-system keeps no chosen facility: POST /auth/facility answers with the actor at
  // that facility and stores nothing, and GET /auth/session resolves the sign-in's
  // preferred facility, else the primary one. A reload therefore shows that facility.
  it('shows the facility the server resolves, with no proposal left over', async () => {
    serve({ [SESSION]: [sessionAt(LAGOS)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    expect(screen.getByRole('group', { name: /Switch to/ })).toBeTruthy()

    cleanup(); vi.resetModules()
    const sent = serve({ [SESSION]: [sessionAt(LAGOS)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(list().value).toBe('facility-1')
    expect(screen.getByText(/Working at Lagos General\./)).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Switch to/ })).toBeNull()
    expect(posted(sent)).toEqual([])
  })

  it('shows the facility the server resolves after a confirmed switch, without switching again', async () => {
    serve({ [SESSION]: [sessionAt(LAGOS)], [REQUESTS]: [() => json([]), () => json([])], [FACILITY]: [sessionAt(IKEJA)] })
    await open('/provider')
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    fireEvent.change(list(), { target: { value: 'facility-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()

    cleanup(); vi.resetModules()
    const sent = serve({ [SESSION]: [sessionAt(LAGOS)], [REQUESTS]: [() => json([])] })
    await open('/provider')
    expect(await screen.findByText(/Working at Lagos General\./)).toBeTruthy()
    expect(list().value).toBe('facility-1')
    expect(posted(sent)).toEqual([])
  })
})
