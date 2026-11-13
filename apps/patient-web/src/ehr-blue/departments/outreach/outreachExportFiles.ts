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
 * as text (an inline string), never as a number or a formula; the caller has already made each cell safe.
 */
export async function xlsxBytes(table: ExportTable, meta: ExportMeta): Promise<Uint8Array<ArrayBuffer>> {
  const cell = (value: string, column: number, row: number, style: number) =>
    `<c r="${columnName(column)}${row}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
  const rows = [table.headings, ...table.rows].map((values, index) =>
    `<row r="${index + 1}">${values.map((value, column) => cell(value, column, index + 1, index === 0 ? 1 : 0)).join('')}</row>`)
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
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet,
  })
}

/** A Word paragraph's runs: line breaks kept. */
function wordRuns(value: string, properties: string) {
  return value.split(/\r\n|\r|\n/).map((line, index) =>
    `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(line)}</w:t></w:r>`).join('')
}

/** A4 landscape, in twentieths of a point, with half-inch margins. */
const PAGE = { width: 16838, height: 11906, margin: 720 }

/**
 * The table as a Word document: A4 landscape, the title and what the file holds above a bordered table whose heading
 * row repeats on every page.
 */
export async function docxBytes(table: ExportTable, meta: ExportMeta): Promise<Uint8Array<ArrayBuffer>> {
  const usable = PAGE.width - 2 * PAGE.margin
  const weights = table.headings.map((_, index) => widthOf(table, index))
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const widths = weights.map(weight => Math.floor((usable * weight) / total))
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
    + `<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}" w:orient="landscape"/>`
    + `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="360" w:footer="360" w:gutter="0"/>`
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

/** The characters jsPDF's built-in fonts can draw (Windows-1252), beyond printable ASCII and Latin-1. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/**
 * Words as the PDF's built-in font can draw them. Letters it lacks (ọ, ẹ, ṣ in Yoruba names) are written without their
 * marks ("Adébáyọ̀" → "Adébáyo"), rather than as broken symbols; the other formats keep every letter.
 */
export function pdfText(value: string): string {
  let out = ''
  for (const character of value.normalize('NFC')) {
    const code = character.codePointAt(0)!
    if (character === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(character)) {
      out += character
      continue
    }
    const plain = character.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out += [...plain].every(part => { const c = part.codePointAt(0)!; return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) }) ? plain : '?'
  }
  return out
}

/**
 * The table as a PDF: A4 landscape, the title and what the file holds above a table whose heading row repeats on every
 * page, and "Page 1 of 3" at the foot of each page.
 */
export async function pdfBytes(table: ExportTable, meta: ExportMeta): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const margin = 36
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(pdfText(meta.title), margin, margin + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const subtitle = doc.splitTextToSize(pdfText(meta.subtitle), width - 2 * margin) as string[]
  doc.text(subtitle, margin, margin + 24)
  autoTable(doc, {
    head: [table.headings.map(pdfText)],
    body: table.rows.map(row => row.map(pdfText)),
    startY: margin + 30 + subtitle.length * 11,
    margin: { top: margin, left: margin, right: margin, bottom: margin + 10 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [231, 238, 247], textColor: [16, 24, 40], fontStyle: 'bold' },
  })
  const pages = doc.getNumberOfPages()
  doc.setFontSize(8)
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.text(`Page ${page} of ${pages}`, width - margin, height - margin / 2, { align: 'right' })
  }
  return doc.output('arraybuffer')
}
