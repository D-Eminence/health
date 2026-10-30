import { isHidApiError } from '@hid/http'
import { useLayoutEffect, useRef } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import type { ClinicalRecord, Encounter, Page } from '../../../staff/api'
import { refusedFields, refusalSentences } from '../../../staff/fieldProblem'
import type { FieldErrors } from '../parts/RecordForm'
import { shortId } from '../parts/format'

/** The sidebar label, the list's heading. */
export const TITLE = 'Consultation'
export const NEW_TITLE = 'New consultation'

export type StatusOption = { readonly value: string; readonly label: string }

/** Today's encounter types (Clinical.tsx EncounterForm), the first the default. */
export const ENCOUNTER_TYPES: readonly StatusOption[] = [
  { value: 'ambulatory', label: 'Outpatient' }, { value: 'emergency', label: 'Emergency' }, { value: 'inpatient', label: 'Inpatient' },
  { value: 'virtual', label: 'Virtual' }, { value: 'home', label: 'Home' }, { value: 'other', label: 'Other' },
]

export function encounterTypeLabel(value: string): string {
  return ENCOUNTER_TYPES.find(type => type.value === value)?.label ?? value.replaceAll('_', ' ')
}

/** The design titles a consultation by the first eight characters of its id. */
export function encounterTitle(encounter: Pick<Encounter, 'id'>): string {
  return shortId(encounter.id)
}

/**
 * Today's encounter status changes, named as the design names an action ("Sign encounter", "Cancel visit"): the
 * status, then the button and form label.
 */
export const ENCOUNTER_TRANSITIONS: Readonly<Record<string, readonly StatusOption[]>> = {
  planned: [{ value: 'in_progress', label: 'Start encounter' }, { value: 'cancelled', label: 'Cancel encounter' },
    { value: 'entered_in_error', label: 'Mark encounter entered in error' }],
  in_progress: [{ value: 'on_hold', label: 'Put encounter on hold' }, { value: 'completed', label: 'Complete encounter' },
    { value: 'cancelled', label: 'Cancel encounter' }, { value: 'entered_in_error', label: 'Mark encounter entered in error' }],
  on_hold: [{ value: 'in_progress', label: 'Resume encounter' }, { value: 'cancelled', label: 'Cancel encounter' },
    { value: 'entered_in_error', label: 'Mark encounter entered in error' }],
}

/** The changes that also change the encounter's records (today's CLOSING_STATUSES). */
export const CLOSING_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'entered_in_error'])

const MAIN_ENCOUNTER_CLOSES_RECORDS = 'Cancelling this encounter also cancels its draft, active and on-hold prescriptions and lab requests; its notes, diagnoses, vitals, documents and completed orders are not changed. Marking it entered in error also marks entered in error its notes, diagnoses and vitals, its documents (other than rejected uploads), and its prescriptions and lab requests that are not cancelled, completed ones included. Pharmacy and the Laboratory are not told: contact the pharmacy or laboratory about any order sent to them.'
const NOVU_ENCOUNTER_CLOSES_RECORDS = 'Closing or cancelling the encounter does not change its lab requests or prescriptions. Change or cancel each one: one sent to another facility is then withdrawn there, or cancelled if that facility had accepted it.'

/** Today's warning on an encounter status change, for the backend this build talks to. */
export function encounterClosesRecords(): string {
  return usesNovuBackend() ? NOVU_ENCOUNTER_CLOSES_RECORDS : MAIN_ENCOUNTER_CLOSES_RECORDS
}

export function retractionNotPermitted(status: string): string {
  return `You may not ${status === 'cancelled' ? 'cancel this encounter' : 'mark this encounter entered in error'}: it holds records that this change would also change, and your role may not change all of them. Nothing was changed. Ask a colleague whose role may change all of its records (usually a doctor or clinician) to make this change.`
}

/** Today's clinical note changes. */
export const NOTE_EIE_LABEL = 'Mark note entered in error'
export const SIGN_LABEL = 'Sign encounter'
export const AMEND_LABEL = 'Amend signed note'
export const EDIT_DRAFT_LABEL = 'Edit unsigned draft'
export const WRITE_NOTE_LABEL = 'Write clinical note'

