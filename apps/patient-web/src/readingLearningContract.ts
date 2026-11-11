/*
 * Migrate learning, phase 1: what staff tell the reading service while they check a paper reading, and the admin
 * "Reading quality" read that counts it.
 *
 * The validation body's review signals and their codes are Session B's (hid-system branch
 * claude/ecstatic-ramanujan-q4i1eo-ocr-review-outcomes, a3fb5abe: ocr-api validate-ocr-job.dto.ts and
 * quality/review-outcome.ts, INTERFACE_CONTRACT.md section 15 "Optional review signals"): top-level `reviewConfirmed`,
 * `missedItems` (one whole number, 0-200), `removedItems` ([{ itemId, removalReason }], up to 200) and, on a rejection
 * only, `rejectionReasonCode`; on a corrections[] entry, `fields` and `changeReason`. The server has no field for the
 * items seen or the pages ticked: they make up `reviewConfirmed` (reviewPayload.ts).
 *
 * Still proposed, not on Session B's branch: the served flag (`servedFlag`, below) and the admin read
 * (READING_QUALITY_PATH). Until the flag is served the page sends exactly what it sends today: today's ocr-api takes
 * its validation body with forbidNonWhitelisted, so any new top-level key would be refused (400).
 */

/** `true` on the answer of GET /api/v1/ocr/jobs/:jobId/extractions from an ocr-api that takes the review signals. Proposed. */
export const SERVED_FLAG = 'reviewLearning'

/** Session B's field classes (review-outcome.ts FIELD_CLASSES) the website names in corrections[].fields. */
export type FieldClass = 'name' | 'strength' | 'dose' | 'frequency' | 'route' | 'duration' | 'date' | 'value' | 'unit'

/** The review signals beside OCR's validation body, as Session B's api-client OcrValidationInput adds them. */
export interface ReviewSignals {
  readonly reviewConfirmed?: boolean
  readonly missedItems?: number
  readonly removedItems?: readonly { readonly itemId: string; readonly removalReason: RemovalReason }[]
  readonly rejectionReasonCode?: RejectionReason
}

/**
 * The admin "Reading quality" read. Proposed: Session B serves the same summary as GET /api/v1/ocr/quality/summary,
 * but only for the one facility named by X-Facility-ID, and the admin application never sends a facility or calls a
 * non-admin route (admin/api.ts request()). Its README names a cross-facility, aggregate-only admin read as the next
 * step; this is that read, answering in the same shape (schema hid.ocr.quality-summary/v1).
 */
export const READING_QUALITY_PATH = '/api/v1/admin/ocr/quality/summary'
/** Session B's permissions for the summary: both are needed. */
export const READING_QUALITY_PERMISSIONS = ['platform.admin.access', 'platform.operations.read'] as const

export interface ReasonChoice<Code extends string> { readonly code: Code; readonly words: string }

/** Why staff remove an item, in the order the form offers them. */
export const REMOVAL_REASONS = [
  { code: 'not_on_paper', words: 'Not on the paper' },
  { code: 'duplicate', words: 'Written twice' },
  { code: 'not_needed', words: 'Not needed' },
  { code: 'unreadable', words: 'Can’t read it' },
  { code: 'other_patient', words: 'Belongs to another patient' },
] as const satisfies readonly ReasonChoice<string>[]
export type RemovalReason = (typeof REMOVAL_REASONS)[number]['code']
/** A line the reading itself couldn't read is always removed, for this reason. */
export const UNREADABLE_REMOVAL: RemovalReason = 'unreadable'
/** The most removedItems entries Session B takes in one review (ArrayMaxSize). */
export const MAX_REMOVED_ITEMS = 200

/** Why staff change an item. */
export const CHANGE_REASONS = [
  { code: 'misread', words: 'AI misread the paper' },
  { code: 'clinical_update', words: 'Paper out of date' },
] as const satisfies readonly ReasonChoice<string>[]
export type ChangeReason = (typeof CHANGE_REASONS)[number]['code']

/** Why staff reject a whole reading: Session B's REJECTION_REASON_CODES, each in plain words. */
export const REJECTION_REASONS = [
  { code: 'wrong_patient', words: 'Wrong patient' },
  { code: 'wrong_document', words: 'Not the document it was filed as' },
  { code: 'unreadable', words: 'Can’t be read' },
  { code: 'duplicate_document', words: 'Same document twice' },
  { code: 'pages_missing', words: 'Pages are missing' },
  { code: 'reading_unusable', words: 'The reading is too wrong to correct' },
  { code: 'not_clinical', words: 'Not a medical record' },
  { code: 'other', words: 'Something else' },
] as const satisfies readonly ReasonChoice<string>[]
export type RejectionReason = (typeof REJECTION_REASONS)[number]['code']

/**
 * "The reading missed a ___": the kinds the form asks about, in order. Session B takes one total (missedItems), so the
 * kinds only help staff count; what is sent is their sum.
 */
export const MISSED_KINDS = [
  { code: 'medicine', words: 'Medicine' },
  { code: 'allergy', words: 'Allergy' },
  { code: 'diagnosis', words: 'Diagnosis' },
  { code: 'lab_result', words: 'Lab result' },
  { code: 'other', words: 'Something else' },
] as const satisfies readonly ReasonChoice<string>[]
export type MissedKind = (typeof MISSED_KINDS)[number]['code']
/** The most of one kind a reviewer may say was missed: five kinds of 40 stay within Session B's total of 200. */
export const MAX_MISSED = 40

export function isCode<Code extends string>(choices: readonly ReasonChoice<Code>[], value: unknown): value is Code {
  return typeof value === 'string' && choices.some(choice => choice.code === value)
}

/** Whether an extractions answer says the backend takes the review signals: its flag is exactly `true`. */
export function saysReviewLearning(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as Record<string, unknown>)[SERVED_FLAG] === true)
}
