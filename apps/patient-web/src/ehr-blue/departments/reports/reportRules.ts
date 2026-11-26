import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, lagosDay } from '@hid/ui/display'
import type {
  OperationsReport, PharmacyCannotCompleteReason, ReportFigure, ReportSection, ReportSectionKey,
} from '../../../staff/api'

/*
 * Reports & Analytics on hid-system REP-1 (migrations 0203 and 0204, provisional; EHR_PLANNED_CONTRACT.md "REP-1") in
 * plain words: who may read and download, what each figure is called and counts, the range of Lagos days a report covers
 * whatever the device's zone, how a figure compares with the period before, and what each refusal says. Totals only:
 * nothing here names a patient. The backend decides every request; these only choose what the page offers.
 */

export const TITLE = 'Reports & Analytics'
export const EYEBROW = 'Insight'
export const BASE = '/provider/reports'

/** REP-1's two codes (0204): the facility's administrators (admin, org_admin) hold both. */
export const REPORTS_READ = 'reports.read'
export const REPORTS_EXPORT = 'reports.export'
export const canReadReports = (permissions: readonly string[]) => permissions.includes(REPORTS_READ)
export const canExportReports = (permissions: readonly string[]) => canReadReports(permissions) && permissions.includes(REPORTS_EXPORT)

/** The roles 0204 gives the codes to: a session holding one of them without the code is on a backend before 0204. */
const REPORT_ROLES: ReadonlySet<string> = new Set(['admin', 'org_admin'])
export const holdsReportRole = (roles: readonly string[]) => roles.some(role => REPORT_ROLES.has(role))

export const DESCRIPTION = 'How busy this facility has been: its waiting list, registrations, visits, laboratory and pharmacy, day by day.'
export const SCOPE = 'This facility only. Days are Lagos days. Totals only: no patient is named.'
export const DRAFT = 'Figure definitions are awaiting clinical sign-off.'
export const SMALL_COUNTS = 'Counts from 1 to 4 are shown as fewer than 5.'
export const NOT_AVAILABLE = 'Reports are not available yet.'
export const EXPORT_NOT_AVAILABLE = 'Downloading reports is not available yet.'
export const READ_REFUSED = 'Only this facility’s administrators can see its reports.'
export const EXPORT_REFUSED = 'Only this facility’s administrators can download its reports.'
export const RANGE_INVALID = 'Choose a start date on or before the end date, ending today or earlier, within the last 2 years.'
export const RANGE_TOO_LONG = 'Choose a range of up to 92 days.'
export const TOO_SLOW = 'This report took too long. Try a shorter range, or try again later.'
export const NO_CONNECTION = 'No connection. Check your internet and try again.'
export const READ_FAILED = 'The report could not be loaded. Try again.'
export const DOWNLOAD_FAILED = 'The file could not be made. Try again.'

/** The longest range, both days included, and the range a report opens with (today included). */
export const MAX_DAYS = 92
export const DEFAULT_DAYS = 30
/** The figures a download hides below this count (the contract's minimumCount). */
export const MINIMUM_COUNT = 5

// ---- Lagos days ------------------------------------------------------------------------------------------------------

/** A day as the report's range holds it, "2026-11-18". */
const DAY = /^\d{4}-\d{2}-\d{2}$/
const two = (value: number) => String(value).padStart(2, '0')

/** Whether a value is a real calendar day ("2026-02-30" is not). */
export function isDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && DAY.test(value) && lagosDay(value) === value
}

function parts(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))]
}

/** The day `count` days after `day` (before, when negative), as calendar days: no zone moves it. */
export function addDays(day: string, count: number): string {
  const [year, month, date] = parts(day)
  const moved = new Date(Date.UTC(year, month - 1, date + count))
  return `${moved.getUTCFullYear()}-${two(moved.getUTCMonth() + 1)}-${two(moved.getUTCDate())}`
}

/** How many days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysIn(from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1)
}

/** The earliest day a report may start: the same day two years before today (28 Feb for a 29 Feb). */
export function earliestDay(today: string): string {
  const [year, month, date] = parts(today)
  const last = new Date(Date.UTC(year - 2, month, 0)).getUTCDate()
  return `${year - 2}-${two(month)}-${two(Math.min(date, last))}`
}

export interface DayRange { readonly from: string; readonly to: string }

/** The last `days` Lagos days, today included. */
export function lastDays(days: number, today: string = lagosDay()): DayRange {
  return { from: addDays(today, -(days - 1)), to: today }
}

