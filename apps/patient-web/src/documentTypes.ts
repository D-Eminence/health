import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { isPlatformAdminHostname, resolveStaffProductHostname } from './productHostname'
import type { OcrTargetDomain } from './staff/api'

/**
 * What kind of document a facility uploads (the owner's rule, 31 Oct). Today every upload is a clinical document on an
 * encounter; with the document types a laboratory may also upload a lab result on its Lab work item, and a pharmacy a
 * prescription sheet on its Pharmacy work item (lab and pharmacy staff cannot open encounters). Each file is stored
 * exactly as uploaded and read by OCR automatically once its virus scan is clean: the backend does that, the website
 * only says so.
 *
 * `clinical_document` is the default: an upload that names no type is one, as every upload is today.
 */
export const DOCUMENT_TYPES = ['clinical_document', 'lab_result', 'prescription_sheet'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DEFAULT_DOCUMENT_TYPE: DocumentType = 'clinical_document'

/** What each type is called on screen. */
export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  clinical_document: 'Clinical document',
  lab_result: 'Lab result',
  prescription_sheet: 'Prescription sheet',
}

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
}

export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[type]
}

/**
 * A listed document's type, read only when it is one of the three: a document without one (today's backend, which
 * stores only clinical documents) is a clinical document; a value not named here (a later contract) is `null`, so the
 * screen says nothing about it rather than calling it something it is not.
 */
export function documentTypeOf(record: { readonly documentType?: unknown }): DocumentType | null {
  const value = record.documentType
  if (value === undefined || value === null) return DEFAULT_DOCUMENT_TYPE
  return isDocumentType(value) ? value : null
}

/**
 * The domain each type suggests for OCR's validation (its `targetDomain`): a lab result's text goes to Lab, a
 * prescription sheet's to Pharmacy, a clinical document's to the EHR. A suggestion only: the reviewer still chooses.
 */
export type DocumentOcrTarget = Extract<OcrTargetDomain, 'EHR' | 'LAB' | 'PHARMACY'>

const OCR_TARGETS: Readonly<Record<DocumentType, DocumentOcrTarget>> = {
  clinical_document: 'EHR',
  lab_result: 'LAB',
  prescription_sheet: 'PHARMACY',
}

export function suggestedOcrTarget(type: DocumentType): DocumentOcrTarget {
  return OCR_TARGETS[type]
}

const ALL_TYPES: readonly DocumentType[] = Object.freeze([...DOCUMENT_TYPES])
const PHARMACY_TYPES: readonly DocumentType[] = Object.freeze(['clinical_document', 'prescription_sheet'] as const)
const NO_TYPES: readonly DocumentType[] = Object.freeze([])

/**
 * The types a facility may upload on this host (the owner's host list, and the S3 CORS rule that matches it):
 * - ehr, lab and migrate, production and staging: all three;
 * - pharmacy: a clinical document or a prescription sheet ("Lab result" only on ehr, lab and migrate);
 * - outreach and the admin site: none (they upload nothing);
 * - any other host (local, preview, the staging main site): as ehr.
 * The default type comes first. Nothing from the hostname is kept.
 */
export function documentTypesOn(hostname: string): readonly DocumentType[] {
  if (isPlatformAdminHostname(hostname)) return NO_TYPES
  switch (resolveStaffProductHostname(hostname)?.key) {
    case 'outreach': return NO_TYPES
    case 'pharmacy': return PHARMACY_TYPES
    default: return ALL_TYPES
  }
}

/** The types a facility may upload on this page's host. The one place a screen reads the host, so tests can mock it. */
export function documentTypesHere(): readonly DocumentType[] {
  return documentTypesOn(window.location.hostname)
}

/**
 * Whether the backend serves the document types, as this page has learned it from the backend's own answers. The
 * website ships before that backend and stays dormant until it, as lateCorrectionServed.ts does for D17: until then it
 * never sends a `documentType`, `labWorkItemId` or `pharmacyWorkItemId`, never reads a work item's documents, and every
 * screen shows exactly what it shows today, so today's backend never sees a field it would refuse.
 *
 * What says so: `documentTypes: true` on the EHR's document list (GET /api/v1/ehr/documents), on a Lab work list
 * (GET /api/v1/lab/work-items) or on a Pharmacy work list (GET /api/v1/pharmacy/work-items).
 * What says it is not: one of those answers without it, and only while nothing has said otherwise. That covers a page
 * that has learned nothing yet; it is not a switch.
 *
 * `null` until an answer has said either (treated as not served). Once served, it stays served for the page's life.
 */
type Served = boolean | null

let served: Served = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

/** Records what an answer said: `true` once and for all, `false` only while nothing has said otherwise. */
export function learnDocumentTypesServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}

export function documentTypesServed(): Served { return served }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The same, re-rendering the caller when it is learned. */
export function useDocumentTypesServed(): Served {
  return useSyncExternalStore(subscribe, documentTypesServed, documentTypesServed)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetDocumentTypesServed(): void {
  served = null
  changed()
}

/** Whether an answer says the document types are served: its `documentTypes` is exactly `true`. */
export function saysDocumentTypes(answer: unknown): boolean {
  return Boolean(answer && typeof answer === 'object' && (answer as { documentTypes?: unknown }).documentTypes === true)
}

/**
 * Learns from a document list, a Lab work list or a Pharmacy work list that answered: served when it says so, otherwise
 * not served (only while nothing has said otherwise). Pass only those answers.
 */
export function learnDocumentTypesFrom(answer: unknown): void {
  learnDocumentTypesServed(saysDocumentTypes(answer))
}

/** The backend's refusal of a type on this host: a lab result from a host other than ehr, lab or migrate (403). */
export const DOCUMENT_TYPE_NOT_ALLOWED_HERE = 'DOCUMENT_TYPE_NOT_ALLOWED_HERE'
export const DOCUMENT_TYPE_NOT_ALLOWED_HERE_MESSAGE = 'Lab results can be uploaded only in the EHR, Lab or Migrate.'

/** The words for that refusal, or null for any other failure (the screen's own words apply). */
export function documentTypeRefusalText(caught: unknown): string | null {
  return isHidApiError(caught) && caught.code === DOCUMENT_TYPE_NOT_ALLOWED_HERE ? DOCUMENT_TYPE_NOT_ALLOWED_HERE_MESSAGE : null
}

/**
 * The website's own refusal, before any request: a type, a work item's documents or an upload to a work item asked for
 * while the backend has not said it serves them. No screen offers them then; this keeps today's backend from ever seeing
 * them if one did.
 */
export const DOCUMENT_TYPES_NOT_SERVED = 'DOCUMENT_TYPES_NOT_SERVED'
export const DOCUMENT_TYPES_NOT_SERVED_MESSAGE = 'This isn’t available yet.'
