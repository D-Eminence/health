import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/*
 * A login that works at a hospital and at an outreach group (open sign-up, decision 5) lands back on the group after a
 * reload (the owner's "no hassle" rule, 14 November 2026): the tab keeps the group it chose (sessionStorage,
 * tabMemory.ts) and chooses it again when the session read on a reload opens elsewhere, while the group is still one of
 * the account's. A hospital chosen is not kept, so it opens where Identity says, as before. Fictional data only.
 */
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

class TabChannel extends EventTarget {
  constructor(readonly name: string) { super() }
  postMessage() { /* no other tab here */ }
  close() { /* nothing open */ }
}
beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel); sessionStorage.clear() })

const SESSION = 'GET /api/v1/auth/session'
const FACILITY = 'POST /api/v1/auth/facility'
const LOGOUT = 'POST /api/v1/auth/logout'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const HOSPITAL = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Ilorin General', roles: ['clinician'],
  permissions: ['identity.patient.read'], isPrimary: true }
const GROUP = { id: '0e7c0000-0000-4000-8000-000000000001', membershipId: 'member-2', organizationId: 'org-2', name: 'Ilorin Health Volunteers',
  roles: ['outreach_volunteer'], permissions: ['outreach.registration.read', 'outreach.registration.write'], isPrimary: false }
type Selection = 'selected' | 'default' | undefined
const session = (current: typeof HOSPITAL, facilitySelection: Selection, facilities = [HOSPITAL, GROUP]) => () => json({
  actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Volunteer', roles: current.roles, permissions: [], facilities, facility: current },
  expiresAt: '2026-11-14T18:00:00.000Z', ...(facilitySelection !== undefined ? { facilitySelection } : {}),
})

interface Sent { route: string; body: unknown }
function serve(routes: Record<string, Array<() => Response>>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const next = routes[route]?.shift()
    return next ? next() : json([], 200)
  }))
  return sent
}

async function open(path = '/provider') {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}
/** The page goes and comes back in the same tab: memory is lost, the tab's own storage is not. */
async function reload(routes: Record<string, Array<() => Response>>) {
  cleanup()
  vi.resetModules()
  const sent = serve(routes)
  await open()
  return sent
}
const choices = (sent: Sent[]) => sent.filter(call => call.route === FACILITY).map(call => call.body)

describe('the outreach group chosen in this tab, after a reload', () => {
  it('is chosen again when the reload opens at the hospital, with no question asked', async () => {
    serve({ [SESSION]: [session(HOSPITAL, 'default')], [FACILITY]: [session(GROUP, 'selected')] })
    await open()
    fireEvent.click(await screen.findByRole('radio', { name: 'Ilorin Health Volunteers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull())
    // Kept for this tab only, as an id: never in localStorage.
    expect(Object.values({ ...sessionStorage })).toContain(JSON.stringify(GROUP.id))
    expect(JSON.stringify({ ...localStorage })).not.toContain(GROUP.id)

    // Identity reports the hospital again on the reload (an Identity that keeps no choice, or one made elsewhere).
    const sent = await reload({ [SESSION]: [session(HOSPITAL, 'default')], [FACILITY]: [session(GROUP, 'selected')] })
    await waitFor(() => expect(choices(sent)).toEqual([{ facilityId: GROUP.id }]))
    expect(await screen.findByText(/Working at Ilorin Health Volunteers\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull()
  })

  it('keeps nothing when the hospital is chosen, and opens where Identity says after a reload', async () => {
    serve({ [SESSION]: [session(HOSPITAL, 'default')], [FACILITY]: [session(HOSPITAL, 'selected')] })
    await open()
    fireEvent.click(await screen.findByRole('radio', { name: 'Ilorin General' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Where are you working?' })).toBeNull())
    expect(Object.keys(sessionStorage).filter(key => key.includes('facility:'))).toEqual([])

    const sent = await reload({ [SESSION]: [session(HOSPITAL, 'selected')] })
    expect(await screen.findByText(/Working at Ilorin General\./)).toBeTruthy()
    expect(choices(sent)).toEqual([])
  })

  it('is not chosen again once the group is no longer one of the account’s', async () => {
    sessionStorage.setItem('hid-outreach:facility:staff-1', JSON.stringify(GROUP.id))
    const sent = serve({ [SESSION]: [session(HOSPITAL, 'selected', [HOSPITAL])] })
    await open()
    expect(await screen.findByText(/Working at Ilorin General\./)).toBeTruthy()
    expect(choices(sent)).toEqual([])
  })

  it('is forgotten on sign-out, with everything else outreach kept for this tab', async () => {
    sessionStorage.setItem('hid-outreach:facility:staff-1', JSON.stringify(GROUP.id))
    sessionStorage.setItem('hid-outreach:health-checks:staff-1:x:case-1', JSON.stringify({ changes: { pulseBpm: '80' } }))
    sessionStorage.setItem(`hid-outreach:new-registration:staff-1:${GROUP.id}`, JSON.stringify({ fields: { fullName: 'Kemi Balogun' },
      language: 'en', chosenMethod: 'verbal_read_aloud', until: Date.now() + 60_000 }))
    sessionStorage.setItem('unrelated', 'kept')
    serve({ [SESSION]: [session(GROUP, 'selected')], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    await open()
    fireEvent.click(await screen.findByRole('button', { name: /Sign out/ }))
    await waitFor(() => expect(Object.keys(sessionStorage).filter(key => key.startsWith('hid-outreach:'))).toEqual([]))
    expect(sessionStorage.getItem('unrelated')).toBe('kept')
  })
})
