import { Fragment } from 'react'
import { EhrBadge } from '@hid/ui/ehr'
import { DeptFacts } from '../parts/DeptRecord'
import { DeptNotice } from '../parts/DeptNotice'

/*
 * The reading of a paper record that the OCR worker writes as an extraction's structured payload under contract
 * 'hid-paper-reading-v2' (hid-system services/ocr-worker/src/reading/contract.ts): the document's text, then each item
 * picked out of it (medicines, diagnoses, allergies, lab results, vitals, notes), each with how sure the reading is.
 * The page shows it read-only, as a guide for the staff check; the payload is checked here before any of it is shown,
 * and a payload of any other shape is left to the page's plain view.
 */

export const PAPER_READING_CONTRACT = 'hid-paper-reading-v2'

export type PaperItemKind = 'medicine' | 'diagnosis' | 'allergy' | 'lab_result' | 'vital' | 'note'
export type PaperReadingStatus = 'read' | 'ai_off' | 'ai_declined' | 'ai_failed' | 'no_text'

export interface PaperItem {
  readonly id: string
  readonly kind: PaperItemKind
  readonly asWritten: string
  readonly plain: string
  readonly dateAsWritten: string | null
  readonly page: number
  readonly confidence: 'clear' | 'check_carefully'
  readonly checkReason: string | null
  readonly fields: Readonly<Record<string, unknown>>
  readonly prescription: { readonly prescriberAsWritten: string | null; readonly dateAsWritten: string | null } | null
}

export interface PaperIdentity {
  readonly nameAsWritten: string | null
  readonly dateOfBirthAsWritten: string | null
  readonly folderNumberAsWritten: string | null
}

/** A page of the paper and why the worker thinks it may not be fully read (its flagReasons codes, as written). */
export interface PaperPage {
  readonly page: number
  readonly flagged: boolean
  readonly flagReasons: readonly string[]
}

export interface PaperReading {
  readonly identity: PaperIdentity
  readonly items: readonly PaperItem[]
  readonly status: PaperReadingStatus
  readonly pages: readonly PaperPage[]
  /** How many things the reader suggested were left out because they could not be found on the page. */
  readonly droppedUngrounded: number
}

/** The groups, in the order the page shows them. */
const GROUPS: ReadonlyArray<{ readonly kind: PaperItemKind; readonly title: string }> = [
  { kind: 'medicine', title: 'Medicines' },
  { kind: 'diagnosis', title: 'Diagnoses' },
  { kind: 'allergy', title: 'Allergies' },
  { kind: 'lab_result', title: 'Lab results' },
  { kind: 'vital', title: 'Vitals' },
  { kind: 'note', title: 'Notes' },
]
const KINDS = new Set<string>(GROUPS.map(group => group.kind))
const STATUSES = new Set<string>(['read', 'ai_off', 'ai_declined', 'ai_failed', 'no_text'])

/** What the page says when the items were not picked out, by why. */
export const READING_STATUS_WORDS: Record<Exclude<PaperReadingStatus, 'read'>, string> = {
  ai_off: 'Only the text was read; items weren’t picked out.',
  ai_failed: 'The items couldn’t be picked out automatically. Enter them by hand.',
  ai_declined: 'The items couldn’t be picked out automatically. Enter them by hand.',
  no_text: 'No text was found on this document.',
}

/**
 * Why a page may not be fully read, in plain words, for each of the worker's flagReasons codes (FLAG_REASONS in the
 * contract). A code not listed here is never shown as it is: it gets FLAG_REASON_UNKNOWN.
 */
export const FLAG_REASON_WORDS: Readonly<Record<string, string>> = {
  low_confidence: 'parts of it are hard to read',
  handwriting: 'handwriting that is hard to read',
  many_dropped: 'some things the reader suggested could not be found on the page',
  ai_unsure: 'the reader was not sure about this page',
  possible_missed_item: 'some lines may have been missed',
  ai_declined: 'the items on this page could not be picked out automatically',
}
export const FLAG_REASON_UNKNOWN = 'something about this page may not have been read properly'

