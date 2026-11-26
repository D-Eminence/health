import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { vi } from 'vitest'
import { REAL_FACILITY } from '../../frame/blueHarness'

/*
 * Fictional answers of hid-system QUAL-1's routes, as INTERFACE_CONTRACT.md "QUAL-1" writes them, for the Quality &
 * Safety page's tests. Every account, facility, patient, incident and staff member here is fictional.
 */

export const ME = 'GET /api/v1/ehr/quality/me'
export const LIST = 'GET /api/v1/ehr/quality/incidents'
export const REPORT = 'POST /api/v1/ehr/quality/incidents'
export const INCIDENT = 'e0000000-0000-4000-8000-00000000a001'
export const READ = `GET /api/v1/ehr/quality/incidents/${INCIDENT}`
export const step = (name: string) => `POST /api/v1/ehr/quality/incidents/${INCIDENT}/${name}`
export const ACTION = 'e0000000-0000-4000-8000-00000000b001'
export const ACTION_UPDATE = `POST /api/v1/ehr/quality/incidents/${INCIDENT}/actions/${ACTION}`
export const STAFF = 'GET /api/v1/identity/facility-staff-names'
export const COUNTS = 'GET /api/v1/ehr/quality/incident-counts'
export const LEADS = 'GET /api/v1/ehr/quality/leads'
export const NAME_LEAD = 'POST /api/v1/ehr/quality/leads'
export const LEAD = 'e0000000-0000-4000-8000-00000000c001'
export const END_LEAD = `POST /api/v1/ehr/quality/leads/${LEAD}/end`
export const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'

export const OWN = `member-${REAL_FACILITY}`
export const REPORTER = 'd0000000-0000-4000-8000-0000000000d1'
export const REVIEWER = 'd0000000-0000-4000-8000-0000000000d2'
export const OWNER = 'd0000000-0000-4000-8000-0000000000d3'

export const REPORT_CODE = 'quality.incident.report'
export const MANAGE_CODE = 'quality.incident.manage'
export const STAFF_CODES = [REPORT_CODE]
export const ADMIN_CODES = [REPORT_CODE, MANAGE_CODE]

export const LISTS = {
  listVersion: 'QS-DRAFT-1', listStatus: 'draft',
  categories: [
    { code: 'medication', label: 'Medication', hint: 'Wrong medicine, dose, strength, route, time or patient.' },
    { code: 'patient_fall', label: 'Patient fall', hint: 'A patient fell or was found on the floor.' },
    { code: 'facility_environment', label: 'Facility and environment', hint: 'A wet floor, a power or water failure.' },
    { code: 'other', label: 'Other', hint: 'Anything the list does not cover.' },
  ],
  harmLevels: [
    { code: 'near_miss', label: 'Near miss', hint: 'It was caught before it reached the patient or person', toldRequired: false },
    { code: 'no_harm', label: 'No harm', hint: 'It reached the patient but caused no harm', toldRequired: false },
    { code: 'mild', label: 'Mild harm', hint: 'Minor harm', toldRequired: false },
    { code: 'moderate', label: 'Moderate harm', hint: 'Harm needing extra treatment', toldRequired: true },
    { code: 'severe', label: 'Severe harm', hint: 'Permanent or long-term harm', toldRequired: true },
    { code: 'death', label: 'Death', hint: 'The incident caused or contributed to a death', toldRequired: true },
  ],
  toldValues: ['yes', 'no', 'not_applicable'],
}

export function me(overrides: Record<string, unknown> = {}) {
  return { canReport: true, isManager: true, managerBasis: 'role', canNameLeads: true, patientLinkAvailable: false, lists: LISTS,
    departmentCodes: ['general_outpatient', 'pharmacy', 'emergency'], ...overrides }
}
export const reporterMe = (overrides: Record<string, unknown> = {}) => me({ isManager: false, managerBasis: null, canNameLeads: false, ...overrides })

const NO_STEPS = { assign: false, investigate: false, addAction: false, resolve: false, reopen: false, correct: false }

