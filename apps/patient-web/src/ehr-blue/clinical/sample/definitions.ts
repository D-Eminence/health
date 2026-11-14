/**
 * The sample-only workspaces of the blue EHR, one definition each, ported from the design's workspace catalogue
 * (design/ehr-target src/catalog.ts): titles are the design's sidebar labels; fields, actions and statuses are the
 * catalogue's. Nothing here has a backend: the sample engine keeps every record in memory, fictional, unsaved.
 *
 * Each action's permission verb (the last argument of `action()`) is the catalogue's, so a sample record offers each
 * role the design's actions (audit item 16, owner decision 2: sample workspaces follow the design's role mapping).
 */

/** What a field picks from, when it is a record picker (the design's `ref`). */
export type SampleRefKind = 'bed' | 'ward' | 'admission' | 'encounter' | 'patient'

export type SampleFieldType = 'text' | 'date' | 'datetime-local' | 'textarea' | 'file'

export interface SampleField {
  readonly key: string
  readonly label: string
  /** Text by default. */
  readonly type?: SampleFieldType
  /** Required by default, as the design's `f()`. */
  readonly required?: boolean
  readonly options?: readonly string[]
  readonly ref?: SampleRefKind
}

export interface SampleAction {
  readonly id: string
  readonly label: string
  readonly from: readonly string[]
  readonly to: string
  readonly fields?: readonly SampleField[]
  /**
   * The design's permission verb for the action (catalog.ts `action()`'s 6th argument: 'edit', 'sign', 'approve'…),
   * checked in the workspace's design module. Left out where the design gives none; the design then checks
   * DEFAULT_ACTION_PERMISSION.
   */
  readonly permission?: string
}

/**
 * The verb an action with no permission of its own needs: the design's `a.permission || "edit"` (src/workflows.tsx:490
 * and :538, src/service.ts:1414). Appointments' and Patient visits' actions have none.
 */
export const DEFAULT_ACTION_PERMISSION = 'edit'

/**
 * A "Continue care" hand-off: another sample workspace's create page, with the patient (and this record) carried.
 * Never a live workspace (Patients, Consultation, Triage, Nursing, Emergency, External record access): a live create
 * form opens on the patient open in the chart, a real one at a real facility, so a fictional record never leads there.
 */
export interface SampleHandoff {
  readonly workspace: SampleWorkspaceId
  /** The target's sidebar label; the button reads "Create {title lower-cased}". */
  readonly title: string
  /** A field of the target set to this record's id (an admission for nursing tasks). */
  readonly carry?: string
}

export interface SampleDefinition {
  readonly id: string
  /** The sidebar label: the list heading, "Search {title}", "New {title lower-cased}", history labels. */
  readonly title: string
  /** Records belong to a patient: create starts with "Patient *". */
  readonly patient: boolean
  /** Status of a new record. */
  readonly initial: string
  readonly fields: readonly SampleField[]
  readonly actions: readonly SampleAction[]
  /** Other workspaces whose records this list also shows (the design lists ICU admissions under Inpatient). */
  readonly alsoLists?: readonly string[]
  /**
   * "Continue care" on the record page: the design draws its heading on every visit and admission record, with a
   * button for each hand-off (none may be left: a visit's are live workspaces).
   */
  readonly continueCare?: readonly SampleHandoff[]
  /** A paragraph under the list card. */
  readonly listNote?: string
  /** Connected hospital history lists only records started from this one (journey: the visit's own records). */
  readonly historyFromRecord?: boolean
}

const f = (key: string, label: string, type: SampleFieldType = 'text', required = true): SampleField => ({ key, label, type, required })
const ref = (key: string, label: string, kind: SampleRefKind): SampleField => ({ key, label, ref: kind, required: true })
const action = (id: string, label: string, from: readonly string[], to: string, fields: readonly SampleField[] = [], permission?: string): SampleAction => (
  permission ? { id, label, from, to, fields, permission } : { id, label, from, to, fields }
)
const reason = f('reason', 'Reason', 'textarea')

/** Inpatient's actions (catalog.ts 450-487); the design gives ICU the same list (catalog.ts 1231-1233). */
const admissionActions: readonly SampleAction[] = [
  action('admit', 'Admit and allocate bed', ['requested'], 'admitted', [ref('bed', 'Available bed', 'bed')], 'assign'),
  action('transfer', 'Transfer bed', ['admitted'], 'admitted', [ref('bed', 'Destination bed', 'bed'), f('handover', 'Nursing handover', 'textarea')], 'assign'),
  action('prepare', 'Prepare discharge', ['admitted'], 'discharge-ready', [f('followup', 'Follow-up plan')], 'sign'),
  action('discharge', 'Discharge patient', ['discharge-ready'], 'discharged', [f('summary', 'Discharge summary', 'textarea')], 'sign'),
]

