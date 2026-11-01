import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, render, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * PEHR-13. The provider's state screens had no main landmark (loading, session
 * unavailable, no facility assignment, the session check and the session-ended
 * screen) or no h1 (session unavailable, no facility assignment, a page the
 * role cannot use, and a page that does not exist), so page-change focus fell
 * back to the main region and a screen reader user had no heading to start
 * from. Each now has both, and while the workspace is locked only the check's
 * main is exposed: HTML allows one main without the hidden attribute.
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
const LAGOS = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['clinician'],
  permissions: ['identity.patient.read'], isPrimary: true }
const session = (facilities = [LAGOS]) => json({ actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities, facility: facilities[0] }, expiresAt: '2026-10-12T12:00:00.000Z' })
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

describe('PEHR-13: every provider state screen has a main landmark and an h1', () => {
  it('checking the session: a main region holding the status', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ 'GET /api/v1/auth/session': [() => new Promise<Response>(resolve => { answer = resolve })] })
    await open('/provider')
    const status = await screen.findByText('Checking your secure session…')
    expect(within(screen.getByRole('main')).getByRole('status')).toBe(status.closest('[role="status"]'))
    await act(async () => { answer(session()) })
  })

  it('checking the session: an h1 in that main region', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ 'GET /api/v1/auth/session': [() => new Promise<Response>(resolve => { answer = resolve })] })
    await open('/provider')
    await expectScreen(/Checking your secure session/)
    await act(async () => { answer(session()) })
  })

  it('session unavailable', async () => {
    serve({ 'GET /api/v1/auth/session': [unavailable, unavailable, unavailable, unavailable] })
    await open('/provider')
    await expectScreen('Session unavailable')
  })

  it('no facility assignment', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session([])] })
    await open('/provider')
    await expectScreen('No facility assignment')
  })

  it('a page the role cannot use', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/laboratory')
    await expectScreen('Laboratory unavailable')
  })

  it.each([
    ['/provider/pharmacy', 'Pharmacy unavailable'],
    ['/provider/ocr', 'Document OCR unavailable'],
    // Health ID Migrate leads only to Document OCR, closed at launch (no role holds ocr.* since hid-system 0091).
    ['/provider/migrate', 'Migration workspace unavailable'],
    ['/provider/outreach', 'Outreach unavailable'],
    ['/provider/registration', 'You can’t register patients here'],
    ['/provider/audit', 'Audit access unavailable'],
  ])('%s without its permission', async (path, name) => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open(path)
    await expectScreen(name)
  })

  it('a page that does not exist', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/nope')
    await expectScreen('Page not found')
  })

  it('the session check: its main is the only one exposed while the workspace is locked', async () => {
    let answer: (response: Response) => void = () => {}
    serve({ 'GET /api/v1/auth/session': [() => session(), () => new Promise<Response>(resolve => { answer = resolve })] })
    await open('/provider')
    await screen.findByRole('heading', { level: 1, name: /Good to see you/ })
    fromAnotherTab()
    await expectScreen('Checking your session…')
    // The workspace's own main stays mounted, hidden.
    expect(screen.getAllByRole('main', { hidden: true })).toHaveLength(2)
    await act(async () => { answer(session()) })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Checking your session…' })).toBeNull())
    expect(shownMains()).toHaveLength(1)
    expect(shownMains()[0]!.hasAttribute('hidden')).toBe(false)
  })

  it('the session-ended screen', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session(), () => problem(401, 'AUTHENTICATION_REQUIRED')],
      'POST /api/v1/auth/refresh': [() => problem(401, 'AUTHENTICATION_REQUIRED')] })
    await open('/provider')
    await screen.findByRole('heading', { level: 1, name: /Good to see you/ })
    fromAnotherTab()
    await expectScreen('Your session has ended')
  })
})

/*
 * The Laboratory's and Document OCR's refusals (and Health ID Migrate's, which leads only to Document OCR) named the
 * permission they lack. Screens name no permission (the owner's rule), so they say in plain words what the role doesn't
 * include, as the blue pages do; before a facility is chosen there is no role there yet, so they ask for one.
 */
describe('the Laboratory and Document OCR refusals name no permission', () => {
  const PERMISSION_WORDS = /permission|membership|work-item|OCR job read|lab\.work-item\.read|ocr\.job\.read/i
  const LAB = 'Your role at this facility doesn’t include the lab’s work list and results. Ask your facility administrator.'
  const OCR = 'Your role at this facility doesn’t include turning scanned documents into records. Ask your facility administrator.'
  const PAGES = [
    ['/provider/laboratory', 'Laboratory unavailable', LAB],
    ['/provider/ocr', 'Document OCR unavailable', OCR],
    ['/provider/migrate', 'Migration workspace unavailable', OCR],
  ] as const

  it.each(PAGES)('%s, for a role without it, says so plainly', async (path, title, sentence) => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open(path)
    const heading = await screen.findByRole('heading', { level: 1, name: title }, { timeout: 3000 })
    expect(heading.parentElement?.textContent).toBe(`${title}${sentence}`)
    expect(heading.parentElement?.textContent).not.toMatch(PERMISSION_WORDS)
  })

  it.each(PAGES)('%s, before a facility is chosen, asks for one', async (path, title) => {
    const ABUJA = { ...LAGOS, id: 'facility-2', membershipId: 'member-2', name: 'Abuja Clinic', isPrimary: false }
    serve({ 'GET /api/v1/auth/session': [() => json({ actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test',
      displayName: 'Ada Clinician', roles: ['clinician'], permissions: [], facilities: [LAGOS, ABUJA] },
    expiresAt: '2026-10-12T12:00:00.000Z' })] })
    await open(path)
    const heading = await screen.findByRole('heading', { level: 1, name: title }, { timeout: 3000 })
    expect(heading.parentElement?.textContent).toBe(`${title}Choose a facility under “Working at” first.`)
    expect(screen.getByLabelText('Working at')).toBeDefined()
  })
})
