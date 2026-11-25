/** Shared text formats for the clinical workspaces, as the design prints them. */

import { ageInYears as lagosAge, formatDate as lagosDate, formatDateTime } from '@hid/ui/display'

/*
 * Clinical safety: a date is never written all in numbers. "3/4/1991" is 4 March in Lagos and 3 April in an American
 * template; "4 Mar 1991" is one day everywhere. Times use the 24-hour clock, as wards do, and are Lagos time whatever
 * the device's zone (owner decisions Q181 A and Q182 A; the one helper is @hid/ui/display).
 */

/** "26 Oct 2026, 12:41" in Lagos; '' when the value is missing or not a date. */
export function formatWhen(value: string | null | undefined): string {
  return formatDateTime(value)
}

/** "26 Oct 2026", for a date of birth or a date-only value. Date-only strings are read as calendar dates. */
export function formatDate(value: string | null | undefined): string {
  return lagosDate(value)
}

/**
 * A number as it was entered. The EHR keeps a dose to four decimal places and answers it as text ("4.0000", "0.5000"):
 * the zeros after the last digit go ("4", "0.5", "2.5", "1000"), and a decimal keeps its leading zero (".5" is "0.5").
 * Worked on the text, never through a float, so a value is never rounded. Anything else is shown as it came.
 */
export function decimalText(value: unknown): string {
  const written = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : typeof value === 'string' ? value.trim() : ''
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(written)
  if (!match || (!match[2] && !match[3])) return written
  const whole = match[2]!.replace(/^0+(?=\d)/, '') || '0'
  const fraction = (match[3] ?? '').replace(/0+$/, '')
  return `${match[1]}${whole}${fraction ? `.${fraction}` : ''}`
}

/** A status as the design's badges print it: lower case words; underscores become spaces. */
export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

/** A status as a badge says it, in sentence case: "in_progress" is "In progress". */
export function statusWords(status: string): string {
  // Sentence case, as every other label in the app: "Entered in error", "In progress".
  const words = statusLabel(status)
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/** A label from a record key, as the design's detail list prints it: "nextVisit" is "Next Visit". */
export function keyLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').trim()
  return spaced.replace(/\b\w/g, letter => letter.toUpperCase())
}

/** Whole years from a date of birth to today in Lagos, or null when the date is missing, not a date or in the future. */
export function ageInYears(dateOfBirth: string | null | undefined, today: Date = new Date()): number | null {
  return lagosAge(dateOfBirth, today)
}
