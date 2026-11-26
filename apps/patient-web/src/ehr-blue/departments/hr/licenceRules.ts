import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, lagosDay } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  LicenceCheckedHow, LicenceRenewal, LicenceWithdrawReason, StaffLicence, StaffLicenceCounts,
} from '../../../staff/api'

/*
 * Licence renewals and expiry on HR & Credentials (hid-system ROS-1 routes 1-5, migration 0199) in plain words. A
 * licence's status is a warning only (Q243 A): an expired licence never changes a role or access. How a licence was
 * checked is recorded; Health ID connects to no regulator (Q247 A). Built at the recommended option of Q-ROS-12 A (the
 * last 4 characters of a number only), Q-ROS-13 A (an administrator's own renewal is allowed and marked) and Q-ROS-15 A
 * (no free text: a withdrawal has a reason from a list).
 */

export const NOT_AVAILABLE = 'Licence renewals are not switched on yet.'
export const NOT_ALLOWED = 'Only this facility’s administrator can see and record licence renewals.'
export const WARNING_ONLY = 'A licence that has expired does not change anyone’s role or access. Check the licence, then record its renewal here.'

const STATUS_WORDS: Readonly<Record<string, string>> = {
  valid: 'Valid',
  expiring_60: 'Expires within 60 days',
  expiring_30: 'Expires within 30 days',
  expired: 'Expired',
  not_recorded: 'No renewal recorded',
  no_licence: 'No licence on record',
}
export function licenceStatusText(status: string): string {
  return STATUS_WORDS[status] ?? 'Status not known'
}
export function licenceStatusTone(status: string): EhrBadgeTone {
  switch (status) {
    case 'valid': return 'positive'
    case 'expiring_60': case 'expiring_30': return 'caution'
    case 'expired': return 'critical'
    default: return 'neutral'
  }
}

export const CHECKED_HOW: readonly LicenceCheckedHow[] = ['regulator_register', 'certificate_seen', 'in_person']
const CHECKED_HOW_WORDS: Readonly<Record<LicenceCheckedHow, string>> = {
  regulator_register: 'Checked on the regulator’s register',
  certificate_seen: 'Original licence certificate seen',
  in_person: 'Checked in person',
}
export function checkedHowText(how: string): string {
  return Object.hasOwn(CHECKED_HOW_WORDS, how) ? CHECKED_HOW_WORDS[how as LicenceCheckedHow] : 'Checked'
}

export const WITHDRAW_REASONS: readonly LicenceWithdrawReason[] = ['wrong_member', 'wrong_dates', 'wrong_licence', 'other']
const WITHDRAW_WORDS: Readonly<Record<LicenceWithdrawReason, string>> = {
  wrong_member: 'Recorded for the wrong person',
  wrong_dates: 'Wrong dates',
  wrong_licence: 'Wrong licence',
  other: 'Another reason',
}
export function withdrawReasonText(reason: string): string {
  return Object.hasOwn(WITHDRAW_WORDS, reason) ? WITHDRAW_WORDS[reason as LicenceWithdrawReason] : 'Withdrawn'
}

/** The licence as staff read it: "NMCN licence, ending 4567". Never the whole number. */
export function licenceText(licence: Pick<StaffLicence, 'body' | 'numberHint' | 'status'>): string {
  if (licence.status === 'no_licence') return 'No licence on record'
  return licence.numberHint ? `${licence.body} licence, ending ${licence.numberHint}` : `${licence.body} licence`
}

/** "Valid until 31 Dec 2026 (licence year 2026)". */
export function validUntilText(renewal: Pick<LicenceRenewal, 'validUntil' | 'period' | 'licenceYear'>): string {
  const until = `Valid until ${formatDate(renewal.validUntil)}`
  return renewal.period === 'licence_year' && renewal.licenceYear ? `${until} (licence year ${renewal.licenceYear})` : until
}

