import { SAMPLE_CLINICIANS, SAMPLE_NURSES } from './definitions'

/**
 * The sample engine's starting records: fictional people and records rebuilt from the design's screenshots
 * (screens/workspaces/*.png). Rebuilt on every reload and on reset; nothing is ever saved.
 */

export type SampleValue = string | boolean | readonly string[]
export type SampleData = Readonly<Record<string, SampleValue>>

export interface SampleVersion {
  readonly at: string
  readonly author: string
  /** The action's reason, or its label. */
  readonly reason: string
  /** The status before the change. */
  readonly status: string
  readonly data: SampleData
}

export interface SampleRecord {
  readonly id: string
  /** The sample workspace (definition id) the record belongs to. */
  readonly workspace: string
  readonly patientId?: string
  /** The record this one was started from (a visit's appointment). */
  readonly parentId?: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly data: SampleData
  readonly versions: readonly SampleVersion[]
}

/** A fictional registered patient; "Health IDs" are the design's fictional ones (HID-DEMO-001, LOCAL-…). */
export interface SamplePatient {
  readonly id: string
  readonly name: string
  readonly healthId: string
  readonly mrn: string
  readonly provisional?: boolean
}

/** A fictional consultation an order can link to (the live Consultation workspace holds real ones). */
export interface SampleEncounter {
  readonly id: string
  readonly patientId: string
  readonly status: 'draft' | 'signed'
}

export const SAMPLE_AUTHOR = 'Demo Doctor (fictional)'
export const SAMPLE_USER = 'You (sample)'

const DOCTOR = SAMPLE_CLINICIANS[0].value
const NURSE = SAMPLE_NURSES[0].value

const uuid = (prefix: string, n: number) => `${prefix}-5e1d-4c2a-8b3f-${n.toString(16).padStart(12, '0')}`

export const PATIENTS = {
  alex: uuid('ad516ef7', 1),
  taylor: uuid('31b35865', 2),
  jordan: uuid('07af448f', 3),
  sam: uuid('9d636e68', 4),
  riley: uuid('d7e2ddfc', 5),
} as const

export const SEED_PATIENTS: readonly SamplePatient[] = [
  { id: PATIENTS.alex, name: 'Alex Example', healthId: 'HID-DEMO-001', mrn: 'MRN-000001' },
  { id: PATIENTS.taylor, name: 'Taylor Fiction', healthId: 'LOCAL-aeac58e6', mrn: 'MRN-000002' },
  { id: PATIENTS.jordan, name: 'Jordan Sample', healthId: 'LOCAL-902ae015', mrn: 'MRN-000003' },
  { id: PATIENTS.sam, name: 'Sam Placeholder', healthId: 'LOCAL-0d044b54', mrn: 'MRN-000004' },
  { id: PATIENTS.riley, name: 'Riley Demo', healthId: 'LOCAL-7554909a', mrn: 'MRN-000005' },
]

export const ENCOUNTERS = {
  taylor: uuid('fd276688', 11),
  jordan: uuid('5f459730', 12),
  sam: uuid('4fe5735c', 13),
} as const

export const SEED_ENCOUNTERS: readonly SampleEncounter[] = [
  { id: ENCOUNTERS.taylor, patientId: PATIENTS.taylor, status: 'signed' },
  { id: ENCOUNTERS.jordan, patientId: PATIENTS.jordan, status: 'signed' },
  { id: ENCOUNTERS.sam, patientId: PATIENTS.sam, status: 'draft' },
]

/** Record ids whose first eight characters are the design's. */
export const IDS = {
  apptTaylor: uuid('0b048a1b', 21), apptJordan: uuid('0bad9e52', 22), apptSam: uuid('2931204b', 23), apptRiley: uuid('9bf12ade', 24),
  visitTaylor: uuid('b57e94c9', 31), visitJordan: uuid('203099a6', 32), visitSam: uuid('11e3fd1b', 33), visitRiley: uuid('ad6117ec', 34),
  visitAlex: uuid('c7764b15', 35), visitCheckedIn: uuid('4cd934dd', 36),
  admitTaylor: uuid('567aa589', 41), admitSam: uuid('df17e43b', 42), icuRiley: uuid('d01554b5', 43),
  bed1: uuid('7fe7785d', 51), bed2: uuid('35916334', 52),
  wardExample: uuid('be31b84e', 61), wardFemale: uuid('a7fc957b', 62),
  taskObs: uuid('ebb09183', 71), taskWound: uuid('bd998083', 72),
  emergency: uuid('cfa650e2', 81), maternity: uuid('dd93026d', 82), surgery: uuid('4dc12aa8', 83), dental: uuid('503fafd8', 84),
  xray: uuid('5d68702e', 91), ultrasound: uuid('bb20eba4', 92),
  referral: uuid('f30d1e68', 101), telemedicine: uuid('9426ba71', 102),
  bloodScreened: uuid('13e56980', 111), bloodQuarantine: uuid('cd77b5a8', 112),
} as const

