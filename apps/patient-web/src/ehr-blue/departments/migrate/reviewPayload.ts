import type { OcrCandidateType, OcrTargetDomain, OcrValidationInput } from '../../../staff/api'
import {
  MAX_MISSED_ITEMS, MAX_REMOVED_ITEMS, isCode, REJECTION_REASONS, type ChangeReason, type FieldClass, type RejectionReason, type RemovalReason,
  type ReviewSignals,
} from '../../../readingLearningContract'
import { PAPER_READING_CONTRACT, cleanReading, isUnreadable, itemHeadlineText, itemNotActive, needsCheck, orderItems, type PaperItem, type PaperItemKind, type PaperReading } from './paperReading'

/*
 * The check of a paper reading, as staff make it on the Document OCR page: each item read is kept, changed or removed,
 * then the whole is saved as one of OCR's owning domains. Staff never see or type what is sent; it is built here from
 * their choices, in the shape ocr-api takes (hid-system, origin/staging-novu-ci-20261005 550c09d9, the branch production is built from):
 *
 * - services/ocr-api/src/ocr/dto/validate-ocr-job.dto.ts:12-31: validatedPayload and acceptedFields are objects
 *   (@IsObject), rejectedFields and corrections are arrays (@IsArray); the database holds them to the same shapes
 *   (ehr-api migrations 0013 lines 121-122, 0016 lines 29-32: jsonb_typeof object / array).
 * - services/ocr-api/src/ocr/ocr-publication-policy.ts:9-22 (assertCandidateClassification): the candidate type must be
 *   the one of its domain, and a validated review may not be UNCLASSIFIED.
 * - services/ocr-api/src/ocr/ocr.service.ts:297-303: a validated review's acceptedFields must pass the domain's own
 *   check (assertPublishableCandidate, ocr-publication-policy.ts:295-300) before anything is written:
 *   - EHR, clinicalNoteCandidate (ocr-publication-policy.ts:276-288): encounterId (a UUID), noteType (1-80 characters),
 *     title (1-240) and content (1-100,000). EHR then takes encounterId only as a version 4 UUID
 *     (ehr-api ocr-integration/dto/import-ocr-clinical-note.dto.ts:7).
 *   - LAB, importedLabCandidate (ocr-publication-policy.ts:208-274): 1-200 observations, each a testName (up to 240)
 *     and a value (up to 240) or valueText (up to 2,000); unit up to 80, referenceRange up to 240, and optionally its
 *     page (1-10,000) and reading itemId (231-237). Lab takes abnormalFlag only as one of its own words
 *     (lab-api dto/create-lab-import.dto.ts:12), so a flag written another way is not sent. A date on the paper is sent
 *     only as the text written, reportedAtAsWritten (1-120 characters, labDate 150-200); ocr-api turns it into a date
 *     only when it is unambiguous and keeps the text either way (docs/INTERFACE_CONTRACT.md:1318-1346). No date is
 *     guessed here. The report date of the whole paper is sent only as the reviewer typed it from the paper, as the
 *     top-level reportedAtAsWritten (1-120 characters once trimmed; blank sends none): it is never taken from an item's
 *     date. ocr-api refuses only text over 120 characters there (OCR_INVALID_LAB_EVIDENCE); anything it cannot read as a
 *     date is kept as text and sends Lab no date, which is not an error. No collection date is sent, so the order of the
 *     two (OCR_LAB_DATE_ORDER) never applies.
 *   - PHARMACY, importedMedicationCandidates (ocr-publication-policy.ts:102-137): `medications`, 1 to 50 entries
 *     (MAX_IMPORTED_MEDICATIONS, line 43) in reading order, each its own record: page (1-10,000), the reading itemId
 *     (unique), medicationText (1-500), strengthText, doseText and frequencyText (up to 240) and historicalContext
 *     (1-2,000, required; medicineFields 52-76). Never with the single-medicine fields beside it (line 112). The itemId
 *     must be a medicine read on that page (ocr.service.ts:659-691, assertMedicinesWereRead).
 *   - DOCUMENT_ONLY: no check; any object.
 *   Each check picks only its own keys (the publication sends what it returns), so the items kept are also stored in
 *   acceptedFields as `items`, as a record of the check, without changing what is published.
 */

export type ItemChoice = 'keep' | 'change' | 'remove'
/**
 * One item's choice (null: not chosen yet) and, for Change, the words staff typed. A lab result is changed as its test
 * and its result, each its own text (`test`, `result`); any other item as one line (`text`).
 */
