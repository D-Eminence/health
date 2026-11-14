import type { jsPDF } from 'jspdf'
import type { ExportMeta, ExportTable } from './outreachExport'

/*
 * The Excel, Word and PDF files of an Outreach export (outreachExport.ts decides what they hold). Loaded only when
 * someone exports, with its libraries (fflate to zip, jsPDF to draw a PDF), so the page does not carry them.
 *
 * Excel and Word files are Office Open XML: a few XML files in a zip, written here rather than with a large library.
 */

/** Characters XML 1.0 does not allow (control characters, lone surrogates, U+FFFE and U+FFFF), dropped. */
// eslint-disable-next-line no-control-regex -- matching the control characters XML forbids is the point
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function xmlText(value: string): string {
  return value.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

async function zip(files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
  const { strToU8, zipSync } = await import('fflate')
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)]))
  return new Uint8Array(zipSync(entries, { level: 6 }))
}

/** A column's letters: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** A column's width in characters: as wide as its longest line, within reason. */
function widthOf(table: ExportTable, index: number) {
  const longest = Math.max(...[table.headings[index] ?? '', ...table.rows.map(row => row[index] ?? '')]
    .flatMap(value => value.split('\n')).map(line => line.length))
  return Math.min(60, Math.max(10, longest + 2))
}

/**
 * The table as an Excel workbook: one sheet, "Registrations", its heading row bold and frozen. Every cell is written
 * as text (an inline string in the Text "@" format), never as a number or a formula, so a phone number such as
 * +2348012345678 keeps its "+" and its digits, even once edited; the caller has already made each cell safe.
 */
export async function xlsxBytes(table: ExportTable, meta: ExportMeta): Promise<Uint8Array<ArrayBuffer>> {
  const cell = (value: string, column: number, row: number, style: number) =>
    `<c r="${columnName(column)}${row}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
  const rows = [table.headings, ...table.rows].map((values, index) =>
    `<row r="${index + 1}">${values.map((value, column) => cell(value, column, index + 1, index === 0 ? 1 : 2)).join('')}</row>`)
  const cols = table.headings.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${widthOf(table, index)}" customWidth="1"/>`).join('')
  const sheet = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows.join('')}</sheetData></worksheet>`
  return zip({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="${RELS}">`
      + `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="xl/workbook.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>',
    'docProps/core.xml': `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" `
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xmlText(meta.title) + '</dc:title><dc:description>'
      + xmlText(meta.subtitle) + '</dc:description></cp:coreProperties>',
    'xl/workbook.xml': `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Registrations" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships xmlns="${RELS}">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>',
    'xl/styles.xml': `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>'
      + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet,
  })
}

/** A Word paragraph's runs: line breaks kept. */
function wordRuns(value: string, properties: string) {
  return value.split(/\r\n|\r|\n/).map((line, index) =>
    `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(line)}</w:t></w:r>`).join('')
}

/** The longest word in a column (heading and cells), in characters, up to 30: what a cell is kept wide enough for. */
function longestWord(table: ExportTable, index: number) {
  let longest = 0
  for (const value of [table.headings[index] ?? '', ...table.rows.map(row => row[index] ?? '')]) {
    for (const word of value.split(/\s+/)) longest = Math.max(longest, [...word].length)
  }
  return Math.min(30, longest)
}

/** Word's pages, in twentieths of a point, landscape: A4, A3, then as wide as Word allows (22 inches). Half-inch margins. */
const WORD_PAGES = [{ width: 16838, height: 11906 }, { width: 23811, height: 16838 }, { width: 31680, height: 16838 }] as const
const WORD_MARGIN = 720
/** About one character of 8 pt text, and a cell's padding and border, in twentieths of a point. */
const WORD_CHARACTER = 95
const WORD_CELL_PADDING = 160

/**
 * The Word table's page and column widths: each column at least as wide as its longest word (so a word is never cut in
 * two, "Tempera" / "ture"), on the smallest page that holds them all (A4, then A3, then wider); the room left is shared
 * as the columns' lengths ask.
 */
