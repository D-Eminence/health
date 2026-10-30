import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { parse } from '../../cssRules'
import type * as StaffApp from '../../../staff/App'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * The review's minor items (7a-j): where "Use the classic EHR" lands, tab titles on today's own routes, Needs
 * attention's empty line, role dashboards' links, the frame's CSS, plausible sample readings and the administration
 * samples as the design draws them. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const here = dirname(fileURLToPath(import.meta.url))
const frameRule = (selector: string) =>
  parse(readFileSync(resolve(here, '../../../ehr-blue/frame/frame.css'), 'utf8')).find(rule => rule.selectors.includes(selector))?.body

async function chooseClassic() {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use the classic EHR' }))
  expect(await screen.findByRole('complementary', { name: 'Provider navigation' })).toBeDefined()
}

describe('a. "Use the classic EHR" keeps an address only where today serves that exact address', () => {
  // A clinical page that takes the Patients stand-in's place, with records below it, as Ola's pages will.
  const chart: EhrBluePage = {
    path: 'patients/*', group: 'Clinical', label: 'Patients', status: 'live', permission: 'identity.patient.read', element: <p>Fictional patient chart</p>,
  }
  beforeEach(() => { withFramePages(() => [chart]) })

  it('opens today\'s Overview from a record below one of today\'s pages, which today\'s router does not serve', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/patients/p-0000aa11bb22')
    expect(await screen.findByText('Fictional patient chart')).toBeDefined()
    await chooseClassic()
    expect(where()).toBe('/provider')
  })

  it('stays on today\'s page at its own address', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/patients/')
    expect(await screen.findByText('Fictional patient chart')).toBeDefined()
    await chooseClassic()
    expect(where()).toBe('/provider/patients/')
  })
})

describe('b. today\'s own routes keep today\'s tab title inside the blue frame', () => {
  it('names the migration workspace', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/migrate')
    expect(await screen.findByRole('heading', { level: 1, name: 'Migration workspace unavailable' })).toBeDefined()
    await waitFor(() => expect(document.title).toBe('Migration workspace · Health ID EHR'))
  })

  it('names the staff invitation where today serves it (Novu), and says Page not found where it does not', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    const { unmount } = await openStaffApp('/provider/staff/join')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(document.title).toBe('Join a facility · Health ID EHR'))
    unmount()

    vi.unstubAllEnvs()
    vi.resetModules()
    withFramePages()
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/staff/join')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(document.title).toBe('Page not found · Health ID EHR'))
  })
})

