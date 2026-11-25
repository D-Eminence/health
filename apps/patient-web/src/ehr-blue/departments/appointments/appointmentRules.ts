import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatTime, formatWeekday, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  AppointmentCard, AppointmentHistoryEntry, AppointmentStatus, AppointmentVisitType,
} from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'
import { lagosToday } from '../waiting/waitingRules'

/*
 * Appointments (hid-system APPT-1, migrations 0160 and 0161; INTERFACE_CONTRACT.md "APPT-1") in plain words: who may do
 * what, what each status and visit type is called, the Lagos day and time of every appointment whatever the device's
 * zone, and what each refusal says. The backend decides every request; these only choose what the pages offer.
 *
 * Built at the recommended option of each open owner question (Q-APPT-1 to Q-APPT-7, not yet answered by the owner).
 */

export { lagosToday }

export const TITLE = 'Appointments'
export const EYEBROW = 'Front desk'
export const DESCRIPTION = 'Book patients into a clinic or with a clinician, see each day’s appointments, and check patients in when they arrive.'
export const BASE = '/provider/appointments'

/** The two codes of 0160, and 0135's pair that check-in also needs. */
export const APPOINTMENT_READ = 'ehr.appointment.read'
export const APPOINTMENT_WRITE = 'ehr.appointment.write'
export const ENCOUNTER_READ = 'ehr.encounter.read'
export const ENCOUNTER_WRITE = 'ehr.encounter.write'
/** Staff patient search (0132): the only way to a patient who is not yet this facility's own. */
export const PATIENT_SEARCH = 'identity.registration.write'
/** The clinic list and the default length: the hospital administrator's. */
export const ORGANIZATION_MANAGE = 'organization.manage'

export const canRead = (permissions: readonly string[]) => permissions.includes(APPOINTMENT_READ)
export const canWrite = (permissions: readonly string[]) => permissions.includes(APPOINTMENT_WRITE)
export const canCheckIn = (permissions: readonly string[]) =>
  canWrite(permissions) && permissions.includes(ENCOUNTER_READ) && permissions.includes(ENCOUNTER_WRITE)
export const canSearch = (permissions: readonly string[]) => permissions.includes(PATIENT_SEARCH)
export const canManageClinics = (permissions: readonly string[]) => permissions.includes(ORGANIZATION_MANAGE)

export const READ_REFUSED = 'Only the front desk, nurses, clinicians and doctors of this facility can see appointments.'
export const WRITE_REFUSED = 'Only the front desk, clinicians and doctors of this facility can book or change appointments.'
export const CHECK_IN_REFUSED = 'Only the front desk, clinicians and doctors of this facility can check a patient in from an appointment.'
export const SETTINGS_REFUSED = 'Only the hospital administrator can change the clinics and the default appointment length.'
export const NOT_AVAILABLE = 'Appointments are not available yet.'

