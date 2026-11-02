import { useEffect } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../productHostname'
import { BlueFrame } from '../../../ehr-blue/frame/BlueFrame'
import { BlueSignIn } from '../../../ehr-blue/frame/auth/BlueSignIn'
import { staffApi } from '../../../staff/api'
import { DEMO_LABORATORY, REAL_FACILITY } from './blueHarness'

/**
 * On a product's own site (lab., pharmacy., outreach., migrate.) the workspace is that product's (review, 2026-11-01):
 * a page that is neither the product's own nor one every product keeps opens the product's Home instead, whether its
 * address was typed or a sign-in returned to it. Patient registration is the EHR's only (owner rule), so it never opens
 * there. The page turned away never mounts, so it sends nothing; nothing goes round, and Back does not return to it.
 * What a product opens without listing it still opens: what the frame's own controls and the product's own pages lead
 * to, and Patients and Access requests.
 * Most pages are stand-ins here (what is tested is where the frame lands); Patient registration is the real page, and
 * its first read is watched; Consultation's stand-in notes that it mounted. Every account and facility is fictional,
 * and each host is only what the frame is told it runs on: nothing is sent there.
 */

const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))
// No request reaches the network: fetch is stubbed before any module loads, since the staff API client keeps the fetch
// it finds when staff/api.ts loads (this file's imports load it).
vi.hoisted(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 'UNEXPECTED_REQUEST' }), { status: 418, headers: { 'Content-Type': 'application/json' } }))
})
const staff = vi.hoisted(() => ({ permissions: [] as string[], roles: ['facility_admin'], facilityId: '',
  selfService: undefined as { review: string; organizationType: string } | undefined }))
