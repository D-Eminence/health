import type { EhrBadgeTone } from '@hid/ui/ehr'
import type { VisitQueueCard, VisitQueueStage } from '../../../staff/api'
import type { PatientSearchKeys } from '../../../staff/patientSearch'

/*
 * The waiting list (hid-system 0135, EHR-C7) in plain words. Patient search's own words and card rules are shared with
 * Patients' Search by name (clinical/patients/searchWords.ts, staff/patientSearch.ts): who may use it, what each stage is called, and what each
 * refusal says. The rules are the backend's (INTERFACE_CONTRACT.md "EHR-C7"); these only choose what the page offers.
 * Identity and EHR decide every request.
 */

export const TITLE = 'Waiting list'
export const EYEBROW = 'Front desk'
export const DESCRIPTION = 'Check patients in as they arrive, and see where each one is: waiting, in triage, ready or being seen.'

/** The waiting list needs both (front desk, nurse, clinician, doctor); lab and pharmacy staff hold read only. */
export const ENCOUNTER_READ = 'ehr.encounter.read'
export const ENCOUNTER_WRITE = 'ehr.encounter.write'
/** Staff patient search (0132): front desk, approvers, doctors, nurses and clinicians. */
export const PATIENT_SEARCH = 'identity.registration.write'
/** Who can be put down to see the patient: a nurse, clinician or doctor here (encounter and note writing). */
export const NOTE_WRITE = 'ehr.note.write'

export const UNAVAILABLE_TITLE = TITLE
export const UNAVAILABLE_MESSAGE = 'Only the front desk, nurses, clinicians and doctors of this facility can use the waiting list.'

export function canUseWaitingList(permissions: readonly string[]): boolean {
  return permissions.includes(ENCOUNTER_READ) && permissions.includes(ENCOUNTER_WRITE)
}

export function canSearchPatients(permissions: readonly string[]): boolean {
  return permissions.includes(PATIENT_SEARCH)
}

/** Whether this member can be the one who sees a patient (the backend's assignee rule). */
export function canSeePatients(permissions: readonly string[]): boolean {
  return permissions.includes(ENCOUNTER_WRITE) && permissions.includes(NOTE_WRITE)
}

/** How often the open list is read again while the page is shown. */
export const POLL_MS = 30_000

export const OPEN_STAGES: readonly VisitQueueStage[] = ['waiting', 'triage', 'ready', 'with_clinician']
export const CLOSING_STAGES: readonly VisitQueueStage[] = ['finished', 'left', 'cancelled']

export function isOpen(stage: VisitQueueStage): boolean {
  return OPEN_STAGES.includes(stage)
}

/** Each stage in the words staff use. Never the code itself. */
export const STAGE_WORDS: Readonly<Record<VisitQueueStage, string>> = {
  waiting: 'Waiting',
  triage: 'In triage',
  ready: 'Ready to be seen',
  with_clinician: 'Being seen',
  finished: 'Finished',
  left: 'Left before being seen',
  cancelled: 'Check-in cancelled',
}

export function stageText(stage: string): string {
  return Object.hasOwn(STAGE_WORDS, stage) ? STAGE_WORDS[stage as VisitQueueStage] : 'Stage not known'
}

export function stageTone(stage: VisitQueueStage): EhrBadgeTone {
  switch (stage) {
    case 'waiting': return 'caution'
    case 'triage': return 'brand'
    case 'ready': return 'positive'
    case 'with_clinician': return 'brand'
    default: return 'neutral'
  }
}

/** The one step forward from each open stage, as its button says it. */
export const NEXT_STEP: Readonly<Partial<Record<VisitQueueStage, { readonly stage: VisitQueueStage; readonly label: string }>>> = {
  waiting: { stage: 'triage', label: 'Start triage' },
  triage: { stage: 'ready', label: 'Ready to be seen' },
  ready: { stage: 'with_clinician', label: 'Call in to be seen' },
  with_clinician: { stage: 'finished', label: 'Finished' },
}