export interface ItemDecision {
  readonly choice: ItemChoice | null; readonly text: string; readonly test?: string; readonly result?: string
  /** Migrate learning only (dormant until served): why it was removed, or why changed, if staff chose one (never required). */
  readonly removalReason?: RemovalReason | ''; readonly changeReason?: ChangeReason | ''
  /** Migrate learning only: a medicine's Change, field by field; a field not typed yet is as read (medicineAsRead). */
  readonly medicine?: Partial<MedicineFields>
}
/** A medicine as the structured Change form holds it, in the words of past medicines' own fields. */
export interface MedicineFields { readonly name: string; readonly strength: string; readonly dose: string; readonly frequency: string }
export const MEDICINE_FIELDS = ['name', 'strength', 'dose', 'frequency'] as const
/** Each field of a medicine as past medicines takes it (PHARMACY medications[]), for corrections. */
const MEDICINE_FIELD_NAMES: Readonly<Record<keyof MedicineFields, string>> = {
  name: 'medicationText', strength: 'strengthText', dose: 'doseText', frequency: 'frequencyText',
}
export type Decisions = Readonly<Record<string, ItemDecision>>

/** The owning domains a check can be saved as. */
export type SaveAs = Exclude<OcrTargetDomain, 'UNCLASSIFIED'>

/** "Save as", in the words the form offers each domain, in the order it offers them. */
export const SAVE_AS_WORDS: Readonly<Record<SaveAs, string>> = {
  DOCUMENT_ONLY: 'Keep the document only', EHR: 'Clinical note', LAB: 'Past lab results', PHARMACY: 'Past medicines',
}
const SAVE_AS_ORDER: readonly SaveAs[] = ['DOCUMENT_ONLY', 'EHR', 'LAB', 'PHARMACY']

/** The candidate type of each domain (ocr-publication-policy.ts:10-13). */
export const CANDIDATE_TYPES: Readonly<Record<OcrTargetDomain, OcrCandidateType>> = {
  EHR: 'clinical_note', LAB: 'lab_document', PHARMACY: 'historical_medication_evidence',
  DOCUMENT_ONLY: 'document_only', UNCLASSIFIED: 'unclassified',
}

/** What a clinical note made from a paper record is called in the patient's record. */
export const NOTE_TYPE = 'Paper record'
export const NOTE_TITLE = 'From a paper record'

/** The most medicines one review adds to past medicines (ocr-publication-policy.ts:43). */
export const MAX_MEDICINES = 50

/** Lab's own flag words (lab-api dto/create-lab-import.dto.ts:12); a flag written any other way is not sent. */
const LAB_FLAGS: ReadonlySet<string> = new Set(['normal', 'low', 'high', 'critical', 'abnormal', 'unknown'])
/** A flag as papers write it, in Lab's words: L or LOW is low, H or HIGH is high, and * or ! marks a result abnormal. */
const PAPER_FLAGS: Readonly<Record<string, string>> = { l: 'low', lo: 'low', low: 'low', h: 'high', hi: 'high', high: 'high', '*': 'abnormal', '!': 'abnormal' }

/** The paper's flag in Lab's own words, or nothing when it is written some other way. */
export function labFlag(value: unknown): string | undefined {
  const flag = text(value).toLowerCase()
  if (LAB_FLAGS.has(flag)) return flag
  return Object.hasOwn(PAPER_FLAGS, flag) ? PAPER_FLAGS[flag] : undefined
}

const KIND_TITLES: ReadonlyArray<readonly [PaperItemKind, string]> = [
  ['medicine', 'Medicines'], ['diagnosis', 'Diagnoses'], ['allergy', 'Allergies'], ['lab_result', 'Lab results'],
  ['vital', 'Vitals'], ['note', 'Notes'],
]

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Words read from the paper as they are saved: with no reader's marks (cleanReading), so no "?" the reader added. */
function clean(value: unknown): string {
  return cleanReading(text(value))
}

function words(...parts: unknown[]): string {
  return parts.map(clean).filter(Boolean).join(' ')
}

/** A lab result's test, as read: the test the reader named, or the item's name. */
export function labTest(item: PaperItem): string {
  return clean(item.fields.test) || itemName(item)
}

