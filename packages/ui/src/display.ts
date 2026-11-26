/**
 * How every staff and patient screen writes a time, a date and a phone number (owner decisions Q181 to Q183, EHR list
 * P2-4). One place, so no screen drifts from it.
 *
 * - Q181 A: times are Lagos time, whatever zone the device is set to. Health ID serves Nigeria only (Q131 A); a
 *   facility's own zone comes later, and only this file would change.
 * - Q182 A: a date is "18 Nov 2026" and a time is on the 24-hour clock ("14:05"). A date is never written all in
 *   numbers: "3/4/2026" is 3 April in Lagos and 4 March in an American template, which is a safety risk on a chart.
 * - Q183 B: a Nigerian number reads as it is dialled at home ("0803 123 4567", a Lagos landline "01 234 5678"); a
 *   foreign number is international ("+44 770 090 0123"). Numbers are stored the same either way (E.164); only the
 *   display changes.
 *
 * Lagos is on West Africa Time, UTC+1 all year with no daylight saving, so the clock is worked out from the instant
 * itself rather than from the device's zone or its time-zone tables. The month names are fixed here too, so every
 * browser prints the same "Sep" (some print "Sept").
 */

/** Health ID's display zone (Q181 A). */
export const DISPLAY_TIME_ZONE = 'Africa/Lagos'

/** West Africa Time is UTC+1 and has no daylight saving. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** A moment as the server or a page holds it: an ISO string, a millisecond count or a Date. */
export type Moment = string | number | Date | null | undefined

/** A calendar day with no time ("2026-11-18"): a date of birth, a check-in day, a due date. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The wall clock in Lagos at one moment. `month` is 1 to 12; `weekday` is 0 (Sunday) to 6. */
export interface LagosClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly weekday: number
}

function instant(value: Moment): number | null {
  if (value === null || value === undefined || value === '') return null
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function calendarDay(value: Moment): LagosClock | null {
  if (typeof value !== 'string') return null
  const match = CALENDAR_DAY.exec(value.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return { year, month, day, hour: 0, minute: 0, weekday: check.getUTCDay() }
}

/**
 * The Lagos wall clock at a moment, or null when the value is missing or not a date. A calendar day ("2026-11-18") is
 * that day as written, never moved by a zone: a date of birth is the same day on every device.
 */
export function lagosClock(value: Moment): LagosClock | null {
  const day = calendarDay(value)
  if (day) return day
  // "2026-02-30" is not a day; the browser would read it as 2 March.
  if (typeof value === 'string' && CALENDAR_DAY.test(value.trim())) return null
  const ms = instant(value)
  if (ms === null) return null
  const shifted = new Date(ms + LAGOS_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), weekday: shifted.getUTCDay(),
  }
}

const two = (value: number) => String(value).padStart(2, '0')

function dateOf(clock: LagosClock): string {
  return `${clock.day} ${MONTHS[clock.month - 1]} ${clock.year}`
}

function timeOf(clock: LagosClock): string {
  return `${two(clock.hour)}:${two(clock.minute)}`
}

/** "18 Nov 2026" in Lagos; `fallback` ('' unless given) when the value is missing or not a date. */
export function formatDate(value: Moment, fallback = ''): string {
  const clock = lagosClock(value)
  return clock ? dateOf(clock) : fallback
}

/** "14:05", Lagos time on the 24-hour clock; `fallback` when the value is missing or not a date. */
export function formatTime(value: Moment, fallback = ''): string {
  const clock = calendarDay(value) ? null : lagosClock(value)
  return clock ? timeOf(clock) : fallback
}

/**
 * "18 Nov 2026, 14:05" in Lagos; `fallback` when the value is missing or not a date. A calendar day has no time, so
 * it is written as its date alone.
 */
export function formatDateTime(value: Moment, fallback = ''): string {
  if (calendarDay(value)) return formatDate(value, fallback)
  const clock = lagosClock(value)
  return clock ? `${dateOf(clock)}, ${timeOf(clock)}` : fallback
}

/** "Wednesday", the day of the week in Lagos; '' when the value is missing or not a date. */
export function formatWeekday(value: Moment): string {
  const clock = lagosClock(value)
  return clock ? WEEKDAYS[clock.weekday]! : ''
}

/**
 * The Lagos calendar day of a moment as "2026-11-18" (now, when no moment is given): for a date field's limit, a
 * "today" comparison or a file name. Never shown as a date; formatDate is for that. '' for a value that is not a date.
 */
export function lagosDay(value: Moment = Date.now()): string {
  const clock = lagosClock(value)
  return clock ? `${clock.year}-${two(clock.month)}-${two(clock.day)}` : ''
}

/** Whether two moments fall on the same Lagos calendar day. */
export function sameLagosDay(a: Moment, b: Moment): boolean {
  const first = lagosDay(a)
  return first !== '' && first === lagosDay(b)
}

/**
 * "14:05" when the moment is on the same Lagos day as `now`, else "18 Nov 2026, 14:05": a time read days later is
 * never taken for today's. `fallback` when the value is missing or not a date.
 */
export function formatTimeOrDateTime(value: Moment, now: Moment = Date.now(), fallback = ''): string {
  if (lagosClock(value) === null) return fallback
  return sameLagosDay(value, now) ? formatTime(value, fallback) : formatDateTime(value, fallback)
}

/** A date and time with its zone written ("1991-03-03T23:00:00Z", "1991-03-04 00:00:00+01"): an instant, not a day. */
const ZONED_TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:[Zz]|([+-])(\d{2}):?(\d{2})?)$/

