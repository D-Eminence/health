import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  DentalAnaesthetic, DentalArch, DentalCategory, DentalDentition, DentalFinding, DentalProcedure, DentalProcedureStatus,
  DentalSite, DentalStage,
} from '../../../staff/api'

/*
 * The dental clinic (hid-system DEN-1, migrations 0194-0196; INTERFACE_CONTRACT.md "DEN-1") in plain words: who may
 * use it, the FDI tooth chart (ISO 3950) and its surfaces, what each stage, site and status is called, and what each
 * refusal says. The backend decides every request; these only choose what the page offers. Built at the recommended
 * option of each open owner question (Q-DEN-1 to Q-DEN-6, not yet answered by the owner). Every list a dentist chooses
 * from (conditions, procedures, anaesthetics) is the backend's, and ships as a draft until the clinical lead signs it
 * (Q124 A): the page says so while it is.
 */

export const TITLE = 'Dental'
export const BASE_SEGMENT = 'dental'

/** DEN-1's two codes (0194): dentists only (Q-DEN-1 A). */
export const DENTAL_READ = 'ehr.dental.read'
export const DENTAL_WRITE = 'ehr.dental.write'

export const canReadDental = (permissions: readonly string[]) => permissions.includes(DENTAL_READ)
export const canWriteDental = (permissions: readonly string[]) => canReadDental(permissions) && permissions.includes(DENTAL_WRITE)

export const DENTISTS_ONLY = 'Only dentists of this facility can open or record the dental chart.'
export const NOT_AVAILABLE = 'The dental clinic is not switched on yet.'
export const NOT_AVAILABLE_DETAIL = 'Dental records can be kept here once Health ID switches the dental clinic on for this facility. '
  + 'Until then, record the visit in Consultation and keep the paper dental chart.'
export const DRAFT_LIST = 'Draft list: not yet signed by the clinical lead'
export const NOT_ON_LIST = 'Not on the list'
export const OPEN_PATIENT_FIRST = 'Open the patient first: find them on Patients and open their record with their Access PIN or an approved request.'

// ---- The FDI tooth chart -----------------------------------------------------------------

/**
 * The teeth of each quadrant in chart order, as a dentist reads the chart facing the patient: the patient's right on the
 * left of the screen. Upper right (1, primary 5) then upper left (2, 6) on top; lower right (4, 8) then lower left (3,
 * 7) below.
 */
const run = (quadrant: number, count: number, fromMiddle: boolean) => {
  const teeth = Array.from({ length: count }, (_, index) => quadrant * 10 + index + 1)
  return fromMiddle ? teeth : teeth.reverse()
}
export const PERMANENT_UPPER: readonly number[] = [...run(1, 8, false), ...run(2, 8, true)]
export const PERMANENT_LOWER: readonly number[] = [...run(4, 8, false), ...run(3, 8, true)]
export const PRIMARY_UPPER: readonly number[] = [...run(5, 5, false), ...run(6, 5, true)]
export const PRIMARY_LOWER: readonly number[] = [...run(8, 5, false), ...run(7, 5, true)]

/** The rows of the chart for a dentition, top to bottom. */
export function chartRows(dentition: DentalDentition): ReadonlyArray<{ readonly key: string; readonly label: string; readonly teeth: readonly number[] }> {
  const permanentUpper = { key: 'permanent-upper', label: 'Upper teeth', teeth: PERMANENT_UPPER }
  const permanentLower = { key: 'permanent-lower', label: 'Lower teeth', teeth: PERMANENT_LOWER }
  const primaryUpper = { key: 'primary-upper', label: 'Upper baby teeth', teeth: PRIMARY_UPPER }
  const primaryLower = { key: 'primary-lower', label: 'Lower baby teeth', teeth: PRIMARY_LOWER }
  if (dentition === 'permanent') return [permanentUpper, permanentLower]
  if (dentition === 'primary') return [{ ...primaryUpper, label: 'Upper teeth' }, { ...primaryLower, label: 'Lower teeth' }]
  return [permanentUpper, primaryUpper, primaryLower, permanentLower]
}

