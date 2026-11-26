import { useSyncExternalStore } from 'react'
import { isHidApiError, plainErrorText } from '@hid/http'
import { formatDateTime, formatTime, formatTimeOrDateTime, lagosDay, type Moment } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  EdArrivalMode, EdCard, EdColumn, EdHistoryEvent, EdOutcome, UnknownPatientReason, VisitQueueStage,
} from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'
import { stageText } from '../waiting/waitingRules'

/*
 * The emergency department board (hid-system ED-1, migrations 0168 and 0169; INTERFACE_CONTRACT.md "ED-1") in plain
 * words: who may do what, what each column, arrival mode and outcome is called, the Lagos time of every moment whatever
 * the device's zone, and what each refusal says. The backend decides every request; these only choose what the pages
 * offer. Built at the recommended option of each open owner question (Q-ED-1 to Q-ED-7, not yet answered by the owner).
 */

export const TITLE = 'Emergency department'
export const EYEBROW = 'Care'
export const DESCRIPTION = 'Add patients as they arrive, set their triage level, start care and record where each one goes next.'
export const BASE = '/provider/emergency-department'
export const SCREEN_WARNING = 'Do not show this board on a screen patients or visitors can see.'

/** ED-1's four codes (0169), and 0135's pair every ED route also needs. */
export const ED_READ = 'ehr.ed.read'
export const ED_ARRIVE = 'ehr.ed.arrive'
export const ED_TRIAGE = 'ehr.ed.triage'
export const ED_DISPOSITION = 'ehr.ed.disposition'
export const ENCOUNTER_READ = 'ehr.encounter.read'
export const ENCOUNTER_WRITE = 'ehr.encounter.write'
/** Staff patient search (0132) and an unknown patient's record (ID-7): the front desk, nurses, clinicians and doctors. */
export const PATIENT_SEARCH = 'identity.registration.write'

const encounters = (permissions: readonly string[]) => permissions.includes(ENCOUNTER_READ) && permissions.includes(ENCOUNTER_WRITE)
/**
 * Whether the member is one the board is for (0135's encounter pair: the front desk, nurses, clinicians and doctors)
 * on a backend that has not given them its codes yet (before 0169 no role holds an ED code): told the board is not
 * available yet, never that it is not for them.
 */
export const awaitsBoardCodes = (permissions: readonly string[]) => encounters(permissions) && !permissions.includes(ED_READ)
export const canRead = (permissions: readonly string[]) => permissions.includes(ED_READ) && encounters(permissions)
export const canArrive = (permissions: readonly string[]) => canRead(permissions) && permissions.includes(ED_ARRIVE)
export const canTriage = (permissions: readonly string[]) => canRead(permissions) && permissions.includes(ED_TRIAGE)
export const canDecide = (permissions: readonly string[]) => canRead(permissions) && permissions.includes(ED_DISPOSITION)
export const canSearch = (permissions: readonly string[]) => permissions.includes(PATIENT_SEARCH)

export const BOARD_REFUSED = 'Only the front desk, nurses, clinicians and doctors of this facility can use the emergency board.'
export const TRIAGE_REFUSED = 'Only nurses, clinicians and doctors can triage, record a complaint or move patients on the board.'
export const DISPOSITION_REFUSED = 'Only clinicians and doctors can record where the patient goes next.'
export const NOT_AVAILABLE = 'The emergency board is not available yet.'

/** How often the board is read again while it is shown (the contract's 30 seconds). */
export const POLL_MS = 30_000

// ---- Columns, stages and arrival -------------------------------------------------

export const COLUMNS: readonly Exclude<EdColumn, 'closed'>[] = ['waiting', 'being_seen', 'disposition']
export const COLUMN_WORDS: Readonly<Record<EdColumn, string>> = {
  waiting: 'Waiting',
  being_seen: 'Being seen',
  disposition: 'Disposition',
  // A closed record left the department, or was an arrival cancelled as made in error, or was closed on the waiting
  // list: the card does not say which, so the column says only that it is off the board.
  closed: 'Off the board today',
}
export const COLUMN_EMPTY: Readonly<Record<EdColumn, string>> = {
  waiting: 'No one is waiting.',
  being_seen: 'No one is being seen.',
  disposition: 'No one is waiting to leave.',
  closed: 'No one has left the board today.',
}