/**
 * The day someone was born, from a date of birth as it arrives. A calendar day ("1991-03-04") is that day. A time with
 * its zone is the Lagos day it falls on: "1991-03-03T23:00:00Z" is midnight in Lagos on 4 March, so 4 March, the day
 * formatDate shows for it. A time with no zone ("1991-03-04T00:00:00") keeps the day as written, as the device's zone
 * would otherwise move it.
 */
function birthDay(dateOfBirth: string): LagosClock | null {
  const written = dateOfBirth.trim()
  const zoned = ZONED_TIME.exec(written)
  const day = calendarDay(zoned ? zoned[1]! : written.slice(0, 10))
  if (!zoned || !day) return day
  const [hour, minute, second] = [Number(zoned[2]), Number(zoned[3]), Number(zoned[4] ?? 0)]
  if (hour > 23 || minute > 59 || second > 59) return null
  const offsetMinutes = zoned[5] ? (zoned[5] === '-' ? -1 : 1) * (Number(zoned[6]) * 60 + Number(zoned[7] ?? 0)) : 0
  return lagosClock(Date.UTC(day.year, day.month - 1, day.day, hour, minute, second) - offsetMinutes * 60 * 1000)
}

/**
 * Whole years from a date of birth to the Lagos day of `now`; null when the date is missing, not a date, in the future
 * or over 150 years ago. The date of birth is a calendar day ("1991-03-04") or a time (see birthDay): one sent as
 * midnight in Lagos ("1991-03-03T23:00:00Z") counts from 4 March, never from the 3rd.
 */
export function ageInYears(dateOfBirth: string | null | undefined, now: Moment = Date.now()): number | null {
  if (!dateOfBirth) return null
  const born = birthDay(dateOfBirth)
  const today = lagosClock(now)
  if (!born || !today) return null
  let age = today.year - born.year
  if (today.month < born.month || (today.month === born.month && today.day < born.day)) age -= 1
  return age >= 0 && age < 150 ? age : null
}

/*
 * Country calling codes are a prefix code (ITU-T E.164): 1 and 7 are one digit, these are two, and every other code is
 * three. That is enough to put the space after the country code without a phone-number library.
 */
const TWO_DIGIT_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52',
  '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92',
  '93', '94', '95', '98',
])

function countryCodeLength(digits: string): number {
  if (digits.startsWith('1') || digits.startsWith('7')) return 1
  return TWO_DIGIT_CODES.has(digits.slice(0, 2)) ? 2 : 3
}

/**
 * The national part of a foreign number in groups of three, as "770 090 0123", never leaving a group of one or two
 * digits: a length one over a multiple of three ends in a group of four ("770 090 0123"), and one two over ends in two
 * groups of four ("138 0013 8000"). Five digits or fewer stay as one group.
 */
function grouped(digits: string): string {
  if (digits.length <= 5) return digits
  const fours = digits.length % 3 === 0 ? 0 : digits.length % 3 === 1 ? 1 : 2
  const threes = (digits.length - 4 * fours) / 3
  const groups: string[] = []
  let at = 0
  for (let index = 0; index < threes + fours; index += 1) {
    const size = index < threes ? 3 : 4
    groups.push(digits.slice(at, at + size))
    at += size
  }
  return groups.join(' ')
}

