import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime, formatTime, formatTimeOrDateTime, lagosClock, lagosDay } from '@hid/ui/display'
import type { DoseState, ObservationValues, PharmacyState, ShiftDuty, SupplySource, WardPatientCard } from '../../../staff/api'
import { errorText } from '../parts/errors'

/**
 * Nursing on the ward in the blue EHR (hid-system NUR-1, 0174-0177, on hid-system #343): the words, who may do what,
 * the refusals in plain words, and whether the routes are served here. Every time is Lagos time through @hid/ui/display
 * (website release F, P2-4), whatever the device's zone. No Health ID or NIN in any address: admissions, tasks, doses,
 * entries, shifts and sheets by UUID.
 */

// ---- Codes (0177, and the codes NUR-1 keeps) -----------------------------------------------

export const MAR_READ = 'ehr.mar.read'
export const MAR_RECORD = 'ehr.mar.record'
export const TASK_READ = 'ehr.nursing-task.read'
export const TASK_WRITE = 'ehr.nursing-task.write'
export const HANDOVER_WRITE = 'ehr.handover.write'
export const ASSIGN_MANAGE = 'ehr.shift-assignment.manage'
export const SHIFT_MANAGE = 'ehr.clinical-shift.manage'
export const VITAL_READ = 'ehr.vital.read'
export const VITAL_WRITE = 'ehr.vital.write'
export const ADMISSION_READ = 'ehr.admission.read'
export const WARD_READ = 'ehr.ward.read'
export const WARD_MANAGE = 'ehr.ward.manage'

const has = (permissions: readonly string[], ...codes: string[]) => codes.every(code => permissions.includes(code))
export const canReadRound = (p: readonly string[]) => has(p, MAR_READ)
export const canRecordDose = (p: readonly string[]) => has(p, MAR_RECORD)
export const canReadTasks = (p: readonly string[]) => has(p, TASK_READ)
export const canWriteTasks = (p: readonly string[]) => has(p, TASK_WRITE)
export const canWriteHandover = (p: readonly string[]) => has(p, HANDOVER_WRITE)
export const canAssign = (p: readonly string[]) => has(p, ASSIGN_MANAGE)
export const canSetUpShifts = (p: readonly string[]) => has(p, SHIFT_MANAGE)
export const canReadChart = (p: readonly string[]) => has(p, VITAL_READ, ADMISSION_READ)
export const canReadFluids = (p: readonly string[]) => has(p, VITAL_READ)
export const canWriteVitals = (p: readonly string[]) => has(p, VITAL_WRITE)
export const canReadWards = (p: readonly string[]) => has(p, WARD_READ) || has(p, WARD_MANAGE)
export const canListAdmissions = (p: readonly string[]) => has(p, WARD_READ)
/** Anything on a patient's ward chart: its observations, medicines, fluid balance or tasks. */
export const canOpenWardPatient = (p: readonly string[]) => canReadRound(p) || canReadTasks(p) || canReadFluids(p)

// ---- Words -------------------------------------------------------------------------------

export const EYEBROW = 'Ward nursing'
export const TASKS_TITLE = 'Nursing tasks'
export const ROUND_TITLE = 'Medicine round'
export const HANDOVER_TITLE = 'Shift handover'
export const SHIFTS_TITLE = 'Clinical shifts'
export const PATIENT_TITLE = 'Ward patient'

export const TASKS_BASE = '/provider/nursing-tasks'
export const ROUND_BASE = '/provider/medicine-round'
export const HANDOVER_BASE = '/provider/handover'
export const SHIFTS_BASE = '/provider/clinical-shifts'
export const PATIENT_BASE = '/provider/ward-patient'

/** Every ward list says it (NUR-1, Q190 A). */
export const SCREEN_WARNING = 'Do not show this list on a screen patients or visitors can see.'
export const NOT_AVAILABLE = 'The medicine round and nursing tasks are not switched on yet.'
export const FIELDS_NOT_AVAILABLE = 'These fields are not switched on yet.'
export const NURSING_REFUSED = 'Only nurses, clinicians and doctors of this facility can use the medicine round and nursing tasks.'
export const SHIFTS_REFUSED = 'Only the facility’s admins can set up clinical shifts, and nurses in charge assign them.'
export const CHART_ACCESS = 'Open this patient’s record first, then try again.'
export const NO_WARDS = 'This facility has no wards set up yet. An admin sets them up in Ward configuration.'

