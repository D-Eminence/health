/**
 * Who may do which step of scanning paper records, from the facility's permission codes (hid-system 0136, Q112 A:
 * docs/INTERFACE_CONTRACT.md "The three new permission codes" and "What the services check").
 *
 * - Following readings (`GET /ocr/jobs?documentId=`, `GET /ocr/jobs/:jobId`): `ocr.job.read`, or `ocr.job.read-own`
 *   (the front desk), which sees only the readings of documents this login uploaded here, and never their text.
 * - What was read, its check and its publication (`.../extractions`, `.../validations`, `.../publications`): still
 *   `ocr.job.read` alone.
 * - Starting or retrying a reading (`POST /ocr/jobs`, `POST /ocr/jobs/:jobId/retry`): `ocr.job.write` and
 *   `ocr.job.start` (front desk, nurses, clinicians; doctors keep `ocr.job.write` for checking, not `ocr.job.start`).
 * - Listing and opening documents (`GET /ehr/documents`, `.../download`): `ehr.document.read`, or
 *   `ehr.document.read-own` (the front desk), which lists and opens only the documents this login uploaded here.
 * - Uploading: `ehr.document.write`, unchanged.
 *
 * A login that holds the full code through any role keeps the full read: the "-own" codes narrow nobody.
 */

export const OCR_JOB_READ = 'ocr.job.read'
export const OCR_JOB_READ_OWN = 'ocr.job.read-own'
export const OCR_JOB_WRITE = 'ocr.job.write'
export const OCR_JOB_START = 'ocr.job.start'
export const DOCUMENT_READ = 'ehr.document.read'
export const DOCUMENT_READ_OWN = 'ehr.document.read-own'
export const DOCUMENT_WRITE = 'ehr.document.write'

/** Any one of these opens Scan paper records (the page registry's entry, frame/pages.ts and migrate/page.tsx). */
export const FOLLOWS_READINGS: readonly string[] = [OCR_JOB_READ, OCR_JOB_READ_OWN]
/** Any one of these lists a visit's documents. */
export const READS_DOCUMENTS: readonly string[] = [DOCUMENT_READ, DOCUMENT_READ_OWN]

export interface ScanAccess {
  /** Follows readings: the page opens, and a document's reading can be found and its progress seen. */
  readonly followsReadings: boolean
  /** Sees only the readings of documents this login uploaded (the "-own" code without the full one). */
  readonly ownReadingsOnly: boolean
  /** Sees what was read, its checks and its publications. */
  readonly readsText: boolean
  /** Starts (and retries) a reading. */
  readonly startsReadings: boolean
  /** Lists a visit's documents and opens them. */
  readonly readsDocuments: boolean
  /** Lists and opens only the documents this login uploaded. */
  readonly ownDocumentsOnly: boolean
  /** Uploads documents (the patient's own OK still decides, as before). */
  readonly uploadsDocuments: boolean
}

/** The steps open to the facility's permission codes, given as a list or as a check of one code (the chart's `can`). */
export function scanAccess(held: readonly string[] | ((code: string) => boolean)): ScanAccess {
  const has = typeof held === 'function' ? held : (code: string) => held.includes(code)
  const followsReadings = has(OCR_JOB_READ) || has(OCR_JOB_READ_OWN)
  const readsDocuments = has(DOCUMENT_READ) || has(DOCUMENT_READ_OWN)
  return {
    followsReadings,
    ownReadingsOnly: followsReadings && !has(OCR_JOB_READ),
    readsText: has(OCR_JOB_READ),
    startsReadings: followsReadings && has(OCR_JOB_WRITE) && has(OCR_JOB_START),
    readsDocuments,
    ownDocumentsOnly: readsDocuments && !has(DOCUMENT_READ),
    uploadsDocuments: has(DOCUMENT_WRITE),
  }
}

/**
 * Said where "Extract with OCR" or Create record would be, to someone who follows readings but may not start one (a
 * doctor since 0136): who starts them, so there is never a button that only answers with a refusal.
 */
export const STARTS_WITH_OTHERS = 'Readings of scanned pages are started by the front desk, a nurse or a clinician at this facility.'

/** Said on a reading to someone who sees only its progress (the front desk): who sees what was read. */
export const TEXT_WITH_CHECKERS = 'What was read is shown to the doctors, nurses and clinicians who check it.'

/** Said over a list that holds only this login's own uploads (the front desk). */
export const OWN_DOCUMENTS_ONLY = 'You see the documents you uploaded here.'
