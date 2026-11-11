import { screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import type { FacilityProfileValues, StaffSession } from '../../../staff/api'
import { REAL_FACILITY, json, problem } from '../frame/blueHarness'

/*
 * Facility setup's tests: a fictional facility that signed itself up ("Riverside Teaching Hospital (fictional)"), its
 * administrator and its staff, and the blue EHR's registry with this folder's page in it. Every account here is
 * fictional, with example.test addresses.
 */

export const STAFF = 'GET /api/v1/identity/facility-staff'
/** The facility's details (hid-system 0122), read as Facility setup opens and saved by its Facility step. */
export const PROFILE = 'GET /api/v1/identity/facility-profile'
export const SAVE_PROFILE = 'POST /api/v1/identity/facility-profile'
export const RIVERSIDE = 'Riverside Teaching Hospital (fictional)'

export type Review = 'pending' | 'reviewed'

/** A facility membership as the session reports it; `review` null for a governed facility (no self sign-up). */
export function membership({ id = REAL_FACILITY, name = RIVERSIDE, review = 'reviewed' as Review | null,
  permissions = ['workforce.manage'] as readonly string[] } = {}) {
  return {
    id, membershipId: `member-${id}`, organizationId: 'org-demo', name, roles: ['org_admin'], permissions: [...permissions], isPrimary: true,
    ...(review ? { selfService: { review, organizationType: 'hospital' } } : {}),
  }
}

/** The session answer for an administrator working at `current`. */
export function sessionWith(current: ReturnType<typeof membership>) {
  return () => json({
    actor: { id: 'staff-demo-1', email: 'demo.admin@example.test', displayName: 'Demo Administrator', roles: ['org_admin'],
      permissions: [], facilities: [current], facility: current },
    expiresAt: '2026-11-30T12:00:00.000Z',
  })
}

/** The same, as page code reads it (visible()). */
export function staffSession(current: ReturnType<typeof membership>): StaffSession {
  return { actor: { kind: 'staff', id: 'staff-demo-1', email: 'demo.admin@example.test', displayName: 'Demo Administrator',
    roles: ['org_admin'], permissions: [], facilities: [current], facility: current }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

/** Today's staff answer for `facility`: its administrator alone, nobody invited yet. */
export function staffAnswer(facility = RIVERSIDE, id = REAL_FACILITY, review: Review = 'reviewed') {
  return () => json({
    facility: { id, name: facility, organizationType: 'hospital', reviewState: review, firstThirtyDaysEndAt: null, invitationsOpen: true,
      deliveryPaused: false },
    canInvite: review === 'reviewed',
    limits: { pendingInvitations: 0, pendingLimit: 100, invitationsToday: 0, invitationsPerDay: 30, emailsToday: 0, emailsPerDay: 60 },
    inviteOptions: { roles: [], attestation: null }, administratorLicence: null, administratorLicenceBodies: [],
    members: [{ membershipId: '5e0a1b2c-0000-4000-8000-00000000a001', version: 1, accountId: 'account-demo-1', name: 'Demo Administrator',
      email: 'demo.admin@example.test', roles: ['org_admin'], isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z',
      licence: null }],
    invitations: [],
  })
}

export const many = <T,>(answer: T, count = 6): T[] => Array.from({ length: count }, () => answer)

/**
 * The next app a test opens runs the blue EHR on the frame's own registry and Home, with Facility setup added as the
 * frame finds it (./onboarding/pages.ts). Registered per test: a vi.mock factory's module outlives vi.resetModules.
 */
export function withOnboardingPages() {
  vi.doMock('../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../ehr-blue/frame/pages')
    const home = await import('../../../ehr-blue/home/pages')
    const onboarding = await import('../../../ehr-blue/onboarding/pages')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './onboarding/pages.ts': onboarding }),
    }
  })
}

export const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
export const stepper = () => screen.getByRole('navigation', { name: 'Onboarding steps' })
export const stepButton = (name: string) => within(stepper()).getByRole('button', { name: new RegExp(`^\\d\\. ${name}$`) })
/** The eyebrow the design draws over the heading ("Step 3 of 9 · Departments"). */
export const eyebrow = () => document.querySelector('.hid-ehr-onboarding .hid-ehr-page-eyebrow')?.textContent ?? ''
export const heading = () => screen.getByRole('heading', { level: 1, name: /Set up your facility$/ })


/** A facility profile as Identity holds it (contract §1, §4): every field given, fictional. */
export const SAVED_PROFILE: FacilityProfileValues = {
  tradingName: 'Riverside Hospital', ownership: 'private', careLevel: 'tertiary', addressLine: '2 Fiction Close', city: 'Ikeja',
  stateCode: 'LA', lga: 'Ikeja', gpsLatitude: 6.6, gpsLongitude: 3.35, phone: '+2348000000001', email: 'desk@riverside.example.test',
  bedCount: 120, operatingHours: 'Mon-Sun 24 hours', emergency24h: true, departments: ['general_outpatient', 'emergency'],
  servicesOffered: 'Outpatient and emergency care', smohLicenceNumber: 'LA/SMOH/0001', hasRegistryId: true, registryId: 'NHFR-0001',
  hasNhiaAccreditation: false, nhiaAccreditationNumber: null, medicalDirectorName: 'Dr Fiction Director',
  medicalDirectorMdcn: 'MDCN/00001', expectedStaff: 80, migratingRecords: true, needsInteroperability: false,
}

/** GET …/facility-profile: the facility's details at `version`, or none yet (version 0). */
export function profileAnswer(profile: FacilityProfileValues | null = null, version = profile ? 3 : 0, name = RIVERSIDE,
  id = REAL_FACILITY) {
  return () => json({ facility: { id, name, reviewState: 'reviewed' }, version,
    profile: profile ? { ...profile, source: 'self_service_signup', submitterRole: 'owner', submitterPhoneOnRecord: true,
      updatedAt: '2026-11-10T10:00:00.000Z', version } : null })
}

/** Identity keeps this facility's details itself (a governed or demo facility): the read is refused. */
export const profileKept = () => problem(403, 'STAFF_MANAGEMENT_NOT_AVAILABLE', 'Not a self-service facility.')
