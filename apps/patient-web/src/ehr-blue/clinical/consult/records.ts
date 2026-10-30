import { useCallback, useEffect, useRef, useState } from 'react'
import { staffApi, type ClinicalRecord, type DocumentRecord, type NoteRevision, type RecordKind } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'

/**
 * One encounter's records of a kind, as today's chart reads them: the first page (newest first, 50 at most), with no
 * access re-check (today's page re-checks before changes and encounter list reads only). `reload` reads afresh after
 * a change and answers why it failed, or null.
 */
export interface RecordList<T> {
  readonly items: readonly T[] | null
  readonly more: boolean
  readonly loading: boolean
  readonly error: string
  readonly reload: () => Promise<string | null>
}

type Read<T> = (fresh: boolean) => Promise<{ items: T[]; nextCursor?: string | null }>

function useList<T>(scope: string, enabled: boolean, read: Read<T>, fallback: string): RecordList<T> {
  const [state, setState] = useState<{ scope: string; items: readonly T[] | null; more: boolean; error: string }>({ scope, items: null, more: false, error: '' })
  const [loading, setLoading] = useState(enabled)
  const sequence = useRef(0)
  const reader = useRef(read)
  useEffect(() => { reader.current = read })

  const load = useCallback(async (fresh: boolean): Promise<string | null> => {
    if (!enabled) return null
    const run = ++sequence.current
    setLoading(true)
    try {
      const page = await reader.current(fresh)
      if (run === sequence.current) setState({ scope, items: page.items, more: page.nextCursor != null, error: '' })
      return null
    } catch (caught) {
      if (run === sequence.current) {
        setState(current => ({ scope, items: current.scope === scope ? current.items : null, more: false, error: caught instanceof Error ? caught.message : fallback }))
      }
      return refusalText(caught, '')
    } finally {
      if (run === sequence.current) setLoading(false)
    }
  }, [enabled, fallback, scope])

  useEffect(() => {
    void load(false)
    return () => { sequence.current += 1 }
  }, [load])

  const shown = state.scope === scope ? state : { items: null, more: false, error: '' }
  return { items: enabled ? shown.items : null, more: shown.more, loading: enabled && loading, error: shown.error, reload: () => load(true) }
}

/** The encounter's records of one kind (`records(facility, patient, encounter, kind)`, as today's first read). */
export function useRecordList(chart: Chart, encounterId: string, kind: RecordKind, enabled: boolean): RecordList<ClinicalRecord> {
  const { facilityId, patientId } = chart
  const read = useCallback<Read<ClinicalRecord>>(
    fresh => fresh
      ? staffApi.records(facilityId, patientId, encounterId, kind, { fresh: true })
      : staffApi.records(facilityId, patientId, encounterId, kind),
    [encounterId, facilityId, kind, patientId],
  )
  return useList(JSON.stringify([facilityId, patientId, encounterId, kind]), enabled, read, 'Records could not be loaded.')
}

/** The encounter's documents (today's Documents tab: no paging, `.items` only). */
export function useDocumentList(chart: Chart, encounterId: string, enabled: boolean): RecordList<DocumentRecord> {
  const { facilityId, patientId } = chart
  const read = useCallback<Read<DocumentRecord>>(
    () => staffApi.documents(facilityId, patientId, encounterId).then(page => ({ items: page.items, nextCursor: null })),
    [encounterId, facilityId, patientId],
  )
  return useList(JSON.stringify([facilityId, patientId, encounterId, 'documents']), enabled, read, 'Documents could not be loaded.')
}

/** A note's revisions, oldest first (today's NotePanel read), read again whenever the note's version changes. */
export function useRevisions(chart: Chart, encounterId: string, noteId: string | null, version: unknown): RecordList<NoteRevision> {
  const { facilityId, patientId } = chart
  const read = useCallback<Read<NoteRevision>>(
    () => staffApi.noteRevisions(facilityId, patientId, encounterId, noteId ?? '').then(items => ({
      items: [...items].sort((a, b) => a.revisionNo - b.revisionNo), nextCursor: null,
    })),
    [encounterId, facilityId, noteId, patientId],
  )
  return useList(JSON.stringify([facilityId, patientId, encounterId, noteId, String(version)]), noteId !== null, read, 'Note content could not be loaded.')
}
