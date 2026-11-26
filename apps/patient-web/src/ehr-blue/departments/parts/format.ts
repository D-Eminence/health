import { formatDate, formatDateTime } from '@hid/ui/display'

/**
 * A server time as "26 Oct 2026, 12:41" in Lagos, or "Not available". Never all numbers ("3/4" is a different day in
 * Lagos and in an American template) and on the 24-hour clock (owner decisions Q181 A and Q182 A, @hid/ui/display).
 */
export function dateText(value: string | null | undefined) {
  return formatDateTime(value, 'Not available')
}

/** "4 Mar 1991", for a date of birth (a date-only value is read as that calendar day). */
export function birthDateText(value: string | null | undefined) {
  return formatDate(value)
}

/** "24 Aug 2026", for a calendar day the server names ("2026-08-24"), as a date of birth is written. */
export const dayText = birthDateText

/** A count with its noun: "1 order", "3 orders". */
export function countText(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

/** The words of a search, lower-cased; a row matches when every word is in one of its texts. */
export function matchesSearch(query: string, texts: ReadonlyArray<string | null | undefined>) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = texts.filter(Boolean).join(' ').toLocaleLowerCase()
  return words.every(word => haystack.includes(word))
}
