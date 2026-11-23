/**
 * The chart summary (EHR-C4, GET /ehr/patients/:patientId/chart-summary, live at hid-system 4c843270): one call for
 * what a doctor's chart opens with. Each section is answered only when the caller holds the permission of the route
 * that reads it today; a section not answered is listed in `leftOut` with a reason and a sentence to show. Pure; nothing
 * here reads or writes the network or the browser's storage.
 *
 * The parser keeps what the patient page shows and nothing else (no code, no id is ever shown). An answer that is not a
 * chart summary for this patient throws, and the page then reads today's separate lists instead. A section whose items
 * can't all be read is not shown in part (a dropped line could be the one that matters): it is said as could not be
 * loaded, in the contract's words.
 */

/** The sections in the order the contract lists them (chart-summary.service.ts CHART_SECTIONS). */
export const CHART_SECTIONS = ['demographics', 'problems', 'medications', 'allergies', 'latestVitals',
  'recentVisits', 'openLabRequests', 'recentResults'] as const
export type ChartSection = typeof CHART_SECTIONS[number]

/**
 * The route is open to a role holding at least one of these (EHR-C4); each section then needs its own. A role with none
 * is never asked, and sees what it sees today.
 */
export const CHART_SUMMARY_PERMISSIONS = ['ehr.encounter.read', 'ehr.diagnosis.read', 'ehr.prescription.read',
  'ehr.lab-request.read', 'ehr.vital.read', 'ehr.note.read'] as const

/** The contract's sentences for a section left out (EHR-C4, "Sections left out"), word for word. */
export const LEFT_OUT_PERMISSION = 'You do not have permission to see this part of the chart.'
export const LEFT_OUT_EMERGENCY = 'Emergency access shows allergies and past visits only. This part of the chart is not shown.'
export const LEFT_OUT_UNAVAILABLE = 'This part of the chart could not be loaded just now. Try again in a moment.'
export const PHARMACY_PROGRESS_UNAVAILABLE = 'Pharmacy progress could not be loaded just now. The medicines are shown without it.'
export const LAB_PROGRESS_UNAVAILABLE = 'Laboratory progress could not be loaded just now. The lab requests are shown without it.'
const CONTRACT_SENTENCES: readonly string[] = [LEFT_OUT_PERMISSION, LEFT_OUT_EMERGENCY, LEFT_OUT_UNAVAILABLE]

/** ORD-3's words for a progress the pharmacy or laboratory could not tell. */
export const PROGRESS_UNKNOWN = 'Progress not available right now'

export interface PharmacyProgress {
  /** ORD-3: not_received, received, dispensed, dispensing_reversed, or unknown (any value not known here too). */
  readonly status: 'not_received' | 'received' | 'dispensed' | 'dispensing_reversed' | 'unknown'
  readonly receivedAt: string | null
  readonly dispensedAt: string | null
  readonly reversedAt: string | null
}

export interface LabProgress {
  readonly status: 'not_received' | 'received' | 'sample_collected' | 'some_results_ready' | 'results_ready' | 'unknown'
  readonly receivedAt: string | null
  readonly collectedAt: string | null
  readonly lastResultAt: string | null
}

export interface Problem {
  readonly id: string
  readonly encounterId: string
  readonly display: string
  readonly clinicalStatus: string
  readonly createdAt: string | null
}

export interface Medication {
  readonly id: string
  readonly encounterId: string
  readonly medicationDisplay: string
  readonly doseQuantity: string | null
  readonly doseUnit: string | null
  readonly routeCode: string | null
  readonly frequency: string | null
  readonly status: string
  /** Absent on an answer without ORD-3: nothing is said then. */
  readonly ownProgress: PharmacyProgress | null
}

export interface LabRequest {
  readonly id: string
  readonly encounterId: string
  readonly testDisplay: string
  readonly priority: string | null
  readonly status: string
  readonly ownProgress: LabProgress | null
}

/** EHR-C3's measures, as the summary carries them: blood pressure is one pair from one reading. */
export const VITAL_MEASURES = ['bloodPressure', 'pulseBpm', 'temperatureC', 'respiratoryRate', 'oxygenSaturationPercent',
  'weightKg', 'heightCm'] as const
export type VitalMeasure = typeof VITAL_MEASURES[number]

export interface LatestVital {
  readonly measure: VitalMeasure
  /** A number, or for blood pressure the systolic and diastolic pair. */
  readonly value: number | { readonly systolicMmhg: number; readonly diastolicMmhg: number }
  readonly recordedAt: string | null
  readonly vitalId: string
  readonly encounterId: string
  readonly corrected: boolean
}

export interface Visit {
  readonly id: string
  readonly encounterType: string
  readonly status: string
  readonly startedAt: string
  readonly chiefComplaint: string | null
}

export interface ReleasedResult {
  readonly id: string
  readonly title: string
  readonly recordedAt: string | null
}