/** What the page says when the reader left out things it could not find on the page. */
export const DROPPED_WORDS = 'Some things the reader suggested were left out because they could not be found on the page.'

/** What the page says when a payload says it is a paper reading but is not whole, so its items are not shown. */
export const NOT_WHOLE_WORDS = 'The items couldn’t be picked out automatically. Enter them by hand.'

const MEDICINE_STATUS: Record<string, string> = {
  current: 'Currently taking', new: 'Newly started', stopped: 'Stopped', past: 'Taken in the past',
}
const DIAGNOSIS_STATUS: Record<string, string> = {
  confirmed: 'Confirmed', suspected: 'Suspected', ruled_out: 'Ruled out', history: 'Past history', family_history: 'Family history',
}
/**
 * Statuses that say the item is not an active part of the patient's care now (stopped, in the past, ruled out, a
 * relative's). They sit beside the bold reading, never at the end of its details, so the name is not taken as active.
 */
const NOT_ACTIVE: Readonly<Record<'medicine' | 'diagnosis', ReadonlySet<string>>> = {
  medicine: new Set(['stopped', 'past']),
  diagnosis: new Set(['ruled_out', 'history', 'family_history']),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : undefined
}

/** True when the payload says it is a paper reading, whatever else it holds. */
export function claimsPaperReading(payload: unknown): boolean {
  return isRecord(payload) && payload.contract === PAPER_READING_CONTRACT
}

function parsePage(value: unknown): PaperPage | null {
  if (!isRecord(value)) return null
  const { page, flagged, flagReasons } = value
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || typeof flagged !== 'boolean') return null
  if (!Array.isArray(flagReasons) || flagReasons.some(reason => typeof reason !== 'string')) return null
  // A page with any reason is treated as flagged, whatever its flag says: a warning is never lost.
  return { page, flagged: flagged || flagReasons.length > 0, flagReasons: flagReasons as string[] }
}

function parseItem(value: unknown): PaperItem | null {
  if (!isRecord(value)) return null
  const { id, kind, asWritten, plain, page, confidence } = value
  if (typeof id !== 'string' || typeof kind !== 'string' || !KINDS.has(kind)) return null
  if (typeof asWritten !== 'string' || !asWritten.trim() || typeof plain !== 'string') return null
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null
  if (confidence !== 'clear' && confidence !== 'check_carefully') return null
  const dateAsWritten = optionalText(value.dateAsWritten)
  const checkReason = optionalText(value.checkReason)
  if (dateAsWritten === undefined || checkReason === undefined) return null
  if (value.fields !== undefined && value.fields !== null && !isRecord(value.fields)) return null
  let prescription: PaperItem['prescription'] = null
  if (value.prescription !== undefined && value.prescription !== null) {
    if (!isRecord(value.prescription)) return null
    const prescriber = optionalText(value.prescription.prescriberAsWritten)
    const date = optionalText(value.prescription.dateAsWritten)
    if (prescriber === undefined || date === undefined) return null
    prescription = { prescriberAsWritten: prescriber, dateAsWritten: date }
  }
  return {
    id, kind: kind as PaperItemKind, asWritten, plain, dateAsWritten, page, confidence, checkReason,
    fields: isRecord(value.fields) ? value.fields : {}, prescription,
  }
}

/**
 * The paper reading in an extraction's structured payload, or null when the payload is not one or is not whole: a
 * reading with any part the page cannot show is not shown in part, so no item is ever silently left out.
 */