export const NURSING_REFUSALS: Readonly<Record<string, string>> = {
  NURSING_NOT_AVAILABLE: NOT_AVAILABLE,
  INPATIENT_NOT_AVAILABLE: 'Inpatient care is not switched on yet.',
  NURSING_FIELDS_NOT_AVAILABLE: FIELDS_NOT_AVAILABLE,
  NURSING_NOT_ALLOWED: NURSING_REFUSED,
  INPATIENT_NOT_ALLOWED: 'Only nurses, clinicians and doctors of this facility can use the wards.',
  MAR_RECORD_NOT_ALLOWED: 'Only nurses, clinicians and doctors can record doses.',
  SHIFT_SETUP_NOT_ALLOWED: 'Only the facility’s admins can set up clinical shifts.',
  SHIFT_ASSIGN_NOT_ALLOWED: 'Only nurses in charge and admins can assign shifts.',
  CHART_ACCESS_REQUIRED: CHART_ACCESS,
  ADMISSION_CHART_ACCESS_REQUIRED: CHART_ACCESS,
  NURSING_VERSION_CONFLICT: 'Someone else changed this. Reload it and try again.',
  OXYGEN_FIELDS_INVALID: 'Enter the flow or FiO2 with an oxygen device, or 21% on room air.',
  GCS_INCOMPLETE: 'Enter all three GCS parts, or mark the verbal part as not testable.',
  DOSE_REASON_REQUIRED: 'Choose a reason for a dose that was not given.',
  DOSE_DIFFERS_REASON_REQUIRED: 'Say why the dose differs from the order.',
  SUPPLY_SOURCE_REQUIRED: 'The pharmacy has not dispensed this medicine. Say where it came from.',
  AS_NEEDED_OVERRIDE_REASON_REQUIRED: 'This is sooner or more often than ordered. Say why.',
  DOSE_TIME_INVALID: 'The time can be up to 12 hours ago, and not in the future.',
  ADMISSION_NOT_FOUND: 'This patient is not on a ward here.',
  ADMISSION_NOT_OPEN: 'This patient has been discharged. The record can still be read.',
  MAR_ORDER_NOT_ACTIVE: 'This order is not active. Ask the prescriber.',
  DOSE_ALREADY_RECORDED: 'This dose is already recorded. Mark it entered in error if it is wrong.',
  ALREADY_ENTERED_IN_ERROR: 'This is already marked entered in error.',
  ADMINISTRATION_NOT_FOUND: 'This dose record was not found. Reload the medicines.',
  TASK_ASSIGNEE_INVALID: 'Choose a nurse, clinician or doctor who works at this facility.',
  TASK_STATE_INVALID: 'This task has moved on. Reload it.',
  TASK_NOT_FOUND: 'This task was not found. Reload the list.',
  FLUID_ENTRY_INVALID: 'Enter the amount in mL, or mark it as not measured.',
  FLUID_ENTRY_NOT_FOUND: 'This entry was not found. Reload the fluid balance.',
  SHIFT_TIMES_INVALID: 'Enter a start and end time. A shift can run past midnight.',
  SHIFT_NAME_TAKEN: 'This name is already used. Choose another.',
  SHIFT_LIMIT_REACHED: 'This facility already has 8 active shifts. Stop one first.',
  SHIFT_NOT_FOUND: 'This shift was not found. Reload the shifts.',
  SHIFT_ASSIGNEE_INVALID: 'Nurses and the nurse in charge must be nurses or clinicians here, and the on-call doctor a doctor or clinician here.',
  HANDOVER_NOT_DRAFT: 'This handover has been given. Write any change in the next one.',
  HANDOVER_NOT_YOURS: 'Only a nurse on the next shift for this ward can accept the handover.',
  HANDOVER_NOT_GIVEN: 'This handover has not been given yet.',
  HANDOVER_ALREADY_ACCEPTED: 'This handover has already been accepted.',
  HANDOVER_NOT_FOUND: 'This handover was not found. Reload the sheet.',
  WARD_NOT_FOUND: 'This ward was not found. Choose another ward.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong. Reload the page and try again.',
  PURPOSE_OF_USE_REQUIRED: 'The ward pages are for patient care only. Reload the page and try again.',
}