export const isPermanentTooth = (tooth: number) => Number.isInteger(tooth) && tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8
export const isPrimaryTooth = (tooth: number) => Number.isInteger(tooth) && tooth >= 51 && tooth <= 85 && tooth % 10 >= 1 && tooth % 10 <= 5

/** Whether a two-digit FDI tooth belongs to the dentition (the server's DENTAL_TOOTH_INVALID rule). */
export function toothInDentition(tooth: number, dentition: DentalDentition): boolean {
  if (dentition === 'permanent') return isPermanentTooth(tooth)
  if (dentition === 'primary') return isPrimaryTooth(tooth)
  return isPermanentTooth(tooth) || isPrimaryTooth(tooth)
}

/** Every tooth of the dentition, in chart order: the choices of a procedure's tooth. */
export function teethOf(dentition: DentalDentition): readonly number[] {
  return chartRows(dentition).flatMap(row => row.teeth)
}

const QUADRANT_OF_TOOTH: Readonly<Record<number, string>> = {
  1: 'upper right', 2: 'upper left', 3: 'lower left', 4: 'lower right', 5: 'upper right', 6: 'upper left', 7: 'lower left', 8: 'lower right',
}
const PERMANENT_NAMES = ['central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar',
  'second molar', 'third molar']
const PRIMARY_NAMES = ['central incisor', 'lateral incisor', 'canine', 'first molar', 'second molar']

/** "lower left first molar", "upper right baby canine": where the tooth is, by its FDI number. */
export function toothPlace(tooth: number): string {
  const quadrant = QUADRANT_OF_TOOTH[Math.floor(tooth / 10)]
  if (!quadrant) return ''
  const primary = isPrimaryTooth(tooth)
  const name = (primary ? PRIMARY_NAMES : PERMANENT_NAMES)[(tooth % 10) - 1]
  return name ? `${quadrant} ${primary ? 'baby ' : ''}${name}` : ''
}

/** "Tooth 36 (lower left first molar)". */
export function toothText(tooth: number | null | undefined): string {
  if (tooth === null || tooth === undefined) return ''
  const place = toothPlace(tooth)
  return place ? `Tooth ${tooth} (${place})` : `Tooth ${tooth}`
}

/** Front teeth (incisors and canines) have an incisal edge and a labial face. */
const isFrontTooth = (tooth: number) => tooth % 10 >= 1 && tooth % 10 <= 3
const isUpperTooth = (tooth: number) => [1, 2, 5, 6].includes(Math.floor(tooth / 10))

export const SURFACES = ['M', 'O', 'D', 'B', 'L'] as const
export type Surface = (typeof SURFACES)[number]

/** A surface as it reads on this tooth: occlusal is incisal on front teeth, buccal labial, and lingual palatal on upper teeth. */
export function surfaceWord(surface: string, tooth: number | null = null): string {
  switch (surface) {
    case 'M': return 'Mesial'
    case 'O': return tooth !== null && isFrontTooth(tooth) ? 'Incisal' : 'Occlusal'
    case 'D': return 'Distal'
    case 'B': return tooth !== null && isFrontTooth(tooth) ? 'Labial' : 'Buccal'
    case 'L': return tooth !== null && isUpperTooth(tooth) ? 'Palatal' : 'Lingual'
    default: return surface
  }
}

/** The surfaces chosen, each once, in M, O, D, B, L order, as the server stores them; '' for none. */
export function orderedSurfaces(chosen: Iterable<string>): string {
  const set = new Set(chosen)
  return SURFACES.filter(surface => set.has(surface)).join('')
}

/** "MO (mesial, occlusal)". */
export function surfacesText(surfaces: string | null | undefined, tooth: number | null = null): string {
  if (!surfaces) return ''
  const words = [...surfaces].map(surface => surfaceWord(surface, tooth).toLowerCase()).join(', ')
  return `${surfaces} (${words})`
}

export const DENTITIONS: readonly DentalDentition[] = ['permanent', 'mixed', 'primary']
export const DENTITION_WORDS: Readonly<Record<DentalDentition, string>> = {
  permanent: 'Adult teeth',
  primary: 'Child (baby) teeth',
  mixed: 'Mixed: adult and baby teeth',
}

