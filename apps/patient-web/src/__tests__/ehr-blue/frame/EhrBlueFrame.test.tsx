import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BLUE_PAGES, collectPages, matchBluePage, pageAllowed } from '../../../ehr-blue/routes'
import { navigationGroups } from '../../../ehr-blue/frame/BlueFrame'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, FACILITY, LAB_WORK, REQUESTS, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where,
} from './blueHarness'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'
const DESIGN_GROUPS = ['Clinical', 'Diagnostics', 'Finance', 'Network & Services', 'People', 'Administration', 'Settings', 'Supply', 'Insight']
// The design's 33 workspaces (screens/README.md, workspaces/): Insurance & Claims holds Policies, Supply holds Stock and Procurement.
const DESIGN_WORKSPACES = ['Patients', 'Appointments', 'Patient visits', 'Triage & Vitals', 'Consultation', 'Inpatient / Wards',
  'Wards & Beds', 'Nursing observations', 'Nursing tasks', 'Emergency', 'Maternity', 'Theatre & Procedures', 'ICU', 'Dental',
  'External record access', 'Laboratory', 'Radiology', 'Pharmacy', 'Patient billing', 'Insurance & Claims', 'Referral Network',
  'Dispatch', 'Blood Bank', 'Telemedicine', 'Shifts & Roster', 'HR & Credentials', 'Quality & Safety', 'Supply', 'Service catalogue',
  'Ward configuration', 'Vehicle configuration']

async function openDemo(path: string, permissions: readonly string[] = ['identity.consent.write'], routes: Record<string, (() => Response)[]> = {}) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', permissions)
  const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
  const sent = serve({ [SESSION]: [sessionAt(demo, [demo, lab])], [REQUESTS]: [() => json([{ accessRequestId: 'r1', status: 'pending' }])], ...routes })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('the page registry', () => {
  it('holds every workspace of the design, in the design\'s groups and order, each with a status', () => {
    const labels = BLUE_PAGES.map(page => page.label)
    for (const workspace of DESIGN_WORKSPACES) expect(labels).toContain(workspace)
    const groups = [...new Set(BLUE_PAGES.map(page => page.group).filter(group => group && group !== 'Design review' && group !== 'Design tour'))]
    expect(groups).toEqual(DESIGN_GROUPS)
    for (const page of BLUE_PAGES) expect(['live', 'partial', 'sample']).toContain(page.status)
    expect(labels.slice(0, 1)).toEqual(['Home'])
    expect(labels).toEqual(expect.arrayContaining(['Facility review', 'Staff & access', 'Facility profile', 'Facility settings',
      'Facility subscription', 'Reports & Analytics', 'Audit & Compliance', 'What’s left', 'Choose workspace']))
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
    const live = BLUE_PAGES.find(page => page.label === 'Pharmacy')!
    const sample = BLUE_PAGES.find(page => page.label === 'Radiology')!
    expect(live.status).toBe('live')
    expect(pageAllowed(live, [])).toBe(false)
    expect(pageAllowed(live, ['pharmacy.work-item.read'])).toBe(true)
    expect(sample.status).toBe('sample')
    expect(pageAllowed(sample, [])).toBe(true)
  })

  it('matches an address to its page, and a sample page\'s sub-address to the rest', () => {
    expect(matchBluePage(BLUE_PAGES, '/provider')?.page.label).toBe('Home')
    expect(matchBluePage(BLUE_PAGES, '/provider/laboratory')?.page.label).toBe('Laboratory')
    expect(matchBluePage(BLUE_PAGES, '/provider/appointments/new')).toMatchObject({ rest: 'new' })
    expect(matchBluePage(BLUE_PAGES, '/provider/not-a-page')).toBeNull()
    const groups = navigationGroups(BLUE_PAGES.filter(page => page.status === 'sample' || page.label === 'Supply'))
    expect(groups.find(group => group.id === 'Supply')?.label).toBeUndefined()
  })
})

