import { describe, expect, it } from 'vitest'
import { pdfBytes, pdfDocument, pdfText } from '../../../../ehr-blue/departments/outreach/outreachExportFiles'
import { rowsFor, type ExportCase } from '../../../../ehr-blue/departments/outreach/outreachExport'
import type { OutreachScreening } from '../../../../staff/api'

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

  it('goes on across pages rather than cutting words when health check results make the table wide', async () => {
    const screening: OutreachScreening = {
      bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, temperatureC: 36.8, weightKg: 64.5, heightCm: 165, glucoseValue: 5.4, glucoseUnit: 'mmol/L',
      glucoseTiming: 'fasting', malariaRdt: 'negative', hearingLeft: 'refer', hearingRight: 'refer', mainComplaint: 'Headache for 3 days',
      seenByClinician: true, clinicianName: 'Demo Nurse', outcome: 'Genotype: AS. Blood group: O+. Drink more water and rest.',
      medicinesGiven: [{ name: 'Paracetamol', dose: '500 mg' }], referred: true, referredTo: 'Demo General Hospital',
      caseId: 'case-1', version: 1, recordedAt: '2026-11-14T10:00:00.000Z', recordedByMembershipId: 'membership-1', updatedAt: '2026-11-14T10:00:00.000Z',
    }
    const people: ExportCase[] = Array.from({ length: 10 }, (_, i) => ({
      id: `case-${i}`, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: `Patient Number ${i}`, ageYears: 34, sex: 'female',
      phone: '+2348000000001', address: '12 Demo Street, Ibadan', createdAt: '2026-11-14T09:30:00.000Z', rowVersion: 1, hasScreening: true,
      healthId: 'HID-AB12CD', healthIdCreatedByOutreach: true, registeredByName: 'Demo Volunteer', operationalNotes: 'Came with her mother.',
      screening,
    }))
    const context = { campaignOf: () => ({ name: 'Demo screening week' }) }
    type Row = { cells: Record<number, { text: string[]; raw: unknown }> }
    type Drawn = { lastAutoTable: { head: Row[]; body: Row[]; settings: { horizontalPageBreak: boolean } } }
    /** Every piece of a line drawn in a cell that is not a whole word of what the cell holds. */
    const cutWords = (drawn: Drawn['lastAutoTable']) => {
      const cut: string[] = []
      for (const row of [...drawn.head, ...drawn.body]) {
        for (const cell of Object.values(row.cells)) {
          const words = new Set(pdfText(String(cell.raw)).split(/\s+/))
          for (const line of cell.text) for (const piece of line.split(/\s+/)) if (piece && !words.has(piece)) cut.push(`${String(cell.raw)} → ${piece}`)
        }
      }
      return cut
    }

    const table = rowsFor(people, context)
    expect(table.headings).toContain('Hearing left')
    const doc = await pdfDocument(table, { title: 'Outreach registrations', subtitle: '10 registrations.' })
    const drawn = (doc as unknown as Drawn).lastAutoTable
    // "Didn’t pass (needs a full hearing test)" and "Temperature (°C)" are never broken inside a word.
    expect(cutWords(drawn)).toEqual([])
    expect(drawn.settings.horizontalPageBreak).toBe(true)
    // A few pages, not one letter per line over dozens.
    expect(doc.getNumberOfPages()).toBeLessThanOrEqual(4)

    // Without health check results the table fits across one page as it always has.
    const plain = rowsFor(people.map(({ screening: _, ...item }) => ({ ...item, hasScreening: false })), context)
    expect(plain.headings).not.toContain('Hearing left')
    const plainDoc = await pdfDocument(plain, { title: 'Outreach registrations', subtitle: '10 registrations.' })
    const plainDrawn = (plainDoc as unknown as Drawn).lastAutoTable
    expect(plainDrawn.settings.horizontalPageBreak).toBe(false)
    expect(cutWords(plainDrawn)).toEqual([])
    expect(plainDoc.getNumberOfPages()).toBe(1)
  })
})
