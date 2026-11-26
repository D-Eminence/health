import { PDF_FONT, pdfText } from '../outreach/outreachExportFiles'
import type { ReportFileContent } from './reportFile'
import { DRAFT } from './reportRules'

/*
 * A downloaded report as a PDF: A4 portrait, the title and what the file is above its tables (totals first, then each
 * section day by day), each table's heading row repeated on every page it runs onto, and "Page 1 of 3" at the foot of
 * each page, beside the draft notice while the definitions await sign-off. Drawn in Noto Sans, the font Outreach's files
 * use (outreach/fonts, SIL Open Font License), loaded with jsPDF only when someone downloads a PDF.
 */

const MARGIN = 40
const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

export async function reportPdfBytes(content: ReportFileContent): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }, regular, bold] = await Promise.all([import('jspdf'), import('jspdf-autotable'),
    import('../outreach/fonts/NotoSans-Regular.ttf?inline'), import('../outreach/fonts/NotoSans-Bold.ttf?inline')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  doc.addFileToVFS('NotoSans-Regular.ttf', base64Of(regular.default))
  doc.addFont('NotoSans-Regular.ttf', PDF_FONT, 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', base64Of(bold.default))
  doc.addFont('NotoSans-Bold.ttf', PDF_FONT, 'bold')
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const room = width - 2 * MARGIN

  doc.setFont(PDF_FONT, 'bold')
  doc.setFontSize(14)
  const title = doc.splitTextToSize(pdfText(content.title), room) as string[]
  doc.text(title, MARGIN, MARGIN + 8)
  let y = MARGIN + 8 + title.length * 17
  doc.setFont(PDF_FONT, 'normal')
  doc.setFontSize(9)
  for (const line of content.lines) {
    const wrapped = doc.splitTextToSize(pdfText(line), room) as string[]
    doc.text(wrapped, MARGIN, y)
    y += wrapped.length * 12
  }
  y += 8

  for (const table of content.tables) {
    // A table's title stays with its first rows: a title that would sit at the foot of a page starts the next one.
    if (y > height - MARGIN - 80) {
      doc.addPage()
      y = MARGIN
    }
    doc.setFont(PDF_FONT, 'bold')
    doc.setFontSize(11)
    doc.text(pdfText(table.title), MARGIN, y + 4)
    autoTable(doc, {
      head: [table.headings.map(pdfText)],
      body: table.rows.map(row => row.map(pdfText)),
      startY: y + 12,
      margin: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + 14 },
      theme: 'grid',
      styles: { font: PDF_FONT, fontSize: 8, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [231, 238, 247], textColor: [16, 24, 40], fontStyle: 'bold' },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22
  }

  const pages = doc.getNumberOfPages()
  doc.setFont(PDF_FONT, 'normal')
  doc.setFontSize(8)
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    if (content.draft) doc.text(pdfText(`Draft: ${DRAFT}`), MARGIN, height - MARGIN / 2)
    doc.text(`Page ${page} of ${pages}`, width - MARGIN, height - MARGIN / 2, { align: 'right' })
  }
  return doc.output('arraybuffer')
}