describe('c. Needs attention says nothing needs attention only when it lists nothing', () => {
  const NOTHING = 'Nothing needs your attention here.'

  async function home(activePatient: StaffApp.ActivePatient | null) {
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.patient.read'])
    vi.doMock('../../../staff/App', async importOriginal => ({
      ...await importOriginal<typeof StaffApp>(),
      useStaff: () => ({
        state: { status: 'ready', session: { actor: { id: 'staff-demo-1', displayName: 'Demo Clinician', roles: [], permissions: [],
          facility: riverside, facilities: [riverside] }, expiresAt: '2026-11-30T12:00:00.000Z' } },
        activePatient, lock: null,
      }),
    }))
    const [{ BlueHome }, { AttentionProvider }, { RoleViewProvider }] = await Promise.all([
      import('../../../ehr-blue/home/BlueHome'), import('../../../ehr-blue/frame/attention'), import('../../../ehr-blue/frame/roleView'),
    ])
    render(<MemoryRouter><RoleViewProvider><AttentionProvider facilityId={riverside.id} permissions={riverside.permissions}>
      <BlueHome />
    </AttentionProvider></RoleViewProvider></MemoryRouter>)
    return within(screen.getByRole('heading', { name: 'Needs attention' }).closest('.hid-ehr-card') as HTMLElement)
  }

  it('says so when there are no access requests to count and no patient open', async () => {
    const card = await home(null)
    expect(card.getByText(NOTHING)).toBeDefined()
    expect(card.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('lists the open patient, and does not also say nothing needs attention', async () => {
    const open = { hid: 'HID-DEMO-001', purpose: 'direct-care', lookup: { patient: { fullName: 'Alex Example' } } } as unknown as StaffApp.ActivePatient
    const card = await home(open)
    expect(card.getByRole('link', { name: 'Alex Example' }).getAttribute('href')).toBe('/provider/clinical')
    expect(card.queryByText(NOTHING)).toBeNull()
  })
})

describe('d. role dashboards link sample records only into sample pages', () => {
  it('names a record of a workspace that is live here, links the others, and links every shortcut', async () => {
    const [{ RoleDashboard }, { RoleViewProvider }, { BluePagesProvider }, { BLUE_PAGES }, store] = await Promise.all([
      import('../../../ehr-blue/home/RoleDashboard'), import('../../../ehr-blue/frame/roleView'),
      import('../../../ehr-blue/frame/pageContext'), import('../../../ehr-blue/routes'), import('../../../ehr-blue/frame/sample/store'),
    ])
    render(<MemoryRouter><RoleViewProvider><BluePagesProvider value={BLUE_PAGES}><RoleDashboard role="Lab Scientist" /></BluePagesProvider></RoleViewProvider></MemoryRouter>)
    const attention = within(screen.getByRole('heading', { name: 'Needs attention' }).closest('.hid-ehr-card') as HTMLElement)
    // Laboratory is today's live page: a sample record there would open "Page not found".
    const lab = store.sampleTitle(store.sampleRecords('lab')[0]!)
    expect(attention.getByText(lab).tagName).toBe('STRONG')
    expect(attention.queryByRole('link', { name: lab })).toBeNull()
    expect(attention.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      `/provider/bloodbank/${store.sampleRecords('bloodbank')[0]!.id}`, `/provider/supply/${store.sampleRecords('inventory')[0]!.id}`,
    ])
    // A shortcut opens the page itself, live or sample (audit item 6): Laboratory is today's page at its own address.
    const shortcuts = within(screen.getByRole('heading', { name: 'Pinned shortcuts' }).nextElementSibling as HTMLElement)
    expect(shortcuts.getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Laboratory', '/provider/laboratory'], ['Blood Bank', '/provider/bloodbank'], ['Supply', '/provider/supply'],
    ])
  })
})

describe('e-g. frame.css', () => {
  it('e. lets a long action in a card wrap at phone width', () => {
    expect(frameRule('.hid-ehr .hid-ehr-blue-facility-card .hid-ehr-button')).toMatch(/white-space:\s*normal/)
  })

  it('f. keeps the collapsed sidebar\'s mark square, not a squashed wordmark', () => {
    const rule = frameRule('.hid-ehr .hid-ehr-sidebar-collapsed .hid-ehr-blue-logo')
    expect(rule).toMatch(/width:\s*32px/)
    expect(rule).toMatch(/height:\s*32px/)
  })

  it('g. draws no ring around the workspace chooser\'s heading, which takes focus only for screen readers', () => {
    expect(frameRule('.hid-ehr .hid-ehr-blue-chooser .hid-ehr-page-title:focus')).toMatch(/outline:\s*none/)
  })
})

describe('i. sample readings are plausible', () => {
  it('gives triage records an adult\'s vital signs, matching their priority', async () => {
    const { sampleRecords } = await import('../../../ehr-blue/frame/sample/store')
    const triage = sampleRecords('triage')
    expect(triage.map(record => record.fields.priority)).toEqual(['Routine', 'Urgent', 'Emergency'])
    for (const { fields } of triage) {
      expect(String(fields.bp)).toMatch(/^\d{2,3}\/\d{2,3}$/)
      const [systolic, diastolic] = String(fields.bp).split('/').map(Number)
      expect(systolic).toBeGreaterThan(diastolic!)
      expect(Number(fields.pulse)).toBeGreaterThanOrEqual(40)
      expect(Number(fields.pulse)).toBeLessThanOrEqual(180)
      expect(Number(fields.temperature)).toBeGreaterThanOrEqual(35)
      expect(Number(fields.temperature)).toBeLessThanOrEqual(41)
      expect(Number(fields.spo2)).toBeGreaterThanOrEqual(80)
      expect(Number(fields.spo2)).toBeLessThanOrEqual(100)
      for (const key of ['complaint', 'bp', 'pulse', 'temperature', 'spo2', 'observations']) expect(String(fields[key])).not.toMatch(/fictional/i)
    }
  })

  it('gives nursing entries and ICU admissions words that fit them', async () => {
    const { sampleRecords } = await import('../../../ehr-blue/frame/sample/store')
    const nursing = sampleRecords('nursing')
    expect(nursing[0]!.fields.category).toBe('Vitals')
    expect(String(nursing[0]!.fields.note)).toMatch(/^BP \d+\/\d+ mmHg, pulse \d+ bpm/)
    expect(nursing[1]!.fields.category).toBe('Medication administration')
    expect(String(nursing[1]!.fields.units)).toMatch(/^\d+ mg$/)
    const reasons = sampleRecords('icu').map(record => String(record.fields.reason))
    expect(reasons).not.toContain('Review of results')
    expect(reasons.every(reason => !/\(fictional\)$/.test(reason) && reason.length > 0)).toBe(true)
  })
})

describe('j. the administration samples, as screens/admin draws them', () => {
  async function open(name: 'PlatformReviewSample' | 'FacilityProfileSample' | 'FacilitySetupSample' | 'ReportsSample') {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const samples = await import('../../../ehr-blue/frame/admin/AdminSamples')
    const Sample = samples[name]
    const view = render(<MemoryRouter><Sample /></MemoryRouter>)
    return { fetch, view }
  }

  afterEach(() => {
    // Samples upload, store and download nothing.
    expect(document.querySelector('input[type="file"], a[download]')).toBeNull()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('Facility review: each facility\'s card, with an outcome and a reason both required', async () => {
    const { fetch } = await open('PlatformReviewSample')
    expect(screen.getByText('Platform administration').nextElementSibling).toBe(screen.getByRole('heading', { level: 1, name: 'Facility review' }))
    const cedar = within(screen.getByRole('heading', { level: 2, name: 'Fictional Cedar Hospital' }).closest('.hid-ehr-card') as HTMLElement)
    expect(screen.getByRole('heading', { level: 2, name: 'Fictional Partner Clinic' })).toBeDefined()
    expect(cedar.getByText('Not submitted')).toBeDefined()
    expect(cedar.getByText('Registration').nextElementSibling?.textContent).toBe('Not provided')

    fireEvent.click(cedar.getByRole('button', { name: 'Save review' }))
    expect(cedar.getAllByText('Complete this field.')).toHaveLength(2)
    expect(cedar.getByRole('combobox', { name: 'Review outcome' }).getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(cedar.getByRole('combobox', { name: 'Review outcome' }), { target: { value: 'Verified' } })
    fireEvent.change(cedar.getByRole('textbox', { name: 'Review reason' }), { target: { value: 'Fictional documents checked.' } })
    fireEvent.click(cedar.getByRole('button', { name: 'Save review' }))
    expect(cedar.getByText('Verified', { selector: '.hid-ehr-badge' })).toBeDefined()
    expect(cedar.getByRole('status').textContent).toBe('Review saved in this sample: Verified.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Facility profile: the design\'s sections, with no logo upload, and each save in the change history', async () => {
    await open('FacilityProfileSample')
    expect(screen.getByRole('heading', { level: 2, name: 'Hospital details & picture' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Facility presence policy' })).toBeDefined()
    expect(screen.getByRole('checkbox', { name: 'Enable facility presence' })).toHaveProperty('checked', true)
    expect(screen.getByRole('spinbutton', { name: 'Away after inactivity (minutes)' })).toHaveProperty('value', '5')
    expect(screen.getByText('FC').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('heading', { level: 3, name: 'Operations & regulatory details' })).toBeDefined()
    expect(screen.getByText('Facility verification · Not submitted')).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Verification history' })).toBeDefined()

    const details = within(screen.getByRole('form', { name: 'Hospital details' }))
    fireEvent.change(details.getByRole('textbox', { name: 'Hospital email' }), { target: { value: 'not an email' } })
    fireEvent.click(details.getByRole('button', { name: 'Save hospital details' }))
    expect(details.getByText('Enter an email address like name@example.com.')).toBeDefined()
    fireEvent.change(details.getByRole('textbox', { name: 'Hospital email' }), { target: { value: 'cedar@example.test' } })
    fireEvent.click(details.getByRole('button', { name: 'Save hospital details' }))
    const history = within(screen.getByRole('heading', { level: 3, name: 'Profile change history' }).parentElement!)
    expect(history.getByText(/· You · Hospital name, Hospital phone, Hospital email, Hospital address$/)).toBeDefined()
  })

  it('Facility settings: opens at step 9 of 9, Launch, and moves between the nine steps', async () => {
    await open('FacilitySetupSample')
    expect(screen.getByText('Step 9 of 9 · Launch')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Facility settings' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save and exit' })).toBeDefined()
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' }))
    expect(steps.getAllByRole('button').map(button => button.textContent)).toEqual([
      '1. Facility', '2. Type', '3. Departments', '4. Branches', '5. Staff', '6. Roles', '7. Billing', '8. Review', '9. Launch',
    ])
    expect(steps.getByRole('button', { name: '9. Launch' }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('heading', { level: 2, name: 'Hospital is launched' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open dashboard' }).getAttribute('href')).toBe('/provider')

    fireEvent.click(steps.getByRole('button', { name: '3. Departments' }))
    expect(screen.getByText('Step 3 of 9 · Departments')).toBeDefined()
    for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(screen.getByRole('alert').textContent).toBe('Select at least one department.')
    fireEvent.click(screen.getByRole('checkbox', { name: /^ICU/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(screen.getByText('Step 4 of 9 · Branches')).toBeDefined()
    expect(screen.getByText(/Main branch · 1 Example Road · ICU$/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 3 of 9 · Departments')).toBeDefined()
  })

  it('Reports & Analytics: the date range, the scope and the figures, and no export', async () => {
    await open('ReportsSample')
    expect(screen.getByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
    const figure = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent
    expect(figure('Visits')).toBe('6')
    expect(figure('Outstanding')).toBe('26000')
    expect(figure('Quality Rates')).toBe('No data — no validated denominator')
    expect(screen.queryByRole('button', { name: 'Export report' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-11-01' } })
    expect(figure('Visits')).toBe('0')
    fireEvent.change(screen.getByLabelText('Created through'), { target: { value: '2026-10-01' } })
    expect(screen.getByRole('alert').textContent).toBe('Start date must precede end date.')
    expect(screen.queryByText('Visits')).toBeNull()
  })
})