type Change = readonly [at: string, status: string, reason: string, data: SampleData]

function record(id: string, workspace: string, status: string, updatedAt: string, data: SampleData, options: {
  patientId?: string
  parentId?: string
  createdAt?: string
  versions?: readonly Change[]
} = {}): SampleRecord {
  return {
    id,
    workspace,
    patientId: options.patientId,
    parentId: options.parentId,
    status,
    createdAt: options.createdAt ?? options.versions?.[0]?.[0] ?? updatedAt,
    updatedAt,
    data,
    versions: (options.versions ?? []).map(([at, before, reason, earlier]) => ({ at, author: SAMPLE_AUTHOR, reason, status: before, data: earlier })),
  }
}

const reviewOfResults = { starts: '2026-11-03T09:30', clinician: DOCTOR, department: 'General Outpatient', reason: 'Review of results' }
const xrayOrdered = { encounter: ENCOUNTERS.jordan, modality: 'Chest X-ray', indication: 'Cough follow-up', urgency: 'Routine' }
const xrayScheduled = { ...xrayOrdered, scheduled: '2026-11-02T15:00' }
const xrayExamined = { ...xrayScheduled, exam: 'Fictional examination' }
const xrayAttached = { ...xrayExamined, attachment: 'Fictional study (sample: not uploaded)' }
const xrayDrafted = { ...xrayAttached, report: 'Fictional report' }
const xrayReviewed = { ...xrayDrafted, review: 'Reviewed report' }

