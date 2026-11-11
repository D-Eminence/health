/*
 * Migrate learning, phase 1: what staff may tell the reading service while they check a paper reading, and the staff
 * "Reading quality" read that counts it. Owner decision Q43: learn without additional stress or work for users, so
 * nothing here is ever required. There is no page tick; every reason is an optional one-tap choice; the missed count is
 * one optional box.
 *
 * Session B's names (hid-system branch claude/ecstatic-ramanujan-q4i1eo-ocr-review-outcomes, d9c02668: ocr-api
 * validate-ocr-job.dto.ts, quality/review-outcome.ts, reading/extraction-view.ts, INTERFACE_CONTRACT.md section 15
 * "Optional review signals"): top-level `reviewConfirmed`, `missedItems` (one whole number, 0-200), `removedItems`
 * ([{ itemId, removalReason? }], up to 200) and, on a rejection only, `rejectionReasonCode`; on a corrections[] entry,
 * `fields` and `changeReason`. Every one, and every reason, is optional. The server has no field for the items seen:
 * they make up `reviewConfirmed` (reviewPayload.ts).
 *
 * Each extraction on GET /api/v1/ocr/jobs/:jobId/extractions carries `reviewLearning: true` on an ocr-api that takes
 * the signals. Until the page sees it, it sends exactly what it sends today: an older ocr-api takes its validation
 * body with forbidNonWhitelisted, so any new key would be refused (400).
 */

/** `true` on each extraction of GET /api/v1/ocr/jobs/:jobId/extractions from an ocr-api that takes the review signals. */
export const SERVED_FLAG = 'reviewLearning'

/** Session B's field classes (review-outcome.ts FIELD_CLASSES) the website names in corrections[].fields. */
export type FieldClass = 'name' | 'strength' | 'dose' | 'frequency' | 'route' | 'duration' | 'date' | 'value' | 'unit'

/** The review signals beside OCR's validation body, every one optional. */
export interface ReviewSignals {
  readonly reviewConfirmed?: boolean
  readonly missedItems?: number
  readonly removedItems?: readonly { readonly itemId: string; readonly removalReason?: RemovalReason }[]
  readonly rejectionReasonCode?: RejectionReason
}

/**
 * The staff "Reading quality" read, in Migrate: Session B's review-outcome summary (schema hid.ocr.quality-summary/v1)
 * for the one facility named by X-Facility-ID (row-level security), for the last 28 days by default. Platform
 * administrators only: a staff actor whose platform permissions include both of READING_QUALITY_PERMISSIONS, else 403.
 * The platform-wide admin read comes with phase 2 (hid-system #237).
 */
export const READING_QUALITY_PATH = '/api/v1/ocr/quality/summary'
/** Session B's platform permissions for the summary (quality-summary.service.ts QUALITY_PERMISSIONS): both are needed. */
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

/** "The reading missed…": one optional total, as Session B takes it (missedItems, 0-200). */
export const MAX_MISSED_ITEMS = 200

export function isCode<Code extends string>(choices: readonly ReasonChoice<Code>[], value: unknown): value is Code {
  return typeof value === 'string' && choices.some(choice => choice.code === value)
}

/** Whether an extraction (or an extractions answer) says the backend takes the review signals: its flag is exactly `true`. */
export function saysReviewLearning(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as Record<string, unknown>)[SERVED_FLAG] === true)
}
