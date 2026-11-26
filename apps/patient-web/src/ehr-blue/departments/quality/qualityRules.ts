import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime, formatTime, lagosClock, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  QualityActionStatus, QualityHistoryEntry, QualityIncidentCard, QualityLists, QualityMe, QualityPatient, QualityStatus, QualityTold,
} from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'

/*
 * Quality and safety reporting (hid-system QUAL-1, migrations 0197 and 0198; INTERFACE_CONTRACT.md "QUAL-1") in plain
 * words: who may do what, what each status, list entry and step is called, the Lagos day and time of every moment
 * whatever the device's zone, the form's limits and what each refusal says. The backend decides every request; these
 * only choose what the pages offer. Built at the recommended option of each open question (Q-QUAL-1 to Q-QUAL-8, not
 * yet answered by the owner). The category list and harm scale are a DRAFT for the clinical lead; their words come from
 * the backend (route 1), and the words below are only for a code a list no longer names.
 */

export const TITLE = 'Quality & Safety'
export const EYEBROW = 'Administration'
export const DESCRIPTION = 'Report incidents and near misses, and follow each one until it is resolved.'
export const BASE = '/provider/quality'

/** QUAL-1's two codes (0198). A named quality lead holds only report: route 1's isManager says they manage. */
export const QUALITY_REPORT = 'quality.incident.report'
export const QUALITY_MANAGE = 'quality.incident.manage'
export const canReport = (permissions: readonly string[]) => permissions.includes(QUALITY_REPORT)

export const NOT_AVAILABLE = 'Quality and safety reporting is not switched on yet.'
export const NOT_ALLOWED = 'Only staff of this facility can report incidents.'
export const MANAGER_ONLY = 'Only this facility’s quality leads and administrators can do this.'
export const LEADS_ADMIN_ONLY = 'Only this facility’s administrators can name or remove quality leads.'
export const REVIEWER_ONLY = 'Only the reviewer of this incident or a quality lead can do this.'
export const DRAFT_LIST = 'Draft list, awaiting clinical sign-off'
export const GUIDANCE = 'Write what happened, not who is to blame. Do not write any patient’s or colleague’s name or Health ID.'
export const CONFIDENTIAL = 'Confidential. Only quality leads and administrators see who reported this.'
export const INTERNAL_RECORD = 'Internal quality-improvement record.'
export const LINK_OFF = 'Linking a patient is not switched on yet. Report without the patient, and do not write their name.'
export const LINK_REFUSED = 'Only a patient of this facility can be linked. Report without the patient, and do not write their name. A quality lead can link the patient later.'
export const NOT_FOUND = 'This incident report is not available.'

// ---- Statuses -----------------------------------------------------------------------

export const STATUSES: readonly QualityStatus[] = ['reported', 'assigned', 'investigated', 'resolved']
export const STATUS_WORDS: Readonly<Record<QualityStatus, string>> = {
  reported: 'Reported',
  assigned: 'Assigned',
  investigated: 'Investigated',
  resolved: 'Resolved',
}
export function statusText(status: string | null | undefined): string {
  return status && Object.hasOwn(STATUS_WORDS, status) ? STATUS_WORDS[status as QualityStatus] : 'Not known'
}
export function statusTone(status: QualityStatus): EhrBadgeTone {
  return status === 'resolved' ? 'positive' : status === 'reported' ? 'caution' : 'brand'
}

export const ACTION_STATUS_WORDS: Readonly<Record<QualityActionStatus, string>> = { open: 'Open', done: 'Done', cancelled: 'Cancelled' }
export function actionStatusText(status: string): string {
  return Object.hasOwn(ACTION_STATUS_WORDS, status) ? ACTION_STATUS_WORDS[status as QualityActionStatus] : 'Not known'
}

export const TOLD_WORDS: Readonly<Record<QualityTold, string>> = { yes: 'Yes', no: 'No', not_applicable: 'Not applicable' }
export const TOLD_VALUES: readonly QualityTold[] = ['yes', 'no', 'not_applicable']
export function toldText(value: string | null | undefined): string {
  return value && Object.hasOwn(TOLD_WORDS, value) ? TOLD_WORDS[value as QualityTold] : 'Not recorded'
}

// ---- The DRAFT lists ------------------------------------------------------------------

/**
 * The DRAFT words (QS-DRAFT-1) for a code the backend's list does not name (a report filed under an older list): the
 * screen otherwise shows route 1's words, which change only by a signed migration.
 */