/** Each status in the words staff use. Never the code itself. */
export const STATUS_WORDS: Readonly<Record<AppointmentStatus, string>> = {
  booked: 'Booked',
  checked_in: 'Checked in',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

export function statusText(status: string): string {
  return Object.hasOwn(STATUS_WORDS, status) ? STATUS_WORDS[status as AppointmentStatus] : 'Status not known'
}

export function statusTone(status: string): EhrBadgeTone {
  switch (status) {
    case 'booked': return 'brand'
    case 'checked_in': return 'positive'
    case 'no_show': return 'caution'
    default: return 'neutral'
  }
}

export const STATUSES: readonly AppointmentStatus[] = ['booked', 'checked_in', 'cancelled', 'no_show']
/** What the day list shows first: the appointments still to come and those who came. */
export const DEFAULT_STATUSES: readonly AppointmentStatus[] = ['booked', 'checked_in']

export const VISIT_TYPE_WORDS: Readonly<Record<AppointmentVisitType, string>> = {
  new_visit: 'New visit',
  follow_up: 'Follow-up',
  results_review: 'Results review',
  antenatal: 'Antenatal',
  procedure: 'Procedure',
  other: 'Other',
}
export const VISIT_TYPES: readonly AppointmentVisitType[] = ['new_visit', 'follow_up', 'results_review', 'antenatal', 'procedure', 'other']

export function visitTypeText(type: string): string {
  return Object.hasOwn(VISIT_TYPE_WORDS, type) ? VISIT_TYPE_WORDS[type as AppointmentVisitType] : 'Other'
}

/** A department code in the facility profile's words (contract section 43.6); one it does not know, in plain words. */
export function departmentText(code: string): string {
  const known = DEPARTMENTS.find(([value]) => value === code)
  if (known) return known[1]
  const words = code.replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Department not known'
}

// ---- Lagos time ----------------------------------------------------------------
// Every appointment is booked and shown in Lagos time (UTC+1 all year: Nigeria keeps no summer time), whatever zone the
// device is set to.

const LAGOS_OFFSET = '+01:00'
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** "09:05": the Lagos time of day of an ISO moment (@hid/ui/display, Q181 A and Q182 A); '' when it is not one. */
export function lagosTime(iso: string | null | undefined): string {
  return formatTime(iso)
}

/** The Lagos day (YYYY-MM-DD) and time (HH:MM) of an ISO moment, as the form's fields take them. */
export function lagosParts(iso: string): { day: string; time: string } | null {
  const day = lagosDay(iso)
  const time = formatTime(iso)
  return day && time ? { day, time } : null
}

/** "Thursday 3 Dec 2026": a calendar day (YYYY-MM-DD) in the one date format (Q182 A), the same wherever the device is. */
export function dayText(day: string, withWeekday = true): string {
  if (!isDay(day)) return ''
  return withWeekday ? `${formatWeekday(day)} ${formatDate(day)}` : formatDate(day)
}

/** The day `count` days after (or before) a calendar day. */
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

export type TimeProblem = 'missing' | 'step'

/** Why a time typed in the form can't be booked here, before it is sent; null when it can be. */
export function timeProblem(time: string): TimeProblem | null {
  const match = TIME_PATTERN.exec(time)
  if (!match) return 'missing'
  return Number(match[2]) % 5 === 0 ? null : 'step'
}

/** The moment a Lagos day and time stand for, as ISO UTC ("2026-12-03T08:00:00.000Z" for 3 December, 09:00). */
export function lagosStartsAt(day: string, time: string): string | null {
  if (!isDay(day) || !TIME_PATTERN.test(time)) return null
  const moment = new Date(`${day}T${time}:00${LAGOS_OFFSET}`)
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString()
}

/** "09:00 to 09:30": an appointment's times in Lagos. */
export function timeRangeText(card: Pick<AppointmentCard, 'startsAt' | 'endsAt'>): string {
  const from = lagosTime(card.startsAt)
  const to = lagosTime(card.endsAt)
  return from && to ? `${from} to ${to}` : from
}

/** "Thursday 3 Dec 2026, 09:00": when an appointment starts, in Lagos. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return ''
  const parts = lagosParts(iso)
  return parts ? `${dayText(parts.day)}, ${parts.time}` : ''
}

/** Whether an appointment's start has passed (a no-show may be marked only then; the server decides). */
export function hasStarted(card: Pick<AppointmentCard, 'startsAt'>, now = new Date()): boolean {
  const start = new Date(card.startsAt).getTime()
  return !Number.isNaN(start) && start <= now.getTime()
}

/**
 * Check in is offered for a booked appointment on its own Lagos day, or a no-show marked that day (the server undoes the
 * no-show). On any other day the server answers APPOINTMENT_CHECK_IN_WRONG_DAY, so the button is not offered.
 */
export function checkInOffered(card: Pick<AppointmentCard, 'status' | 'appointmentDay'>, today = lagosToday()): boolean {
  return (card.status === 'booked' || card.status === 'no_show') && card.appointmentDay === today
}

// ---- Words ---------------------------------------------------------------------

export const REASON_HINT = 'A short booking reason, not a diagnosis (for example ‘Blood pressure review’).'
export const REASON_MAX = 200
export const CHANGE_REASON_MIN = 8
export const CHANGE_REASON_MAX = 500
export const LENGTHS: readonly number[] = [10, 15, 20, 30, 45, 60, 90, 120]

/** Why a reschedule or cancel reason can't be sent; null when it can. Counted as the server counts it, trimmed. */
export function changeReasonProblem(reason: string): string | null {
  const length = [...reason.trim()].length
  if (length < CHANGE_REASON_MIN) return `Give a reason of at least ${CHANGE_REASON_MIN} characters.`
  if (length > CHANGE_REASON_MAX) return `Keep the reason to ${CHANGE_REASON_MAX} characters or fewer.`
  return null
}

export const CHECK_IN_CONFIRM = 'Confirm the patient’s name and date of birth with them before checking them in.'
export const CHECK_IN_CONFIRM_LABEL = 'I have confirmed the patient’s name and date of birth with them'

/** The printed call list's footer (DPO item, Q-APPT-7 A). */
export const CALL_LIST_FOOTER = 'Contains patient phone numbers. Keep it at the desk and shred it after use.'

/** The refusals, in plain words: the contract's own sentences, which never name a permission. */
export const APPOINTMENT_REFUSALS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the details and try again.',
  APPOINTMENT_NEEDS_ONE_PATIENT: 'Choose one patient: from a search result or from this facility’s patients.',
  APPOINTMENT_TIME_INVALID: 'Choose a time from now up to one year ahead, on a 5-minute step.',
  APPOINTMENT_CLINICIAN_INVALID: 'Choose a nurse, clinician or doctor who works at this facility.',
  APPOINTMENT_CLINIC_INVALID: 'Choose an open clinic of this facility in the same department.',
  APPOINTMENT_IDENTITY_NOT_CONFIRMED: CHECK_IN_CONFIRM,
  PURPOSE_OF_USE_REQUIRED: 'Appointments are for patient care only. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong sending this. Reload the page and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This form was already sent with other details. Reload the page and try again.',
  APPOINTMENT_NOT_ALLOWED: READ_REFUSED,
  APPOINTMENT_NEEDS_SEARCH: 'Search for the patient first, then book. A search result can be used for 10 minutes.',
  APPOINTMENT_CHECK_IN_NEEDS_SEARCH: 'Search for the patient to check them in.',
  APPOINTMENT_NOT_FOUND: 'No such appointment.',
  APPOINTMENT_CLINICIAN_CLASH: 'This clinician already has an appointment at this time. Choose another time or clinician.',
  APPOINTMENT_PATIENT_CLASH: 'This patient already has an appointment here at this time.',
  APPOINTMENT_NOT_BOOKED: 'This appointment is no longer booked. Reload it to see what changed.',
  APPOINTMENT_NO_SHOW_TOO_EARLY: 'You can mark a no-show only after the appointment time.',
  APPOINTMENT_CHECK_IN_WRONG_DAY: 'This appointment is for another day. Check the patient in on that day, or reschedule it.',
  APPOINTMENT_VERSION_CONFLICT: 'Someone else changed this appointment. Reload it and try again.',
  APPOINTMENT_CLINIC_NOT_FOUND: 'No such clinic at this facility.',
  APPOINTMENT_CLINIC_NAME_TAKEN: 'This facility already has a clinic with this name.',
  APPOINTMENT_CLINIC_VERSION_CONFLICT: 'Someone else changed this clinic. Reload it and try again.',
  APPOINTMENT_SETTINGS_VERSION_CONFLICT: 'Someone else changed the default length. Reload it and try again.',
  INVALID_CURSOR: 'This list has changed. Load it again from the start.',
  APPOINTMENTS_NOT_AVAILABLE: NOT_AVAILABLE,
  // ehr-api's guard with its own text (it names a permission), and a facility the session can't use.
  PERMISSION_DENIED: READ_REFUSED,
  PATIENT_SESSION_REQUIRED: READ_REFUSED,
}