/** The pages that mounted, by name (the stand-ins that note it). */
const mounted = vi.hoisted(() => [] as string[])

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: () => actual.resolveStaffProductHostname(host.name) }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: staff.facilityId, membershipId: 'member-1', organizationId: 'org-1', name: 'Riverside Facility (fictional)',
      roles: staff.roles, permissions: staff.permissions, isPrimary: true, ...(staff.selfService ? { selfService: staff.selfService } : {}) }
    return {
      state: { status: 'ready', session: { actor: { id: 'staff-1', email: 'admin@example.test', displayName: 'Demo Admin', roles: [], permissions: [],
        facilities: [facility], facility }, expiresAt: '2026-11-30T12:00:00.000Z' } },
      lock: null, signOut: async () => {}, refresh: async () => {}, activePatient: null, setActivePatient: () => true,
    }
  },
}))
vi.mock('../../../ehr-blue/departments/pharmacy/Pharmacy', async importOriginal => ({
  ...await importOriginal<object>(), Prescriptions: () => <h1>Prescriptions (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/laboratory/Laboratory', async importOriginal => ({
  ...await importOriginal<object>(), Laboratory: () => <h1>Work list (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/outreach/Outreach', async importOriginal => ({
  ...await importOriginal<object>(), Outreach: () => <h1>Outreach (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/migrate/Migrate', async importOriginal => ({
  ...await importOriginal<object>(), Migrate: () => <h1>Document OCR (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/audit/AuditCompliance', () => ({ AuditCompliance: () => <h1>Audit (stand-in)</h1> }))
vi.mock('../../../ehr-blue/frame/BlueSubscription', async importOriginal => ({
  ...await importOriginal<object>(), FacilitySubscriptionPage: () => <h1>Facility subscription (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/commerce/PaymentSetup', () => ({ PaymentSetup: () => <h1>Payment setup (stand-in)</h1> }))
vi.mock('../../../ehr-blue/onboarding/FacilitySetup', () => ({ FacilitySetup: () => <h1>Facility setup (stand-in)</h1> }))
vi.mock('../../../ehr-blue/clinical/consult/ConsultWorkspace', async importOriginal => ({
  ...await importOriginal<object>(), ConsultWorkspace: () => { mounted.push('Consultation'); return <h1>Consultation (stand-in)</h1> },
}))
vi.mock('../../../ehr-blue/clinical/consent/ConsentWorkspace', async importOriginal => ({
  ...await importOriginal<object>(), ConsentWorkspace: () => <h1>Access requests (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/clinical/patients/PatientsWorkspace', async importOriginal => ({
  ...await importOriginal<object>(), PatientsWorkspace: () => <h1>Patients (stand-in)</h1>,
}))

/** Every address the app went to, in order. */
let trail: string[] = []

/** A loop goes round without a pause: past this many addresses, the app is stopped, so the test fails instead of hanging. */
const ROUND = 25

function Trail() {
  const { pathname } = useLocation()
  useEffect(() => {
    trail.push(pathname)
    if (trail.length > ROUND) throw new Error(`The address went round: ${trail.slice(0, 6).join(' → ')} …`)
  }, [pathname])
  return <output data-testid="where">{pathname}</output>
}

/** The browser's Back button. */
function Back() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Back (test)</button>
}

beforeEach(() => {
  trail = []
  host.name = 'ehr.healthidentitydirectory.com'
  staff.permissions = []
  staff.roles = ['facility_admin']
  staff.facilityId = REAL_FACILITY
  staff.selfService = undefined
  mounted.length = 0
  // Patient registration reads the facility's registration capability as it opens. The read is watched here, and
  // never answered: the staff client holds a request until the real session provider says the session is ready.
  vi.spyOn(staffApi, 'registrationCapabilities').mockReturnValue(new Promise(() => {}))
})
afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => { vi.unstubAllGlobals() })

/**
 * Opens `entry` on `site` with `permissions` and waits for the page to settle; answers where it settled and its
 * heading. Addresses visited before it can be given, to go Back to. The sign-in page sits beside the workspace, and
 * today's own route (the staff invitation) inside it, as in the staff app, so a sign-in's return address can be opened.
 */
async function settle(site: string, permissions: readonly string[], entry: string, before: readonly string[] = []) {
  host.name = site
  staff.permissions = [...permissions]
  render(<MemoryRouter initialEntries={[...before, entry]} initialIndex={before.length}><Trail /><Back /><Routes>
    <Route path="/provider/sign-in" element={<BlueSignIn />} />
    <Route path="/provider" element={<BlueFrame />}>
      <Route path="staff/join" element={<h1>Join a facility (stand-in)</h1>} />
      <Route path="*" element={null} />
    </Route>
  </Routes></MemoryRouter>)
  return landed()
}

/** Waits for the page to settle; answers where it settled and its heading. */
async function landed() {
  const heading = await screen.findByRole('heading', { level: 1 })
  // Give a loop the time to show itself: the address must stay where it landed.
  const where = screen.getByTestId('where').textContent
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(screen.getByTestId('where').textContent).toBe(where)
  // /provider is passed once at most, never again on the way round.
  expect(trail.filter(address => address === '/provider').length).toBeLessThanOrEqual(1)
  return { where, heading: heading.textContent }
}

/** Whether Patient registration opened and asked Health ID anything: its first read is the facility's capability. */
const registrationAsked = () => vi.mocked(staffApi.registrationCapabilities).mock.calls.length > 0

/** Each product site, the permission that opens its own page, and where its Home settles. */
const SITES: readonly (readonly [string, string, string, string])[] = [
  ['lab.healthidentitydirectory.com', 'lab.work-item.read', '/provider/laboratory/work', 'Work list (stand-in)'],
  ['pharmacy.healthidentitydirectory.com', 'pharmacy.work-item.read', '/provider/pharmacy/prescriptions', 'Prescriptions (stand-in)'],
  ['outreach.healthidentitydirectory.com', 'outreach.registration.read', '/provider/outreach', 'Outreach (stand-in)'],
  ['migrate.staging.healthidentitydirectory.com', 'ocr.job.read', '/provider/ocr', 'Document OCR (stand-in)'],
]

/** The EHR's own pages, each with its permission: a role holding them still works on a product site as that product. */
const EHR_PAGES = ['identity.registration.write', 'ehr.encounter.read']

describe('a product site opens only its own pages and those every product keeps', () => {
  it.each(SITES)('%s: Patient registration, typed, opens the product’s Home and asks nothing', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], '/provider/registration')).toEqual({ where: home, heading })
    expect(registrationAsked()).toBe(false)
  })

  it.each(SITES)('%s: Patient registration, as a sign-in’s return address, opens the product’s Home and asks nothing', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], `/provider/sign-in?returnTo=${encodeURIComponent('/provider/registration')}`))
      .toEqual({ where: home, heading })
    expect(registrationAsked()).toBe(false)
  })

  it.each(SITES)('%s: Consultation, typed, opens the product’s Home without mounting', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], '/provider/clinical')).toEqual({ where: home, heading })
    expect(mounted).toEqual([])
  })

  it('a sign-in returning to Consultation on lab. opens the lab’s Home', async () => {
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read', ...EHR_PAGES], `/provider/sign-in?returnTo=${encodeURIComponent('/provider/clinical')}`))
      .toEqual({ where: '/provider/laboratory/work', heading: 'Work list (stand-in)' })
    expect(mounted).toEqual([])
  })

  it('a sample page (Appointments, open to a doctor) opens the product’s Home', async () => {
    staff.roles = ['doctor']
    expect(await settle('pharmacy.healthidentitydirectory.com', ['pharmacy.work-item.read'], '/provider/appointments'))
      .toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Prescriptions (stand-in)' })
  })

  it('the page turned away replaces its place in history: Back returns to the page before it', async () => {
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read', 'audit.read', ...EHR_PAGES], '/provider/registration', ['/provider/audit']))
      .toEqual({ where: '/provider/laboratory/work', heading: 'Work list (stand-in)' })
    fireEvent.click(screen.getByRole('button', { name: 'Back (test)' }))
    await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/audit'))
    expect(await landed()).toEqual({ where: '/provider/audit', heading: 'Audit (stand-in)' })
    expect(registrationAsked()).toBe(false)
  })

  it.each(SITES)('%s: its own page still opens at its address', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], home)).toEqual({ where: home, heading })
  })

  it.each(SITES)('%s: Audit, which every product keeps, still opens', async (site, own) => {
    expect(await settle(site, [own, 'audit.read'], '/provider/audit')).toEqual({ where: '/provider/audit', heading: 'Audit (stand-in)' })
  })

  it.each(SITES)('%s: an address no page takes is left to the frame’s own handling', async (site, own, home, heading) => {
    // Today the frame opens Home for it; where it says "Page not found", that heading is expected here instead.
    expect(await settle(site, [own], '/provider/no-such-page')).toEqual({ where: home, heading })
  })

  it('today’s own route (the staff invitation) still opens on lab.', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/staff/join'))
      .toEqual({ where: '/provider/staff/join', heading: 'Join a facility (stand-in)' })
  })
})

