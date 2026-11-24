// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { jsPDF } from 'jspdf'
import { drawText, raisedMarks, type TextRun } from '../../print/paperPdf'
import { PT_PER_PX } from '../../print/paperPages'

/*
 * A tone mark over a capital that Unicode has no single letter for (Ọ́, Ẹ̀) in a paper made into a PDF (paperPdf.ts):
 * jsPDF places no mark by the font's own rules, so the mark is drawn on its own, raised to clear the capital and
 * centred over it. Fictional names only.
 */

/** A PDF that records what is written, in a font where every letter is 10 points wide and a mark takes no room. */
function recordingPdf() {
  const written: Array<{ text: string; x: number; y: number }> = []
  const width = (text: string) => [...text].filter(character => !/\p{M}/u.test(character)).length * 10
  const pdf = {
    setFont() {}, setFontSize() {}, setTextColor() {}, setDrawColor() {}, setLineWidth() {}, line() {},
    getTextWidth: width,
    text(text: string, x: number, y: number) { written.push({ text, x, y }) },
  }
  return { pdf: pdf as unknown as jsPDF, written }
}

const run = (text: string, bold = false): TextRun => ({
  kind: 'text', text, left: 0, width: [...text].filter(character => !/\p{M}/u.test(character)).length * 10 / PT_PER_PX,
  top: 0, bottom: 20, baseline: 15, size: 20, bold, colour: [0, 0, 0], letterSpacing: 0, underline: false,
})

describe('a tone mark over a capital', () => {
  it('is taken out of the run only where it sits on a capital', () => {
    const name = 'ỌMỌ́TỌ́LÁ Ẹ̀KỌ́ Ọmọ́'.normalize('NFC')
    const { text, marks } = raisedMarks(name)
    expect(text).toBe('ỌMỌTỌLÁ ẸKỌ Ọmọ́'.normalize('NFC'))
    expect(marks.map(mark => [mark.mark, mark.before, mark.base])).toEqual([
      ['́', 'ỌM', 'Ọ'], ['́', 'ỌMỌT', 'Ọ'], ['̀', 'ỌMỌTỌLÁ ', 'Ẹ'], ['́', 'ỌMỌTỌLÁ ẸK', 'Ọ'],
    ])
  })

  it('is drawn raised by a capital’s extra height, centred over its capital', () => {
    const { pdf, written } = recordingPdf()
    drawText(pdf, run('MỌ́'.normalize('NFC')), 15)
    expect(written[0]).toMatchObject({ text: 'MỌ' })
    const size = 20 * PT_PER_PX
    const baseline = 15 * PT_PER_PX
    // Ọ runs from 10 to 20: its middle is 15. The acute's ink is centred 224.5 units left of where it is drawn.
    expect(written[1]!.text).toBe('́')
    expect(written[1]!.x).toBeCloseTo(15 + 224.5 * size / 1000)
    expect(written[1]!.y).toBeCloseTo(baseline - (714 - 536) * size / 1000)
  })

  it('leaves a small letter’s mark, and a capital Unicode composes (Á), as they are', () => {
    const { pdf, written } = recordingPdf()
    drawText(pdf, run('Ọmọ́ Á'.normalize('NFC')), 15)
    expect(written).toHaveLength(1)
    expect(written[0]!.text).toBe('Ọmọ́ Á'.normalize('NFC'))
  })
})
