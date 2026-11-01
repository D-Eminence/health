import { useCallback, useEffect, useRef, useState } from 'react'
import { staffApi, type ClinicalRecord, type DocumentRecord, type NoteRevision, type Page, type RecordKind } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { FIRST_PAGE, RESTARTED, readPage, useLatest, type Cursors } from './encounters'
import { plainErrorText } from '@hid/http'

/** Today's notice beside a list: the restart after a cursor EHR no longer accepts (status), or a failed page move (alert). */
export type ListNotice = { readonly text: string; readonly alert: boolean }

/** EHR lists each record kind 50 to a page; the documents list is paged here the same way. */
export const PAGE_SIZE = 50

/**
 * One encounter's records of a kind, as today's chart reads them: newest first, 50 to a page, with the cursors that
 * led to the page shown (today's "Record pages"). The first read is today's (no page argument, no access re-check);
 * moving between pages reads `{ cursor, fresh: false }` and keeps the page shown if it fails, saying so in `notice`;
 * a cursor EHR no longer accepts starts the list again with today's restart notice.
 */
export interface RecordList<T> {
  /** The page shown. */
  readonly items: readonly T[] | null
  /** The first page, as last read: what a summary of the encounter shows, whichever page the list is on. */
  readonly first: readonly T[] | null
  /** There is a next page. */
  readonly more: boolean
  /** EHR holds more than this list can read (the documents list, whose read takes no cursor). */
  readonly truncated: boolean
  readonly loading: boolean
  readonly error: string
  /** The cursors that led to the page shown, the first page's being none (FIRST_PAGE). */
  readonly cursors: Cursors
  /** The next page's cursor, or null on the last page. */
  readonly next: string | null
  readonly notice: ListNotice | null
  /** Shows the page these cursors lead to (today's Pager). */
  readonly show: (cursors: Cursors) => void
  /**
   * Reads the page shown afresh after a change (`first`: the first page, after a create), and answers why it failed,
   * or null. A failure leaves the list as it was: the caller says the change was saved.
   */
  readonly reload: (first?: boolean) => Promise<string | null>
  /** Reads the page shown afresh; a failure is the list's error (a refreshed note's content is hidden then). */
  readonly refresh: () => Promise<string | null>
}

type Read<T> = Page<T> & { readonly truncated?: boolean }

interface Reader<T> {
  /** Today's first read. */
  readonly first: () => Promise<Read<T>>
  /** A page read: its cursor (none for the first page), fresh after a change. */
  readonly page: (cursor: string | undefined, fresh: boolean) => Promise<Read<T>>
}

type Mode = 'initial' | 'page' | 'change' | 'refresh'

interface Shown<T> {
  readonly scope: string
  readonly items: readonly T[] | null
  readonly first: readonly T[] | null
  readonly cursors: Cursors
  readonly next: string | null
  readonly truncated: boolean
  readonly error: string
  readonly notice: ListNotice | null
}

function blank<T>(scope: string): Shown<T> {
  return { scope, items: null, first: null, cursors: FIRST_PAGE, next: null, truncated: false, error: '', notice: null }
}

/** Today's failed page move, beside the list. */
export function pageFailed(caught: unknown): string {
  return `The page could not be loaded. ${plainErrorText(caught, 'Try again.', { audience: 'facility' })}`
}

function usePagedList<T>(scope: string, enabled: boolean, reader: Reader<T>, fallback: string): RecordList<T> {
  const [state, setState] = useState<Shown<T>>(() => blank(scope))
  const [loading, setLoading] = useState(enabled)
  const sequence = useRef(0)
  // The cursors last asked for: a read after a change reads them again, a failed move goes back to those before.
  const requested = useRef<{ scope: string; cursors: Cursors }>({ scope, cursors: FIRST_PAGE })
  const reading = useLatest(reader)

  const load = useCallback(async (mode: Mode, wanted: Cursors): Promise<string | null> => {
    if (!enabled) return null
    const run = ++sequence.current
    const before = requested.current.scope === scope ? requested.current.cursors : FIRST_PAGE
    requested.current = { scope, cursors: wanted }
    setLoading(true)
    if (mode === 'page') setState(current => current.scope === scope ? { ...current, error: '', notice: null } : current)
    try {
      const result = mode === 'initial'
        ? { page: await reading.current.first(), cursors: FIRST_PAGE, restarted: false }
        : await readPage(reading.current.page, wanted, mode !== 'page')
      if (run !== sequence.current) return null
      requested.current = { scope, cursors: result.cursors }
      const items = result.page.items
      setState(current => ({
        scope,
        items,
        first: result.cursors.length < 2 ? items : current.scope === scope ? current.first : null,
        cursors: result.cursors,
        next: result.page.nextCursor ?? null,
        truncated: result.page.truncated === true,
        error: '',
        notice: result.restarted ? { text: RESTARTED, alert: false } : null,
      }))
      return null
    } catch (caught) {
      if (run !== sequence.current) return null
      requested.current = { scope, cursors: before }
      if (mode === 'initial' || mode === 'refresh') {
        const error = mode === 'initial' ? (plainErrorText(caught, fallback, { audience: 'facility' })) : refusalText(caught, fallback)
        setState(current => ({ ...(current.scope === scope ? current : blank<T>(scope)), error }))
      } else if (mode === 'page') {
        setState(current => current.scope === scope ? { ...current, notice: { text: pageFailed(caught), alert: true } } : current)
      }
      return refusalText(caught, '')
    } finally {
      if (run === sequence.current) setLoading(false)
    }
  }, [enabled, fallback, reading, scope])

  useEffect(() => {
    void load('initial', FIRST_PAGE)
    return () => { sequence.current += 1 }
  }, [load])

  const shown = state.scope === scope ? state : blank<T>(scope)
  const asked = () => requested.current.scope === scope ? requested.current.cursors : FIRST_PAGE
  return {
    items: enabled ? shown.items : null,
    first: enabled ? shown.first : null,
    more: shown.next !== null,
    truncated: shown.truncated,
    loading: enabled && loading,
    error: shown.error,
    cursors: shown.cursors,
    next: shown.next,
    notice: shown.notice,
    show: cursors => { void load('page', cursors) },
    reload: (first = false) => load('change', first ? FIRST_PAGE : asked()),
    refresh: () => load('refresh', asked()),
  }
}

