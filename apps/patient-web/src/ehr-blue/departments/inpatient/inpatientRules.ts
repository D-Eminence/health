import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime, formatTime, lagosClock, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  AdmissionCard, AdmissionMovement, AdmissionSource, AdmissionStatus, BedStatus, DischargeCondition, DischargeOutcome,
  MovementKind, ReprintReason, WardTakes, WardType,
} from '../../../staff/api'

/*
 * Inpatient admission, wards and beds (hid-system ADT-1, migrations 0170-0173; INTERFACE_CONTRACT.md "ADT-1") in plain
 * words: who may do what, what each status, outcome and ward type is called, the Lagos time of every moment whatever the
 * device's zone (P2-4, @hid/ui/display), and what each refusal says. The backend decides every request; these only
 * choose what the pages offer. Built at the recommended option of every sprint decision (owner, 25 Nov 2026: "I approve
 * Q147–Q290 at the recommended options"): Q184-Q192 and Q201 A, and Q-ADT-9 A to Q-ADT-18 A.
 */

export const INPATIENT_TITLE = 'Inpatient / Wards'
export const WARDS_TITLE = 'Wards & Beds'
export const ICU_TITLE = 'ICU'
export const WARD_CONFIG_TITLE = 'Ward configuration'
export const EYEBROW = 'Wards & units'
export const INPATIENT_BASE = '/provider/inpatient'
export const WARDS_BASE = '/provider/wards'
export const ICU_BASE = '/provider/icu'
export const WARD_CONFIG_BASE = '/provider/ward-config'

/** Q190 A: said on every ward list. */
export const SCREEN_WARNING = 'Do not show this list on a screen patients or visitors can see.'
export const NOT_AVAILABLE = 'Inpatient care is not switched on yet.'

/** ADT-1's seven codes (0173). */
export const WARD_READ = 'ehr.ward.read'
export const ADMISSION_READ = 'ehr.admission.read'
export const BED_ALLOCATE = 'ehr.bed.allocate'
export const WRISTBAND_PRINT = 'ehr.wristband.print'
export const ADMISSION_DECIDE = 'ehr.admission.decide'
export const WARD_MANAGE = 'ehr.ward.manage'
/** Held by no role until the clinical lead and legal sign (Q188 A): the death record stays off on the website too. */
export const DEATH_RECORD_WRITE = 'ehr.death-record.write'
/** The staff list for the ward's team (Identity's facility staff list; admins only). */
export const WORKFORCE_MANAGE = 'workforce.manage'

type Codes = readonly string[]
export const canReadWards = (codes: Codes) => codes.includes(WARD_READ)
export const canReadAdmission = (codes: Codes) => canReadWards(codes) && codes.includes(ADMISSION_READ)
export const canAllocate = (codes: Codes) => canReadWards(codes) && codes.includes(BED_ALLOCATE)
export const canPrintBand = (codes: Codes) => canReadWards(codes) && codes.includes(WRISTBAND_PRINT)
export const canDecide = (codes: Codes) => canReadAdmission(codes) && codes.includes(ADMISSION_DECIDE)
export const canManageWards = (codes: Codes) => codes.includes(WARD_MANAGE)
/** Route 9: ward staff who give beds, or a ward admin. */
export const canSetBedStatus = (codes: Codes) => canAllocate(codes) || canManageWards(codes)

export const WARDS_REFUSED = 'Only nurses, clinicians and doctors of this facility can use the wards.'
export const SETUP_REFUSED = 'Only the facility’s admins can set up wards and beds.'
export const DECIDE_REFUSED = 'Only doctors and clinicians can admit, change or discharge a patient.'
export const ALLOCATE_REFUSED = 'Only nurses, clinicians and doctors can give or change a bed.'
export const CHART_FIRST = 'Open this patient’s record first, then try again.'
/** Q188 A: the death certificate is built but switched off until the clinical lead and legal sign. */
export const DEATH_RECORD_OFF = 'The death certificate is not switched on yet. The outcome and time of death are recorded.'