const FALLBACK_CATEGORY_WORDS: Readonly<Record<string, string>> = {
  medication: 'Medication',
  patient_fall: 'Patient fall',
  identification_documentation: 'Patient identification or documentation',
  procedure_treatment: 'Clinical procedure or treatment',
  infection_control: 'Infection prevention and control',
  equipment_device: 'Equipment or medical device',
  blood_transfusion: 'Blood or transfusion',
  safety_security: 'Staff or patient safety and security',
  facility_environment: 'Facility and environment',
  other: 'Other',
}
const FALLBACK_HARM_WORDS: Readonly<Record<string, string>> = {
  near_miss: 'Near miss', no_harm: 'No harm', mild: 'Mild harm', moderate: 'Moderate harm', severe: 'Severe harm', death: 'Death',
}
/** Harm levels for which "patient or family told" is required (Q252 A), when the list does not say. */
const TOLD_REQUIRED_FALLBACK: ReadonlySet<string> = new Set(['moderate', 'severe', 'death'])

function words(code: string | null | undefined, fallback: Readonly<Record<string, string>>): string {
  if (!code) return ''
  if (Object.hasOwn(fallback, code)) return fallback[code]!
  const plain = code.replaceAll('_', ' ').trim()
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : ''
}
export function categoryText(code: string | null | undefined, lists?: QualityLists | null): string {
  return lists?.categories.find(entry => entry.code === code)?.label ?? words(code, FALLBACK_CATEGORY_WORDS)
}
export function harmText(code: string | null | undefined, lists?: QualityLists | null): string {
  return lists?.harmLevels.find(entry => entry.code === code)?.label ?? words(code, FALLBACK_HARM_WORDS)
}
/** Whether "patient or family told" must be answered at this harm level (Q252 A), by the list or the DRAFT rule. */
export function toldRequired(harmLevel: string, lists?: QualityLists | null): boolean {
  const entry = lists?.harmLevels.find(level => level.code === harmLevel)
  return entry ? entry.toldRequired : TOLD_REQUIRED_FALLBACK.has(harmLevel)
}
export function isDraft(lists: Pick<QualityLists, 'listStatus'> | null | undefined): boolean {
  return lists?.listStatus !== 'signed'
}

/** A department of the facility profile (0114) by code; an unknown code in plain words. */
export function departmentText(code: string | null | undefined): string {
  if (!code) return ''
  const known = DEPARTMENTS.find(([value]) => value === code)
  return known ? known[1] : words(code, {})
}
/** Where it happened: the department, the place in words, or both. */
export function placeText(card: { readonly departmentCode: string | null; readonly locationText?: string | null }): string {
  return [departmentText(card.departmentCode), card.locationText?.trim() ?? ''].filter(Boolean).join(': ') || 'Not recorded'
}

// ---- Who and when ---------------------------------------------------------------------

/** "You" for the session's own membership; another member's name from SX-9, never their id. */
export function memberText(membershipId: string | null | undefined, own: string | undefined,
  names: ReadonlyMap<string, string | null>, none = 'No one yet'): string {
  if (!membershipId) return none
  if (own && membershipId.toLowerCase() === own.toLowerCase()) return 'You'
  const id = membershipId.toLowerCase()
  if (!names.has(id)) return 'A staff member here'
  return names.get(id) ?? 'Former staff member'
}

/** "3 Dec 2026, 09:10" in Lagos whatever the device's zone (@hid/ui/display, P2-4). */
export const whenText = (iso: string | null | undefined) => formatDateTime(iso)
/** "3 Dec 2026": a calendar day the server names (a due date), as written. */
export const dayText = (day: string | null | undefined) => formatDate(day)
/** "Dec 2026" for a month "2026-12". */
export function monthText(month: string): string {
  return formatDate(`${month}-01`).replace(/^1 /, '')
}

/** This Lagos month ("2026-12") and the twelve before it, newest first: the counts page's choices. */
export function recentMonths(now: Date = new Date(), count = 13): string[] {
  const clock = lagosClock(now)
  if (!clock) return []
  const months: string[] = []
  let { year, month } = clock
  for (let index = 0; index < count; index += 1) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month === 0) { month = 12; year -= 1 }
  }
  return months
}

/** The Lagos day and time now, to start the form at ("2026-12-03", "09:10"). */
export function lagosNow(now: Date = new Date()): { readonly day: string; readonly time: string } {
  return { day: lagosDay(now), time: formatTime(now) }
}