/**
 * The national number (after +234, without the trunk 0) of a Nigerian number, however it was written, or null. It is
 * written "0..." at home, or "234..." or "+234..." with or without the trunk 0 after the country code
 * ("2340 1 234 5678", "+234 (0)1 234 5678"). A national number never starts with 0, so a doubled trunk
 * ("+2340(0)12345678") is not one. Only a mobile has ten digits, so ten that do not begin with a mobile prefix are not
 * one ("01 234 567 890" is a landline with two digits too many); eight that do are a mobile missing two digits, not a
 * landline (see `MOBILE_PREFIX`).
 */
function nigerianDigits(compact: string): string | null {
  const match = /^(?:\+?2340?|0)([1-9]\d{9}|[1-9]\d{7})$/.exec(compact)
  if (!match) return null
  const national = match[1]!
  return (national.length === 8) === MOBILE_PREFIX.test(national) ? null : national
}

/**
 * Nigeria's mobile prefixes are 070x, 080x, 081x, 090x and 091x, so a national number that starts 70, 80, 81, 90 or 91
 * is a mobile. None of these is an area code: the two-digit codes run 30 to 89 without 70, 80 and 81, and Abuja (9)
 * subscriber numbers start 2 to 6 ("09 234 5678"), never 0 or 1.
 */
const MOBILE_PREFIX = /^(?:70|80|81|90|91)/

/** Area codes of one digit: Lagos (1), Ibadan (2) and Abuja (9). Every other Nigerian area code has two. */
const ONE_DIGIT_AREA_CODES = new Set(['1', '2', '9'])

/**
 * A Nigerian national number as it is written at home. A mobile has ten digits: "0803 123 4567". A landline has eight:
 * the trunk 0 and the area code, then the subscriber number, as "01 234 5678" in Lagos or "042 123 456" in Enugu.
 */
function nigerianAtHome(national: string): string {
  if (national.length === 10) return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
  const area = ONE_DIGIT_AREA_CODES.has(national[0]!) ? 1 : 2
  const subscriber = national.slice(area)
  return `0${national.slice(0, area)} ${subscriber.slice(0, 3)} ${subscriber.slice(3)}`
}

/**
 * The stored text with spaces, dots, dashes and brackets taken out. A "(0)" written straight after the country code is
 * the trunk 0, which is not dialled from abroad, so it goes too: "+44 (0) 20 7946 0000", "+(44) (0) 20 7946 0000" and
 * "(+44) (0) 20 7946 0000" are all "+442079460000". A 0 written there without brackets is kept as written.
 */
function compactPhone(written: string): string {
  const spaced = written.replace(/[\s.-]/g, '')
  const trunk = /^(?:\+\(?|\(\+)(\d{1,3})\)?\(0\)(.*)$/.exec(spaced)
  const dialled = trunk && countryCodeLength(trunk[1]!) === trunk[1]!.length ? `+${trunk[1]}${trunk[2]}` : spaced
  return dialled.replace(/[()]/g, '')
}

/**
 * A stored phone number as a screen shows it (Q183 B). A Nigerian number reads as it is written at home: a mobile as
 * "0803 123 4567", a landline as "01 234 5678" (Lagos, Ibadan and Abuja) or "042 123 456" (other areas). A foreign
 * number is international, as "+44 770 090 0123" or "+86 138 0013 8000": no group after the country code is shorter
 * than three digits, and no digit is lost or moved. Spaces, dots, dashes and brackets in the stored text are ignored,
 * and a "(0)" written after the country code is dropped ("+44 (0) 20 7946 0000" shows "+44 207 946 0000"). Anything
 * that is not a phone number is shown as it came, trimmed; `fallback` ('' unless given) when there is none. So is a
 * "+234" number that is not a whole Nigerian number, such as a mobile missing two digits ("+234 803 123 45"): Q183 B
 * never shows a Nigerian number in international form, and regrouping it would make it look complete.
 */
export function formatPhone(value: string | null | undefined, fallback = ''): string {
  const written = (value ?? '').trim()
  if (!written) return fallback
  const compact = compactPhone(written)
  const nigerian = nigerianDigits(compact)
  if (nigerian) return nigerianAtHome(nigerian)
  if (compact.startsWith('+234')) return written
  const international = /^\+([1-9]\d{6,14})$/.exec(compact)
  if (!international) return written
  const digits = international[1]!
  const split = countryCodeLength(digits)
  return `+${digits.slice(0, split)} ${grouped(digits.slice(split))}`
}

