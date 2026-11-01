/**
 * The words of Facility setup: the design's own (design/ehr-target src/admin.tsx, src/model.ts), and today's where a
 * part of the wizard is live. Today's sentences that are not exported are ported here word for word, each with the
 * lines it comes from; the tests pin them.
 */

/** The wizard's nine steps, in order (src/admin.tsx:473-483). */
export const STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch'] as const
export type StepName = (typeof STEPS)[number]

/** The page as the sidebar, search and the tab title name it. */
export const PAGE_LABEL = 'Facility setup'

/** The wizard's h1 (src/admin.tsx:488-489). */
export const SETUP_TITLE = 'Set up your facility'

/** "Step 3 of 9 · Departments" (src/admin.tsx:490). */
export function stepEyebrow(index: number): string {
  return `Step ${index + 1} of ${STEPS.length} · ${STEPS[index] ?? STEPS[0]}`
}

/** On every design field Health ID does not take: shown, disabled, never sent or kept. */
export const NOT_COLLECTED = 'Health ID doesn’t save this yet'

/** The design's required-field message (src/ui.tsx:248). */
export const MISSING = 'Complete this field.'

/** What the page's address says where Facility setup is not open. */
export const NOT_SELF_SIGNED_UP = 'Facility setup is for a facility that signed itself up to Health ID.'

/** The same, to a member of a facility that signed itself up who does not manage its staff. */
export function onlyTheAdministrator(facility: string): string {
  return `Only ${facility}’s administrator can set it up.`
}

/**
 * Today's "Facility check" card at a self-signed-up facility, word for word: FacilityCheckCard in
 * staff/routes/ReviewBanner.tsx:92-93 (its sentences are written in its JSX and not exported).
 */
export function facilityCheckPending(facility: string): string {
  return `Health ID support is checking ${facility}. This usually takes up to one working day.`
}

/** Today's "Done" card, word for word: ReviewBanner.tsx:96-97. */
export function facilityCheckDone(facility: string): string {
  return `Health ID support has checked ${facility}, and it now has full access.`
}

/** Said, as a status, when "Launch facility" opens Home: there is nothing to launch on Health ID. */
export const NO_LAUNCH_STEP = 'Health ID has no launch step yet. Your records system is already open.'

/** The design's facility types (src/model.ts:366-375). */
export const FACILITY_TYPES = ['Clinic', 'Specialist Clinic', 'Diagnostic Centre', 'Maternity Centre', 'Community Hospital',
  'Specialist Hospital', 'Multi-Branch Hospital', 'Teaching Hospital'] as const

/** The design's departments, in its order (src/model.ts:349-365). */
export const DEPARTMENTS = ['General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy', 'Maternity', 'Pediatrics',
  'Radiology', 'Dental', 'Physiotherapy', 'Dialysis', 'Oncology', 'Cardiology', 'ICU', 'Theatre'] as const

/** The line under each department (src/admin.tsx:604-612). */
export function departmentLine(department: string): string {
  if (department === 'Laboratory') return 'Orders, samples and results. Invite lab staff.'
  if (department === 'Pharmacy') return 'Give out medicines. Set up stock and pharmacy staff.'
  if (department === 'Inpatient' || department === 'ICU') return 'Admissions and nursing. Set up wards and beds.'
  if (department === 'Radiology') return 'Scans and reports. Choose who can write scan reports.'
  return 'Appointments, triage, care records and notes for each department.'
}

/** The departments a type suggests (src/admin.tsx:547-552). */
export function suggestedDepartments(type: string): readonly string[] {
  if (type === 'Diagnostic Centre') return ['Laboratory', 'Radiology']
  if (type === 'Maternity Centre') return ['Maternity']
  return ['General Outpatient']
}
