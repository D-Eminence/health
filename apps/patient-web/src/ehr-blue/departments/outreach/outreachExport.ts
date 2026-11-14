import type { OutreachCampaign, OutreachCase, OutreachCasesPage, OutreachScreening } from '../../../staff/api'
import { birthDateText, dateText } from '../parts/format'
import { statusLabel } from './outreachParts'
import { GLUCOSE_TIMINGS, HEARING, MALARIA, readBloodTests } from './screening'

/*
 * Export of the registrations a person can already see on Outreach (the list read, GET outreach/registration-cases),
 * as CSV, Excel, Word or PDF. Made on this device from what is on screen: nothing is asked of the server.
 *
 * Every column a file carries is defined here, once (OUTREACH_EXPORT_COLUMNS), so a later column (a health check
 * result, say) is added in one place and reaches all four formats. No internal id or raw code is written: codes are
 * said in words, and a value the page has no words for is left out rather than printed as its code.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'docx' | 'pdf'

export const EXPORT_FORMATS: ReadonlyArray<{ readonly value: ExportFormat; readonly label: string; readonly hint: string }> = [
  { value: 'csv', label: 'CSV', hint: 'A plain table that opens in Excel, Google Sheets or any spreadsheet.' },
  { value: 'xlsx', label: 'Excel (.xlsx)', hint: 'A spreadsheet for Microsoft Excel.' },
  { value: 'docx', label: 'Word (.docx)', hint: 'A table in a Word document, to print or share.' },
  { value: 'pdf', label: 'PDF', hint: 'A printable table that cannot easily be changed.' },
]

/**
 * A registration as the list may carry it. Only what OutreachCase names is certain; the rest is read when Outreach sends
 * it (a newer Outreach, or the consent sent with a registration at an outreach group) and its column is left out of the
 * file when no registration has it.
 */
export type ExportCase = OutreachCase & {
  readonly dateOfBirth?: unknown
  readonly address?: unknown
  readonly area?: unknown
  readonly registeredByName?: unknown
  readonly registeredBy?: unknown
  readonly guardianName?: unknown
  readonly guardianPhone?: unknown
  readonly guardianRelationship?: unknown
  readonly consent?: unknown
  readonly consentTextVersion?: unknown
  readonly healthId?: unknown
  readonly hid?: unknown
  readonly hasScreening?: unknown
  readonly healthIdCreatedByOutreach?: unknown
  /** The health checks recorded for this registration, read for the file (readScreenings); absent when not read. */
  readonly screening?: OutreachScreening | null
}

/** What a row's words may need beyond the registration itself. */
export interface ExportContext {
  /** The campaign a registration names, when the page has read it. */
  readonly campaignOf: (campaignId: string | undefined) => Pick<OutreachCampaign, 'name'> | undefined
}

