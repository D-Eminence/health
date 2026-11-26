import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatTime, formatWeekday, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  DutyEntry, DutyRoster, LeaveRequest, LeaveType, RosterAssignment, RosterShift, RosterUnavailable,
} from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'

/*
 * The duty roster and leave (hid-system ROS-1, migrations 0200-0202; INTERFACE_CONTRACT.md "ROS-1") in plain words: who
 * may do what, what each status is called, the Lagos day and time of every duty whatever the device's zone, and what
 * each refusal says. The backend decides every request; these only choose what the pages offer.
 *
 * Built on the owner's answers of 25 Nov 2026 (Q242-Q247 A, Q193 A) and at the recommended option of Q-ROS-8 to
 * Q-ROS-15 (not yet answered by the owner): in-charges named per department, published rosters seen by every staff role,
 * a published roster changed until each shift starts, no free text anywhere.
 */

export const TITLE = 'Duty roster'
export const BASE = '/provider/duty-roster'
export const DESCRIPTION = 'Who works which shift in each department, week by week, and leave.'

/** The three codes of 0201. HR & Credentials keeps workforce.manage. */
export const ROSTER_READ = 'workforce.roster.read'
export const ROSTER_MANAGE = 'workforce.roster.manage'
export const LEAVE_REQUEST = 'workforce.leave.request'

export const canRead = (permissions: readonly string[]) => permissions.includes(ROSTER_READ)
export const canManage = (permissions: readonly string[]) => permissions.includes(ROSTER_MANAGE)
export const canAskLeave = (permissions: readonly string[]) => permissions.includes(LEAVE_REQUEST)

export const NOT_AVAILABLE = 'The duty roster and leave are not switched on yet.'
export const NOT_AVAILABLE_MORE = 'Health ID will switch them on for your facility once they are ready. Until then, keep using '
  + 'the paper roster and leave book.'
export const READ_REFUSED = 'Only staff of this facility can see its duty roster.'
export const EDIT_REFUSED = 'Only the department’s in-charge or an administrator can change this roster.'
export const IN_CHARGE_REFUSED = 'Only the facility’s administrators can choose who is in charge of a department.'
export const LEAVE_REFUSED = 'Leave requests are not open to your role here. Ask the administrator.'
export const DECIDE_REFUSED = 'Only the department’s in-charge or an administrator can approve or decline this leave.'
export const OWN_DECISION = 'Someone else must approve or decline your own leave.'
export const OWN_ATTENDANCE = 'Another in-charge or an administrator marks your own attendance.'
export const CONNECTION = 'Couldn’t reach Health ID. Check the connection and try again.'

// ---- Words ---------------------------------------------------------------------

/** A department code in the facility profile's words (contract section 43.6); one it does not know, in plain words. */
export function departmentText(code: string | null | undefined): string {
  if (!code) return 'No department'
  const known = DEPARTMENTS.find(([value]) => value === code)
  if (known) return known[1]
  const words = code.replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Department not known'
}

export const LEAVE_TYPES: readonly LeaveType[] = ['annual', 'sick', 'maternity', 'study', 'other']
export const LEAVE_TYPE_WORDS: Readonly<Record<LeaveType, string>> = {
  annual: 'Annual leave', sick: 'Sick leave', maternity: 'Maternity leave', study: 'Study leave', other: 'Other leave',
}
/** The type in words; a type not answered (it is only for the requester and the deciders) says nothing of it. */
export function leaveTypeText(type: string | null | undefined): string {
  return type && Object.hasOwn(LEAVE_TYPE_WORDS, type) ? LEAVE_TYPE_WORDS[type as LeaveType] : 'Leave'
}

const LEAVE_STATUS_WORDS: Readonly<Record<string, string>> = {
  requested: 'Waiting for a decision', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled',
}
export function leaveStatusText(status: string): string {
  return LEAVE_STATUS_WORDS[status] ?? 'Status not known'
}
export function leaveStatusTone(status: string): EhrBadgeTone {
  return status === 'approved' ? 'positive' : status === 'requested' ? 'caution' : 'neutral'
}

const ATTENDANCE_WORDS: Readonly<Record<string, string>> = {
  not_marked: 'Not marked', present: 'Present', absent: 'Absent', swapped: 'Swapped',
}
export function attendanceText(attendance: string): string {
  return ATTENDANCE_WORDS[attendance] ?? 'Not marked'
}
export function attendanceTone(attendance: string): EhrBadgeTone {
  return attendance === 'present' ? 'positive' : attendance === 'absent' ? 'critical' : attendance === 'swapped' ? 'caution' : 'neutral'
}