/** Today's diagnosis choices. */
export const DIAGNOSIS_CLINICAL_STATUSES: readonly StatusOption[] = [
  { value: 'active', label: 'Active' }, { value: 'recurrence', label: 'Recurrence' }, { value: 'relapse', label: 'Relapse' },
  { value: 'inactive', label: 'Inactive' }, { value: 'remission', label: 'Remission' }, { value: 'resolved', label: 'Resolved' },
]
export const DIAGNOSIS_VERIFICATION_STATUSES: readonly StatusOption[] = [
  { value: 'unconfirmed', label: 'Unconfirmed' }, { value: 'provisional', label: 'Provisional' },
  { value: 'differential', label: 'Differential' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'refuted', label: 'Refuted' },
]

/** Today's messages, word for word. */
export const RESTARTED = 'This list changed since it was opened, so it shows the newest entries again.'
export const NO_ENCOUNTERS = 'No encounters are available for this patient and facility.'
export const NO_COMPLAINT = 'No chief complaint provided'
export const ENCOUNTER_CREATED = 'Encounter created by the backend.'
export const RECORD_SAVED = 'Clinical record saved by the backend.'
export const NOTE_STATUS_UPDATED = 'Clinical note status updated.'
export const ENCOUNTER_STATUS_UPDATED = 'Encounter status updated.'
export const REVISION_RECORDED = 'A new note revision was recorded.'
export const DIAGNOSIS_UPDATED = 'Diagnosis updated.'
export const REASON_SHORT = 'Give a reason of at least 3 characters.'
export const ENCOUNTER_CHANGED = 'This encounter changed since it was loaded and now shows its current status. Choose the change again if it is still needed.'
export const NOTES_ARE_DRAFTS = 'Notes are saved as drafts. Signing needs its own reviewed action.'
export const NO_WRITE = 'This access does not permit changes to the patient record.'

// EHR lists encounters and each record kind newest first, 50 to a page, with an opaque cursor for the next and no
// total. A list keeps the cursors that led to the page shown, the first page's being none.
export type Cursors = ReadonlyArray<string | undefined>
export const FIRST_PAGE: Cursors = [undefined]

/** Today's page read: a cursor EHR no longer accepts (400 INVALID_CURSOR) starts the list again. */
export async function readPage<P extends Page<unknown>>(read: (cursor: string | undefined, fresh: boolean) => Promise<P>, cursors: Cursors, fresh: boolean) {
  try { return { page: await read(cursors.at(-1), fresh), cursors, restarted: false } }
  catch (caught) {
    if (cursors.length < 2 || !isHidApiError(caught) || caught.code !== 'INVALID_CURSOR') throw caught
    return { page: await read(undefined, true), cursors: FIRST_PAGE, restarted: true }
  }
}

/** A row version as EHR sends it (a number or text), or null when it cannot be sent back. */
export function rowVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

/** A file size as EHR sends it, a number or text, in KiB. */
export function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

export function isoNow() { return new Date().toISOString() }

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The refused DTO fields of a 400 VALIDATION_FAILED, as the form's own field errors (`map`: DTO name to form key). */
export function refusedFieldErrors(caught: unknown, map: Readonly<Record<string, string>>): FieldErrors {
  const errors: Record<string, string> = {}
  for (const refused of refusedFields(caught)) {
    const key = map[refused.field]
    if (key) errors[key] = refusalSentences(refused).join(' ')
  }
  return errors
}

/** A diagnosis's status as its row shows it: entered in error first, then the clinical status. */
export function diagnosisStatus(record: ClinicalRecord): string {
  if (record.verificationStatus === 'entered_in_error') return 'entered_in_error'
  return typeof record.clinicalStatus === 'string' && record.clinicalStatus ? record.clinicalStatus : 'recorded'
}

export function recordStatus(record: ClinicalRecord, fallback = 'recorded'): string {
  return typeof record.status === 'string' && record.status ? record.status : fallback
}

export function field(record: ClinicalRecord, key: string): string {
  const value = record[key]
  return value == null ? '' : String(value)
}

/**
 * The consultation note an encounter shows: the newest note not entered in error, else the newest. EHR lists notes
 * newest first.
 */
export function consultationNote(notes: readonly ClinicalRecord[] | null): ClinicalRecord | null {
  if (!notes || notes.length === 0) return null
  return notes.find(note => note.status !== 'entered_in_error') ?? notes[0] ?? null
}

/**
 * The design's consultation fields as one clinical note: each section the clinician filled, under its label, in the
 * design's order.
 */
export function composeNote(sections: readonly (readonly [string, string])[]): string {
  return sections.filter(([, value]) => value).map(([label, value]) => `${label}\n${value}`).join('\n\n')
}

/** The latest value, read from callbacks and effects without making them re-run (the chart's verify changes often). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return ref
}
