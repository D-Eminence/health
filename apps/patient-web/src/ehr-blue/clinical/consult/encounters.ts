import { isHidApiError } from '@hid/http'
import { useLayoutEffect, useRef } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import type { ClinicalRecord, Encounter, Page } from '../../../staff/api'
import { refusedFields, refusalSentences } from '../../../staff/fieldProblem'
import { COMPLETE_FIELD, type FieldDef, type FieldErrors, type FormValues } from '../parts/RecordForm'
import { shortId } from '../parts/format'
import { NOTE_TYPE as NURSING_NOTE_TYPE } from '../nursing/observations'

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

/** The consultation's status changes, by its status: the new status, then the button and form label. */
export const ENCOUNTER_TRANSITIONS: Readonly<Record<string, readonly StatusOption[]>> = {
  planned: [{ value: 'in_progress', label: 'Start consultation' }, { value: 'cancelled', label: 'Cancel consultation' },
    { value: 'entered_in_error', label: 'Mark as entered in error' }],
  in_progress: [{ value: 'completed', label: 'Complete consultation' }, { value: 'on_hold', label: 'Put on hold' },
    { value: 'cancelled', label: 'Cancel consultation' }, { value: 'entered_in_error', label: 'Mark as entered in error' }],
  on_hold: [{ value: 'in_progress', label: 'Resume consultation' }, { value: 'cancelled', label: 'Cancel consultation' },
    { value: 'entered_in_error', label: 'Mark as entered in error' }],
}

/** The changes that also change the encounter's records (today's CLOSING_STATUSES). */
export const CLOSING_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'entered_in_error'])

const MAIN_ENCOUNTER_CLOSES_RECORDS = 'Cancelling also cancels its open prescriptions and lab requests. Marking it entered in error also marks its notes, diagnoses, vitals, documents and orders. Pharmacy and the laboratory are not told: contact them about any order already sent.'
const NOVU_ENCOUNTER_CLOSES_RECORDS = 'Closing or cancelling doesn’t change its prescriptions or lab requests. Change or cancel each one; one sent to another facility is then withdrawn there.'

/** The warning on a consultation status change, for the service this build talks to. */
export function encounterClosesRecords(): string {
  return usesNovuBackend() ? NOVU_ENCOUNTER_CLOSES_RECORDS : MAIN_ENCOUNTER_CLOSES_RECORDS
}

export function retractionNotPermitted(status: string): string {
  return `You can’t ${status === 'cancelled' ? 'cancel this consultation' : 'mark this consultation entered in error'}: it holds records your role can’t change. Nothing was changed. Ask a doctor or clinician to do it.`
}

/**
 * Today's clinical note changes. A note is signed by "Sign note", as nursing signs one (today's noteTransitions);
 * the design's "Amend signed note" and "Edit unsigned draft" record a revision.
 */
export const NOTE_EIE_LABEL = 'Mark note entered in error'
export const SIGN_LABEL = 'Sign note'
export const AMEND_LABEL = 'Amend signed note'
export const EDIT_DRAFT_LABEL = 'Edit draft'
export const WRITE_NOTE_LABEL = 'Write note'

/** The Notes card (today's Notes tab): every clinical note of the encounter that is not a nursing observation. */
export const NOTES_TITLE = 'Clinical notes'
export const NO_NOTES = 'No notes for this encounter.'
export const NO_NOTES_ON_PAGE = 'No clinical notes on this page.'
export const REVIEW_NOTE = 'Review note content'
export const HIDE_NOTE = 'Hide note content'
export const ADD_REVISION_LABEL = 'Add a note revision'
export const RECORD_REVISION = 'Record revision'
export const RECORDING = 'Recording…'
export const SAVE_DRAFT = 'Save draft'
export const UPDATING = 'Updating…'

