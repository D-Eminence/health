import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { StaffSessionSnapshot } from '@hid/offline'
import { fakeRuntime, type FakeRuntime } from './fakeRuntime'

/**
 * The real staff App with an offline runtime (a fake of the frozen interface) and the network replaced: the offline
 * cold start, the idle lock over a form in progress, and a facility that is not in the pilot seeing nothing new.
 */
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const PILOT = '98d00002-0000-4000-8000-000000000001'
const REAL = '11111111-0000-4000-8000-000000000001'
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read', 'ehr.note.read', 'ehr.note.write']
const facility = (id: string, name: string) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'],
  permissions: PERMISSIONS, isPrimary: true })
const staffSession = (id = PILOT, name = 'Demo Hospital') => ({
  actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'], permissions: [],
    facilities: [facility(id, name)], facility: facility(id, name) },
  facilitySelection: 'selected',
})
const snapshot = (): StaffSessionSnapshot => ({ actorId: 'staff-1', accountId: 'staff-1', membershipId: `member-${PILOT}`, email: 'ada@example.test',
  displayName: 'Ada Clinician', facilityId: PILOT, facilityName: 'Demo Hospital', permissions: PERMISSIONS, session: staffSession() })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

class TabChannel extends EventTarget { postMessage() { /* other tabs are not modelled */ } close() { /* nothing to release */ } }

let calls: string[] = []
function serve(answer: (route: string) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    return answer(route)
  }))
}

async function open(runtime: FakeRuntime | null, environment: Record<string, unknown> | null, path = '/provider') {
  const { setOfflineRuntimeForTests } = await import('../runtime')
  const { setOfflineEnvironmentForTests } = await import('../environment')
  setOfflineEnvironmentForTests(environment)
  setOfflineRuntimeForTests(runtime)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

describe('offline cold start', () => {
  it('offers the offline sign-in when Health ID cannot be reached and opens the restored session offline', async () => {
    serve(() => { throw new TypeError('Failed to fetch') })
    const runtime = fakeRuntime({ hasVaults: true, restored: snapshot(), summary: { connectivity: 'offline' } })
    await open(runtime, { mode: 'pilot', facilities: [PILOT] })

    expect(await screen.findByRole('heading', { name: 'Health ID can’t be reached' }, { timeout: 8000 })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /Work email/ }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open offline copy' }))

    expect(await screen.findByText(/Working offline\. Changes are saved on this device/)).toBeTruthy()
    expect(runtime.unlockOffline).toHaveBeenCalledWith('ada@example.test', 'a long enough password')
    expect(screen.getByRole('heading', { level: 1, name: /Good to see you, Ada/ })).toBeTruthy()
    // The workspace says it is offline in the top bar, as a polite status.
    expect(screen.getAllByRole('status').some(node => node.textContent === 'Offline')).toBe(true)
  }, 15000)

  it('keeps today’s error screen when no offline copy is on this device', async () => {
    serve(() => { throw new TypeError('Failed to fetch') })
    await open(fakeRuntime({ hasVaults: false }), { mode: 'pilot', facilities: [PILOT] })
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Health ID can’t be reached' })).toBeNull()
  }, 15000)
})

describe('idle lock', () => {
  it('locks after 5 minutes without use, keeps the form text beneath, and reopens with the password', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json(staffSession())
      : route === 'GET /api/v1/identity/access-requests' ? json([]) : json({ code: 'UNEXPECTED' }, 418))
    const runtime = fakeRuntime({})
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/patients')
    const reason = await screen.findByRole('textbox', { name: /Clinical reason/ })
    fireEvent.change(reason, { target: { value: 'Follow-up for the cough seen last week' } })

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // A key press restarts the five minutes.
    fireEvent.keyDown(document.body, { key: 'a' })
    act(() => { vi.advanceTimersByTime(5 * 60_000 + 10) })
    vi.useRealTimers()

    expect(runtime.lock).toHaveBeenCalledWith('idle')
    expect(await screen.findByRole('heading', { name: 'Health ID is locked' })).toBeTruthy()
    // Hidden and inert, but mounted: what was typed is still there.
    expect((document.getElementById('request-reason') as HTMLTextAreaElement).value).toBe('Follow-up for the cough seen last week')

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Health ID is locked' })).toBeNull())
    expect(runtime.unlockLocked).toHaveBeenCalledWith('a long enough password')
    expect((screen.getByRole('textbox', { name: /Clinical reason/ }) as HTMLTextAreaElement).value).toBe('Follow-up for the cough seen last week')
  })
})