/** The moment a Lagos day and time typed on the form name (Lagos is UTC+1 all year), or null when either is not one. */
export function occurredMoment(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const moment = new Date(`${day}T${time}:00.000+01:00`)
  return Number.isNaN(moment.getTime()) || lagosDay(moment) !== day ? null : moment.toISOString()
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Route 2's rule: up to 365 days ago, and not in the future (up to 2 minutes ahead is taken as now). */
export function occurredProblem(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Enter the day and the time it happened.'
  const at = Date.parse(iso)
  if (at - now.getTime() > 2 * 60 * 1000 || now.getTime() - at > 365 * DAY_MS) return REFUSALS.QUALITY_TIME_INVALID!
  return ''
}

/** A due date's limits (route 7): today to a year ahead, Lagos days. */
export function dueDateLimits(now: Date = new Date()): { readonly min: string; readonly max: string } {
  return { min: lagosDay(now), max: lagosDay(now.getTime() + 365 * DAY_MS) }
}
export function dueDateProblem(day: string, now: Date = new Date()): string {
  const { min, max } = dueDateLimits(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < min || day > max) return REFUSALS.QUALITY_DUE_DATE_INVALID!
  return ''
}

// ---- Field limits ------------------------------------------------------------------------

// Control characters, which the server refuses in the title.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** A text's problem by its trimmed length, or '' when it is fine (optional texts may be left empty). */
export function lengthProblem(value: string, min: number, max: number, what: string, optional = false): string {
  const length = value.trim().length
  if (length === 0) return optional ? '' : `Enter ${what}.`
  if (length < min) return `Write at least ${min} characters.`
  if (length > max) return `Keep it to ${max} characters.`
  return ''
}
export function titleProblem(value: string): string {
  return lengthProblem(value, 3, 120, 'a short title') || (CONTROL.test(value.trim()) ? 'Use letters, numbers and punctuation only.' : '')
}
export function reasonProblem(value: string): string {
  const length = value.trim().length
  if (length < 8) return 'Say why in at least 8 characters.'
  if (length > 500) return 'Keep the reason to 500 characters.'
  return ''
}
export const LIMITS = {
  title: [3, 120], description: [10, 4000], locationText: [2, 120], immediateAction: [2, 2000], findings: [10, 4000],
  actionDescription: [5, 500], note: [2, 500], resolution: [10, 2000], reason: [8, 500],
} as const

// ---- The patient ---------------------------------------------------------------------------

/** The name a manager sees: "Unknown patient U-0007" for an unknown record (0145), else the patient's name. */
export function patientName(patient: Pick<QualityPatient, 'fullName' | 'recordKind' | 'unknownLabel'>): string {
  if (patient.recordKind === 'unknown' && patient.unknownLabel) return `Unknown patient ${patient.unknownLabel}`
  return patient.fullName
}

/**
 * The patient a report was started from (Q-QUAL-2 A): a patient page passes it in the page's state, never in the
 * address, as `{ qualityPatient: { patientId, name } }`. Only its id is sent, and only while the link is switched on.
 */
export interface QualityPatientChoice { readonly patientId: string; readonly name: string }
export function patientFromState(state: unknown): QualityPatientChoice | null {
  const chosen = state && typeof state === 'object' ? (state as { qualityPatient?: unknown }).qualityPatient : undefined
  if (!chosen || typeof chosen !== 'object') return null
  const { patientId, name } = chosen as Record<string, unknown>
  return typeof patientId === 'string' && UUID.test(patientId) && typeof name === 'string' && name.trim()
    ? { patientId: patientId.toLowerCase(), name: name.trim() } : null
}
/** The page state that opens "Report an incident" with a patient (a patient's page passes it with navigate). */
export function reportStateFor(patient: QualityPatientChoice): { readonly qualityPatient: QualityPatientChoice } {
  return { qualityPatient: patient }
}

// ---- History ------------------------------------------------------------------------------

const HISTORY_WORDS: Readonly<Record<QualityHistoryEntry['kind'], string>> = {
  reported: 'Reported',
  patient_linked: 'Patient linked',
  assigned: 'Reviewer assigned',
  reassigned: 'Reviewer changed',
  investigation_recorded: 'Investigation recorded',
  investigation_amended: 'Investigation changed',
  action_added: 'Corrective action added',
  action_updated: 'Corrective action changed',
  resolved: 'Resolved',
  reopened: 'Reopened',
  corrected: 'Report corrected',
  patient_link_changed: 'Patient link changed',
}
export function historyKindText(kind: string): string {
  return Object.hasOwn(HISTORY_WORDS, kind) ? HISTORY_WORDS[kind as QualityHistoryEntry['kind']] : 'Changed'
}

const CHANGE_FIELDS: Readonly<Record<string, string>> = {
  category: 'Category', harmLevel: 'Harm', departmentCode: 'Department', locationText: 'Where exactly', patientOrFamilyTold: 'Patient or family told',
  reviewerMembershipId: 'Reviewer', status: 'Status', ownerMembershipId: 'Owner', dueDate: 'Due', patientLinked: 'Patient linked',
}

/**
 * A history entry's coded changes in words ("Harm: No harm to Moderate harm"), never an id or a patient: a member is
 * named from SX-9, and a patient-link change says only that the link was set, changed or cleared.
 */
export function changeLines(entry: QualityHistoryEntry, lists: QualityLists | null, own: string | undefined,
  names: ReadonlyMap<string, string | null>): string[] {
  if (entry.kind === 'patient_linked' || entry.kind === 'patient_link_changed') return []
  const lines: string[] = []
  for (const [field, change] of Object.entries(entry.changes ?? {})) {
    if (!Object.hasOwn(CHANGE_FIELDS, field) || !change || typeof change !== 'object') continue
    const show = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return 'none'
      const text = String(value)
      if (field === 'category') return categoryText(text, lists)
      if (field === 'harmLevel') return harmText(text, lists)
      if (field === 'departmentCode') return departmentText(text)
      if (field === 'patientOrFamilyTold') return toldText(text)
      if (field === 'reviewerMembershipId' || field === 'ownerMembershipId') return memberText(text, own, names)
      if (field === 'status') return Object.hasOwn(ACTION_STATUS_WORDS, text) ? actionStatusText(text) : statusText(text)
      if (field === 'dueDate') return dayText(text) || text
      if (field === 'patientLinked') return value === true ? 'yes' : 'no'
      return text
    }
    lines.push(`${CHANGE_FIELDS[field]}: ${show(change.from)} to ${show(change.to)}`)
  }
  return lines
}