export function parsePaperReading(payload: unknown): PaperReading | null {
  if (!claimsPaperReading(payload) || !isRecord(payload)) return null
  const { items, identity, reading, pages } = payload
  if (!Array.isArray(items) || !isRecord(reading) || typeof reading.status !== 'string' || !STATUSES.has(reading.status)) return null
  if (!Array.isArray(pages)) return null
  const { droppedUngrounded } = reading
  if (typeof droppedUngrounded !== 'number' || !Number.isInteger(droppedUngrounded) || droppedUngrounded < 0) return null
  const parsedPages: PaperPage[] = []
  for (const value of pages) {
    const page = parsePage(value)
    if (!page) return null
    parsedPages.push(page)
  }
  if (identity !== undefined && identity !== null && !isRecord(identity)) return null
  const parsed: PaperItem[] = []
  const ids = new Set<string>()
  for (const value of items) {
    const item = parseItem(value)
    if (!item || ids.has(item.id)) return null
    ids.add(item.id); parsed.push(item)
  }
  const person = isRecord(identity) ? identity : {}
  const name = optionalText(person.nameAsWritten)
  const dateOfBirth = optionalText(person.dateOfBirthAsWritten)
  const folderNumber = optionalText(person.folderNumberAsWritten)
  if (name === undefined || dateOfBirth === undefined || folderNumber === undefined) return null
  return {
    identity: { nameAsWritten: name, dateOfBirthAsWritten: dateOfBirth, folderNumberAsWritten: folderNumber },
    items: parsed,
    status: reading.status as PaperReadingStatus,
    pages: parsedPages,
    droppedUngrounded,
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The words for a status that says the item is not active now ("Ruled out", "Stopped"), or null. */
export function itemNotActive(item: PaperItem): string | null {
  if (item.kind !== 'medicine' && item.kind !== 'diagnosis') return null
  const status = text(item.fields.status)
  if (!NOT_ACTIVE[item.kind].has(status)) return null
  return (item.kind === 'medicine' ? MEDICINE_STATUS : DIAGNOSIS_STATUS)[status] ?? null
}

/**
 * The status said beside an item's one line: one that says it is not active now ("Stopped", "Ruled out"), or
 * "Suspected" for a diagnosis that is not confirmed, so it is never read as confirmed. Null otherwise.
 */
export function itemStatusWords(item: PaperItem): string | null {
  if (item.kind === 'diagnosis' && text(item.fields.status) === 'suspected') return DIAGNOSIS_STATUS.suspected ?? null
  return itemNotActive(item)
}

/** Items that need a careful check come first; otherwise the order they were read in (page, then as given). */
export function orderItems(items: readonly PaperItem[]): PaperItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.confidence === b.item.confidence ? 0 : a.item.confidence === 'check_carefully' ? -1 : 1)
      || a.item.page - b.item.page || a.index - b.index)
    .map(({ item }) => item)
}

/** The pages the worker flagged as perhaps not fully read, in page order. */
export function flaggedPages(reading: Pick<PaperReading, 'pages'>): PaperPage[] {
  return reading.pages.filter(page => page.flagged).sort((a, b) => a.page - b.page)
}

/** Why pages may not be fully read, in plain words, each said once; a code it does not know gets a general sentence. */
export function flagReasonWords(codes: readonly string[]): string[] {
  const words = codes.length === 0 ? [FLAG_REASON_UNKNOWN]
    : codes.map(code => Object.prototype.hasOwnProperty.call(FLAG_REASON_WORDS, code) ? FLAG_REASON_WORDS[code]! : FLAG_REASON_UNKNOWN)
  return [...new Set(words)]
}

function listed(numbers: readonly number[]): string {
  return numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
}

/**
 * The warnings for pages that may not be fully read: one for each flagged page, or one for them all when every page
 * of a paper of several pages is flagged. Each says what to do, then why in plain words.
 */
export function pageWarnings(reading: Pick<PaperReading, 'pages'>): Array<{ readonly key: string; readonly text: string; readonly why: string }> {
  const flagged = flaggedPages(reading)
  if (flagged.length === 0) return []
  const why = (pages: readonly PaperPage[]) => `Why: ${flagReasonWords(pages.flatMap(page => page.flagReasons)).join('; ')}.`
  if (flagged.length > 1 && flagged.length === reading.pages.length) {
    return [{ key: 'all', why: why(flagged),
      text: `Pages ${listed(flagged.map(page => page.page))} may not be fully read. Check each whole page against the paper and enter anything missing by hand.` }]
  }
  return flagged.map(page => ({ key: `page-${page.page}`, why: why([page]),
    text: `Page ${page.page} may not be fully read. Check the whole page against the paper and enter anything missing by hand.` }))
}


