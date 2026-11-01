import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Facility, StaffSession } from './api'
import { PROVIDER_NAVIGATION, staffLandingPath, visibleNavigation } from './navigation'
import { roleInSentence, roleLabel, roleLabels } from './staffAccess'
import { ASSISTED_REGISTRATION_PERMISSION } from './routes/InPersonCheck'
import { STAFF_PRODUCT_ROUTES } from '../productHostname'

// The In-person check's page module reaches the staff API, which reads the build's environment.
vi.mock('./env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.example.test',
  turnstileSiteKey: null }) }))

/**
 * What Novu grants a facility administrator who signed the facility up (org_admin, migrations 0006, 0011, 0024,
 * 0038): no clinical, Laboratory, Pharmacy or OCR permission (P4).
 */
const ORG_ADMIN = ['organization.manage', 'workforce.manage', 'audit.read', 'identity.registration.write',
  'identity.registration.approve', 'outreach.registration.read', 'outreach.registration.write',
  'outreach.campaign.read', 'outreach.campaign.write']

function facility(id: string, permissions: string[]): Facility {
  return { id, membershipId: `membership-${id}`, organizationId: 'org-1', name: `Facility ${id}`, roles: [], permissions,
    isPrimary: id === 'one' }
}

function session(permissions: string[] | null, extra: Partial<StaffSession> = {}, facilities = 1): StaffSession {
  const all = Array.from({ length: facilities }, (_, index) => facility(index === 0 ? 'one' : `f${index}`, permissions ?? []))
  return { actor: { id: 'staff-1', roles: [], permissions: [], facilities: all,
    ...(permissions ? { facility: all[0]! } : {}) }, ...extra }
}

describe('the page a staff sign-in opens', () => {
  it.each([
    [STAFF_PRODUCT_ROUTES.ehr, 'ehr.encounter.read'],
    [STAFF_PRODUCT_ROUTES.lab, 'lab.work-item.read'],
    [STAFF_PRODUCT_ROUTES.pharmacy, 'pharmacy.work-item.read'],
    [STAFF_PRODUCT_ROUTES.migrate, 'ocr.job.read'],
  ])('is the Overview, not %s, for a facility administrator without %s', (route, permission) => {
    expect(staffLandingPath(route, session(ORG_ADMIN))).toBe('/provider')
    expect(staffLandingPath(route, session([...ORG_ADMIN, permission]))).toBe(route)
  })

  it('keeps Outreach for a facility administrator, who can use it', () => {
    expect(staffLandingPath(STAFF_PRODUCT_ROUTES.outreach, session(ORG_ADMIN))).toBe('/provider/outreach')
  })

  it('judges any sidebar page the same way, and keeps the Overview and pages outside the sidebar', () => {
    expect(staffLandingPath('/provider/patients', session(ORG_ADMIN))).toBe('/provider')
    expect(staffLandingPath('/provider/registration', session(ORG_ADMIN))).toBe('/provider/registration')
    expect(staffLandingPath('/provider', session([]))).toBe('/provider')
    expect(staffLandingPath('/provider/migrate', session([]))).toBe('/provider/migrate')
  })

  it('keeps the page asked for while the working facility is not known or still to be chosen', () => {
    expect(staffLandingPath(STAFF_PRODUCT_ROUTES.ehr, session(null))).toBe(STAFF_PRODUCT_ROUTES.ehr)
    expect(staffLandingPath(STAFF_PRODUCT_ROUTES.ehr, session(ORG_ADMIN, { facilitySelection: 'default' }, 2)))
      .toBe(STAFF_PRODUCT_ROUTES.ehr)
    expect(staffLandingPath(STAFF_PRODUCT_ROUTES.ehr, session(ORG_ADMIN, { facilitySelection: 'reselect' })))
      .toBe(STAFF_PRODUCT_ROUTES.ehr)
    expect(staffLandingPath(STAFF_PRODUCT_ROUTES.ehr, session(ORG_ADMIN, { facilitySelection: 'selected' }, 2))).toBe('/provider')
  })

  it('reads the sidebar’s permissions: the In-person check’s is its page’s own', () => {
    expect(PROVIDER_NAVIGATION.find(item => item.to === '/provider/in-person-check')?.permission)
      .toBe(ASSISTED_REGISTRATION_PERMISSION)
    for (const route of Object.values(STAFF_PRODUCT_ROUTES)) {
      expect(PROVIDER_NAVIGATION.some(item => item.to === route), route).toBe(true)
    }
  })
})

/**
 * Until Health ID support has checked a self-signed-up facility, its administrator holds org_admin_awaiting_review:
 * six of org_admin's permissions (P4b SPEC 3.3). The Staff page is listed only at such a facility, and only on Novu.
 */