export const ARRIVAL_MODES: readonly EdArrivalMode[] = ['walk_in', 'ambulance', 'brought_by_public', 'police', 'referred', 'other']
export const ARRIVAL_MODE_WORDS: Readonly<Record<EdArrivalMode, string>> = {
  walk_in: 'Walked in',
  ambulance: 'Ambulance',
  brought_by_public: 'Brought by a member of the public',
  police: 'Police',
  referred: 'Referred from another facility',
  other: 'Other',
}
export function arrivalModeText(mode: string): string {
  return Object.hasOwn(ARRIVAL_MODE_WORDS, mode) ? ARRIVAL_MODE_WORDS[mode as EdArrivalMode] : 'Other'
}

export const ARRIVAL_BASIS_WORDS: Readonly<Record<EdCard['arrivalBasis'], string>> = {
  search: 'Found by patient search',
  'own-facility': 'This facility’s patient',
  emergency: 'Found by emergency search',
}

/** The open stages a nurse, clinician or doctor can move a patient to on the board. */
export const MOVE_STAGES: readonly Extract<VisitQueueStage, 'waiting' | 'triage' | 'ready' | 'with_clinician'>[] =
  ['waiting', 'triage', 'ready', 'with_clinician']

export { stageText }

// ---- Outcomes ----------------------------------------------------------------------

export const OUTCOMES: readonly EdOutcome[] = ['discharged', 'admit_requested', 'referred_out', 'sent_to_outpatients',
  'left_before_seen', 'left_against_advice', 'died']
export const OUTCOME_WORDS: Readonly<Record<EdOutcome, string>> = {
  discharged: 'Discharged home',
  admit_requested: 'Admission requested',
  referred_out: 'Referred to another facility',
  sent_to_outpatients: 'Sent to outpatients',
  left_before_seen: 'Left before being seen',
  left_against_advice: 'Left against medical advice',
  died: 'Died',
}
/** What each outcome does to the patient's place, said beside the choice before it is saved. */
export const OUTCOME_HINTS: Readonly<Record<EdOutcome, string>> = {
  discharged: 'The patient stays in Disposition until you select Left the department.',
  admit_requested: 'The patient stays in Disposition, waiting for admission, until you select Handed over to the ward.',
  referred_out: 'The patient stays in Disposition until you select Left the department.',
  sent_to_outpatients: 'The patient leaves the board and goes back to the waiting list, with their triage level.',
  left_before_seen: 'The patient leaves the board and the waiting list now.',
  left_against_advice: 'The patient leaves the board and the waiting list now.',
  died: 'The patient leaves the board and the waiting list now. Nothing is sent to anyone.',
}
export function outcomeText(outcome: string | null | undefined): string {
  return outcome && Object.hasOwn(OUTCOME_WORDS, outcome) ? OUTCOME_WORDS[outcome as EdOutcome] : 'Outcome not known'
}
/** The three outcomes that keep the patient in Disposition until they leave (route 8). */
export const KEEPS_ON_BOARD: ReadonlySet<EdOutcome> = new Set(['discharged', 'admit_requested', 'referred_out'])

/** The button that takes a decided patient off the board (route 8). */
export function leaveLabel(card: Pick<EdCard, 'disposition'>): string {
  return card.disposition?.outcome === 'admit_requested' ? 'Handed over to the ward' : 'Left the department'
}