/** A lab result's result, as read ("11.2 g/dL"), or what is written when no value was picked out. */
export function labResult(item: PaperItem): string {
  return words(item.fields.value, item.fields.unit) || itemHeadlineText(item)
}

/** An item's name as saved: the plain reading, or what is written, each with no reader's marks. */
export function itemName(item: PaperItem): string {
  return clean(item.plain) || itemHeadlineText(item)
}

/**
 * What Keep saves for an item, as the check shows it: a lab result's test and result as they go to past lab results,
 * any other item's readingLine.
 */
export function keptText(item: PaperItem): string {
  return item.kind === 'lab_result' ? `${labTest(item)} ${labResult(item)}` : readingLine(item)
}

/**
 * An item's reading as one line of plain words, the value staff keep or change: the name with what matters most for
 * its kind ("Amlodipine 5 mg once a day", "Haemoglobin 11.2 g/dL").
 */
export function readingLine(item: PaperItem): string {
  const f = item.fields
  const name = itemName(item)
  const notActive = itemNotActive(item)
  switch (item.kind) {
    case 'medicine': return words(name, f.strength, f.frequency) + (notActive ? ` (${notActive.toLowerCase()})` : '')
    case 'lab_result': return words(name, f.value, f.unit)
    case 'diagnosis': return name + (notActive ? ` (${notActive.toLowerCase()})` : '')
    default: return name
  }
}

/** The items of a reading in the order the check shows them: those to check carefully first. */
export function reviewItems(reading: PaperReading | null): PaperItem[] {
  return reading && reading.status === 'read' ? orderItems(reading.items) : []
}

/**
 * Where each item starts: a clear item is kept; one to check (the reader said so, or part of it couldn't be read) waits
 * for staff to choose. A line that couldn't be read at all is removed, and stays removed whatever is chosen
 * (buildValidation): it is never saved.
 */
export function initialDecisions(items: readonly PaperItem[]): Record<string, ItemDecision> {
  return Object.fromEntries(items.map(item => [item.id, {
    choice: isUnreadable(item) ? 'remove' : needsCheck(item) ? null : 'keep', text: readingLine(item),
    ...(item.kind === 'lab_result' ? { test: labTest(item), result: labResult(item) } : {}),
  }]))
}

/** The domains a reading can be saved as. `canAttachNote`: the job names a patient whose visits this account can read. */
export function offeredDomains(reading: PaperReading | null, canAttachNote: boolean): SaveAs[] {
  // A line that couldn't be read is never kept, so it offers nothing to save it as.
  const items = reviewItems(reading).filter(item => !isUnreadable(item))
  if (items.length === 0) return ['DOCUMENT_ONLY']
  const offered = new Set<SaveAs>(['DOCUMENT_ONLY'])
  if (canAttachNote) offered.add('EHR')
  if (items.some(item => item.kind === 'lab_result')) offered.add('LAB')
  if (items.some(item => item.kind === 'medicine')) offered.add('PHARMACY')
  return SAVE_AS_ORDER.filter(domain => offered.has(domain))
}

const KIND_PLACES: Readonly<Partial<Record<PaperItemKind, string>>> = { allergy: 'Allergies', diagnosis: 'Diagnoses', vital: 'Vitals' }

/** "Allergies, diagnoses and vitals": kinds as a list in words, the first with a capital. */
function kindList(kinds: readonly PaperItemKind[]): string {
  const titles = kinds.map(kind => KIND_TITLES.find(([each]) => each === kind)?.[1] ?? '').filter(Boolean).map((title, at) => at ? title.toLowerCase() : title)
  return titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0] ?? ''
}

/**
 * Where the kept items of each kind go for the save chosen, said beside the choice, only where it matters: a clinical
 * note holds allergies, diagnoses and vitals as note text only; past medicines and past lab results save nothing of the
 * other kinds but the document. Empty when every kept item goes where its kind belongs.
 */
export function keptItemsGo(saveAs: SaveAs, items: readonly PaperItem[], decisions: Decisions): string {
  const kept = new Set(items.filter(item => !isUnreadable(item) && decisions[item.id]?.choice && decisions[item.id]?.choice !== 'remove').map(item => item.kind))
  if (saveAs === 'EHR') {
    const noteOnly = (['allergy', 'diagnosis', 'vital'] as const).filter(kind => kept.has(kind))
    if (!noteOnly.length) return ''
    const places = noteOnly.map(kind => KIND_PLACES[kind]!)
    const where = places.length > 1 ? `${places.slice(0, -1).join(', ')} or ${places.at(-1)}` : places[0]
    return `${kindList(noteOnly)} are written into the note only. Record them in ${where} too.`
  }
  const own = saveAs === 'PHARMACY' ? 'medicine' : saveAs === 'LAB' ? 'lab_result' : null
  if (!own) return ''
  const others = KIND_TITLES.map(([kind]) => kind).filter(kind => kind !== own && kept.has(kind))
  if (!others.length) return ''
  return `${kindList(others)} you keep are not saved anywhere but this document.`
}

