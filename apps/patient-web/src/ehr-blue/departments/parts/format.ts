/** An identifier shown masked, as today's pages show it: its last six characters. */
export function shortId(value: string) {
  return `••••${value.slice(-6)}`
}

/** A server time in the reader's locale, or "Not available". */
export function dateText(value: string | null | undefined) {
  if (!value) return 'Not available'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'Not available' : time.toLocaleString()
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