// The five triage levels are shared with the emergency department board and Triage & Vitals (one module).
export { TRIAGE_LEVELS, triageText, triageTone } from '../parts/triageLevels'

/**
 * A row that is also on the emergency department board (hid-system ED-1, `edAttendanceId`): it says so, and links to the
 * patient's record on the board, by the ED record's id only.
 */
export const EMERGENCY_DEPARTMENT = 'Emergency department'
export function emergencyRecordHref(attendanceId: string): string {
  return `/provider/emergency-department/${encodeURIComponent(attendanceId)}`
}

/** Who will see the patient: the session's own membership is "You"; another member's id is never shown. */
export function assigneeText(card: Pick<VisitQueueCard, 'assignedMembershipId'>, membershipId: string | undefined): string {
  if (card.assignedMembershipId === null) return 'No one yet'
  return card.assignedMembershipId === membershipId ? 'You' : 'Another staff member'
}

/** The date of birth as the card says it: an estimate (0145, an unknown patient's age) says so. */
export function bornText(born: string, estimated: boolean | undefined): string {
  if (!born) return ''
  return estimated ? `Born about ${born} (estimated)` : `Born ${born}`
}

export function sexText(sex: string | null): string {
  if (!sex) return ''
  const word = sex.replaceAll('_', ' ').toLowerCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The last 4 characters of the Health ID, as the card gives them: never the whole Health ID. */
export function healthIdEnding(last4: string): string {
  return `•••• ${last4}`
}

/** The waiting list's refusals, in plain words (the backend's own sentences where they are already plain). */
export const VISIT_QUEUE_REFUSALS: Readonly<Record<string, string>> = {
  CHECK_IN_NEEDS_SEARCH: 'Search for the patient first, then check them in. A search result can be used for 10 minutes.',
  CHECK_IN_NEEDS_ONE_PATIENT: 'Search for the patient again, then select Check in on their card.',
  VISIT_QUEUE_NOT_PERMITTED: UNAVAILABLE_MESSAGE,
  PURPOSE_OF_USE_REQUIRED: 'The waiting list is for patient care only. Reload the page and try again.',
  VISIT_QUEUE_ENTRY_CHANGED: 'Someone else changed this patient’s place on the waiting list. The list has been loaded again: check it and try again.',
  VISIT_QUEUE_ENTRY_CLOSED: 'This patient is no longer on the waiting list. Check them in again if they are back.',
  VISIT_QUEUE_ENTRY_NOT_FOUND: 'This patient is no longer on this facility’s waiting list. The list has been loaded again.',
  VISIT_QUEUE_ASSIGNEE_INVALID: 'Choose a nurse, clinician or doctor who works at this facility.',
  VISIT_QUEUE_NOTHING_TO_CHANGE: 'Choose a stage, a triage level or who will see the patient.',
  VISIT_QUEUE_UPDATE_INVALID: 'Choose a stage, a triage level from 1 to 5, or who will see the patient.',
  VISIT_QUEUE_UNAVAILABLE: 'The waiting list is not available yet. Try again later.',
  // ehr-api's guard, for a member without encounter read and write here (its own text names a permission).
  PERMISSION_DENIED: UNAVAILABLE_MESSAGE,
  // An ehr-api before 0135 (hid-system main) has no such route.
  NOT_FOUND: 'The waiting list is not available yet. Try again later.',
}

/** A 400 VALIDATION_FAILED (the body did not pass ehr-api's checks), as each request would have caused it. */
export const CHECK_IN_INVALID = VISIT_QUEUE_REFUSALS.CHECK_IN_NEEDS_ONE_PATIENT!
export const UPDATE_INVALID = VISIT_QUEUE_REFUSALS.VISIT_QUEUE_UPDATE_INVALID!

/** Refusals after which the list is read again at once: the card on screen is out of date. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['VISIT_QUEUE_ENTRY_CHANGED', 'VISIT_QUEUE_ENTRY_CLOSED', 'VISIT_QUEUE_ENTRY_NOT_FOUND'])

export const SEARCH_HINT = 'Use the full name and date of birth, the Health ID with the last name or date of birth, or the phone number with '
  + 'the last name. For this facility’s own patients, the last name and date of birth, the phone number or the Health ID is enough.'
export const SEARCH_EMPTY = 'Enter the patient’s details to search.'

export interface SearchValues {
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly phone: string
  readonly healthId: string
}

export const EMPTY_SEARCH: SearchValues = { firstName: '', lastName: '', dateOfBirth: '', phone: '', healthId: '' }

/** The keys to send: each one typed, trimmed; the Health ID in capitals. Null when nothing is typed. */
export function searchKeys(values: SearchValues): PatientSearchKeys | null {
  const keys: { -readonly [K in keyof PatientSearchKeys]: PatientSearchKeys[K] } = {}
  const firstName = values.firstName.trim()
  const lastName = values.lastName.trim()
  const dateOfBirth = values.dateOfBirth.trim()
  const phone = values.phone.trim()
  const healthId = values.healthId.trim().toUpperCase()
  if (firstName) keys.firstName = firstName
  if (lastName) keys.lastName = lastName
  if (dateOfBirth) keys.dateOfBirth = dateOfBirth
  if (phone) keys.phone = phone
  if (healthId) keys.healthId = healthId
  return Object.keys(keys).length === 0 ? null : keys
}

/** What a check-in answered, for the notice above the list. */
export function checkedInText(outcome: 'checked_in' | 'already_on_list', fullName: string): string {
  return outcome === 'already_on_list'
    ? `${fullName} is already on the waiting list.`
    : `${fullName} is checked in and waiting.`
}

/** The time of day a card was checked in, as "09:05" (24-hour clock, as the clinical pages write it). */
export function timeText(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? ''
    : time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

const LAGOS_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today's date (YYYY-MM-DD) in Lagos, the day the backend gives each check-in (`checkInDay`), whatever the device's zone. */
export function lagosToday(now = new Date()): string {
  const parts = LAGOS_DAY.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Whether the patient was checked in on an earlier day than today and is still on the list (nobody moved them on). */
export function fromEarlierDay(card: Pick<VisitQueueCard, 'checkInDay'>, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(card.checkInDay) && card.checkInDay < today
}

/** When the card was checked in: the time of day for today's, else "22 Nov, 16:40" (with the year if it is not this one). */
export function checkInWhen(card: Pick<VisitQueueCard, 'checkInDay' | 'checkedInAt'>, today: string): string {
  const time = timeText(card.checkedInAt)
  if (!fromEarlierDay(card, today)) return time
  const day = new Date(`${card.checkInDay}T00:00:00.000Z`)
  const sameYear = card.checkInDay.slice(0, 4) === today.slice(0, 4)
  const date = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
  return time ? `${date}, ${time}` : date
}

export const EARLIER_DAY = 'Checked in on an earlier day'

/**
 * The backend stops the list at `limit` patients, those still waiting first, then those who finished or left today. So a
 * list read with the closed rows that has more was cut in the closed rows, unless the waiting ones alone fill it.
 */
export function cutShort(list: { readonly hasMore: boolean; readonly limit: number; readonly withClosed: boolean } | null, openCount: number) {
  const more = list?.hasMore === true
  const open = more && (!list!.withClosed || openCount >= list!.limit)
  return { open, closed: more && list!.withClosed }
}

export function closedTitle(count: number, cut: boolean): string {
  if (!cut) return `Finished or left today (${count})`
  return count > 0 ? `Finished or left today (at least ${count})` : 'Finished or left today'
}

export function closedCutText(limit: number): string {
  return `Not everyone who finished or left today is shown. The list stops at ${limit} patients, those still waiting first.`
}

/** A refused patient search on the waiting list: its own words, as this page checks patients in from no other search. */
export const CHECK_IN_SEARCH_REFUSED = 'Your role at this facility can’t search for patients to check them in. Ask your facility administrator.'
export const CHECK_IN_SEARCH_MISSING = 'Patient search is not available yet, so patients can’t be checked in here. Try again later.'