/** "Checked on the regulator's register on 10 Jan 2026". */
export function checkedText(renewal: Pick<LicenceRenewal, 'checkedHow' | 'checkedOn'>): string {
  return `${checkedHowText(renewal.checkedHow)} on ${formatDate(renewal.checkedOn)}`
}

export const SELF_RECORDED = 'Recorded by the member themselves'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The banner's heading over the list: what needs doing now; null when nothing has expired or is about to. */
export function bannerTitle(counts: StaffLicenceCounts): string | null {
  const parts = [
    counts.expired > 0 ? `${plural(counts.expired, 'licence has', 'licences have')} expired` : '',
    counts.expiring30 > 0 ? `${plural(counts.expiring30, 'expires', 'expire')} within 30 days` : '',
    counts.expiring60 > 0 ? `${plural(counts.expiring60, 'expires', 'expire')} within 60 days` : '',
  ].filter(Boolean)
  if (parts.length === 0) return null
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

/** Every count in one line, for the list's summary. */
export function countsText(counts: StaffLicenceCounts): string {
  return [
    `${counts.valid} valid`,
    `${counts.expiring60} within 60 days`,
    `${counts.expiring30} within 30 days`,
    `${counts.expired} expired`,
    `${counts.notRecorded} with no renewal recorded`,
    `${counts.noLicence} with no licence on record`,
  ].join(' · ')
}

// ---- The renewal form --------------------------------------------------------------

export function lagosToday(now: Date | number = Date.now()): string {
  return lagosDay(now)
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** The licence years offered: last year to 3 years ahead. */
export function licenceYears(today = lagosToday()): number[] {
  const year = Number(today.slice(0, 4))
  return [year - 1, year, year + 1, year + 2, year + 3]
}

/** The earliest and latest dates each field takes, as the server's rules (LICENCE_RENEWAL_DATES_INVALID). */
export function renewalLimits(today = lagosToday()) {
  return {
    validUntilMin: addDays(today, -400),
    validUntilMax: addDays(today, 5 * 365 + 1),
    checkedOnMin: addDays(today, -90),
    checkedOnMax: today,
  }
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isDay = (value: string) => DAY_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

export interface RenewalValues {
  period: 'licence_year' | 'expiry_date' | ''
  licenceYear: string
  validUntil: string
  checkedHow: LicenceCheckedHow | ''
  checkedOn: string
  attested: boolean
}

export type RenewalField = 'period' | 'licenceYear' | 'validUntil' | 'checkedHow' | 'checkedOn' | 'attested'

/** Each field that can't be sent, in the form's words; empty when the renewal can be sent. */
export function renewalProblems(values: RenewalValues, today = lagosToday()): Partial<Record<RenewalField, string>> {
  const problems: Partial<Record<RenewalField, string>> = {}
  const limits = renewalLimits(today)
  if (!values.period) problems.period = 'Choose whether the licence has a licence year or an expiry date.'
  if (values.period === 'licence_year' && !licenceYears(today).includes(Number(values.licenceYear))) {
    problems.licenceYear = 'Choose a licence year from last year to 3 years ahead.'
  }
  if (values.period === 'expiry_date' && (!isDay(values.validUntil) || values.validUntil < limits.validUntilMin || values.validUntil > limits.validUntilMax)) {
    problems.validUntil = 'Enter the expiry date on the licence: up to 400 days ago or up to 5 years ahead.'
  }
  if (!values.checkedHow) problems.checkedHow = 'Choose how you checked the licence.'
  if (!isDay(values.checkedOn) || values.checkedOn < limits.checkedOnMin || values.checkedOn > limits.checkedOnMax) {
    problems.checkedOn = 'Enter the day you checked it: today or up to 90 days ago.'
  }
  if (!values.attested) problems.attested = 'Confirm that you checked the licence.'
  return problems
}

/** The administrator's confirmation (attestation text facility-licence-renewal-v1), with the member's name. */
export function attestationText(name: string): string {
  return `I confirm that I checked ${name}’s practising licence in the way recorded here, and that it is current until the date `
    + 'recorded. Health ID records this confirmation with my name.'
}

// ---- Refusals ---------------------------------------------------------------------

const REFUSALS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the details and try again.',
  LICENCE_RENEWAL_DATES_INVALID: 'Enter a licence year from last year to 3 years ahead, or an expiry date, checked in the last 90 days.',
  HR_CREDENTIALS_NOT_ALLOWED: NOT_ALLOWED,
  FACILITY_STAFF_NOT_FOUND: 'This person does not work at this facility.',
  LICENCE_RENEWAL_NOT_FOUND: 'This record is not at this facility.',
  LICENCE_NOT_ON_RECORD: 'This person has no licence on record for that role. Add it on Staff & access first.',
  LICENCE_RENEWAL_ALREADY_WITHDRAWN: 'This renewal was already withdrawn.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong sending this. Reload the page and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This form was already sent with other details. Reload the page and try again.',
  HR_CREDENTIALS_NOT_AVAILABLE: NOT_AVAILABLE,
  PERMISSION_DENIED: NOT_ALLOWED,
  FACILITY_ACCESS_DENIED: NOT_ALLOWED,
}

const OWN_NOT_FOUND = new Set(['FACILITY_STAFF_NOT_FOUND', 'LICENCE_RENEWAL_NOT_FOUND'])

/** Whether a refusal says the licence routes are not served here: an identity-api before ROS-1, or the flag off. */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'HR_CREDENTIALS_NOT_AVAILABLE') return true
  return (caught.status === 404 || caught.status === 501) && !OWN_NOT_FOUND.has(caught.code)
}