/** How many medicines are kept or changed so far. */
export function keptMedicines(items: readonly PaperItem[], decisions: Decisions): number {
  return items.filter(item => item.kind === 'medicine' && !isUnreadable(item) && decisions[item.id]?.choice && decisions[item.id]?.choice !== 'remove').length
}

/** What the form says when more medicines are kept than one review can add. */
export const TOO_MANY_MEDICINES = `Only ${MAX_MEDICINES} medicines can be added at once. The first ${MAX_MEDICINES} on the paper are added. The rest stay with the document; add them in a clinical note.`

/** A field of the form, by its control's id, and what to do about it. */
export interface ReviewProblem { readonly field: string; readonly message: string }

/**
 * The visits a clinical note from a paper record can be attached to: this facility's, and not cancelled or entered in
 * error. On staging-novu-ci-20261005, EHR files the note on the visit of this patient at this facility only
 * (ehr-api database/migrations/0004_ehr_clinical_records.sql:79, the note's foreign key), and the record rule coming
 * with it refuses a record on a cancelled or entered-in-error visit while a completed one still takes late notes
 * (origin/main ehr-api src/ehr/shared/encounter-status.ts:38-46, refuseClosedEncounter for 'record'). Either refusal
 * comes at publication, which is final, after the check can no longer be made again, so such a visit is never offered.
 */
const CLOSED_VISIT: ReadonlySet<string> = new Set(['cancelled', 'entered_in_error'])
export function visitsForNote<T extends { readonly facilityId: string; readonly status: string }>(visits: readonly T[], facilityId: string): T[] {
  return visits.filter(visit => visit.facilityId.toLowerCase() === facilityId.toLowerCase() && !CLOSED_VISIT.has(visit.status.trim().toLowerCase()))
}

/** The id of an item's card (a group, focusable) and of its Change text, by the item's place in the check. */
export const itemCardId = (index: number) => `ocr-item-${index}`
export const itemTextId = (index: number) => `ocr-item-${index}-text`
/** A lab result's Change: its Test and Result texts. */
export const itemTestId = (index: number) => `ocr-item-${index}-test`
export const itemResultId = (index: number) => `ocr-item-${index}-result`
/** Migrate learning: why an item was removed or changed, and a medicine's Change, field by field. */
export const itemRemovalReasonId = (index: number) => `ocr-item-${index}-removal-reason`
export const itemChangeReasonId = (index: number) => `ocr-item-${index}-change-reason`
export const itemMedicineId = (index: number, field: keyof MedicineFields) => `ocr-item-${index}-medicine-${field}`
/** Migrate learning: "The reading missed…" and why a whole reading is rejected. */
export const MISSED_FIELD = 'ocr-missed'
export const REJECTION_REASON_FIELD = 'ocr-review-rejection-reason'

/** A medicine as read, as the structured Change form starts it. */
export function medicineAsRead(item: PaperItem): MedicineFields {
  const f = item.fields
  return { name: itemName(item), strength: clean(f.strength), dose: clean(f.dose), frequency: clean(f.frequency) }
}

/**
 * What Migrate learning has beyond each item's choice: the items the reviewer had on screen (counted in memory only) and
 * the one optional "The reading missed…" box, as typed (blank: nothing said). Given only while the backend serves it;
 * without it, buildValidation sends exactly what it sends today.
 */
export interface ReviewLearning {
  readonly itemsSeen: readonly string[]
  readonly missed: string
}

/** The missed box as typed: absent when blank (nothing is sent), a whole number from 0 to 200, or null when it is not one. */
export function missedTotal(typed: string): number | undefined | null {
  const value = typed.trim()
  if (!value) return undefined
  if (!/^\d{1,3}$/.test(value)) return null
  const count = Number(value)
  return count <= MAX_MISSED_ITEMS ? count : null
}

