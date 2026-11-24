import { describe, expect, it } from 'vitest'
import { PX_PER_MM, pageHeadings, pageOf, pageSizePx, pageStarts, paperTitle, yOnPage } from '../../print/paperPages'

/*
 * Cutting a paper made into a PDF into pages (paperPages.ts): every page keeps its top and bottom margin, and a line,
 * a table row or a part kept whole is never cut between pages unless it is taller than a page.
 */

const lines = (count: number, height = 20, from = 0) => Array.from({ length: count }, (_, index) => ({ top: from + index * height, bottom: from + (index + 1) * height }))

describe('the pages of a paper', () => {
  it('is one page when everything fits above the foot margin', () => {
    expect(pageStarts(lines(10), 400, 40, 40)).toEqual([0])
  })

  it('starts the next page at the first line that does not fit, and keeps the top margin on every later page', () => {
    // 400 tall, 40 at the foot: the first page holds y 0 to 360, lines of 20 from 0, so 18 lines; the 19th starts page 2.
    const starts = pageStarts(lines(40), 400, 40, 40)
    expect(starts[1]).toBe(360)
    // A later page holds 400 - 40 - 40 = 320: 16 lines.
    expect(starts[2]).toBe(680)
    expect(starts).toHaveLength(3)
    expect(yOnPage(starts, 1, 360, 40)).toBe(40)
    expect(yOnPage(starts, 0, 100, 40)).toBe(100)
    expect(pageOf(starts, 359)).toBe(0)
    expect(pageOf(starts, 360)).toBe(1)
    expect(pageOf(starts, 1000)).toBe(2)
  })

  it('moves a part kept whole to the next page when it would be cut', () => {
    const spans = [...lines(15), { top: 300, bottom: 420 }, ...lines(6, 20, 300)]
    expect(pageStarts(spans, 400, 40, 40)).toEqual([0, 300])
  })

  it('cuts something taller than a page where the page ends, rather than running on', () => {
    const starts = pageStarts([{ top: 0, bottom: 2000 }], 400, 40, 40)
    expect(starts.slice(0, 3)).toEqual([0, 360, 680])
    expect(starts.length).toBeLessThan(10)
  })

  it('knows the page sizes in CSS pixels', () => {
    expect(pageSizePx('A4').width).toBeCloseTo(210 * PX_PER_MM)
    expect(pageSizePx('A5').height).toBeCloseTo(210 * PX_PER_MM)
    expect(pageSizePx('A6').width).toBeCloseTo(105 * PX_PER_MM)
    expect(pageSizePx('slip').width).toBeCloseTo(210 * PX_PER_MM)
  })
})

describe('the paper’s title', () => {
  it('is the facility and what the paper is, and never more', () => {
    expect(paperTitle('  Demo  Hospital ', 'Discharge summary')).toBe('Demo Hospital · Discharge summary')
    expect(paperTitle(null, 'Receipt')).toBe('Receipt')
    expect(paperTitle('', 'Receipt')).toBe('Receipt')
  })
})

describe('a table that runs on to a later page', () => {
  // A heading row 30 tall at y 100 to 130, then rows of 20 from 130 to 1130: the table ends at 1130.
  const heading = { top: 100, bottom: 130, end: 1130 }
  const spans = [...lines(5), heading, ...lines(50, 20, 130)]

  it('draws its heading row again at the top of every later page, and puts that page’s rows below it', () => {
    const starts = pageStarts(spans, 400, 40, 40, [heading])
    // The first page holds y 0 to 360 as before; a later page holds 320 less the 30 of the heading: 14 rows of 20.
    expect(starts.slice(0, 3)).toEqual([0, 350, 630])
    const repeated = pageHeadings(starts, [heading], 400, 40, 40)
    expect(repeated[0]).toBeNull()
    expect(repeated[1]).toBe(heading)
    expect(repeated[2]).toBe(heading)
    // The first row of page 2 sits just under the heading, which sits just under the top margin.
    expect(yOnPage(starts, 1, 350, 40, 30)).toBe(70)
  })

  it('draws no heading on a page after the table has ended', () => {
    const after = { top: 1130, bottom: 1500 }
    const starts = pageStarts([...spans, after], 400, 40, 40, [heading])
    const repeated = pageHeadings(starts, [heading], 400, 40, 40)
    starts.forEach((start, page) => { if (start >= heading.end) expect(repeated[page]).toBeNull() })
    expect(repeated.at(-1)).toBeNull()
  })

  it('draws no heading again that would take more than half of a page', () => {
    const tall = { top: 0, bottom: 200, end: 2000 }
    const starts = pageStarts([tall, ...lines(90, 20, 200)], 400, 40, 40, [tall])
    expect(pageHeadings(starts, [tall], 400, 40, 40).every(repeated => repeated === null)).toBe(true)
  })
})