/** A department to admit to: every profile department but emergency (the server checks the facility's own list). */
export const ADMIT_DEPARTMENTS = DEPARTMENTS.filter(([code]) => code !== 'emergency')
export function departmentText(code: string | null | undefined): string {
  if (!code) return ''
  const known = DEPARTMENTS.find(([value]) => value === code)
  if (known) return known[1]
  const words = code.replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

export const REASON_MIN = 8
export const REASON_MAX = 500
export const COMPLAINT_MAX = 120

/**
 * The emergency visit request of one attempt to link today's visit (route 6, after EHR-C1's visit create with
 * `reuseOpenVisit`). An attempt is this record and the visit it has linked now: its start time is taken once and kept
 * in `startedAtFor` while the page is open, so a retry (after a lost answer, a 412 or Refresh) sends the same body,
 * which with the same Idempotency-Key ehr-api answers with the first visit again instead of IDEMPOTENCY_KEY_REUSED.
 * "Link again" once a visit is linked is a new attempt, with a start time and key of its own.
 */
export function visitAttempt(card: Pick<EdCard, 'attendanceId' | 'encounterId' | 'patientId'>, startedAtFor: Map<string, string>,
  now: () => Date = () => new Date()): { readonly startedAt: string; readonly keyBody: VisitKeyBody } {
  const attempt = `${card.attendanceId}:${card.encounterId ?? ''}`
  let startedAt = startedAtFor.get(attempt)
  if (!startedAt) {
    startedAt = now().toISOString().replace(/\.\d{3}Z$/, '.000Z')
    startedAtFor.set(attempt, startedAt)
  }
  return { startedAt, keyBody: { attempt, patientId: card.patientId, startedAt } }
}
export interface VisitKeyBody { readonly attempt: string; readonly patientId: string; readonly startedAt: string }

/** EHR-C1's refusal of a visit "reusing the open visit today" whose start time is not today in Lagos. */
export const VISIT_NOT_TODAY = 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY'

/**
 * Sends one attempt's emergency visit request (visitAttempt). When ehr-api answers that its start time is not today
 * (the attempt began before Lagos midnight and is retried after it, or a lost answer is retried then), the request can
 * never succeed as it was: the attempt's start time and Idempotency-Key are dropped and it is sent once more with a new
 * time. Any other answer, or the same refusal again (this device's clock is wrong), is the caller's.
 */
export async function startEmergencyVisit<Visit>(card: Pick<EdCard, 'attendanceId' | 'encounterId' | 'patientId'>,
  startedAtFor: Map<string, string>, send: (startedAt: string, keyBody: VisitKeyBody) => Promise<Visit>,
  forgetKey: (keyBody: VisitKeyBody) => void, now: () => Date = () => new Date()): Promise<Visit> {
  const first = visitAttempt(card, startedAtFor, now)
  try {
    return await send(first.startedAt, first.keyBody)
  } catch (caught) {
    if (!isHidApiError(caught) || caught.code !== VISIT_NOT_TODAY) throw caught
    startedAtFor.delete(first.keyBody.attempt)
    forgetKey(first.keyBody)
  }
  const fresh = visitAttempt(card, startedAtFor, now)
  return send(fresh.startedAt, fresh.keyBody)
}
export const FACILITY_NAME_MIN = 2
export const FACILITY_NAME_MAX = 120
// Control characters, which the server refuses in the complaint.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** The complaint's problem, or '' when it is fine (optional; 1-120 characters after trimming, no control characters). */
export function complaintProblem(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length > COMPLAINT_MAX) return `Keep the complaint to ${COMPLAINT_MAX} characters.`
  if (CONTROL.test(trimmed)) return 'Use letters, numbers and punctuation only.'
  return ''
}