/** The 404s that are an answer about one record, not "this route is not here". */
const RECORD_NOT_FOUND = new Set(['ADMISSION_NOT_FOUND', 'TASK_NOT_FOUND', 'ADMINISTRATION_NOT_FOUND', 'FLUID_ENTRY_NOT_FOUND',
  'SHIFT_NOT_FOUND', 'HANDOVER_NOT_FOUND', 'WARD_NOT_FOUND'])

/** Whether a refusal says nursing is not served here: an ehr-api before NUR-1 (404), or either flag off (503). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && (caught.code === 'NURSING_NOT_AVAILABLE' || caught.code === 'INPATIENT_NOT_AVAILABLE')) return true
  return caught.status === 404 && !RECORD_NOT_FOUND.has(caught.code)
}

/** A refusal in plain words: NUR-1's own, then the department pages' (never the service's text, never "permission"). */
export function refusalWords(caught: unknown, fallback: string): string {
  if (notServed(caught)) return isHidApiError(caught) && caught.code === 'INPATIENT_NOT_AVAILABLE' ? NURSING_REFUSALS.INPATIENT_NOT_AVAILABLE! : NOT_AVAILABLE
  if (isHidApiError(caught) && Object.hasOwn(NURSING_REFUSALS, caught.code)) return NURSING_REFUSALS[caught.code]!
  if (isHidApiError(caught) && caught.status === 403) return NURSING_REFUSED
  return errorText(caught, fallback)
}

export function isChartAccessRefusal(caught: unknown): boolean {
  return isHidApiError(caught) && (caught.code === 'CHART_ACCESS_REQUIRED' || caught.code === 'ADMISSION_CHART_ACCESS_REQUIRED')
}

// ---- Served ------------------------------------------------------------------------------
// One answer for every nursing page, as the emergency board learns its own: a 404 from an ehr-api before NUR-1, or a 503
// while a flag is off, says "not served" only while nothing has said otherwise; any answer says served, once and for all.
// Until then null, and the pages are listed.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()

export function learnNursingServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  for (const listener of listeners) listener()
}
export function nursingServed(): Served { return served }
export function subscribeNursingServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useNursingServed(): Served {
  return useSyncExternalStore(subscribeNursingServed, nursingServed, nursingServed)
}
/** For tests: forget what was learned. */
export function forgetNursingServed(): void {
  served = null
  for (const listener of listeners) listener()
}
/** Records what an answer (no argument) or a refusal says about whether nursing is served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnNursingServed(true); return }
  if (notServed(caught)) learnNursingServed(false)
}
/** Wraps a NUR-1 read so its answer or refusal teaches whether nursing is served. */
export function learning<T>(read: Promise<T>): Promise<T> {
  return read.then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught })
}

/**
 * Wraps one of ADT-1's reads (wards, admissions): its refusal can say nursing is not served (inpatient care is off, or
 * an ehr-api before it), but its answer cannot say nursing is (NURSING_ENABLED is a flag of its own).
 */
export function learningRefusal<T>(read: Promise<T>): Promise<T> {
  return read.catch(caught => { learnFrom(caught); throw caught })
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fresh Idempotency-Key of 32 URL-safe characters (16-128 allowed). */
export function newKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// ---- Lagos time ---------------------------------------------------------------------------

export const lagosTime = (value: string | null | undefined) => formatTime(value, '—')
export const lagosDateTime = (value: string | null | undefined) => formatDateTime(value, '—')
export const lagosWhen = (value: string | null | undefined, now: number = Date.now()) => formatTimeOrDateTime(value, now, '—')
export const lagosDate = (value: string | null | undefined) => formatDate(value, '—')
export { lagosDay }

const two = (value: number) => String(value).padStart(2, '0')

/** A moment as a datetime-local field's value, in Lagos time ("2026-12-03T09:10"). */
export function lagosInput(value: number | string = Date.now()): string {
  const clock = lagosClock(value)
  return clock ? `${clock.year}-${two(clock.month)}-${two(clock.day)}T${two(clock.hour)}:${two(clock.minute)}` : ''
}

/** A datetime-local field's value, read as Lagos time (UTC+1, no daylight saving), as an ISO UTC time; null if not a time. */
export function lagosInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const ms = Date.UTC(year, month - 1, day, hour - 1, minute)
  const check = lagosClock(ms)
  if (!check || check.year !== year || check.month !== month || check.day !== day || check.hour !== hour) return null
  return new Date(ms).toISOString()
}