const AWAITING_REVIEW = ['workforce.manage', 'audit.read', 'outreach.registration.read', 'outreach.registration.write',
  'outreach.campaign.read', 'outreach.campaign.write']

describe('the sidebar at a self-signed-up facility (P4b)', () => {
  const at = (permissions: string[], selfService?: { review: string; organizationType: string }) => ({ permissions,
    ...(selfService ? { selfService } : {}) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('lists the Overview, Facility audit, Staff and Outreach for the administrator awaiting review', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    expect(visibleNavigation(at(AWAITING_REVIEW, { review: 'pending', organizationType: 'hospital' })).map(item => item.label))
      .toEqual(['Overview', 'Facility audit', 'Staff', 'Outreach'])
  })

  it('opens the Overview, not a product page, for the administrator awaiting review', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    for (const route of [STAFF_PRODUCT_ROUTES.ehr, STAFF_PRODUCT_ROUTES.lab, STAFF_PRODUCT_ROUTES.pharmacy]) {
      expect(staffLandingPath(route, session(AWAITING_REVIEW))).toBe('/provider')
    }
    expect(staffLandingPath('/provider/staff', session(AWAITING_REVIEW))).toBe('/provider/staff')
  })

  it.each([
    ['at a governed facility, whose staff Health ID support manages', 'novu-v1', undefined],
    ['on a main-v1 build', 'main-v1', { review: 'reviewed', organizationType: 'clinic' }],
  ])('leaves Staff out %s', (_, contract, selfService) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    expect(visibleNavigation(at(ORG_ADMIN, selfService)).map(item => item.to)).not.toContain('/provider/staff')
  })

  it('lists Staff only with workforce.manage, after review too', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const reviewed = { review: 'reviewed', organizationType: 'laboratory' }
    expect(visibleNavigation(at([...ORG_ADMIN, 'lab.work-item.read'], reviewed)).map(item => item.label))
      .toEqual(['Overview', 'Patient registration', 'Facility audit', 'Staff', 'Laboratory', 'Outreach'])
    expect(visibleNavigation(at(['lab.work-item.read'], reviewed)).map(item => item.label)).toEqual(['Overview', 'Laboratory'])
  })
})

describe('role names shown to staff', () => {
  it.each([
    ['org_admin', 'Facility administrator'], ['org_admin_awaiting_review', 'Facility administrator'], ['doctor', 'Doctor'],
    ['clinician', 'Clinician'], ['nurse', 'Nurse'], ['lab', 'Laboratory scientist'], ['pharmacist', 'Pharmacist'],
    ['receptionist', 'Receptionist'], ['records_officer', 'Staff'],
  ])('%s reads “%s”', (code, label) => {
    expect(roleLabel(code)).toBe(label)
  })

  it('names the administrator once whichever of the two roles it holds, and reads well in a sentence', () => {
    expect(roleLabels(['org_admin', 'org_admin_awaiting_review', 'nurse'])).toBe('Facility administrator, Nurse')
    expect(roleInSentence('lab')).toBe('a laboratory scientist')
    expect(roleInSentence('org_admin')).toBe('a facility administrator')
  })
})

/**
 * P4c's three permissions (0086 §6.1): doctor and clinician gain ehr.order-route.send, lab gains lab.order-route.receive,
 * pharmacist gains pharmacy.order-route.receive. None opens a page of its own: sending lives on the Clinical record, and
 * Incoming on the Laboratory and Pharmacy pages those roles already open.
 */
describe('the sidebar with orders between facilities (P4c)', () => {
  const at = (permissions: string[]) => visibleNavigation({ permissions }).map(item => item.label)
  afterEach(() => { vi.unstubAllEnvs() })

  it('opens no page for any of the three permissions alone', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    for (const permission of ['ehr.order-route.send', 'lab.order-route.receive', 'pharmacy.order-route.receive']) {
      expect(at([permission]), permission).toEqual(['Overview'])
      expect(PROVIDER_NAVIGATION.some(item => item.permission === permission), permission).toBe(false)
    }
  })

  it('keeps each role’s pages as they were with its new permission', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    expect(at(['ehr.encounter.read', 'ehr.lab-request.write', 'ehr.order-route.send'])).toEqual(['Overview', 'Clinical record'])
    expect(at(['lab.work-item.read', 'lab.order-route.receive'])).toEqual(['Overview', 'Laboratory'])
    expect(at(['pharmacy.work-item.read', 'pharmacy.order-route.receive'])).toEqual(['Overview', 'Pharmacy'])
  })
})
