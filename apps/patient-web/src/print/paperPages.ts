/*
 * The pages of a paper made into a PDF (paperPdf.ts), worked out from where things sit on the paper as the browser laid
 * it out, in one long column, in CSS pixels. Kept apart from the drawing so it can be tested without a browser.
 *
 * Every page keeps a margin at its top and bottom: the first page starts at the paper's own top (its padding is the
 * margin there); each later page starts where the first thing that did not fit begins, below a top margin as deep as
 * the first page's. A line of text, a picture, a table row or a part kept whole (break-inside: avoid) is never cut
 * between pages, unless it is taller than a page. A table that runs on to a later page has its heading row (its thead)
 * drawn again at the top of that page, above its rows, as Chrome, Edge and Firefox print a table.
 */

/** Millimetres to CSS pixels (96 to the inch) and CSS pixels to PDF points (72 to the inch). */
export const PX_PER_MM = 96 / 25.4
export const PT_PER_PX = 72 / 96

/** The paper a document prints on: a page size, or `slip` (as wide as the paper and as long as it runs, one page). */
export type PaperSize = 'A4' | 'A5' | 'A6' | 'slip'

const SIZES_MM: Readonly<Record<Exclude<PaperSize, 'slip'>, readonly [number, number]>> = {
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
}

/** A page size in CSS pixels; a slip is laid out on a page as wide as A4 and measured after. */
export function pageSizePx(size: PaperSize): { readonly width: number; readonly height: number } {
  const [width, height] = SIZES_MM[size === 'slip' ? 'A4' : size]
  return { width: width * PX_PER_MM, height: height * PX_PER_MM }
}

/** Something on the paper that is not cut between pages, from its top to its bottom. */
export interface Span {
  readonly top: number
  readonly bottom: number
}

/** The least margin kept at the top and bottom of every page, in millimetres (most printers cannot print nearer). */
export const LEAST_MARGIN_MM = 5

/** Pixels within which two edges count as one: layout rounds. */
const EPSILON = 0.5
/** A paper of more pages than this is not a paper; stop rather than run on. */
const MOST_PAGES = 400

/** A table's heading row (its thead), from its top to its bottom, and `end`, where the table ends. */
export interface Heading extends Span {
  readonly end: number
}

/**
 * The heading drawn again at the top of a later page starting at `start`: a table's whose heading is on an earlier
 * page and whose rows run on past `start`. One taller than half the page's `room` is not drawn again.
 */
function headingAt<T extends Heading>(headings: readonly T[], start: number, room: number): T | null {
  for (const heading of headings) {
    if (heading.bottom <= start + EPSILON && heading.end > start + EPSILON && heading.bottom - heading.top <= room / 2) return heading
  }
  return null
}

/**
 * Where each page starts, as a y on the long column: always 0 first. `marginTop` is how far down a later page starts
 * (the first page's own top margin is part of the column); `marginBottom` is kept clear at the foot of every page. A
 * later page that repeats a table's heading (`headings`) holds that much less.
 */
export function pageStarts(spans: readonly Span[], pageHeight: number, marginTop: number, marginBottom: number,
  headings: readonly Heading[] = []): number[] {
  const starts = [0]
  let start = 0
  let room = pageHeight - marginBottom
  const later = pageHeight - marginTop - marginBottom
  while (starts.length < MOST_PAGES) {
    const end = start + room
    let next = Infinity
    for (const span of spans) {
      if (span.bottom <= end + EPSILON) continue
      // Something already cut at the top of this page runs on from where this page ends.
      const from = span.top >= start - EPSILON ? span.top : end
      if (from < next) next = from
    }
    if (next === Infinity) break
    // Taller than a page from the very top of one: cut it where the page ends.
    if (next <= start + EPSILON) next = end
    starts.push(next)
    start = next
    const heading = headingAt(headings, start, later)
    room = later - (heading ? heading.bottom - heading.top : 0)
  }
  return starts
}

/** The table heading each page draws again at its top (pageStarts), or null: never on the first page. */
export function pageHeadings<T extends Heading>(starts: readonly number[], headings: readonly T[], pageHeight: number,
  marginTop: number, marginBottom: number): Array<T | null> {
  const later = pageHeight - marginTop - marginBottom
  return starts.map((start, page) => page === 0 ? null : headingAt(headings, start, later))
}

/** The page (from 0) that something starting at `top` is drawn on. */
export function pageOf(starts: readonly number[], top: number): number {
  let page = 0
  while (page + 1 < starts.length && top >= starts[page + 1]! - EPSILON) page += 1
  return page
}

/** Where a y on the long column falls on its page; `below` is the height of a table heading drawn again above it. */
export function yOnPage(starts: readonly number[], page: number, y: number, marginTop: number, below = 0): number {
  return page === 0 ? y : marginTop + below + y - starts[page]!
}

/**
 * The paper's title, for the PDF and the tab it opens in: the facility and what the paper is ("General Hospital Ilorin
 * · Discharge summary"), or what it is alone. Never a patient's name or Health ID.
 */
export function paperTitle(facility: string | null | undefined, kind: string): string {
  const where = facility?.replace(/\s+/g, ' ').trim()
  return where ? `${where} · ${kind}` : kind
}