/** The Lagos day a number of days from today ("2026-12-04"), for the handover's and assignments' day field. */
export function lagosDayFrom(offsetDays: number, now: number = Date.now()): string {
  return lagosDay(now + offsetDays * 24 * 60 * 60 * 1000)
}

// ---- The patient on a ward list (Q190 A) ---------------------------------------------------

/** The name a ward list may show: the full name only where the member can read the chart; else the initials. */
export function patientName(card: Pick<WardPatientCard, 'fullName' | 'nameHidden' | 'initials'>): string {
  return !card.nameHidden && card.fullName ? card.fullName : card.initials
}

const SEX_WORDS: Readonly<Record<string, string>> = { female: 'Female', male: 'Male', intersex: 'Intersex', other: 'Other', unknown: 'Sex not known' }

/** "Female · 54 years · NIN Verified": sex, age (an estimate says so) and NIN status, never a Health ID in full. */
export function patientFacts(card: WardPatientCard): string {
  const age = card.ageYears === null || card.ageYears === undefined ? '' : `${card.ageEstimated ? 'about ' : ''}${card.ageYears} years`
  const parts = [card.sex ? SEX_WORDS[card.sex] ?? card.sex : '', age, card.ninStatus === 'verified' ? 'NIN Verified' : 'NIN Not Verified']
  return parts.filter(Boolean).join(' · ')
}

// ---- The medicine round ---------------------------------------------------------------------

export const DOSE_STATE_WORDS: Readonly<Record<DoseState, string>> = {
  upcoming: 'Upcoming', due: 'Due', late: 'Late', given: 'Given', held: 'Held', refused: 'Refused', omitted: 'Omitted',
  not_available: 'Not available',
}
export const doseStateTone = (state: DoseState) =>
  state === 'late' ? 'critical' as const : state === 'due' ? 'caution' as const : state === 'given' ? 'positive' as const : 'neutral' as const

export const OUTCOME_WORDS = { given: 'Given', held: 'Held', refused: 'Refused', omitted: 'Omitted', not_available: 'Not available' } as const

/** The reasons each outcome but given takes (NUR-1 route 6). */
export const REASONS_BY_OUTCOME: Readonly<Record<string, readonly string[]>> = {
  held: ['clinical_decision', 'awaiting_result', 'nil_by_mouth'],
  omitted: ['patient_away', 'no_access', 'nil_by_mouth', 'other'],
  not_available: ['not_in_stock', 'awaiting_pharmacy', 'patient_to_buy'],
  refused: ['patient_refused'],
}
export const REASON_WORDS: Readonly<Record<string, string>> = {
  clinical_decision: 'Clinical decision', awaiting_result: 'Waiting for a result', nil_by_mouth: 'Nil by mouth',
  patient_away: 'Patient away from the ward', no_access: 'No way to give it (for example, no IV access)', other: 'Other',
  not_in_stock: 'Not in stock', awaiting_pharmacy: 'Waiting for the pharmacy', patient_to_buy: 'Patient to buy it',
  patient_refused: 'Patient refused',
}
/** Reasons that need a few words more (8 or more characters). */
export const REASON_NEEDS_TEXT = new Set(['clinical_decision', 'other'])

export const PHARMACY_WORDS: Readonly<Record<PharmacyState, string>> = {
  not_sent: 'Not sent to the pharmacy', sent: 'Sent to the pharmacy', accepted: 'Accepted by the pharmacy', dispensed: 'Dispensed',
  part_dispensed: 'Part dispensed', not_dispensable: 'The pharmacy cannot dispense it', reversed: 'Dispensing reversed',
}
/** Whether the pharmacy has handed the medicine over (else a given dose says where it came from, Q198 A). */
export const dispensed = (state: PharmacyState) => state === 'dispensed' || state === 'part_dispensed'