/** The findings that do not belong to a dentition (a change of chart would drop them). */
export function findingsOutside(findings: readonly DentalFinding[], dentition: DentalDentition): DentalFinding[] {
  return findings.filter(finding => !toothInDentition(finding.tooth, dentition))
}

/** Findings sorted as the server answers them: by tooth, then condition code. */
export function sortedFindings(findings: readonly DentalFinding[]): DentalFinding[] {
  return [...findings].sort((a, b) => a.tooth - b.tooth || a.condition.localeCompare(b.condition))
}

export const FINDINGS_MAX = 200
export const FINDING_NOTE_MAX = 200
export const CHART_NOTE_MAX = 1000

// ---- The visit --------------------------------------------------------------------------

export const STAGE_WORDS: Readonly<Record<DentalStage, string>> = {
  started: 'Started',
  assessed: 'Assessed',
  treated: 'Treated',
  completed: 'Completed',
}
export const STAGE_HINTS: Readonly<Record<DentalStage, string>> = {
  started: 'Nothing recorded yet.',
  assessed: 'A chart was saved or a procedure planned at this visit.',
  treated: 'A procedure was done at this visit.',
  completed: 'The visit is finished.',
}
export function stageText(stage: string | null | undefined): string {
  return stage && Object.hasOwn(STAGE_WORDS, stage) ? STAGE_WORDS[stage as DentalStage] : 'Started'
}
export function stageTone(stage: string | null | undefined): EhrBadgeTone {
  return stage === 'treated' ? 'positive' : stage === 'completed' ? 'neutral' : stage === 'assessed' ? 'caution' : 'brand'
}

/** The visit is open for writes (routes 2, 7, 9 and 10): planned, in progress or on hold. */
export const OPEN_ENCOUNTER_STATUSES: ReadonlySet<string> = new Set(['planned', 'in_progress', 'on_hold'])
export const visitOpen = (encounterStatus: string | null | undefined) => OPEN_ENCOUNTER_STATUSES.has(encounterStatus ?? '')
export const VISIT_CLOSED = 'This visit is finished. Open a new visit to record more.'

export const DAYS_CHOICES: ReadonlyArray<readonly [number, string]> = [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']]

/** The visit's complaint (EHR-C1's chiefComplaint), 1 to 500 characters; this page's default when none is typed. */
export const DEFAULT_COMPLAINT = 'Dental visit'
export const COMPLAINT_MAX = 500

// ---- Procedures --------------------------------------------------------------------------

export const PROCEDURE_STATUS_WORDS: Readonly<Record<DentalProcedureStatus, string>> = {
  planned: 'Planned',
  done: 'Done',
  cancelled: 'Cancelled',
  entered_in_error: 'Entered in error',
}
export function procedureStatusText(status: string): string {
  return Object.hasOwn(PROCEDURE_STATUS_WORDS, status) ? PROCEDURE_STATUS_WORDS[status as DentalProcedureStatus] : 'Recorded'
}
export function procedureStatusTone(status: string): EhrBadgeTone {
  return status === 'done' ? 'positive' : status === 'planned' ? 'brand' : status === 'entered_in_error' ? 'critical' : 'neutral'
}

export const SITES: readonly DentalSite[] = ['tooth', 'tooth_surfaces', 'quadrant', 'arch', 'whole_mouth']
export const SITE_WORDS: Readonly<Record<DentalSite, string>> = {
  tooth: 'A tooth',
  tooth_surfaces: 'Surfaces of a tooth',
  quadrant: 'A quadrant',
  arch: 'An arch (upper or lower)',
  whole_mouth: 'The whole mouth',
}
export const QUADRANT_WORDS: Readonly<Record<number, string>> = { 1: 'Upper right', 2: 'Upper left', 3: 'Lower left', 4: 'Lower right' }
export const ARCH_WORDS: Readonly<Record<DentalArch, string>> = { upper: 'Upper arch', lower: 'Lower arch' }

export const CATEGORY_WORDS: Readonly<Record<DentalCategory, string>> = {
  diagnostic: 'Examination and X-rays',
  preventive: 'Prevention',
  restorative: 'Fillings',
  endodontic: 'Root canal and pulp',
  periodontal: 'Gums',
  surgical: 'Extractions and surgery',
  prosthetic: 'Crowns and dentures',
  other: 'Other',
}
export const CATEGORY_ORDER: readonly DentalCategory[] = ['diagnostic', 'preventive', 'restorative', 'endodontic', 'periodontal',
  'surgical', 'prosthetic', 'other']
export function categoryText(category: string): string {
  return Object.hasOwn(CATEGORY_WORDS, category) ? CATEGORY_WORDS[category as DentalCategory] : 'Other'
}

/** Where a procedure was done, in words: "Tooth 36 (lower left first molar), surfaces MO (mesial, occlusal)". */
export function siteText(procedure: Pick<DentalProcedure, 'site' | 'tooth' | 'surfaces' | 'quadrant' | 'arch'>): string {
  switch (procedure.site) {
    case 'tooth': return toothText(procedure.tooth)
    case 'tooth_surfaces': return [toothText(procedure.tooth), procedure.surfaces ? `surfaces ${surfacesText(procedure.surfaces, procedure.tooth)}` : '']
      .filter(Boolean).join(', ')
    case 'quadrant': return procedure.quadrant ? `${QUADRANT_WORDS[procedure.quadrant] ?? 'A'} quadrant` : 'A quadrant'
    case 'arch': return procedure.arch ? ARCH_WORDS[procedure.arch] : 'An arch'
    case 'whole_mouth': return 'Whole mouth'
    default: return ''
  }
}

export const NO_ANAESTHETIC = 'none'
export const OTHER_ANAESTHETIC = 'other'
/** The amount of local anaesthetic, in cartridges: 0.5 to 10 in steps of 0.5. */
export const CARTRIDGES: readonly number[] = Array.from({ length: 20 }, (_, index) => (index + 1) / 2)
export function cartridgesText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return `${value} ${value === 1 ? 'cartridge' : 'cartridges'}`
}

