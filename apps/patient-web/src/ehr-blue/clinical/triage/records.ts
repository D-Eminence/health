import { isHidApiError } from '@hid/http'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { staffApi, type ClinicalRecord, type Encounter, type Page, type RecordKind } from '../../../staff/api'
import { refusalSentences, refusalText, refusedFields } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { formatWhen, shortId, statusLabel } from '../parts/format'
import type { FieldErrors } from '../parts/RecordForm'

/**
 * What Triage & Vitals and Nursing observations share: the open patient's records of one kind across their
 * encounters at this facility (the design's "Visit"), read as today's chart reads them.
 */

/** The chart's wording, in plain words. */
export const RESTARTED = 'This list changed since it was opened, so it shows the newest entries again.'
export const NO_ENCOUNTERS = 'No encounters are available for this patient and facility.'
export const NO_COMPLAINT = 'No complaint recorded'
export const RECORD_SAVED = 'Clinical record saved.'
export const RECORD_NOT_SAVED = 'Record could not be saved.'
export const NO_WRITE = 'This access does not permit changes to the patient record.'
export const NO_RECORD_ACCESS = 'Your current facility role does not grant access to encounter records.'
export const ENCOUNTERS_FAILED = 'Consultations could not be loaded.'
export const RECORDS_FAILED = 'Records could not be loaded.'
export const RELOAD_FAILED = 'The change was saved, but the records could not be reloaded.'
export const REASON_SHORT = 'Give a reason of at least 3 characters.'

/** The design's wording. */
export const FIRST_RECORD = 'Nothing recorded yet.'
export const CHANGE_SEARCH = 'Change your search.'
export const NO_CREATE = 'Your role can’t add this record.'
export const COMPLETE_FIELD = 'Complete this field.'

/** Said when a visit holds more than one page of records: the list shows each visit's newest page. */
export const NEWEST_ONLY = 'Only the newest 50 records of each visit are listed here.'

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

export function isoNow() { return new Date().toISOString() }

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function field(record: ClinicalRecord, key: string): string {
  const value = record[key]
  return value == null ? '' : String(value)
}

/** The refused DTO fields of a 400 VALIDATION_FAILED, as this form's own field errors (`map`: DTO name to form key). */
export function refusedFieldErrors(caught: unknown, map: (dtoField: string) => string | undefined): FieldErrors {
  const errors: Record<string, string> = {}
  for (const refused of refusedFields(caught)) {
    const key = map(refused.field)
    if (key) errors[key] = refusalSentences(refused).join(' ')
  }
  return errors
}

/** The latest value, read from callbacks and effects without making them re-run (the chart's verify changes often). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return ref
}

/**
 * A record's address in its workspace. EHR reads records only by their encounter, so the address names both, as one
 * path segment: record ids, never anything that identifies the patient.
 */
export function recordKey(encounterId: string, recordId: string) {
  return `${encounterId}~${recordId}`
}

export function parseRecordKey(key: string): { encounterId: string; recordId: string } | null {
  const at = key.indexOf('~')
  if (at < 1 || at === key.length - 1) return null
  return { encounterId: key.slice(0, at), recordId: key.slice(at + 1) }
}

/** A visit as the design's record picker names one: "{name} · {status} · {when}". */
export function visitLabel(encounter: Encounter): string {
  return [shortId(encounter.id), statusLabel(encounter.status), formatWhen(encounter.startedAt)].filter(Boolean).join(' · ')
}

/** When a record was made: the time it was recorded at, else when it was saved. */
export function recordedAt(record: ClinicalRecord): string {
  return field(record, 'recordedAt') || record.createdAt
}

/** A record of the open patient, with the visit it belongs to. */
export interface VisitRecord {
  readonly encounter: Encounter
  readonly record: ClinicalRecord
}

type Notice = { readonly text: string; readonly alert: boolean }

