import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../productHostname'
import { BlueFrame } from '../../../ehr-blue/frame/BlueFrame'
import { BlueSignIn } from '../../../ehr-blue/frame/auth/BlueSignIn'
import { staffApi } from '../../../staff/api'
import { DEMO_LABORATORY, REAL_FACILITY } from './blueHarness'

/**
 * On a product's own site (lab., pharmacy., outreach., migrate.) the workspace is that product's (review, 2026-11-01):
 * a page that is neither the product's own nor one every product keeps opens the product's Home instead, whether its
 * address was typed or a sign-in returned to it. Patient registration is the EHR's only (owner rule), so it never opens
 * there. The page turned away never mounts, so it sends nothing; nothing goes round.
 * The product pages, Audit and Facility subscription are stand-ins here (what is tested is where the frame lands);
 * Patient registration and Consultation are the real pages, and Patient registration's first read is watched. Every
 * account and facility is fictional, and each host is only what the frame is told it runs on: nothing is sent there.
 */

const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))
// No request reaches the network: fetch is stubbed before any module loads, since the staff API client keeps the fetch
// it finds when staff/api.ts loads (this file's imports load it).
vi.hoisted(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 'UNEXPECTED_REQUEST' }), { status: 418, headers: { 'Content-Type': 'application/json' } }))
})
const staff = vi.hoisted(() => ({ permissions: [] as string[], roles: ['facility_admin'], facilityId: '' }))

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: () => actual.resolveStaffProductHostname(host.name) }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: staff.facilityId, membershipId: 'member-1', organizationId: 'org-1', name: 'Riverside Facility (fictional)',
      roles: staff.roles, permissions: staff.permissions, isPrimary: true }
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

beforeEach(() => {
  trail = []
  host.name = 'ehr.healthidentitydirectory.com'
  staff.permissions = []
  staff.roles = ['facility_admin']
  staff.facilityId = REAL_FACILITY
  // Patient registration reads the facility's registration capability as it opens. The read is watched here, and
  // never answered: the staff client holds a request until the real session provider says the session is ready.
  vi.spyOn(staffApi, 'registrationCapabilities').mockReturnValue(new Promise(() => {}))
})
afterAll(() => { vi.unstubAllGlobals() })

/**
 * Opens `entry` on `site` with `permissions` and waits for the page to settle; answers where it settled and its
 * heading. The sign-in page sits beside the workspace, as in the staff app, so a sign-in's return address can be opened.
 */
async function settle(site: string, permissions: readonly string[], entry: string) {
  host.name = site
  staff.permissions = [...permissions]
  render(<MemoryRouter initialEntries={[entry]}><Trail /><Routes>
    <Route path="/provider/sign-in" element={<BlueSignIn />} />
    <Route path="/provider/*" element={<BlueFrame />} />
  </Routes></MemoryRouter>)
  const heading = await screen.findByRole('heading', { level: 1 })
  // Give a loop the time to show itself: the address must stay where it landed.
  const landed = screen.getByTestId('where').textContent
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(screen.getByTestId('where').textContent).toBe(landed)
  // /provider is passed once at most, never again on the way round.
  expect(trail.filter(address => address === '/provider').length).toBeLessThanOrEqual(1)
  return { where: landed, heading: heading.textContent }
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

  it.each(SITES)('%s: Consultation, typed, opens the product’s Home', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], '/provider/clinical')).toEqual({ where: home, heading })
  })

  it('a sign-in returning to Consultation on lab. opens the lab’s Home', async () => {
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read', ...EHR_PAGES], `/provider/sign-in?returnTo=${encodeURIComponent('/provider/clinical')}`))
      .toEqual({ where: '/provider/laboratory/work', heading: 'Work list (stand-in)' })
  })

  it('a sample page (Appointments, open to a doctor) opens the product’s Home', async () => {
    staff.roles = ['doctor']
    expect(await settle('pharmacy.healthidentitydirectory.com', ['pharmacy.work-item.read'], '/provider/appointments'))
      .toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Prescriptions (stand-in)' })
  })

  it('a demo-only page (What’s left, at a demo facility) opens the product’s Home', async () => {
    staff.facilityId = DEMO_LABORATORY
    expect(await settle('lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/whats-left'))
      .toEqual({ where: '/provider/laboratory/work', heading: 'Work list (stand-in)' })
  })

  it.each(SITES)('%s: its own page still opens at its address', async (site, own, home, heading) => {
    expect(await settle(site, [own, ...EHR_PAGES], home)).toEqual({ where: home, heading })
  })

  it.each(SITES)('%s: Audit, which every product keeps, still opens', async (site, own) => {
    expect(await settle(site, [own, 'audit.read'], '/provider/audit')).toEqual({ where: '/provider/audit', heading: 'Audit (stand-in)' })
  })

  it.each(SITES)('%s: Facility subscription, where the billing banner leads, still opens', async (site, own) => {
    expect(await settle(site, [own, 'billing.subscription.read'], '/provider/billing'))
      .toEqual({ where: '/provider/billing', heading: 'Facility subscription (stand-in)' })
  })
})

describe('the EHR site is unchanged', () => {
  it('opens Patient registration, which reads the facility’s capability', async () => {
    const landed = await settle('ehr.healthidentitydirectory.com', ['lab.work-item.read', ...EHR_PAGES], '/provider/registration')
    expect(landed.where).toBe('/provider/registration')
    expect(registrationAsked()).toBe(true)
  })

  it('opens a sample page for the role it is open to', async () => {
    staff.roles = ['doctor']
    expect((await settle('ehr.healthidentitydirectory.com', ['ehr.encounter.read'], '/provider/appointments')).where).toBe('/provider/appointments')
  })
})