describe('the blue frame', () => {
  it('shows every design workspace in the sidebar, and the live pages this facility may open', async () => {
    await openDemo('/provider/whats-left', ['identity.consent.write', 'lab.work-item.read'])
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const group of DESIGN_GROUPS.filter(group => group !== 'Supply')) expect(within(nav).getByRole('button', { name: group })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Radiology' })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Laboratory' })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'External record access' })).toBeDefined()
    // Live pages this facility's permissions do not open are hidden.
    expect(within(nav).queryByRole('link', { name: 'Pharmacy' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Audit & Compliance' })).toBeNull()
  })

  it('lists every page with its status on What\'s left', async () => {
    await openDemo('/provider/whats-left')
    expect(screen.getByRole('heading', { level: 1, name: 'What’s left' })).toBeDefined()
    const table = screen.getByRole('table', { name: 'Pages and their status' })
    expect(within(table).getAllByRole('row')).toHaveLength(BLUE_PAGES.length + 1)
    const radiology = within(table).getByRole('link', { name: 'Radiology' }).closest('tr')!
    expect(within(radiology).getByText('Sample')).toBeDefined()
    const lab = within(table).getByRole('link', { name: 'Laboratory' }).closest('tr')!
    expect(within(lab).getByText('Live')).toBeDefined()
  })

  it('opens a sample workspace with the notice, keeps a new record in memory, and validates the form', async () => {
    const sent = await openDemo('/provider/appointments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
    expect(screen.getByText(SAMPLE_NOTICE)).toBeDefined()
    const before = sent.length
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    await waitFor(() => expect(where()).toBe('/provider/appointments/new'))
    fireEvent.click(screen.getByRole('button', { name: 'Save sample record' }))
    const clinician = screen.getByRole('textbox', { name: 'Clinician' })
    expect(clinician.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter clinician.')).toBeDefined()
    expect(document.activeElement).not.toBe(document.body)
    fireEvent.change(screen.getByLabelText('Appointment time'), { target: { value: '2026-11-02T09:00' } })
    fireEvent.change(clinician, { target: { value: 'Dr Fictional' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Department' }), { target: { value: 'Outpatients' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Review (fictional)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sample record' }))
    await waitFor(() => expect(where()).toMatch(/^\/provider\/appointments\/S-\d{4}$/))
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDefined()
    // Nothing of a sample is sent anywhere.
    expect(sent.length).toBe(before)
  })

  it('says an unknown address is no page, and the sidebar still leads Home', async () => {
    await openDemo('/provider/not-a-page')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeDefined()
    expect(screen.getByText('This page is not part of Health ID EHR')).toBeDefined()
    act(() => { fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Home' })) })
    await waitFor(() => expect(where()).toBe('/provider'))
  })

  it('refuses a live page without its permission', async () => {
    const sent = await openDemo('/provider/pharmacy')
    expect(screen.getByText('Pharmacy is not open to you here')).toBeDefined()
    expect(sent.some(call => call.route.includes('/pharmacy/'))).toBe(false)
  })

  it('signs out from the account menu with today\'s sign-out', async () => {
    const sent = await openDemo('/provider/whats-left', ['identity.consent.write'], { 'POST /api/v1/auth/logout': [() => new Response(null, { status: 204 })] })
    const menu = screen.getByRole('button', { name: 'Account menu' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(menu)
    const panel = screen.getByRole('region', { name: 'Account' })
    expect(within(panel).getByText('Demo Clinician')).toBeDefined()
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    expect(sent.some(call => call.route === 'POST /api/v1/auth/logout')).toBe(true)
  })

  it('switches facility from the account menu with today\'s switch, and says a refusal in today\'s words', async () => {
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    const sent = await openDemo('/provider/whats-left', ['identity.consent.write'], {
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at the facility.'), sessionAt(lab, [lab])],
      [LAB_WORK]: [() => json({ items: [] })],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    await waitFor(() => expect(where()).toBe('/provider/institutions'))
    expect(screen.getByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Work at Demo Laboratory' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('You are no longer active at Demo Laboratory. Choose another facility.')
    fireEvent.click(screen.getByRole('button', { name: 'Work at Demo Laboratory' }))
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: DEMO_LABORATORY }, { facilityId: DEMO_LABORATORY }])
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
  })

  it('asks where the person works, in blue, when every facility they could choose is a demo one', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo, lab], 'default')] })
    await openStaffApp('/provider')
    const heading = await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(/You work at more than one facility\./)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Work at Demo Hospital' })).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
  })

  it('finds work areas in search, opened by its button or Ctrl+K', async () => {
    await openDemo('/provider/whats-left')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const drawer = screen.getByRole('dialog', { name: 'Search Health ID' })
    fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Search work areas' }), { target: { value: 'blood' } })
    const results = within(drawer).getByRole('navigation', { name: 'Search results' })
    expect(within(results).getAllByRole('link').map(link => link.textContent)).toEqual(['Blood BankNetwork & Services · sample'])
    fireEvent.click(within(results).getByRole('link'))
    await waitFor(() => expect(where()).toBe('/provider/bloodbank'))
  })

  it('counts pending access requests on the bell, from today\'s read', async () => {
    await openDemo('/provider/whats-left')
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 pending' })
    fireEvent.click(bell)
    const drawer = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(drawer).getByText('1 pending access request')).toBeDefined()
  })
})

describe('the demo role switcher', () => {
  it('lists the sixteen demo roles in the account menu and shows each role\'s sample dashboard on Home', async () => {
    await openDemo('/provider/whats-left')
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const roles = within(screen.getByRole('group', { name: 'View Home as a demo role (sample)' })).getAllByRole('button')
    expect(roles).toHaveLength(16)
    fireEvent.click(within(screen.getByRole('region', { name: 'Account' })).getByRole('button', { name: 'Pharmacist' }))
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Demo Pharmacist' })).toBeDefined()
    expect(screen.getByText(SAMPLE_NOTICE)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Back to my dashboard' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
  })
})