/** The design also hands off to Nursing observations, a live workspace, so the sample leaves it out. */
const admissionCare: readonly SampleHandoff[] = [
  { workspace: 'nursing-tasks', title: 'Nursing tasks', carry: 'admission' },
]

/** Every sample workspace, in the design's sidebar order, plus the emergency department board. */
export const SAMPLE_DEFINITIONS: Readonly<Record<string, SampleDefinition>> = {
  appointments: {
    id: 'appointments',
    title: 'Appointments',
    patient: true,
    initial: 'booked',
    fields: [f('starts', 'Appointment time', 'datetime-local'), f('clinician', 'Clinician'), f('department', 'Department'), f('reason', 'Reason')],
    // The design gives these no permission (catalog.ts 109-117): each needs DEFAULT_ACTION_PERMISSION.
    actions: [
      action('reschedule', 'Reschedule', ['booked'], 'booked', [f('starts', 'New time', 'datetime-local'), reason]),
      action('checkin', 'Check in', ['booked'], 'checked-in'),
      action('cancel', 'Cancel appointment', ['booked'], 'cancelled', [reason]),
      action('noShow', 'Mark no-show', ['booked'], 'no-show'),
    ],
  },
  journey: {
    id: 'journey',
    title: 'Patient visits',
    patient: true,
    initial: 'waiting',
    fields: [f('complaint', 'Presenting complaint'), f('department', 'Department'), f('clinician', 'Clinician', 'text', false)],
    // The design gives these no permission (catalog.ts 131-149): each needs DEFAULT_ACTION_PERMISSION.
    actions: [
      action('assign', 'Assign / transfer queue', ['waiting', 'triaged', 'consulting'], 'waiting', [f('department', 'Department'), f('clinician', 'Clinician'), reason]),
      action('complete', 'Complete visit', ['waiting', 'triaged', 'consulting'], 'completed', [f('disposition', 'Disposition')]),
      action('cancel', 'Cancel visit', ['waiting', 'triaged'], 'cancelled', [reason]),
    ],
    // The design's hand-offs from a visit (Triage & Vitals, Consultation) are live workspaces: a visit has none, so
    // its "Continue care" is the design's bare heading (as its capture for a role that may create neither).
    continueCare: [],
    listNote: 'Journey stages are derived from visits, triage, encounters, investigations, prescriptions and invoices. Pending activities can run in parallel.',
    historyFromRecord: true,
  },
  radiology: {
    id: 'radiology',
    title: 'Radiology',
    patient: true,
    initial: 'ordered',
    fields: [ref('encounter', 'Encounter', 'encounter'), f('modality', 'Modality'), f('indication', 'Indication'), { key: 'urgency', label: 'Urgency', options: ['Routine', 'Urgent'], required: true }],
    actions: [
      action('schedule', 'Schedule examination', ['ordered'], 'scheduled', [f('scheduled', 'Scheduled time', 'datetime-local')], 'edit'),
      action('examine', 'Record examination', ['scheduled'], 'examined', [f('exam', 'Examination details')], 'edit'),
      action('attach', 'Attach local study', ['examined'], 'study-attached', [f('attachment', 'Image or PDF (max 2 MB)', 'file')], 'edit'),
      action('report', 'Draft report', ['study-attached'], 'draft-report', [f('report', 'Report', 'textarea')], 'edit'),
      action('review', 'Review report', ['draft-report'], 'reviewed', [f('review', 'Reviewer note')], 'approve'),
      action('publish', 'Publish report', ['reviewed'], 'published', [], 'publish'),
      action('correct', 'Correct report', ['published'], 'draft-report', [f('report', 'Corrected report', 'textarea'), reason], 'edit'),
    ],
  },
  inpatient: {
    id: 'inpatient',
    title: 'Inpatient / Wards',
    patient: true,
    initial: 'requested',
    fields: [f('reason', 'Admission reason'), f('team', 'Assigned care team')],
    actions: admissionActions,
    alsoLists: ['icu'],
    continueCare: admissionCare,
  },
  wards: {
    id: 'wards',
    title: 'Wards & Beds',
    patient: false,
    initial: 'available',
    fields: [f('name', 'Bed name'), ref('ward', 'Ward', 'ward')],
    actions: [
      action('clean', 'Complete bed turnover', ['cleaning'], 'available', [f('cleaning', 'Cleaning record')], 'edit'),
      action('maintenance', 'Place in maintenance', ['available'], 'maintenance', [reason], 'edit'),
      action('release', 'Release from maintenance', ['maintenance'], 'available', [f('review', 'Maintenance completed')], 'edit'),
    ],
  },
  emergency: {
    id: 'emergency',
    title: 'Emergency',
    patient: true,
    initial: 'arrived',
    fields: [f('complaint', 'Presenting complaint'), f('priority', 'Triage priority'), f('team', 'Assigned clinician')],
    actions: [
      action('assess', 'Record assessment', ['arrived'], 'assessed', [f('assessment', 'Assessment', 'textarea')], 'edit'),
      action('disposition', 'Record disposition', ['assessed'], 'completed', [f('disposition', 'Disposition'), f('followup', 'Follow-up')], 'sign'),
    ],
  },
  maternity: {
    id: 'maternity',
    title: 'Maternity',
    patient: true,
    initial: 'enrolled',
    fields: [f('gestation', 'Gestation / enrolment details'), f('nextVisit', 'Antenatal visit', 'datetime-local')],
    actions: [
      action('observe', 'Antenatal observation', ['enrolled'], 'observed', [f('observations', 'Observations', 'textarea')], 'edit'),
      action('delivery', 'Record delivery', ['observed'], 'delivered', [f('delivery', 'Delivery record', 'textarea'), f('newborn', 'Newborn name (creates provisional identity)')], 'sign'),
      action('followup', 'Postnatal follow-up', ['delivered'], 'completed', [f('followup', 'Postnatal follow-up', 'textarea')], 'edit'),
    ],
  },
  surgery: {
    id: 'surgery',
    title: 'Theatre & Procedures',
    patient: true,
    initial: 'requested',
    fields: [f('procedure', 'Procedure'), f('reason', 'Indication')],
    actions: [
      action('schedule', 'Schedule procedure', ['requested'], 'scheduled', [f('scheduled', 'Time', 'datetime-local'), f('team', 'Team assignment')], 'assign'),
      action('checklist', 'Complete demo checklist', ['scheduled'], 'ready', [f('checklist', 'Checklist record (not clinical guidance)', 'textarea')], 'edit'),
      action('perform', 'Document procedure', ['ready'], 'recovery', [f('documentation', 'Procedure record', 'textarea')], 'sign'),
      action('recover', 'Complete recovery', ['recovery'], 'completed', [f('recovery', 'Recovery and follow-up', 'textarea')], 'edit'),
      action('cancel', 'Cancel procedure', ['requested', 'scheduled'], 'cancelled', [reason], 'edit'),
    ],
  },
  icu: {
    id: 'icu',
    title: 'ICU',
    patient: true,
    initial: 'requested',
    fields: [f('reason', 'ICU admission reason'), f('team', 'Care team')],
    // The design gives ICU the Inpatient actions (the same list).
    actions: admissionActions,
    continueCare: admissionCare,
  },
  dental: {
    id: 'dental',
    title: 'Dental',
    patient: true,
    initial: 'booked',
    fields: [f('scheduled', 'Appointment', 'datetime-local'), f('complaint', 'Complaint')],
    actions: [
      action('assess', 'Record assessment', ['booked'], 'assessed', [f('findings', 'Findings', 'textarea'), f('plan', 'Treatment plan', 'textarea')], 'edit'),
      action('perform', 'Record treatment', ['assessed'], 'treated', [f('procedure', 'Treatment documentation', 'textarea')], 'sign'),
      action('followup', 'Arrange follow-up', ['treated'], 'completed', [f('followup', 'Follow-up plan')], 'edit'),
    ],
  },
  referrals: {
    id: 'referrals',
    title: 'Referral Network',
    patient: true,
    initial: 'draft',
    fields: [f('destination', 'Destination facility'), f('reason', 'Referral reason'), f('urgency', 'Urgency'), f('summary', 'Selected clinical summary', 'textarea'), f('scope', 'Consent scope')],
    actions: [
      action('send', 'Send simulated referral', ['draft'], 'sent', [], 'create'),
      action('accept', 'Simulate recipient acceptance', ['sent'], 'accepted', [f('review', 'Recipient response')], 'approve'),
      action('complete', 'Complete referral', ['accepted'], 'completed', [f('outcome', 'Outcome', 'textarea')], 'edit'),
    ],
  },
  bloodbank: {
    id: 'bloodbank',
    title: 'Blood Bank',
    patient: false,
    initial: 'quarantine',
    fields: [f('donor', 'Fictional donor reference'), f('group', 'Blood group (does not prove compatibility)'), f('expiry', 'Expiry', 'date')],
    actions: [
      action('screen', 'Record screening review', ['quarantine'], 'screened', [f('screening', 'Screening record', 'textarea')], 'approve'),
      action('reserve', 'Reserve unit', ['screened'], 'reserved', [ref('patient', 'Patient', 'patient'), f('review', 'Suitability review (simulation)')], 'assign'),
      action('issue', 'Issue unit', ['reserved'], 'issued', [f('authorization', 'Authorization record')], 'publish'),
      action('dispose', 'Dispose unit', ['quarantine', 'screened', 'reserved'], 'disposed', [reason], 'edit'),
    ],
  },
  telemedicine: {
    id: 'telemedicine',
    title: 'Telemedicine',
    patient: true,
    initial: 'booked',
    fields: [f('scheduled', 'Session time', 'datetime-local'), f('clinician', 'Clinician'), f('reason', 'Reason')],
    actions: [
      action('wait', 'Enter local waiting room', ['booked'], 'waiting', [], 'edit'),
      action('start', 'Start local session simulation', ['waiting'], 'in-progress', [], 'edit'),
      action('end', 'End and document session', ['in-progress'], 'completed', [f('note', 'Session note', 'textarea'), f('followup', 'Follow-up')], 'sign'),
    ],
  },
  'ward-config': {
    id: 'ward-config',
    title: 'Ward configuration',
    patient: false,
    initial: 'active',
    fields: [f('name', 'Ward name')],
    actions: [],
  },
  'nursing-tasks': {
    id: 'nursing-tasks',
    title: 'Nursing tasks',
    patient: true,
    initial: 'assigned',
    fields: [ref('admission', 'Admission', 'admission'), f('name', 'Care task'), f('assignedTo', 'Assigned nurse'), f('due', 'Due time', 'datetime-local')],
    actions: [
      action('start', 'Start task', ['assigned'], 'in-progress', [], 'edit'),
      action('complete', 'Complete task', ['in-progress'], 'completed', [f('note', 'Completion record', 'textarea')], 'edit'),
      action('cancel', 'Cancel task', ['assigned'], 'cancelled', [reason], 'assign'),
    ],
  },
}

