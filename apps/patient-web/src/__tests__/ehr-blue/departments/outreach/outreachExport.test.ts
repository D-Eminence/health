import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
  readAllCases, EXPORT_CAPPED, EXPORT_LATEST_100,
  buildExport, exportFileName, exportMeta, OUTREACH_EXPORT_COLUMNS, rowsFor, safeCell, slug, toCsv, UTF8_BOM, type ExportCase, type ExportContext,
} from '../../../../ehr-blue/departments/outreach/outreachExport'
import { columnName, docxBytes, pdfText, xlsxBytes, xmlText } from '../../../../ehr-blue/departments/outreach/outreachExportFiles'

/*
 * Outreach export: the columns (one list for every format), CSV as RFC 4180 with a UTF-8 byte order mark and no
 * spreadsheet formulas, and the Excel and Word files as Office Open XML in a zip. Fictional data.
 */

const pdf = vi.hoisted(() => ({
  constructed: [] as unknown[],
  autoTable: vi.fn(),
  text: vi.fn(),
}))
vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } }
    constructor(options: unknown) { pdf.constructed.push(options) }
    setFont() {}
    setFontSize() {}
    setPage() {}
    text(...args: unknown[]) { pdf.text(...args) }
    splitTextToSize(value: string) { return [value] }
    getNumberOfPages() { return 2 }
    output() { return new TextEncoder().encode('%PDF-fake').buffer }
  },
}))
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }))

const CAMPAIGNS: Record<string, { name: string }> = { 'campaign-1': { name: 'Demo screening week' } }
const context: ExportContext = { campaignOf: id => (id ? CAMPAIGNS[id] : undefined) }

const basic: ExportCase = {
  id: 'c0a5e000-0000-4000-8000-000000000001', campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Adébáyọ̀ Ọlọ́run',
  ageYears: 34, sex: 'female', phone: '+2348000000001', temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-14T09:30:00.000Z', rowVersion: 3,
}
const older: ExportCase = {
  id: 'c0a5e000-0000-4000-8000-000000000002', status: 'identity_resolved', fullName: 'Patient Two', sex: 'male', ageYears: 51,
  createdAt: '2026-11-13T09:00:00.000Z', rowVersion: 5,
}

afterEach(() => { pdf.constructed.length = 0 })

describe('the columns', () => {
  it('writes the core columns in words, newest first, with no internal id or code', () => {
    const table = rowsFor([older, basic], context)
    expect(table.headings).toEqual(['Full name', 'Sex', 'Age (years)', 'Phone number', 'Campaign', 'Registered on', 'Status'])
    expect(table.rows[0]).toEqual(['Adébáyọ̀ Ọlọ́run', 'Female', '34', '+2348000000001', 'Demo screening week',
      expect.stringMatching(/^14 Nov 2026, \d{2}:\d{2}$/), 'Waiting to link'])
    expect(table.rows[1]).toEqual(['Patient Two', 'Male', '51', '', 'No campaign', expect.stringMatching(/^13 Nov 2026/), 'Linked'])
    const all = JSON.stringify(table)
    for (const hidden of ['c0a5e000', 'tmp_', 'identity_resolution_pending', 'campaign-1', 'rowVersion']) expect(all).not.toContain(hidden)
  })

  it('adds an optional column only when a registration has it, said in words', () => {
    const full: ExportCase = {
      ...basic, ageYears: undefined, dateOfBirth: '2012-03-04', address: 'Ward 3, Ibadan North', registeredByName: 'Demo Enumerator',
      consent: { textVersion: 'notice-2026-11', language: 'yo', method: 'guardian', guardianName: 'Demo Guardian' },
      guardianPhone: '08000000002', guardianRelationship: 'mother', healthId: 'hid-zdemaaa2', healthIdCreatedByOutreach: true, hasScreening: false, possibleDuplicate: true,
      operationalNotes: 'Needs a follow-up call, please',
    }
    const table = rowsFor([full, older], context)
    expect(table.headings).toEqual(OUTREACH_EXPORT_COLUMNS.map(column => column.heading))
    const row = Object.fromEntries(table.headings.map((heading, index) => [heading, table.rows[0]![index]]))
    expect(row).toMatchObject({
      'Date of birth': '4 Mar 2012', 'Area or address': 'Ward 3, Ibadan North', 'Registered by': 'Demo Enumerator', 'Health ID': 'HID-ZDEMAAA2', 'Health ID made at outreach': 'Yes',
      'Health check done': 'No', 'Possible duplicate': 'Yes', 'Parent or guardian': 'Demo Guardian', 'Parent or guardian’s relationship': 'Mother',
      'Parent or guardian’s phone': '08000000002', 'How they agreed': 'Their parent or guardian agreed', 'Notice language': 'Yoruba',
      'Notice version': 'notice-2026-11', 'Notes for the team': 'Needs a follow-up call, please',
    })
    expect(Number(row['Age (years)'])).toBeGreaterThanOrEqual(14)
    // The other registration has none of them: its cells are empty, not "undefined".
    expect(table.rows[1]!.filter(cell => cell === '')).toHaveLength(table.headings.length - 6)
    // Absent on its own row, "Health ID made at outreach" is said only where it was sent.
    expect(table.rows[1]![table.headings.indexOf('Health ID made at outreach')]).toBe('')
    expect(JSON.stringify(table)).not.toMatch(/undefined|null/)
  })

  it('leaves out what it has no words for, and an id given as who registered', () => {
    const odd: ExportCase = { ...basic, sex: 'x_code', status: 'something_new', registeredBy: 'a0000000-0000-4000-8000-000000000001',
      consent: { method: 'new_method', language: 'zz' }, guardianRelationship: 'cousin_code', healthId: 'a0000000-0000-4000-8000-000000000002', healthIdCreatedByOutreach: 'yes', campaignId: 'campaign-gone' }
    const table = rowsFor([odd], context)
    expect(table.headings).toEqual(['Full name', 'Sex', 'Age (years)', 'Phone number', 'Campaign', 'Registered on', 'Status'])
    expect(table.rows[0]).toEqual(['Adébáyọ̀ Ọlọ́run', '', '34', '+2348000000001', 'A campaign not listed here', expect.any(String), 'Status not known'])
  })

  it('takes a later column in one place, reaching every format', () => {
    const table = rowsFor([basic], context, [...OUTREACH_EXPORT_COLUMNS, { heading: 'Blood pressure', value: () => '120/80' }])
    expect(table.headings.at(-1)).toBe('Blood pressure')
    expect(table.rows[0]!.at(-1)).toBe('120/80')
  })
})

