import { expect, vi } from 'vitest'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { REAL_FACILITY, json, type Sent } from '../../frame/blueHarness'

/*
 * Fictional ward, patients, tasks, doses and shifts for the nursing pages' tests (hid-system NUR-1). Every name,
 * number and reference here is made up.
 */
export const WARD = 'c0000000-0000-4000-8000-0000000000c1'
export const ADMISSION = 'd0000000-0000-4000-8000-0000000000d1'
export const ADMISSION_HIDDEN = 'd0000000-0000-4000-8000-0000000000d2'
export const PATIENT = 'b0000000-0000-4000-8000-0000000000b1'
export const ENCOUNTER = 'e0000000-0000-4000-8000-0000000000e1'
export const TASK = 'a0000000-0000-4000-8000-0000000000a1'
export const ORDER = 'f0000000-0000-4000-8000-0000000000f1'
export const SHIFT = '50000000-0000-4000-8000-000000000051'
export const SHIFT_NEXT = '50000000-0000-4000-8000-000000000052'
export const HANDOVER = '60000000-0000-4000-8000-000000000061'
export const ME = `member-${REAL_FACILITY}`
export const COLLEAGUE = '70000000-0000-4000-8000-000000000071'

export const NURSE = ['ehr.mar.read', 'ehr.mar.record', 'ehr.nursing-task.read', 'ehr.nursing-task.write', 'ehr.handover.write',
  'ehr.shift-assignment.manage', 'ehr.vital.read', 'ehr.vital.write', 'ehr.ward.read', 'ehr.admission.read', 'ehr.bed.allocate',
  'ehr.wristband.print', 'identity.patient.read']
export const DOCTOR = ['ehr.mar.read', 'ehr.mar.record', 'ehr.nursing-task.read', 'ehr.nursing-task.write', 'ehr.vital.read',
  'ehr.vital.write', 'ehr.ward.read', 'ehr.admission.read', 'ehr.admission.decide', 'identity.patient.read']
export const ADMIN = ['ehr.ward.manage', 'ehr.shift-assignment.manage', 'ehr.clinical-shift.manage', 'workforce.manage']

export const WARDS = 'GET /api/v1/ehr/wards'
export const ADMISSIONS = 'GET /api/v1/ehr/admissions'
export const ADMISSION_READ = `GET /api/v1/ehr/admissions/${ADMISSION}`
export const TASKS = 'GET /api/v1/ehr/nursing-tasks'
export const NEW_TASK = `POST /api/v1/ehr/admissions/${ADMISSION}/nursing-tasks`
export const taskStep = (step: string) => `POST /api/v1/ehr/nursing-tasks/${TASK}/${step}`
export const ROUND = 'GET /api/v1/ehr/medicine-round'
export const MAR = `GET /api/v1/ehr/admissions/${ADMISSION}/medicine-round`
export const DOSE = `POST /api/v1/ehr/admissions/${ADMISSION}/medicine-administrations`
export const CHART = `GET /api/v1/ehr/admissions/${ADMISSION}/observation-chart`
export const VITALS = `POST /api/v1/ehr/patients/${PATIENT}/encounters/${ENCOUNTER}/vitals`
export const FLUIDS = `GET /api/v1/ehr/admissions/${ADMISSION}/fluid-balance`
export const NEW_FLUID = `POST /api/v1/ehr/admissions/${ADMISSION}/fluid-balance`
export const SHIFTS = 'GET /api/v1/ehr/clinical-shifts'
export const NEW_SHIFT = 'POST /api/v1/ehr/clinical-shifts'
export const ASSIGNMENTS = 'GET /api/v1/ehr/shift-assignments'
export const SET_ASSIGNMENTS = 'PUT /api/v1/ehr/shift-assignments'
export const HANDOVERS = 'GET /api/v1/ehr/handovers'
export const NAMES = 'GET /api/v1/identity/facility-staff-names'

export const many = (answer: () => Response, count = 6) => Array.from({ length: count }, () => answer)

export function ward(overrides: Record<string, unknown> = {}) {
  return { wardId: WARD, name: 'Female Medical Ward', wardType: 'general', takes: 'female', active: true, bedCount: 20, overflowCount: 0,
    occupied: 2, available: 18, cleaning: 0, maintenance: 0, overflowInUse: 0, staffCount: 2, rowVersion: 1,
    staffMembershipIds: [ME, COLLEAGUE], beds: [], ...overrides }
}
export const wardsOf = (...items: ReturnType<typeof ward>[]) => () => json({ items: items.length ? items : [ward()] })