/** The 14 sample workspaces the frame mounts (emergency is a board inside the live Emergency workspace). */
export const SAMPLE_WORKSPACE_IDS = [
  'appointments', 'journey', 'inpatient', 'wards', 'ward-config', 'icu', 'nursing-tasks', 'maternity', 'surgery', 'dental',
  'radiology', 'referrals', 'telemedicine', 'bloodbank',
] as const

export type SampleWorkspaceId = (typeof SAMPLE_WORKSPACE_IDS)[number]

/** Whether a workspace is one of the 14 sample workspaces (never a live one, nor the emergency board). */
export function isSampleWorkspace(id: string): id is SampleWorkspaceId {
  return (SAMPLE_WORKSPACE_IDS as readonly string[]).includes(id)
}

/**
 * Connected hospital history order: the design's module order (catalog.ts), audit item 17's list. Sample workspaces
 * list their records; the live ones (triage, clinical, laboratory, pharmacy, nursing) list only the seed's fictional
 * history rows (SEED_CONNECTED). Record kinds a ref field picks from map to the workspaces that hold them.
 */
export const HISTORY_ORDER: readonly string[] = [
  'appointments', 'journey', 'triage', 'clinical', 'laboratory', 'radiology', 'pharmacy', 'inpatient', 'wards', 'nursing',
  'emergency', 'maternity', 'surgery', 'icu', 'dental', 'referrals', 'bloodbank', 'telemedicine', 'ward-config',
  'nursing-tasks',
]