export interface ExportColumn {
  /** The column's heading, in plain words. */
  readonly heading: string
  /** Left out of the file when no registration has a value for it. */
  readonly optional?: boolean
  /** The cell's words; '' when there is nothing to say. */
  readonly value: (item: ExportCase, context: ExportContext) => string
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
/** A value that looks like an internal id (a UUID), which a file never carries. */
const looksLikeId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const words = (map: Readonly<Record<string, string>>, code: string) => (Object.hasOwn(map, code) ? map[code]! : '')

const SEX: Readonly<Record<string, string>> = { female: 'Female', male: 'Male', other: 'Other', unknown: 'Not known' }
const LANGUAGE: Readonly<Record<string, string>> = { en: 'English', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo', pcm: 'Nigerian Pidgin' }
const CONSENT_METHOD: Readonly<Record<string, string>> = {
  verbal_read_aloud: 'Notice read aloud, they agreed',
  self_ticked: 'They read it and agreed',
  guardian: 'Their parent or guardian agreed',
}
const RELATIONSHIP: Readonly<Record<string, string>> = {
  parent: 'Parent', mother: 'Mother', father: 'Father', guardian: 'Guardian', grandparent: 'Grandparent', sibling: 'Brother or sister',
  relative: 'Relative', other: 'Other',
}

const consentOf = (item: ExportCase) => record(item.consent)
const yesNo = (value: unknown) => (value === true ? 'Yes' : value === false ? 'No' : '')

/** The day of a date of birth, written out ("4 Mar 1991"). */
function birthDate(item: ExportCase) {
  return birthDateText(text(item.dateOfBirth))
}

function age(item: ExportCase) {
  if (typeof item.ageYears === 'number' && Number.isFinite(item.ageYears)) return String(item.ageYears)
  const born = text(item.dateOfBirth)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(born) ? new Date(`${born}T00:00:00`) : new Date(born)
  if (!born || Number.isNaN(day.getTime())) return ''
  const now = new Date()
  let years = now.getFullYear() - day.getFullYear()
  if (now < new Date(now.getFullYear(), day.getMonth(), day.getDate())) years -= 1
  return years >= 0 ? String(years) : ''
}

function registeredBy(item: ExportCase) {
  const named = text(item.registeredByName) || text(record(item.registeredBy)?.name)
  if (named) return named
  const given = text(item.registeredBy)
  return given && !looksLikeId(given) ? given : ''
}

/** A number as written ("36.8"); '' when none. */
const numberText = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')
/** A choice in the words the Health checks form gives it; '' for a code it has no words for. */
const choiceWords = (choices: ReadonlyArray<{ readonly value: string; readonly label: string }>, code: unknown) =>
  choices.find(choice => choice.value === code)?.label ?? ''
/** One health check of the registration, when read. */
function check<K extends keyof OutreachScreening>(item: ExportCase, name: K): OutreachScreening[K] | undefined {
  return item.screening ? item.screening[name] : undefined
}

function bloodPressure(item: ExportCase) {
  const top = numberText(check(item, 'bpSystolic'))
  const bottom = numberText(check(item, 'bpDiastolic'))
  return top && bottom ? `${top}/${bottom}` : ''
}

/** "5.4 mmol/L, fasting". */
function bloodSugar(item: ExportCase) {
  const value = numberText(check(item, 'glucoseValue'))
  if (!value) return ''
  const unit = text(check(item, 'glucoseUnit'))
  const timing = choiceWords(GLUCOSE_TIMINGS, check(item, 'glucoseTiming')).toLowerCase()
  return `${value}${unit ? ` ${unit}` : ''}${timing ? `, ${timing}` : ''}`
}

/** Genotype and blood group are kept at the start of "Outcome or advice" (screening.ts readBloodTests): each in its own column. */
const bloodTests = (item: ExportCase) => readBloodTests(text(check(item, 'outcome')))

/** "Paracetamol (500 mg); ORS". */
function medicines(item: ExportCase) {
  const given = check(item, 'medicinesGiven')
  if (!Array.isArray(given)) return ''
  return (given as unknown[]).map(medicine => {
    const name = text(record(medicine)?.name)
    const dose = text(record(medicine)?.dose)
    return name ? `${name}${dose ? ` (${dose})` : ''}` : ''
  }).filter(Boolean).join('; ')
}

function healthId(item: ExportCase) {
  const hid = text(item.healthId) || text(item.hid)
  // A Health ID as it is written on the person's card; never an internal id.
  return hid && !looksLikeId(hid) ? hid.toUpperCase() : ''
}

/**
 * The columns every export carries, in order. Add a column here and it reaches CSV, Excel, Word and PDF.
 */
export const OUTREACH_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { heading: 'Full name', value: item => text(item.fullName) },
  { heading: 'Sex', value: item => words(SEX, text(item.sex).toLowerCase()) },
  { heading: 'Date of birth', optional: true, value: birthDate },
  { heading: 'Age (years)', value: age },
  { heading: 'Phone number', value: item => text(item.phone) },
  { heading: 'Area or address', optional: true, value: item => text(item.address) || text(item.area) },
  { heading: 'Campaign', value: (item, context) => (item.campaignId ? context.campaignOf(item.campaignId)?.name ?? 'A campaign not listed here' : 'No campaign') },
  { heading: 'Registered on', value: item => (item.createdAt ? dateText(item.createdAt) : '') },
  { heading: 'Registered by', optional: true, value: registeredBy },
  { heading: 'Status', value: item => statusLabel(item.status) },
  { heading: 'Health ID', optional: true, value: healthId },
  { heading: 'Health ID made at outreach', optional: true, value: item => yesNo(item.healthIdCreatedByOutreach) },
  { heading: 'Health check done', optional: true, value: item => yesNo(item.hasScreening) },
  // The health checks recorded (read for the file by readScreenings), in the words the Health checks form uses.
  { heading: 'Blood pressure', optional: true, value: bloodPressure },
  { heading: 'Pulse', optional: true, value: item => numberText(check(item, 'pulseBpm')) },
  { heading: 'Temperature (°C)', optional: true, value: item => numberText(check(item, 'temperatureC')) },
  { heading: 'Weight (kg)', optional: true, value: item => numberText(check(item, 'weightKg')) },
  { heading: 'Height (cm)', optional: true, value: item => numberText(check(item, 'heightCm')) },
  { heading: 'Blood sugar', optional: true, value: bloodSugar },
  { heading: 'Malaria test', optional: true, value: item => choiceWords(MALARIA, check(item, 'malariaRdt')) },
  { heading: 'Hearing left', optional: true, value: item => choiceWords(HEARING, check(item, 'hearingLeft')) },
  { heading: 'Hearing right', optional: true, value: item => choiceWords(HEARING, check(item, 'hearingRight')) },
  { heading: 'Genotype', optional: true, value: item => bloodTests(item).genotype },
  { heading: 'Blood group', optional: true, value: item => bloodTests(item).bloodGroup },
  { heading: 'Main complaint', optional: true, value: item => text(check(item, 'mainComplaint')) },
  { heading: 'Seen by clinician', optional: true, value: item => yesNo(check(item, 'seenByClinician')) },
  { heading: 'Clinician’s name', optional: true, value: item => text(check(item, 'clinicianName')) },
  { heading: 'Outcome or advice', optional: true, value: item => bloodTests(item).rest.trim() },
  { heading: 'Medicines given', optional: true, value: medicines },
  { heading: 'Referred', optional: true, value: item => yesNo(check(item, 'referred')) },
  { heading: 'Referred to', optional: true, value: item => text(check(item, 'referredTo')) },
  { heading: 'Possible duplicate', optional: true, value: item => (item.possibleDuplicate === true ? 'Yes' : '') },
  { heading: 'Parent or guardian', optional: true, value: item => text(item.guardianName) || text(consentOf(item)?.guardianName) },
  { heading: 'Parent or guardian’s relationship', optional: true, value: item => words(RELATIONSHIP, text(item.guardianRelationship).toLowerCase()) },
  { heading: 'Parent or guardian’s phone', optional: true, value: item => text(item.guardianPhone) },
  { heading: 'How they agreed', optional: true, value: item => words(CONSENT_METHOD, text(consentOf(item)?.method)) },
  { heading: 'Notice language', optional: true, value: item => words(LANGUAGE, text(consentOf(item)?.language)) },
  { heading: 'Notice version', optional: true, value: item => text(item.consentTextVersion) || text(consentOf(item)?.textVersion) },
  { heading: 'Notes for the team', optional: true, value: item => text(item.operationalNotes) },
]

/** A table of words: what every format writes. */
export interface ExportTable {
  readonly headings: readonly string[]
  readonly rows: ReadonlyArray<readonly string[]>
}

/**
 * The registrations as a table, newest first (as the list shows them): every column, less the optional ones no
 * registration has a value for.
 */
export function rowsFor(cases: readonly ExportCase[], context: ExportContext, columns: readonly ExportColumn[] = OUTREACH_EXPORT_COLUMNS): ExportTable {
  const sorted = [...cases].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
  const cells = sorted.map(item => columns.map(column => column.value(item, context)))
  const kept = columns.map((column, index) => !column.optional || cells.some(row => row[index] !== ''))
  return {
    headings: columns.filter((_, index) => kept[index]).map(column => column.heading),
    rows: cells.map(row => row.filter((_, index) => kept[index])),
  }
}

/** A phone number or plain number ("+234 801 234 5678", "(0803) 123-4567"): nothing a spreadsheet would run. */
const PHONE_OR_NUMBER = /^\+?[0-9][0-9 ()-]*$/

/**
 * A cell a spreadsheet will not run as a formula: one starting with = + - @, a tab or a carriage return is written
 * after a single quote (OWASP CSV injection). A phone number or plain number is left as it is ("+2348012345678"); a
 * "+" followed by anything else is still quoted.
 */
export function safeCell(value: string): string {
  if (PHONE_OR_NUMBER.test(value)) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/** Every cell made safe for a spreadsheet (CSV and Excel). */
export function spreadsheetSafe(table: ExportTable): ExportTable {
  return { headings: table.headings.map(safeCell), rows: table.rows.map(row => row.map(safeCell)) }
}

/** The byte order mark that tells Excel a CSV is UTF-8, so names like Adébáyọ̀ open as written. */
export const UTF8_BOM = '﻿'

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break, its quotes doubled. */
function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The table as CSV: a UTF-8 byte order mark, CRLF line ends, every cell made safe for a spreadsheet. */
export function toCsv(table: ExportTable): string {
  const safe = spreadsheetSafe(table)
  return UTF8_BOM + [safe.headings, ...safe.rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** A name as a file name part: "Demo Screening Week!" → "demo-screening-week". */
export function slug(name: string): string {
  const made = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    .replace(/-+$/, '')
  return made || 'campaign'
}

/** Today's date on this device as YYYY-MM-DD. */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "outreach-demo-screening-week-2026-11-14.csv"; "outreach-all-registrations-…" when no campaign is chosen. */
export function exportFileName(campaignName: string | undefined, format: ExportFormat, now: Date): string {
  return `outreach-${campaignName ? slug(campaignName) : 'all-registrations'}-${localDay(now)}.${format}`
}

/** What a file says above its table. */
export interface ExportMeta {
  readonly title: string
  readonly subtitle: string
}

export function exportMeta(campaignName: string | undefined, count: number, now: Date): ExportMeta {
  return {
    title: campaignName ? `Outreach registrations: ${campaignName}` : 'Outreach registrations: all campaigns',
    subtitle: `${count} ${count === 1 ? 'registration' : 'registrations'}. Exported ${dateText(now.toISOString())}. `
      + 'Contains personal and health information: keep it safe and delete it when you are done.',
  }
}

/** Rows asked for a page, and the most pages read: 10,000 registrations. */
export const EXPORT_PAGE_SIZE = 500
export const EXPORT_PAGE_LIMIT = 20
/** What an Outreach before paging (hid-system#247) sends: its newest 100, with no cursor. */
export const UNPAGED_LIST_SIZE = 100

export const EXPORT_CAPPED = `Showing the first ${(EXPORT_PAGE_SIZE * EXPORT_PAGE_LIMIT).toLocaleString('en-GB')} registrations. The file holds only these.`
export const EXPORT_LATEST_100 = 'Only the latest 100 registrations could be exported.'

/** Every registration read for an export, and what the file may be missing. */
export interface ExportRead {
  readonly cases: OutreachCase[]
  /** More were left after the last page read (EXPORT_PAGE_LIMIT). */
  readonly capped: boolean
  /** The first page came with no cursor and exactly 100 rows: an Outreach before paging, which sends only its newest 100. */
  readonly latestOnly: boolean
}

/**
 * Reads every page of registrations, newest first, following X-Next-Cursor until it is no longer sent, for at most
 * EXPORT_PAGE_LIMIT pages. `onProgress` is told how many rows have been read so far.
 */
export async function readAllCases(readPage: (before: string | undefined) => Promise<OutreachCasesPage>,
  onProgress: (rows: number) => void = () => {}): Promise<ExportRead> {
  const seen = new Map<string, OutreachCase>()
  let before: string | undefined
  let latestOnly = false
  for (let page = 0; page < EXPORT_PAGE_LIMIT; page += 1) {
    const answer = await readPage(before)
    for (const item of answer.items) if (!seen.has(item.id)) seen.set(item.id, item)
    onProgress(seen.size)
    if (page === 0 && !answer.nextCursor && answer.items.length === UNPAGED_LIST_SIZE) latestOnly = true
    // A cursor that does not move on would read the same page for ever.
    if (!answer.nextCursor || answer.nextCursor === before || answer.items.length === 0) return { cases: [...seen.values()], capped: false, latestOnly }
    before = answer.nextCursor
  }
  return { cases: [...seen.values()], capped: true, latestOnly }
}

/** How many health checks are read at once for a file: a few, so a weak signal is not swamped. */
export const SCREENING_READS_AT_ONCE = 3
/** Reads that fail one after another before the rest are left unread (no signal): each waits up to 10 s. */
export const SCREENING_FAILURES_TO_STOP = 6

/** The health checks read for a file, and how many people's could not be read. */
export interface ScreeningsRead {
  readonly screenings: ReadonlyMap<string, OutreachScreening | null>
  readonly failed: number
}

/**
 * Reads the health checks of each registration that has them (hasScreening true), SCREENING_READS_AT_ONCE at a time,
 * never all at once. A read that fails leaves that person's out (counted in `failed`) and the rest go on; once
 * SCREENING_FAILURES_TO_STOP have failed one after another, the rest are not tried and are counted as failed too.
 * `onProgress` is told how many are done of how many.
 */
export async function readScreenings(cases: readonly OutreachCase[], readOne: (caseId: string) => Promise<{ screening: OutreachScreening | null }>,
  onProgress: (done: number, total: number) => void = () => {}): Promise<ScreeningsRead> {
  const wanted = cases.filter(item => item.hasScreening === true).map(item => item.id)
  const screenings = new Map<string, OutreachScreening | null>()
  let failed = 0
  let failedInARow = 0
  let done = 0
  let next = 0
  if (wanted.length > 0) onProgress(0, wanted.length)
  async function worker() {
    while (next < wanted.length) {
      const caseId = wanted[next]!
      next += 1
      if (failedInARow >= SCREENING_FAILURES_TO_STOP) {
        failed += 1
      } else {
        try {
          const answer = await readOne(caseId)
          screenings.set(caseId, answer?.screening ?? null)
          failedInARow = 0
        } catch {
          failed += 1
          failedInARow += 1
        }
      }
      done += 1
      onProgress(done, wanted.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCREENING_READS_AT_ONCE, wanted.length) }, worker))
  return { screenings, failed }
}

/** What the file says is missing when some people's health checks could not be read. */
export function screeningsFailed(count: number): string {
  return `${count} ${count === 1 ? 'person’s' : 'people’s'} health checks couldn’t be read and are blank in the file. Export again with better signal.`
}

const MIME: Readonly<Record<ExportFormat, string>> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

/**
 * The file, made on this device. CSV is written here; Excel, Word and PDF load what makes them (outreachExportFiles.ts
 * and its libraries) only when asked, so the page itself does not grow.
 */
export async function buildExport(format: ExportFormat, table: ExportTable, meta: ExportMeta): Promise<Blob> {
  if (format === 'csv') return new Blob([toCsv(table)], { type: MIME.csv })
  const files = await import('./outreachExportFiles')
  if (format === 'xlsx') return new Blob([await files.xlsxBytes(spreadsheetSafe(table), meta)], { type: MIME.xlsx })
  if (format === 'docx') return new Blob([await files.docxBytes(table, meta)], { type: MIME.docx })
  return new Blob([await files.pdfBytes(table, meta)], { type: MIME.pdf })
}
