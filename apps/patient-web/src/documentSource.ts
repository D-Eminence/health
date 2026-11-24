import { isHidApiError } from '@hid/http'

/*
 * Migrate's source-page deletion (hid-system migration 0110; 7 days since hid-system#226, 0112): a scanned source page
 * is deleted 7 days after it was taken in. From then on EHR answers its download with 410 DOCUMENT_SOURCE_DELETED and lists the document with status
 * `source_deleted`. An earlier backend sends neither, so until it does nothing here changes what a page shows.
 *
 * Kept apart from staff/api.ts so pages and their tests read these words and checks even where the API is stubbed.
 */

/** The code EHR's 410 names when a document's source page was deleted. */
export const DOCUMENT_SOURCE_DELETED = 'DOCUMENT_SOURCE_DELETED'
/** A listed document's status once its source page was deleted. */
export const SOURCE_DELETED_STATUS = 'source_deleted'
/**
 * A listed document's status while its source page is being deleted (hid-system#226). The page is already on its way
 * out, so such a row is treated exactly as a deleted one: it says the same words and offers no download or OCR, rather
 * than offering an action that would only meet the 410 above.
 */
export const SOURCE_DELETING_STATUS = 'source_deleting'
/** What every page says of such a document, in place of its download or any error. */
export const SOURCE_DELETED_WORDS = 'Source page deleted after 7 days'

/** A signed storage link valid for expiresInSeconds (s3-storage.provider.ts createDownload). */
export interface DocumentLink {
  readonly url: string
  readonly expiresInSeconds: number
}

/** The download's answer for a document whose source page was deleted: there is no file to open. */
export interface DocumentSourceDeleted {
  readonly outcome: typeof SOURCE_DELETED_STATUS
}

/** What a document download answers: a link to open, or that the source page was deleted. */
export type DocumentDownload = DocumentLink | DocumentSourceDeleted

export const SOURCE_DELETED: DocumentSourceDeleted = Object.freeze({ outcome: SOURCE_DELETED_STATUS })

/** Whether a refusal is EHR's 410 DOCUMENT_SOURCE_DELETED: both the status and the code, never either alone. */
export function isSourceDeletedRefusal(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 410 && caught.code === DOCUMENT_SOURCE_DELETED
}

/** Whether a download answered that the source page was deleted. */
export function isSourceDeleted(result: DocumentDownload): result is DocumentSourceDeleted {
  return 'outcome' in result && result.outcome === SOURCE_DELETED_STATUS
}

/** Whether a listed document's source page was deleted, or is being deleted: it then offers no download or OCR. */
export function sourceDeleted(document: { readonly status?: string | null }): boolean {
  return document.status === SOURCE_DELETED_STATUS || document.status === SOURCE_DELETING_STATUS
}
