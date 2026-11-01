import { useCallback, useEffect, useState } from 'react'
import { staffApi, type ClinicalRecord, type NoteRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import type { KeyValue } from '../parts/KeyValueList'

/** The sidebar label, the list's heading; the create page's heading ("New " + the label, lower case). */
export const TITLE = 'Nursing observations'
export const NEW_TITLE = 'New nursing observations'
export const AMEND_LABEL = 'Amend observation'

/**
 * A nursing observation is today's clinical note: its note type names it, its title is the design's category, and
 * its content holds the details, then the units or dose on a line of their own.
 */
export const NOTE_TYPE = 'Nursing observation'
export const CATEGORIES = ['Vitals', 'Medication administration', 'Handover', 'Care task'] as const
const UNITS = 'Units / dose: '
/** Today's note content limit, less room for the units line. */
export const DETAILS_LIMIT = 99_000
export const UNITS_LIMIT = 200

export function isObservation(record: ClinicalRecord) {
  return record.noteType === NOTE_TYPE
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