/** What a patient-link entry says: that the link was set, changed or cleared, never who. */
export function patientLinkLine(entry: QualityHistoryEntry): string {
  if (entry.kind === 'patient_linked') return 'A patient was linked.'
  if (entry.kind !== 'patient_link_changed') return ''
  const change = entry.changes?.patientLinked ?? entry.changes?.patientId
  if (change && (change.to === null || change.to === false)) return 'The patient link was cleared.'
  if (change && (change.from === null || change.from === false)) return 'A patient was linked.'
  return 'The linked patient was changed.'
}

// ---- Steps --------------------------------------------------------------------------------

/** Whether any step is open to this member on this card. */
export function anyStep(card: Pick<QualityIncidentCard, 'can'>): boolean {
  const can = card.can ?? {}
  return Boolean(can.assign || can.investigate || can.addAction || can.resolve || can.reopen || can.correct)
}

// ---- Refusals ------------------------------------------------------------------------------

/** Whether a refusal says the routes are not served here (an ehr-api before 0197, or the flag off). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'QUALITY_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('QUALITY_')
}

/** Every refusal the contract names, in its own words (never "permission"). */
export const REFUSALS: Readonly<Record<string, string>> = {
  QUALITY_NOT_AVAILABLE: NOT_AVAILABLE,
  QUALITY_PATIENT_LINK_NOT_AVAILABLE: LINK_OFF,
  QUALITY_NOT_ALLOWED: NOT_ALLOWED,
  QUALITY_MANAGER_ONLY: MANAGER_ONLY,
  QUALITY_LEADS_ADMIN_ONLY: LEADS_ADMIN_ONLY,
  QUALITY_REVIEWER_ONLY: REVIEWER_ONLY,
  QUALITY_PATIENT_LINK_REFUSED: LINK_REFUSED,
  QUALITY_INCIDENT_NOT_FOUND: NOT_FOUND,
  QUALITY_ACTION_NOT_FOUND: 'This action is not available.',
  QUALITY_LEAD_NOT_FOUND: 'This quality lead is not available.',
  QUALITY_INCIDENT_RESOLVED: 'This incident is resolved. Reopen it first.',
  QUALITY_STATUS_INVALID: 'This step is not possible at the incident’s current stage.',
  QUALITY_ACTIONS_OPEN: 'Mark every corrective action done or cancelled before resolving.',
  QUALITY_ACTION_LIMIT: 'An incident can have up to 20 corrective actions.',
  QUALITY_LEAD_EXISTS: 'This staff member is already a quality lead.',
  QUALITY_LEAD_LIMIT: 'A facility can have up to 10 quality leads.',
  QUALITY_LEAD_ENDED: 'This quality lead has already been removed.',
  QUALITY_TOLD_REQUIRED: 'For moderate harm, severe harm or death, say whether the patient or family was told.',
  QUALITY_LOCATION_REQUIRED: 'Say where it happened: choose a department, describe the place, or both.',
  QUALITY_TIME_INVALID: 'The time it happened can be up to a year ago, and not in the future.',
  QUALITY_DEPARTMENT_INVALID: 'Choose one of this facility’s departments.',
  QUALITY_CATEGORY_INVALID: 'Choose a category from the list.',
  QUALITY_HARM_LEVEL_INVALID: 'Choose how much harm was done from the list.',
  QUALITY_REVIEWER_INVALID: 'Choose a reviewer who works at this facility.',
  QUALITY_ACTION_OWNER_INVALID: 'Choose a staff member of this facility to own this action.',
  QUALITY_DUE_DATE_INVALID: 'Choose a due date from today up to a year ahead.',
  QUALITY_LEAD_INVALID: 'Choose a staff member who works at this facility.',
  QUALITY_NOTHING_TO_CHANGE: 'Change at least one thing.',
  QUALITY_REASON_REQUIRED: 'Say why in at least 8 characters.',
  QUALITY_MONTH_INVALID: 'Choose a month that has started.',
  QUALITY_LIST_CURSOR_INVALID: 'This page of the list can no longer be opened. Start the list again.',
  QUALITY_VERSION_CONFLICT: 'Someone else changed this incident. Reload it and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong. Reload the page and try again.',
  PURPOSE_OF_USE_REQUIRED: 'Something went wrong. Reload the page and try again.',
}