export const SUPPLY_WORDS: Readonly<Record<SupplySource, string>> = {
  ward_stock: 'Ward stock', patient_own: 'The patient’s own', bought_outside: 'Bought outside',
}
export const WARNING_WORDS: Readonly<Record<string, string>> = {
  late: 'Given more than 60 minutes after the due time.',
  dose_differs: 'The dose differs from the order.',
  as_needed_inside_gap: 'Sooner than the order allows.',
  as_needed_over_max: 'More doses in 24 hours than the order allows.',
  before_dispensing: 'Given before the pharmacy dispensed it.',
}
export const SCHEDULE_WORDS = { regular: 'Set times', as_needed: 'As needed', stat: 'STAT', once: 'Once' } as const

// ---- Observations (Q195 A, Q199 A: values and soft flags only, never a score) ---------------

export const AVPU_WORDS: Readonly<Record<string, string>> = {
  alert: 'Alert', voice: 'Responds to voice', pain: 'Responds to pain', unresponsive: 'Unresponsive',
}
export const OXYGEN_DEVICE_WORDS: Readonly<Record<string, string>> = {
  room_air: 'Room air', nasal_cannula: 'Nasal cannula', simple_mask: 'Simple face mask', venturi_mask: 'Venturi mask',
  non_rebreather_mask: 'Non-rebreather mask', high_flow_nasal: 'High-flow nasal oxygen', cpap_or_niv: 'CPAP or NIV',
  tracheostomy_mask: 'Tracheostomy mask', ventilator: 'Ventilated', other: 'Other device',
}
export const FLAG_WORDS: Readonly<Record<string, string>> = {
  outside_usual: 'Outside the usual range', far_outside_usual: 'Far outside the usual range', check_entry: 'Check this entry',
}
export const MEASURE_WORDS: Readonly<Record<string, string>> = {
  systolicMmhg: 'Blood pressure', diastolicMmhg: 'Blood pressure', bloodPressure: 'Blood pressure', pulseBpm: 'Pulse',
  temperatureC: 'Temperature', respiratoryRate: 'Breathing rate', oxygenSaturationPercent: 'Oxygen saturation',
  weightKg: 'Weight', heightCm: 'Height', painScore: 'Pain', avpu: 'AVPU', bloodGlucoseMmolL: 'Blood glucose',
  oxygenDevice: 'Oxygen', oxygenFlowLPerMin: 'Oxygen flow', fio2Percent: 'FiO2', gcsEye: 'GCS', gcsVerbal: 'GCS', gcsMotor: 'GCS',
}

const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/** Mean arterial pressure, plain arithmetic of the two values entered (allowed by NUR-1 route 2), rounded. */
export function meanArterialPressure(values: ObservationValues): number | null {
  const systolic = num(values.systolicMmhg)
  const diastolic = num(values.diastolicMmhg)
  return systolic === null || diastolic === null ? null : Math.round((systolic + 2 * diastolic) / 3)
}

/** "E3 V4 M6 (13)", or "E3 VT M6" when the verbal part is not testable (no total then). Null with no GCS. */
export function gcsText(values: ObservationValues): string | null {
  const eye = num(values.gcsEye)
  const motor = num(values.gcsMotor)
  const verbal = num(values.gcsVerbal)
  if (eye === null || motor === null) return null
  if (values.gcsVerbalNotTestable === true) return `E${eye} VT M${motor}`
  return verbal === null ? null : `E${eye} V${verbal} M${motor} (${eye + verbal + motor})`
}