export function wordLayout(table: ExportTable): { page: { width: number; height: number }; widths: number[] } {
  const least = table.headings.map((_, index) => longestWord(table, index) * WORD_CHARACTER + WORD_CELL_PADDING)
  const needed = least.reduce((sum, width) => sum + width, 0)
  const page = WORD_PAGES.find(option => option.width - 2 * WORD_MARGIN >= needed) ?? WORD_PAGES[WORD_PAGES.length - 1]!
  const usable = page.width - 2 * WORD_MARGIN
  if (needed > usable) return { page, widths: least.map(width => Math.floor((width * usable) / needed)) }
  const weights = table.headings.map((_, index) => widthOf(table, index))
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  return { page, widths: least.map((width, index) => width + Math.floor(((usable - needed) * weights[index]!) / total)) }
}

/**
 * The table as a Word document: landscape (A4, or a larger page when the columns need it), the title and what the file
 * holds above a bordered table whose heading row repeats on every page.
 */
export async function docxBytes(table: ExportTable, meta: ExportMeta): Promise<Uint8Array<ArrayBuffer>> {
  const { page, widths } = wordLayout(table)
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9AA4B2"/>`
  const tableCell = (value: string, index: number, heading: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>`
    + `${heading ? '<w:shd w:val="clear" w:color="auto" w:fill="E7EEF7"/>' : ''}</w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${wordRuns(value, `${heading ? '<w:b/>' : ''}<w:sz w:val="16"/>`)}</w:p></w:tc>`
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${table.headings.map((value, index) => tableCell(value, index, true)).join('')}</w:tr>`
  const body = table.rows.map(row => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => tableCell(value, index, false)).join('')}</w:tr>`)
  const document = `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${wordRuns(meta.title, '<w:b/><w:sz w:val="32"/>')}</w:p>`
    + `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${wordRuns(meta.subtitle, '<w:sz w:val="18"/>')}</w:p>`
    + '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
    + `${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="60" w:type="dxa"/>'
    + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${head}${body.join('')}</w:tbl><w:p/>`
    + `<w:sectPr><w:pgSz w:w="${page.width}" w:h="${page.height}" w:orient="landscape"/>`
    + `<w:pgMar w:top="${WORD_MARGIN}" w:right="${WORD_MARGIN}" w:bottom="${WORD_MARGIN}" w:left="${WORD_MARGIN}" w:header="360" w:footer="360" w:gutter="0"/>`
    + '</w:sectPr></w:body></w:document>'
  return zip({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': document,
  })
}

/**
 * What the PDF's font draws: Noto Sans (SIL Open Font License 1.1, fonts/OFL.txt), cut down to Latin with its extended
 * letters (ọ ẹ ṣ, ɓ ɗ ƙ ƴ), the combining tone marks, general punctuation, ₦ and €. These are the ranges it was cut to
 * (pyftsubset --unicodes, with no layout features or hinting).
 */
const FONT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e], [0xa0, 0x2ff], [0x300, 0x36f], [0x1e00, 0x1eff], [0x2000, 0x206f], [0x20a6, 0x20a6], [0x20ac, 0x20ac],
  [0x2122, 0x2122], [0x2190, 0x2193], [0xfffd, 0xfffd],
]

/**
 * Words as the PDF's font can draw them: every Yoruba, Igbo and Hausa letter and tone mark as written (composed where
 * Unicode composes them), and anything else the font lacks as "?" rather than a blank.
 */
export function pdfText(value: string): string {
  let out = ''
  for (const character of value.normalize('NFC')) {
    const code = character.codePointAt(0)!
    out += character === '\n' || FONT_RANGES.some(([from, to]) => code >= from && code <= to) ? character : '?'
  }
  return out
}

/** The font's file, from the build's own lazy chunk (a data: URL), as the base64 jsPDF takes. */
const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)
export const PDF_FONT = 'NotoSans'

/** The PDF table's text size and cell padding, in points. */
const PDF_FONT_SIZE = 7
const PDF_CELL_PADDING = 3
/** The widest a PDF column is made for its longest line, in points; a longer line wraps between words. */
const PDF_COLUMN_MOST = 170

/**
 * Each PDF column's widths, in points: `least`, its longest word (narrower would cut a word in two), and `ample`, its
 * longest line up to PDF_COLUMN_MOST (never less than `least`). `measure` gives the width of words in the table's font
 * (bold for a heading).
 */
export function pdfColumnWidths(table: ExportTable, measure: (words: string, bold: boolean) => number): { least: number[]; ample: number[] } {
  const known = new Map<string, number>()
  const width = (words: string, bold: boolean) => {
    const key = `${bold ? 'b' : 'n'}${words}`
    let found = known.get(key)
    if (found === undefined) known.set(key, found = measure(words, bold))
    return found
  }
  const columns = table.headings.map((heading, index) => {
    let word = 0
    let line = 0
    const look = (value: string, bold: boolean) => {
      for (const part of value.split('\n')) {
        if (!part) continue
        line = Math.max(line, width(part, bold))
        for (const piece of part.split(/\s+/)) if (piece) word = Math.max(word, width(piece, bold))
      }
    }
    look(heading, true)
    for (const row of table.rows) look(row[index] ?? '', false)
    const least = Math.min(word, 2 * PDF_COLUMN_MOST)
    const padded = (inner: number) => Math.ceil(inner + 2 * PDF_CELL_PADDING + 1)
    return { least: padded(least), ample: padded(Math.max(least, Math.min(line, PDF_COLUMN_MOST))) }
  })
  return { least: columns.map(column => column.least), ample: columns.map(column => column.ample) }
}

/**
 * The table as a PDF: A4 landscape, the title and what the file holds above a table whose heading row repeats on every
 * page, and "Page 1 of 3" at the foot of each page. A table too wide for the page (health check results add many
 * columns) is not squeezed letter by letter: its columns go on across further pages, the person's name on each.
 */
export async function pdfBytes(table: ExportTable, meta: ExportMeta): Promise<ArrayBuffer> {
  return (await pdfDocument(table, meta)).output('arraybuffer')
}

/** The PDF as jsPDF holds it (pdfBytes writes it out). */
export async function pdfDocument(table: ExportTable, meta: ExportMeta): Promise<jsPDF> {
  // The font is part of this chunk's lazy imports: only a PDF export loads it (about 250 kB with both weights).
  const [{ jsPDF }, { autoTable }, regular, bold] = await Promise.all([import('jspdf'), import('jspdf-autotable'),
    import('./fonts/NotoSans-Regular.ttf?inline'), import('./fonts/NotoSans-Bold.ttf?inline')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.addFileToVFS('NotoSans-Regular.ttf', base64Of(regular.default))
  doc.addFont('NotoSans-Regular.ttf', PDF_FONT, 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', base64Of(bold.default))
  doc.addFont('NotoSans-Bold.ttf', PDF_FONT, 'bold')
  const margin = 36
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFont(PDF_FONT, 'bold')
  doc.setFontSize(14)
  doc.text(pdfText(meta.title), margin, margin + 6)
  doc.setFont(PDF_FONT, 'normal')
  doc.setFontSize(9)
  const subtitle = doc.splitTextToSize(pdfText(meta.subtitle), width - 2 * margin) as string[]
  doc.text(subtitle, margin, margin + 24)
  doc.setFontSize(PDF_FONT_SIZE)
  let bolded: boolean | undefined
  const { least, ample } = pdfColumnWidths(table, (words, bold) => {
    if (bold !== bolded) doc.setFont(PDF_FONT, bold ? 'bold' : 'normal')
    bolded = bold
    return doc.getTextWidth(pdfText(words))
  })
  doc.setFont(PDF_FONT, 'normal')
  // Too wide only when even each column's longest word cannot fit across the page; otherwise the table fits as before.
  const wide = least.reduce((sum, columnWidth) => sum + columnWidth, 0) > width - 2 * margin
  const name = table.headings.indexOf('Full name')
  autoTable(doc, {
    head: [table.headings.map(pdfText)],
    body: table.rows.map(row => row.map(pdfText)),
    startY: margin + 30 + subtitle.length * 11,
    margin: { top: margin, left: margin, right: margin, bottom: margin + 10 },
    theme: 'grid',
    styles: { font: PDF_FONT, fontSize: PDF_FONT_SIZE, cellPadding: PDF_CELL_PADDING, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [231, 238, 247], textColor: [16, 24, 40], fontStyle: 'bold' },
    ...(wide ? {
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: name >= 0 ? name : 0,
      horizontalPageBreakBehaviour: 'immediately' as const,
      columnStyles: Object.fromEntries(ample.map((columnWidth, index) => [index, { cellWidth: columnWidth }])),
    } : {}),
  })
  const pages = doc.getNumberOfPages()
  doc.setFontSize(8)
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.text(`Page ${page} of ${pages}`, width - margin, height - margin / 2, { align: 'right' })
  }
  return doc
}
