import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { designGrants, designRolesOf, moduleOf, sampleCan } from '../../../ehr-blue/frame/sampleAccess'
import { pages as framePages } from '../../../ehr-blue/frame/pages'
import type { StaffSession } from '../../../staff/api'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, homeHeading, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * Who may open a sample workspace: the design's role mapping (design/ehr-target src/catalog.ts permissions(role)), for
 * the person's roles or the demo role whose Home is being viewed; live pages keep their live permission. A page the
 * role may not open opens Home with the design's notice; an address that is no page says "Page not found". Every
 * account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const NOTICE = 'Your current permissions no longer allow that page. Choose an authorized workflow.'
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const groupsOf = () => within(nav()).queryAllByRole('button').map(button => button.firstChild?.textContent)
const linksOf = () => within(nav()).getAllByRole('link').map(link => link.textContent)
function sessionWith(roles: readonly string[], at = DEMO_HOSPITAL): StaffSession {
  const current = facility(at, 'Demo Hospital', [], roles)
  return { actor: { id: 'staff-demo-1', displayName: 'Demo Clinician', roles: ['clinician'], permissions: [], facilities: [current], facility: current },
    expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

/** Opens a page from What's left's table, which links every page (the demo's own page: open to every role). */
function openFromWhatsLeft(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  fireEvent.click(screen.getByRole('button', { name: 'See what’s left' }))
  fireEvent.click(within(screen.getByRole('table', { name: 'Pages and their status' })).getByRole('link', { name: label }))
}

async function openAs(roles: readonly string[], path = '/provider') {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [], roles)
  const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('the design\'s grants', () => {
  it('ports permissions(role): a Cashier works in Patient billing, Claims and Reports only', () => {
    const cashier = designGrants('Cashier')
    expect([...cashier].sort()).toEqual([
      'billing.collect-payment', 'billing.view', 'dashboard.view', 'insurance.collect-payment', 'insurance.view', 'notifications.view',
      'profile.view', 'reports.view',
    ])
  })

  it('gives Facility review to the Platform Super Admin alone', () => {
    expect(sampleCan(['Platform Super Admin'], 'platform')).toBe(true)
    for (const role of ['Hospital Owner', 'Hospital Admin', 'Medical Director', 'Doctor'] as const) expect(sampleCan([role], 'platform')).toBe(false)
  })

  it('checks a verb: a Hospital Admin views patient billing, an Owner refunds it', () => {
    expect(sampleCan(['Hospital Admin'], 'billing')).toBe(true)
    expect(sampleCan(['Hospital Admin'], 'billing', 'refund')).toBe(false)
    expect(sampleCan(['Hospital Owner'], 'billing', 'refund')).toBe(true)
    expect(sampleCan(['Nurse'], 'patients', 'create')).toBe(false)
    expect(sampleCan(['Receptionist'], 'patients', 'create')).toBe(true)
  })

  it('maps Health ID\'s roles to the design\'s, and takes their union', () => {
    expect(designRolesOf(sessionWith(['org_admin', 'clinician', 'doctor']), null)).toEqual(['Hospital Admin', 'Doctor'])
    expect(designRolesOf(sessionWith(['lab', 'pharmacist', 'receptionist', 'records_officer', 'billing', 'nurse']), null))
      .toEqual(['Lab Scientist', 'Pharmacist', 'Receptionist', 'Records Officer', 'Billing Officer', 'Nurse'])
    expect(designRolesOf(sessionWith(['org_admin_awaiting_review']), null)).toEqual([])
    expect(designRolesOf(null, null)).toEqual([])
  })

  it('takes the demo role being viewed instead, at a demo facility only', () => {
    expect(designRolesOf(sessionWith(['clinician']), 'Cashier')).toEqual(['Cashier'])
    expect(designRolesOf(sessionWith(['clinician'], REAL_FACILITY), 'Cashier')).toEqual(['Doctor'])
  })

  it('names each frame address by its design module', () => {
    const at = (path: string) => moduleOf(framePages.find(page => page.path === path)!)
    expect(at('patient-billing/*')).toBe('billing')
    expect(at('supply/*')).toBe('inventory')
    expect(at('appointments/*')).toBe('appointments')
    expect(at('platform')).toBe('platform')
    expect(at('')).toBe('dashboard')
    // The tour is no module of the design's: the demo facilities show it to everyone.
    expect(at('tour')).toBeNull()
  })
})

describe('the sidebar follows the design\'s roles', () => {
  // Only working screens are listed (the owner's decision of 2026-10-31), so the design's roles decide a sample by address.
  it('opens a receptionist Appointments and Patient visits, and sends finance and administration Home', async () => {
    await openAs(['receptionist'], '/provider/appointments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
    expect(screen.queryByText(NOTICE)).toBeNull()
    for (const name of ['Appointments', 'Patient visits', 'Patient billing', 'Facility review', 'Radiology']) expect(linksOf()).not.toContain(name)
    expect(groupsOf()).not.toContain('Finance')
    expect(groupsOf()).not.toContain('People')
    openFromWhatsLeft('Patient visits')
    expect(await screen.findByRole('heading', { level: 1, name: 'Patient visits' })).toBeDefined()
    expect(screen.queryByText(NOTICE)).toBeNull()
    for (const label of ['Patient billing', 'Inpatient / Wards', 'Maternity', 'Shifts & Roster', 'Facility review', 'Radiology']) {
      openFromWhatsLeft(label)
      expect(await screen.findByText(NOTICE)).toBeDefined()
      expect({ label, at: where() }).toEqual({ label, at: '/provider' })
    }
  })

  it('lists Choose workspace beside Home for whoever has a facility to switch to, and Patient registration and In-person check, live as today', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.write', 'identity.patient.assisted_registration'])
    const annex = facility(REAL_FACILITY, 'Riverside Annex (fictional)', [])
    serve({ [SESSION]: [sessionAt(demo, [demo, annex])] })
    await openStaffApp('/provider/registration')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    // The redesign's sidebar lists the live facility switch beside Home (EhrBlueSwitchReview).
    expect(linksOf()).toContain('Choose workspace')
    // Listed until Patients › Create record is their way in.
    expect(linksOf()).toEqual(expect.arrayContaining(['Patient registration', 'In-person check']))
    expect(where()).toBe('/provider/registration')
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(document.querySelector('.hid-ehr-blue-live')).not.toBeNull()
  })

  // The redesign offers no demo role dashboards (EhrBlueSwitchReview): a Billing Officer's own roles decide instead.
  it('opens a Billing Officer Patient billing, and sends a page it lacks to Home with the notice', async () => {
    await openAs(['billing'], '/provider/patient-billing')
    expect(await screen.findByRole('heading', { level: 1, name: 'Patient billing' })).toBeDefined()
    expect(screen.queryByText(NOTICE)).toBeNull()
    // What's left links every page, Appointments included.
    openFromWhatsLeft('Appointments')
    expect(await screen.findByText(NOTICE)).toBeDefined()
    expect(where()).toBe('/provider')
    expect(screen.getByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
  })
})

describe('Home in place of a refused page, and Page not found for an unknown one', () => {
  it('sends a page the role may not open to Home, with the design\'s notice, until it is dismissed', async () => {
    const sent = await openAs(['receptionist'], '/provider/patient-billing')
    expect(await screen.findByText(NOTICE)).toBeDefined()
    expect(where()).toBe('/provider')
    const notice = screen.getByText(NOTICE).closest('.hid-ehr-blue-redirect-notice')!
    // Above the heading.
    expect(notice.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Dismiss notice' }))
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull())
    expect(where()).toBe('/provider')
    // Nothing of the refused page was read, and nothing is kept in the browser.
    expect(sent.every(call => call.route === SESSION)).toBe(true)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('leaves a page\'s own notice to the page: Patients\' "closed" after Close my grant shows no frame notice', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp({ pathname: '/provider/patients', state: { notice: 'closed' } })
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(where()).toBe('/provider/patients')
    expect(document.querySelector('.hid-ehr-blue-redirect-notice')).toBeNull()
  })

  it('says Page not found for an address that is no page, without the notice, and reads nothing', async () => {
    const sent = await openAs(['receptionist'], '/provider/not-a-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeDefined()
    expect(where()).toBe('/provider/not-a-page')
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/provider')
    expect(sent.every(call => call.route === SESSION)).toBe(true)
  })
})

describe('useSampleCan', () => {
  /**
   * Opens a fictional page that says what the hook answers for creating a patient record and for viewing patient
   * billing. The hook is imported once fetch is served, as the app is: the session client keeps the fetch it finds.
   */
  async function openProbe(roles: readonly string[], path: string) {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [], roles)
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    const { useSampleCan } = await import('../../../ehr-blue/frame/sampleAccess')
    function Probe() {
      const can = useSampleCan()
      return <p>{`patients.create ${can('patients', 'create')} · billing.view ${can('billing')}`}</p>
    }
    withFramePages(() => [{ path: 'probe', group: 'Clinical', label: 'Probe (fictional)', status: 'live', element: <Probe /> }])
    await openStaffApp(path)
    await screen.findByRole('navigation', { name: 'Main navigation' })
  }

  it('answers for the signed-in person\'s design roles', async () => {
    await openProbe(['receptionist'], '/provider/probe')
    expect(await screen.findByText('patients.create true · billing.view false')).toBeDefined()
  })

  // The demo role view has no control in the redesign; designRolesOf's own test covers it. Another role answers otherwise.
  it('answers for another person\'s design roles: a Billing Officer\'s', async () => {
    await openProbe(['billing'], '/provider/probe')
    expect(await screen.findByText('patients.create false · billing.view true')).toBeDefined()
  })
})
