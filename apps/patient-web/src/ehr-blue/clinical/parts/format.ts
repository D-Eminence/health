/** Shared text formats for the clinical workspaces, as the design prints them. */

/** "10/26/2026, 12:41:13 PM", the design's date and time; '' when the value is missing or not a date. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US')
}

/** "10/26/2026", for a date of birth or a date-only value. Date-only strings are read as calendar dates. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-US')
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