/** What is wrong with a range, in the backend's words, or '' when it may be asked for. */
export function rangeProblem(range: DayRange, today: string = lagosDay()): string {
  if (!isDay(range.from) || !isDay(range.to)) return RANGE_INVALID
  if (range.from > range.to || range.to > today || range.from < earliestDay(today)) return RANGE_INVALID
  if (daysIn(range.from, range.to) > MAX_DAYS) return RANGE_TOO_LONG
  return ''
}

/** "1 Nov 2026 to 30 Nov 2026", or one day alone. */
export function rangeText(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`
}

/** "30 days", "1 day". */
export function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

// ---- Words -------------------------------------------------------------------------------------------------------------

export const SECTION_WORDS: Readonly<Record<ReportSectionKey, string>> = {
  waitingList: 'Waiting list',
  registrations: 'Registrations',
  visits: 'Visits',
  lab: 'Laboratory',
  pharmacy: 'Pharmacy',
}

interface FigureWords {
  /** The figure's name on screen and in a download. */
  readonly label: string
  /** What it counts, in one sentence (the draft definitions awaiting sign-off). */
  readonly counts: string
  /** What a median's sample is made of: "check-in" / "check-ins". */
  readonly sample?: readonly [string, string]
}

/** Every figure of the contract, in its section and order. A figure the page has no words for is not shown. */
export const FIGURES: Readonly<Record<ReportSectionKey, Readonly<Record<string, FigureWords>>>> = {
  waitingList: {
    checkedIn: { label: 'Patients checked in', counts: 'Every check-in on the waiting list.' },
    seen: { label: 'Seen by a clinician', counts: 'Check-ins that reached “With clinician”, or were closed as finished.' },
    leftWithoutBeingSeen: { label: 'Left without being seen', counts: 'Check-ins closed as left before ever reaching “With clinician”.' },
    cancelled: { label: 'Check-ins cancelled', counts: 'Check-ins closed as cancelled.' },
    medianWaitMinutes: { label: 'Median wait to see a clinician', counts: 'The middle wait from check-in to the first move to “With clinician”.',
      sample: ['check-in', 'check-ins'] },
  },
  registrations: {
    newHealthIds: { label: 'Registered with a new Health ID', counts: 'Registrations here that gave the patient a new Health ID.' },
    existingHealthIds: { label: 'Registered with an existing Health ID', counts: 'Registrations here of a patient who already had a Health ID.' },
  },
  visits: {
    opened: { label: 'Visits opened', counts: 'Visits started here, not imported from paper, cancelled or entered in error.' },
    completed: { label: 'Visits completed', counts: 'Visits completed here, not imported from paper.' },
  },
  lab: {
    requested: { label: 'Lab tests requested', counts: 'Lab requests made here that are active, on hold or completed.' },
    specimensCollected: { label: 'Samples collected', counts: 'Samples this laboratory collected, received or rejected.' },
    resultsReleased: { label: 'Results released', counts: 'Each result once, on the day it was first released.' },
    medianTurnaroundMinutes: { label: 'Median time from sample to result', counts: 'The middle time from a sample’s collection to its result’s first release.',
      sample: ['result', 'results'] },
  },
  pharmacy: {
    dispensed: { label: 'Prescriptions dispensed', counts: 'Dispensings by this pharmacy that were not reversed.' },
    dispensingsReversed: { label: 'Dispensings reversed', counts: 'Dispensings this pharmacy reversed.' },
    notCompleted: { label: 'Prescriptions this pharmacy could not complete', counts: 'Prescriptions sent here that this pharmacy said it could not complete, by reason.' },
  },
}

export const SECTION_ORDER: readonly ReportSectionKey[] = ['waitingList', 'registrations', 'visits', 'lab', 'pharmacy']

/** The eight reasons of 0091 for a prescription, in their order. */
export const REASON_WORDS: Readonly<Record<PharmacyCannotCompleteReason, string>> = {
  out_of_stock: 'Out of stock',
  medicine_unavailable: 'Medicine not available',
  needs_prescriber_review: 'Needs the prescriber’s review',
  controlled_requirements: 'Controlled medicine paperwork needed',
  cannot_meet_priority: 'Could not supply it in time',
  patient_declined: 'Patient chose not to go ahead',
  patient_did_not_return: 'Patient did not come back',
  other: 'Another reason',
}
export function reasonText(reason: string): string | null {
  return Object.hasOwn(REASON_WORDS, reason) ? REASON_WORDS[reason as PharmacyCannotCompleteReason] : null
}

export interface ShownFigure {
  readonly section: ReportSectionKey
  readonly figure: ReportFigure
  readonly words: FigureWords
}
export interface ShownSection {
  readonly key: ReportSectionKey
  readonly title: string
  readonly figures: readonly ShownFigure[]
}

/**
 * The report's sections and figures the page has words for, in the contract's order; anything else (a later figure, a
 * malformed entry) is left out rather than shown by its code.
 */
export function shownSections(report: Pick<OperationsReport, 'sections'>): ShownSection[] {
  const sections: readonly ReportSection[] = Array.isArray(report.sections) ? report.sections : []
  return SECTION_ORDER.flatMap(key => {
    const section = sections.find(candidate => candidate?.key === key)
    if (!section || !Array.isArray(section.figures)) return []
    const words = FIGURES[key]
    const figures = Object.keys(words).flatMap(figureKey => {
      const figure = section.figures.find(candidate => candidate?.key === figureKey)
      return figure && (figure.kind === 'count' || figure.kind === 'median_minutes')
        ? [{ section: key, figure: { ...figure, daily: Array.isArray(figure.daily) ? figure.daily : [] }, words: words[figureKey]! }] : []
    })
    return figures.length ? [{ key, title: SECTION_WORDS[key], figures }] : []
  })
}

/** Whether an answer is a report the page can show at all. */
export function isReport(value: unknown): value is OperationsReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<OperationsReport>
  return isDay(report.from) && isDay(report.to) && Array.isArray(report.sections)
}

// ---- Numbers ---------------------------------------------------------------------------------------------------------

const COUNT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** "1,284". */
export function countText(value: number): string {
  return COUNT.format(value)
}

/** "34 minutes", "1 minute". */
export function minutesText(value: number): string {
  return `${countText(value)} ${value === 1 ? 'minute' : 'minutes'}`
}

/** A figure's value as the screen shows it: a count, or a median in minutes; "None" for a median with no sample. */
export function valueText(kind: ReportFigure['kind'], value: number | null | undefined): string {
  if (!isCount(value)) return kind === 'median_minutes' ? 'None' : '—'
  return kind === 'median_minutes' ? minutesText(value) : countText(value)
}

/** "the previous 30 days", "the previous day". */
export function previousPeriod(days: number): string {
  return days === 1 ? 'the previous day' : `the previous ${days} days`
}

/**
 * How a figure compares with the same number of days just before: "Up 32 from 380 in the previous 30 days". Said in
 * neutral words: a change is not good or bad, and no figure is a rate or a quality measure.
 */
export function comparisonText(figure: Pick<ReportFigure, 'kind' | 'current' | 'previous'>, days: number): string {
  const period = previousPeriod(days)
  if (!isCount(figure.previous)) return figure.kind === 'median_minutes' ? `No median for ${period}.` : `No figure for ${period}.`
  const before = valueText(figure.kind, figure.previous)
  if (!isCount(figure.current)) return `${before.charAt(0).toUpperCase()}${before.slice(1)} in ${period}.`
  const change = figure.current - figure.previous
  if (change === 0) return `Same as ${period} (${before}).`
  const by = figure.kind === 'median_minutes' ? minutesText(Math.abs(change)) : countText(Math.abs(change))
  return `${change > 0 ? 'Up' : 'Down'} ${by} from ${before} in ${period}.`
}

/** "From 290 check-ins", the sample a median is worked out from; '' for a count. */
export function sampleText(figure: Pick<ReportFigure, 'kind' | 'sampleSize'>, words: FigureWords): string {
  if (figure.kind !== 'median_minutes' || !words.sample) return ''
  const size = isCount(figure.sampleSize) ? figure.sampleSize : 0
  return `From ${countText(size)} ${size === 1 ? words.sample[0] : words.sample[1]}.`
}

/**
 * "Counted for 300 of 412 check-ins (the previous 30 days: 0 of 380)": how many check-ins record when a clinician first
 * saw the patient, which the three tracked figures need. Check-ins from before 0203 do not.
 */
export function coverageText(figure: Pick<ReportFigure, 'coverage'>, checkedIn: Pick<ReportFigure, 'current' | 'previous'> | undefined,
  days: number): string {
  const coverage = figure.coverage
  if (!coverage || !isCount(coverage.tracked)) return ''
  const of = (tracked: number, total: number | null | undefined) => isCount(total)
    ? `${countText(tracked)} of ${countText(total)} check-ins` : `${countText(tracked)} ${tracked === 1 ? 'check-in' : 'check-ins'}`
  const before = isCount(coverage.previousTracked) ? ` (${previousPeriod(days)}: ${of(coverage.previousTracked, checkedIn?.previous)})` : ''
  return `Counted for ${of(coverage.tracked, checkedIn?.current)}${before}.`
}

// ---- Refusals --------------------------------------------------------------------------------------------------------

const CONNECTION = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT'])

/** Whether a refusal says the reports are not served here: an ehr-api before REP-1 (404), or REPORTS_ENABLED off (503). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'REPORTS_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('REPORT')
}

/** Whether a download's refusal says downloads are switched off here (REPORTS_EXPORT_ENABLED off), or not served at all. */
export function exportNotServed(caught: unknown): boolean {
  return isHidApiError(caught) && ((caught.status === 503 && caught.code === 'REPORTS_EXPORT_NOT_AVAILABLE') || notServed(caught))
}

const REFUSALS: Readonly<Record<string, string>> = {
  REPORTS_NOT_AVAILABLE: NOT_AVAILABLE,
  REPORTS_EXPORT_NOT_AVAILABLE: EXPORT_NOT_AVAILABLE,
  REPORTS_NOT_ALLOWED: READ_REFUSED,
  REPORTS_EXPORT_NOT_ALLOWED: EXPORT_REFUSED,
  REPORT_RANGE_INVALID: RANGE_INVALID,
  REPORT_RANGE_TOO_LONG: RANGE_TOO_LONG,
  REPORT_TOO_SLOW: TOO_SLOW,
  VALIDATION_FAILED: 'Check the dates, then try again.',
  PURPOSE_OF_USE_REQUIRED: 'Something went wrong. Reload the page and try again.',
}

/**
 * A refusal in plain words: the contract's own for REP-1's codes, "not available yet" for an ehr-api without it, the
 * page's refusal for any other 403, and never the word the backend's guard uses.
 */
export function refusalWords(caught: unknown, fallback: string, action: 'read' | 'download' = 'read'): string {
  if (!isHidApiError(caught)) return fallback
  if (action === 'download' && exportNotServed(caught)) return caught.code === 'REPORTS_NOT_AVAILABLE' ? NOT_AVAILABLE : EXPORT_NOT_AVAILABLE
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(REFUSALS, caught.code)) return REFUSALS[caught.code]!
  if (caught.status === 403) return action === 'download' ? EXPORT_REFUSED : READ_REFUSED
  if (caught.status === 0 || CONNECTION.has(caught.code)) return NO_CONNECTION
  return fallback
}

// ---- Served ----------------------------------------------------------------------------------------------------------
// Learned from the backend's own answers, by facility, in memory for the page's life: a read answering 404 (an ehr-api
// before REP-1) or 503 REPORTS_NOT_AVAILABLE (the switch is off at a real facility) says not served there; a report says
// served. A sealed demo facility has the routes whatever the switch, so what one facility says is not taken for another.
// Until a facility has said, null, and the page is listed there.

const served = new Map<string, boolean>()
const exportOff = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function subscribeReportsServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** What this facility's answers have said: true served, false not served, null not asked yet. */
export function reportsServedAt(facilityId: string | null | undefined): boolean | null {
  return facilityId ? served.get(facilityId) ?? null : null
}

export function useReportsServed(facilityId: string | null | undefined): boolean | null {
  return useSyncExternalStore(subscribeReportsServed, () => reportsServedAt(facilityId), () => reportsServedAt(facilityId))
}

/** Records what a report (no `caught`) or a refusal says about whether reports are served at this facility. */
export function learnReportsServed(facilityId: string, caught?: unknown): void {
  const value = caught === undefined ? true : notServed(caught) ? false : null
  if (value === null || served.get(facilityId) === value) return
  served.set(facilityId, value)
  changed()
}

/** Whether downloads were found switched off at this facility (503 REPORTS_EXPORT_NOT_AVAILABLE). */
export function downloadsOffAt(facilityId: string | null | undefined): boolean {
  return facilityId ? exportOff.has(facilityId) : false
}

export function useDownloadsOff(facilityId: string | null | undefined): boolean {
  return useSyncExternalStore(subscribeReportsServed, () => downloadsOffAt(facilityId), () => downloadsOffAt(facilityId))
}

/** Records what a download (no `caught`) or its refusal says about downloads at this facility. */
export function learnDownloads(facilityId: string, caught?: unknown): void {
  const off = caught !== undefined && exportNotServed(caught)
  if (caught !== undefined && !off) return
  if (exportOff.has(facilityId) === off) return
  if (off) exportOff.add(facilityId)
  else exportOff.delete(facilityId)
  changed()
}

/** For tests: forget what was learned, as a new page would. */
export function forgetReportsServed(): void {
  served.clear()
  exportOff.clear()
  changed()
}
