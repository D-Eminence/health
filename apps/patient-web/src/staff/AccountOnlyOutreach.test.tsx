import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ORGANISER_TERMS_VERSION } from '../outreachTerms'

/**
 * Owner's answer to Q88 (17 Nov 2026): a verified staff login that is not yet part of any facility or outreach group
 * gets an account-only session on outreach. (identity-api), which opens "Start an outreach group" and nothing else.
 * Every other site refuses its sign-in (403 NO_ACTIVE_FACILITY_MEMBERSHIP), and a session with no facility that still
 * arrives there keeps today's "No facility assignment". Every account and facility here is fictional.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); jsdom.reconfigure({ url: servedFrom }) })

/** The portal's other tabs, as BroadcastChannel would connect them. */
class TabChannel extends EventTarget {
  constructor(readonly name: string) { super() }
  postMessage() {}
  close() {}
}
beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel) })

type Answer = () => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const GROUP = { id: 'facility-group-1', membershipId: 'member-group-1', organizationId: 'org-group-1', name: 'Demo Volunteers',
  roles: ['outreach_organiser'], permissions: ['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read'], isPrimary: true }
const actor = (facilities: unknown[] = [], permissions: string[] = []) => ({ kind: 'staff', id: 'staff-1', email: 'new.organiser@example.test',
  displayName: 'Demo Organiser', roles: [], permissions, facilities, ...(facilities[0] ? { facility: facilities[0] } : {}) })
const session = (facilities: unknown[] = [], permissions: string[] = []) =>
  json({ actor: actor(facilities, permissions), expiresAt: '2026-11-30T12:00:00.000Z' })

const AVAILABILITY = 'GET /api/v1/identity/outreach-organisers/for-my-account/availability'
const START = 'POST /api/v1/identity/outreach-organisers/for-my-account'
const FACILITY = 'POST /api/v1/auth/facility'

function serve(routes: Record<string, Answer[]>) {
  const calls: Array<{ route: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    return routes[route]?.shift()?.() ?? json({ items: [], nextCursor: null })
  }))
  return calls
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

async function open(hostname: string, path: string) {
  jsdom.reconfigure({ url: `https://${hostname}${path}` })
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

describe('a staff login with no facility yet (Q88)', () => {
  it.each(['outreach.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com'])(
    'on %s, opens "Start an outreach group" whatever address was asked for, and nothing else', async hostname => {
      const calls = serve({ 'GET /api/v1/auth/session': [() => session()],
        [AVAILABILITY]: [() => json({ open: true, termsVersion: ORGANISER_TERMS_VERSION })] })
      await open(hostname, '/provider/patients')
      expect(await screen.findByRole('heading', { level: 1, name: 'Start an outreach group' }, { timeout: 5000 })).toBeTruthy()
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/start-outreach-group'))
      expect(await screen.findByRole('textbox', { name: /Group name/ })).toBeTruthy()
      expect(screen.getByText('Signed in as Demo Organiser')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
      // No workspace around it: no menu, no other page, and nothing read but the session and whether sign-up is open.
      expect(screen.queryByRole('navigation')).toBeNull()
      expect(screen.queryByText('No facility assignment')).toBeNull()
      expect(document.title).toBe('Start an outreach group · Health ID Provider')
      expect(new Set(calls.map(call => call.route))).toEqual(new Set(['GET /api/v1/auth/session', AVAILABILITY]))
    })

  it('says so when open sign-up is off, as the page does for anyone (the platform control still applies)', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()], [AVAILABILITY]: [() => json({ open: false })] })
    await open('outreach.healthidentitydirectory.com', '/provider/start-outreach-group')
    expect(await screen.findByText('Not open yet', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Group name/ })).toBeNull()
  })

  it('starts the group, chooses it at once, and opens its Outreach workspace', async () => {
    const calls = serve({
      'GET /api/v1/auth/session': [() => session()],
      [AVAILABILITY]: [() => json({ open: true, termsVersion: ORGANISER_TERMS_VERSION })],
      [START]: [() => json({ started: true, organizationId: GROUP.organizationId, facilityId: GROUP.id, membershipId: GROUP.membershipId,
        organiserStatus: 'active', label: 'Organiser' }, 201)],
      [FACILITY]: [() => json({ actor: actor([GROUP]), expiresAt: '2026-11-30T12:00:00.000Z', facilitySelection: 'selected' })],
    })
    await open('outreach.healthidentitydirectory.com', '/provider/start-outreach-group')
    fireEvent.change(await screen.findByRole('textbox', { name: /Group name/ }, { timeout: 5000 }), { target: { value: 'Demo Volunteers' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: '08012345678' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the organiser terms/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start my outreach group' })) })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/outreach'), { timeout: 5000 })
    expect(calls.find(call => call.route === START)?.body).toMatchObject({ groupName: 'Demo Volunteers', phone: '08012345678',
      termsVersion: ORGANISER_TERMS_VERSION, acceptTerms: true })
    expect(calls.find(call => call.route === FACILITY)?.body).toEqual({ facilityId: GROUP.id })
    // Chosen straight from the account-only session: the session is not read again in between.
    const order = calls.map(call => call.route)
    expect(order.slice(order.indexOf(START), order.indexOf(FACILITY) + 1)).toEqual([START, FACILITY])
  })

  it.each(['lab.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com',
    'migrate.healthidentitydirectory.com'])('on %s, opens nothing: today\'s "No facility assignment"', async hostname => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open(hostname, '/provider/start-outreach-group')
    expect(await screen.findByRole('heading', { level: 1, name: 'No facility assignment' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Start an outreach group' })).toBeNull()
  })

  it('keeps today\'s screen for a platform administrator with no facility, even on outreach.', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session([], ['platform.admin.access'])] })
    await open('outreach.healthidentitydirectory.com', '/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'No facility assignment' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Start an outreach group' })).toBeNull()
  })
})