/**
 * The words the reader writes for a part it could not read (hid-system services/ocr-worker reading/prompt.ts UNREADABLE).
 * It stands for that part only, so an item can be read in part ("Metro[unreadable] 500").
 */
export const UNREADABLE = '[unreadable]'
const UNREADABLE_ANYWHERE = /\[unreadable\]/gi

/**
 * True when nothing of an item could be read: what is written is only UNREADABLE (any case), with at most punctuation
 * and spaces around it. Such an item is never shown as an item nor saved; an item read in part is shown, to check.
 * A mark written only in symbols ("+++", "✓") is a reading, so it stays an item.
 */
export function isUnreadable(item: Pick<PaperItem, 'asWritten'>): boolean {
  return item.asWritten.replace(UNREADABLE_ANYWHERE, '').replace(GAP_ANYWHERE, '').replace(/[\p{P}\s]/gu, '') === ''
}

/*
 * The reader's marks in what is written (hid-system services/ocr-worker reading/prompt.ts), and how the page shows them.
 * The marks are the reader's, not the paper's, so none is shown as a "?":
 *
 * - "word?": a word the reader is unsure of. Shown without the "?", underlined with dots and said as "not sure".
 * - "(or X?)": another possible reading of the word before it. Only under Why?, never in the line nor saved.
 * - "[dose?]", "[freq?]", "[route?]", "[drug?]", "[?]": one part with no readable letters. A small grey "dose",
 *   "frequency", "route", "medicine" or "word"; never saved.
 * - "(? on paper)": a question mark written on the paper itself. Shown and saved as "(? on paper)".
 * - "(crossed out: X)": words crossed out on the paper. Shown struck through; never saved.
 * - "Am… (Ampiclox?)": a word cut off, then the medicine it most likely is. The medicine is shown, as unsure; the
 *   cut-off word is under Why?.
 * - A "-" or "—" bullet at the start of the line is dropped.
 *
 * readingParts splits the words into these parts once; the line shown (ReadingText) and the words saved (cleanReading)
 * are both made from them, so what is seen and what is kept can't differ.
 */
export type ReadingPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unsure'; readonly text: string }
  | { readonly kind: 'gap'; readonly field: GapField }
  | { readonly kind: 'paper_mark' }
  | { readonly kind: 'crossed'; readonly text: string }
  | { readonly kind: 'alternative'; readonly text: string }
  | { readonly kind: 'cut_off'; readonly text: string }

export type GapField = 'dose' | 'frequency' | 'route' | 'medicine' | 'word'

/** What a part that couldn't be read is called, by its mark ("[freq?]" is the frequency). */
const GAP_FIELDS: Readonly<Record<string, GapField>> = {
  dose: 'dose', freq: 'frequency', frequency: 'frequency', route: 'route', drug: 'medicine', medicine: 'medicine', '': 'word',
}
const GAP = /^\[\s*(dose|freq|frequency|route|drug|medicine)?\s*\?\s*\]/i
const GAP_ANYWHERE = /\[\s*(?:dose|freq|frequency|route|drug|medicine)?\s*\?\s*\]/gi
/** Words for the marks shown in place of a "?". */
export const PAPER_MARK = '(? on paper)'
export const NOT_SURE_WORDS = 'not sure'
export const COULD_NOT_READ_WORDS = 'couldn’t be read'

/** The index of the bracket that closes the one at `start`, or -1 when it is never closed. */
function closingBracket(source: string, start: number): number {
  let depth = 0
  for (let at = start; at < source.length; at++) {
    if (source[at] === '(') depth++
    else if (source[at] === ')' && --depth === 0) return at
  }
  return -1
}

