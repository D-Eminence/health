import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { parse } from '../../cssRules'
import {
  DEMO_HOSPITAL, LAB_WORK, REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where,
  withFramePages,
} from './blueHarness'

/**
 * What the blue EHR must get right before it opens for every clinic: design-only entries only at the demo facilities,
 * the classic EHR choice gone with the session that made it, today's no-permission sentence and refusals in today's
 * words, and the classic EHR keeping today's own pages. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })

/** The blue EHR at every facility: the clinic switch on, and both page sets present (as pageSets.ts lists them). */
function switchedOn() {
  vi.doMock('../../../ehr-blue/pageSets', () => ({
    PAGE_FILES: ['./clinical/pages.ts', './departments/pages.ts', './frame/pages.ts', './home/pages.ts'],
  }))
  vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
}

async function chooseClassic() {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use the classic EHR' }))
  expect(await screen.findByRole('complementary', { name: 'Provider navigation' })).toBeDefined()
}

describe('1. design-only entries are only at the demo facilities', () => {
  const DESIGN = ['Choose workspace', 'What’s left', 'Design tour', 'Facility review']

  it('leaves the design review, the tour and Facility review out of a clinic\'s sidebar and search', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write'])
    const annex = facility('f0000000-0000-4000-8000-000000000002', 'Riverside Annex (fictional)', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(riverside, [riverside, annex])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    for (const name of DESIGN) expect(within(nav()).queryByRole('link', { name })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: 'Design review' })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: 'Design tour' })).toBeNull()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search Health ID' })
    for (const term of ['Design', 'What’s left', 'Facility review', 'Choose workspace']) {
      fireEvent.change(within(search).getByRole('searchbox', { name: 'Search work areas' }), { target: { value: term } })
      expect(within(search).queryAllByRole('link')).toEqual([])
    }
    fireEvent.keyDown(document, { key: 'Escape' })

    // A sample dashboard does not lead there either.
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Platform Super Admin' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Platform Super Admin' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Open Facility review →' })).toBeNull()

    // Switch facility still opens Choose your workspace.
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
  })

  it.each(['/provider/whats-left', '/provider/tour', '/provider/tour/sign-in/1', '/provider/platform'])(
    'refuses %s at a clinic', async path => {
      switchedOn()
      const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', [])
      serve({ [SESSION]: [sessionAt(riverside, [riverside])] })
      await openStaffApp(path)
      expect(await screen.findByText(/is not open to you here$/)).toBeDefined()
    })

  it('keeps them at a demo facility', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    for (const name of DESIGN) expect(within(nav()).getByRole('link', { name })).toBeDefined()
  })
})

describe('2. the classic EHR choice ends with the session that made it', () => {
  it('opens the blue EHR for whoever signs in after a session ended without Sign out', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({
      [SESSION]: [sessionAt(demo, [demo]), ended, ...many(sessionAt(demo, [demo]))],
      'POST /api/v1/auth/refresh': [ended],
      'POST /api/v1/auth/login': [sessionAt(demo, [demo])],
      [REQUESTS]: many(() => json([])),
    })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    await chooseClassic()

    const { reportStaffSessionEnded } = await import('../../../staff/session')
    act(() => reportStaffSessionEnded())
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in again' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'next.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fictional passphrase for tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
    expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
  })
})

