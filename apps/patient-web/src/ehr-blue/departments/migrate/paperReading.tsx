import { EhrBadge } from '@hid/ui/ehr'
import { DeptFacts } from '../parts/DeptRecord'

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

export interface PaperReading {
  readonly identity: PaperIdentity
  readonly items: readonly PaperItem[]
  readonly status: PaperReadingStatus
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

const MEDICINE_STATUS: Record<string, string> = {
  current: 'Currently taking', new: 'Newly started', stopped: 'Stopped', past: 'Taken in the past',
}
const DIAGNOSIS_STATUS: Record<string, string> = {
  confirmed: 'Confirmed', suspected: 'Suspected', ruled_out: 'Ruled out', history: 'Past history', family_history: 'Family history',
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
  const { items, identity, reading } = payload
  if (!Array.isArray(items) || !isRecord(reading) || typeof reading.status !== 'string' || !STATUSES.has(reading.status)) return null
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
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** An item's own details, by kind, as short phrases: what the bold reading and "As written" do not already say. */
export function itemDetails(item: PaperItem): string[] {
  const f = item.fields
  const details: string[] = []
  const add = (value: string) => { if (value) details.push(value) }
  const labelled = (label: string, value: unknown) => { const words = text(value); if (words) details.push(`${label} ${words}`) }
  switch (item.kind) {
    case 'medicine':
      add(text(f.strength)); add(text(f.form)); add(text(f.route)); add(text(f.frequency))
      labelled('for', f.duration)
      add(MEDICINE_STATUS[text(f.status)] ?? '')
      if (item.prescription) {
        labelled('Prescribed by', item.prescription.prescriberAsWritten)
        labelled('Prescribed on', item.prescription.dateAsWritten)
      }
      break
    case 'diagnosis':
      add(DIAGNOSIS_STATUS[text(f.status)] ?? '')
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

/** "12 items read · 3 need a careful check". */
export function readingSummary(items: readonly PaperItem[]): string {
  const careful = items.filter(item => item.confidence === 'check_carefully').length
  const read = `${items.length} ${items.length === 1 ? 'item' : 'items'} read`
  return careful ? `${read} · ${careful} ${careful === 1 ? 'needs' : 'need'} a careful check` : read
}

function PaperItemRow({ item }: { readonly item: PaperItem }) {
  const details = itemDetails(item)
  const careful = item.confidence === 'check_carefully'
  return <li data-item-id={item.id}>
    <div className="hid-ehr-dept-row-main">
      <strong>{item.plain.trim() || item.asWritten}</strong>
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
  return <span className="hid-ehr-dept-muted">{readingSummary(reading.items)}</span>
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