/** A roster's state, as the list and the roster say it. */
export function rosterStatusText(status: string, changedSincePublished = false): string {
  if (status === 'published') return changedSincePublished ? 'Changed since published' : 'Published'
  if (status === 'draft') return 'Draft'
  if (status === 'none') return 'No roster yet'
  return 'Status not known'
}
export function rosterStatusTone(status: string, changedSincePublished = false): EhrBadgeTone {
  if (status === 'published') return changedSincePublished ? 'caution' : 'positive'
  return status === 'draft' ? 'brand' : 'neutral'
}

/** The minimum rest, as the roster says it: draft until the clinical lead signs a value (Q124 A pattern). */
export function ruleText(rules: DutyRoster['rules']): string {
  const hours = `At least ${rules.minRestHours} hour${rules.minRestHours === 1 ? '' : 's'} between duties`
  return rules.status === 'draft' ? `${hours} (draft, awaiting the clinical lead)` : hours
}

/** Who someone is: "You" for the session's own membership; their name when SX-9 gives one; never an id. */
export function personText(membershipId: string | null | undefined, names: ReadonlyMap<string, string | null>, me?: string): string {
  if (!membershipId) return 'Nobody named'
  if (me && membershipId.toLowerCase() === me.toLowerCase()) return 'You'
  const name = names.get(membershipId.toLowerCase())
  return name ?? (name === null ? 'Former staff member' : 'A staff member here')
}

// ---- Lagos days and weeks --------------------------------------------------------
// Every roster day is a Lagos calendar day and every week starts on a Monday in Lagos (UTC+1 all year), whatever the
// device's zone. Times are shown through @hid/ui/display.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function lagosToday(now: Date | number = Date.now()): string {
  return lagosDay(now)
}

/** The day `count` days after (or before) a calendar day. */
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Whole days from one calendar day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000)
}

/** The Monday of a calendar day's week. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

export function thisWeek(now: Date | number = Date.now()): string {
  return mondayOf(lagosToday(now))
}

/** The seven days of a week, Monday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

/** A roster may be made from 8 weeks ago to 26 weeks ahead (ROSTER_WEEK_INVALID otherwise). */
export function weekInRange(weekStart: string, today = lagosToday()): boolean {
  if (!isDay(weekStart) || mondayOf(weekStart) !== weekStart) return false
  const offset = daysBetween(mondayOf(today), weekStart) / 7
  return offset >= -8 && offset <= 26
}

/** "Monday 7 Dec 2026". */
export function dayText(day: string): string {
  return isDay(day) ? `${formatWeekday(day)} ${formatDate(day)}` : ''
}

/** "7 Dec 2026 to 13 Dec 2026": a roster's week. */
export function weekText(weekStart: string): string {
  return isDay(weekStart) ? `${formatDate(weekStart)} to ${formatDate(addDays(weekStart, 6))}` : ''
}

/** The moment a Lagos day and clock time ("07:30") stand for, as ISO UTC; null when either is not one. */
export function lagosMoment(day: string, clock: string): string | null {
  if (!isDay(day) || !CLOCK_PATTERN.test(clock)) return null
  const moment = new Date(`${day}T${clock}:00+01:00`)
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString()
}

/** Whether a shift runs past midnight into the next day. */
export function crossesMidnight(shift: Pick<RosterShift, 'startsAt' | 'endsAt'>): boolean {
  return CLOCK_PATTERN.test(shift.startsAt) && CLOCK_PATTERN.test(shift.endsAt) && shift.endsAt <= shift.startsAt
}

/** "07:30 to 14:30", or "20:30 to 08:00 next day": a clinical shift's Lagos times. */
export function shiftTimes(shift: Pick<RosterShift, 'startsAt' | 'endsAt'>): string {
  const from = formatTime(lagosMoment('2026-01-05', shift.startsAt))
  const to = formatTime(lagosMoment('2026-01-05', shift.endsAt))
  if (!from || !to) return ''
  return `${from} to ${to}${crossesMidnight(shift) ? ' next day' : ''}`
}

/** When a duty on `dutyDate` of `shift` starts and ends (the shift's Lagos times; a night shift ends the next day). */
export function dutyWindow(dutyDate: string, shift: Pick<RosterShift, 'startsAt' | 'endsAt'>): { start: number; end: number } | null {
  const start = lagosMoment(dutyDate, shift.startsAt)
  const end = lagosMoment(crossesMidnight(shift) ? addDays(dutyDate, 1) : dutyDate, shift.endsAt)
  if (!start || !end) return null
  return { start: Date.parse(start), end: Date.parse(end) }
}

