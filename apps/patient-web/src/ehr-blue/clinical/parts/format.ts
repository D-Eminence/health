/** Shared text formats for the clinical workspaces, as the design prints them. */

/*
 * Clinical safety: a date is never written all in numbers. "3/4/1991" is 4 March in Lagos and 3 April in an American
 * template; "4 Mar 1991" is one day everywhere. Times use the 24-hour clock, as wards do.
 */
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

/** "26 Oct 2026, 12:41"; '' when the value is missing or not a date. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { ...DAY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "26 Oct 2026", for a date of birth or a date-only value. Date-only strings are read as calendar dates. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-GB', DAY)
}

/** The short reference under a record's name: the first eight characters of its id. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** A status as the design's badges print it: lower case words; underscores become spaces. */
export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

/** A label from a record key, as the design's detail list prints it: "nextVisit" is "Next Visit". */
export function keyLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').trim()
  return spaced.replace(/\b\w/g, letter => letter.toUpperCase())
}

/** Whole years from a date of birth, or null when the date is missing, not a date or in the future. */
export function ageInYears(dateOfBirth: string | null | undefined, today = new Date()): number | null {
  if (!dateOfBirth) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  let age = today.getFullYear() - year
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1
  return age >= 0 && age < 150 ? age : null
}
