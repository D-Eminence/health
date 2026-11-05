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

const ALLERGY_SEVERITY: Record<string, string> = {
  mild: 'Mild', moderate: 'Moderate', severe: 'Severe', unknown: 'Severity not known',
}
const VITAL_MEASURE: Record<string, string> = {
  blood_pressure: 'Blood pressure', pulse: 'Pulse', temperature: 'Temperature', respiratory_rate: 'Breathing rate',
  oxygen_saturation: 'Oxygen saturation', weight: 'Weight', height: 'Height', blood_glucose: 'Blood glucose',
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

/** An item's own details, by kind, as short phrases: what the bold reading and "As written" do not already say. */
export function itemDetails(item: PaperItem): string[] {
  const f = item.fields
  const details: string[] = []
  const add = (value: string) => { if (value) details.push(value) }
  const labelled = (label: string, value: unknown) => { const words = text(value); if (words) details.push(`${label} ${words}`) }
  // A status that says the item is not active is shown beside the reading (itemNotActive), so it is not repeated here.
  const status = itemNotActive(item) ? '' : text(f.status)
  switch (item.kind) {
    case 'medicine':
      add(text(f.strength)); add(text(f.form)); add(text(f.route)); add(text(f.frequency))
      labelled('for', f.duration)
      add(MEDICINE_STATUS[status] ?? '')
      if (item.prescription) {
        labelled('Prescribed by', item.prescription.prescriberAsWritten)
        labelled('Prescribed on', item.prescription.dateAsWritten)
      }
      break
    case 'diagnosis':
      add(DIAGNOSIS_STATUS[status] ?? '')
      break
    case 'allergy':
      if (f.noKnownAllergies === true) add('No known allergies')
      labelled('Reaction:', f.reaction)
      add(ALLERGY_SEVERITY[text(f.severity)] ?? '')
      break
    case 'lab_result':
      add([text(f.value), text(f.unit)].filter(Boolean).join(' '))
      labelled('Normal range', f.referenceRange)
      labelled('Flag:', f.flag)
      break
    case 'vital':
      add(VITAL_MEASURE[text(f.measure)] ?? '')
      add([text(f.value), text(f.unit)].filter(Boolean).join(' '))
      break
    case 'note':
      break
  }
  labelled('Dated', item.dateAsWritten)
  return details
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
 * "12 items read · 3 need a careful check". When any page may not be fully read it never sounds complete:
 * "1 item read so far — the page needs a full check".
 */
export function readingSummary(items: readonly PaperItem[], flaggedPageCount = 0): string {
  const careful = items.filter(item => item.confidence === 'check_carefully').length
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'} read`
  const read = flaggedPageCount === 0 ? count
    : `${count} so far — ${flaggedPageCount === 1 ? 'the page needs' : 'the pages need'} a full check`
  return careful ? `${read} · ${careful} ${careful === 1 ? 'needs' : 'need'} a careful check` : read
}

function PaperItemRow({ item }: { readonly item: PaperItem }) {
  const details = itemDetails(item)
  const notActive = itemNotActive(item)
  const careful = item.confidence === 'check_carefully'
  return <li data-item-id={item.id}>
    <div className="hid-ehr-dept-row-main">
      <strong>{item.plain.trim() || item.asWritten}{notActive && ` — ${notActive}`}</strong>
      <span className="hid-ehr-dept-muted">As written: {item.asWritten}</span>
      {details.length > 0 && <span>{details.join(' · ')}</span>}
      <span className="hid-ehr-dept-muted">Page {item.page}</span>
    </div>
    <div className="hid-ehr-dept-migrate-confidence">
      <EhrBadge tone={careful ? 'caution' : 'positive'}>{careful ? 'Check carefully' : 'Clear'}</EhrBadge>
      {careful && <span className="hid-ehr-dept-muted">{item.checkReason?.trim() || 'Check this against the document.'}</span>}
    </div>
  </li>
}

/** The header's line: how many items were read and how many need a careful check. */
export function PaperReadingSummary({ reading }: { readonly reading: PaperReading }) {
  if (reading.status !== 'read') return null
  return <span className="hid-ehr-dept-muted">{readingSummary(reading.items, flaggedPages(reading).length)}</span>
}

/**
 * Shown first, above anything read and the header's count: the pages that may not be fully read, and the things the
 * reader left out, so staff never take the items as all there is on the paper.
 */
export function PaperReadingWarnings({ reading }: { readonly reading: PaperReading }) {
  const warnings = pageWarnings(reading)
  if (warnings.length === 0 && reading.droppedUngrounded === 0) return null
  return <div className="hid-ehr-dept-migrate-reading-warnings">
    {warnings.map(warning => <DeptNotice key={warning.key} tone="caution" variant="box">
      <p><strong>{warning.text}</strong></p>
      <p>{warning.why}</p>
    </DeptNotice>)}
    {reading.droppedUngrounded > 0 && <DeptNotice tone="caution" variant="box">{DROPPED_WORDS}</DeptNotice>}
  </div>
}

/** Who the paper is about, so staff can confirm it is the right patient, then the items, grouped by kind. */
export function PaperReadingView({ reading }: { readonly reading: PaperReading }) {
  const { identity } = reading
  const notOnPaper = 'Not found on the paper'
  return <div className="hid-ehr-dept-migrate-reading">
    <div>
      <h3>Who the paper is about</h3>
      <p className="hid-ehr-dept-muted">Check this is the right patient before anything else.</p>
      <DeptFacts facts={[
        { label: 'Name on the paper', value: identity.nameAsWritten?.trim() || notOnPaper },
        { label: 'Date of birth on the paper', value: identity.dateOfBirthAsWritten?.trim() || notOnPaper },
        { label: 'Folder number', value: identity.folderNumberAsWritten?.trim() || notOnPaper },
      ]} />
    </div>
    {reading.status !== 'read'
      ? <p role="note" className="hid-ehr-dept-muted">{READING_STATUS_WORDS[reading.status]}</p>
      : reading.items.length === 0
        ? <p className="hid-ehr-dept-muted">No medicines, diagnoses, allergies, results or notes were picked out. Check the document.</p>
        : GROUPS.map(group => {
          const items = orderItems(reading.items.filter(item => item.kind === group.kind))
          if (items.length === 0) return null
          const headingId = `ocr-read-${group.kind}`
          return <section key={group.kind} aria-labelledby={headingId}>
            <h3 id={headingId}>{group.title}</h3>
            <ul className="hid-ehr-dept-rows">{items.map(item => <PaperItemRow key={item.id} item={item} />)}</ul>
          </section>
        })}
  </div>
}