/** "Lidocaine 2% with adrenaline 1:80,000 · Inferior alveolar nerve block · 1.5 cartridges", or "No local anaesthetic". */
export function anaestheticText(anaesthetic: DentalAnaesthetic | null | undefined): string {
  if (!anaesthetic) return ''
  if (anaesthetic.agentCode === NO_ANAESTHETIC) return anaesthetic.agentName || 'No local anaesthetic'
  const agent = anaesthetic.agentCode === OTHER_ANAESTHETIC && anaesthetic.agentOther ? anaesthetic.agentOther : anaesthetic.agentName
  return [agent, anaesthetic.techniqueName, cartridgesText(anaesthetic.cartridges)].filter(Boolean).join(' · ')
}

export const PROCEDURE_NAME_MIN = 2
export const PROCEDURE_NAME_MAX = 120
export const NOTES_MAX = 1000
export const REASON_MIN = 8
export const REASON_MAX = 500
export const FOLLOW_UP_NOTE_MAX = 500

// Control characters, which the server refuses in every free text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const CONTROL_ONE_LINE = /[\u0000-\u001f\u007f]/

/** A free text's problem, or '' when it is fine: at most `max` characters after trimming, no control characters. */
export function textProblem(value: string, max: number, oneLine = false): string {
  const trimmed = value.trim()
  if (trimmed.length > max) return `Keep it to ${max} characters.`
  if ((oneLine ? CONTROL_ONE_LINE : CONTROL).test(trimmed)) return 'Use letters, numbers and punctuation only.'
  return ''
}