export interface ReviewChoices {
  readonly extractionId: string
  readonly reading: PaperReading | null
  readonly decisions: Decisions
  readonly saveAs: SaveAs
  /** The visit a clinical note is attached to; only for EHR. */
  readonly encounterId: string
  readonly reason: string
  /** The paper's report date, as the reviewer typed it from the paper; only for LAB, and sent only when not blank. */
  readonly reportedAtAsWritten?: string
  /** Migrate learning, only while the backend serves it (readingLearningServed.ts). */
  readonly learning?: ReviewLearning
}

/** A review as sent: OCR's validation, with Migrate learning's review signals beside it once the backend serves them. */
export type ReviewInput = OcrValidationInput & ReviewSignals

/** The field class (Session B's corrections[].fields) each changed field is counted under. */
const MEDICINE_FIELD_CLASSES: Readonly<Record<keyof MedicineFields, FieldClass>> = { name: 'name', strength: 'strength', dose: 'dose', frequency: 'frequency' }
const LAB_FIELD_CLASSES = { test: 'name', result: 'value' } as const satisfies Readonly<Record<string, FieldClass>>

/** The report date's field, under Save as when it is Past lab results. */
export const REPORT_DATE_FIELD = 'ocr-review-report-date'
/** The most ocr-api keeps of a date as written (ocr-publication-policy.ts labDate). */
export const MAX_DATE_AS_WRITTEN = 120

interface AcceptedItem {
  readonly itemId: string; readonly kind: PaperItemKind; readonly page: number; readonly asWritten: string; readonly reading: string
}
interface CheckedItem {
  readonly item: PaperItem; readonly index: number; readonly decision: ItemDecision; readonly line: string; readonly final: string
  /** A lab result's test and result as saved: as read, or as typed on Change. */
  readonly lab?: { readonly test: string; readonly result: string; readonly changed: boolean }
  /** Migrate learning: a medicine changed on the structured form, as typed. */
  readonly med?: MedicineFields & { readonly changed: boolean }
}

function optional<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')) as T
}

function upTo(value: string, maximum: number): string | undefined {
  return value && value.length <= maximum ? value : undefined
}

/** The note's text: the kept items by kind, each kind in the order it is on the paper. */
function noteContent(kept: readonly CheckedItem[], read: readonly PaperItem[]): string {
  const onPaper = [...kept].sort((a, b) => read.indexOf(a.item) - read.indexOf(b.item))
  const sections = KIND_TITLES.map(([kind, title]) => {
    const lines = onPaper.filter(entry => entry.item.kind === kind).map(entry => `- ${entry.final} (page ${entry.item.page})`)
    return lines.length ? `${title}\n${lines.join('\n')}` : ''
  }).filter(Boolean)
  return ['Read from a paper record and checked by staff.', ...sections].join('\n\n')
}

interface Observation {
  readonly testName: string; readonly value?: string; readonly valueText?: string; readonly unit?: string
  readonly referenceRange?: string; readonly abnormalFlag?: string
  readonly page: number; readonly itemId: string; readonly reportedAtAsWritten?: string
}

function observation(entry: CheckedItem): Observation {
  const { item } = entry
  const f = item.fields
  const testName = entry.lab?.test ?? labTest(item)
  // Where it was read, and its date only as written on the paper.
  const source = { page: item.page, itemId: item.id, reportedAtAsWritten: upTo(text(item.dateAsWritten), 120) }
  // A changed result carries the test and result staff typed, so the reading's own value and unit can't contradict them.
  if (entry.lab?.changed) return optional<Observation>({ testName, valueText: entry.lab.result, ...source })
  const value = clean(f.value)
  return optional<Observation>({
    testName, value: value || undefined, valueText: value ? undefined : itemHeadlineText(item),
    unit: upTo(clean(f.unit), 80), referenceRange: upTo(clean(f.referenceRange), 240), abnormalFlag: labFlag(f.flag),
    ...source,
  })
}