/** How often a bed board is read again while it is shown (the contract's 60 seconds). */
export const POLL_MS = 60_000

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---- Words ----------------------------------------------------------------------------

export const WARD_TYPE_WORDS: Readonly<Record<WardType, string>> = {
  general: 'General', paediatric: 'Paediatric', maternity: 'Maternity', icu: 'ICU', private: 'Private', other: 'Other',
}
export const TAKES_WORDS: Readonly<Record<WardTakes, string>> = {
  any: 'Men and women', male: 'Men only', female: 'Women only',
}
export const BED_STATUS_WORDS: Readonly<Record<BedStatus, string>> = {
  available: 'Available', occupied: 'Occupied', cleaning: 'Cleaning', maintenance: 'Under maintenance',
}
export const BED_STATUS_TONES: Readonly<Record<BedStatus, EhrBadgeTone>> = {
  available: 'positive', occupied: 'brand', cleaning: 'caution', maintenance: 'neutral',
}
export const STATUS_WORDS: Readonly<Record<AdmissionStatus, string>> = {
  requested: 'Waiting for a bed', admitted: 'Admitted', discharge_ready: 'Discharge ready', discharged: 'Discharged',
  cancelled: 'Request cancelled',
}
export const STATUS_TONES: Readonly<Record<AdmissionStatus, EhrBadgeTone>> = {
  requested: 'caution', admitted: 'brand', discharge_ready: 'positive', discharged: 'neutral', cancelled: 'neutral',
}
export const SOURCE_WORDS: Readonly<Record<AdmissionSource, string>> = {
  ed: 'From the emergency board', consultation: 'From a visit', waiting_list: 'From the waiting list', direct: 'Direct admission',
}
export const OUTCOME_WORDS: Readonly<Record<DischargeOutcome, string>> = {
  routine: 'Routine discharge', dama: 'Discharged against medical advice', referred_out: 'Referred to another facility',
  absconded: 'Left without notice (absconded)', died: 'Died',
}
export const OUTCOME_HINTS: Readonly<Record<DischargeOutcome, string>> = {
  routine: 'Prepare the discharge first. The summary is signed and the patient sees it in their records.',
  dama: 'The patient chose to leave. Write the summary of the stay so far.',
  referred_out: 'Prepare the discharge first, and name the facility the patient goes to.',
  absconded: 'The patient left without telling the ward. A summary is optional.',
  died: 'Enter the time of death. A summary is optional. Nothing is sent to anyone.',
}
export const CONDITION_WORDS: Readonly<Record<DischargeCondition, string>> = {
  improved: 'Improved', unchanged: 'Unchanged', worse: 'Worse', not_applicable: 'Not applicable',
}
export const REPRINT_WORDS: Readonly<Record<ReprintReason, string>> = {
  lost: 'The band was lost', damaged: 'The band is damaged', details_changed: 'The details changed', moved_ward: 'The patient moved ward',
}
export const MOVEMENT_WORDS: Readonly<Record<MovementKind, string>> = {
  requested: 'Admission requested', admitted: 'Admitted to a bed', transferred: 'Moved bed', prepared: 'Discharge prepared',
  discharged: 'Discharged', cancelled: 'Request cancelled', details_changed: 'Details changed', wristband_printed: 'Wristband printed',
}

const has = <T extends string>(words: Readonly<Record<T, string>>, value: string | null | undefined): value is T =>
  typeof value === 'string' && Object.hasOwn(words, value)

export const wardTypeText = (value: string | null | undefined) => has(WARD_TYPE_WORDS, value) ? WARD_TYPE_WORDS[value] : 'Other'
export const takesText = (value: string | null | undefined) => has(TAKES_WORDS, value) ? TAKES_WORDS[value] : TAKES_WORDS.any
export const bedStatusText = (value: string | null | undefined) => has(BED_STATUS_WORDS, value) ? BED_STATUS_WORDS[value] : 'Not known'
export const statusText = (value: string | null | undefined) => has(STATUS_WORDS, value) ? STATUS_WORDS[value] : 'Not known'
export const outcomeText = (value: string | null | undefined) => has(OUTCOME_WORDS, value) ? OUTCOME_WORDS[value] : 'Outcome not known'
export const sourceText = (value: string | null | undefined) => has(SOURCE_WORDS, value) ? SOURCE_WORDS[value] : ''

