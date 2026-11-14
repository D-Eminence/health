import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { PendingRegistration } from '../ehr-blue/departments/outreach/offlineQueue'

// Today's classic workspace: the lock is the provider's (App.tsx Gate), the same around the blue EHR.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

/**
 * An outreach volunteer registers people on a phone with patchy signal (owner, 13 November 2026). Back on the page after
 * the screen went off, a session check that gets no answer for want of a signal keeps the Outreach workspace open, with
 * a calm line at the top, and is made again by itself; a real answer that the session ended still ends it. Every other
 * workspace is locked as before. Signing out asks first while registrations wait on the phone; a session the server
 * ended keeps them for the same account, and no one else sees them. Every account and person here is fictional.
 */

const BANNER = 'No signal. You can keep registering. Your work stays on this phone.'
const UNCONFIRMED = 'We could not confirm your session'
const SESSION_ENDED = 'Your session has ended'
const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'
const CASES = 'POST /api/v1/outreach/registration-cases'

type Answer = () => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })
/** No signal: the request never reaches Health ID (the browser's own words). */
const noSignal: Answer = () => { throw new TypeError('Failed to fetch') }

const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read', 'outreach.case.read', 'outreach.case.write']
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Ilorin Outreach (fictional)', roles: ['clinician'], permissions: PERMISSIONS, isPrimary: true }
const sessionOf = (id = 'staff-1', displayName = 'Ada Volunteer') => () => json({
  actor: { kind: 'staff', id, email: `${id}@example.test`, displayName, roles: ['clinician'], permissions: [], facilities: [facility], facility },
  expiresAt: '2026-11-14T18:00:00.000Z',
})

/** Answers each `METHOD /path` from its queue, in order; anything else is a 418. Calls are recorded. */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return calls
}

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
const where = () => screen.getByTestId('where').textContent

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy())
}