/** A fresh copy of every starting record, in the design's list order. */
export function seedRecords(): SampleRecord[] {
  return [
    // Appointments
    record(IDS.apptTaylor, 'appointments', 'checked-in', '2026-10-26T11:41:35.318Z', reviewOfResults, {
      patientId: PATIENTS.taylor, createdAt: '2026-10-26T11:41:13.402Z', versions: [['2026-10-26T11:41:35.318Z', 'booked', 'Check in', reviewOfResults]],
    }),
    record(IDS.apptJordan, 'appointments', 'booked', '2026-10-26T11:41:35.340Z', { starts: '2026-11-04T10:00', clinician: DOCTOR, department: 'General Outpatient', reason: 'Medication review' }, { patientId: PATIENTS.jordan }),
    record(IDS.apptSam, 'appointments', 'cancelled', '2026-10-26T11:41:35.362Z', { starts: '2026-11-04T11:00', clinician: DOCTOR, department: 'General Outpatient', reason: 'Patient requested another day' }, {
      patientId: PATIENTS.sam, createdAt: '2026-10-26T11:41:13.420Z',
      versions: [['2026-10-26T11:41:35.362Z', 'booked', 'Patient requested another day', { starts: '2026-11-04T11:00', clinician: DOCTOR, department: 'General Outpatient', reason: 'Follow-up visit' }]],
    }),
    record(IDS.apptRiley, 'appointments', 'booked', '2026-10-26T11:41:35.384Z', { starts: '2026-11-10T10:00', clinician: DOCTOR, department: 'Maternity', reason: 'Antenatal review' }, { patientId: PATIENTS.riley }),

    // Patient visits
    record(IDS.visitTaylor, 'journey', 'consulting', '2026-10-26T11:41:13.512Z', { complaint: 'Persistent fever and headache', department: 'General Outpatient', clinician: DOCTOR }, { patientId: PATIENTS.taylor }),
    record(IDS.visitJordan, 'journey', 'consulting', '2026-10-26T11:41:13.534Z', { complaint: 'Cough follow-up', department: 'General Outpatient', clinician: DOCTOR }, { patientId: PATIENTS.jordan }),
    record(IDS.visitSam, 'journey', 'waiting', '2026-10-26T11:41:13.556Z', { complaint: 'Abdominal pain', department: 'General Outpatient', clinician: DOCTOR }, { patientId: PATIENTS.sam }),
    record(IDS.visitRiley, 'journey', 'waiting', '2026-10-26T11:41:13.578Z', { complaint: 'Antenatal check', department: 'Maternity', clinician: DOCTOR }, { patientId: PATIENTS.riley }),
    record(IDS.visitAlex, 'journey', 'waiting', '2026-10-26T11:41:13.600Z', { complaint: 'General check-up', department: 'General Outpatient', clinician: DOCTOR }, { patientId: PATIENTS.alex }),
    record(IDS.visitCheckedIn, 'journey', 'waiting', '2026-10-26T11:41:35.320Z', { ...reviewOfResults, complaint: 'Review of results' }, { patientId: PATIENTS.taylor, parentId: IDS.apptTaylor }),

    // Radiology
    record(IDS.xray, 'radiology', 'published', '2026-10-26T11:41:15.539Z', { ...xrayReviewed, publishedAt: '2026-10-26T11:41:15.539Z' }, {
      patientId: PATIENTS.jordan, createdAt: '2026-10-26T11:41:15.430Z',
      versions: [
        ['2026-10-26T11:41:15.455Z', 'ordered', 'Schedule examination', xrayOrdered],
        ['2026-10-26T11:41:15.471Z', 'scheduled', 'Record examination', xrayScheduled],
        ['2026-10-26T11:41:15.489Z', 'examined', 'Attach local study', xrayExamined],
        ['2026-10-26T11:41:15.505Z', 'study-attached', 'Draft report', xrayAttached],
        ['2026-10-26T11:41:15.521Z', 'draft-report', 'Review report', xrayDrafted],
        ['2026-10-26T11:41:15.539Z', 'reviewed', 'Publish report', xrayReviewed],
      ],
    }),
    record(IDS.ultrasound, 'radiology', 'scheduled', '2026-10-26T11:41:15.580Z', { encounter: ENCOUNTERS.taylor, modality: 'Abdominal ultrasound', indication: 'Abdominal pain follow-up', urgency: 'Routine', scheduled: '2026-11-03T11:00' }, {
      patientId: PATIENTS.taylor, createdAt: '2026-10-26T11:41:15.560Z',
      versions: [['2026-10-26T11:41:15.580Z', 'ordered', 'Schedule examination', { encounter: ENCOUNTERS.taylor, modality: 'Abdominal ultrasound', indication: 'Abdominal pain follow-up', urgency: 'Routine' }]],
    }),

    // Inpatient / Wards and ICU (ICU admissions also show under Inpatient)
    record(IDS.admitTaylor, 'inpatient', 'admitted', '2026-10-26T11:41:14.656Z', { reason: 'Observation (fictional)', team: 'Medical team', bed: IDS.bed1 }, {
      patientId: PATIENTS.taylor, versions: [['2026-10-26T11:41:14.656Z', 'requested', 'Admit and allocate bed', { reason: 'Observation (fictional)', team: 'Medical team' }]],
    }),
    record(IDS.admitSam, 'inpatient', 'requested', '2026-10-26T11:41:14.680Z', { reason: 'Awaiting bed (fictional)', team: 'Surgical team' }, { patientId: PATIENTS.sam }),
    record(IDS.icuRiley, 'icu', 'admitted', '2026-10-26T11:41:14.711Z', { reason: 'Close monitoring (fictional)', team: 'Critical care', bed: IDS.bed2 }, {
      patientId: PATIENTS.riley, versions: [['2026-10-26T11:41:14.711Z', 'requested', 'Admit and allocate bed', { reason: 'Close monitoring (fictional)', team: 'Critical care' }]],
    }),

    // Wards & Beds and Ward configuration
    record(IDS.bed1, 'wards', 'occupied', '2026-10-26T11:41:13.300Z', { name: 'Bed 1', ward: IDS.wardExample, admission: IDS.admitTaylor }),
    record(IDS.bed2, 'wards', 'occupied', '2026-10-26T11:41:13.310Z', { name: 'Bed 2', ward: IDS.wardExample, admission: IDS.icuRiley }),
    record(IDS.wardExample, 'ward-config', 'active', '2026-10-26T11:41:13.200Z', { name: 'Example ward' }),
    record(IDS.wardFemale, 'ward-config', 'active', '2026-10-26T11:41:13.210Z', { name: 'Female Medical Ward' }),

    // Nursing tasks
    record(IDS.taskObs, 'nursing-tasks', 'in-progress', '2026-10-26T11:41:14.814Z', { admission: IDS.admitTaylor, name: '4-hourly observations', assignedTo: NURSE, due: '2026-11-02T14:00' }, {
      patientId: PATIENTS.taylor, versions: [['2026-10-26T11:41:14.814Z', 'assigned', 'Start task', { admission: IDS.admitTaylor, name: '4-hourly observations', assignedTo: NURSE, due: '2026-11-02T14:00' }]],
    }),
    record(IDS.taskWound, 'nursing-tasks', 'assigned', '2026-10-26T11:41:14.830Z', { admission: IDS.admitTaylor, name: 'Wound dressing check', assignedTo: NURSE, due: '2026-11-02T18:00' }, { patientId: PATIENTS.taylor }),

    // Emergency board, Maternity, Theatre & Procedures, Dental
    record(IDS.emergency, 'emergency', 'assessed', '2026-10-26T11:41:14.420Z', { complaint: 'Abdominal pain (fictional)', priority: 'Urgent', team: 'Demo Doctor', assessment: 'Fictional assessment' }, {
      patientId: PATIENTS.riley, versions: [['2026-10-26T11:41:14.420Z', 'arrived', 'Record assessment', { complaint: 'Abdominal pain (fictional)', priority: 'Urgent', team: 'Demo Doctor' }]],
    }),
    record(IDS.maternity, 'maternity', 'observed', '2026-10-26T11:41:14.460Z', { gestation: '28 weeks (fictional)', nextVisit: '2026-11-10T10:00', observations: 'Fictional antenatal observations' }, {
      patientId: PATIENTS.riley, versions: [['2026-10-26T11:41:14.460Z', 'enrolled', 'Antenatal observation', { gestation: '28 weeks (fictional)', nextVisit: '2026-11-10T10:00' }]],
    }),
    record(IDS.surgery, 'surgery', 'scheduled', '2026-10-26T11:41:14.500Z', { procedure: 'Appendectomy (fictional)', reason: 'Demo', scheduled: '2026-11-05T09:00', team: 'Demo team' }, {
      patientId: PATIENTS.sam, versions: [['2026-10-26T11:41:14.500Z', 'requested', 'Schedule procedure', { procedure: 'Appendectomy (fictional)', reason: 'Demo' }]],
    }),
    record(IDS.dental, 'dental', 'assessed', '2026-10-26T11:41:14.540Z', { scheduled: '2026-11-04T10:00', complaint: 'Toothache', findings: 'Fictional findings', plan: 'Fictional plan' }, {
      patientId: PATIENTS.taylor, versions: [['2026-10-26T11:41:14.540Z', 'booked', 'Record assessment', { scheduled: '2026-11-04T10:00', complaint: 'Toothache' }]],
    }),

    // Referral Network, Telemedicine
    record(IDS.referral, 'referrals', 'sent', '2026-10-26T11:41:14.580Z', { destination: 'Fictional Partner Clinic', reason: 'Specialist review', urgency: 'Routine', summary: 'Selected summary', scope: 'This summary only' }, {
      patientId: PATIENTS.jordan, versions: [['2026-10-26T11:41:14.580Z', 'draft', 'Send simulated referral', { destination: 'Fictional Partner Clinic', reason: 'Specialist review', urgency: 'Routine', summary: 'Selected summary', scope: 'This summary only' }]],
    }),
    record(IDS.telemedicine, 'telemedicine', 'waiting', '2026-10-26T11:41:14.620Z', { scheduled: '2026-11-06T10:00', clinician: 'Demo Doctor', reason: 'Remote follow-up' }, {
      patientId: PATIENTS.jordan, versions: [['2026-10-26T11:41:14.620Z', 'booked', 'Enter local waiting room', { scheduled: '2026-11-06T10:00', clinician: 'Demo Doctor', reason: 'Remote follow-up' }]],
    }),

    // Blood Bank (no patient)
    record(IDS.bloodScreened, 'bloodbank', 'screened', '2026-10-26T11:41:15.020Z', { donor: 'Fictional donor', group: 'O+', expiry: '2030-01-01', screening: 'Local screening record' }, {
      versions: [['2026-10-26T11:41:15.020Z', 'quarantine', 'Record screening review', { donor: 'Fictional donor', group: 'O+', expiry: '2030-01-01' }]],
    }),
    record(IDS.bloodQuarantine, 'bloodbank', 'quarantine', '2026-10-26T11:41:15.060Z', { donor: 'Fictional donor B', group: 'A-', expiry: '2030-02-01' }),
  ]
}