/** One movement in plain words: a discharge by its outcome alone ("Died", never "Discharged: died"); a reprint says why. */
export function movementText(movement: Pick<AdmissionMovement, 'kind' | 'outcome' | 'printNumber' | 'reprintReason'>): string {
  const base = has(MOVEMENT_WORDS, movement.kind) ? MOVEMENT_WORDS[movement.kind] : 'Changed'
  if (movement.kind === 'discharged' && has(OUTCOME_WORDS, movement.outcome)) return OUTCOME_WORDS[movement.outcome]
  if (movement.kind === 'wristband_printed' && movement.printNumber && movement.printNumber > 1) {
    const why = movement.reprintReason && has(REPRINT_WORDS, movement.reprintReason) ? `: ${REPRINT_WORDS[movement.reprintReason].toLowerCase()}` : ''
    return `Wristband printed again (print ${movement.printNumber})${why}`
  }
  return base
}

/** What the page says once a discharge is saved: one plain sentence per outcome. */
export function dischargedText(name: string, outcome: DischargeOutcome, referredTo?: string | null): string {
  const facility = referredTo?.trim()
  const said: Readonly<Record<DischargeOutcome, string>> = {
    routine: `${name} is discharged.`,
    dama: `${name} left against medical advice. The discharge is recorded.`,
    referred_out: `${name} is discharged to ${facility || 'another facility'}.`,
    absconded: `${name} is recorded as having left without notice.`,
    died: `${name}’s death is recorded.`,
  }
  return said[outcome] ?? `${name} is discharged.`
}

// ---- Who the card is for (Q190 A) ------------------------------------------------------------

/**
 * The patient's name as the card may show it: the full name where the member can read the chart now (or "Unknown patient
 * U-0007" for an unknown record), otherwise the initials only (names on ward lists stay hidden until the DPO's switch).
 */
export function cardName(card: Pick<AdmissionCard, 'fullName' | 'nameHidden' | 'initials' | 'unknownLabel'>): string {
  if (!card.nameHidden && card.fullName) return card.fullName
  if (card.unknownLabel) return card.unknownLabel
  return card.initials?.trim() || 'Patient'
}

