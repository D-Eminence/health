/**
 * Records a patient adds themselves ("Add a record", hid-system 0116): what one is, how a list page of them is read, and
 * what a Save sends. Shared by the patient portal (api.ts, AddRecord.tsx) and the staff chart's read-only list
 * (staff/api.ts), so both read an entry the same way. No request is made here.
 */

export const PATIENT_ENTRY_KINDS = ['visit', 'test', 'medicine', 'diagnosis', 'vaccination', 'other'] as const
export type PatientEntryKind = typeof PATIENT_ENTRY_KINDS[number]
/** What each kind is called, as "Add a record" names it, to the patient and on the chart. */
export const PATIENT_ENTRY_KIND_LABELS: Readonly<Record<PatientEntryKind, string>> = {
  visit: 'Visit', test: 'Test result', medicine: 'Medicine', diagnosis: 'Diagnosis', vaccination: 'Vaccine', other: 'Other',
}

/** What the patient enters for a record they add themselves: the Save's whole body. */
export interface OwnRecordInput {
  kind: PatientEntryKind
  title: string
  facilityName: string | null
  occurredOn: string
  notes: string | null
}

/** The backend's upper limits, in UTF-16 units (as a browser's maxLength counts), after trimming. */
export const TITLE_MAX = 160
export const PLACE_MAX = 160
export const NOTES_MAX = 1000
/** The earliest day the backend takes. */
export const FIRST_DAY = '1900-01-01'

// The backend refuses these in a title or place (ONE_LINE), and all but the newline in notes (PLAIN_TEXT).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// eslint-disable-next-line no-control-regex
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g

const oneLine = (value: string) => value.replace(CONTROL, ' ').trim()
/** Notes as the backend reads them: CRLF and CR as a newline, then trimmed. */
const asNotes = (value: string) => value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_NEWLINE, ' ').trim()

/**
 * What a Save sends for what was entered: a title and place on one line, notes with CRLF and CR read as a newline, each
 * trimmed, and any other control character (a pasted tab, say) sent as a space, which the backend would otherwise refuse.
 * A blank place or note is none.
 */
export function cleanOwnRecord(entry: OwnRecordInput): OwnRecordInput {
  return {
    kind: entry.kind, title: oneLine(entry.title), facilityName: entry.facilityName === null ? null : oneLine(entry.facilityName) || null,
    occurredOn: entry.occurredOn, notes: entry.notes === null ? null : asNotes(entry.notes) || null,
  }
}

/** How long notes are as the backend counts them: UTF-16 units, after CRLF and CR are read as a newline and trimming. */
export const ownRecordLength = (notes: string): number => asNotes(notes).length

/** Whether a title has the two characters the backend needs, counted as characters (an emoji is one), once trimmed. */
export const titleLongEnough = (title: string): boolean => Array.from(oneLine(title)).length >= 2

/**
 * A confirmed photo or file of an entry, as the records answer lists it (step 7; 0116 sends none). A status it does not
 * know reads as not yet cleared, never as clean.
 */
export interface PatientEntryDocument {
  id: string
  fileName: string
  mediaType: string
  /** Null when it is missing or not a number (a bigint may come as a string, and is read as a number). */
  sizeBytes: number | null
  status: 'uploaded' | 'available' | 'rejected'
  scanStatus: 'pending' | 'clean' | 'rejected'
  createdAt: string
}

/**
 * One record the patient added, as the records answer lists it under `patientEntries` and the list pages carry it: newest
 * `occurredOn` first, then newest added, with removed entries left out.
 */
export interface PatientEntry {
  id: string
  source: 'patient'
  kind: PatientEntryKind
  title: string
  facilityName: string | null
  occurredOn: string
  notes: string | null
  createdAt: string
  documents: PatientEntryDocument[]
}

/** A page of the list after the first: its entries, and the cursor of the page after it (null on the last). */
export interface PatientEntriesPage {
  items: PatientEntry[]
  nextBefore: string | null
}

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const entryText = (value: unknown, max: number): string | null => typeof value === 'string' && value !== '' && value.length <= max ? value : null
const entryTextOrNull = (value: unknown, max: number): string | null => typeof value === 'string' && value.length <= max ? value : null

function parsePatientEntryDocument(value: unknown): PatientEntryDocument | null {
  if (!isRow(value)) return null
  const id = entryText(value.id, 128), fileName = entryText(value.fileName, 255), mediaType = entryText(value.mediaType, 128), createdAt = entryText(value.createdAt, 64)
  if (!id || !fileName || !mediaType || !createdAt) return null
  const size = typeof value.sizeBytes === 'number' || typeof value.sizeBytes === 'string' ? Number(value.sizeBytes) : NaN
  return {
    id, fileName, mediaType, createdAt,
    sizeBytes: value.sizeBytes !== '' && Number.isFinite(size) && size >= 0 ? size : null,
    status: value.status === 'available' || value.status === 'rejected' ? value.status : 'uploaded',
    scanStatus: value.scanStatus === 'clean' || value.scanStatus === 'rejected' ? value.scanStatus : 'pending',
  }
}

function parsePatientEntry(value: unknown): PatientEntry | null {
  if (!isRow(value)) return null
  const id = entryText(value.id, 128), title = entryText(value.title, TITLE_MAX), occurredOn = entryText(value.occurredOn, 32), createdAt = entryText(value.createdAt, 64)
  if (!id || !title || !occurredOn || !createdAt || value.source !== 'patient') return null
  return {
    id, source: 'patient', title, occurredOn, createdAt,
    kind: PATIENT_ENTRY_KINDS.find(kind => kind === value.kind) ?? 'other',
    facilityName: entryTextOrNull(value.facilityName, PLACE_MAX) || null,
    // Twice the backend's limit: a note the API accepted is always shown.
    notes: entryTextOrNull(value.notes, 2 * NOTES_MAX) || null,
    documents: Array.isArray(value.documents)
      ? value.documents.flatMap(document => { const read = parsePatientEntryDocument(document); return read ? [read] : [] }) : [],
  }
}

/**
 * A list of entries, read: an entry or document missing what it needs is left out, never shown half. Null when it is not
 * a list.
 */
export function parsePatientEntries(value: unknown): PatientEntry[] | null {
  return Array.isArray(value) ? value.flatMap(item => { const read = parsePatientEntry(item); return read ? [read] : [] }) : null
}

/** A cursor as the backend issues one: opaque, at most 512 of A-Z a-z 0-9 _ -. Anything else is no next page. */
export const patientEntriesCursor = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null

/**
 * A list page ({ items, nextBefore }, and the staff read's `more`), or null when it is not one. With `more` sent as
 * false, there is no next page whatever the cursor says.
 */
export function parsePatientEntriesPage(value: unknown): PatientEntriesPage | null {
  if (!isRow(value)) return null
  const items = parsePatientEntries(value.items)
  if (!items) return null
  return { items, nextBefore: value.more === false ? null : patientEntriesCursor(value.nextBefore) }
}

/** A refused page whose cursor no longer fits the list (400 INVALID_CURSOR): read the list again from the start. */
export const saysListChanged = (error: unknown): boolean => isRow(error) && error.status === 400 && error.code === 'INVALID_CURSOR'