describe('CSV', () => {
  it('starts with a UTF-8 byte order mark and keeps every letter of a name', async () => {
    const csv = toCsv({ headings: ['Full name'], rows: [['Adébáyọ̀ Ọlọ́run']] })
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
    expect(csv).toBe('﻿Full name\r\nAdébáyọ̀ Ọlọ́run\r\n')
    const bytes = new Uint8Array(await (await buildExport('csv', { headings: ['A'], rows: [['b']] }, exportMeta(undefined, 1, new Date()))).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('quotes commas, quotes and line breaks as RFC 4180 says', () => {
    const csv = toCsv({ headings: ['Name', 'Notes'], rows: [['Okafor, Ada', 'Said "call me"'], ['Two\nlines', 'plain'], ['Back\rslash', '']] })
    expect(csv).toBe('﻿Name,Notes\r\n"Okafor, Ada","Said ""call me"""\r\n"Two\nlines",plain\r\n"Back\rslash",\r\n')
  })

  it.each([
    ['=HYPERLINK("http://example.test")', '\'=HYPERLINK("http://example.test")'],
    ['+2348000000001', '\'+2348000000001'],
    ['-1+1', '\'-1+1'],
    ['@SUM(A1)', '\'@SUM(A1)'],
    ['\tTab', '\'\tTab'],
    ['\rReturn', '\'\rReturn'],
    ['Ada = Okafor', 'Ada = Okafor'],
    ['', ''],
  ])('never lets a spreadsheet run %j', (value, safe) => {
    expect(safeCell(value)).toBe(safe)
  })

  it('makes every CSV cell safe, headings too, and quotes the result when it must', () => {
    const csv = toCsv({ headings: ['=Name'], rows: [['=1+1,2']] })
    expect(csv).toBe('﻿\'=Name\r\n"\'=1+1,2"\r\n')
  })
})

describe('file names and titles', () => {
  const day = new Date(2026, 10, 14, 9, 0)
  it('names the file after the campaign and the day', () => {
    expect(exportFileName('Demo Screening Week!', 'csv', day)).toBe('outreach-demo-screening-week-2026-11-14.csv')
    expect(exportFileName('Ìbàdàn Outreach / Ward 3', 'xlsx', day)).toBe('outreach-ibadan-outreach-ward-3-2026-11-14.xlsx')
    expect(exportFileName(undefined, 'pdf', day)).toBe('outreach-all-registrations-2026-11-14.pdf')
    expect(slug('!!!')).toBe('campaign')
  })

  it('says what the file holds and how to keep it', () => {
    const meta = exportMeta('Demo screening week', 1, day)
    expect(meta.title).toBe('Outreach registrations: Demo screening week')
    expect(meta.subtitle).toMatch(/^1 registration\. Exported 14 Nov 2026, \d{2}:\d{2}\. .*keep it safe and delete it/)
    expect(exportMeta(undefined, 2, day).title).toBe('Outreach registrations: all campaigns')
  })
})

describe('Excel', () => {
  it('writes a workbook whose cells are text, never formulas, with the heading row bold', async () => {
    const table = { headings: ['Full name', 'Phone number'], rows: [['Adébáyọ̀ <Ọlọ́run> & co', '\'+2348000000001']] }
    const files = unzipSync(await xlsxBytes(table, exportMeta(undefined, 1, new Date())))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Full name</t></is></c>')
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Adébáyọ̀ &lt;Ọlọ́run&gt; &amp; co</t></is></c>')
    expect(sheet).toContain('\'+2348000000001')
    expect(sheet).not.toContain('<f>')
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="Registrations"')
  })

  it('makes every cell safe for a spreadsheet before it is written', async () => {
    const blob = await buildExport('xlsx', { headings: ['Phone'], rows: [['=cmd']] }, exportMeta(undefined, 1, new Date()))
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const sheet = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['xl/worksheets/sheet1.xml']!)
    expect(sheet).toContain('>\'=cmd<')
  })

  it('names columns as a spreadsheet does', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('drops what XML cannot hold', () => {
    expect(xmlText('a\u0001b\u0008c"d\n')).toBe('abc&quot;d\n')
  })
})

describe('Word', () => {
  it('writes a landscape document with the title and a table whose heading row repeats', async () => {
    const blob = await buildExport('docx', { headings: ['Full name', 'Notes'], rows: [['Adébáyọ̀', 'Line one\nLine two']] },
      { title: 'Outreach registrations: Demo', subtitle: '1 registration.' })
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const document = strFromU8(files['word/document.xml']!)
    expect(document).toContain('w:orient="landscape"')
    expect(document).toContain('Outreach registrations: Demo')
    expect(document).toContain('<w:tblHeader/>')
    expect(document).toContain('>Adébáyọ̀<')
    expect(document).toContain('<w:br/><w:t xml:space="preserve">Line two</w:t>')
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('wordprocessingml.document.main+xml')
  })

  it('keeps Word text as written: a spreadsheet does not run it', async () => {
    const document = strFromU8(unzipSync(await docxBytes({ headings: ['Phone'], rows: [['+234']] }, { title: 'T', subtitle: 'S' }))['word/document.xml']!)
    expect(document).toContain('>+234<')
  })
})

describe('PDF', () => {
  beforeEach(() => { pdf.autoTable.mockClear(); pdf.text.mockClear() })

  it('draws a landscape table with the title and page numbers', async () => {
    const blob = await buildExport('pdf', { headings: ['Full name'], rows: [['Adébáyọ̀ Ọlọ́run']] },
      { title: 'Outreach registrations: Demo', subtitle: '1 registration.' })
    expect(blob.type).toBe('application/pdf')
    expect(pdf.constructed).toEqual([{ orientation: 'landscape', unit: 'pt', format: 'a4' }])
    expect(pdf.autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ head: [['Full name']], body: [['Adébáyo Olorun']] }))
    const texts = pdf.text.mock.calls.map(call => call[0])
    expect(texts).toContain('Outreach registrations: Demo')
    expect(texts).toEqual(expect.arrayContaining(['Page 1 of 2', 'Page 2 of 2']))
  })

  it('writes letters the built-in font lacks without their marks, keeping the ones it has', () => {
    expect(pdfText('Adébáyọ̀ Ọlọ́run’s “notes” – ok')).toBe('Adébáyo Olorun’s “notes” – ok')
    expect(pdfText('漢')).toBe('?')
  })
})

describe('reading every page', () => {
  const rows = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, status: 'identity_resolved', rowVersion: 1 }))

  it('follows the cursor until it is no longer sent, telling how many rows so far', async () => {
    const pages = [{ items: rows('a', 500), nextCursor: 'b' }, { items: rows('b', 500), nextCursor: 'c' }, { items: rows('c', 7), nextCursor: null }]
    const read = vi.fn(async (before: string | undefined) => pages[[undefined, 'b', 'c'].indexOf(before)]!)
    const progress = vi.fn()
    const result = await readAllCases(read, progress)
    expect(read.mock.calls.map(call => call[0])).toEqual([undefined, 'b', 'c'])
    expect(progress.mock.calls.map(call => call[0])).toEqual([500, 1000, 1007])
    expect(result.cases).toHaveLength(1007)
    expect(result).toMatchObject({ capped: false, latestOnly: false })
  })

  it('keeps one row for a registration sent on two pages, and stops on a cursor that does not move', async () => {
    const read = vi.fn(async () => ({ items: rows('same', 3), nextCursor: 'stuck' }))
    const result = await readAllCases(read)
    expect(read).toHaveBeenCalledTimes(2)
    expect(result.cases).toHaveLength(3)
  })

  it('stops at 20 pages and says the file is cut short', async () => {
    let n = 0
    const result = await readAllCases(async () => { n += 1; return { items: rows(`p${n}`, 500), nextCursor: `c${n}` } })
    expect(n).toBe(20)
    expect(result.cases).toHaveLength(10000)
    expect(result.capped).toBe(true)
    expect(EXPORT_CAPPED).toBe('Showing the first 10,000 registrations. The file holds only these.')
  })

  it('marks exactly 100 rows with no cursor as an older Outreach’s newest 100, and fewer as complete', async () => {
    expect((await readAllCases(async () => ({ items: rows('x', 100), nextCursor: null }))).latestOnly).toBe(true)
    expect((await readAllCases(async () => ({ items: rows('x', 99), nextCursor: null }))).latestOnly).toBe(false)
    expect(EXPORT_LATEST_100).toBe('Only the latest 100 registrations could be exported.')
  })
})