describe('a facility that is not in the pilot', () => {
  it('sees no offline UI after sign-in, and no question to keep a copy', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json(staffSession(REAL, 'Lagos General'))
      : route === 'GET /api/v1/identity/access-requests' ? json([]) : json({ code: 'UNEXPECTED' }, 418))
    const runtime = fakeRuntime({ policy: { enabled: false, reason: 'facility-off' }, summary: { vault: 'none' } })
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByText(/Keep an offline copy/)).toBeNull()
    expect(screen.queryByText(/On this device/)).toBeNull()
    expect(screen.queryByLabelText('Access for')).toBeNull()
    expect(screen.queryByText(/Offline use is paused/)).toBeNull()
    expect(calls.filter(route => route.includes('/offline/'))).toEqual([])
    expect(runtime.reads.read).not.toHaveBeenCalled()
    expect(runtime.commands.save).not.toHaveBeenCalled()
  })

  it('signing in changes nothing they can see: no checkbox, no question, no offline status', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401)
      : route === 'POST /api/v1/auth/refresh' ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401)
        : route === 'POST /api/v1/auth/login' ? json(staffSession(REAL, 'Lagos General')) : json([]))
    const runtime = fakeRuntime({ policy: { enabled: false, reason: 'facility-off' }, summary: { vault: 'none' } })
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long enough password' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/offline/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { level: 1, name: /Good to see you, Ada/ })).toBeTruthy()
    await waitFor(() => expect(runtime.attachSession).toHaveBeenCalled())
    expect(screen.queryByText(/Keep an offline copy/)).toBeNull()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByText(/On this device/)).toBeNull()
  })

  it('in a build with offline off, the workspace has no runtime and no offline UI at all', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json(staffSession(REAL, 'Lagos General')) : json([]))
    await open(null, null, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(screen.queryByText('Offline and sync')).toBeNull()
    expect(screen.queryByLabelText('Access for')).toBeNull()
  })
})

describe('the one-time choice at a pilot facility (amendment A5)', () => {
  it('asks once after sign-in on a device with no copy, and keeps one only when chosen', async () => {
    serve(route => route === 'GET /api/v1/auth/session' ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401)
      : route === 'POST /api/v1/auth/refresh' ? json({ code: 'AUTHENTICATION_REQUIRED' }, 401)
        : route === 'POST /api/v1/auth/login' ? json(staffSession()) : json([]))
    const runtime = fakeRuntime({ policy: { enabled: false, reason: 'not-opted-in' }, summary: { vault: 'none' } })
    runtime.attachSession.mockImplementation(async (_s: StaffSessionSnapshot, o: { optIn: boolean }) => {
      if (o.optIn) { runtime.setPolicy({ enabled: true, reason: undefined }); runtime.setSummary({ vault: 'unlocked' }) }
      return runtime.summary()
    })
    await open(runtime, { mode: 'pilot', facilities: [PILOT] }, '/provider/sign-in')
    fireEvent.change(await screen.findByRole('textbox', { name: /Work email/ }), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long enough password' } })
    // No checkbox on the sign-in page.
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Keep an offline copy on this device (personal devices only)' })).toBeTruthy()
    expect(runtime.prepareFromSignIn).toHaveBeenCalledWith('ada@example.test', 'a long enough password')
    expect(runtime.attachSession).toHaveBeenCalledWith(expect.objectContaining({ facilityId: PILOT }), { optIn: false, online: true })
    fireEvent.click(screen.getByRole('button', { name: 'Keep an offline copy' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Keep an offline copy on this device/ })).toBeNull())
    expect(runtime.attachSession).toHaveBeenLastCalledWith(expect.objectContaining({ facilityId: PILOT }), { optIn: true, online: true })
    expect(await screen.findByText('Offline and sync')).toBeTruthy()
  })
})