/** A run of plain words: each word ending in "?" is unsure, without its "?" (punctuation after it stays plain). */
function wordParts(run: string): ReadingPart[] {
  return run.split(/(\s+)/).filter(Boolean).flatMap((word): ReadingPart[] => {
    const unsure = /^(.*[^?\s])\?+([)\],.;:!]*)$/u.exec(word)
    // A "?" alone, or inside a word ("Metf?rmin"), is left as it is: it is not the reader's mark for an unsure word.
    if (!unsure) return [{ kind: 'text', text: word }]
    return [{ kind: 'unsure', text: unsure[1]! }, ...(unsure[2] ? [{ kind: 'text' as const, text: unsure[2] }] : [])]
  })
}

/** Plain parts side by side become one, and spaces left where a part was taken out become one space. */
function joined(parts: readonly ReadingPart[]): ReadingPart[] {
  const out: ReadingPart[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (part.kind === 'text' && last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: (last.text + part.text).replace(/\s+/g, ' ') }
    else out.push(part.kind === 'text' ? { kind: 'text', text: part.text.replace(/\s+/g, ' ') } : part)
  }
  return out
}

/** The last word of the line so far that is shown: the word another possible reading is compared with. */
function lastShownWord(parts: readonly ReadingPart[]): string {
  for (let at = parts.length - 1; at >= 0; at--) {
    const part = parts[at]!
    if (part.kind !== 'text' && part.kind !== 'unsure') continue
    const words = part.text.trim().split(/\s+/).filter(Boolean)
    if (words.length > 0) return words[words.length - 1]!
  }
  return ''
}

/** What is written, split into the reader's marks and the words between them (see above). */
export function readingParts(asWritten: string): ReadingPart[] {
  const source = asWritten.replace(/^\s*[-–—•*]+\s+/u, '')
  const parts: ReadingPart[] = []
  let run = ''
  const flush = () => { if (run) parts.push(...wordParts(run)); run = '' }
  for (let at = 0; at < source.length;) {
    const char = source[at]!
    if (char === '[') {
      const gap = GAP.exec(source.slice(at))
      if (gap) {
        flush()
        parts.push({ kind: 'gap', field: GAP_FIELDS[(gap[1] ?? '').toLowerCase()] ?? 'word' })
        at += gap[0].length
        continue
      }
    }
    if (char === '(') {
      const end = closingBracket(source, at)
      const inside = end > at ? source.slice(at + 1, end).trim() : null
      if (inside !== null && /^\?\s*on (the )?paper$/i.test(inside)) {
        flush(); parts.push({ kind: 'paper_mark' }); at = end + 1; continue
      }
      const crossed = inside !== null ? /^crossed out\s*:\s*([\s\S]*)$/i.exec(inside) : null
      if (crossed) {
        flush()
        const text = cleanReading(crossed[1]!)
        if (text) parts.push({ kind: 'crossed', text })
        at = end + 1; continue
      }
      const alternative = inside !== null ? /^or\s+([\s\S]*)$/i.exec(inside) : null
      if (alternative) {
        flush()
        const text = cleanReading(alternative[1]!)
        // One that is only a part that couldn't be read, or the same as the word it is another reading of, says nothing.
        if (text && text.toLowerCase() !== lastShownWord(parts).toLowerCase()) parts.push({ kind: 'alternative', text })
        at = end + 1; continue
      }
      const cutOff = inside ? /(\S+(?:…|\.\.\.))\s*$/u.exec(run) : null
      const match = inside ? cleanReading(inside) : ''
      if (cutOff && match) {
        run = run.slice(0, cutOff.index)
        flush()
        parts.push({ kind: 'cut_off', text: cutOff[1]! }, { kind: 'unsure', text: match })
        at = end + 1; continue
      }
    }
    run += char
    at++
  }
  flush()
  return joined(parts)
}

/**
 * What is saved for words read from the paper: the reading alone, with no reader's marks. An unsure word is kept
 * without its "?"; another possible reading, a part that couldn't be read, words crossed out and a cut-off word are
 * left out; a question mark written on the paper is kept as "(? on paper)". Pure, and the same parts the line shows.
 */
export function cleanReading(asWritten: string): string {
  return partsText(readingParts(asWritten))
}