/** Refusals after which the incident is read again at once: the card on screen is out of date. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['QUALITY_VERSION_CONFLICT', 'QUALITY_INCIDENT_RESOLVED', 'QUALITY_STATUS_INVALID',
  'QUALITY_ACTIONS_OPEN', 'QUALITY_REVIEWER_ONLY', 'QUALITY_MANAGER_ONLY'])

/**
 * A refusal in plain words: the contract's own, "not switched on yet" for an ehr-api without it, the request's meaning
 * for a 400 VALIDATION_FAILED, and a guard's 403 as "only staff of this facility". Never the word the guard uses.
 */
export function refusalWords(caught: unknown, fallback: string, invalid?: string): string {
  if (!isHidApiError(caught)) return fallback
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(REFUSALS, caught.code)) return REFUSALS[caught.code]!
  if (caught.code === 'VALIDATION_FAILED') return invalid ?? 'Check the highlighted fields.'
  if (caught.status === 403) return NOT_ALLOWED
  if (caught.status === 0 || caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT') return 'No connection. Check your internet and try again.'
  return fallback
}

export const cancelled = (caught: unknown) => isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED'

// ---- Served ---------------------------------------------------------------------------------
// Learned from the backend's own answers, in memory for the page's life: a read answering 404 (an ehr-api before 0197)
// or 503 QUALITY_NOT_AVAILABLE (the flag is off) says not served, only while nothing has said otherwise; any answer
// says served, once and for all. Until then null, and the page is listed for whoever holds the code.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnQualityServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function qualityServed(): Served { return served }
export function subscribeQualityServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useQualityServed(): Served {
  return useSyncExternalStore(subscribeQualityServed, qualityServed, qualityServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetQualityServed(): void {
  served = null
  changed()
}

/** Records what an answer or a refusal says about whether quality reporting is served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnQualityServed(true); return }
  if (notServed(caught)) learnQualityServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnQualityServed(true)
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newKey(): string {
  return crypto.randomUUID()
}

/** Whether this answer of route 1 lets the member manage (a holder of manage, or a named lead). */
export const manages = (me: Pick<QualityMe, 'isManager'> | null | undefined) => Boolean(me?.isManager)