/** The card in the manager's view (INTERFACE_CONTRACT "QUAL-1"): an incident assigned and investigated. */
export function card(overrides: Record<string, unknown> = {}) {
  return {
    incidentId: INCIDENT, incidentNumber: 12, view: 'manager', title: 'Wrong strength dispensed (fictional)',
    description: 'A 10 mg tablet was handed over for a 5 mg prescription (fictional).',
    occurredAt: '2026-12-03T08:10:00.000Z', occurredDay: '2026-12-03', departmentCode: 'pharmacy', locationText: 'Dispensary counter 2',
    category: 'medication', harmLevel: 'no_harm', immediateAction: 'The tablets were swapped before the patient left (fictional).',
    patientOrFamilyTold: null, listVersion: 'QS-DRAFT-1', status: 'investigated', reportedAt: '2026-12-03T09:02:00.000Z',
    reportedByMe: false, reporterMembershipId: REPORTER, reporterHidden: false, patientLinked: true, patientHidden: false,
    patient: { patientId: PATIENT, fullName: 'Tunde Fictional', recordKind: 'standard', unknownLabel: null, sex: 'male',
      dateOfBirth: '1984-03-09', healthIdLast4: 'BB33' },
    reviewerMembershipId: REVIEWER, assignedAt: '2026-12-03T10:00:00.000Z',
    investigation: { findings: 'Two strengths were stored side by side (fictional).', recordedAt: '2026-12-03T11:00:00.000Z',
      recordedByMembershipId: REVIEWER },
    resolution: null, reopenedCount: 0, openActions: 0, overdueActions: 0,
    can: { ...NO_STEPS, assign: true, investigate: true, addAction: true, resolve: true, correct: true },
    updatedAt: '2026-12-03T11:00:00.000Z', rowVersion: 5, ...overrides,
  }
}

/** The same incident as its reviewer sees it: no reporter, no patient. */
export const reviewerCard = (overrides: Record<string, unknown> = {}) => card({ view: 'reviewer', reporterMembershipId: null,
  reporterHidden: true, patient: null, patientHidden: true, reviewerMembershipId: OWN,
  can: { ...NO_STEPS, investigate: true, addAction: true }, ...overrides })

/** The same incident as its reporter sees it: the report as filed and its status only. */
export const reporterCard = (overrides: Record<string, unknown> = {}) => card({ view: 'reporter', reportedByMe: true,
  reporterMembershipId: null, patient: null, patientHidden: true, reviewerMembershipId: null, assignedAt: null, investigation: null,
  can: NO_STEPS, ...overrides })

export function action(overrides: Record<string, unknown> = {}) {
  return { actionId: ACTION, description: 'Store the two strengths on separate shelves (fictional)', ownerMembershipId: OWNER,
    dueDate: '2026-12-20', status: 'open', overdue: false, completedAt: null, note: null, createdAt: '2026-12-03T11:05:00.000Z',
    createdByMembershipId: REVIEWER, ...overrides }
}

export const HISTORY = [
  { kind: 'reported', at: '2026-12-03T09:02:00.000Z', byMembershipId: REPORTER, fromStatus: null, toStatus: 'reported', reason: null,
    text: null, actionId: null, changes: null },
  { kind: 'patient_linked', at: '2026-12-03T09:02:00.000Z', byMembershipId: REPORTER, fromStatus: null, toStatus: null, reason: null,
    text: null, actionId: null, changes: { patientLinked: { from: false, to: true } } },
  { kind: 'assigned', at: '2026-12-03T10:00:00.000Z', byMembershipId: OWN, fromStatus: 'reported', toStatus: 'assigned', reason: null,
    text: null, actionId: null, changes: { reviewerMembershipId: { from: null, to: REVIEWER } } },
  { kind: 'investigation_recorded', at: '2026-12-03T11:00:00.000Z', byMembershipId: REVIEWER, fromStatus: 'assigned',
    toStatus: 'investigated', reason: null, text: 'Two strengths were stored side by side (fictional).', actionId: null, changes: null },
]

export const record = (incident = card(), actions: unknown[] = [], history: unknown[] = HISTORY) => ({ incident, actions, history })

export const staffNames = (complete = true) => ({ facilityId: REAL_FACILITY, complete, staff: [
  { membershipId: OWN, name: 'Demo Clinician', current: true },
  { membershipId: REPORTER, name: 'Bola Reporter', current: true },
  { membershipId: REVIEWER, name: 'Chidi Reviewer', current: true },
  { membershipId: OWNER, name: 'Ada Owner', current: true },
  { membershipId: 'd0000000-0000-4000-8000-0000000000d9', name: 'Former Fictional', current: false },
] })

export function summary(overrides: Record<string, unknown> = {}) {
  return { incidentId: INCIDENT, incidentNumber: 12, title: 'Wrong strength dispensed (fictional)', category: 'medication',
    harmLevel: 'no_harm', departmentCode: 'pharmacy', occurredAt: '2026-12-03T08:10:00.000Z', reportedAt: '2026-12-03T09:02:00.000Z',
    status: 'assigned', reviewerMembershipId: REVIEWER, patientLinked: true, reportedByMe: false, assignedToMe: false, openActions: 2,
    overdueActions: 1, rowVersion: 3, ...overrides }
}

/** The frame's own registry and Home, with Quality & Safety joining as departments/pages.ts joins it. Per test. */
export function withQualityPage() {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { qualityPage } = await import('../../../../ehr-blue/departments/quality/page')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
      './departments/pages.ts': { pages: [qualityPage] } }) }
  })
}
