/**
 * Content for the tabbed sections of the provider page.
 *
 * Transcribed from the approved design. As everywhere else on the public site,
 * every patient name, Health ID and figure is invented.
 */

import type { StatusTone } from './product-details'

// ---------------------------------------------------------------------------
// Modules — "One identity. Every system."
// ---------------------------------------------------------------------------

export interface ModuleTab {
  readonly tab: string
  /** The claim the tab makes, in one line. */
  readonly statement: string
  readonly caption: string
  /** Title of the small panel beside the copy. */
  readonly panelTitle: string
  readonly panelBadge: string
  readonly rows: readonly {
    readonly label: string
    readonly value: string
    readonly tone: StatusTone
  }[]
}

export const MODULE_TABS: readonly ModuleTab[] = [
  {
    tab: 'Identity',
    statement: 'One patient identity that every connected facility can verify.',
    caption:
      'A persistent Health ID replaces the duplicate file a patient acquires at every new facility. Verified by PIN, never by name alone.',
    panelTitle: 'Patient Lookup',
    panelBadge: 'HID-4471-08',
    rows: [
      { label: 'Identity verified', value: 'Confirmed', tone: 'ok' },
      { label: 'Access PIN', value: 'Awaiting patient', tone: 'pending' },
      { label: 'Linked facilities', value: '4 connected', tone: 'active' },
      { label: 'Consent scope', value: 'Clinical only', tone: 'ok' },
    ],
  },
  {
    tab: 'EMR',
    statement: 'A full clinical record system for facilities that do not have one.',
    caption:
      'Encounters, notes, prescriptions and results in one place — and every entry attaches to the patient identity, not just your database.',
    panelTitle: 'Consultation',
    panelBadge: 'Dr. Bello · Ward 2',
    rows: [
      { label: 'Presenting complaint', value: 'Recorded', tone: 'ok' },
      { label: 'Vitals', value: 'Recorded', tone: 'ok' },
      { label: 'Prescription', value: 'Sent to pharmacy', tone: 'active' },
      { label: 'Lab request', value: 'Awaiting sample', tone: 'pending' },
    ],
  },
  {
    tab: 'Migrate',
    statement: 'Years of paper folders, turned into records a doctor can search.',
    caption:
      'Capture on a phone camera, OCR and AI extraction, then human validation before anything is matched to a patient.',
    panelTitle: 'Migration Batch',
    panelBadge: '248 files',
    rows: [
      { label: 'Pages captured', value: 'Complete', tone: 'ok' },
      { label: 'OCR extraction', value: 'Processing', tone: 'active' },
      { label: 'Human validation', value: 'In review', tone: 'pending' },
      { label: 'Unmatched patients', value: '6 flagged', tone: 'alert' },
    ],
  },
  {
    tab: 'Laboratory',
    statement: 'Results that attach themselves to the right patient automatically.',
    caption:
      'The full diagnostic pipeline from registration to verified release, with critical-result alerting built in.',
    panelTitle: 'Investigation',
    panelBadge: 'Full Blood Count',
    rows: [
      { label: 'Sample collected', value: 'Confirmed', tone: 'ok' },
      { label: 'Analysis', value: 'In progress', tone: 'active' },
      { label: 'Verification', value: 'Awaiting scientist', tone: 'pending' },
      { label: 'Critical value', value: 'None flagged', tone: 'ok' },
    ],
  },
  {
    tab: 'Pharmacy',
    statement: 'Dispensing connected to the prescription that caused it.',
    caption:
      'Prescriptions arrive from the consultation that raised them, and what leaves the counter returns to the medication history.',
    panelTitle: 'Dispensing',
    panelBadge: '12 in queue',
    rows: [
      { label: 'Prescription received', value: 'Confirmed', tone: 'ok' },
      { label: 'Stock check', value: 'Available', tone: 'ok' },
      { label: 'Dispensing', value: 'In progress', tone: 'active' },
      { label: 'Reorder level', value: '3 items low', tone: 'alert' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Facility operations — "See what is happening across your facility"
// ---------------------------------------------------------------------------

export const OPERATIONS_STAGES = [
  'All',
  'Waiting',
  'Triage',
  'Consultation',
  'Laboratory',
  'Pharmacy',
  'Completed',
] as const

export type OperationsStage = (typeof OPERATIONS_STAGES)[number]

export interface FlowRow {
  readonly patient: string
  readonly hid: string
  readonly stage: Exclude<OperationsStage, 'All'>
  readonly waited: string
  readonly assignedTo: string
  readonly action: string
}

export const OPERATIONS_FLOW: readonly FlowRow[] = [
  { patient: 'Amina Yusuf', hid: 'HID-01938', stage: 'Waiting', waited: '16 min', assignedTo: '—', action: 'Start triage' },
  { patient: 'Musa Bello', hid: 'HID-88321', stage: 'Consultation', waited: '8 min', assignedTo: 'Dr Kareem', action: 'View' },
  { patient: 'Grace John', hid: 'HID-17290', stage: 'Laboratory', waited: '24 min', assignedTo: 'Lab Unit', action: 'View' },
  { patient: 'Ifeanyi Nwosu', hid: 'HID-44210', stage: 'Triage', waited: '4 min', assignedTo: 'Nurse Ada', action: 'View' },
  { patient: 'Halima Sani', hid: 'HID-70654', stage: 'Pharmacy', waited: '11 min', assignedTo: 'Pharmacy', action: 'View' },
  { patient: 'Tunde Adeyemi', hid: 'HID-29017', stage: 'Waiting', waited: '31 min', assignedTo: '—', action: 'Start triage' },
  { patient: 'Chidi Eze', hid: 'HID-60482', stage: 'Completed', waited: '—', assignedTo: 'Dr Bello', action: 'View' },
]

export const OPERATIONS = {
  eyebrow: 'Dashboard preview',
  title: 'See what is happening across your facility',
  lede: 'Monitor patient flow and what requires attention across the facility.',
  counts: [
    { value: '86', label: 'patients today' },
    { value: '14', label: 'waiting' },
    { value: '5', label: 'departments' },
  ],
} as const

// ---------------------------------------------------------------------------
// Connected record — "One patient record. One clinical history."
// ---------------------------------------------------------------------------

export const RECORD_TABS = [
  'Overview',
  'Encounters',
  'Diagnoses',
  'Laboratory',
  'Medication',
  'Documents',
] as const

export type RecordTab = (typeof RECORD_TABS)[number]

export interface RecordEntry {
  readonly date: string
  readonly place: string
  readonly event: string
  /** Tabs this entry appears under. "Overview" shows everything. */
  readonly tabs: readonly RecordTab[]
}

export const RECORD_TIMELINE: readonly RecordEntry[] = [
  { date: '12 Aug', place: 'Prime Hospital', event: 'Consultation', tabs: ['Overview', 'Encounters'] },
  { date: '13 Aug', place: 'Prime Diagnostics', event: 'Full Blood Count', tabs: ['Overview', 'Laboratory'] },
  { date: '13 Aug', place: 'Central Pharmacy', event: 'Medication dispensed', tabs: ['Overview', 'Medication'] },
  { date: '14 Aug', place: 'Prime Hospital', event: 'Discharge summary', tabs: ['Overview', 'Documents'] },
  { date: '15 Aug', place: 'Prime Hospital', event: 'Malaria — confirmed by rapid diagnostic test', tabs: ['Overview', 'Diagnoses'] },
  { date: '16 Aug', place: 'Current facility', event: 'New encounter', tabs: ['Overview', 'Encounters'] },
]

export const RECORD_SECTION = {
  title: 'One patient record. One clinical history.',
  lede: "A patient's Health ID record unifies consultations, diagnoses, laboratory results, prescriptions, medication history, clinical documents, and other relevant health information from connected care providers.",
  patient: { name: 'Amina Yusuf', hid: 'HID-38291', status: 'Verified' },
} as const

// ---------------------------------------------------------------------------
// Care teams — "One system. The right workflow for every role."
// ---------------------------------------------------------------------------

export interface RoleTab {
  readonly role: string
  readonly body: string
  /** The panels that role sees when they sign in. */
  readonly panels: readonly string[]
}

export const ROLE_TABS: readonly RoleTab[] = [
  {
    role: 'Reception',
    body: 'Register patients, find existing HID profiles, verify identities and manage patient arrival.',
    panels: ['Register patient', 'Patient lookup', 'Waiting patients', 'Appointments'],
  },
  {
    role: 'Nurses',
    body: 'Handle triage, vitals, assigned patients and nursing documentation.',
    panels: ['Triage queue', 'Vitals to record', 'Assigned patients', 'Nursing notes'],
  },
  {
    role: 'Doctors',
    body: 'Review relevant patient history, document consultations, record diagnoses, request investigations and prescribe medication.',
    panels: ['My queue', 'My patients', 'Pending lab results', 'Follow-ups'],
  },
  {
    role: 'Laboratory',
    body: 'Receive investigation requests, manage samples, enter results and complete verification.',
    panels: ['Investigation requests', 'Awaiting collection', 'Results to enter', 'Awaiting verification'],
  },
  {
    role: 'Pharmacy',
    body: 'Receive prescriptions, dispense medications and maintain medication records.',
    panels: ['Prescription queue', 'Awaiting dispensing', 'Medication history', 'Stock alerts'],
  },
  {
    role: 'Administrators',
    body: 'Manage staff, departments, role permissions and facility-level operations.',
    panels: ['Staff accounts', 'Departments', 'Role permissions', 'Facility settings'],
  },
]

export const TEAMS_SECTION = {
  eyebrow: 'Built for every care team',
  title: 'One system. The right workflow for every role.',
} as const

export const MODULES_SECTION = {
  eyebrow: 'HID Modules',
  title: 'One identity. Every system.',
} as const
