/**
 * Search and day grouping for the records the page has loaded (hid-1.0's PatientRecords: "Search by date, title, or
 * keyword", records under date headings, newest day first). Nothing is sent: the search runs over what is on screen.
 */

/** Lower case, without accents and with spaces collapsed, so "Café" finds "cafe". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Every text in a value: strings and numbers at any depth, as a record's structured details hold them. */
export function textOf(value: unknown, depth = 0): string[] {
  if (value == null || depth > 8) return []
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(item => textOf(item, depth + 1))
  if (typeof value === 'object') return Object.values(value).flatMap(item => textOf(item, depth + 1))
  return []
}

/** Whether every word of `query` appears somewhere in `texts`. An empty query matches everything. */
export function matchesQuery(texts: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(texts.filter(Boolean).join(' '))
  return words.every(word => haystack.includes(word))
}

/** The calendar day a record belongs to, in this browser's time zone; a date without a time is its own day. */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'full' })

/** A day heading: "Tuesday 3 March 2026", as the page names dates (en-NG). */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return DAY.format(new Date(year!, month! - 1, date!))
}

/**
 * The heading a record is listed under, for the search: a row shows its date shorter ("3 Mar 2026"), so the
 * month and weekday words a patient reads in the heading would not find it otherwise.
 */
export function dayWords(value: string | null | undefined): string | null {
  const day = dayOf(value)
  return day === null ? null : dayLabel(day)
}

export interface DayGroup<T> {
  /** YYYY-MM-DD, or null for the records with no usable date. */
  day: string | null
  label: string
  items: T[]
}

/** The words under which records with no usable date are listed, after every dated day. */
export const UNDATED = 'Date not recorded'

/**
 * Records under their day, newest day first, and newest first within a day. Records with no usable date come last,
 * in the order given.
 */
export function groupByDay<T>(items: readonly T[], dateOf: (item: T) => string | null | undefined): Array<DayGroup<T>> {
  const time = (item: T) => {
    const value = dateOf(item)
    const parsed = value ? Date.parse(value) : NaN
    return Number.isNaN(parsed) ? -Infinity : parsed
  }
  const days = new Map<string, T[]>()
  const undated: T[] = []
  for (const item of items) {
    const day = dayOf(dateOf(item))
    if (day === null) { undated.push(item); continue }
    const list = days.get(day)
    if (list) list.push(item)
    else days.set(day, [item])
  }
  const groups: Array<DayGroup<T>> = [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({ day, label: dayLabel(day), items: [...list].sort((a, b) => time(b) - time(a)) }))
  if (undated.length) groups.push({ day: null, label: UNDATED, items: undated })
  return groups
}
