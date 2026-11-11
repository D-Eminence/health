import type { OcrExtraction } from '../../../staff/api'

/** What a reading blanked by Migrate's 24-hour deletion (hid-system 0110) says in place of an empty review. */
export const READING_DELETED = 'Reading deleted after 24 hours'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether OCR blanked this reading after 24 hours (hid-system 0110): its text is null and its structured payload an
 * empty object. An extraction that says when it was made must be at least 24 hours old, so a fresh reading that found
 * nothing is never taken for a deleted one. Missing text ('', undefined) or any payload with a member is today's reading.
 */
export function readingDeleted(extraction: OcrExtraction & { readonly createdAt?: string | null }, now = Date.now()): boolean {
  if (extraction.rawText !== null) return false
  const payload = extraction.structuredPayload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length > 0) return false
  if (typeof extraction.createdAt !== 'string') return true
  const made = Date.parse(extraction.createdAt)
  return Number.isNaN(made) || now - made >= DAY_MS
}
