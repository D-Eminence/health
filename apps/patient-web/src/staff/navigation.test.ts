import { describe, expect, it, vi } from 'vitest'
import type { Facility, StaffSession } from './api'
import { PROVIDER_NAVIGATION, staffLandingPath } from './navigation'
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