/** Whether a duty's shift has started: then it is neither added nor removed, only its attendance changes. */
export function dutyStarted(dutyDate: string, shift: Pick<RosterShift, 'startsAt' | 'endsAt'> | undefined, now = Date.now()): boolean {
  const window = shift ? dutyWindow(dutyDate, shift) : null
  return window !== null && window.start <= now
}

/** "09:00 to 14:30" in Lagos: a duty's or on-duty line's times, from its ISO moments. */
export function timeRangeText(item: { startsAt: string; endsAt: string }): string {
  const from = formatTime(item.startsAt)
  const to = formatTime(item.endsAt)
  if (!from || !to) return from
  return lagosDay(item.startsAt) === lagosDay(item.endsAt) ? `${from} to ${to}` : `${from} to ${to} next day`
}

/** Attendance is marked from 1 hour before the shift starts to 7 days after it ends (ATTENDANCE_NOT_OPEN otherwise). */
export function attendanceOpen(assignment: Pick<RosterAssignment, 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
  const start = Date.parse(assignment.startsAt)
  const end = Date.parse(assignment.endsAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  return now >= start - 60 * 60_000 && now <= end + 7 * 86_400_000
}

// ---- The roster being edited ------------------------------------------------------

/** One duty's identity: the same person, shift and day is the same duty. */
export function entryKey(entry: DutyEntry): string {
  return `${entry.membershipId.toLowerCase()}|${entry.shiftId.toLowerCase()}|${entry.dutyDate}`
}

export function entriesOf(roster: Pick<DutyRoster, 'assignments'>): DutyEntry[] {
  return roster.assignments.map(({ membershipId, shiftId, dutyDate }) => ({ membershipId, shiftId, dutyDate }))
}

/** Whether two lists hold the same duties, in any order. */
export function sameEntries(a: readonly DutyEntry[], b: readonly DutyEntry[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map(entryKey))
  return b.every(entry => keys.has(entryKey(entry)))
}

/** Leave that day for one person, as editors are told it (never the type); null when none. */
export function leaveOn(unavailable: readonly RosterUnavailable[], membershipId: string, day: string): 'leave_approved' | 'leave_requested' | null {
  const id = membershipId.toLowerCase()
  const found = unavailable.filter(item => item.membershipId.toLowerCase() === id && item.from <= day && day <= item.to)
  if (found.some(item => item.kind === 'leave_approved')) return 'leave_approved'
  return found.length > 0 ? 'leave_requested' : null
}

export function leaveKindText(kind: string): string {
  return kind === 'leave_approved' ? 'On leave' : 'Leave requested'
}

export type DutyClash = { kind: 'overlap' | 'rest'; entry: DutyEntry }

/**
 * The first clash among one roster's duties, as the database would refuse it (ROSTER_OVERLAP, ROSTER_REST_TOO_SHORT),
 * for one person: two duties that overlap, or one that starts less than the minimum rest after the one before ends.
 * The database also checks every other department's rosters; this only spares a request that would be refused.
 */
export function firstClash(entries: readonly DutyEntry[], shifts: readonly RosterShift[], minRestHours: number): DutyClash | null {
  const byShift = new Map(shifts.map(shift => [shift.shiftId.toLowerCase(), shift]))
  const byPerson = new Map<string, Array<{ entry: DutyEntry; start: number; end: number }>>()
  for (const entry of entries) {
    const shift = byShift.get(entry.shiftId.toLowerCase())
    const window = shift ? dutyWindow(entry.dutyDate, shift) : null
    if (!window) continue
    const id = entry.membershipId.toLowerCase()
    byPerson.set(id, [...byPerson.get(id) ?? [], { entry, ...window }])
  }
  const rest = minRestHours * 60 * 60_000
  for (const duties of byPerson.values()) {
    duties.sort((a, b) => a.start - b.start)
    for (let index = 1; index < duties.length; index += 1) {
      const before = duties[index - 1]!
      const next = duties[index]!
      if (next.start < before.end) return { kind: 'overlap', entry: next.entry }
      if (next.start - before.end < rest) return { kind: 'rest', entry: next.entry }
    }
  }
  return null
}

// ---- Leave -----------------------------------------------------------------------

/** "14 Dec 2026 to 18 Dec 2026 (5 days)". */
export function leaveDatesText(request: Pick<LeaveRequest, 'startsOn' | 'endsOn' | 'days'>): string {
  const days = `${request.days} day${request.days === 1 ? '' : 's'}`
  return request.startsOn === request.endsOn ? `${formatDate(request.startsOn)} (${days})`
    : `${formatDate(request.startsOn)} to ${formatDate(request.endsOn)} (${days})`
}

export const LEAVE_DATES_RULE = 'Leave can start up to 30 days ago, must end on or after its start, and can last up to 365 days.'

/** Why leave dates can't be sent, as the server would refuse them (LEAVE_DATES_INVALID); null when they can. */
export function leaveDatesProblem(startsOn: string, endsOn: string, today = lagosToday()): string | null {
  if (!isDay(startsOn) || !isDay(endsOn)) return 'Choose the first and last day of the leave.'
  if (daysBetween(today, startsOn) < -30 || endsOn < startsOn || daysBetween(startsOn, endsOn) > 365) return LEAVE_DATES_RULE
  return null
}

/** Cancel is offered before a decision, or for approved leave before it starts (LEAVE_CANCEL_NOT_ALLOWED otherwise). */
export function cancelOffered(request: Pick<LeaveRequest, 'status' | 'startsOn'>, today = lagosToday()): boolean {
  return request.status === 'requested' || (request.status === 'approved' && request.startsOn > today)
}

// ---- Refusals ---------------------------------------------------------------------

/** The refusals in the contract's words, which never name a permission. */
const REFUSALS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the details and try again.',
  DEPARTMENT_INVALID: 'Choose one of this facility’s departments.',
  IN_CHARGE_MEMBER_INVALID: 'Choose a staff member who works at this facility.',
  ROSTER_MEMBER_INVALID: 'Choose a staff member who works at this facility.',
  LEAVE_DATES_INVALID: LEAVE_DATES_RULE,
  ROSTER_WEEK_INVALID: 'Choose a week that starts on a Monday, from 8 weeks ago to 26 weeks ahead.',
  ROSTER_SHIFT_INVALID: 'Choose one of this facility’s shifts.',
  ROSTER_DATE_OUTSIDE_WEEK: 'Choose a day in this roster’s week.',
  ATTENDANCE_COVER_INVALID: 'Choose who worked this shift instead: someone else who works at this facility.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong sending this. Reload the page and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This form was already sent with other details. Reload the page and try again.',
  DUTY_ROSTER_NOT_ALLOWED: READ_REFUSED,
  DUTY_ROSTER_EDIT_NOT_ALLOWED: EDIT_REFUSED,
  IN_CHARGE_SETUP_NOT_ALLOWED: IN_CHARGE_REFUSED,
  LEAVE_REQUEST_NOT_ALLOWED: LEAVE_REFUSED,
  LEAVE_DECISION_NOT_ALLOWED: DECIDE_REFUSED,
  FACILITY_STAFF_NOT_FOUND: 'This person does not work at this facility.',
  IN_CHARGE_NOT_FOUND: 'This record is not at this facility.',
  LEAVE_REQUEST_NOT_FOUND: 'This record is not at this facility.',
  ROSTER_NOT_FOUND: 'This record is not at this facility.',
  ROSTER_ASSIGNMENT_NOT_FOUND: 'This record is not at this facility.',
  IN_CHARGE_ALREADY: 'This person is already in charge of this department.',
  IN_CHARGE_LIMIT_REACHED: 'A department can have up to 5 people in charge.',
  LEAVE_OVERLAPS: 'You already asked for leave on some of these days.',
  LEAVE_ALREADY_DECIDED: 'This leave request was already approved, declined or cancelled.',
  LEAVE_OWN_DECISION_NOT_ALLOWED: OWN_DECISION,
  LEAVE_CANCEL_NOT_ALLOWED: 'Approved leave can be cancelled only before it starts. Ask your in-charge.',
  LEAVE_CLASHES_WITH_ROSTER: 'This person is on the roster during this leave. Take them off those duties first.',
  DUTY_ROSTER_NO_DEPARTMENTS: 'Add this facility’s departments to its profile first.',
  ROSTER_SHIFT_STARTED: 'Duties that have started cannot be changed. Mark attendance instead.',
  ROSTER_OVERLAP: 'This person is already on duty at that time.',
  ROSTER_MEMBER_ON_LEAVE: 'This person is on approved leave that day.',
  ROSTER_EMPTY: 'Add at least one duty before publishing.',
  ROSTER_NOT_PUBLISHED: 'Publish the roster before marking attendance.',
  ATTENDANCE_NOT_OPEN: 'Attendance can be marked from 1 hour before the shift starts until 7 days after it ends.',
  ATTENDANCE_OWN_NOT_ALLOWED: OWN_ATTENDANCE,
  VERSION_CONFLICT: 'Someone else changed this. Reload it and try again.',
  DUTY_ROSTER_NOT_AVAILABLE: NOT_AVAILABLE,
  // Identity's guards with their own text (which may name a permission), and a facility the session can't use.
  PERMISSION_DENIED: READ_REFUSED,
  FACILITY_ACCESS_DENIED: READ_REFUSED,
}