function medication(entry: CheckedItem) {
  const { item } = entry
  const f = item.fields
  const changed = entry.decision.choice === 'change' && entry.final !== entry.line
  // A status staff confirmed as not active ("Stopped") goes with the record, kept or changed, as it shows on the card.
  const notActive = itemNotActive(item)
  const context = [
    `From a paper record, page ${item.page}. Read as: ${itemHeadlineText(item)}`,
    notActive && `Status: ${notActive}`,
    clean(f.duration) && `For ${clean(f.duration)}`,
    item.prescription?.prescriberAsWritten?.trim() && `Prescribed by ${item.prescription.prescriberAsWritten.trim()}`,
    item.prescription?.dateAsWritten?.trim() && `Prescribed on ${item.prescription.dateAsWritten.trim()}`,
    item.dateAsWritten?.trim() && `Dated ${item.dateAsWritten.trim()}`,
  ].filter(Boolean).join('. ')
  // Migrate learning: a medicine changed field by field is sent as each field typed.
  if (entry.med?.changed) {
    return optional({
      itemId: item.id, page: item.page, medicationText: entry.med.name, strengthText: upTo(entry.med.strength, 240),
      doseText: upTo(entry.med.dose, 240), frequencyText: upTo(entry.med.frequency, 240), historicalContext: context.slice(0, 2_000),
    })
  }
  // A changed medicine is the words staff typed; the reading's strength and frequency are not sent beside them.
  return optional({
    itemId: item.id, page: item.page,
    medicationText: changed ? entry.final : itemName(item),
    strengthText: changed ? undefined : upTo(clean(f.strength), 240),
    frequencyText: changed ? undefined : upTo(clean(f.frequency), 240),
    historicalContext: context.slice(0, 2_000),
  })
}

/**
 * The review ocr-api takes, built from staff's choices, or the first thing to fix, in the order the form shows its
 * fields. Kept items are accepted as read; changed items are accepted with the new words and listed as corrections
 * (old and new); removed items are listed as rejected.
 */