describe('3. Home says what today\'s Overview says about clinical modules', () => {
  const SENTENCE = 'Your active facility has no clinical module permissions. Ask an administrator to review your assignment.'

  it('tells an administrator with only audit and billing that no clinical module is open', async () => {
    const admin = facility(DEMO_HOSPITAL, 'Demo Hospital', ['audit.read', 'billing.subscription.read'], ['org_admin'])
    serve({ [SESSION]: [sessionAt(admin, [admin])] })
    await openStaffApp('/provider')
    expect(await screen.findByText(SENTENCE)).toBeDefined()
  })

  it('says nothing of it to a member who holds one', async () => {
    const reader = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    serve({ [SESSION]: [sessionAt(reader, [reader])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    expect(screen.queryByText(SENTENCE)).toBeNull()
  })
})

describe('4. a live stand-in opened without its permission refuses in today\'s words', () => {
  it('shows today\'s Laboratory refusal, and reads no laboratory work', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [LAB_WORK]: many(() => json({ items: [] })) })
    await openStaffApp('/provider/laboratory')
    expect(await screen.findByRole('heading', { level: 1, name: 'Laboratory unavailable' })).toBeDefined()
    expect(screen.getByText('This facility membership needs lab work-item read permission.')).toBeDefined()
    expect(screen.queryByText(/is not open to you here$/)).toBeNull()
    // Still not offered in the sidebar.
    expect(within(nav()).queryByRole('link', { name: 'Laboratory' })).toBeNull()
    expect(sent.some(call => call.route === LAB_WORK)).toBe(false)
  })

  it('still refuses in the frame\'s words for a blue page that replaced its stand-in', async () => {
    withFramePages(() => [{ path: 'laboratory/*', group: 'Diagnostics', label: 'Laboratory', status: 'live',
      permission: 'lab.work-item.read', element: <p>Fictional blue laboratory</p> }])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/laboratory')
    expect(await screen.findByText('Laboratory is not open to you here')).toBeDefined()
    expect(screen.queryByText('Fictional blue laboratory')).toBeNull()
  })
})

describe('5. "Use the classic EHR" keeps a page today\'s sidebar lists', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('stays on Staff at a facility that signed itself up', async () => {
    const own = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin']),
      selfService: { review: 'approved', organizationType: 'clinic' } }
    serve({ [SESSION]: [sessionAt(own as ReturnType<typeof facility>, [own as ReturnType<typeof facility>])] })
    await openStaffApp('/provider/staff')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await chooseClassic()
    expect(where()).toBe('/provider/staff')
  })

  it('opens the Overview from Staff where today does not list it', async () => {
    const governed = facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'])
    serve({ [SESSION]: [sessionAt(governed, [governed])] })
    await openStaffApp('/provider/staff')
    await screen.findByRole('heading', { level: 1, name: 'Staff & access' })
    await chooseClassic()
    expect(where()).toBe('/provider')
  })
})

describe('6. cosmetic', () => {
  it('spaces the error page\'s heading as a page\'s: the gap only, not its margin as well', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(resolve(here, '../../../ehr-blue/frame/frame.css'), 'utf8')
    const rule = parse(css).find(candidate => candidate.selectors.includes('.hid-ehr .hid-ehr-blue-failed > .hid-ehr-page-heading'))
    expect(rule?.body).toMatch(/margin-bottom:\s*0/)
  })

  it('gives purchase requests purchasing reasons, not clinical ones', async () => {
    const { sampleRecords } = await import('../../../ehr-blue/frame/sample/store')
    const reasons = sampleRecords('procurement').map(record => String(record.fields.reason))
    expect(reasons).toEqual(['Below the reorder level', 'Monthly restock', 'New ward opening (fictional)'])
    for (const clinical of ['Review of results', 'Medication review', 'Antenatal review']) expect(reasons).not.toContain(clinical)
  })

  it.each([
    ['/provider/insurance/policies', '/provider/policies', 'Policies'],
    ['/provider/supply/procurement', '/provider/procurement', 'Procurement'],
  ])('sends an old address, %s, to %s', async (old, now, heading) => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(old)
    await waitFor(() => expect(where()).toBe(now))
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeDefined()
  })

  it('keeps a record\'s id when it moves', async () => {
    const { sampleRecords } = await import('../../../ehr-blue/frame/sample/store')
    const record = sampleRecords('procurement')[0]!
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(`/provider/supply/procurement/${record.id}`)
    await waitFor(() => expect(where()).toBe(`/provider/procurement/${record.id}`))
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(screen.queryByRole('heading', { level: 1, name: 'Record not found' })).toBeNull()
  })
})