export function restText(hours: number): string {
  return `This person needs at least ${hours} hour${hours === 1 ? '' : 's'} between duties.`
}

/** The roster's and leave's own 404s: any other 404 says the routes are not there. */
const OWN_NOT_FOUND = new Set(['FACILITY_STAFF_NOT_FOUND', 'IN_CHARGE_NOT_FOUND', 'LEAVE_REQUEST_NOT_FOUND', 'ROSTER_NOT_FOUND',
  'ROSTER_ASSIGNMENT_NOT_FOUND'])

/** Whether a refusal says the roster routes are not served here: an identity-api before ROS-1, or the flag off. */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'DUTY_ROSTER_NOT_AVAILABLE') return true
  return (caught.status === 404 || caught.status === 501) && !OWN_NOT_FOUND.has(caught.code)
}

/** After these the card on screen is out of date: it is read again. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['VERSION_CONFLICT', 'LEAVE_ALREADY_DECIDED'])

/** A refusal in plain words: the contract's own, else `fallback`. `minRestHours` says the rule in force. */
export function refusalWords(caught: unknown, fallback: string, minRestHours = 8): string {
  if (!isHidApiError(caught)) return fallback
  if (caught.code === 'REQUEST_CANCELLED') return ''
  if (notServed(caught)) return NOT_AVAILABLE
  if (caught.code === 'ROSTER_REST_TOO_SHORT') return restText(minRestHours)
  if (Object.hasOwn(REFUSALS, caught.code)) return REFUSALS[caught.code]!
  if (caught.status === 403) return READ_REFUSED
  if (caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT' || caught.status === 0) return CONNECTION
  return fallback
}

/** The first duty a roster refusal names ({ membershipId, dutyDate, shiftId }), when it names one. */
export function refusedDuty(caught: unknown): DutyEntry | null {
  if (!isHidApiError(caught) || !caught.details || typeof caught.details !== 'object') return null
  const { membershipId, dutyDate, shiftId } = caught.details as Record<string, unknown>
  return typeof membershipId === 'string' && typeof dutyDate === 'string' && typeof shiftId === 'string'
    ? { membershipId, dutyDate, shiftId } : null
}

/** The days a leave approval clashes with (LEAVE_CLASHES_WITH_ROSTER's details { dates }). */
export function clashDates(caught: unknown): string[] {
  if (!isHidApiError(caught) || !caught.details || typeof caught.details !== 'object') return []
  const { dates } = caught.details as Record<string, unknown>
  return Array.isArray(dates) ? dates.filter((day): day is string => typeof day === 'string' && isDay(day)) : []
}

/** A roster's id as the address carries it: a UUID, never a Health ID or a name. */
export const ROSTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fresh Idempotency-Key for one form; the same key is sent again when the same form is retried. */
export function newKey(): string {
  return crypto.randomUUID()
}

// ---- Whether Health ID serves the roster at this facility ---------------------------------
// Learned from the backend's own answers, per facility, in memory for the page's life (as appointments learn theirs): a
// read answering 404 (an identity-api before ROS-1) or 503 DUTY_ROSTER_NOT_AVAILABLE (the flag is off, which production
// keeps for every real facility until the owner's go-live) says not served, only while nothing has said otherwise; any
// other answer says served, once and for all. Until then null, and the page is listed.

type Served = boolean | null
const served = new Map<string, boolean>()
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function dutyRosterServed(facilityId: string | undefined): Served {
  return facilityId ? served.get(facilityId) ?? null : null
}
export function learnDutyRosterServed(facilityId: string, value: boolean): void {
  const known = served.get(facilityId)
  if (known === true || known === value) return
  served.set(facilityId, value)
  changed()
}
export function subscribeDutyRosterServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useDutyRosterServed(facilityId: string): Served {
  const read = () => dutyRosterServed(facilityId)
  return useSyncExternalStore(subscribeDutyRosterServed, read, read)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetDutyRosterServed(): void {
  served.clear()
  changed()
}

/** Records what an answer (no `caught`) or a refusal says about whether the roster is served at this facility. */
export function learnFrom(facilityId: string, caught?: unknown): void {
  if (caught === undefined) { learnDutyRosterServed(facilityId, true); return }
  if (notServed(caught)) learnDutyRosterServed(facilityId, false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnDutyRosterServed(facilityId, true)
  }
}