/** Today's status change reason ("Reason for change") and revision reason ("Reason for revision"), at least 3 characters. */
export const REASON_FIELD: FieldDef = { key: 'reason', label: 'Reason for change', required: true, maxLength: 500 }
export const REVISION_REASON_FIELD: FieldDef = { key: 'reason', label: 'Reason for revision', required: true, maxLength: 500 }
export const REVISION_CONTENT_FIELD: FieldDef = { key: 'content', label: 'Content', type: 'textarea', required: true, maxLength: 100_000 }
export const CONTENT_EMPTY = 'Enter the revised note content.'
export function reasonCheck(values: FormValues): FieldErrors {
  return text(values.reason).length < 3 ? { reason: REASON_SHORT } : {}
}
export function contentCheck(values: FormValues): FieldErrors {
  return text(values.content) ? {} : { content: CONTENT_EMPTY }
}

/** Today's note texts, word for word (Clinical.tsx NotePanel and changeRecordStatus). */
export const RELOAD_NOTE = 'Reload the note before recording a revision.'
export const RELOAD_RECORD = 'Reload the record before changing its status.'
export const REVISION_FAILED = 'Note revision could not be recorded.'
export const STATUS_FAILED = 'Status could not be changed.'
export const RECORD_NOT_SAVED = 'Record could not be saved.'
export const RELOAD_FAILED = 'The change was saved, but the records could not be reloaded.'

/** Today's diagnosis choices. */
export const DIAGNOSIS_CLINICAL_STATUSES: readonly StatusOption[] = [
  { value: 'active', label: 'Active' }, { value: 'recurrence', label: 'Recurrence' }, { value: 'relapse', label: 'Relapse' },
  { value: 'inactive', label: 'Inactive' }, { value: 'remission', label: 'Remission' }, { value: 'resolved', label: 'Resolved' },
]
export const DIAGNOSIS_VERIFICATION_STATUSES: readonly StatusOption[] = [
  { value: 'unconfirmed', label: 'Unconfirmed' }, { value: 'provisional', label: 'Provisional' },
  { value: 'differential', label: 'Differential' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'refuted', label: 'Refuted' },
]

/** The consultation's messages, in plain words. */
export const RESTARTED = 'This list changed since it was opened, so it shows the newest entries again.'
export const NO_ENCOUNTERS = 'No consultations for this patient here yet.'
export const NO_COMPLAINT = 'No complaint recorded'
export const ENCOUNTER_CREATED = 'Consultation started.'
export const RECORD_SAVED = 'Saved.'
export const NOTE_STATUS_UPDATED = 'Note updated.'
export const ENCOUNTER_STATUS_UPDATED = 'Consultation updated.'
export const REVISION_RECORDED = 'Note changes saved.'
export const DIAGNOSIS_UPDATED = 'Diagnosis updated.'
export const REASON_SHORT = 'Give a reason of at least 3 characters.'
export const ENCOUNTER_CHANGED = 'Someone changed this consultation while you had it open. It now shows its current status; choose the change again if it’s still needed.'
export const NOTES_ARE_DRAFTS = 'The note saves as a draft. Sign it on the consultation’s page.'
export const NO_WRITE = 'Your access doesn’t allow changes to this patient’s records.'

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

/** A file size as EHR sends it, a number or text, in KB or MB. */
export function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  if (!Number.isFinite(count) || count < 0) return 'Size unknown'
  return count >= 1024 * 1024 ? `${(count / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.ceil(count / 1024)).toLocaleString('en-GB')} KB`
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

/** A diagnosis's status as its row shows it: entered in error first, then refuted (ruled out), then the clinical status. */
export function diagnosisStatus(record: ClinicalRecord): string {
  if (record.verificationStatus === 'entered_in_error') return 'entered_in_error'
  if (record.verificationStatus === 'refuted') return 'refuted'
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
  // A nursing observation is a clinical note too (nursing/observations.ts): it is never the consultation's note.
  const consultation = (notes ?? []).filter(note => note.noteType !== NURSING_NOTE_TYPE)
  if (consultation.length === 0) return null
  return consultation.find(note => note.status !== 'entered_in_error') ?? consultation[0] ?? null
}

/**
 * The design's consultation fields as one clinical note: each section the clinician filled, under its label, in the
 * design's order.
 */
export function composeNote(sections: readonly (readonly [string, string])[]): string {
  return sections.filter(([, value]) => value).map(([label, value]) => `${label}\n${value}`).join('\n\n')
}

/**
 * New consultation's diagnosis fields, also offered (optional) in "Edit unsigned draft" and "Amend signed note": with
 * a code system and code, the assessment is saved as this encounter's diagnosis, as New consultation saves it.
 */
