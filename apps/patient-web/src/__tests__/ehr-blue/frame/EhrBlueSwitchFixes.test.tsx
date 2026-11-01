import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { parse } from '../../cssRules'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import {
  DEMO_HOSPITAL, LAB_WORK, REAL_FACILITY, REQUESTS, SESSION, accountButton, facility, homeHeading, json, openStaffApp, problem, serve, sessionAt,
  switchFacilityTo, where, withFramePages,
} from './blueHarness'

/**
 * What the blue EHR must get right before it opens for every clinic: design-only entries only at the demo facilities,
 * the next sign-in opening the blue EHR, today's no-permission sentence and refusals in today's words, and no way back
 * to the classic EHR, which is gone. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The clinic switch as it ships, unless a test turns it on (switchedOn): a vi.doMock outlives the test that made it.
beforeEach(() => { withFramePages(); vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false })) })
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

/** The classic EHR was removed (one EHR for every facility): the account menu no longer offers it. */
function offersNoClassic() {
  fireEvent.click(accountButton())
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Use the classic EHR' })).toBeNull()
  expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
}

describe('1. design-only entries are only at the demo facilities', () => {
  // Choose workspace is the live facility switch, not one of these (EhrBlueSwitchReview.test.tsx).
  const DESIGN = ['What’s left', 'Design tour', 'Facility review']

  it('leaves the design review, the tour and Facility review out of a clinic\'s sidebar and search', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write'])
    const annex = facility('f0000000-0000-4000-8000-000000000002', 'Riverside Annex (fictional)', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(riverside, [riverside, annex])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    for (const name of DESIGN) expect(within(nav()).queryByRole('link', { name })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: 'Design review' })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: 'Design tour' })).toBeNull()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search' })
    for (const term of ['Design', 'What’s left', 'Facility review']) {
      fireEvent.change(within(search).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: term } })
      expect(within(search).queryAllByRole('link')).toEqual([])
    }
    fireEvent.keyDown(document, { key: 'Escape' })

    // No sample dashboard leads there either: a clinic is offered none (EhrBlueSwitchReview.test.tsx).
    fireEvent.click(accountButton())
    expect(screen.queryByRole('button', { name: 'Platform Super Admin' })).toBeNull()

    // The facility switcher still opens Switch facility.
    switchFacilityTo('Riverside Teaching Hospital (fictional)', 'Riverside Annex (fictional)')
    expect(await screen.findByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
  })

  it.each([
    ['/provider/whats-left', 'What’s left'], ['/provider/tour', 'Design tour'],
    ['/provider/tour/sign-in/1', 'Sign in with a sign-in code'], ['/provider/platform', 'Facility review'],
  ])('refuses %s at a clinic, saying it is the demo\'s, not asking for an administrator no role has', async (path, label) => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', [])
    serve({ [SESSION]: [sessionAt(riverside, [riverside])] })
    await openStaffApp(path)
    expect(await screen.findByText(`${label} is part of the Health ID demo only`)).toBeDefined()
    expect(screen.getByText('It is not available at Riverside Teaching Hospital (fictional).')).toBeDefined()
    expect(screen.queryByText(/Ask your facility administrator/)).toBeNull()
  })

  // Design tools are no longer listed even at a demo facility (only working screens are): they stay by address.
  it.each([
    ['/provider/whats-left', 'What’s left'], ['/provider/tour', 'Design tour'],
  ])('keeps %s by address at a demo facility, unlisted', async (path, heading) => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeDefined()
    expect(screen.queryByText(/is part of the Health ID demo only/)).toBeNull()
    for (const name of DESIGN) expect(within(nav()).queryByRole('link', { name })).toBeNull()
  })

  // A sample, so the design's roles decide who opens it (sampleAccess.ts): Facility review is the Platform Super Admin's
  // alone, and a clinician's address for it opens Home with the design's notice.
  it('keeps Facility review for the design\'s Platform Super Admin alone: a clinician is sent Home', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/platform')
    expect(await screen.findByText('Your current permissions no longer allow that page. Choose an authorized workflow.')).toBeDefined()
    expect(where()).toBe('/provider')
    expect(screen.queryByRole('heading', { level: 1, name: 'Facility review' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Facility review' })).toBeNull()
  })
})

