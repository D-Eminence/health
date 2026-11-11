/*
 * Migrate learning, phase 1: what staff tell the reading service while they check a paper reading, and the admin
 * "Reading quality" read that counts it. Every server field name and route of it is here, and only here.
 *
 * Proposed; Session B will share the field names. None of them is served by any hid-system branch yet (scouted
 * 11 Nov 2026: no seen-items, page-checked, removal or change reason, missed count, rejection reason or reading-quality
 * route on any branch). When Session B's names arrive, change them here: nothing else names them.
 *
 * Dormant until served. Today's ocr-api takes its validation body with forbidNonWhitelisted, so a new top-level key
 * would be refused (400): the page sends none of this until the extractions answer says the backend takes it
 * (`servedFlag`, below), and until then sends exactly what it sends today.
 */

/** The field names, server side. One map, so Session B's names are a change to this object only. */
export const LEARNING_FIELDS = {
  /** `true` on the answer of GET /api/v1/ocr/jobs/:jobId/extractions from an ocr-api that takes the fields below. */
  servedFlag: 'reviewLearning',
  /** The validation body's own key for what is not about one item: `{ itemsSeen, pagesChecked, missedItems }`, or `{ rejectionReason }`. */
  learning: 'learning',
  /** The reading's item ids the reviewer had on screen (scrolled into view, touched or focused). */
  itemsSeen: 'itemsSeen',
  /** The page numbers the reviewer ticked "I've checked this page" for. */
  pagesChecked: 'pagesChecked',
  /** How many items of each kind the reading missed: counts only, never words. */
  missedItems: 'missedItems',
  /** Why a whole reading was rejected, as one code of REJECTION_REASONS. */
  rejectionReason: 'rejectionReason',
  /** On each rejectedFields entry: why the item was removed, as one code of REMOVAL_REASONS. */
  removalReason: 'removalReason',
  /** On each corrections entry: why the item was changed, as one code of CHANGE_REASONS. */
  changeReason: 'changeReason',
} as const

/** The proposed admin read of the counts (registered as proposed in packages/contracts registry: admin.readingQuality). */
export const READING_QUALITY_PATH = '/api/v1/admin/ocr/reading-quality'
/** The period the admin page reads, in days. */
export const READING_QUALITY_DAYS = 30

/** The admin read's answer, by field. Each count is a whole number, or null while the backend can't count it yet. */
export const READING_QUALITY_FIELDS = {
  itemsKept: 'itemsKept',
  /** By CHANGE_REASONS code. */
  itemsChanged: 'itemsChanged',
  /** By REMOVAL_REASONS code. */
  itemsRemoved: 'itemsRemoved',
  /** By MISSED_KINDS code. */
  itemsMissed: 'itemsMissed',
  itemsSeen: 'itemsSeen',
  itemsShown: 'itemsShown',
  pagesChecked: 'pagesChecked',
  pagesTotal: 'pagesTotal',
  documentsChecked: 'documentsChecked',
  /** By REJECTION_REASONS code. */
  documentsRejected: 'documentsRejected',
} as const

export interface ReasonChoice<Code extends string> { readonly code: Code; readonly words: string }

/** Why staff remove an item, in the order the form offers them. */
export const REMOVAL_REASONS = [
  { code: 'not_on_paper', words: 'Not on the paper' },
  { code: 'written_twice', words: 'Written twice' },
  { code: 'not_needed', words: 'Not needed' },
  { code: 'cannot_read', words: 'Can’t read it' },
  { code: 'other_patient', words: 'Belongs to another patient' },
] as const satisfies readonly ReasonChoice<string>[]
export type RemovalReason = (typeof REMOVAL_REASONS)[number]['code']
/** A line the reading itself couldn't read is always removed, for this reason. */
export const UNREADABLE_REMOVAL: RemovalReason = 'cannot_read'

/** Why staff change an item. */
export const CHANGE_REASONS = [
  { code: 'ai_misread', words: 'AI misread the paper' },
  { code: 'paper_out_of_date', words: 'Paper out of date' },
] as const satisfies readonly ReasonChoice<string>[]
export type ChangeReason = (typeof CHANGE_REASONS)[number]['code']

/** Why staff reject a whole reading. */
export const REJECTION_REASONS = [
  { code: 'wrong_patient', words: 'Wrong patient' },
  { code: 'not_medical_record', words: 'Not a medical record' },
  { code: 'cannot_read', words: 'Can’t be read' },
  { code: 'duplicate', words: 'Same document twice' },
  { code: 'other', words: 'Something else' },
] as const satisfies readonly ReasonChoice<string>[]
export type RejectionReason = (typeof REJECTION_REASONS)[number]['code']

/** "The reading missed a ___": the kinds counted, in the order the form asks. */
export const MISSED_KINDS = [
  { code: 'medicine', words: 'Medicine' },
  { code: 'allergy', words: 'Allergy' },
  { code: 'diagnosis', words: 'Diagnosis' },
  { code: 'lab_result', words: 'Lab result' },
  { code: 'other', words: 'Something else' },
] as const satisfies readonly ReasonChoice<string>[]
export type MissedKind = (typeof MISSED_KINDS)[number]['code']
/** The most of one kind a reviewer may say was missed from one reading. */
export const MAX_MISSED = 99

export function isCode<Code extends string>(choices: readonly ReasonChoice<Code>[], value: unknown): value is Code {
  return typeof value === 'string' && choices.some(choice => choice.code === value)
}

/** Whether an extractions answer says the backend takes the learning fields: its flag is exactly `true`. */
export function saysReviewLearning(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as Record<string, unknown>)[LEARNING_FIELDS.servedFlag] === true)
}