/** The parts' words as shown in the line and saved, in plain text. */
function partsText(parts: readonly ReadingPart[]): string {
  return parts.map(part => part.kind === 'text' || part.kind === 'unsure' ? part.text : part.kind === 'paper_mark' ? ` ${PAPER_MARK} ` : ' ')
    .join('').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim()
}

/** What the reader also said about a line, for Why?: other possible readings, and a word cut off on the paper. */
export function readingNotes(asWritten: string): string[] {
  const notes = readingParts(asWritten).flatMap(part => part.kind === 'alternative' ? [`Other possible reading: ${part.text}`]
    : part.kind === 'cut_off' ? [`Written as: ${part.text}`] : [])
  return [...new Set(notes)]
}

/** The words of a line read from the paper, with the reader's marks shown as words and styles, never as "?". */
export function ReadingText({ text }: { readonly text: string }) {
  const parts = readingParts(text).filter(part => part.kind !== 'alternative' && part.kind !== 'cut_off')
  // Spaces where a part was taken out are said once, and none at either end.
  const shown = joined(parts).map((part, at, all) => {
    if (part.kind !== 'text') return part
    const start = at === 0 ? part.text.trimStart() : part.text
    return { ...part, text: at === all.length - 1 ? start.trimEnd() : start }
  })
  return <>{shown.map((part, at) => {
    switch (part.kind) {
      case 'text': return <Fragment key={at}>{part.text}</Fragment>
      case 'unsure': return <span key={at} className="hid-ehr-dept-migrate-unsure" title={NOT_SURE_WORDS}>{part.text}<span className="hid-ehr-sr-only">{` (${NOT_SURE_WORDS})`}</span></span>
      case 'gap': return <span key={at} className="hid-ehr-dept-migrate-gap" title={COULD_NOT_READ_WORDS}>{part.field}<span className="hid-ehr-sr-only">{` ${COULD_NOT_READ_WORDS}`}</span></span>
      case 'paper_mark': return <span key={at} className="hid-ehr-dept-migrate-gap" title="A question mark written on the paper">? on paper</span>
      case 'crossed': return <s key={at} className="hid-ehr-dept-migrate-crossed"><span className="hid-ehr-sr-only">crossed out: </span>{part.text}</s>
      default: return null
    }
  })}</>
}

/** True when part of what is written couldn't be read ("Metro[unreadable] 500"). */
function partlyUnreadable(item: Pick<PaperItem, 'asWritten'>): boolean {
  return /\[unreadable\]/i.test(item.asWritten)
}

/**
 * True when an item must be checked before it is kept: the reader said so, or part of what is written couldn't be read
 * (even when the reader marked it clear), so it never starts as kept and always carries the Check mark.
 */
export function needsCheck(item: Pick<PaperItem, 'asWritten' | 'confidence'>): boolean {
  return item.confidence === 'check_carefully' || partlyUnreadable(item)
}

/** Keys of an item's fields that say nothing read from the paper by themselves. */
const NOT_A_READING = new Set(['status', 'measure', 'noKnownAllergies', 'severity', 'flag'])

/**
 * What the reader guessed for a line it couldn't read, from the fields it still filled in ("Paracetamol 500 mg"), or
 * null when it filled in none. Never saved: only named under the line that says how many couldn't be read.
 */
export function readerGuess(item: PaperItem): string | null {
  const parts = Object.entries(item.fields)
    .filter(([key]) => !NOT_A_READING.has(key))
    .map(([, value]) => typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value))
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/** The items that could be read at all, in the order given. */
export function readableItems(items: readonly PaperItem[]): PaperItem[] {
  return items.filter(item => !isUnreadable(item))
}

/**
 * The one line a doctor reads for an item, with the reader's marks: what is written (a part that couldn't be read as
 * "…"), else the summary. Shown through ReadingText; its words alone are itemHeadlineText.
 */
export function itemHeadline(item: PaperItem): string {
  const written = item.asWritten.replace(UNREADABLE_ANYWHERE, '…').trim()
  return written && cleanReading(written) ? written : item.plain.trim()
}

/** The words of an item's one line as they are shown and saved, with no reader's marks. */
export function itemHeadlineText(item: PaperItem): string {
  return cleanReading(itemHeadline(item))
}