export function reasonProblem(value: string): string {
  const length = value.trim().length
  if (length < REASON_MIN) return 'Say why in at least 8 characters.'
  if (length > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters.`
  return textProblem(value, REASON_MAX)
}

export function procedureNameProblem(value: string): string {
  const length = value.trim().length
  if (length < PROCEDURE_NAME_MIN) return 'Type the procedure’s name.'
  return textProblem(value, PROCEDURE_NAME_MAX, true)
}

/** A trimmed text, or null for an empty one (the server takes null for "none"). */
export function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

// ---- Dates and times (Lagos, @hid/ui/display) ---------------------------------------------

/** "3 Dec 2026, 09:05". */
export const lagosDateTime = (value: string | null | undefined) => formatDateTime(value)
/** "3 Jun 2027" for a Lagos calendar day. */
export const dayText = (value: string | null | undefined) => formatDate(value)

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, date! + days)).toISOString().slice(0, 10)
}

/** The follow-up window (route 4): tomorrow to two years ahead, as Lagos calendar days ("2026-12-04"). */
export function followUpWindow(now: Date = new Date()): { readonly min: string; readonly max: string } {
  const today = lagosDay(now)
  const [year, month, date] = today.split('-').map(Number)
  // 29 Feb two years on is 28 Feb: the same day, or the last day of the same month.
  const later = new Date(Date.UTC(year! + 2, month! - 1, date!))
  const max = (later.getUTCMonth() === month! - 1 ? later : new Date(Date.UTC(year! + 2, month!, 0))).toISOString().slice(0, 10)
  return { min: addDays(today, 1), max }
}

export function followUpProblem(day: string, now: Date = new Date()): string {
  if (!day) return ''
  const { min, max } = followUpWindow(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < min || day > max) return 'Choose a follow-up date from tomorrow to two years ahead.'
  return ''
}

/**
 * The ISO moment for a HH:MM typed today in Lagos (UTC+1, no summer time), or null when it is not a time. The server
 * takes a time from the visit's start to now; a time later than now is refused here first.
 */
export function doneMoment(time: string, now: Date = new Date()): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return new Date(`${lagosDay(now)}T${match[1]}:${match[2]}:00.000+01:00`).toISOString()
}

export function doneTimeProblem(time: string, visitStartedAt: string | null | undefined, now: Date = new Date()): string {
  if (!time) return ''
  const moment = doneMoment(time, now)
  if (!moment) return 'Type the time as HH:MM, for example 09:30.'
  const at = Date.parse(moment)
  const started = Date.parse(visitStartedAt ?? '')
  if (at - now.getTime() > 2 * 60_000 || (Number.isFinite(started) && at < started - 60_000)) {
    return 'The time it was done can be from the start of this visit to now.'
  }
  return ''
}

// ---- Who -----------------------------------------------------------------------------------

/** "You" for the session's own membership; another member's name from SX-9, never their id. */
export function memberText(membershipId: string | null | undefined, own: string | undefined, names: ReadonlyMap<string, string | null>,
  none = 'Not recorded'): string {
  if (!membershipId) return none
  if (own && membershipId.toLowerCase() === own.toLowerCase()) return 'You'
  return names.get(membershipId.toLowerCase()) ?? 'A staff member here'
}

export const SEX_WORDS: Readonly<Record<string, string>> = { female: 'Female', male: 'Male', intersex: 'Intersex', other: 'Other', unknown: 'Not known' }
export function sexText(sex: string | null | undefined): string {
  const key = (sex ?? '').trim().toLowerCase()
  return Object.hasOwn(SEX_WORDS, key) ? SEX_WORDS[key]! : ''
}

// ---- Refusals -------------------------------------------------------------------------------

/** Whether a refusal says the dental routes are not served here (an ehr-api before DEN-1, or DENTAL_ENABLED off). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'DENTAL_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('DENTAL_') && caught.code !== 'ENCOUNTER_NOT_FOUND'
}

export const DENTAL_REFUSALS: Readonly<Record<string, string>> = {
  DENTAL_NOT_AVAILABLE: NOT_AVAILABLE,
  DENTAL_NOT_ALLOWED: DENTISTS_ONLY,
  DENTAL_NOT_SIGNER: 'Only the dentist who signed this procedure can mark it entered in error.',
  DENTAL_TOOTH_INVALID: 'Choose a tooth by its two-digit FDI number, for example 36.',
  DENTAL_SURFACES_INVALID: 'Choose surfaces from M, O, D, B and L, each once, only for a condition or procedure that takes surfaces.',
  DENTAL_CONDITION_INVALID: 'Choose a condition from the dental list.',
  DENTAL_PROCEDURE_INVALID: 'Choose a procedure from the dental list, or type its name.',
  DENTAL_SITE_INVALID: 'Say where this procedure was done: the tooth, the quadrant, the arch or the whole mouth, as the procedure needs.',
  DENTAL_ANAESTHETIC_INVALID: 'Choose the local anaesthetic used, or No local anaesthetic.',
  DENTAL_DONE_TIME_INVALID: 'The time it was done can be from the start of this visit to now.',
  DENTAL_FOLLOW_UP_INVALID: 'Choose a follow-up date from tomorrow to two years ahead.',
  DENTAL_REASON_REQUIRED: 'Say why in at least 8 characters.',
  DENTAL_VISIT_ENCOUNTER_INVALID: 'Dental records go on an outpatient visit of this patient at this facility.',
  DENTAL_VISIT_NOT_FOUND: 'No dental record was started on this visit.',
  DENTAL_CHART_NOT_FOUND: 'This chart version was not found.',
  DENTAL_PROCEDURE_NOT_FOUND: 'This procedure was not found.',
  DENTAL_VISIT_NOT_STARTED: 'Start the dental record on this visit first.',
  DENTAL_VISIT_CLOSED: VISIT_CLOSED,
  DENTAL_CHART_CHANGED: 'Someone saved this chart after you opened it. Reload it to start from the newest chart.',
  DENTAL_CHART_NOT_LATEST: 'Only the newest chart can be marked entered in error.',
  DENTAL_PROCEDURE_NOT_PLANNED: 'Only a planned procedure can be recorded as done or cancelled.',
  DENTAL_PROCEDURE_NOT_DONE: 'Only a done procedure can be marked entered in error.',
  DENTAL_VERSION_CONFLICT: 'Someone else changed this record. Reload it and try again.',
  CONSENT_REQUIRED: 'You need the patient’s agreement to see or record their dental chart. Open the patient again with their Access PIN or an approved request.',
  ENCOUNTER_NOT_FOUND: 'This visit was not found for the open patient at this facility.',
  REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY: 'The visit was not started. The date or time on this device looks wrong. Check it, then try again.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong. Reload the page and try again.',
  PURPOSE_OF_USE_REQUIRED: 'The dental chart is for patient care only. Reload the page and try again.',
}

/** Refusals after which the record is read again at once: what is on screen is out of date. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['DENTAL_CHART_CHANGED', 'DENTAL_VERSION_CONFLICT', 'DENTAL_CHART_NOT_LATEST',
  'DENTAL_PROCEDURE_NOT_PLANNED', 'DENTAL_PROCEDURE_NOT_DONE', 'DENTAL_VISIT_CLOSED'])

export function reloadsAfter(caught: unknown): boolean {
  return isHidApiError(caught) && RELOAD_AFTER.has(caught.code)
}

/**
 * A refusal in plain words: the dental clinic's own, "not switched on yet" for an ehr-api without it, the request's own
 * meaning for a 400 VALIDATION_FAILED (never the fields it names), and any other 403 as the dentists-only words. Never the
 * word the backend's guard uses.
 */
export function refusalWords(caught: unknown, fallback: string, invalid?: string): string {
  if (!isHidApiError(caught)) return fallback
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(DENTAL_REFUSALS, caught.code)) return DENTAL_REFUSALS[caught.code]!
  if (caught.code === 'VALIDATION_FAILED') return invalid ?? 'Check the highlighted fields.'
  if (caught.status === 403) return DENTISTS_ONLY
  if (caught.status === 0 || caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT') return 'No connection. Check your internet and try again.'
  return fallback
}

// ---- Served ---------------------------------------------------------------------------------
// Learned from the backend's own answers, in memory for the page's life: a read answering 404 (an ehr-api before DEN-1)
// or 503 DENTAL_NOT_AVAILABLE (the flag is off) says not served, only while nothing has said otherwise; any answer says
// served, once and for all. Until then null, and the page is listed for dentists.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnDentalServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function dentalServed(): Served { return served }
export function subscribeDentalServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useDentalServed(): Served {
  return useSyncExternalStore(subscribeDentalServed, dentalServed, dentalServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetDentalServed(): void {
  served = null
  changed()
}

/** Records what an answer (no argument) or a refusal says about whether the dental routes are served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnDentalServed(true); return }
  if (notServed(caught)) learnDentalServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnDentalServed(true)
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newKey(): string {
  return crypto.randomUUID()
}