export function card(overrides: Record<string, unknown> = {}) {
  return {
    admissionId: ADMISSION, admissionNumber: 'A-2026-000123', patientId: PATIENT, fullName: 'Ada Wardone', nameHidden: false,
    initials: 'A W', recordKind: 'standard', unknownLabel: null, sex: 'female', dateOfBirth: '1972-05-14', dateOfBirthEstimated: false,
    ageYears: 54, ageEstimated: false, healthIdLast4: 'WW12', ninStatus: 'verified', chartBlocked: false, encounterId: ENCOUNTER,
    status: 'admitted', source: 'direct', reason: 'Community-acquired pneumonia', reasonHidden: false, careTeam: 'Medical team A',
    wardId: WARD, wardName: 'Female Medical Ward', bedId: 'b1000000-0000-4000-8000-000000000001', bedName: 'Bed 4',
    daysAdmitted: 2, rowVersion: 5, ...overrides,
  }
}
/** A patient whose chart this member cannot read now (Q190 A, the DPO's switch off): initials, sex and age only. */
export const hiddenCard = () => card({ admissionId: ADMISSION_HIDDEN, fullName: null, nameHidden: true, initials: 'B T', dateOfBirth: null,
  healthIdLast4: null, ageYears: 61, ninStatus: 'not_verified', bedName: 'Bed 7', patientId: 'b0000000-0000-4000-8000-0000000000b2' })

export function task(overrides: Record<string, unknown> = {}) {
  return { taskId: TASK, admissionId: ADMISSION, patient: card(), bedName: 'Bed 4', name: 'Turn the patient', dueAt: '2026-12-03T08:00:00.000Z',
    overdue: true, status: 'assigned', assignedMembershipId: ME, repeatEveryHours: 2, startedAt: null, completedAt: null,
    completionRecorded: false, completionRecord: null, cancelledAt: null, previousTaskId: null, rowVersion: 3, ...overrides }
}

export function order(overrides: Record<string, unknown> = {}) {
  return { prescriptionId: ORDER, medicationDisplay: 'Amoxicillin', strength: '500 mg', doseForm: 'capsule', dose: { quantity: 1, unit: 'capsule' },
    route: 'oral', frequency: 'three times a day', status: 'active',
    schedule: { kind: 'regular', times: ['06:00', '14:00', '22:00'], firstDueAt: '2026-12-02T05:00:00.000Z', infusion: null },
    pharmacyState: 'sent', doses: [
      { scheduledFor: '2026-12-03T05:00:00.000Z', state: 'given', administrationId: '90000000-0000-4000-8000-000000000091' },
      { scheduledFor: '2026-12-03T13:00:00.000Z', state: 'late', administrationId: null },
      { scheduledFor: '2026-12-03T21:00:00.000Z', state: 'upcoming', administrationId: null },
    ], asNeeded: null, lastGivenAt: '2026-12-03T05:10:00.000Z', nextAllowedAt: null, ...overrides }
}

export function doseRecord(overrides: Record<string, unknown> = {}) {
  return { administrationId: '90000000-0000-4000-8000-000000000091', admissionId: ADMISSION, prescriptionId: ORDER,
    scheduledFor: '2026-12-03T05:00:00.000Z', outcome: 'given', givenAt: '2026-12-03T05:10:00.000Z', recordedAt: '2026-12-03T05:12:00.000Z',
    recordedLate: false, late: false, dose: { quantity: 1, unit: 'capsule' }, doseDiffersReason: null, route: 'oral', reasonCode: null,
    reasonText: null, supplySource: 'ward_stock', pharmacyStateAtRecord: 'sent', overrideReason: null, infusionAction: null,
    warnings: ['before_dispensing'], recordedByMembershipId: ME, status: 'recorded', enteredInErrorReason: null, enteredInErrorAt: null,
    enteredInErrorByMembershipId: null, rowVersion: 1, ...overrides }
}

export function shift(overrides: Record<string, unknown> = {}) {
  return { shiftId: SHIFT, name: 'Morning', startsAt: '07:30', endsAt: '14:30', crossesMidnight: false, active: true, rowVersion: 1, ...overrides }
}

/** Runs the blue EHR on the frame's registry with the nursing pages joined, as departments/pages.ts joins them. */
export function withNursingPages() {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { nursingPages } = await import('../../../../ehr-blue/departments/nursing/page')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
      './departments/pages.ts': { pages: nursingPages } }) }
  })
}

export const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)

/** No Health ID, NIN or patient name ever goes in an address. */
export function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|WW12|Wardone|healthId|nin=/i)
}

