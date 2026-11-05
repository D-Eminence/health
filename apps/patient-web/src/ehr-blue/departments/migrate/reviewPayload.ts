import type { OcrCandidateType, OcrTargetDomain, OcrValidationInput } from '../../../staff/api'
import { PAPER_READING_CONTRACT, itemNotActive, orderItems, type PaperItem, type PaperItemKind, type PaperReading } from './paperReading'

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
 *     guessed here. The reading has no collection or report date of the whole paper, so the top-level ones are not sent.
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
export interface ItemDecision { readonly choice: ItemChoice | null; readonly text: string; readonly test?: string; readonly result?: string }
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

const KIND_TITLES: ReadonlyArray<readonly [PaperItemKind, string]> = [
  ['medicine', 'Medicines'], ['diagnosis', 'Diagnoses'], ['allergy', 'Allergies'], ['lab_result', 'Lab results'],
  ['vital', 'Vitals'], ['note', 'Notes'],
]

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function words(...parts: unknown[]): string {
  return parts.map(text).filter(Boolean).join(' ')
}

/** A lab result's test, as read: the test the reader named, or the item's name. */
export function labTest(item: PaperItem): string {
  return text(item.fields.test) || itemName(item)
}

/** A lab result's result, as read ("11.2 g/dL"), or what is written when no value was picked out. */
export function labResult(item: PaperItem): string {
  return words(item.fields.value, item.fields.unit) || item.asWritten.trim()
}

/** An item's name as the page shows it in bold: the plain reading, or what is written. */
export function itemName(item: PaperItem): string {
  return item.plain.trim() || item.asWritten.trim()
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

/** Where each item starts: a clear item is kept; one to check carefully waits for staff to choose. */
export function initialDecisions(items: readonly PaperItem[]): Record<string, ItemDecision> {
  return Object.fromEntries(items.map(item => [item.id, {
    choice: item.confidence === 'clear' ? 'keep' : null, text: readingLine(item),
    ...(item.kind === 'lab_result' ? { test: labTest(item), result: labResult(item) } : {}),
  }]))
}

/** The domains a reading can be saved as. `canAttachNote`: the job names a patient whose visits this account can read. */
export function offeredDomains(reading: PaperReading | null, canAttachNote: boolean): SaveAs[] {
  const items = reviewItems(reading)
  if (items.length === 0) return ['DOCUMENT_ONLY']
  const offered = new Set<SaveAs>(['DOCUMENT_ONLY'])
  if (canAttachNote) offered.add('EHR')
  if (items.some(item => item.kind === 'lab_result')) offered.add('LAB')
  if (items.some(item => item.kind === 'medicine')) offered.add('PHARMACY')
  return SAVE_AS_ORDER.filter(domain => offered.has(domain))
}

/** How many medicines are kept or changed so far. */
export function keptMedicines(items: readonly PaperItem[], decisions: Decisions): number {
  return items.filter(item => item.kind === 'medicine' && decisions[item.id]?.choice && decisions[item.id]?.choice !== 'remove').length
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

export interface ReviewChoices {
  readonly extractionId: string
  readonly reading: PaperReading | null
  readonly decisions: Decisions
  readonly saveAs: SaveAs
  /** The visit a clinical note is attached to; only for EHR. */
  readonly encounterId: string
  readonly reason: string
}

interface AcceptedItem {
  readonly itemId: string; readonly kind: PaperItemKind; readonly page: number; readonly asWritten: string; readonly reading: string
}
interface CheckedItem {
  readonly item: PaperItem; readonly index: number; readonly decision: ItemDecision; readonly line: string; readonly final: string
  /** A lab result's test and result as saved: as read, or as typed on Change. */
  readonly lab?: { readonly test: string; readonly result: string; readonly changed: boolean }
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
  const value = text(f.value)
  const flag = text(f.flag).toLowerCase()
  return optional<Observation>({
    testName, value: value || undefined, valueText: value ? undefined : item.asWritten.trim(),
    unit: upTo(text(f.unit), 80), referenceRange: upTo(text(f.referenceRange), 240), abnormalFlag: LAB_FLAGS.has(flag) ? flag : undefined,
    ...source,
  })
}

function medication(entry: CheckedItem) {
  const { item } = entry
  const f = item.fields
  const changed = entry.decision.choice === 'change' && entry.final !== entry.line
  const context = [
    `From a paper record, page ${item.page}. As written: ${item.asWritten.trim()}`,
    text(f.duration) && `For ${text(f.duration)}`,
    item.prescription?.prescriberAsWritten?.trim() && `Prescribed by ${item.prescription.prescriberAsWritten.trim()}`,
    item.prescription?.dateAsWritten?.trim() && `Prescribed on ${item.prescription.dateAsWritten.trim()}`,
    item.dateAsWritten?.trim() && `Dated ${item.dateAsWritten.trim()}`,
  ].filter(Boolean).join('. ')
  // A changed medicine is the words staff typed; the reading's strength and frequency are not sent beside them.
  return optional({
    itemId: item.id, page: item.page,
    medicationText: changed ? entry.final : itemName(item),
    strengthText: changed ? undefined : upTo(text(f.strength), 240),
    frequencyText: changed ? undefined : upTo(text(f.frequency), 240),
    historicalContext: context.slice(0, 2_000),
  })
}

/**
 * The review ocr-api takes, built from staff's choices, or the first thing to fix, in the order the form shows its
 * fields. Kept items are accepted as read; changed items are accepted with the new words and listed as corrections
 * (old and new); removed items are listed as rejected.
 */
export function buildValidation(choices: ReviewChoices): { readonly input: OcrValidationInput } | { readonly problem: ReviewProblem } {
  const { reading, decisions, saveAs } = choices
  const items = reviewItems(reading)
  const checked: CheckedItem[] = []
  for (const [index, item] of items.entries()) {
    const decision = decisions[item.id] ?? { choice: null, text: readingLine(item) }
    if (!decision.choice) return { problem: { field: itemCardId(index), message: 'Choose Keep, Change or Remove for this item.' } }
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
  const rejectedFields = checked.filter(entry => entry.decision.choice === 'remove')
    .map(({ item, line }) => ({ itemId: item.id, kind: item.kind, page: item.page, asWritten: item.asWritten, reading: line, decision: 'removed' }))
  const corrections = kept.filter(entry => entry.decision.choice === 'change').flatMap(entry => {
    const { item, line, final, lab } = entry
    const correction = (field: string, oldValue: string, newValue: string) => ({ itemId: item.id, kind: item.kind, page: item.page, field, oldValue, newValue })
    if (lab) {
      return [
        ...(lab.test !== labTest(item) ? [correction('test', labTest(item), lab.test)] : []),
        ...(lab.result !== labResult(item) ? [correction('result', labResult(item), lab.result)] : []),
      ]
    }
    return final !== line ? [correction('reading', line, final)] : []
  })

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
    domainFields = { observations }
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
  } }
}

/** A rejection: nothing read is kept, and OCR takes it as unclassified (ocr-publication-policy.ts:17-19 allows only that). */
export function buildRejection(extractionId: string, reason: string): { readonly input: OcrValidationInput } | { readonly problem: ReviewProblem } {
  const trimmed = reason.trim()
  if (!trimmed) return { problem: { field: 'ocr-review-reason', message: 'Complete this field.' } }
  if (trimmed.length < 8) return { problem: { field: 'ocr-review-reason', message: 'Write at least 8 characters.' } }
  if (trimmed.length > 500) return { problem: { field: 'ocr-review-reason', message: 'Write 500 characters or fewer.' } }
  return { input: {
    extractionId, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
    disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: trimmed,
  } }
}
