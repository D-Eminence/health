import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { expect, vi } from 'vitest'
import { json, REAL_FACILITY } from '../../frame/blueHarness'

/*
 * Shared fixtures for the inpatient pages' tests (hid-system ADT-1). Every patient, ward, bed, member and Health ID is
 * fictional.
 */

export const ADMISSION = 'a0000000-0000-4000-8000-0000000000a1'
export const ADMISSION_TWO = 'a0000000-0000-4000-8000-0000000000a2'
export const ADMISSION_THREE = 'a0000000-0000-4000-8000-0000000000a3'
export const PATIENT = 'b0000000-0000-4000-8000-0000000000b1'
export const ENCOUNTER = 'e0000000-0000-4000-8000-0000000000e1'
export const WARD_FEMALE = 'd0000000-0000-4000-8000-0000000000d1'
export const WARD_MALE = 'd0000000-0000-4000-8000-0000000000d2'
export const WARD_ICU = 'd0000000-0000-4000-8000-0000000000d3'
export const BED_4 = 'c0000000-0000-4000-8000-0000000000c4'
export const BED_1 = 'c0000000-0000-4000-8000-0000000000c1'
export const BED_9 = 'c0000000-0000-4000-8000-0000000000c9'
export const ME = `member-${REAL_FACILITY}`

export const ADMISSIONS = 'GET /api/v1/ehr/admissions'
export const REQUEST = 'POST /api/v1/ehr/admissions'
export const RECORD = `GET /api/v1/ehr/admissions/${ADMISSION}`
export const action = (name: string, id = ADMISSION) => `POST /api/v1/ehr/admissions/${id}/${name}`
export const WARDS = 'GET /api/v1/ehr/wards'
export const BOARD = 'GET /api/v1/ehr/bed-board'
export const CENSUS = 'GET /api/v1/ehr/census'

export const NURSE = ['ehr.ward.read', 'ehr.admission.read', 'ehr.bed.allocate', 'ehr.wristband.print', 'ehr.encounter.read']
export const DOCTOR = [...NURSE, 'ehr.admission.decide', 'ehr.encounter.write']
export const ADMIN = ['ehr.ward.manage', 'workforce.manage', 'audit.read']

export function card(overrides: Record<string, unknown> = {}) {
  return {
    admissionId: ADMISSION, admissionNumber: 'A-2026-000123', patientId: PATIENT, fullName: 'Ada Wardone', nameHidden: false,
    initials: 'A W', recordKind: 'standard', unknownLabel: null, sex: 'female', dateOfBirth: '1972-05-14', dateOfBirthEstimated: false,
    ageYears: 54, ageEstimated: false, healthIdLast4: 'WW12', ninStatus: 'verified', chartBlocked: false, encounterId: ENCOUNTER,
    status: 'admitted', source: 'direct', edAttendanceId: null, fromEncounterId: null, visitQueueEntryId: null, motherAdmissionId: null,
    reason: 'Community-acquired pneumonia', reasonHidden: false, careTeam: 'Medical team A', responsibleMembershipId: ME,
    requestedWardId: WARD_FEMALE, requestedAt: '2026-12-01T21:00:00.000Z', requestedByMembershipId: ME,
    admittedAt: '2026-12-01T23:30:00.000Z', admittedByMembershipId: ME, daysAdmitted: 2, wardId: WARD_FEMALE,
    wardName: 'Female Medical Ward', bedId: BED_4, bedName: 'Bed 4', expectedDischargeOn: null, preparedAt: null, dischargeReady: false,
    discharge: null, cancelledAt: null, deathRecorded: false, billId: null, rowVersion: 3, ...overrides,
  }
}

export const waiting = (overrides: Record<string, unknown> = {}) => card({ status: 'requested', admittedAt: null, wardId: null,
  wardName: null, bedId: null, bedName: null, daysAdmitted: null, ...overrides })

export const recordOf = (admission = card(), movements: unknown[] = []) => () => json({ admission, movements })
export const written = (admission = card(), extra: Record<string, unknown> = {}) => () => json({ admission, replayed: false, ...extra })
export const listOf = (...items: ReturnType<typeof card>[]) => () => json({ items, hasMore: false, limit: 500 })
export const many = <T,>(answer: T, count = 6): T[] => Array.from({ length: count }, () => answer)

export function ward(wardId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    wardId, name, wardType: 'general', takes: 'any', active: true, bedCount: 2, overflowCount: 0, occupied: 1, available: 1, cleaning: 0,
    maintenance: 0, overflowInUse: 0, staffCount: 2, rowVersion: 4, ...overrides,
  }
}

export function movement(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    movementId: `f0000000-0000-4000-8000-0000000${String(Math.abs(kind.length * 7919) % 100000).padStart(5, '0')}`, kind,
    at: '2026-12-01T21:00:00.000Z', byMembershipId: ME, fromWardId: null, fromBedId: null, toWardId: null, toBedId: null,
    handoverRecorded: false, outcome: null, printNumber: null, reprintReason: null, ...overrides,
  }
}

/** Runs the blue EHR with the frame's registry and the inpatient pages in place of their samples, for the next app opened. */
export function withInpatientPages() {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { inpatientPages } = await import('../../../../ehr-blue/departments/inpatient/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: inpatientPages } }),
    }
  })
}

/** No Health ID, NIN or patient name ever goes in an address. */
export function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|Wardone|healthId|nin=/i)
}