/** Why an item needs checking, in the reader's words, or a general sentence. */
export function checkReasonWords(item: PaperItem): string {
  return item.checkReason?.trim() || (partlyUnreadable(item) ? 'Part of this line couldn’t be read.' : 'Check this against the document.')
}

/** What a list says, in place of items, for the lines that couldn't be read at all. */
export function unreadableWords(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'} couldn’t be read. Check the paper.`
}

/** How sure the reading of a document is, as said under Details (or on its own for a reading that is not a paper reading). */
export function confidenceWords(confidence: number): string {
  return `Read with ${Math.round(confidence * 100)}% confidence. Check it against the document.`
}

/**
 * The header's count: "7 items read · 2 to check". Lines that couldn't be read at all are not counted. A page that may
 * not be fully read is said by the line above the reading, not here.
 */
export function readingSummary(items: readonly PaperItem[]): string {
  const readable = readableItems(items)
  const careful = readable.filter(needsCheck).length
  const read = `${readable.length} ${readable.length === 1 ? 'item' : 'items'} read`
  return careful ? `${read} · ${careful} to check` : read
}

/**
 * The one short line shown above a reading that may not be complete ("Hard handwriting. Check the marked items."), or
 * null when the pages read cleanly and nothing was left out.
 */
export function readingStatusLine(reading: PaperReading): string | null {
  const flagged = flaggedPages(reading)
  if (flagged.length === 0 && reading.droppedUngrounded === 0) return null
  const codes = new Set(flagged.flatMap(page => page.flagReasons))
  const what = codes.has('handwriting') ? 'Hard handwriting.' : codes.has('low_confidence') ? 'Hard to read.' : 'May not be fully read.'
  const marked = reading.status === 'read' && readableItems(reading.items).some(needsCheck)
  return `${what} ${marked ? 'Check the marked items.' : 'Check it against the paper.'}`
}

/**
 * The small "Check" mark an item to check carries, and why, behind "Why?". A word, not "?", so it is never taken for a
 * "?" copied off the paper ("Ceftriaxone ? IV").
 */
export function ItemCheck({ item }: { readonly item: PaperItem }) {
  const check = needsCheck(item)
  // Other possible readings and a cut-off word wait here, closed, so the line itself carries one reading.
  const notes = readingNotes(itemHeadline(item))
  if (!check && notes.length === 0) return null
  return <span className="hid-ehr-dept-migrate-check-mark">
    {check && <EhrBadge tone="caution">Check</EhrBadge>}
    <details className="hid-ehr-dept-migrate-why">
      <summary>Why?</summary>
      {check && <span className="hid-ehr-dept-muted">{checkReasonWords(item)}</span>}
      {notes.map(note => <span key={note} className="hid-ehr-dept-muted">{note}</span>)}
    </details>
  </span>
}

/** An item's one line with its status, when it has one ("Malaria — Suspected"), in words, with no reader's marks. */
export function itemLine(item: PaperItem): string {
  const status = itemStatusWords(item)
  return `${itemHeadlineText(item)}${status ? ` — ${status}` : ''}`
}

/** An item's one line as shown: the words with the reader's marks as styles (ReadingText), then its status. */
export function ItemLineText({ item }: { readonly item: PaperItem }) {
  const status = itemStatusWords(item)
  return <><ReadingText text={itemHeadline(item)} />{status ? ` — ${status}` : ''}</>
}

/**
 * Under a list, in place of the lines that couldn't be read at all: how many, and what the reader guessed for any of
 * them, behind a closed disclosure, so nothing it suggested is hidden without a word. None of it is saved.
 */
export function UnreadableLines({ items }: { readonly items: readonly PaperItem[] }) {
  const unreadable = items.filter(isUnreadable)
  if (unreadable.length === 0) return null
  const guesses = unreadable.map(readerGuess).filter((guess): guess is string => !!guess)
  return <div className="hid-ehr-dept-migrate-unreadable">
    <p className="hid-ehr-dept-muted">{unreadableWords(unreadable.length)}</p>
    {guesses.length > 0 && <details className="hid-ehr-dept-migrate-why">
      <summary>What the reader guessed</summary>
      <span className="hid-ehr-dept-muted">{`Not saved: ${guesses.join('; ')}.`}</span>
    </details>}
  </div>
}

