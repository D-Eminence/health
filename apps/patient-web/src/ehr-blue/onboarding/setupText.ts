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
 * could believe it set them up, so they show at the demo facilities only (parity report 3.2). Launch too, by the owner's
 * decision: it sends nothing and changes nothing (Health ID has no launch step, and a facility's EHR opens as soon as it
 * signs up), so at a real facility it would only say so, after a button that promised more.
 */
const DEMO_ONLY_STEPS: ReadonlySet<StepName> = new Set(['Type', 'Departments', 'Branches', 'Billing', 'Launch'])

/**
 * The steps the wizard shows, in the design's order: all nine at a demo facility; at a real one, the four others
 * (Facility, Staff, Roles, Review), Review the last.
 */
export function stepsAt(demo: boolean): readonly StepName[] {
  return demo ? STEPS : STEPS.filter(step => !DEMO_ONLY_STEPS.has(step))
}

/** The page as the sidebar, search and the tab title name it. */
export const PAGE_LABEL = 'Facility setup'

/** The wizard's h1 (src/admin.tsx:488-489). */
export const SETUP_TITLE = 'Set up your facility'

/** "Step 3 of 9 · Departments" (src/admin.tsx:490), counted among the steps shown ("Step 2 of 4 · Staff" at a real facility). */
export function stepEyebrow(index: number, steps: readonly StepName[] = STEPS): string {
  return `Step ${index + 1} of ${steps.length} · ${steps[index] ?? STEPS[0]}`
}

/** The Facility step while the facility's details are read (hid-system 0114). */
export const PROFILE_LOADING = 'Getting your facility’s details…'

/** Where Identity keeps the facility's details itself: a facility Health ID support manages, or a demo facility. */
export const PROFILE_KEPT = 'Health ID support keeps this facility’s details. Contact them to change any of them.'

/** The read failed for a fault. */
export const PROFILE_FAILED = 'We couldn’t get your facility’s details just now.'

/** After a failed read: what going on without them means. */
export const PROFILE_NOT_SAVED = 'Your facility’s details are not saved yet. Try again, or go on and come back to this step to give them.'

/** The button that goes on after a failed read. */
export const CONTINUE_UNSAVED = 'Continue without saving'

/** Someone else saved the details first (412): theirs were read again, and what was typed is kept. */
export const PROFILE_CONFLICT = 'Someone else saved these details first. Your changes are still below and are not saved yet. '
  + 'Check them against theirs, then save again.'

/** The heading over the other person's saved details, where they differ from what was typed. */
export const PROFILE_THEIRS = 'Their saved details that differ from yours'

/** Where this person may not change the facility's details (403 PERMISSION_DENIED). */
export const PROFILE_DENIED = 'Only the facility administrator can change these details.'

/** After a save Identity refused (kept by support, a demo facility, or no permission): nothing typed was kept. */
export const PROFILE_SAVE_REFUSED = 'The details you entered were not saved.'

/** The Review step's value for a facility whose details are not given yet. */
export const NOT_GIVEN = 'Not given yet'

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

/** Said, as a status, when "Launch facility" (the demo facilities' alone) opens Home: there is nothing to launch on Health ID. */
export const NO_LAUNCH_STEP = 'Health ID has no launch step yet. Your EHR is already open.'

/**
 * The Review step's last line at a real facility, where it is the last step: there is no launch to come, and the one
 * thing still to do there is optional. Staff & access says when invitations open, so this promises no time.
 */
export const ALREADY_OPEN = 'Your EHR is already open. Inviting staff is optional, from Staff & access.'

/**
 * The same line while Health ID support's check is pending: adding staff and patient records are locked until it is done
 * (the frame's review banner), so it neither offers invitations now nor calls the EHR open. Staff & access's own
 * sentence (departments/staff/StaffAccess.tsx, written in its JSX), naming where.
 */
export function staffOnceChecked(facility: string): string {
  return `You can add staff from Staff & access once Health ID support has checked ${facility}.`
}

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
