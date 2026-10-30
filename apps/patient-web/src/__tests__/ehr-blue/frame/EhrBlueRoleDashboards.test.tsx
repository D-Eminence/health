import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BLUE_PAGES } from '../../../ehr-blue/routes'
import { BluePagesProvider } from '../../../ehr-blue/frame/pageContext'
import { RoleViewProvider, type DemoRole } from '../../../ehr-blue/frame/roleView'
import { RoleDashboard } from '../../../ehr-blue/home/RoleDashboard'
import { DEMO_HOSPITAL, SESSION, facility, json, openStaffApp, serve, sessionAt, withFramePages } from './blueHarness'

/**
 * Home and the demo roles' dashboards as the design draws them (audit items 3-7 and 13; design/ehr-target
 * screens/roles, src/dashboard.tsx): the design's heading, cards, empty states, markup and pinned shortcuts; an
 * administrator's own People and Patient billing; and the My profile drawer. Every account, facility and record is
 * fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const STAFF = 'GET /api/v1/identity/facility-staff'
const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

function dashboard(role: DemoRole) {
  const inFrame = (children: ReactNode) => <MemoryRouter><RoleViewProvider><BluePagesProvider value={BLUE_PAGES}>{children}</BluePagesProvider></RoleViewProvider></MemoryRouter>
  return render(inFrame(<RoleDashboard role={role} />))
}

const card = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('.hid-ehr-card') as HTMLElement
const cardTitles = () => [...document.querySelectorAll('.hid-ehr-blue-grid > .hid-ehr-card')]
  .map(element => element.querySelector('.hid-ehr-card-title')?.textContent)
const pinned = () => {
  const section = screen.getByRole('heading', { level: 2, name: 'Pinned shortcuts' }).closest('section')!
  return within(section).queryAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])
}

describe('3. the role dashboard heading', () => {
  it('is the design\'s: the welcome, and Customize shortcuts in place of a description and a way back', () => {
    dashboard('Doctor')
    const heading = screen.getByRole('heading', { level: 1, name: 'Welcome, Demo Doctor' })
    expect(heading.closest('.hid-ehr-page-heading')?.querySelector('.hid-ehr-page-description')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to my dashboard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Customize shortcuts' }))
    const drawer = screen.getByRole('dialog', { name: 'Customize shortcuts' })
    fireEvent.click(within(drawer).getByRole('checkbox', { name: 'Appointments' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Done' }))
    expect(pinned().map(([label]) => label)).toEqual(['Patients', 'Patient visits', 'Triage & Vitals'])
  })

  it('says how to pin a shortcut when none is pinned', () => {
    dashboard('Radiology Reporter')
    fireEvent.click(screen.getByRole('button', { name: 'Customize shortcuts' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Customize shortcuts' })).getByRole('checkbox', { name: 'Radiology' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(pinned()).toEqual([])
    expect(screen.getByText('Pin up to six work areas using Customize shortcuts.')).toBeDefined()
  })
})

describe('4. the design\'s cards for each role', () => {
  it('gives the Cashier Patient billing, from the sample invoices, in place of Activity in period', () => {
    dashboard('Cashier')
    expect(cardTitles()).toEqual(['Patient billing', 'Needs attention', 'Today'])
    const billing = within(card('Patient billing'))
    expect(billing.getByText('Invoiced in period').nextElementSibling?.textContent).toMatch(/^NGN\s30,000$/)
    expect(billing.getByText('Collected in period').nextElementSibling?.textContent).toMatch(/^NGN\s4,000$/)
    expect(billing.getByText('Outstanding balance').nextElementSibling?.textContent).toMatch(/^NGN\s26,000$/)
    expect(billing.getByText('No comparison yet · Before refunds')).toBeDefined()
    expect(billing.getByText('All open invoices')).toBeDefined()
    expect(billing.getByRole('link', { name: 'View patient billing' }).getAttribute('href')).toBe('/provider/patient-billing')
  })

  it('adds People for a Hospital Admin, with the way to Staff & access', () => {
    dashboard('Hospital Admin')
    expect(cardTitles()).toEqual(['Patient billing', 'People', 'Needs attention', 'Today'])
    const people = within(card('People'))
    expect(people.getByText('16')).toBeDefined()
    expect(people.getByText('Active staff in this branch')).toBeDefined()
    expect(people.getByRole('link', { name: 'Manage staff & access' }).getAttribute('href')).toBe('/provider/staff')
  })

  it('gives the Platform Super Admin People and Facility review, and the empty worklists', () => {
    dashboard('Platform Super Admin')
    expect(cardTitles()).toEqual(['People', 'Facility review', 'Needs attention', 'Today'])
    expect(within(card('Facility review')).getByText('0 facilities awaiting review')).toBeDefined()
    expect(within(card('Facility review')).getByRole('link', { name: 'Review facilities' }).getAttribute('href')).toBe('/provider/platform')
    expect(within(card('Needs attention')).getByText('No open items in your worklist')).toBeDefined()
    expect(within(card('Needs attention')).getByText('New work requiring review will appear here. Use your work area to review completed records.'))
      .toBeDefined()
    expect(within(card('Today')).getByText('No activity recorded today')).toBeDefined()
    expect(within(card('Today')).getByText('Your permitted appointments and daily work will appear here as records are saved.')).toBeDefined()
  })

  it('leaves Patients out of Needs attention: a Records Officer\'s is empty', () => {
    dashboard('Records Officer')
    expect(cardTitles()).toEqual(['Activity in period', 'Needs attention', 'Today'])
    expect(within(card('Activity in period')).getAllByText(/ created$/).map(label => label.textContent)).toEqual(['Patients created'])
    expect(within(card('Needs attention')).getByText('No open items in your worklist')).toBeDefined()
  })

  it.each([
    ['Medical Director', ['Patients', 'Appointments', 'Patient visits', 'Triage & Vitals']],
    ['Nurse', ['Patients', 'Appointments', 'Patient visits', 'Triage & Vitals']],
    ['Receptionist', ['Patients', 'Appointments', 'Patient visits']],
    ['Lab Manager', ['Laboratory', 'Stock', 'Procurement', 'Blood Bank']],
    ['Lab Scientist', ['Laboratory', 'Stock', 'Blood Bank']],
    ['Pharmacy Manager', ['Pharmacy', 'Stock', 'Procurement']],
    ['Pharmacist', ['Pharmacy', 'Stock']],
    ['Radiology Reporter', ['Radiology']],
  ] as const)('counts the design\'s workspaces in a %s\'s Activity in period', (role, titles) => {
    dashboard(role)
    expect(within(card('Activity in period')).getAllByText(/ created$/).map(label => label.textContent))
      .toEqual(titles.map(title => `${title} created`))
  })

  it('gives the Medical Director People beside Activity in period', () => {
    dashboard('Medical Director')
    expect(cardTitles()).toEqual(['Activity in period', 'People', 'Needs attention', 'Today'])
  })
})

describe('5. the dashboard\'s markup is Home\'s', () => {
  it('draws plain figures, the period note beside its select, the notice in the first card, and linked worklist titles', () => {
    dashboard('Doctor')
    const activity = card('Activity in period')
    expect(activity.querySelectorAll('.hid-ehr-blue-activity-figure')).toHaveLength(4)
    expect(document.querySelector('.hid-ehr-stat-card')).toBeNull()
    // The notice is the first card's alone.
    expect(within(activity).getByText(SAMPLE_NOTICE)).toBeDefined()
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    const period = screen.getByRole('combobox', { name: 'Reporting period' }).closest('.hid-ehr-blue-period')!
    expect(within(period as HTMLElement).getByText('Record creation dates · local time')).toBeDefined()
    const rows = within(card('Needs attention')).getAllByRole('link')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.classList.contains('hid-ehr-blue-worklink')).toBe(true)
      expect(row.firstElementChild?.tagName).toBe('STRONG')
    }
  })
})

describe('6. pinned shortcuts', () => {
  it.each([
    ['Platform Super Admin', ['Facility review', 'Staff & access', 'Audit & Compliance', 'Facility settings']],
    ['Hospital Owner', ['Patient billing', 'Insurance & Claims', 'Dispatch', 'Shifts & Roster']],
    ['Hospital Admin', ['Patient billing', 'Insurance & Claims', 'Dispatch', 'Shifts & Roster']],
    ['Doctor', ['Patients', 'Appointments', 'Patient visits', 'Triage & Vitals']],
    ['Receptionist', ['Patients', 'Appointments', 'Patient visits']],
    ['Records Officer', ['Patients', 'Reports & Analytics', 'Audit & Compliance']],
    ['Lab Scientist', ['Laboratory', 'Blood Bank', 'Supply']],
    ['Pharmacist', ['Pharmacy', 'Supply']],
    ['Billing Officer', ['Patient billing', 'Insurance & Claims', 'Reports & Analytics', 'Facility subscription']],
    ['Cashier', ['Patient billing', 'Insurance & Claims', 'Reports & Analytics']],
    ['Radiology Reporter', ['Radiology']],
  ] as const)('pins the design\'s shortcuts for a %s, each a button to its page, live or sample', (role, labels) => {
    dashboard(role)
    const links = pinned()
    expect(links.map(([label]) => label)).toEqual(labels)
    for (const [, href] of links) expect(href).toMatch(/^\/provider\/[a-z-]+$/)
    const section = screen.getByRole('heading', { level: 2, name: 'Pinned shortcuts' }).closest('section')!
    for (const link of within(section).getAllByRole('link')) expect(link.className).toBe('hid-ehr-button hid-ehr-button-secondary')
  })
})

describe('7. an administrator\'s own Home', () => {
  beforeEach(() => { withFramePages() })

  it('shows Patient billing in place of Activity, and People as a sample where Health ID support manages the staff', async () => {
    const governed = facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin'])
    const sent = serve({ [SESSION]: [sessionAt(governed, [governed])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    expect(screen.queryByRole('heading', { level: 2, name: 'Activity in period' })).toBeNull()
    expect(within(card('Patient billing')).getByText(SAMPLE_NOTICE)).toBeDefined()
    const people = within(card('People'))
    expect(people.getByText('16')).toBeDefined()
    expect(people.getByText(SAMPLE_NOTICE)).toBeDefined()
    expect(sent.some(call => call.route === STAFF)).toBe(false)
  })

  it('counts the facility\'s staff live where today\'s sidebar lists Staff (a facility that signed itself up)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const own = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin']),
      selfService: { review: 'reviewed', organizationType: 'hospital' } } as ReturnType<typeof facility>
    const member = (name: string) => ({ membershipId: `m-${name}`, name: `${name} (fictional)`, roles: ['nurse'] })
    const sent = serve({ [SESSION]: [sessionAt(own, [own])], [STAFF]: [() => json({ members: [member('A'), member('B'), member('C')] })] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    await waitFor(() => expect(within(card('People')).getByText('3')).toBeDefined())
    expect(within(card('People')).queryByText(SAMPLE_NOTICE)).toBeNull()
    expect(sent.filter(call => call.route === STAFF)).toHaveLength(1)
  })

  it('keeps a clinician\'s Activity in period, and no People', async () => {
    const clinic = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(clinic, [clinic])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    expect(card('Activity in period')).toBeDefined()
    expect(screen.queryByRole('heading', { level: 2, name: 'People' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2, name: 'Patient billing' })).toBeNull()
  })
})

describe('13. My profile', () => {
  beforeEach(() => { withFramePages() })

  it('is the design\'s page in the drawer, as a sample that sends and keeps nothing', async () => {
    const clinic = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])] })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'My profile' }))
    const drawer = within(screen.getByRole('dialog', { name: 'Edit my profile' }))
    expect(drawer.getByText('Personal details and account security')).toBeDefined()
    expect(drawer.getByRole('heading', { level: 3, name: 'My profile' })).toBeDefined()
    expect(drawer.getByText(SAMPLE_NOTICE)).toBeDefined()
    expect(drawer.getByRole('heading', { name: 'Profile picture' })).toBeDefined()
    expect(drawer.getByText('DC')).toBeDefined()
    expect(drawer.getByText(/^PNG, JPEG, WebP or GIF · up to 2 MB/)).toBeDefined()
    expect(drawer.getByText('demo.clinician@example.test').tagName).toBe('STRONG')
    expect((drawer.getByRole('textbox', { name: 'Full name' }) as HTMLInputElement).value).toBe('Demo Clinician')
    expect(drawer.getByRole('textbox', { name: 'Phone' })).toBeDefined()
    for (const name of ['Job title (display only)', 'About you', 'Department (display only)']) expect(drawer.getByRole('textbox', { name })).toBeDefined()
    const language = drawer.getByRole('combobox', { name: 'Preferred language' })
    expect(within(language).getAllByRole('option').map(option => option.textContent)).toEqual(['English', 'Hausa', 'Igbo', 'Yoruba'])
    // No file input and no save: nothing leaves the page.
    expect(document.querySelector('.hid-ehr-drawer input[type="file"]')).toBeNull()
    expect(drawer.queryByRole('button', { name: /save/i })).toBeNull()
    fireEvent.change(drawer.getByRole('textbox', { name: 'About you' }), { target: { value: 'Fictional note' } })
    expect(sent.every(call => call.route === SESSION)).toBe(true)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})