export interface ChartList<Item> {
  readonly items: readonly Item[]
  /** There were more than the summary's limit. */
  readonly more: boolean
}

/** A section as the page shows it: its content, or the sentence to show where it would be. */
export type Shown<Value> = { readonly shown: true; readonly value: Value } | { readonly shown: false; readonly message: string }

export interface ChartSummary {
  readonly problems: Shown<ChartList<Problem>>
  readonly medications: Shown<ChartList<Medication>>
  /** Shown on the patient page by the Allergies card (its own read, which its changes need): only whether it was answered. */
  readonly allergies: Shown<true>
  readonly latestVitals: Shown<readonly LatestVital[]>
  readonly recentVisits: Shown<ChartList<Visit>>
  readonly openLabRequests: Shown<ChartList<LabRequest>>
  /** `complete` false: Lab had more released results than the summary reads, so the newest may not be among these. */
  readonly recentResults: Shown<ChartList<ReleasedResult> & { readonly complete: boolean }>
  /** The contract's sentence when the pharmacy or laboratory progress could not be read (ORD-3 `unknown` items). */
  readonly progressNotes: { readonly medications: string | null; readonly openLabRequests: string | null }
  /** The summary's own limits, where the answer gives them, so "the newest 10" says the number the EHR used. */
  readonly limits: Readonly<Partial<Record<'problems' | 'medications' | 'recentVisits' | 'openLabRequests' | 'recentResults', number>>>
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const time = (value: unknown): string | null => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
/** A dose as the EHR answers it: text ("1.0000") or a number; anything else is none. */
const amount = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Unreadable: the section is said as could not be loaded. */
class Unreadable extends Error {}
const unreadable = (): never => { throw new Unreadable('This part of the chart could not be read.') }

function list<Item>(value: unknown, item: (row: unknown) => Item): ChartList<Item> {
  if (!record(value) || !Array.isArray(value.items) || typeof value.more !== 'boolean') unreadable()
  const section = value as { items: unknown[]; more: boolean }
  return { items: section.items.map(item), more: section.more }
}

const PHARMACY_STATES: readonly PharmacyProgress['status'][] = ['not_received', 'received', 'dispensed', 'dispensing_reversed', 'unknown']
const LAB_STATES: readonly LabProgress['status'][] = ['not_received', 'received', 'sample_collected', 'some_results_ready', 'results_ready', 'unknown']

/** ORD-3's progress; a status not known here is said as not available, never guessed. Absent: null (an EHR before ORD-3). */
function pharmacyProgress(value: unknown): PharmacyProgress | null {
  if (value === undefined || value === null) return null
  if (!record(value)) return { status: 'unknown', receivedAt: null, dispensedAt: null, reversedAt: null }
  const status = PHARMACY_STATES.find(state => state === value.status) ?? 'unknown'
  return { status, receivedAt: time(value.receivedAt), dispensedAt: time(value.dispensedAt), reversedAt: time(value.reversedAt) }
}

function labProgress(value: unknown): LabProgress | null {
  if (value === undefined || value === null) return null
  if (!record(value)) return { status: 'unknown', receivedAt: null, collectedAt: null, lastResultAt: null }
  const status = LAB_STATES.find(state => state === value.status) ?? 'unknown'
  return { status, receivedAt: time(value.receivedAt), collectedAt: time(value.collectedAt), lastResultAt: time(value.lastResultAt) }
}

function problem(row: unknown): Problem {
  if (!record(row) || !id(row.id) || !id(row.encounterId)) return unreadable()
  // A diagnosis saved by name only may carry no code (planned contract, ICD-11); the name is what is shown.
  const display = text(row.display) ?? unreadable()
  return { id: row.id, encounterId: row.encounterId, display, clinicalStatus: text(row.clinicalStatus) ?? '', createdAt: time(row.createdAt) }
}

function medication(row: unknown): Medication {
  if (!record(row) || !id(row.id) || !id(row.encounterId)) return unreadable()
  const medicationDisplay = text(row.medicationDisplay) ?? unreadable()
  return {
    id: row.id, encounterId: row.encounterId, medicationDisplay,
    doseQuantity: amount(row.doseQuantity), doseUnit: text(row.doseUnit), routeCode: text(row.routeCode), frequency: text(row.frequency),
    status: text(row.status) ?? '', ownProgress: pharmacyProgress(row.ownProgress),
  }
}

function labRequest(row: unknown): LabRequest {
  if (!record(row) || !id(row.id) || !id(row.encounterId)) return unreadable()
  const testDisplay = text(row.testDisplay) ?? unreadable()
  return { id: row.id, encounterId: row.encounterId, testDisplay, priority: text(row.priority), status: text(row.status) ?? '', ownProgress: labProgress(row.ownProgress) }
}

function visit(row: unknown): Visit {
  if (!record(row) || !id(row.id) || typeof row.startedAt !== 'string') return unreadable()
  // The emergency read's visits carry no chief complaint; direct care's may be null.
  return { id: row.id, encounterType: text(row.encounterType) ?? '', status: text(row.status) ?? '', startedAt: row.startedAt, chiefComplaint: text(row.chiefComplaint) }
}

function result(row: unknown): ReleasedResult {
  if (!record(row) || !id(row.id)) return unreadable()
  return { id: row.id, title: text(row.title) ?? unreadable(), recordedAt: time(row.recordedAt) }
}

/** EHR-C3's measures in the order the page lists them; a measure not known here is left out, never shown raw. */
function latestVitals(value: unknown): LatestVital[] {
  if (!record(value) || !record(value.measures)) return unreadable()
  const measures = value.measures
  const rows: LatestVital[] = []
  for (const measure of VITAL_MEASURES) {
    const entry = measures[measure]
    if (entry === undefined) continue
    if (!record(entry) || !id(entry.vitalId) || !id(entry.encounterId)) return unreadable()
    let reading: LatestVital['value']
    if (measure === 'bloodPressure') {
      const pair = entry.value
      if (!record(pair) || !finite(pair.systolicMmhg) || !finite(pair.diastolicMmhg)) return unreadable()
      reading = { systolicMmhg: pair.systolicMmhg, diastolicMmhg: pair.diastolicMmhg }
    } else {
      if (!finite(entry.value)) return unreadable()
      reading = entry.value
    }
    rows.push({ measure, value: reading, recordedAt: time(entry.recordedAt), vitalId: entry.vitalId, encounterId: entry.encounterId, corrected: entry.corrected === true })
  }
  return rows
}

function allergies(value: unknown): true {
  return record(value) && Array.isArray(value.recorded) && record(value.patientReported) ? true : unreadable()
}

function recentResults(value: unknown): ChartList<ReleasedResult> & { complete: boolean } {
  const page = list(value, result)
  return { ...page, complete: record(value) && value.complete === false ? false : true }
}

const READERS = {
  problems: (value: unknown) => list(value, problem),
  medications: (value: unknown) => list(value, medication),
  allergies,
  latestVitals,
  recentVisits: (value: unknown) => list(value, visit),
  openLabRequests: (value: unknown) => list(value, labRequest),
  recentResults,
} as const
type Read = typeof READERS

/** The sentence for a section left out: the contract's own, as the answer gives it, or the contract's by reason. */
function leftOutMessage(entry: Record<string, unknown> | undefined): string {
  if (!entry) return LEFT_OUT_UNAVAILABLE
  if (typeof entry.message === 'string' && CONTRACT_SENTENCES.includes(entry.message)) return entry.message
  return entry.reason === 'permission' ? LEFT_OUT_PERMISSION : LEFT_OUT_UNAVAILABLE
}

/**
 * The answer for this patient, read as the page shows it. Throws when it is not a chart summary for this patient: the
 * page then reads today's lists instead, so nothing is lost on an answer it can't read.
 */
export function parseChartSummary(answer: unknown, patientId: string): ChartSummary {
  if (!record(answer) || !record(answer.sections) || answer.patientId !== patientId) {
    throw new Error('The chart summary could not be read.')
  }
  const sections = answer.sections
  const leftOut = Array.isArray(answer.leftOut) ? answer.leftOut.filter(record) : []
  const entry = (section: string) => leftOut.find(item => item.section === section)

  function section<Key extends keyof Read>(key: Key): Shown<ReturnType<Read[Key]>> {
    if (Object.hasOwn(sections, key)) {
      try {
        return { shown: true, value: READERS[key](sections[key]) as ReturnType<Read[Key]> }
      } catch (caught) {
        if (!(caught instanceof Unreadable)) throw caught
        return { shown: false, message: LEFT_OUT_UNAVAILABLE }
      }
    }
    // Neither answered nor listed as left out (an answer this page does not know): said as could not be loaded.
    return { shown: false, message: leftOutMessage(entry(key)) }
  }

  const limits: Record<string, number> = {}
  if (record(answer.limits)) {
    for (const key of ['problems', 'medications', 'recentVisits', 'openLabRequests', 'recentResults']) {
      const value = answer.limits[key]
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) limits[key] = value
    }
  }

  return {
    problems: section('problems'),
    medications: section('medications'),
    allergies: section('allergies'),
    latestVitals: section('latestVitals'),
    recentVisits: section('recentVisits'),
    openLabRequests: section('openLabRequests'),
    recentResults: section('recentResults'),
    progressNotes: {
      medications: entry('medications.ownProgress') ? PHARMACY_PROGRESS_UNAVAILABLE : null,
      openLabRequests: entry('openLabRequests.ownProgress') ? LAB_PROGRESS_UNAVAILABLE : null,
    },
    limits,
  }
}
