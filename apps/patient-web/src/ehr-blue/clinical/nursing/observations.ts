import { useCallback, useEffect, useState } from 'react'
import { staffApi, type ClinicalRecord, type NoteRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'

/** The sidebar label, the list's heading; the create page's heading ("New " + the label, lower case). */
export const TITLE = 'Nursing observations'
export const NEW_TITLE = 'New nursing observations'
export const AMEND_LABEL = 'Amend observation'

/**
 * A nursing observation is today's clinical note: its note type names it, its title is the design's category, and
 * its content holds the details, then the units or dose on a line of their own. Vital signs are not one of them: they
 * are recorded in Triage & Vitals, where they are range-checked and kept as vitals (an observation saved earlier under
 * "Vitals" still shows wherever notes show).
 */
export const NOTE_TYPE = 'Nursing observation'
export const CATEGORIES = ['Medication administration', 'Handover', 'Care task'] as const
const UNITS = 'Units / dose: '
/** Today's note content limit, less room for the units line. */
export const DETAILS_LIMIT = 99_000
export const UNITS_LIMIT = 200

/** An observation named by when it was recorded ("Observation · 2 Nov 2026, 09:14"), never by its id. */
export function observationName(record: Pick<ClinicalRecord, 'createdAt'>): string {
  const when = formatWhen(record.createdAt)
  return when ? `Observation · ${when}` : 'Observation'
}

export function isObservation(record: ClinicalRecord) {
  return record.noteType === NOTE_TYPE
}

/**
 * An observation saved under the old "Vitals" category (offered until 1 November 2026, no longer saved): a clinical
 * note, never range-checked and not in the vitals chart, so wherever its text shows, a line goes under it. The line is
 * the owner's (OLD_VITALS_NOTE), naming the date, for a note saved before 1 November, or one with no time to read. A
 * "Vitals" note saved on or after 1 November should not exist; if one does, its line names no date (OLD_VITALS_NOTE_LATE).
 */
export const OLD_VITALS_CATEGORY = 'Vitals'
export const OLD_VITALS_NOTE = 'Saved as a note before 1 November. These readings are not in the vitals chart.'
export const OLD_VITALS_NOTE_LATE = 'Saved as a note under the old Vitals category. These readings are not in the vitals chart.'
/** 1 November 2026, 00:00 in Lagos (UTC+1): the category's last day was 31 October. */
const VITALS_CLOSED = Date.parse('2026-10-31T23:00:00.000Z')

export function isOldVitalsNote(note: Readonly<Record<string, unknown>>): boolean {
  return note.noteType === NOTE_TYPE && typeof note.title === 'string' && note.title.trim() === OLD_VITALS_CATEGORY
}

/**
 * The line under an old "Vitals" note's text, or null for any other note. The note's own time is read: when it was
 * created (saved), or, where a read gives no such time (the emergency summary), when it was signed, which is never
 * earlier. With no time, or one that is not a date, the owner's line.
 */
export function oldVitalsLine(note: Readonly<Record<string, unknown>>): string | null {
  if (!isOldVitalsNote(note)) return null
  const when = typeof note.createdAt === 'string' && note.createdAt ? note.createdAt
    : typeof note.signedAt === 'string' && note.signedAt ? note.signedAt : null
  const time = when === null ? Number.NaN : Date.parse(when)
  return !Number.isNaN(time) && time >= VITALS_CLOSED ? OLD_VITALS_NOTE_LATE : OLD_VITALS_NOTE
}

/** Today's note wording, word for word. */
export const REVISION_RECORDED = 'A new note revision was recorded.'
export const REVISION_FAILED = 'Note revision could not be recorded.'
export const CONTENT_EMPTY = 'Enter the revised note content.'
export const RELOAD_NOTE = 'Reload the note before recording a revision.'
export const CONTENT_FAILED = 'Note content could not be loaded.'
export const NO_CONTENT = 'No note content is available.'
export const LOADING_REVISIONS = 'Loading note revisions…'
export const REFRESH_REVISIONS = 'Refresh revisions'
/** Today's revision form's button, and its words while it records (Clinical.tsx:886): the Notes card's and the amendment's. */
export const RECORD_REVISION = 'Record revision'
export const RECORDING = 'Recording…'
export const NOTE_STATUS_UPDATED = 'Clinical note status updated.'
export const STATUS_FAILED = 'Status could not be changed.'
export const RELOAD_RECORD = 'Reload the record before changing its status.'
export const SIGN_LABEL = 'Sign note'
export const ERROR_LABEL = 'Mark entered in error'

export type NoteStatusChange = 'signed' | 'entered_in_error'

/** Today's note status changes (Clinical.tsx noteTransitions), by the note's status. */
export const NOTE_TRANSITIONS: Readonly<Record<string, readonly { readonly status: NoteStatusChange; readonly label: string }[]>> = {
  draft: [{ status: 'signed', label: SIGN_LABEL }, { status: 'entered_in_error', label: ERROR_LABEL }],
  signed: [{ status: 'entered_in_error', label: ERROR_LABEL }],
  amended: [{ status: 'entered_in_error', label: ERROR_LABEL }],
}

export function composeObservation(details: string, units: string): string {
  return units ? `${details}\n\n${UNITS}${units}` : details
}

export function parseObservation(content: string): { details: string; units: string } {
  const match = /\n\nUnits \/ dose: ([^\n]*)$/.exec(content)
  if (!match) return { details: content, units: '' }
  return { details: content.slice(0, match.index), units: match[1]!.trim() }
}

/** The design's "Note" and "Units", each only when there is one. */
export function observationItems(content: string): KeyValue[] {
  const { details, units } = parseObservation(content)
  return [{ label: 'Note', value: details }, ...(units ? [{ label: 'Units', value: units }] : [])]
}

export function noteStatus(note: ClinicalRecord): string {
  return typeof note.status === 'string' && note.status ? note.status : 'unknown'
}

export type Revisions =
  /** `earlier`: what the last read of this version showed, while it is read again ("Refresh revisions"). */
  | { readonly state: 'loading'; readonly earlier: readonly NoteRevision[] | null }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'shown'; readonly items: readonly NoteRevision[] }

type Answer = Exclude<Revisions, { readonly state: 'loading' }>

/**
 * A note's revisions, today's read (no re-check), read again whenever the note's version changes, and on `refresh()`
 * (today's NotePanel "Refresh revisions", Clinical.tsx: also the retry after a failed read).
 */
export function useRevisions(chart: Chart, encounterId: string, note: ClinicalRecord): Revisions & { readonly refresh: () => void } {
  const { facilityId, patientId } = chart
  const key = `${note.id}-${String(note.rowVersion)}`
  const [asked, setAsked] = useState(0)
  const [read, setRead] = useState<{ key: string; asked: number; value: Answer } | null>(null)

  useEffect(() => {
    let current = true
    staffApi.noteRevisions(facilityId, patientId, encounterId, note.id).then(
      items => { if (current) setRead({ key, asked, value: { state: 'shown', items: [...items].sort((a, b) => a.revisionNo - b.revisionNo) } }) },
      caught => { if (current) setRead({ key, asked, value: { state: 'failed', message: refusalText(caught, CONTENT_FAILED) } }) },
    )
    return () => { current = false }
  }, [asked, encounterId, facilityId, key, note.id, patientId])

  const refresh = useCallback(() => setAsked(count => count + 1), [])
  if (read?.key === key && read.asked === asked) return { ...read.value, refresh }
  return { state: 'loading', earlier: read?.key === key && read.value.state === 'shown' ? read.value.items : null, refresh }
}