describe('2. the next sign-in opens the blue EHR (there is no classic EHR choice to carry over)', () => {
  it('opens the blue EHR for whoever signs in after a session ended without Sign out', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({
      [SESSION]: [sessionAt(demo, [demo]), ended, ...many(sessionAt(demo, [demo]))],
      'POST /api/v1/auth/refresh': [ended],
      'POST /api/v1/auth/login': [sessionAt(demo, [demo])],
      [REQUESTS]: many(() => json([])),
    })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    offersNoClassic()

    const { reportStaffSessionEnded } = await import('../../../staff/session')
    act(() => reportStaffSessionEnded())
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in again' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'next.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fictional passphrase for tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
  })
})

describe('3. Home says what today\'s Overview says about clinical modules', () => {
  const SENTENCE = 'You have no clinical work at this facility yet. Ask an administrator to check your role.'

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
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
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

  it('sends Home with the design\'s notice from a blue page that replaced its stand-in', async () => {
    withFramePages(() => [{ path: 'laboratory/*', group: 'Diagnostics', label: 'Laboratory', status: 'live',
      permission: 'lab.work-item.read', element: <p>Fictional blue laboratory</p> }])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/laboratory')
    expect(await screen.findByText('Your current permissions no longer allow that page. Choose an authorized workflow.')).toBeDefined()
    expect(where()).toBe('/provider')
    expect(screen.queryByText('Fictional blue laboratory')).toBeNull()
  })
})

describe('5. there is no "Use the classic EHR": Staff stays the blue page', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('stays on Staff at a facility that signed itself up', async () => {
    const own = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin']),
      selfService: { review: 'approved', organizationType: 'clinic' } }
    serve({ [SESSION]: [sessionAt(own as ReturnType<typeof facility>, [own as ReturnType<typeof facility>])] })
    await openStaffApp('/provider/staff')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    offersNoClassic()
    expect(where()).toBe('/provider/staff')
  })

  it('stays on Staff where today does not list it', async () => {
    const governed = facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'])
    serve({ [SESSION]: [sessionAt(governed, [governed])] })
    await openStaffApp('/provider/staff')
    await screen.findByRole('heading', { level: 1, name: 'Staff & access' })
    offersNoClassic()
    expect(where()).toBe('/provider/staff')
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
    // A facility administrator: the design opens Policies and Procurement to a Hospital Admin.
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [], ['org_admin'])
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

describe('7. a page\'s own refusal', () => {
  const STAFF_READ = 'GET /api/v1/workforce/staff'

  /** The page itself: it reads its staff as soon as it shows. */
  function StaffList() {
    useEffect(() => { void fetch('https://gateway.example.test/api/v1/workforce/staff') }, [])
    return <p>Fictional staff list</p>
  }

  const SUPPORT = 'Health ID support manages who works at Demo Hospital. Contact Health ID support to add or remove staff.'
  const refusal = <><h1 className="hid-ehr-page-title">Staff & access</h1><p>{SUPPORT}</p></>
  const staffPage = (entry: Partial<EhrBluePage>): EhrBluePage =>
    ({ path: 'people', group: 'People', label: 'Staff & access', status: 'live', element: <StaffList />, ...entry })

  it('shows the page\'s own words where visible() turns it down, and reads nothing', async () => {
    withFramePages(() => [staffPage({ visible: () => false, refusal })])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [STAFF_READ]: many(() => json([])) })
    await openStaffApp('/provider/people')
    expect(await screen.findByText(SUPPORT)).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Staff & access' })).toBeDefined()
    expect(screen.queryByText('Fictional staff list')).toBeNull()
    expect(screen.queryByText(/is not open to you here$/)).toBeNull()
    // Only the session was asked for: the refusal makes no request, and the page that would is not shown.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('shows them where the permission is missing too', async () => {
    withFramePages(() => [staffPage({ permission: 'workforce.manage', refusal })])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [STAFF_READ]: many(() => json([])) })
    await openStaffApp('/provider/people')
    expect(await screen.findByText(SUPPORT)).toBeDefined()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('leaves the frame\'s refusal for a page that gives none', async () => {
    withFramePages(() => [staffPage({ visible: () => false })])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/people')
    expect(await screen.findByText('Staff & access is part of the Health ID demo only')).toBeDefined()
  })

  it('shows the page itself where it is allowed', async () => {
    withFramePages(() => [staffPage({ permission: 'workforce.manage', refusal })])
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [STAFF_READ]: many(() => json([])) })
    await openStaffApp('/provider/people')
    expect(await screen.findByText('Fictional staff list')).toBeDefined()
    expect(screen.queryByText(SUPPORT)).toBeNull()
  })
})