export function sexText(sex: string | null | undefined): string {
  if (!sex) return ''
  const word = sex.replaceAll('_', ' ').toLowerCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "54 years", "About 30 years" for an estimate; '' when not known. */
export function ageText(card: Pick<AdmissionCard, 'ageYears' | 'ageEstimated'>): string {
  if (card.ageYears === null || card.ageYears === undefined) return ''
  const years = `${card.ageYears} ${card.ageYears === 1 ? 'year' : 'years'}`
  return card.ageEstimated ? `About ${years}` : years
}

export function ninText(status: string | null | undefined): string {
  if (status === 'verified') return 'NIN Verified'
  if (status === 'not_verified') return 'NIN Not Verified'
  return ''
}

/** "Day 3" for the days since admission (the day of admission is day 1). */
export function daysText(days: number | null | undefined): string {
  if (days === null || days === undefined || days < 0) return ''
  return `Day ${days + 1}`
}

// ---- Time (Lagos, whatever the device's zone) -------------------------------------------------

export const lagosDateTime = (value: string | null | undefined) => formatDateTime(value, 'Not recorded')
export const lagosTime = (value: string | null | undefined) => formatTime(value, '')
export const dayText = (value: string | null | undefined) => formatDate(value, '')

/** West Africa Time is UTC+1 with no daylight saving. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000

/** A datetime-local value ("2026-12-03T14:05") read as Lagos time, as a UTC instant ("2026-12-03T13:05:00.000Z"). */
export function lagosInputToUtc(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const ms = Date.UTC(year, month - 1, day, hour, minute) - LAGOS_OFFSET_MS
  const check = new Date(ms + LAGOS_OFFSET_MS)
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null
  return new Date(ms).toISOString()
}

/** A moment as a datetime-local value in Lagos ("2026-12-03T14:05"), for a field's default and its limit. */
export function utcToLagosInput(value: string | number | Date = Date.now()): string {
  const clock = lagosClock(value)
  if (!clock) return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${clock.year}-${two(clock.month)}-${two(clock.day)}T${two(clock.hour)}:${two(clock.minute)}`
}

/** The census can show today or a Lagos day up to 90 days back. */
export function censusRange(now: number = Date.now()): { readonly min: string; readonly max: string } {
  return { min: lagosDay(now - 90 * 86_400_000), max: lagosDay(now) }
}

// ---- Checks before sending --------------------------------------------------------------------

// Control characters, which the server refuses in names and one-line text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const CONTROL_BUT_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export function lengthProblem(value: string, min: number, max: number, what: string, lines = false): string {
  const trimmed = value.trim()
  if (trimmed.length < min) return min <= 1 ? `Enter ${what}.` : `Enter ${what} of at least ${min} characters.`
  if (trimmed.length > max) return `Keep ${what} to ${max} characters.`
  if ((lines ? CONTROL_BUT_LINES : CONTROL).test(trimmed)) return 'Use letters, numbers and punctuation only.'
  return ''
}

export const SIGN_WORD = 'SIGN'

// ---- Refusals ----------------------------------------------------------------------------------

/** Not served here: an ehr-api before 0170 (a 404 that is not one of ADT-1's own), or INPATIENT_ENABLED off (503). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'INPATIENT_NOT_AVAILABLE') return true
  return caught.status === 404 && !['ADMISSION_NOT_FOUND', 'WARD_NOT_FOUND', 'BED_NOT_FOUND'].includes(caught.code)
}

/** ADT-1's refusals, in the contract's own plain words (never "permission"). */
export const INPATIENT_REFUSALS: Readonly<Record<string, string>> = {
  INPATIENT_NOT_AVAILABLE: NOT_AVAILABLE,
  INPATIENT_NOT_ALLOWED: WARDS_REFUSED,
  WARD_SETUP_NOT_ALLOWED: SETUP_REFUSED,
  ADMISSION_DECIDE_NOT_ALLOWED: DECIDE_REFUSED,
  BED_ALLOCATE_NOT_ALLOWED: ALLOCATE_REFUSED,
  ADMISSION_CHART_ACCESS_REQUIRED: CHART_FIRST,
  ADMISSION_SOURCE_INVALID: 'Choose where this admission comes from: a visit, the emergency board, the waiting list, or direct.',
  RESPONSIBLE_DOCTOR_INVALID: 'Choose a doctor or clinician who works at this facility.',
  WARD_STAFF_INVALID: 'Choose nurses, clinicians and doctors who work at this facility.',
  MOTHER_ADMISSION_INVALID: 'Choose the mother’s current admission at this facility.',
  DISCHARGE_SUMMARY_REQUIRED: 'Write the discharge summary before discharging the patient.',
  DIED_AT_REQUIRED: 'Enter the time of death.',
  DISCHARGE_TIME_INVALID: 'The discharge time must be after admission, and not in the future.',
  SIGNATURE_REQUIRED: 'Type SIGN to sign.',
  REPRINT_REASON_REQUIRED: 'Say why the band is being printed again.',
  ADMISSION_NOT_FOUND: 'This ward, bed or admission is not at this facility.',
  WARD_NOT_FOUND: 'This ward, bed or admission is not at this facility.',
  BED_NOT_FOUND: 'This ward, bed or admission is not at this facility.',
  WARD_NAME_TAKEN: 'This name is already used. Choose another.',
  BED_NAME_TAKEN: 'This name is already used. Choose another.',
  WARD_NOT_EMPTY: 'Move every patient out of this ward first.',
  BED_OCCUPIED: 'A patient is in this bed. Move or discharge them first.',
  BED_NOT_AVAILABLE: 'This bed is not free. Choose another bed or overflow space.',
  BED_LIMIT_REACHED: 'This ward has as many beds (200) or overflow spaces (50) as it can have.',
  WARD_SEX_MISMATCH: 'This ward takes only men (or only women). Confirm to admit this patient here.',
  ADMISSION_ALREADY_OPEN: 'This patient is already admitted or waiting for a bed here.',
  ADMISSION_STATE_INVALID: 'This admission has moved on. Reload it to see where it is now.',
  DISCHARGE_NOT_PREPARED: 'Prepare the discharge first.',
  WARD_VERSION_CONFLICT: 'Someone else changed this. Reload it and try again.',
  ADMISSION_VERSION_CONFLICT: 'Someone else changed this. Reload it and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Reload the page and try again.',
  DEATH_RECORD_NOT_AVAILABLE: DEATH_RECORD_OFF,
}

/** Refusals after which what the page shows is out of date: it is read again. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set([
  'WARD_VERSION_CONFLICT', 'ADMISSION_VERSION_CONFLICT', 'ADMISSION_STATE_INVALID', 'BED_NOT_AVAILABLE', 'BED_OCCUPIED',
  'WARD_NOT_EMPTY', 'DISCHARGE_NOT_PREPARED',
])

const OFFLINE = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT'])

/** A refusal in plain words: the contract's sentence, "not switched on yet", or `fallback`. */
export function refusalWords(caught: unknown, fallback: string, invalid?: string): string {
  if (!isHidApiError(caught)) return fallback
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(INPATIENT_REFUSALS, caught.code)) return INPATIENT_REFUSALS[caught.code]!
  if (caught.code === 'VALIDATION_FAILED') return invalid ?? 'Check the highlighted fields.'
  if (caught.status === 403) return WARDS_REFUSED
  if (caught.status === 0 || OFFLINE.has(caught.code)) return 'No connection. Check your internet and try again.'
  return fallback
}

export const isCancelled = (caught: unknown) => isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED'

// ---- Served --------------------------------------------------------------------------------------
// Learned from the backend's own answers, in memory for the page's life: a read answering 404 (an ehr-api before 0170)
// or 503 INPATIENT_NOT_AVAILABLE (the flag is off) says not served, only while nothing has said otherwise; any other
// answer says served, once and for all. Until then null, and the pages are listed.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnInpatientServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function inpatientServed(): Served { return served }
export function subscribeInpatientServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useInpatientServed(): Served {
  return useSyncExternalStore(subscribeInpatientServed, inpatientServed, inpatientServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetInpatientServed(): void {
  served = null
  changed()
}

/** Records what an answer (no argument) or a refusal says about whether the inpatient routes are served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnInpatientServed(true); return }
  if (notServed(caught)) learnInpatientServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !OFFLINE.has(caught.code) && caught.code !== 'REQUEST_CANCELLED') {
    learnInpatientServed(true)
  }
}

/** A fresh Idempotency-Key: 16-128 URL-safe characters (a UUID). */
export function newKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 40)
}

/** The bed's place, as a card says it: "Female Medical Ward, Bed 4". */
export function placeText(card: Pick<AdmissionCard, 'wardName' | 'bedName'>): string {
  return [card.wardName, card.bedName].filter(Boolean).join(', ')
}

/** Whose membership: "You", the name SX-9 gives, or `unnamed`. Never an id. */
export function memberText(id: string | null | undefined, me: string | undefined, names: ReadonlyMap<string, string | null>,
  unnamed = 'A staff member here'): string {
  if (!id) return ''
  if (me && id.toLowerCase() === me.toLowerCase()) return 'You'
  return names.get(id.toLowerCase()) ?? unnamed
}
