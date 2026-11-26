import { formatDate, formatDateTime } from '@hid/ui/display'
import type { OperationsReportExport, ReportExportFormat, ReportFigure } from '../../../staff/api'
import { DRAFT, SMALL_COUNTS, daysText, rangeText, reasonText, shownSections } from './reportRules'

/*
 * What a downloaded report holds, made on this device from the download's own answer (route 2), never from the figures
 * on screen (route 1): the database has already hidden every count from 1 to 4 and every median of fewer than 5, so a
 * file can never hold what that rule hides. A hidden count is written "fewer than 5", a hidden median "not shown (fewer
 * than 5)". The file says which facility, which Lagos days, when it was made (Lagos time), the small-count rule and,
 * while the definitions are a draft, that they await clinical sign-off. Totals only: no patient is named.
 *
 * One content for both formats: CSV is written here; the PDF is drawn by reportPdf.ts, loaded only when asked for.
 */

export const HIDDEN_COUNT = 'fewer than 5'
export const HIDDEN_MEDIAN = 'not shown (fewer than 5)'

export interface ReportTable {
  readonly title: string
  readonly headings: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

export interface ReportFileContent {
  readonly title: string
  /** What the file is, above its tables: facility, range, when made, the small-count rule, the draft notice. */
  readonly lines: readonly string[]
  /** Said at the foot of every PDF page while the definitions are a draft. */
  readonly draft: boolean
  readonly tables: readonly ReportTable[]
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** A count as a file writes it: the number, or "fewer than 5" where the download hid it. */
function countCell(value: number | null | undefined): string {
  return isCount(value) ? String(value) : HIDDEN_COUNT
}

/** A median as a file writes it: whole minutes, "none" with no sample, or "not shown (fewer than 5)" where it was hidden. */
function medianCell(value: number | null | undefined, sampleSize: number | null | undefined, suppressed: boolean | undefined): string {
  if (isCount(value)) return String(value)
  if (!suppressed && sampleSize === 0) return 'none'
  return HIDDEN_MEDIAN
}

function figureCells(figure: ReportFigure): [string, string] {
  if (figure.kind === 'median_minutes') {
    return [medianCell(figure.current, figure.sampleSize, figure.currentSuppressed),
      medianCell(figure.previous, figure.previousSampleSize, figure.previousSuppressed)]
  }
  return [countCell(figure.current), countCell(figure.previous)]
}

/** A figure's note in a file: a median's unit and sample, and the tracked figures' coverage (hidden counts said so). */
function figureNote(figure: ReportFigure, sample: readonly [string, string] | undefined, checkedIn: ReportFigure | undefined): string {
  const notes: string[] = []
  if (figure.kind === 'median_minutes') {
    const plural = sample?.[1] ?? 'records'
    const size = (value: number | null | undefined) => isCount(value) ? String(value) : HIDDEN_COUNT
    notes.push(`In minutes. From ${size(figure.sampleSize)} ${plural} (previous period: ${size(figure.previousSampleSize)}).`)
  }
  if (figure.coverage) {
    notes.push(`Counted for ${countCell(figure.coverage.tracked)} of ${countCell(checkedIn?.current)} check-ins (previous period: `
      + `${countCell(figure.coverage.previousTracked)} of ${countCell(checkedIn?.previous)}).`)
  }
  return notes.join(' ')
}

/** "reports-operations-2026-11-01-to-2026-11-30.csv": the range only, never the facility or a person. */
export function reportFileName(answer: Pick<OperationsReportExport, 'from' | 'to'>, format: ReportExportFormat): string {
  return `reports-operations-${answer.from}-to-${answer.to}.${format}`
}

/** The download's answer as the file's content. */
export function reportFileContent(answer: OperationsReportExport, facilityName: string): ReportFileContent {
  const sections = shownSections(answer)
  const made = answer.export?.recordedAt || answer.generatedAt
  const draft = answer.definitions?.signedOff !== true
  const lines = [
    `Facility: ${facilityName}`,
    `Days: ${rangeText(answer.from, answer.to)} (${daysText(answer.days)}, Lagos days)${answer.includesToday
      ? `. Today, ${formatDate(answer.to)}, is counted up to when the file was made.` : ''}`,
    `Compared with: ${rangeText(answer.previousFrom, answer.previousTo)}`,
    `Made: ${formatDateTime(made)} (Lagos time). This download is recorded.`,
    `${SMALL_COUNTS} Medians from fewer than 5 are not shown.`,
    'Totals only: no patient is named.',
    ...(draft ? [`Draft: ${DRAFT}`] : []),
  ]

  const totals: string[][] = []
  for (const section of sections) {
    const checkedIn = section.figures.find(shown => shown.figure.key === 'checkedIn')?.figure
    for (const { figure, words } of section.figures) {
      const label = figure.kind === 'median_minutes' ? `${words.label} (minutes)` : words.label
      totals.push([section.title, label, ...figureCells(figure), figureNote(figure, words.sample, checkedIn)])
      for (const reason of figure.byReason ?? []) {
        const words = reasonText(reason.reason)
        if (!words) continue
        totals.push([section.title, `${label}: ${words}`, countCell(reason.current), countCell(reason.previous), ''])
      }
    }
  }

  const daily = sections.map(section => {
    const days = section.figures[0]?.figure.daily.map(day => day.day) ?? []
    return {
      title: `${section.title}, day by day`,
      headings: ['Day', ...section.figures.map(({ figure, words }) => figure.kind === 'median_minutes' ? `${words.label} (minutes)` : words.label)],
      rows: days.map(day => [formatDate(day), ...section.figures.map(({ figure }) => {
        const entry = figure.daily.find(candidate => candidate.day === day)
        if (!entry) return ''
        return figure.kind === 'median_minutes' ? medianCell(entry.value, entry.sampleSize, entry.suppressed) : countCell(entry.value)
      })]),
    }
  })

  return {
    title: `Reports & Analytics: operations figures, ${rangeText(answer.from, answer.to)}`,
    lines,
    draft,
    tables: [{ title: 'Totals', headings: ['Section', 'Figure', 'This period', 'Previous period', 'Notes'], rows: totals }, ...daily],
  }
}

// ---- CSV -------------------------------------------------------------------------------------------------------------

/** The byte order mark that tells a spreadsheet the CSV is UTF-8. */
const UTF8_BOM = '\uFEFF'

/** A cell a spreadsheet will not run as a formula (OWASP CSV injection): one starting with = + - @, a tab or a return is quoted. */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break, its quotes doubled. */
function csvField(value: string): string {
  const safe = safeCell(value)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The content as CSV: its title and lines first, then each table under its own title, a blank row between. */
export function reportCsv(content: ReportFileContent): string {
  const rows: (readonly string[])[] = [[content.title], ...content.lines.map(line => [line])]
  for (const table of content.tables) rows.push([], [table.title], table.headings, ...table.rows)
  return UTF8_BOM + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** The file to save: CSV written here, the PDF drawn by reportPdf.ts, loaded only now. */
export async function reportBlob(content: ReportFileContent, format: ReportExportFormat): Promise<Blob> {
  if (format === 'csv') return new Blob([reportCsv(content)], { type: 'text/csv;charset=utf-8' })
  const { reportPdfBytes } = await import('./reportPdf')
  return new Blob([await reportPdfBytes(content)], { type: 'application/pdf' })
}