/** After these the card on screen is out of date: the appointment is read again. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['APPOINTMENT_NOT_BOOKED', 'APPOINTMENT_VERSION_CONFLICT'])

/** Whether a refusal says the appointments routes are not served here (an ehr-api before 0160, or the flag off). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'APPOINTMENTS_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('APPOINTMENT_')
}

/**
 * A refusal in plain words: the appointments' own, else `fallback`. `writing`: an APPOINTMENT_NOT_ALLOWED on a write
 * names who may book or change appointments; `checkIn`: who may check a patient in.
 */
export function refusalWords(caught: unknown, fallback: string, kind: 'read' | 'write' | 'check-in' | 'settings' = 'read'): string {
  if (!isHidApiError(caught)) return fallback
  if (caught.code === 'REQUEST_CANCELLED') return ''
  if (notServed(caught)) return NOT_AVAILABLE
  if (caught.code === 'APPOINTMENT_NOT_ALLOWED' || caught.code === 'PERMISSION_DENIED' || (caught.status === 403 && caught.code === 'FORBIDDEN')) {
    return kind === 'write' ? WRITE_REFUSED : kind === 'check-in' ? CHECK_IN_REFUSED : kind === 'settings' ? SETTINGS_REFUSED : READ_REFUSED
  }
  if (Object.hasOwn(APPOINTMENT_REFUSALS, caught.code)) return APPOINTMENT_REFUSALS[caught.code]!
  if (caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT') return 'Couldn’t reach Health ID. Check the connection and try again.'
  return fallback
}

/** One history line, as staff read it. Names of who did it come from the staff names list, never an id. */
export function historyText(entry: AppointmentHistoryEntry): string {
  switch (entry.kind) {
    case 'booked': return 'Booked'
    case 'rescheduled': {
      const from = whenText(entry.fromStartsAt)
      const to = whenText(entry.toStartsAt)
      return from && to ? `Moved from ${from} to ${to}` : 'Rescheduled'
    }
    case 'cancelled': return 'Cancelled'
    case 'no_show': return 'Marked as a no-show'
    case 'no_show_undone': return 'No-show undone: the patient came that day'
    case 'checked_in': return 'Checked in to the waiting list'
    default: return 'Changed'
  }
}

/** Who is booked to see the patient: "You" for the session's own membership; a name when the staff list gives one. */
export function clinicianText(membershipId: string | null, names: ReadonlyMap<string, string | null>, me: string | undefined): string {
  if (!membershipId) return 'Any clinician in the clinic'
  if (me && membershipId.toLowerCase() === me.toLowerCase()) return 'You'
  const name = names.get(membershipId.toLowerCase())
  return name ?? (name === null ? 'Former staff member' : 'A staff member here')
}

/** A whole Health ID is never shown: the last 4 characters, as the card gives them. */
export function healthIdEnding(last4: string | null | undefined): string {
  return last4 ? `•••• ${last4}` : ''
}

/** An appointment's id as the address carries it: a UUID, never a Health ID. */
export const APPOINTMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fresh Idempotency-Key for one form; the same key is sent again when the same form is retried. */
export function newKey(): string {
  return crypto.randomUUID()
}

// ---- Whether Health ID serves appointments here ----------------------------------
// Learned from the backend's own answers, in memory for the page's life (as readingLearningServed.ts): a read answering
// 404 (an ehr-api before 0160) or 503 APPOINTMENTS_NOT_AVAILABLE (the flag is off) says not served, only while nothing has
// said otherwise; any answer says served, once and for all. Until then null, and the page is listed.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnAppointmentsServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function appointmentsServed(): Served { return served }
export function subscribeAppointmentsServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useAppointmentsServed(): Served {
  return useSyncExternalStore(subscribeAppointmentsServed, appointmentsServed, appointmentsServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetAppointmentsServed(): void {
  served = null
  changed()
}

/** Records what an answer or a refusal says about whether appointments are served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnAppointmentsServed(true); return }
  if (notServed(caught)) learnAppointmentsServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnAppointmentsServed(true)
  }
}

// ---- Handing a patient to New appointment -----------------------------------------
// The patient page and the waiting list hand their patient to New appointment in memory only: never in the address,
// router state or storage. Read once, then gone.

export interface PatientHandoff { readonly patientId: string; readonly fullName: string; readonly facilityId: string }
let handoff: PatientHandoff | null = null

export function handPatient(patient: PatientHandoff): void { handoff = patient }
export function takeHandedPatient(facilityId: string): PatientHandoff | null {
  const taken = handoff
  handoff = null
  return taken && taken.facilityId === facilityId ? taken : null
}