describe('what a product opens without listing it still opens', () => {
  it.each(SITES)('%s: Facility subscription, where the billing banner leads', async (site, own) => {
    expect(await settle(site, [own, 'billing.subscription.read'], '/provider/billing'))
      .toEqual({ where: '/provider/billing', heading: 'Facility subscription (stand-in)' })
  })

  it.each(SITES)('%s: Access requests, where the Notifications drawer leads', async (site, own) => {
    expect(await settle(site, [own, 'identity.consent.write'], '/provider/requests'))
      .toEqual({ where: '/provider/requests', heading: 'Access requests (stand-in)' })
  })

  it('lab.: Patients', async () => {
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read', 'identity.patient.read'], '/provider/patients'))
      .toEqual({ where: '/provider/patients', heading: 'Patients (stand-in)' })
  })

  it.each(SITES.slice(0, 2))('%s: Payment setup, where the product’s own Till leads when it has no tills', async (site, own) => {
    expect(await settle(site, [own, 'billing.settings.manage'], '/provider/payment-setup'))
      .toEqual({ where: '/provider/payment-setup', heading: 'Payment setup (stand-in)' })
  })

  it('lab., at a demo facility: the Demo chip’s “See what’s left” opens What’s left', async () => {
    staff.facilityId = DEMO_LABORATORY
    await settle('lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/laboratory/work')
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    fireEvent.click(screen.getByRole('button', { name: 'See what’s left' }))
    await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/whats-left'))
    expect(await landed()).toEqual({ where: '/provider/whats-left', heading: 'What’s left' })
  })

  it('lab.: Facility setup, for a laboratory that signed itself up, its staff manager', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.roles = ['org_admin']
    staff.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read', 'workforce.manage'], '/provider/onboarding'))
      .toEqual({ where: '/provider/onboarding', heading: 'Facility setup (stand-in)' })
  })
})

describe('sample links point only where the product opens a page', () => {
  /** Opens the Notifications drawer at a demo facility, for a doctor (the samples it lists are open to them). */
  async function recentActivity(site: string) {
    staff.facilityId = DEMO_LABORATORY
    staff.roles = ['doctor']
    await settle(site, ['lab.work-item.read', 'audit.read', 'ehr.encounter.read'], '/provider/audit')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    return within(screen.getByRole('dialog', { name: 'Notifications' })).queryByRole('heading', { name: /^Recent activity/ })
  }

  it('lab.: Notifications shows no Recent activity, whose rows would open the hospital’s samples', async () => {
    expect(await recentActivity('lab.healthidentitydirectory.com')).toBeNull()
  })

  it('the EHR still shows it', async () => {
    expect(await recentActivity('ehr.healthidentitydirectory.com')).not.toBeNull()
  })
})

describe('the EHR site is unchanged', () => {
  it('opens Patient registration, which reads the facility’s capability', async () => {
    const at = await settle('ehr.healthidentitydirectory.com', ['lab.work-item.read', ...EHR_PAGES], '/provider/registration')
    expect(at.where).toBe('/provider/registration')
    expect(registrationAsked()).toBe(true)
  })

  it('opens Consultation', async () => {
    expect(await settle('ehr.healthidentitydirectory.com', [...EHR_PAGES], '/provider/clinical'))
      .toEqual({ where: '/provider/clinical', heading: 'Consultation (stand-in)' })
    expect(mounted).toContain('Consultation')
  })

  it('opens a sample page for the role it is open to', async () => {
    staff.roles = ['doctor']
    expect((await settle('ehr.healthidentitydirectory.com', ['ehr.encounter.read'], '/provider/appointments')).where).toBe('/provider/appointments')
  })
})