/** A refusal in plain words; `facility` names the facility support has still to check (FACILITY_REVIEW_PENDING). */
export function refusalWords(caught: unknown, fallback: string, facility = 'your facility'): string {
  if (!isHidApiError(caught)) return fallback
  if (caught.code === 'REQUEST_CANCELLED') return ''
  if (notServed(caught)) return NOT_AVAILABLE
  if (caught.code === 'FACILITY_REVIEW_PENDING') return reviewPendingText(facility)
  if (Object.hasOwn(REFUSALS, caught.code)) return REFUSALS[caught.code]!
  if (caught.status === 403) return NOT_ALLOWED
  if (caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT' || caught.status === 0) {
    return 'Couldn’t reach Health ID. Check the connection and try again.'
  }
  return fallback
}

export function reviewPendingText(facility: string): string {
  return `You can record licence renewals once Health ID support has checked ${facility}.`
}

/** The export's file name: the server's (Content-Disposition), or one dated today in Lagos. */
export function exportFileName(disposition: string | null, today = lagosToday()): string {
  const match = disposition ? /filename="?([A-Za-z0-9._-]+\.csv)"?/i.exec(disposition) : null
  return match ? match[1]! : `licence-check-${today}.csv`
}

// ---- Whether Health ID serves licence renewals at this facility ---------------------------
// Learned from the backend's own answers, per facility, in memory for the page's life: 404 or 503
// HR_CREDENTIALS_NOT_AVAILABLE says not served (the page is then today's HR & Credentials), only while nothing has said
// otherwise; any other answer says served.

const served = new Map<string, boolean>()
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function licencesServed(facilityId: string | undefined): boolean | null {
  return facilityId ? served.get(facilityId) ?? null : null
}
export function learnLicences(facilityId: string, caught?: unknown): void {
  const value = caught === undefined ? true : notServed(caught) ? false
    : isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code) ? true
      : null
  const known = served.get(facilityId)
  if (value === null || known === true || known === value) return
  served.set(facilityId, value)
  changed()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useLicencesServed(facilityId: string): boolean | null {
  const read = () => licencesServed(facilityId)
  return useSyncExternalStore(subscribe, read, read)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetLicencesServed(): void {
  served.clear()
  changed()
}