function PaperItemRow({ item }: { readonly item: PaperItem }) {
  return <li data-item-id={item.id} className="hid-ehr-dept-migrate-line">
    <strong><ItemLineText item={item} /></strong>
    <ItemCheck item={item} />
  </li>
}

/** The header's line: how many items were read and how many to check. */
export function PaperReadingSummary({ reading }: { readonly reading: PaperReading }) {
  if (reading.status !== 'read') return null
  return <span className="hid-ehr-dept-muted">{readingSummary(reading.items)}</span>
}

/**
 * Shown first, above anything read: one short line when the reading may not be complete, so staff never take the items
 * as all there is on the paper. Which pages, why, what was left out and how sure the reading is wait under Details.
 * Nothing when the pages read cleanly.
 */
export function PaperReadingWarnings({ reading, confidence }: { readonly reading: PaperReading; readonly confidence?: number | null }) {
  const line = readingStatusLine(reading)
  if (!line) return null
  return <DeptNotice tone="caution" className="hid-ehr-dept-migrate-reading-warnings">
    <p><strong>{line}</strong></p>
    <details className="hid-ehr-dept-migrate-details">
      <summary>Details</summary>
      {pageWarnings(reading).map(warning => <Fragment key={warning.key}>
        <p>{warning.text}</p>
        <p>{warning.why}</p>
      </Fragment>)}
      {reading.droppedUngrounded > 0 && <p>{DROPPED_WORDS}</p>}
      {confidence != null && <p>{confidenceWords(confidence)}</p>}
    </details>
  </DeptNotice>
}

/** What the page says when none of name, date of birth or folder number was found on the paper. */
export const NO_IDENTITY_WORDS = 'No name or date of birth on the paper. Make sure this is the right patient.'
/** What the page says under the name, date of birth or folder number found on the paper. */
export const CHECK_IDENTITY_WORDS = 'Make sure this is the right patient.'

/** Who the paper is about, so staff can confirm it is the right patient, then the items, grouped by kind. */
export function PaperReadingView({ reading }: { readonly reading: PaperReading }) {
  const { identity } = reading
  const facts = [
    { label: 'Name on the paper', value: identity.nameAsWritten?.trim() },
    { label: 'Date of birth on the paper', value: identity.dateOfBirthAsWritten?.trim() },
    { label: 'Folder number', value: identity.folderNumberAsWritten?.trim() },
  ].filter((fact): fact is { label: string; value: string } => !!fact.value)
  return <div className="hid-ehr-dept-migrate-reading">
    <div>
      <h3>Who the paper is about</h3>
      {facts.length > 0
        ? <><DeptFacts facts={facts} /><p className="hid-ehr-dept-muted">{CHECK_IDENTITY_WORDS}</p></>
        : <p className="hid-ehr-dept-muted">{NO_IDENTITY_WORDS}</p>}
    </div>
    {reading.status !== 'read'
      ? <p role="note" className="hid-ehr-dept-muted">{READING_STATUS_WORDS[reading.status]}</p>
      : reading.items.length === 0
        ? <p className="hid-ehr-dept-muted">No medicines, diagnoses, allergies, results or notes were picked out. Check the document.</p>
        : GROUPS.map(group => {
          const items = orderItems(reading.items.filter(item => item.kind === group.kind))
          if (items.length === 0) return null
          const readable = readableItems(items)
          const headingId = `ocr-read-${group.kind}`
          return <section key={group.kind} aria-labelledby={headingId}>
            <h3 id={headingId}>{group.title}</h3>
            {readable.length > 0 && <ul className="hid-ehr-dept-rows">{readable.map(item => <PaperItemRow key={item.id} item={item} />)}</ul>}
            <UnreadableLines items={items} />
          </section>
        })}
  </div>
}