/** Each value entered, as the chart's rows show it. Measures not entered are left out. */
export function observationLines(values: ObservationValues): { label: string; text: string; measures: string[] }[] {
  const lines: { label: string; text: string; measures: string[] }[] = []
  const systolic = num(values.systolicMmhg)
  const diastolic = num(values.diastolicMmhg)
  if (systolic !== null || diastolic !== null) {
    const map = meanArterialPressure(values)
    lines.push({ label: 'Blood pressure', text: `${systolic ?? '—'}/${diastolic ?? '—'} mmHg${map !== null ? ` (MAP ${map})` : ''}`,
      measures: ['systolicMmhg', 'diastolicMmhg', 'bloodPressure'] })
  }
  const simple: [string, string, string][] = [
    ['pulseBpm', 'Pulse', '/min'], ['respiratoryRate', 'Breathing rate', '/min'], ['oxygenSaturationPercent', 'Oxygen saturation', '%'],
    ['temperatureC', 'Temperature', ' °C'], ['bloodGlucoseMmolL', 'Blood glucose', ' mmol/L'], ['painScore', 'Pain', ' of 10'],
    ['weightKg', 'Weight', ' kg'], ['heightCm', 'Height', ' cm'],
  ]
  for (const [key, label, unit] of simple) {
    const value = num(values[key as keyof ObservationValues])
    if (value !== null) lines.push({ label, text: `${value}${unit}`, measures: [key] })
  }
  if (typeof values.avpu === 'string') lines.push({ label: 'AVPU', text: AVPU_WORDS[values.avpu] ?? values.avpu, measures: ['avpu'] })
  if (typeof values.oxygenDevice === 'string') {
    const flow = num(values.oxygenFlowLPerMin)
    const fio2 = num(values.fio2Percent)
    const extra = [flow !== null ? `${flow} L/min` : '', fio2 !== null ? `FiO2 ${fio2}%` : ''].filter(Boolean).join(', ')
    lines.push({ label: 'Oxygen', text: `${OXYGEN_DEVICE_WORDS[values.oxygenDevice] ?? values.oxygenDevice}${extra ? ` (${extra})` : ''}`,
      measures: ['oxygenDevice', 'oxygenFlowLPerMin', 'fio2Percent'] })
  } else if (num(values.fio2Percent) !== null) {
    lines.push({ label: 'FiO2', text: `${num(values.fio2Percent)}%`, measures: ['fio2Percent'] })
  }
  const gcs = gcsText(values)
  if (gcs) lines.push({ label: 'GCS', text: gcs, measures: ['gcsEye', 'gcsVerbal', 'gcsMotor'] })
  return lines
}

// ---- Fluid balance ---------------------------------------------------------------------------

export const FLUID_KIND_WORDS: Readonly<Record<string, string>> = {
  oral: 'Oral', iv: 'IV fluid', enteral_tube: 'Tube feed', blood_product: 'Blood product', other: 'Other',
  urine: 'Urine', vomit: 'Vomit', drain: 'Drain', stool: 'Stool', tube_aspirate: 'Tube aspirate', blood_loss: 'Blood loss',
}
/** "+250 mL", "−400 mL", "0 mL". */
export function balanceText(ml: number | null | undefined): string {
  if (ml === null || ml === undefined) return '—'
  if (ml === 0) return '0 mL'
  return `${ml > 0 ? '+' : '−'}${Math.abs(ml)} mL`
}

// ---- Shifts ------------------------------------------------------------------------------------

export const DUTY_WORDS: Readonly<Record<ShiftDuty, string>> = { nurse: 'Nurse', nurse_in_charge: 'Nurse in charge', on_call_doctor: 'On-call doctor' }
/** The setup screen's starting point (Q-NUR-16 A): never seeded, offered to add. */
export const SUGGESTED_SHIFTS = [
  { name: 'Morning', startsAt: '07:30', endsAt: '14:30' },
  { name: 'Afternoon', startsAt: '14:00', endsAt: '21:00' },
  { name: 'Night', startsAt: '20:30', endsAt: '08:00' },
] as const

/** Who a membership is: "You", their name, or "A staff member here" (never the id). */
export function memberText(membershipId: string | null | undefined, me: string | undefined, names: ReadonlyMap<string, string | null>, none = 'Not assigned'): string {
  if (!membershipId) return none
  if (me && membershipId.toLowerCase() === me.toLowerCase()) return 'You'
  return names.get(membershipId.toLowerCase()) ?? 'A staff member here'
}

/** "3 tasks", "1 task". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}