/** The shared Pager's props while a list has more than one page (today shows it only then), else null. */
export function pagerProps(list: RecordList<unknown>) {
  const { cursors, next } = list
  if (cursors.length < 2 && !next) return null
  return {
    page: cursors.length,
    busy: list.loading,
    onPrevious: cursors.length >= 2 ? () => list.show(cursors.slice(0, -1)) : undefined,
    onNext: next ? () => list.show([...cursors, next]) : undefined,
  }
}

/**
 * The encounter's records of one kind (`records(facility, patient, encounter, kind)` first, then today's pages).
 * `learn` is given every answer, as today's page learns from an orders answer what the order pages need.
 */
export function useRecordList(chart: Chart, encounterId: string, kind: RecordKind, enabled: boolean, learn?: (answer: Page<ClinicalRecord>) => void): RecordList<ClinicalRecord> {
  const { facilityId, patientId } = chart
  const told = <P extends Page<ClinicalRecord>>(answer: P) => { learn?.(answer); return answer }
  const reader: Reader<ClinicalRecord> = {
    first: async () => told(await staffApi.records(facilityId, patientId, encounterId, kind)),
    page: async (cursor, fresh) => told(await staffApi.records(facilityId, patientId, encounterId, kind, { cursor, fresh })),
  }
  return usePagedList(JSON.stringify([facilityId, patientId, encounterId, kind]), enabled, reader, 'Records could not be loaded.')
}

/**
 * The encounter's documents. Today's read (`documents(facility, patient, encounter)`, `.items`) takes no cursor, so
 * what it answers is paged here, 50 to a page, with the same pager; moving between pages reads nothing. When EHR says
 * it holds more than it answered (`nextCursor`), `truncated` says so.
 */
export function useDocumentList(chart: Chart, encounterId: string, enabled: boolean): RecordList<DocumentRecord> {
  const { facilityId, patientId } = chart
  const scope = JSON.stringify([facilityId, patientId, encounterId, 'documents'])
  const held = useRef<{ scope: string; page: Page<DocumentRecord> } | null>(null)
  const readAll = async () => {
    const page = await staffApi.documents(facilityId, patientId, encounterId)
    held.current = { scope, page }
    return page
  }
  const slice = (page: Page<DocumentRecord>, cursor: string | undefined): Read<DocumentRecord> => {
    const offset = Number(cursor ?? 0)
    const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0
    const end = start + PAGE_SIZE
    return { items: page.items.slice(start, end), nextCursor: end < page.items.length ? String(end) : null, truncated: page.nextCursor != null }
  }
  const reader: Reader<DocumentRecord> = {
    first: async () => slice(await readAll(), undefined),
    page: async (cursor, fresh) => slice(!fresh && held.current?.scope === scope ? held.current.page : await readAll(), cursor),
  }
  return usePagedList(scope, enabled, reader, 'Documents could not be loaded.')
}

/** A note's revisions, oldest first (today's NotePanel read), read again whenever the note's version changes. */
export function useRevisions(chart: Chart, encounterId: string, noteId: string | null, version: unknown): RecordList<NoteRevision> {
  const { facilityId, patientId } = chart
  const read = async (): Promise<Read<NoteRevision>> => {
    const items = await staffApi.noteRevisions(facilityId, patientId, encounterId, noteId ?? '')
    return { items: [...items].sort((a, b) => a.revisionNo - b.revisionNo), nextCursor: null }
  }
  const reader: Reader<NoteRevision> = { first: read, page: read }
  return usePagedList(JSON.stringify([facilityId, patientId, encounterId, noteId, String(version)]), noteId !== null, reader, 'Note content could not be loaded.')
}