export function buildValidation(choices: ReviewChoices): { readonly input: ReviewInput } | { readonly problem: ReviewProblem } {
  const { reading, decisions, saveAs, learning } = choices
  const items = reviewItems(reading)
  const checked: CheckedItem[] = []
  for (const [index, item] of items.entries()) {
    // A line that couldn't be read at all is always removed: it is listed as rejected and never accepted or published.
    const decision: ItemDecision = isUnreadable(item) ? { choice: 'remove', text: readingLine(item) }
      : decisions[item.id] ?? { choice: null, text: readingLine(item) }
    if (!decision.choice) return { problem: { field: itemCardId(index), message: 'Choose Keep, Change or Remove for this item.' } }
    if (learning && item.kind === 'medicine' && decision.choice === 'change') {
      const read = medicineAsRead(item)
      const typed = Object.fromEntries(MEDICINE_FIELDS.map(field => [field, (decision.medicine?.[field] ?? read[field]).trim()])) as unknown as MedicineFields
      if (!typed.name) return { problem: { field: itemMedicineId(index, 'name'), message: 'Enter the medicine’s name, or choose Keep or Remove.' } }
      if (typed.name.length > 500) return { problem: { field: itemMedicineId(index, 'name'), message: 'Shorten this to 500 characters or fewer.' } }
      for (const field of ['strength', 'dose', 'frequency'] as const) {
        if (typed[field].length > 240) return { problem: { field: itemMedicineId(index, field), message: 'Shorten this to 240 characters or fewer.' } }
      }
      const changed = MEDICINE_FIELDS.some(field => typed[field] !== read[field])
      const final = changed ? MEDICINE_FIELDS.map(field => typed[field]).filter(Boolean).join(' ') : readingLine(item)
      checked.push({ item, index, decision, line: readingLine(item), final, med: { ...typed, changed } })
      continue
    }
    if (item.kind === 'lab_result') {
      const read = { test: labTest(item), result: labResult(item) }
      const typed = decision.choice === 'change' ? { test: (decision.test ?? read.test).trim(), result: (decision.result ?? read.result).trim() } : read
      if (!typed.test) return { problem: { field: itemTestId(index), message: 'Enter the test, or choose Keep or Remove.' } }
      if (!typed.result) return { problem: { field: itemResultId(index), message: 'Enter the result, or choose Keep or Remove.' } }
      const changed = typed.test !== read.test || typed.result !== read.result
      checked.push({ item, index, decision, line: readingLine(item), final: changed ? `${typed.test} ${typed.result}` : readingLine(item),
        lab: { ...typed, changed } })
      continue
    }
    const final = decision.choice === 'change' ? decision.text.trim() : readingLine(item)
    if (decision.choice === 'change' && !final) return { problem: { field: itemTextId(index), message: 'Enter what the paper says, or choose Keep or Remove.' } }
    if (decision.choice === 'change' && final.length > 2_000) return { problem: { field: itemTextId(index), message: 'Shorten this to 2,000 characters or fewer.' } }
    checked.push({ item, index, decision, line: readingLine(item), final })
  }
  const kept = checked.filter(entry => entry.decision.choice !== 'remove')
  const accepted: AcceptedItem[] = kept.map(({ item, final }) => ({ itemId: item.id, kind: item.kind, page: item.page, asWritten: item.asWritten, reading: final }))
  const removed = checked.filter(entry => entry.decision.choice === 'remove')
  const rejectedFields = removed
    .map(({ item, line }) => ({ itemId: item.id, kind: item.kind, page: item.page, asWritten: item.asWritten, reading: line, decision: 'removed' }))
  const corrections = kept.filter(entry => entry.decision.choice === 'change').flatMap(entry => {
    const { item, line, final, lab, med, decision } = entry
    // Migrate learning: each correction names its field class; the change reason goes on the item's first correction
    // only, as the server counts one change reason for each correction that carries one.
    const correction = (field: string, oldValue: string, newValue: string, fieldClass?: FieldClass) => ({
      itemId: item.id, kind: item.kind, page: item.page, field, oldValue, newValue,
      ...(learning && fieldClass ? { fields: [fieldClass] } : {}),
    })
    const withReason = (entries: ReturnType<typeof correction>[]) => learning && decision.changeReason
      ? entries.map((entry, at) => at === 0 ? { ...entry, changeReason: decision.changeReason as ChangeReason } : entry)
      : entries
    if (med) {
      const read = medicineAsRead(item)
      return withReason(MEDICINE_FIELDS.filter(field => med[field] !== read[field])
        .map(field => correction(MEDICINE_FIELD_NAMES[field], read[field], med[field], MEDICINE_FIELD_CLASSES[field])))
    }
    if (lab) {
      return withReason([
        ...(lab.test !== labTest(item) ? [correction('test', labTest(item), lab.test, learning ? LAB_FIELD_CLASSES.test : undefined)] : []),
        ...(lab.result !== labResult(item) ? [correction('result', labResult(item), lab.result, learning ? LAB_FIELD_CLASSES.result : undefined)] : []),
      ])
    }
    return withReason(final !== line ? [correction('reading', line, final)] : [])
  })

  // Migrate learning: "The reading missed…", one optional total; blank sends nothing.
  const missedItems = learning ? missedTotal(learning.missed) : undefined
  if (missedItems === null) return { problem: { field: MISSED_FIELD, message: `Enter a number from 0 to ${MAX_MISSED_ITEMS}, or leave it blank.` } }

  let domainFields: Record<string, unknown> = {}
  const domainProblem = (message: string) => ({ problem: { field: 'ocr-review-domain', message } })
  if (saveAs === 'EHR') {
    if (kept.length === 0) return domainProblem('Every item was removed, so there is nothing to put in a clinical note. Choose Keep the document only.')
    if (!choices.encounterId) return { problem: { field: 'ocr-review-visit', message: 'Choose the visit to attach this note to.' } }
    const content = noteContent(kept, reading?.items ?? [])
    if (content.length > 100_000) return domainProblem('This is too long for one clinical note. Choose Keep the document only.')
    domainFields = { encounterId: choices.encounterId, noteType: NOTE_TYPE, title: NOTE_TITLE, content }
  } else if (saveAs === 'LAB') {
    const results = kept.filter(entry => entry.item.kind === 'lab_result')
    if (results.length === 0) return domainProblem('No lab result is kept, so nothing can be added to past lab results. Choose another way to save it.')
    if (results.length > 200) return domainProblem('This has more than 200 lab results, too many to add at once. Choose Keep the document only.')
    const observations = results.map(observation)
    for (const [at, entry] of results.entries()) {
      const { testName, value, valueText } = observations[at]!
      const changed = entry.decision.choice === 'change'
      if (testName.length > 240) return { problem: { field: changed ? itemTestId(entry.index) : itemCardId(entry.index),
        message: 'This test name is too long to add to past lab results. Use Change to shorten the test name to 240 characters or fewer.' } }
      if ((value?.length ?? 0) > 240 || (valueText?.length ?? 0) > 2_000) return { problem: { field: changed ? itemResultId(entry.index) : itemCardId(entry.index),
        message: 'This result is too long to add to past lab results. Use Change to shorten it.' } }
    }
    const reportDate = (choices.reportedAtAsWritten ?? '').trim()
    if (reportDate.length > MAX_DATE_AS_WRITTEN) return { problem: { field: REPORT_DATE_FIELD, message: `Write the date in ${MAX_DATE_AS_WRITTEN} characters or fewer.` } }
    domainFields = { ...(reportDate ? { reportedAtAsWritten: reportDate } : {}), observations }
  } else if (saveAs === 'PHARMACY') {
    // In the order they are on the paper, each its own record; past the most one review takes, they stay with the document.
    const read = reading?.items ?? []
    const medicines = kept.filter(entry => entry.item.kind === 'medicine')
      .sort((a, b) => read.indexOf(a.item) - read.indexOf(b.item)).slice(0, MAX_MEDICINES)
    if (medicines.length === 0) return domainProblem('No medicine is kept, so nothing can be added to past medicines. Choose another way to save it.')
    const medications = medicines.map(medication)
    for (const [at, entry] of medicines.entries()) {
      if (medications[at]!.medicationText.length > 500) return { problem: { field: entry.decision.choice === 'change' ? itemTextId(entry.index) : itemCardId(entry.index),
        message: 'This medicine is too long to add to past medicines. Use Change to shorten it to 500 characters or fewer.' } }
    }
    domainFields = { medications }
  }

  const reason = choices.reason.trim()
  if (!reason) return { problem: { field: 'ocr-review-reason', message: 'Complete this field.' } }
  if (reason.length < 8) return { problem: { field: 'ocr-review-reason', message: 'Write at least 8 characters.' } }
  if (reason.length > 500) return { problem: { field: 'ocr-review-reason', message: 'Write 500 characters or fewer.' } }

  const validatedPayload = reading ? { contract: PAPER_READING_CONTRACT, identity: reading.identity, items: accepted } : {}
  const acceptedFields = reading ? { items: accepted, ...domainFields } : { ...domainFields }
  return { input: {
    extractionId: choices.extractionId, validatedPayload, acceptedFields, rejectedFields, corrections,
    disposition: 'validated', targetDomain: saveAs, candidateType: CANDIDATE_TYPES[saveAs], reason,
    ...(learning ? reviewSignals(learning, items, removed, missedItems) : {}),
  } }
}

