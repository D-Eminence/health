import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../../productHostname'
import type { OutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { OUTREACH_SNAPSHOT_KEY, outreachSnapshotOf, readOutreachSnapshot } from '../../../../ehr-blue/departments/outreach/offlineStart'
import { json, openStaffApp, serve as serveRoutes, SESSION, where, type Answer } from '../../frame/blueHarness'

/*
 * Opening Outreach with no signal (owner, 13 November 2026): on Health ID Outreach's own site, when the session can't be
 * read for want of a connection, the last confirmed session's facts (under 24 hours old) open Outreach in "No signal"
 * mode: new registrations are kept on this device, the waiting ones are shown, and whatever needs Health ID says
 * "Needs signal". Once Health ID answers again the session is read as usual. Anywhere else, or with no facts, start-up is
 * as before. Every account, group, campaign and person here is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const host = vi.hoisted(() => ({ outreach: true }))
vi.mock('../../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, offlineShellHere: () => host.outreach }
})

const NOW = Date.now()
const CAMPAIGN = { id: 'c0a00000-0000-4000-8000-000000000101', name: 'Ilorin health day', status: 'active', services: ['registration'],
  startsAt: new Date(NOW - 60 * 60 * 1000).toISOString(), endsAt: new Date(NOW + 10 * 60 * 60 * 1000).toISOString(), rowVersion: 1 }
const snapshot = (savedAt = NOW) => outreachSnapshotOf({ actorId: 'staff-demo-1', displayName: 'Demo Volunteer', facilityId: 'group-1',
  facilityName: 'Ilorin Health Volunteers', healthChecksServed: false, campaigns: [CAMPAIGN], now: savedAt })
const keepFacts = (savedAt = NOW) => {
  const raw = JSON.stringify(snapshot(savedAt))
  sessionStorage.setItem(OUTREACH_SNAPSHOT_KEY, raw)
  localStorage.setItem(OUTREACH_SNAPSHOT_KEY, raw)
}

const online = { value: true }
const noNetwork = () => Promise.reject(new TypeError('Failed to fetch'))
let store: OutreachQueueStore
// The app's HTTP client takes the fetch it finds as it loads (here, before a test names its answers): it goes through
// this one, which asks the test's answers (serve). Nothing reaches a network.
let answerWith: typeof fetch = () => Promise.reject(new TypeError('No answer set'))
const delegate = ((...args: Parameters<typeof fetch>) => answerWith(...args)) as typeof fetch
function serve(routes: Record<string, Answer[]>) {
  const sent = serveRoutes(routes)
  answerWith = globalThis.fetch
  vi.stubGlobal('fetch', delegate)
  return sent
}

beforeEach(async () => {
  host.outreach = true
  online.value = true
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online.value })
  // The app's own modules, fresh for each test (its HTTP client takes the test's fetch), with a queue in memory.
  answerWith = () => Promise.reject(new TypeError('No answer set'))
  vi.stubGlobal('fetch', delegate)
  vi.resetModules()
  const { memoryQueueStore, setOutreachQueueStore } = await import('../../../../ehr-blue/departments/outreach/offlineQueue')
  store = memoryQueueStore()
  setOutreachQueueStore(store)
})
afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'onLine')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('opening Outreach with no signal', () => {
  it('on a phone that knows it is offline: "No signal" mode at once, without asking Health ID', async () => {
    keepFacts()
    online.value = false
    const sent = serve({})
    await openStaffApp('/provider/outreach')
    expect(await screen.findByText('No signal. You can keep registering. Your work stays on this phone.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Outreach' })).toBeTruthy()
    expect(screen.getByText('Ilorin Health Volunteers · Demo Volunteer')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Needs signal' })).getByText(/registrations list from Health ID, health checks, Create Health ID and export/)).toBeTruthy()
    expect(sent).toEqual([])
  })

  it('shows one banner, the same one and the same words as the open workspace with no signal', async () => {
    keepFacts()
    online.value = false
    serve({})
    await openStaffApp('/provider/outreach')
    await screen.findByText('No signal. You can keep registering. Your work stays on this phone.')
    const banners = document.querySelectorAll('.staff-no-signal')
    expect(banners).toHaveLength(1)
    expect(banners[0]!.getAttribute('role')).toBe('status')
    expect(banners[0]!.textContent).toBe('No signal. You can keep registering. Your work stays on this phone.')
    // No second, differently worded "No signal" notice on the page.
    expect(screen.getAllByText(/No signal/)).toHaveLength(1)
    expect(screen.queryByText(/You can still register people/)).toBeNull()
  })

  it('when the session read gets no answer: "No signal" mode, from the facts kept', async () => {
    keepFacts()
    serve({ [SESSION]: [noNetwork, noNetwork, noNetwork, noNetwork] })
    await openStaffApp('/provider/outreach')
    expect(await screen.findByText(/No signal. You can keep registering/, {}, { timeout: 5000 })).toBeTruthy()
  })

  it('registers a person on this device, sends nothing, and lists them with those already waiting', async () => {
    keepFacts()
    await store.put({ localCommandId: 'cmd-earlier', temporaryPatientId: 'tmp_earlier', accountId: 'staff-demo-1', facilityId: 'group-1',
      input: { fullName: 'Bola Adewale', sex: 'female', ageYears: 41, campaignId: CAMPAIGN.id }, savedAt: new Date(NOW - 60_000).toISOString(), state: 'waiting' })
    // Someone else's, on the same phone: never shown.
    await store.put({ localCommandId: 'cmd-other', temporaryPatientId: 'tmp_other', accountId: 'staff-other', facilityId: 'group-1',
      input: { fullName: 'Not Mine', sex: 'male', ageYears: 30 }, savedAt: new Date(NOW - 60_000).toISOString(), state: 'waiting' })
    online.value = false
    const sent = serve({})
    await openStaffApp('/provider/outreach')
    const queue = await screen.findByRole('region', { name: 'Saved on this device' })
    expect(within(queue).getByText('Bola Adewale')).toBeTruthy()
    expect(within(queue).queryByText('Not Mine')).toBeNull()
    expect(within(queue).queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(within(queue).getByText(/Needs signal to send/)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New registration' })) })
    await screen.findByRole('heading', { level: 1, name: 'New registration' })
    expect((screen.getByRole('option', { name: 'Ilorin health day' }) as HTMLOptionElement).selected).toBe(true)
    fireEvent.click(document.getElementById('outreach-consent-method-verbal_read_aloud')!)
    fireEvent.change(document.getElementById('outreach-case-name')!, { target: { value: 'Ada Bello' } })
    fireEvent.change(document.getElementById('outreach-case-age')!, { target: { value: '34' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save registration' })) })

    expect(await screen.findByText('No connection: Ada Bello’s registration is saved on this device. It is sent when you are back online. Health checks can be added once it is sent. Write the readings on paper until then.')).toBeTruthy()
    const after = screen.getByRole('region', { name: 'Saved on this device' })
    expect(within(after).getByText('Ada Bello')).toBeTruthy()
    expect(within(after).getByText('Bola Adewale')).toBeTruthy()
    const kept = (await store.list()).find(entry => entry.input.fullName === 'Ada Bello')!
    expect(kept).toMatchObject({ accountId: 'staff-demo-1', facilityId: 'group-1', state: 'waiting',
      input: { campaignId: CAMPAIGN.id, ageYears: 34, consent: { method: 'verbal_read_aloud' } } })
    expect(sent).toEqual([])
  })

  it('once Health ID answers again, reads the session as usual: an ended one goes to sign-in', async () => {
    keepFacts()
    online.value = false
    const sent = serve({ [SESSION]: [
      () => json({ code: 'UNAUTHENTICATED', detail: 'Sign in.' }, 401),
      () => json({ code: 'UNAUTHENTICATED', detail: 'Sign in.' }, 401),
    ], 'POST /api/v1/auth/refresh': [() => json({ code: 'UNAUTHENTICATED', detail: 'Sign in.' }, 401)] })
    await openStaffApp('/provider/outreach')
    await screen.findByText(/No signal. You can keep registering/)
    online.value = true
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(where()).toBe('/provider/sign-in'), { timeout: 5000 })
    expect(sent.filter(request => request.route === SESSION).length).toBeGreaterThanOrEqual(2)
    // Health ID said the session ended: the facts go, so nothing opens "No signal" mode for it again. What waits on
    // the phone stays (offlineQueue.ts) and is sent once the same account signs in.
    expect(readOutreachSnapshot()).toBeNull()
  })
})

describe('a slow start that opened "No signal" mode (findings 2, 4 and 7)', () => {
  const group = { id: 'group-1', name: 'Ilorin Health Volunteers' }
  const confirmed = () => json({ actor: { id: 'staff-demo-1', displayName: 'Demo Volunteer', roles: [], permissions: [], facilities: [group] },
    expiresAt: '2026-11-30T12:00:00.000Z' })

  it('keeps a registration being typed when the first session read answers late, and goes online once it is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    keepFacts()
    // The first session read gets through, but only after "No signal" mode has opened (6 seconds).
    let answerLate!: (response: Response) => void
    const late = new Promise<Response>(resolve => { answerLate = resolve })
    serve({ [SESSION]: [() => late, confirmed, confirmed] })
    await openStaffApp('/provider/outreach')
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    await screen.findByText(/No signal. You can keep registering/)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New registration' })) })
    await screen.findByRole('heading', { level: 1, name: 'New registration' })
    fireEvent.change(document.getElementById('outreach-case-name')!, { target: { value: 'Ada Bello' } })

    // The late answer arrives while the volunteer types: the form, and what is typed in it, stay on screen.
    await act(async () => { answerLate(confirmed()); await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('heading', { level: 1, name: 'New registration' })).toBeTruthy()
    expect((document.getElementById('outreach-case-name') as HTMLInputElement).value).toBe('Ada Bello')

    // "No signal" mode's own check finds signal and says so, still without taking the form away.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(await screen.findByText('Signal is back. Save or cancel this registration to go online.')).toBeTruthy()
    expect((document.getElementById('outreach-case-name') as HTMLInputElement).value).toBe('Ada Bello')

    // Back on the list, the session is read again and the workspace opens as usual.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to list' })) })
    await waitFor(() => expect(screen.queryByText(/No signal. You can keep registering/)).toBeNull())
    expect(screen.queryByRole('heading', { level: 1, name: 'New registration' })).toBeNull()
  })

  it('goes online on a link that is slow but works: every session read takes 8 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    keepFacts()
    const slow = () => new Promise<Response>(resolve => { window.setTimeout(() => resolve(confirmed()), 8_000) })
    serve({ [SESSION]: [slow, slow, slow, slow] })
    await openStaffApp('/provider/outreach')
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    await screen.findByText(/No signal. You can keep registering/)
    // Its own check reaches Health ID (8 s), then the hand-back reads the session again (8 s more): the workspace opens,
    // and "No signal" mode is not opened again on the way.
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })
    await waitFor(() => expect(screen.queryByText(/No signal. You can keep registering/)).toBeNull())
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(screen.queryByText(/No signal. You can keep registering/)).toBeNull()
  })
})

describe('start-up as before', () => {
  it('with no facts kept: "Session unavailable"', async () => {
    serve({ [SESSION]: [noNetwork, noNetwork, noNetwork, noNetwork] })
    await openStaffApp('/provider/outreach')
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByText(/No signal. You can keep registering/)).toBeNull()
  })

  it('with facts over 24 hours old: "Session unavailable", and the facts are deleted', async () => {
    keepFacts(NOW - 25 * 60 * 60 * 1000)
    serve({ [SESSION]: [noNetwork, noNetwork, noNetwork, noNetwork] })
    await openStaffApp('/provider/outreach')
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 5000 })).toBeTruthy()
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })

  it('on any other site (EHR, Laboratory, Pharmacy), even with facts in storage: "Session unavailable"', async () => {
    host.outreach = false
    keepFacts()
    serve({ [SESSION]: [noNetwork, noNetwork, noNetwork, noNetwork] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 5000 })).toBeTruthy()
  })

  it('with Health ID unavailable just now (a 5xx): "No signal" mode, not "Session unavailable"', async () => {
    keepFacts()
    const fault = () => json({ code: 'INTERNAL', detail: 'x' }, 500)
    serve({ [SESSION]: [fault, fault, fault, fault] })
    await openStaffApp('/provider/outreach')
    expect(await screen.findByText(/No signal. You can keep registering/, undefined, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Session unavailable' })).toBeNull()
  })

  it('with no facts kept and a 5xx: "Session unavailable", as before', async () => {
    const fault = () => json({ code: 'INTERNAL', detail: 'x' }, 500)
    serve({ [SESSION]: [fault, fault, fault, fault] })
    await openStaffApp('/provider/outreach')
    expect(await screen.findByRole('heading', { name: 'Session unavailable' }, { timeout: 5000 })).toBeTruthy()
  })
})

describe('the facts and the accounts', () => {
  async function staffProvider() {
    const { StaffProvider, useStaff } = await import('../../../../staff/App')
    function Probe() {
      const { state, signOut } = useStaff()
      return <div><output data-testid="status">{state.status}</output><button type="button" onClick={() => void signOut()}>Sign out</button></div>
    }
    render(<MemoryRouter><StaffProvider><Probe /></StaffProvider></MemoryRouter>)
  }
  const group = { id: 'group-1', name: 'Ilorin Health Volunteers' }
  const sessionOf = (id: string, facilities: unknown[] = []) => () => json({ actor: { id, displayName: 'Someone', roles: [], permissions: [], facilities }, expiresAt: '2026-11-30T12:00:00.000Z' })

  it('are kept when the same account\'s session is confirmed at the same outreach group', async () => {
    keepFacts()
    serve({ [SESSION]: [sessionOf('staff-demo-1', [group])] })
    await staffProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(readOutreachSnapshot()).not.toBeNull()
  })

  it('are deleted when the same account\'s confirmed session no longer includes the outreach group', async () => {
    keepFacts()
    serve({ [SESSION]: [sessionOf('staff-demo-1')] })
    await staffProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(readOutreachSnapshot()).toBeNull()
  })

  it('are deleted when another account\'s session is confirmed on this browser', async () => {
    keepFacts()
    serve({ [SESSION]: [sessionOf('staff-someone-else')] })
    await staffProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
    expect(sessionStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })

  it('are deleted on a deliberate sign-out', async () => {
    keepFacts()
    serve({ [SESSION]: [sessionOf('staff-demo-1')], 'POST /api/v1/auth/logout': [() => new Response(null, { status: 204 })] })
    await staffProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'))
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
    expect(sessionStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })
})
