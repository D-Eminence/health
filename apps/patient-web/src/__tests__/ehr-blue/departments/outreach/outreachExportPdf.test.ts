import { describe, expect, it } from 'vitest'
import { pdfBytes } from '../../../../ehr-blue/departments/outreach/outreachExportFiles'

/*
 * The PDF as jsPDF really writes it (no stand-in): Noto Sans is embedded, and the names' letters are in it as written,
 * Yoruba, Igbo and Hausa letters and tone marks included, so a reader (or a copy and paste) gets them back. Fictional data.
 */

const NAMES = ['Adébáyọ̀ Ọlọ́rùn', 'Ṣadé Ẹ̀kọ́', 'Ɓello Ɗanjuma', 'Ƙasimu Ƴaro', 'Chukwuemeka Ọ̄kọ̀']

/** The code points the PDF's ToUnicode maps say its text holds, upper-case hex. */
function mappedCodePoints(pdf: string): Set<string> {
  const found = new Set<string>()
  for (const match of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of match[1]!.matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) found.add(pair[1]!.toUpperCase().padStart(4, '0'))
  }
  for (const match of pdf.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of match[1]!.matchAll(/<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) found.add(range[1]!.toUpperCase().padStart(4, '0'))
  }
  return found
}

describe('the PDF export', () => {
  it('embeds Noto Sans and keeps every letter of a Yoruba, Igbo or Hausa name', async () => {
    const bytes = await pdfBytes({ headings: ['Full name'], rows: NAMES.map(name => [name]) },
      { title: 'Outreach registrations: Ìbàdàn', subtitle: '5 registrations.' })
    const pdf = new TextDecoder('latin1').decode(bytes)
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toMatch(/\/BaseFont \/NotoSans/)
    expect(pdf).toContain('/FontFile2')
    const mapped = mappedCodePoints(pdf)
    const needed = [...new Set(NAMES.join('').normalize('NFC'))].filter(character => character !== ' ')
      .map(character => character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
    // ọ ẹ ṣ, the grave, acute and macron tone marks, and Hausa's hooked letters among them.
    expect(needed).toEqual(expect.arrayContaining(['1ECD', '1EB8', '1E62', '0300', '0301', '0304', '0181', '018A', '0198', '01B3']))
    expect(needed.filter(code => !mapped.has(code))).toEqual([])
  })
})
