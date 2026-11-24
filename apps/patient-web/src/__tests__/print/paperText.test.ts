// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { paperText, plainWords } from '../../print/paperPdf'
import { pdfText } from '../../ehr-blue/departments/outreach/outreachExportFiles'

/*
 * The words of a paper made into a PDF (Safari, an iPhone or iPad: paperPdf.ts) as the PDF's font (Noto Sans, cut down)
 * can draw them: a character it has no glyph for keeps its meaning, or prints as "?", and never vanishes. Fictional
 * results only.
 */

const FONTS = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'] as const
const FONT_FOLDER = fileURLToPath(new URL('../../ehr-blue/departments/outreach/fonts', import.meta.url))

function fontBytes(name: string): DataView {
  const file = readFileSync(join(FONT_FOLDER, name))
  return new DataView(file.buffer, file.byteOffset, file.byteLength)
}

/** Every character a TrueType font has a glyph for, from its Unicode cmap (format 4, the BMP). */
function charactersOf(font: DataView): Set<number> {
  const tables = font.getUint16(4)
  let cmap = -1
  for (let index = 0; index < tables; index += 1) {
    const at = 12 + index * 16
    if (String.fromCharCode(font.getUint8(at), font.getUint8(at + 1), font.getUint8(at + 2), font.getUint8(at + 3)) === 'cmap') cmap = font.getUint32(at + 8)
  }
  expect(cmap).toBeGreaterThan(0)
  const found = new Set<number>()
  const subtables = font.getUint16(cmap + 2)
  for (let index = 0; index < subtables; index += 1) {
    const platform = font.getUint16(cmap + 4 + index * 8)
    const encoding = font.getUint16(cmap + 6 + index * 8)
    const at = cmap + font.getUint32(cmap + 8 + index * 8)
    if (!(platform === 3 && encoding === 1) || font.getUint16(at) !== 4) continue
    const segments = font.getUint16(at + 6) / 2
    const ends = at + 14
    const starts = ends + segments * 2 + 2
    const deltas = starts + segments * 2
    const offsets = deltas + segments * 2
    for (let segment = 0; segment < segments; segment += 1) {
      const end = font.getUint16(ends + segment * 2)
      const start = font.getUint16(starts + segment * 2)
      const delta = font.getInt16(deltas + segment * 2)
      const offset = font.getUint16(offsets + segment * 2)
      for (let code = start; code <= end && code !== 0xffff; code += 1) {
        const glyph = offset === 0 ? (code + delta) & 0xffff
          : font.getUint16(offsets + segment * 2 + offset + (code - start) * 2)
        if (glyph !== 0) found.add(code)
      }
    }
  }
  return found
}

describe('the PDF font’s characters (pdfText)', () => {
  it.each(FONTS)('passes through only characters %s has a glyph for: anything else is "?", never a blank', name => {
    const has = charactersOf(fontBytes(name))
    const missing: string[] = []
    for (let code = 0x20; code <= 0xffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue
      for (const character of pdfText(String.fromCodePoint(code))) {
        if (!has.has(character.codePointAt(0)!)) missing.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('writes the arrows the font lacks as "?", not as nothing', () => {
    expect(pdfText('K+ ↓ 2.9 → recheck ←↑')).toBe('K+ ? 2.9 ? recheck ??')
  })
})

describe('a paper’s words in the PDF (paperText)', () => {
  it('keeps a limit’s direction, a unit’s micro, lowered figures, a minus sign and a temperature', () => {
    expect(paperText('≤ 5')).toBe('<= 5')
    expect(paperText('≥ 60 mL/min')).toBe('>= 60 mL/min')
    expect(paperText('88 μmol/L')).toBe('88 µmol/L')
    expect(paperText('88 µmol/L')).toBe('88 µmol/L')
    expect(paperText('Free T₄ and T₃')).toBe('Free T4 and T3')
    expect(paperText('Vitamin B₁₂')).toBe('Vitamin B12')
    expect(paperText('HbA₁c')).toBe('HbA1c')
    expect(paperText('Base excess −4.1')).toBe('Base excess -4.1')
    expect(paperText('37.2 ℃')).toBe('37.2 °C')
    expect(paperText('≈ 3 days')).toBe('~ 3 days')
    expect(paperText('×10⁹/L')).toBe('×10^9/L')
  })

  it('marks a high or low arrow in words, and a tab as a space', () => {
    expect(paperText('↑ 14.2')).toBe('(high) 14.2')
    expect(paperText('K+ ↓ 2.9, recheck')).toBe('K+ (low) 2.9, recheck')
    expect(paperText('Day 1 → Day 3')).toBe('Day 1 -> Day 3')
    expect(paperText('Dose\t5 mg')).toBe('Dose 5 mg')
  })

  it('keeps Yoruba, Igbo and Hausa letters and ₦ as written', () => {
    expect(paperText('Ọmọ́tọ́lá Ẹ̀kọ́ · Ɓello Ƙasimu · ₦1,500')).toBe('Ọmọ́tọ́lá Ẹ̀kọ́ · Ɓello Ƙasimu · ₦1,500'.normalize('NFC'))
  })

  it('draws every character it writes in the font, or "?"', () => {
    const has = charactersOf(fontBytes(FONTS[0]))
    const sample = '≤≥μ−℃℉≈↑↓→←₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎⁰⁴⁵⁶⁷⁸⁹⁺⁻\t'
    for (const character of paperText(sample)) expect(character === '?' || has.has(character.codePointAt(0)!)).toBe(true)
    expect(paperText(sample)).not.toContain('?')
  })

  it('lays out the same plain words the PDF draws, keeping tabs and line breaks for the layout', () => {
    expect(plainWords('≤ 5\n↑ 14.2\tμmol/L')).toBe('<= 5\n(high) 14.2\tµmol/L')
  })
})