export interface PatientRecords {
  /** The encounters on the page shown, null until first read. */
  readonly encounters: readonly Encounter[] | null
  /** Their records, newest first; null until first read. */
  readonly records: readonly VisitRecord[] | null
  readonly loading: boolean
  /** The encounters could not be read. */
  readonly error: string
  /** Some visit's records could not be read; the others are shown. */
  readonly recordError: string
  /** Some visit holds more than one page of records. */
  readonly truncated: boolean
  readonly notice: Notice | null
  readonly cursors: Cursors
  readonly next: string | null
  readonly load: (request?: { cursors?: Cursors; fresh?: boolean; paging?: boolean }) => Promise<void>
}

/**
 * The open patient's records of one `kind`, across the encounters on the encounter page shown. As today: the access
 * re-check, then the encounters (newest first, 50 to a page), then each encounter's first page of records (today's
 * record read, with no re-check). With `kind` null, only the encounters are read.
 */
export function usePatientRecords(chart: Chart, kind: RecordKind | null, keep: (record: ClinicalRecord) => boolean = () => true): PatientRecords {
  const { facilityId, patientId } = chart
  const verify = useLatest(chart.verify)
  const keeps = useLatest(keep)
  const [encounters, setEncounters] = useState<readonly Encounter[] | null>(null)
  const [records, setRecords] = useState<readonly VisitRecord[] | null>(null)
  const [position, setPosition] = useState<{ cursors: Cursors; next: string | null }>({ cursors: FIRST_PAGE, next: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recordError, setRecordError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const sequence = useRef(0)
  const shown = useLatest(position.cursors)

  const load = useCallback(async (request: { cursors?: Cursors; fresh?: boolean; paging?: boolean } = {}) => {
    const run = ++sequence.current
    setLoading(true)
    if (request.paging) setNotice(null)
    try {
      await verify.current()
      const result = await readPage((cursor, fresh) => staffApi.encounters(facilityId, patientId, { cursor, fresh }), request.cursors ?? shown.current, request.fresh ?? false)
      if (run !== sequence.current) return
      const visits = result.page.items.filter(item => item.patientId === patientId && item.facilityId === facilityId)
      let failure = ''
      let more = false
      // With no kind, only the encounters are wanted (a create page's "Visit").
      const lists = kind === null ? [] : await Promise.all(visits.map(encounter => {
        const read = request.fresh
          ? staffApi.records(facilityId, patientId, encounter.id, kind, { fresh: true })
          : staffApi.records(facilityId, patientId, encounter.id, kind)
        return read.then(
          page => {
            if (page.nextCursor) more = true
            return page.items
              .filter(record => record.patientId === patientId && record.encounterId === encounter.id && keeps.current(record))
              .map(record => ({ encounter, record }))
          },
          (caught: unknown) => {
            failure ||= caught instanceof Error ? caught.message : RECORDS_FAILED
            return []
          },
        )
      }))
      if (run !== sequence.current) return
      setEncounters(visits)
      setRecords(lists.flat().sort((a, b) => recordedAt(b.record).localeCompare(recordedAt(a.record))))
      setPosition({ cursors: result.cursors, next: result.page.nextCursor ?? null })
      setNotice(result.restarted ? { text: RESTARTED, alert: false } : null)
      setRecordError(failure)
      setTruncated(more)
      setError('')
    } catch (caught) {
      if (run !== sequence.current) return
      if (request.paging) setNotice({ text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true })
      else setError(refusalText(caught, ENCOUNTERS_FAILED))
    } finally {
      if (run === sequence.current) setLoading(false)
    }
  }, [facilityId, keeps, kind, patientId, shown, verify])

  useEffect(() => {
    void load({ cursors: FIRST_PAGE })
    return () => { sequence.current += 1 }
  }, [load])

  return { encounters, records, loading, error, recordError, truncated, notice, cursors: position.cursors, next: position.next, load }
}

/** One visit's records, every page (bounded), as today's record read: no re-check; fresh after a change. */
export async function readVisitRecords(chart: Pick<Chart, 'facilityId' | 'patientId'>, encounterId: string, kind: RecordKind, fresh: boolean): Promise<ClinicalRecord[]> {
  const { facilityId, patientId } = chart
  const items: ClinicalRecord[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const read = cursor
      ? await staffApi.records(facilityId, patientId, encounterId, kind, { cursor, fresh })
      : fresh ? await staffApi.records(facilityId, patientId, encounterId, kind, { fresh: true }) : await staffApi.records(facilityId, patientId, encounterId, kind)
    items.push(...read.items.filter(record => record.patientId === patientId && record.encounterId === encounterId))
    if (!read.nextCursor) break
    cursor = read.nextCursor
  }
  return items
}

export type Loaded<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'missing' }
  | { readonly phase: 'failed'; readonly message: string }
  | ({ readonly phase: 'ready' } & T)

export interface VisitRecordState {
  readonly encounter: Encounter
  readonly record: ClinicalRecord
}

/**
 * One record of the open patient, by its address: the access re-check, the encounter (it must be the patient's, at
 * this facility), then its records. `reload` reads the records again after a change (fresh, no re-check, as today).
 */
export function useVisitRecord(chart: Chart, key: string, kind: RecordKind, keep: (record: ClinicalRecord) => boolean = () => true) {
  const { facilityId, patientId } = chart
  const verify = useLatest(chart.verify)
  const keeps = useLatest(keep)
  const address = parseRecordKey(key)
  const encounterId = address?.encounterId ?? ''
  const recordId = address?.recordId ?? ''
  const [loaded, setLoaded] = useState<Loaded<VisitRecordState>>({ phase: 'loading' })

  useEffect(() => {
    if (!encounterId || !recordId) {
      setLoaded({ phase: 'missing' })
      return
    }
    let current = true
    setLoaded({ phase: 'loading' })
    void (async () => {
      try {
        await verify.current()
        const encounter = await staffApi.encounter(facilityId, patientId, encounterId)
        if (!current) return
        if (encounter.patientId !== patientId || encounter.facilityId !== facilityId) return setLoaded({ phase: 'missing' })
        const items = (await readVisitRecords({ facilityId, patientId }, encounterId, kind, false)).filter(item => keeps.current(item))
        if (!current) return
        const record = items.find(item => item.id === recordId)
        if (!record) return setLoaded({ phase: 'missing' })
        setLoaded({ phase: 'ready', encounter, record })
      } catch (caught) {
        if (!current) return
        if (isHidApiError(caught) && caught.status === 404) return setLoaded({ phase: 'missing' })
        setLoaded({ phase: 'failed', message: refusalText(caught, RECORDS_FAILED) })
      }
    })()
    return () => { current = false }
  }, [encounterId, facilityId, keeps, kind, patientId, recordId, verify])

  /** Reads the visit's records again: the rows read, or why they could not be. */
  const reload = useCallback(async (): Promise<{ readonly items: readonly ClinicalRecord[] } | { readonly failed: string }> => {
    let items: ClinicalRecord[]
    try {
      items = (await readVisitRecords({ facilityId, patientId }, encounterId, kind, true)).filter(item => keeps.current(item))
    } catch (caught) {
      return { failed: refusalText(caught, '') }
    }
    setLoaded(state => {
      if (state.phase !== 'ready') return state
      const record = items.find(item => item.id === recordId)
      return record ? { ...state, record } : state
    })
    return { items }
  }, [encounterId, facilityId, keeps, kind, patientId, recordId])

  return { loaded, reload }
}

/**
 * Focus for after a change that removed the control holding it (the action's form): `request()` asks, and the
 * element with `id` takes focus in a layout effect, only when focus was lost.
 */
export function useFocusAfterChange(id: string) {
  const [requested, setRequested] = useState(0)
  useLayoutEffect(() => {
    if (!requested) return
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) document.getElementById(id)?.focus()
  }, [id, requested])
  return useCallback(() => setRequested(count => count + 1), [])
}