/**
 * The review signals Migrate learning sends beside a check (Session B's names, readingLearningContract.ts), only what
 * the reviewer actually did or said:
 * - reviewConfirmed: every item the reviewer could check was on screen (Session B: "checked every item of the reading").
 *   Only when the reading has an item to check; there is no page tick.
 * - missedItems: only when the reviewer typed a number.
 * - removedItems: each removed item whose reason the reviewer chose, up to the server's 200; nothing for one without.
 */
function reviewSignals(learning: ReviewLearning, items: readonly PaperItem[], removed: readonly CheckedItem[],
  missedItems: number | undefined): ReviewSignals {
  const checkable = items.filter(item => !isUnreadable(item))
  const seen = new Set(learning.itemsSeen)
  const removedItems = removed.flatMap(({ item, decision }) =>
    !isUnreadable(item) && decision.removalReason ? [{ itemId: item.id, removalReason: decision.removalReason }] : []).slice(0, MAX_REMOVED_ITEMS)
  return {
    ...(checkable.length ? { reviewConfirmed: checkable.every(item => seen.has(item.id)) } : {}),
    ...(missedItems !== undefined ? { missedItems } : {}),
    ...(removedItems.length ? { removedItems } : {}),
  }
}

/** A rejection: nothing read is kept, and OCR takes it as unclassified (ocr-publication-policy.ts:17-19 allows only that). */
export function buildRejection(extractionId: string, reason: string, learning?: { readonly rejectionReason: RejectionReason | '' }):
  { readonly input: ReviewInput } | { readonly problem: ReviewProblem } {
  const trimmed = reason.trim()
  if (!trimmed) return { problem: { field: 'ocr-review-reason', message: 'Complete this field.' } }
  if (trimmed.length < 8) return { problem: { field: 'ocr-review-reason', message: 'Write at least 8 characters.' } }
  if (trimmed.length > 500) return { problem: { field: 'ocr-review-reason', message: 'Write 500 characters or fewer.' } }
  return { input: {
    extractionId, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
    disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: trimmed,
    ...(learning && isCode(REJECTION_REASONS, learning.rejectionReason) ? { rejectionReasonCode: learning.rejectionReason } : {}),
  } }
}