export function reasonProblem(value: string): string {
  const length = value.trim().length
  if (length < REASON_MIN) return 'Say why in at least 8 characters.'
  if (length > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters.`
  return ''
}

// ---- Who and when --------------------------------------------------------------------

/** "You" for the session's own membership; another member's name from SX-9, never their id. */
export function memberText(membershipId: string | null | undefined, own: string | undefined, names: ReadonlyMap<string, string | null>,
  none = 'No one yet'): string {
  if (!membershipId) return none
  if (own && membershipId.toLowerCase() === own.toLowerCase()) return 'You'
  return names.get(membershipId.toLowerCase()) ?? 'A staff member here'
}

/**
 * memberText inside a sentence ("… by you", "… under a staff member here"): the same member, without a capital letter
 * where it is not a name.
 */
export function memberInSentence(membershipId: string | null | undefined, own: string | undefined,
  names: ReadonlyMap<string, string | null>, none = 'no one yet'): string {
  if (!membershipId) return none
  if (own && membershipId.toLowerCase() === own.toLowerCase()) return 'you'
  return names.get(membershipId.toLowerCase()) ?? 'a staff member here'
}

/** "09:05": the Lagos time of day of an ISO moment (@hid/ui/display, P2-4); '' when it is not one. */
export function lagosTime(iso: string | null | undefined): string {
  return formatTime(iso)
}

/**
 * "09:05" for a moment today in Lagos, else "3 Dec 2026, 09:05" (@hid/ui/display, P2-4): a patient waiting for a ward
 * stays on the board for days (Q-ED-6 A), and a time read days later is never taken for today's.
 */
export function lagosWhen(iso: string | null | undefined, now: Moment = Date.now()): string {
  return formatTimeOrDateTime(iso, now)
}

/** "3 Dec 2026, 09:05": the Lagos day and time, for the history (@hid/ui/display, P2-4). */
export function lagosDateTime(iso: string | null | undefined): string {
  return formatDateTime(iso)
}

/** The time in the department: "42 min", "2 h 5 min". No colours: the clinical lead has named no target. */
export function minutesText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  const whole = Math.floor(minutes)
  if (whole < 60) return `${whole} min`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** The Lagos wall-clock time (HH:MM) of now, and the ISO moment for a HH:MM typed today in Lagos (UTC+1, no summer time). */
export function lagosNowTime(now = new Date()): string {
  return formatTime(now)
}
export function arrivalMoment(time: string, now = new Date()): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  let moment = new Date(`${lagosDay(now)}T${match[1]}:${match[2]}:00.000+01:00`)
  // A time later than now (by more than the server's two minutes) was yesterday evening: an arrival before midnight.
  if (moment.getTime() - now.getTime() > 2 * 60_000) moment = new Date(moment.getTime() - 24 * 60 * 60_000)
  return moment.toISOString()
}

// ---- The card -----------------------------------------------------------------------

/** The name a card shows: an unknown record's "Unknown patient U-0007", or the patient's name once identified. */
export function cardName(card: Pick<EdCard, 'fullName' | 'recordKind' | 'unknownLabel'>): string {
  if (card.recordKind === 'unknown' && card.unknownLabel) return `Unknown patient ${card.unknownLabel}`
  return card.fullName
}

/**
 * The card's status in words. A closed record with no decision was not seen to leave: it is an arrival cancelled as made
 * in error (route 9) or one closed on the waiting list, which only its history tells apart (closedWords), so the card
 * says "Closed".
 */
export function statusWords(card: Pick<EdCard, 'status' | 'disposition'>): string {
  if (card.status === 'closed') return card.disposition ? outcomeText(card.disposition.outcome) : 'Closed'
  if (card.status === 'decided') return card.disposition?.outcome === 'admit_requested' ? 'Waiting for admission' : outcomeText(card.disposition?.outcome)
  return 'In the department'
}
/** The record page's status, which has the history: a closed record with no decision says how it closed. */
export function closedWords(card: Pick<EdCard, 'status' | 'disposition'>, history: readonly Pick<EdHistoryEvent, 'kind'>[]): string {
  if (card.status !== 'closed' || card.disposition) return statusWords(card)
  const close = [...history].reverse().find(event => event.kind === 'cancelled' || event.kind === 'closed_on_waiting_list')
  if (close?.kind === 'cancelled') return 'Arrival cancelled'
  if (close?.kind === 'closed_on_waiting_list') return 'Closed on the waiting list'
  return statusWords(card)
}
export function statusTone(card: Pick<EdCard, 'status'>): EhrBadgeTone {
  return card.status === 'open' ? 'brand' : card.status === 'decided' ? 'caution' : 'neutral'
}

/** The complaint as the card shows it: hidden from the front desk, or "None recorded". */
export function complaintText(card: Pick<EdCard, 'presentingComplaint' | 'complaintHidden'>): string {
  if (card.complaintHidden) return 'Shown to nurses, clinicians and doctors only'
  return card.presentingComplaint ?? 'None recorded'
}

// ---- History ------------------------------------------------------------------------

const HISTORY_WORDS: Readonly<Record<EdHistoryEvent['kind'], string>> = {
  arrived: 'Arrived',
  moved_from_waiting_list: 'Moved from the waiting list',
  triaged: 'Triaged',
  moved: 'Moved',
  visit_linked: 'Visit linked',
  disposition: 'Decision recorded',
  disposition_changed: 'Decision changed',
  left: 'Left the department',
  cancelled: 'Arrival cancelled',
  closed_on_waiting_list: 'Closed on the waiting list',
}

/** A move on the board, by the stage it went to: each said as staff say it, never "Moved to in triage". */
const MOVED_WORDS: Readonly<Partial<Record<VisitQueueStage, string>>> = {
  waiting: 'Moved back to waiting',
  triage: 'Moved to triage',
  ready: 'Marked ready to be seen',
  with_clinician: 'Moved to being seen',
}

/** One history line, in plain words (never the complaint's text: the history says only that it changed). */
export function historyText(event: EdHistoryEvent): string {
  const known = Object.hasOwn(HISTORY_WORDS, event.kind) ? HISTORY_WORDS[event.kind] : 'Changed'
  // A move records the stage before and after; the same stage means only who sees the patient changed.
  const what = event.kind !== 'moved' || !event.toStage ? known
    : event.toStage === event.fromStage ? 'Changed who will see them'
      : Object.hasOwn(MOVED_WORDS, event.toStage) ? MOVED_WORDS[event.toStage] ?? known : known
  const parts: string[] = [what]
  if (event.triageLevel !== null && (event.kind === 'triaged' || event.kind === 'arrived')) parts.push(`(level ${event.triageLevel})`)
  if (event.outcome) parts.push(`: ${outcomeText(event.outcome).toLowerCase()}`)
  let text = parts.join(' ').replace(' :', ':')
  if (event.complaintChanged) text += '. Complaint recorded'
  return text
}

// ---- Unknown patients (ID-7) ------------------------------------------------------------

export const UNKNOWN_REASONS: readonly UnknownPatientReason[] = ['unconscious', 'confused', 'unaccompanied_child', 'cannot_communicate', 'other']
export const UNKNOWN_REASON_WORDS: Readonly<Record<UnknownPatientReason, string>> = {
  unconscious: 'Unconscious',
  confused: 'Confused',
  unaccompanied_child: 'A child on their own',
  cannot_communicate: 'Cannot communicate',
  other: 'Other',
}
export const UNKNOWN_SEXES = [['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Not known']] as const
export const UNKNOWN_HINT = 'For a person who cannot say who they are. The record gets a Health ID for the wristband and is this facility’s own patient.'

// ---- Refusals -----------------------------------------------------------------------

/** Whether a refusal says the board's routes are not served here (an ehr-api before 0168, or the flag off). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'ED_BOARD_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('ED_')
}

export const ED_REFUSALS: Readonly<Record<string, string>> = {
  ED_BOARD_NOT_AVAILABLE: NOT_AVAILABLE,
  ED_BOARD_NOT_ALLOWED: BOARD_REFUSED,
  ED_TRIAGE_NOT_ALLOWED: TRIAGE_REFUSED,
  ED_DISPOSITION_NOT_ALLOWED: DISPOSITION_REFUSED,
  ED_ARRIVAL_NEEDS_SEARCH: 'Search for the patient first, then add them to the board. A search result can be used for 10 minutes.',
  ED_ARRIVAL_NEEDS_ONE_PATIENT: 'Choose one patient: from a search result or from this facility’s patients.',
  ED_ARRIVAL_TIME_INVALID: 'The arrival time can be up to 6 hours ago, and not in the future.',
  ED_TRIAGE_INVALID: 'Choose a triage level from 1 to 5.',
  ED_NOTHING_TO_CHANGE: 'Choose a stage or who will see the patient.',
  ED_ASSIGNEE_INVALID: 'Choose a nurse, clinician or doctor who works at this facility.',
  ED_VISIT_INVALID: 'Choose a visit of this patient at this facility, started for this arrival.',
  [VISIT_NOT_TODAY]: 'The emergency visit was not started. The date or time on this device looks wrong. Check it, then try again.',
  ED_ADMIT_DEPARTMENT_INVALID: 'Choose a department of this facility to admit the patient to.',
  ED_REASON_REQUIRED: 'Say why in at least 8 characters.',
  ED_ATTENDANCE_NOT_FOUND: 'This patient is not on this facility’s emergency board.',
  ED_ATTENDANCE_CLOSED: 'This patient has left the emergency department. Add them again if they are back.',
  ED_ATTENDANCE_DECIDED: 'A decision is already recorded for this patient. Change the decision, or select Left the department.',
  ED_ATTENDANCE_NOT_DECIDED: 'Record where the patient goes next first.',
  ED_CANCEL_NOT_ALLOWED: 'This arrival already has a visit or a decision, so it cannot be cancelled. Record where the patient goes next instead.',
  ED_VERSION_CONFLICT: 'Someone else changed this patient’s place on the board. Reload it and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong. Reload the page and try again.',
  PURPOSE_OF_USE_REQUIRED: 'The emergency board is for patient care only. Reload the page and try again.',
}

/** Refusals after which the record is read again at once: the card on screen is out of date. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['ED_VERSION_CONFLICT', 'ED_ATTENDANCE_CLOSED', 'ED_ATTENDANCE_DECIDED',
  'ED_ATTENDANCE_NOT_DECIDED', 'ED_CANCEL_NOT_ALLOWED'])

/**
 * A refusal in plain words: the board's own, "not available yet" for an ehr-api without it, the request's own meaning
 * for a 400 VALIDATION_FAILED (never the fields it names), and a general guard's 403 as the board's refusal. Never the
 * word the backend's guard uses.
 */
export function refusalWords(caught: unknown, fallback: string, invalid?: string): string {
  if (!isHidApiError(caught)) return fallback
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(ED_REFUSALS, caught.code)) return ED_REFUSALS[caught.code]!
  if (caught.code === 'VALIDATION_FAILED') return invalid ?? 'Check the highlighted fields.'
  if (caught.status === 403) return BOARD_REFUSED
  if (caught.status === 0 || caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT') return 'No connection. Check your internet and try again.'
  return fallback
}

/**
 * EHR-C1's refusals of the emergency visit the visit link starts (before route 6), which are about the patient's chart,
 * never the board (ClinicalRepository.run at hid-system#337): 403 CONSENT_REQUIRED (the access the chart was opened
 * under has ended since, was denied, or allows reading only) and 403 ACCESS_DENIED (the database refused the write) say
 * to open the chart again; so does a 404 (CLINICAL_RESOURCE_NOT_FOUND), the patient not found at this facility. Never
 * the board's "only the front desk, nurses, clinicians and doctors" or "not available yet".
 */
export const VISIT_CHART_CLOSED = 'The emergency visit was not started. Your access to this patient’s record has ended or does not allow changes. '
  + 'Open their chart again on Patients, then come back here.'
export const VISIT_NOT_FOUND = 'The emergency visit was not started. The patient was not found at this facility. '
  + 'Open their chart again on Patients, then come back here.'
export const VISIT_FAILED = 'The emergency visit could not be started. Try again.'
const VISIT_ACCESS_ENDED: ReadonlySet<string> = new Set(['CONSENT_REQUIRED', 'ACCESS_DENIED'])

export function visitRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return VISIT_FAILED
  if (caught.code === VISIT_NOT_TODAY || caught.code.startsWith('IDEMPOTENCY_KEY_')) return ED_REFUSALS[caught.code] ?? VISIT_FAILED
  if (caught.status === 403 && VISIT_ACCESS_ENDED.has(caught.code)) return VISIT_CHART_CLOSED
  if (caught.status === 404) return VISIT_NOT_FOUND
  if (caught.code === 'VALIDATION_FAILED') return VISIT_FAILED
  return plainErrorText(caught, VISIT_FAILED, { audience: 'facility' })
}

/** The ID-7 make-one refusals, in plain words. */
export function unknownRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return 'The record could not be made. Try again.'
  if (caught.status === 403) return 'Your role here can’t make an unknown patient’s record. Ask the front desk.'
  if (caught.status === 404) return 'Unknown patient records are not available yet. Try again later.'
  if (caught.code === 'VALIDATION_FAILED') return 'Check the sex, the age (0 to 120) and the reason.'
  return refusalWords(caught, 'The record could not be made. Try again.')
}

// ---- Served ---------------------------------------------------------------------------
// Learned from the backend's own answers, in memory for the page's life: a read answering 404 (an ehr-api before 0168)
// or 503 ED_BOARD_NOT_AVAILABLE (the flag is off) says not served, only while nothing has said otherwise; any answer says
// served, once and for all. Until then null, and the page is listed.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnEdBoardServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function edBoardServed(): Served { return served }
export function subscribeEdBoardServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useEdBoardServed(): Served {
  return useSyncExternalStore(subscribeEdBoardServed, edBoardServed, edBoardServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetEdBoardServed(): void {
  served = null
  changed()
}

/** Records what an answer or a refusal says about whether the board is served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnEdBoardServed(true); return }
  if (notServed(caught)) learnEdBoardServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnEdBoardServed(true)
  }
}

export const ATTENDANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newKey(): string {
  return crypto.randomUUID()
}
