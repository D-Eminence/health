import { describe, expect, it } from 'vitest'
import { PX_PER_MM, pageOf, pageSizePx, pageStarts, paperTitle, yOnPage } from '../../print/paperPages'

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
