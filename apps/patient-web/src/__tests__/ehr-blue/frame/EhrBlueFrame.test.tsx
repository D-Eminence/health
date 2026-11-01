import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BLUE_PAGES, basePath, collectPages, matchBluePage, pageAllowed, pageTabs } from '../../../ehr-blue/routes'
import { navigationGroups } from '../../../ehr-blue/frame/BlueFrame'
import { pages as framePages } from '../../../ehr-blue/frame/pages'
import { pages as homePages } from '../../../ehr-blue/home/pages'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import type { StaffSession } from '../../../staff/api'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, FACILITY, LAB_WORK, REQUESTS, SESSION, accountButton, facility, homeHeading, json, openStaffApp, problem, serve,
  sessionAt, switchFacilityTo, where, withFramePages,
} from './blueHarness'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// These test the frame and its stand-ins, whichever other folders' pages have joined.
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

/** The frame's own registry: the design's, before any other folder's page takes a stand-in's place. */
const FRAME_REGISTRY = collectPages({ './frame/pages.ts': { pages: framePages }, './home/pages.ts': { pages: homePages } })

function sessionWith(permissions: readonly string[], name = 'Demo Hospital'): StaffSession {
  const current = facility(DEMO_HOSPITAL, name, permissions)
  return { actor: { id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Demo Clinician', roles: ['clinician'], permissions: [],
    facilities: [current], facility: current }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'
const DESIGN_GROUPS = ['Clinical', 'Diagnostics', 'Finance', 'Network & Services', 'People', 'Administration', 'Settings', 'Supply', 'Insight']
// The design's 33 workspaces (screens/README.md, workspaces/): Insurance & Claims holds Policies, Supply holds Stock and Procurement.
const DESIGN_WORKSPACES = ['Patients', 'Appointments', 'Patient visits', 'Triage & Vitals', 'Consultation', 'Inpatient / Wards',
  'Wards & Beds', 'Nursing observations', 'Nursing tasks', 'Emergency', 'Maternity', 'Theatre & Procedures', 'ICU', 'Dental',
  'Access requests', 'Laboratory', 'Radiology', 'Pharmacy', 'Patient billing', 'Insurance & Claims', 'Referral Network',
  'Dispatch', 'Blood Bank', 'Telemedicine', 'Shifts & Roster', 'HR & Credentials', 'Quality & Safety', 'Supply', 'Service catalogue',
  'Ward configuration', 'Vehicle configuration']

async function openDemo(path: string, permissions: readonly string[] = ['identity.consent.write'], routes: Record<string, (() => Response)[]> = {},
  roles: readonly string[] = ['clinician']) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', permissions, roles)
  const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
  const sent = serve({ [SESSION]: [sessionAt(demo, [demo, lab])], [REQUESTS]: [() => json([{ accessRequestId: 'r1', status: 'pending' }])], ...routes })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('the page registry', () => {
  it('holds every workspace of the design, in the design\'s groups and order, each with a status', () => {
    const labels = FRAME_REGISTRY.map(page => page.label)
    for (const workspace of DESIGN_WORKSPACES) expect(labels).toContain(workspace)
    const groups = [...new Set(FRAME_REGISTRY.map(page => page.group).filter(group => group && group !== 'Design review' && group !== 'Design tour'))]
    expect(groups).toEqual(DESIGN_GROUPS)
    expect(labels.slice(0, 1)).toEqual(['Home'])
    expect(labels).toEqual(expect.arrayContaining(['Facility review', 'Staff & access', 'Facility profile', 'Facility settings',
      'Facility subscription', 'Reports & Analytics', 'Audit & Compliance', 'What’s left', 'Choose workspace']))
  })

  it('keeps every page, from every folder, well formed: a status, one address each, and tabs that join a page', () => {
    expect(BLUE_PAGES[0]?.label).toBe('Home')
    const paths = BLUE_PAGES.map(page => basePath(page.path))
    expect(new Set(paths).size).toBe(paths.length)
    for (const page of BLUE_PAGES) {
      expect(['live', 'partial', 'sample']).toContain(page.status)
      if (!page.tabOf) continue
      const owner = BLUE_PAGES.find(candidate => basePath(candidate.path) === page.tabOf)
      expect(owner, `${page.label} joins ${page.tabOf}`).toBeDefined()
      expect(owner?.tabOf, `${page.tabOf} is a page of its own`).toBeUndefined()
    }
  })

  it('lets another folder replace a stand-in in place, and adds new paths at the end of their group', () => {
    const page = (path: string, group: string, label: string, status: EhrBluePage['status'] = 'sample'): EhrBluePage =>
      ({ path, group, label, status, element: <p>{label}</p> })
    const pages = collectPages({
      './frame/pages.ts': { pages: [page('a/*', 'Clinical', 'A'), page('b', 'Clinical', 'B'), page('c', 'Insight', 'C')] },
      './clinical/pages.ts': { pages: [page('a', 'Clinical', 'A for real', 'live'), page('d', 'Clinical', 'D', 'live')] },
    })
    expect(pages.map(entry => entry.label)).toEqual(['A for real', 'B', 'D', 'C'])
  })

  it('hides a live or partial page without its permission, never a sample page', () => {
    const live = FRAME_REGISTRY.find(page => page.label === 'Pharmacy')!
    const sample = FRAME_REGISTRY.find(page => page.label === 'Radiology')!
    expect(live.status).toBe('live')
    expect(pageAllowed(live, sessionWith([]))).toBe(false)
    expect(pageAllowed(live, sessionWith(['pharmacy.work-item.read']))).toBe(true)
    expect(sample.status).toBe('sample')
    expect(pageAllowed(sample, sessionWith([]))).toBe(true)
    expect(pageAllowed(sample, null)).toBe(false)
  })

  it('hides any page its visible() turns down for the session, sample or live', () => {
    const onlyAt = (name: string) => (session: StaffSession) => session.actor.facility?.name === name
    const sample: EhrBluePage = { path: 'x', group: 'People', label: 'X', status: 'sample', element: <p>X</p>, visible: onlyAt('Demo Hospital') }
    const live: EhrBluePage = { path: 'y', group: 'People', label: 'Y', status: 'live', permission: 'workforce.manage', element: <p>Y</p>,
      visible: onlyAt('Demo Hospital') }
    expect(pageAllowed(sample, sessionWith([]))).toBe(true)
    expect(pageAllowed(sample, sessionWith([], 'Riverside Teaching Hospital (fictional)'))).toBe(false)
    // visible() comes first, and the permission still counts.
    expect(pageAllowed(live, sessionWith(['workforce.manage'], 'Riverside Teaching Hospital (fictional)'))).toBe(false)
    expect(pageAllowed(live, sessionWith([]))).toBe(false)
    expect(pageAllowed(live, sessionWith(['workforce.manage']))).toBe(true)
  })

  it('matches an address to its page, and a sample page\'s sub-address to the rest', () => {
    expect(matchBluePage(FRAME_REGISTRY, '/provider')?.page.label).toBe('Home')
    expect(matchBluePage(FRAME_REGISTRY, '/provider/laboratory')?.page.label).toBe('Laboratory')
    expect(matchBluePage(FRAME_REGISTRY, '/provider/appointments/new')).toMatchObject({ rest: 'new' })
    expect(matchBluePage(FRAME_REGISTRY, '/provider/policies/5a200001')).toMatchObject({ rest: '5a200001' })
    expect(matchBluePage(FRAME_REGISTRY, '/provider/not-a-page')).toBeNull()
  })

  it('groups tabs as the design does: Claims | Policies and Stock | Procurement, each under one sidebar entry', () => {
    const tabs = (label: string) => pageTabs(FRAME_REGISTRY, FRAME_REGISTRY.find(page => page.label === label)!)
      .map((tab, index) => index === 0 ? tab.tabLabel ?? tab.label : tab.label)
    expect(tabs('Insurance & Claims')).toEqual(['Claims', 'Policies'])
    expect(tabs('Policies')).toEqual(['Claims', 'Policies'])
    expect(tabs('Supply')).toEqual(['Stock', 'Procurement'])
    expect(tabs('Procurement')).toEqual(['Stock', 'Procurement'])
    expect(tabs('Radiology')).toEqual([])
    const groups = navigationGroups(FRAME_REGISTRY.filter(page => !page.tabOf))
    expect(groups.find(group => group.id === 'Finance')?.items.map(item => item.label)).toEqual(['Patient billing', 'Insurance & Claims'])
    // Supply is one entry with no heading, as in the design.
    const supply = groups.find(group => group.id === 'Supply')
    expect(supply?.label).toBeUndefined()
    expect(supply?.items.map(item => item.label)).toEqual(['Supply'])
  })
})

describe('the blue frame', () => {
  // Only working screens are listed (the owner's decision of 2026-10-31): sample workspaces stay by address.
  it('lists the live pages this facility may open, and no sample workspace', async () => {
    // A clinical permission too: a facility holding only the laboratory's is the Lab product (product.ts).
    await openDemo('/provider/whats-left', ['identity.consent.write', 'identity.patient.read', 'lab.work-item.read'])
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    // Groups other than the front desk's and care's are folded until opened.
    fireEvent.click(within(nav).getByRole('button', { name: 'Diagnostics' }))
    for (const sample of ['Radiology', 'Appointments', 'Blood Bank']) expect(within(nav).queryByRole('link', { name: sample })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Laboratory' })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Access requests' })).toBeDefined()
    // Live pages this facility's permissions do not open are hidden.
    expect(within(nav).queryByRole('link', { name: 'Pharmacy' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Audit & Compliance' })).toBeNull()
  })

  it('lists every page with its status on What\'s left', async () => {
    await openDemo('/provider/whats-left')
    expect(screen.getByRole('heading', { level: 1, name: 'What’s left' })).toBeDefined()
    const table = screen.getByRole('table', { name: 'Pages and their status' })
    expect(within(table).getAllByRole('row')).toHaveLength(FRAME_REGISTRY.length + 1)
    const radiology = within(table).getByRole('link', { name: 'Radiology' }).closest('tr')!
    expect(within(radiology).getByText('Sample')).toBeDefined()
    const lab = within(table).getByRole('link', { name: 'Laboratory' }).closest('tr')!
    expect(within(lab).getByText('Live')).toBeDefined()
  })

  it('opens a sample workspace with the notice, keeps a new record in memory, and validates the form as the design does', async () => {
    const sent = await openDemo('/provider/appointments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
    expect(screen.getByText(SAMPLE_NOTICE)).toBeDefined()
    const before = sent.length
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    await waitFor(() => expect(where()).toBe('/provider/appointments/new'))
    expect(screen.getByRole('heading', { level: 1, name: 'New appointments' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeDefined()
    // As in the design, the form opens once a registered patient is chosen.
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()
    const patient = screen.getByRole('combobox', { name: 'Patient' })
    expect(within(patient).getByRole('option', { name: 'Select registered patient' })).toBeDefined()
    fireEvent.change(patient, { target: { value: 'Taylor Fiction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    const clinician = screen.getByRole('combobox', { name: 'Clinician' })
    expect(clinician.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('Complete this field.')).toHaveLength(4)
    // The required star is the design's mark; the control's name is the label alone.
    const time = screen.getByLabelText(/^Appointment time/)
    expect(document.activeElement).toBe(time)
    fireEvent.change(time, { target: { value: '2026-11-02T09:00' } })
    fireEvent.change(clinician, { target: { value: 'Demo Consultant' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'General Outpatient' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Review (fictional)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(where()).toBe('/provider/appointments/5a020004'))
    expect(screen.getByRole('heading', { level: 1, name: 'Review (fictional)' })).toBeDefined()
    expect(screen.getByText('Taylor Fiction · HID-DEMO-002')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDefined()
    // Nothing of a sample is sent anywhere.
    expect(sent.length).toBe(before)
  })

  // Today's words (staff/App.tsx's catch-all), inside the frame, with one way back; the address itself is never shown.
  it('says Page not found for an address that is no page, with one way Home and no address', async () => {
    await openDemo('/provider/not-a-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeDefined()
    expect(where()).toBe('/provider/not-a-page')
    expect(screen.getByText('This provider page is unavailable.')).toBeDefined()
    await waitFor(() => expect(document.title).toBe('Page not found · Health ID EHR'))
    const page = document.querySelector<HTMLElement>('.hid-ehr-blue-page')!
    expect(page.textContent).not.toMatch(/not-a-page|\/provider/)
    expect(screen.queryByText(/no longer allow that page/)).toBeNull()
    const home = within(page).getByRole('link', { name: 'Go to Home' })
    expect(within(page).getAllByRole('link')).toEqual([home])
    expect(home.getAttribute('href')).toBe('/provider')
    fireEvent.click(home)
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
  })

  // Moved addresses and today's live-only routes keep opening their pages (EhrBlueSwitchFixes, EhrBlueMinorFixes).
  it('says Page not found below a page that takes no further address, naming neither', async () => {
    await openDemo('/provider/whats-left/not-a-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeDefined()
    expect(document.querySelector('.hid-ehr-blue-page')!.textContent).not.toMatch(/what|not-a-page/i)
  })

  it('leaves today\'s page to refuse a live stand-in without its permission, in today\'s words', async () => {
    const sent = await openDemo('/provider/pharmacy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pharmacy unavailable' })).toBeDefined()
    expect(sent.some(call => call.route.includes('/pharmacy/'))).toBe(false)
  })

  it('signs out from the account menu with today\'s sign-out', async () => {
    const sent = await openDemo('/provider/whats-left', ['identity.consent.write'], { 'POST /api/v1/auth/logout': [() => new Response(null, { status: 204 })] })
    const menu = accountButton()
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('Demo Clinician').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(sent.some(call => call.route === 'POST /api/v1/auth/logout')).toBe(true)
  })

  it('switches facility from the account menu with today\'s switch, and says a refusal in today\'s words', async () => {
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    const sent = await openDemo('/provider/whats-left', ['identity.consent.write'], {
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at the facility.'), sessionAt(lab, [lab])],
      [LAB_WORK]: [() => json({ items: [] })],
    })
    switchFacilityTo('Demo Hospital', 'Demo Laboratory')
    await waitFor(() => expect(where()).toBe('/provider/institutions'))
    expect(screen.getByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Work at Demo Laboratory' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('You are no longer active at Demo Laboratory. Choose another facility.')
    fireEvent.click(screen.getByRole('button', { name: 'Work at Demo Laboratory' }))
    // Demo Laboratory holds only the laboratory's permission: it is the Lab product, whose home is its queue.
    await waitFor(() => expect(where()).toBe('/provider/laboratory'))
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: DEMO_LABORATORY }, { facilityId: DEMO_LABORATORY }])
  })

  it('asks where the person works, in blue, when every facility they could choose is a demo one', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo, lab], 'default')] })
    await openStaffApp('/provider')
    const heading = await screen.findByRole('heading', { level: 1, name: 'Where are you working today?' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(/You work at more than one facility\./)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Work at Demo Hospital' })).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
  })

  // Search finds the pages listed (working screens only, so no sample's Blood Bank), opened by its button or Ctrl+K.
  it('finds pages in search, opened by its button or Ctrl+K', async () => {
    await openDemo('/provider/whats-left')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const drawer = screen.getByRole('dialog', { name: 'Search' })
    const box = within(drawer).getByRole('searchbox', { name: 'Health ID or page' })
    fireEvent.change(box, { target: { value: 'blood' } })
    expect(within(drawer).queryAllByRole('link')).toEqual([])
    fireEvent.change(box, { target: { value: 'requests' } })
    const results = within(drawer).getByRole('navigation', { name: 'Pages' })
    expect(within(results).getAllByRole('link').map(link => link.textContent)).toEqual(['Access requestsClinical'])
    fireEvent.click(within(results).getByRole('link'))
    await waitFor(() => expect(where()).toBe('/provider/requests'))
  })

  it('counts pending access requests on the bell once they are read: on opening its drawer, or Home', async () => {
    const sent = await openDemo('/provider/whats-left')
    // Away from Home nothing reads them, as today: only Overview and Requests do.
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    const drawer = screen.getByRole('dialog', { name: 'Notifications' })
    expect(await within(drawer).findByText('1 access request waiting')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Notifications, 1 waiting' })).toBeDefined()
    expect(sent.filter(call => call.route === REQUESTS)).toHaveLength(1)
  })
})

// The top-bar account menu, and the sixteen sample dashboards in it, were removed (its remaining items were samples).
describe('the demo role switcher', () => {
  it('is no longer offered: the account menu holds Sign out, and Home is the person\'s own', async () => {
    await openDemo('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    fireEvent.click(accountButton())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'View Home as a demo role (sample)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pharmacist' })).toBeNull()
    expect(screen.queryByText(SAMPLE_NOTICE)).toBeNull()
  })
})
