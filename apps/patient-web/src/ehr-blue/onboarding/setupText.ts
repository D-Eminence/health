/**
 * The words of Facility setup: the design's own (design/ehr-target src/admin.tsx, src/model.ts), and today's where a
 * part of the wizard is live. Today's sentences that are not exported are ported here word for word, each with the
 * lines it comes from; the tests pin them.
 */

/** The wizard's nine steps, in order (src/admin.tsx:473-483). */
export const STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch'] as const
export type StepName = (typeof STEPS)[number]

/**
 * The steps that are samples and nothing else: what a facility types there is never sent to Health ID. A real facility
 * could believe it set them up, so they show at the demo facilities only (parity report 3.2).
 */
const DEMO_ONLY_STEPS: ReadonlySet<StepName> = new Set(['Type', 'Departments', 'Branches', 'Billing'])

/** The steps the wizard shows, in the design's order: all nine at a demo facility; at a real one, the five others. */
export function stepsAt(demo: boolean): readonly StepName[] {
  return demo ? STEPS : STEPS.filter(step => !DEMO_ONLY_STEPS.has(step))
}

/** The page as the sidebar, search and the tab title name it. */
export const PAGE_LABEL = 'Facility setup'

/** The wizard's h1 (src/admin.tsx:488-489). */
export const SETUP_TITLE = 'Set up your facility'

/** "Step 3 of 9 · Departments" (src/admin.tsx:490), counted among the steps shown ("Step 2 of 5 · Staff" at a real facility). */
export function stepEyebrow(index: number, steps: readonly StepName[] = STEPS): string {
  return `Step ${index + 1} of ${steps.length} · ${steps[index] ?? STEPS[0]}`
}

/** On every design field Health ID does not take: shown, disabled, never sent or kept. */
export const NOT_COLLECTED = 'Not collected by Health ID yet'

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
export const NO_LAUNCH_STEP = 'Health ID has no launch step yet. Your EHR is already open.'

/** The design's facility types (src/model.ts:366-375). */
export const FACILITY_TYPES = ['Clinic', 'Specialist Clinic', 'Diagnostic Centre', 'Maternity Centre', 'Community Hospital',
  'Specialist Hospital', 'Multi-Branch Hospital', 'Teaching Hospital'] as const

/** The design's departments, in its order (src/model.ts:349-365). */
export const DEPARTMENTS = ['General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy', 'Maternity', 'Pediatrics',
  'Radiology', 'Dental', 'Physiotherapy', 'Dialysis', 'Oncology', 'Cardiology', 'ICU', 'Theatre'] as const

/** The line under each department (src/admin.tsx:604-612). */
export function departmentLine(department: string): string {
  if (department === 'Laboratory') return 'Orders, samples and results; invite lab staff.'
  if (department === 'Pharmacy') return 'Prescription fulfilment; configure stock and pharmacy staff.'
  if (department === 'Inpatient' || department === 'ICU') return 'Admissions and nursing; configure wards and beds.'
  if (department === 'Radiology') return 'Studies and reports; assign radiology reporting permission.'
  return 'Appointments, triage, care records and department-specific context.'
}

/** The departments a type suggests (src/admin.tsx:547-552). */
export function suggestedDepartments(type: string): readonly string[] {
  if (type === 'Diagnostic Centre') return ['Laboratory', 'Radiology']
  if (type === 'Maternity Centre') return ['Maternity']
  return ['General Outpatient']
}