let online = true
let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  online = true
  visibility = 'visible'
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(async () => {
  cleanup()
  const queue = await import('../ehr-blue/departments/outreach/offlineQueue')
  queue.setOutreachQueueStore(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** The screen goes off for `minutes`, then the volunteer looks again. */
function screenOffFor(minutes: number) {
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
  act(() => { vi.advanceTimersByTime(minutes * 60_000) })
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
}

/** The workspace is open: shown, not inert, and its own Sign out reachable. */
function expectWorkspaceOpen() {
  const app = document.querySelector('.staff-app')
  expect(app).toBeTruthy()
  expect(app!.closest('[hidden]')).toBeNull()
  expect(app!.closest('[inert]')).toBeNull()
  expect(screen.queryByRole('heading', { name: UNCONFIRMED })).toBeNull()
}
const banner = () => screen.queryByText(BANNER)
/** Lets what is already due run, and the page's effects attach. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
/** The browser says it is back online. */
async function backOnline() {
  await settle()
  online = true
  await act(async () => { window.dispatchEvent(new Event('online')) })
}

async function queueWith(entries: Array<Partial<PendingRegistration> & { localCommandId: string; accountId: string }>) {
  const queue = await import('../ehr-blue/departments/outreach/offlineQueue')
  const store = queue.memoryQueueStore()
  for (const entry of entries) {
    await store.put({ temporaryPatientId: `tmp_${entry.localCommandId}`, facilityId: facility.id, savedAt: new Date().toISOString(), state: 'waiting',
      input: { fullName: 'Kemi Balogun (fictional)', sex: 'female', ageYears: 30 }, ...entry })
  }
  queue.setOutreachQueueStore(store)
  return { store, queue }
}

describe('an outreach workspace back on screen with no signal', () => {
  // Health ID Outreach's own site: the only one where no signal keeps the workspace open.
  const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
  const servedFrom = window.location.href
  beforeEach(() => { jsdom.reconfigure({ url: 'https://outreach.healthidentitydirectory.com/provider/outreach' }) })
  afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

  it('stays open with the calm line after five minutes away, instead of hiding as "could not confirm"', async () => {
    serve({ [SESSION]: [sessionOf(), noSignal, noSignal, noSignal] })
    await open('/provider/outreach')
    expect(where()).toBe('/provider/outreach')

    screenOffFor(5)

    expect(await screen.findByText(BANNER)).toBeTruthy()
    expect(screen.getByText(BANNER).getAttribute('role')).toBe('status')
    expectWorkspaceOpen()
  })

  it('asks nothing and hides nothing while the phone knows it is offline, and asks again on the online event', async () => {
    const calls = serve({ [SESSION]: [sessionOf(), sessionOf()] })
    await open('/provider/outreach')
    online = false

    screenOffFor(5)

    expect(await screen.findByText(BANNER)).toBeTruthy()
    expectWorkspaceOpen()
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)
    // No timer runs while the phone says it is offline.
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(calls.filter(call => call === SESSION)).toHaveLength(1)

    // Signal back: the browser says so, the session is checked, and the line goes.
    await backOnline()
    await waitFor(() => expect(banner()).toBeNull())
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)
    expectWorkspaceOpen()
  })

  it('checks again every 30 seconds while unanswered, without hiding the workspace, and clears the line once answered', async () => {
    const calls = serve({ [SESSION]: [sessionOf(), noSignal, noSignal, sessionOf()] })
    await open('/provider/outreach')
    screenOffFor(5)
    expect(await screen.findByText(BANNER)).toBeTruthy()
    expect(calls.filter(call => call === SESSION)).toHaveLength(2)

    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await waitFor(() => expect(calls.filter(call => call === SESSION)).toHaveLength(3))
    expect(banner()).toBeTruthy()
    expectWorkspaceOpen()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await waitFor(() => expect(banner()).toBeNull())
    expect(calls.filter(call => call === SESSION)).toHaveLength(4)
    expectWorkspaceOpen()
  })

  it('still ends the session when Health ID answers that it ended', async () => {
    serve({
      [SESSION]: [sessionOf(), noSignal, () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')],
      [REFRESH]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Refresh session is no longer active')],
    })
    await open('/provider/outreach')
    screenOffFor(5)
    expect(await screen.findByText(BANNER)).toBeTruthy()

    await backOnline()

    expect(await screen.findByRole('heading', { name: SESSION_ENDED })).toBeTruthy()
    expect(banner()).toBeNull()
  })

  it('is the outreach. site only, wherever on it; never the Outreach pages on another site', async () => {
    const { outreachWorkspaceShown } = await import('./App')
    expect(outreachWorkspaceShown('outreach.healthidentitydirectory.com', '/provider/patients')).toBe(true)
    expect(outreachWorkspaceShown('outreach.staging.healthidentitydirectory.com', '/provider')).toBe(true)
    expect(outreachWorkspaceShown('ehr.healthidentitydirectory.com', '/provider/outreach')).toBe(false)
    expect(outreachWorkspaceShown('ehr.healthidentitydirectory.com', '/provider/outreach/campaign-1')).toBe(false)
    expect(outreachWorkspaceShown('ehr.healthidentitydirectory.com', '/provider/clinical')).toBe(false)
    expect(outreachWorkspaceShown('lab.healthidentitydirectory.com', '/provider/laboratory')).toBe(false)
    expect(outreachWorkspaceShown('ehr.healthidentitydirectory.com', '/provider/outreach-terms')).toBe(false)
  })
})

describe('every other workspace with no signal, as today', () => {
  it('locks the EHR site\'s own Outreach page as before when it comes back with no signal', async () => {
    serve({ [SESSION]: [sessionOf(), noSignal, noSignal, noSignal] })
    await open('/provider/outreach')
    online = false

    screenOffFor(5)

    expect(await screen.findByRole('heading', { name: UNCONFIRMED })).toBeTruthy()
    expect(document.querySelector('.staff-app')?.closest('[hidden]')).toBeTruthy()
    expect(banner()).toBeNull()
  })

  it('hides the EHR workspace as "We could not confirm your session" with only Try again', async () => {
    serve({ [SESSION]: [sessionOf(), noSignal, noSignal, noSignal] })
    await open('/provider/clinical')

    screenOffFor(5)

    expect(await screen.findByRole('heading', { name: UNCONFIRMED })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.querySelector('.staff-app')?.closest('[hidden]')).toBeTruthy()
    expect(banner()).toBeNull()
  })

  it('hides the EHR workspace even while the phone knows it is offline, and does not open it on the online event', async () => {
    serve({ [SESSION]: [sessionOf(), noSignal, noSignal, noSignal] })
    await open('/provider')
    online = false

    screenOffFor(5)
    expect(await screen.findByRole('heading', { name: UNCONFIRMED })).toBeTruthy()

    await backOnline()
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByRole('heading', { name: UNCONFIRMED })).toBeTruthy()
    expect(document.querySelector('.staff-app')?.closest('[hidden]')).toBeTruthy()
    expect(banner()).toBeNull()
  })
})

describe('signing out while registrations wait on this phone', () => {
  it('asks first, with Send now as the default, and signs out once they are sent', async () => {
    const calls = serve({
      [SESSION]: [sessionOf()],
      [CASES]: [() => json({ caseId: 'case-1' }, 201), () => json({ caseId: 'case-2' }, 201)],
      [LOGOUT]: [() => new Response(null, { status: 204 })],
    })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }, { localCommandId: 'c-2', accountId: 'staff-1' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    expect(within(prompt).getByText('2 registrations are saved on this phone and not sent yet. Send them now, or they will be deleted when you sign out.')).toBeTruthy()
    const send = within(prompt).getByRole('button', { name: 'Send now' })
    expect(document.activeElement).toBe(send)
    expect(within(prompt).getByRole('button', { name: 'Sign out and delete them' })).toBeTruthy()
    // Nothing is signed out, or deleted, before the answer.
    expect(calls).not.toContain(LOGOUT)
    expect(await store.list()).toHaveLength(2)

    fireEvent.click(send)

    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(calls.filter(call => call === CASES)).toHaveLength(2)
    expect(calls).toContain(LOGOUT)
    expect(await store.list()).toHaveLength(0)
  })

  it('stays signed in with them kept when Send now finds no signal', async () => {
    const calls = serve({ [SESSION]: [sessionOf()], [CASES]: [noSignal] })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    expect(within(prompt).getByText('1 registration is saved on this phone and not sent yet. Send it now, or it will be deleted when you sign out.')).toBeTruthy()
    fireEvent.click(within(prompt).getByRole('button', { name: 'Send now' }))

    expect(await within(prompt).findByText('Could not send them yet. Try again when you have signal.')).toBeTruthy()
    expect(calls).not.toContain(LOGOUT)
    expect(where()).toBe('/provider/outreach')
    expect(await store.list()).toHaveLength(1)
  })

  it('signs out and deletes only this account\'s when asked to', async () => {
    const calls = serve({ [SESSION]: [sessionOf()], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }, { localCommandId: 'other-1', accountId: 'staff-2' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Sign out and delete them' }))

    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(calls).not.toContain(CASES)
    expect((await store.list()).map(entry => entry.localCommandId)).toEqual(['other-1'])
  })

  it('has a visible "Stay signed in" that keeps everything, and moves focus to it when Send now finds no signal (finding 8)', async () => {
    const calls = serve({ [SESSION]: [sessionOf()], [CASES]: [noSignal] })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Send now' }))
    expect(await within(prompt).findByText('Could not send them yet. Try again when you have signal.')).toBeTruthy()
    const stay = within(prompt).getByRole('button', { name: 'Stay signed in' })
    expect(document.activeElement).toBe(stay)

    fireEvent.click(stay)

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).not.toContain(LOGOUT)
    expect(where()).toBe('/provider/outreach')
    expectWorkspaceOpen()
    expect(await store.list()).toHaveLength(1)
  })

  it('still stays signed in on Escape', async () => {
    const calls = serve({ [SESSION]: [sessionOf()] })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    fireEvent.keyDown(prompt, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).not.toContain(LOGOUT)
    expect(await store.list()).toHaveLength(1)
  })

  it('does not sign out by itself when Health ID refuses one on Send now: it names it, and deletes only what was asked about (finding 0)', async () => {
    const calls = serve({
      [SESSION]: [sessionOf()],
      [CASES]: [() => json({ caseId: 'case-1' }, 201),
        () => problem(409, 'OUTREACH_CAMPAIGN_CLOSED', 'The campaign is closed')],
      [LOGOUT]: [() => new Response(null, { status: 204 })],
    })
    const earlier = new Date(Date.now() - 60_000).toISOString()
    const { store } = await queueWith([
      { localCommandId: 'c-1', accountId: 'staff-1', savedAt: earlier, input: { fullName: 'Kemi Balogun (fictional)', sex: 'female', ageYears: 30 } },
      { localCommandId: 'c-2', accountId: 'staff-1', input: { fullName: 'Tunde Ade (fictional)', sex: 'male', ageYears: 52 } },
    ])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Send now' }))

    // One went; Health ID said no to the other. The volunteer is still signed in, and told who and why.
    expect(await within(prompt).findByText('Health ID did not accept 1 registration. It will be deleted when you sign out. Write the details on paper or register the person again first:')).toBeTruthy()
    const refused = (await store.list()).find(entry => entry.localCommandId === 'c-2')!
    expect(refused.state).toBe('refused')
    expect(within(prompt).getByText('Tunde Ade (fictional)')).toBeTruthy()
    expect(within(prompt).getByText(new RegExp(refused.refusal!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy()
    expect(within(prompt).queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(document.activeElement).toBe(within(prompt).getByRole('button', { name: 'Stay signed in' }))
    expect(calls).not.toContain(LOGOUT)
    expect(where()).toBe('/provider/outreach')

    // Saved while the question shows (another tab, say): nobody was asked about it, so it is kept.
    await store.put({ localCommandId: 'c-3', temporaryPatientId: 'tmp_c-3', accountId: 'staff-1', facilityId: facility.id, savedAt: new Date().toISOString(),
      state: 'waiting', input: { fullName: 'Later Person (fictional)', sex: 'female', ageYears: 22 } })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Sign out and delete them' }))

    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect((await store.list()).map(entry => entry.localCommandId)).toEqual(['c-3'])
  })

  it('asks about registrations Health ID refused even when none wait, rather than deleting them unasked', async () => {
    const calls = serve({ [SESSION]: [sessionOf()], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    const { store } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1', state: 'refused', refusal: 'This campaign is finished.' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    expect(within(prompt).getByText(/Health ID did not accept 1 registration/)).toBeTruthy()
    expect(within(prompt).getByText(': This campaign is finished.', { exact: false })).toBeTruthy()
    expect(within(prompt).queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(document.activeElement).toBe(within(prompt).getByRole('button', { name: 'Stay signed in' }))
    expect(calls).not.toContain(LOGOUT)

    fireEvent.click(within(prompt).getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await store.list()).toHaveLength(1)
  })

  it('asks before deleting health checks typed and not saved (finding 3)', async () => {
    const calls = serve({ [SESSION]: [sessionOf(), sessionOf()], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    await queueWith([])
    const draft = 'hid-outreach:health-checks:staff-1:facility-1:case-9'
    sessionStorage.setItem(draft, JSON.stringify({ changes: { systolic: '150' }, unsure: null, attempt: null }))
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const prompt = await screen.findByRole('alertdialog', { name: 'Sign out?' })
    expect(within(prompt).getByText('You have health checks that aren’t saved. They will be deleted when you sign out. Stay signed in to save them first.')).toBeTruthy()
    expect(calls).not.toContain(LOGOUT)
    fireEvent.click(within(prompt).getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(sessionStorage.getItem(draft)).not.toBeNull()

    // Asked again and agreed: they go with the sign-out.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Sign out?' })).getByRole('button', { name: 'Sign out and delete them' }))
    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(sessionStorage.getItem(draft)).toBeNull()
  })

  it('signs out at once, asking nothing, when none wait', async () => {
    serve({ [SESSION]: [sessionOf()], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    await queueWith([{ localCommandId: 'other-1', accountId: 'staff-2' }])
    await open('/provider/outreach')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('a session Health ID ended while registrations wait', () => {
  it('keeps them on the phone for the same account to send after signing in again; another account never sees or sends them', async () => {
    const calls = serve({
      [SESSION]: [sessionOf(), () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')],
      [REFRESH]: [() => problem(401, 'AUTHENTICATION_REQUIRED', 'Refresh session is no longer active')],
    })
    const { store, queue } = await queueWith([{ localCommandId: 'c-1', accountId: 'staff-1' }])
    await open('/provider/outreach')

    screenOffFor(5)
    expect(await screen.findByRole('heading', { name: SESSION_ENDED })).toBeTruthy()

    // Nothing was deleted, and nothing was sent.
    expect((await store.list()).map(entry => entry.localCommandId)).toEqual(['c-1'])
    expect(calls).not.toContain(CASES)
    // Another person signed in on this phone: none of it is theirs to see or send.
    expect(await queue.waitingOutreachEntriesFor('staff-2')).toBe(0)
    expect(await queue.sendWaitingOutreachEntriesFor('staff-2')).toBe(0)
    expect(calls).not.toContain(CASES)
    expect(await store.list()).toHaveLength(1)
    // The same volunteer again: theirs still wait, to be sent.
    expect(await queue.waitingOutreachEntriesFor('staff-1')).toBe(1)
  })
})

