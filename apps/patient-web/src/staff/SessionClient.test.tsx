import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * The provider portal names itself in X-HID-Client on its cookie refresh and
 * sign-out (hid-system #39). The patient portal shares the origin and its
 * cookies, so Identity refuses a refresh or sign-out of a patient's sign-in from
 * this portal with 403 SESSION_CLIENT_MISMATCH: nothing rotates or ends, and the
 * cookies are kept. The provider's sign-in has then left this browser.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const REQUESTS = 'GET /api/v1/identity/access-requests'

type Answer = () => Response | Promise<Response>
interface Sent { route: string; headers: Headers }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const patientHoldsCookies = () => problem(403, 'SESSION_CLIENT_MISMATCH', 'This sign-in belongs to the patient application, not staff-web')
const signedOut = () => new Response(null, { status: 204 })
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General',
  roles: ['clinician'], permissions: ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write',
    'identity.patient-access-pin.verify', 'ehr.encounter.read', 'ehr.document.read', 'lab.work-item.read'], isPrimary: true }
const staffSession = () => json({ actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities: [facility], facility }, expiresAt: '2026-10-12T12:00:00.000Z' })

/** Serves each `METHOD /path` from its own queue and records every request with its headers. */
function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    sent.push({ route, headers: new Headers(init?.headers) })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

/** The portal's other tabs, as BroadcastChannel would connect them. */
let announced: unknown[] = []
class RecordingChannel extends EventTarget {
  constructor(readonly name: string) { super() }
  postMessage(message: unknown) { announced.push(message) }
  close() {}
}

beforeEach(() => {
  announced = []
  vi.stubGlobal('BroadcastChannel', RecordingChannel)
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('hid_access_csrf=csrf-staff')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

/** Opens the real staff App on its overview, whose first read is `REQUESTS`. */
async function open(answers: Record<string, Answer[]>) {
  const sent = serve({ ...answers, [SESSION]: [staffSession, ...(answers[SESSION] ?? [])] })
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={['/provider']}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
  return sent
}

async function openWorkspace(answers: Record<string, Answer[]>) {
  const sent = await open({ ...answers, [REQUESTS]: [() => json([]), ...(answers[REQUESTS] ?? [])] })
  expect(await screen.findByText('0 pending requests')).toBeTruthy()
  return sent
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const routes = (sent: Sent[]) => sent.map(call => call.route)
const auth = (sent: Sent[]) => routes(sent).filter(route => route.startsWith('POST /api/v1/auth/'))
const client = (sent: Sent[], route: string) => sent.filter(call => call.route === route).map(call => call.headers.get('X-HID-Client'))
const SIGNED_OUT = 'Welcome back.'
const SESSION_ENDED = 'Your session has ended'

describe('the provider portal names itself on its cookie refresh and sign-out', () => {
  it('sends X-HID-Client: staff-web, with its CSRF token, on sign-out, and not on its reads', async () => {
    const sent = await openWorkspace({ [LOGOUT]: [signedOut] })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: SIGNED_OUT })).toBeTruthy()
    expect(client(sent, LOGOUT)).toEqual(['staff-web'])
    expect(sent.find(call => call.route === LOGOUT)?.headers.get('X-CSRF-Token')).toBe('csrf-staff')
    expect([...client(sent, SESSION), ...client(sent, REQUESTS)].every(value => value === null)).toBe(true)
  })

  it('sends X-HID-Client: staff-web on the refresh that restores an idle sign-out, and on the sign-out after it', async () => {
    const sent = await openWorkspace({ [LOGOUT]: [ended, signedOut], [REFRESH]: [staffSession] })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: SIGNED_OUT })).toBeTruthy()
    expect(auth(sent)).toEqual([LOGOUT, REFRESH, LOGOUT])
    expect(client(sent, REFRESH)).toEqual(['staff-web'])
    expect(client(sent, LOGOUT)).toEqual(['staff-web', 'staff-web'])
  })
})

describe('SESSION_CLIENT_MISMATCH: the browser holds a patient\'s sign-in now', () => {
  it('signs out locally when the sign-out is refused, without retrying or refreshing', async () => {
    const sent = await openWorkspace({ [LOGOUT]: [patientHoldsCookies] })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: SIGNED_OUT })).toBeTruthy()
    await settle()
    expect(auth(sent)).toEqual([LOGOUT])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/patient application|staff-web|SESSION_CLIENT_MISMATCH/)).toBeNull()
  })

  it('signs out locally after an idle period when the restoring refresh is refused', async () => {
    const sent = await openWorkspace({ [LOGOUT]: [ended], [REFRESH]: [patientHoldsCookies] })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: SIGNED_OUT })).toBeTruthy()
    await settle()
    expect(auth(sent)).toEqual([LOGOUT, REFRESH])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ends the workspace when a read\'s refresh is refused, after asking the server, and repeats nothing', async () => {
    // The overview's read is made after the access token expired.
    const sent = await open({ [REQUESTS]: [ended], [SESSION]: [ended], [REFRESH]: [patientHoldsCookies, patientHoldsCookies] })
    expect(await screen.findByRole('heading', { name: SESSION_ENDED })).toBeTruthy()
    await settle()
    expect(routes(sent)).toEqual([SESSION, REQUESTS, REFRESH, SESSION, REFRESH])
    expect(client(sent, REFRESH)).toEqual(['staff-web', 'staff-web'])
    expect(auth(sent)).not.toContain(LOGOUT)
    expect(screen.queryByText(/patient application|staff-web|SESSION_CLIENT_MISMATCH/)).toBeNull()
  })
})
