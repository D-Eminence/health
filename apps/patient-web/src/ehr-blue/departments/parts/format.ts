/** An identifier shown masked, as today's pages show it: its last six characters. */
export function shortId(value: string) {
  return `••••${value.slice(-6)}`
}

/**
 * A server time as "26 Oct 2026, 12:41", or "Not available". Never all numbers ("3/4" is a different day in Lagos and
 * in an American template) and on the 24-hour clock, as the clinical pages write it (clinical/parts/format.ts).
 */
export function dateText(value: string | null | undefined) {
  if (!value) return 'Not available'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'Not available'
    : time.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "4 Mar 1991", for a date of birth (a date-only value is read as that calendar day). */
export function birthDateText(value: string | null | undefined) {
  if (!value) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

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
