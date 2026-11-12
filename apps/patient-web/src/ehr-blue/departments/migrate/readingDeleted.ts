import type { OcrExtraction } from '../../../staff/api'

/** What a reading blanked by Migrate's 7-day deletion (hid-system 0110, 7 days since 0112) says in place of an empty review. */
export const READING_DELETED = 'Reading deleted after 7 days'

/** How long a reading is kept before OCR blanks it (hid-system#226, 0112; it was 24 hours before). */
const KEPT_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether OCR blanked this reading after 7 days (hid-system 0110, 0112).
 *
 * When the server says so (hid-system#226 `contentDeleted`), its word decides. `true` is a deleted reading whatever its
 * shape or age. `false` is a kept reading even if it looks blank: the server knows whether it blanked the content, and a
 * reading that genuinely found nothing (null text, an empty payload) must not be told to the reader as deleted.
 *
 * Without the flag (an earlier backend), the shape and age decide: its text is null and its structured payload an
 * empty object. An extraction that says when it was made must be at least 7 days old, so a fresh reading that found
 * nothing is never taken for a deleted one. Missing text ('', undefined) or any payload with a member is today's reading.
 */
export function readingDeleted(
  extraction: OcrExtraction & { readonly createdAt?: string | null; readonly contentDeleted?: boolean | null },
  now = Date.now(),
): boolean {
  if (extraction.contentDeleted === true) return true
  if (extraction.contentDeleted === false) return false
  if (extraction.rawText !== null) return false
  const payload = extraction.structuredPayload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length > 0) return false
  if (typeof extraction.createdAt !== 'string') return true
  const made = Date.parse(extraction.createdAt)
  return Number.isNaN(made) || now - made >= KEPT_MS
}