export const REF_WORKSPACES: Readonly<Record<Exclude<SampleRefKind, 'encounter' | 'patient'>, readonly string[]>> = {
  bed: ['wards'],
  ward: ['ward-config'],
  admission: ['inpatient', 'icu'],
}

/** Actions that ask before they change the record; a word must be typed for the last three. */
export const CONFIRMED_ACTIONS = ['delete', 'cancel', 'void', 'refund', 'revoke', 'sign'] as const
export const TYPED_WORD_ACTIONS = ['delete', 'sign', 'refund'] as const

/** The design's branch departments (model.ts), the choices of a "Department" field. */
export const DEPARTMENTS = [
  'General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy', 'Maternity', 'Pediatrics', 'Radiology',
  'Dental', 'Physiotherapy', 'Dialysis', 'Oncology', 'Cardiology', 'ICU', 'Theatre',
] as const

/** Fictional staff memberships: "Clinician" lists the clinicians, "Assigned nurse" the nurses. */
export const SAMPLE_CLINICIANS = [
  { value: '28c11bae-61a6-4843-9291-664517bfa63e', label: 'Demo Doctor · Doctor' },
  { value: '6f0e2d4a-93b1-4c7e-8a25-1d9b7c3e5f60', label: 'Demo Consultant · Consultant' },
  { value: 'b81c5e3f-27d4-4a96-9e0b-4c6a2f8d1e37', label: 'Demo Medical Director · Medical Director' },
] as const

export const SAMPLE_NURSES = [
  { value: 'd422165f-80ce-4595-9508-49edb2211de3', label: 'Demo Nurse · Nurse' },
] as const
