import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, render, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * OCR-A11Y-09. Opening Document OCR could show a screen with no h1 or no main
 * landmark: Document OCR unavailable (an h2 only), and the workspace's own state
 * screens in front of it (checking the session, session unavailable, no
 * facility assignment, the session check and the session-ended screen), and the
 * page-not-found route. Page-change focus then fell back to the main region,
 * and a screen reader user had no heading to start from. Each is now a main
 * landmark with an h1, and while the workspace is locked only the session
 * check's main is exposed: HTML allows one main without the hidden attribute.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/** The portal's other tabs, as BroadcastChannel would connect them. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage() {}
  close() { TabChannel.open.delete(this) }
}
beforeEach(() => { TabChannel.open.clear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

type Answer = () => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, detail: code }),
  { status, headers: { 'Content-Type': 'application/problem+json' } })
const facility = (permissions: string[]) => ({ id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General',
  roles: ['clinician'], permissions, isPrimary: true })
const session = (facilities = [facility(['identity.patient.read'])]) => json({ actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test',
  displayName: 'Ada Clinician', roles: ['clinician'], permissions: [], facilities, facility: facilities[0] }, expiresAt: '2026-10-12T12:00:00.000Z' })
const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE')

function serve(routes: Record<string, Answer[]>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    return routes[route]?.shift()?.() ?? json({ items: [], nextCursor: null })
  }))
}

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

/** The main landmarks a person can reach: those not hidden, themselves or by an ancestor. */
function shownMains() {
  return screen.queryAllByRole('main', { hidden: true }).filter(main => !main.closest('[hidden]'))
}

/** The one exposed main landmark, holding an h1 named `name`. */
async function expectScreen(name: string | RegExp) {
  const heading = await screen.findByRole('heading', { level: 1, name }, { timeout: 3000 })
  const mains = shownMains()
  expect(mains).toHaveLength(1)
  expect(mains[0]!.contains(heading)).toBe(true)
}

describe('OCR-A11Y-09: opening Document OCR, every screen has a main landmark and an h1', () => {
  it('Document OCR unavailable, for a role without OCR job read', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/ocr')
    await expectScreen('Document OCR unavailable')
  })

  it('checking the session: a main region holding the status', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ 'GET /api/v1/auth/session': [() => new Promise<Response>(resolve => { answer = resolve })] })
    await open('/provider/ocr')
    const status = await screen.findByText('Checking your secure session…')
    expect(within(screen.getByRole('main')).getByRole('status')).toBe(status.closest('[role="status"]'))
    await act(async () => { answer(session()) })
  })

  it('session unavailable', async () => {
    serve({ 'GET /api/v1/auth/session': [unavailable, unavailable, unavailable, unavailable] })
    await open('/provider/ocr')
    await expectScreen('Session unavailable')
  })

  it('no facility assignment', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session([])] })
    await open('/provider/ocr')
    await expectScreen('No facility assignment')
  })

  it('a provider page that does not exist', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/ocr-jobs')
    await expectScreen('Page not found')
  })

  it('the session check: its main is the only one exposed while the workspace is locked', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ 'GET /api/v1/auth/session': [() => session([facility(['ocr.job.read'])]), () => new Promise<Response>(resolve => { answer = resolve })] })
    await open('/provider/ocr')
    await screen.findByRole('heading', { level: 1, name: 'Document OCR' })
    fromAnotherTab()
    await expectScreen('Checking your session…')
    // HTML's rule is on the attribute itself, which a hidden ancestor does not give: one main without it.
    expect(document.querySelectorAll('main:not([hidden])')).toHaveLength(1)
    await act(async () => { answer(session([facility(['ocr.job.read'])])) })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Checking your session…' })).toBeNull())
    expect(shownMains()).toHaveLength(1)
    expect(document.querySelectorAll('main:not([hidden])')).toHaveLength(1)
    expect(within(shownMains()[0]!).getByRole('heading', { level: 1, name: 'Document OCR' })).toBeTruthy()
  })

  it('the session-ended screen', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session([facility(['ocr.job.read'])]), () => problem(401, 'AUTHENTICATION_REQUIRED')],
      'POST /api/v1/auth/refresh': [() => problem(401, 'AUTHENTICATION_REQUIRED')] })
    await open('/provider/ocr')
    await screen.findByRole('heading', { level: 1, name: 'Document OCR' })
    fromAnotherTab()
    await expectScreen('Your session has ended')
  })
})