export const NEW_DIAGNOSIS_FIELDS: readonly FieldDef[] = [
  { key: 'diagnosis', label: 'Diagnosis', maxLength: 500, hint: 'Optional. Add its code to save it as this consultation’s diagnosis.' },
  { key: 'diagnosisCodeSystem', label: 'Code system', placeholder: 'ICD-10', maxLength: 255, row: 'code' },
  { key: 'diagnosisCode', label: 'Code', maxLength: 100, row: 'code' },
  { key: 'diagnosisClinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES },
  { key: 'diagnosisVerification', label: 'Verification', choices: DIAGNOSIS_VERIFICATION_STATUSES },
]
export const NEW_DIAGNOSIS_INITIAL: FormValues = { diagnosisClinicalStatus: 'active', diagnosisVerification: 'unconfirmed' }
const NEW_DIAGNOSIS_KEYS = ['diagnosis', 'diagnosisCodeSystem', 'diagnosisCode'] as const
/** A refused diagnosis create's DTO fields, named by the form's keys, so each refusal shows at its field. */
export const NEW_DIAGNOSIS_REFUSED: Readonly<Record<string, string>> = {
  display: 'diagnosis', codeSystem: 'diagnosisCodeSystem', code: 'diagnosisCode', clinicalStatus: 'diagnosisClinicalStatus', verificationStatus: 'diagnosisVerification',
}

/** Once any of the assessment, its code system or its code is typed, all three are needed (New consultation's check). */
export function newDiagnosisCheck(values: FormValues): FieldErrors {
  const errors: Record<string, string> = {}
  if (NEW_DIAGNOSIS_KEYS.some(key => text(values[key]))) {
    for (const key of NEW_DIAGNOSIS_KEYS) if (!text(values[key])) errors[key] = COMPLETE_FIELD
  }
  return errors
}

/** The diagnosis to create from those fields (today's `createRecord(…, 'diagnoses', …)` body), or null when none was typed. */
export function newDiagnosisBody(values: FormValues) {
  const display = text(values.diagnosis)
  if (!display) return null
  return {
    codeSystem: text(values.diagnosisCodeSystem), code: text(values.diagnosisCode), display,
    clinicalStatus: text(values.diagnosisClinicalStatus) || 'active', verificationStatus: text(values.diagnosisVerification) || 'unconfirmed',
  }
}

/** The sections New consultation composes a note from (composeNote), in its order. */
const NOTE_SECTIONS = [['history', 'History'], ['examination', 'Examination'], ['note', 'Clinical note'], ['followup', 'Follow-up']] as const

export interface NoteSections {
  /** The content was composed from sections; otherwise it is one note, whole. */
  readonly sectioned: boolean
  readonly history: string
  readonly examination: string
  readonly note: string
  readonly followup: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A consultation note's content split back into the sections New consultation composed it from: each section's label
 * on its own line ("History", or "History:"), then its text, sections a blank line apart and in composeNote's order.
 * Content that does not start with one of them is not sectioned: it is the whole note.
 */
export function splitNote(content: string): NoteSections {
  const found: { key: typeof NOTE_SECTIONS[number][0]; start: number; body: number }[] = []
  let from = 0
  for (const [key, label] of NOTE_SECTIONS) {
    const heading = new RegExp(`(^|\\n\\n)${escapeRegExp(label)}:?[ \\t]*\\n`, 'g')
    heading.lastIndex = from
    const match = heading.exec(content)
    // The first section starts the content; each later one follows the one before.
    if (!match || (found.length === 0 && match.index !== 0)) continue
    found.push({ key, start: match.index, body: match.index + match[0].length })
    from = match.index + match[0].length
  }
  const sections = { history: '', examination: '', note: '', followup: '' }
  if (found.length === 0) return { sectioned: false, ...sections, note: content }
  found.forEach((section, index) => {
    const end = found[index + 1]?.start ?? content.length
    sections[section.key] = content.slice(section.body, end).trim()
  })
  return { sectioned: true, ...sections }
}

/** The latest value, read from callbacks and effects without making them re-run (the chart's verify changes often). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return ref
}
