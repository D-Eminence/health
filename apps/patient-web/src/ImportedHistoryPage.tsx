import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button } from './kasuwa/ui'
import { LoadingRows } from './kasuwa/parts'
import { isHidApiError } from '@hid/http'
import { ImportedHistory } from './ImportedHistory'
import type { ImportedHistoryPage, ImportedHistorySharing, ImportedHistorySharingChange, ImportedMedicalRecord } from './importedRecords'

/**
 * Imported legacy medical history as hid-system main serves it (#94, ADR-067): a page of records at a time, read
 * by the patient (`GET /ehr/me/imported-history`) or by staff for direct care
 * (`GET /ehr/patients/:patientId/imported-history`). Both are off by default in hid-system, so "not available"
 * is a normal answer and the section simply is not shown.
 */
export type ImportedHistoryAudience = 'patient' | 'staff'
export type ImportedHistoryLoad = (cursor: string | null, signal: AbortSignal) => Promise<ImportedHistoryPage>

/** Off or not served: nothing is shown, and no error either. */
export function importedHistoryUnavailable(reason: unknown): boolean {
  return isHidApiError(reason) && (reason.status === 404 || (reason.status === 503 && reason.code === 'IMPORTED_HISTORY_DISABLED'))
}

/** What a refused or failed read says, from hid-system's codes (INTERFACE_CONTRACT.md, "Imported legacy medical history"). */
export function importedHistoryFailure(reason: unknown, audience: ImportedHistoryAudience): string {
  if (isHidApiError(reason)) {
    if (reason.status === 401) return 'Your session ended. Please sign in again.'
    switch (reason.code) {
      case 'CONSENT_REQUIRED': return 'The patient has not given consent for this facility to read their record.'
      case 'DIRECT_CARE_PURPOSE_REQUIRED': return 'Imported medical history is read for direct care only.'
      case 'BREAK_GLASS_EXCLUDED': return 'Imported medical history is not shown under emergency access.'
      case 'IMPORTED_HISTORY_UNAVAILABLE': return 'Older records can’t be loaded right now. Try again.'
      case 'INVALID_CURSOR': return 'Couldn’t load more older records. Reload the page.'
      default:
    }
    if (reason.status === 403) return audience === 'staff' ? 'You do not have access to this patient’s imported medical history.' : 'You can’t see these older records.'
  }
  return 'Couldn’t load older records. Try again.'
}

export type ImportedHistoryState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; records: ImportedMedicalRecord[]; limit: number; shared: boolean | null; nextCursor: string | null }

/**
 * Loads the first page, and the next on request. A page is added to what is shown without repeating a record, and a
 * load that is replaced or unmounted is cancelled, so a late answer never reaches another patient's screen.
 */
export function useImportedHistory(load: ImportedHistoryLoad, audience: ImportedHistoryAudience) {
  const [state, setState] = useState<ImportedHistoryState>({ status: 'loading' })
  const [more, setMore] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' })
  const [attempt, setAttempt] = useState(0)
  const moreFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    moreFlight.current?.abort()
    setState({ status: 'loading' }); setMore({ busy: false, error: '' })
    load(null, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setState({ status: 'ready', records: page.records, limit: page.limits.records, shared: page.shared ?? null, nextCursor: page.moreRecords ? page.nextCursor : null })
    }).catch(reason => {
      if (controller.signal.aborted) return
      setState(importedHistoryUnavailable(reason) ? { status: 'unavailable' } : { status: 'error', message: importedHistoryFailure(reason, audience) })
    })
    return () => { controller.abort(); moreFlight.current?.abort() }
  }, [load, audience, attempt])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.nextCursor || moreFlight.current) return
    const controller = new AbortController()
    moreFlight.current = controller
    setMore({ busy: true, error: '' })
    load(state.nextCursor, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setState(current => {
        if (current.status !== 'ready') return current
        const seen = new Set(current.records.map(record => record.id))
        return { ...current, records: [...current.records, ...page.records.filter(record => !seen.has(record.id))],
          nextCursor: page.moreRecords ? page.nextCursor : null }
      })
      setMore({ busy: false, error: '' })
    }).catch(reason => {
      if (!controller.signal.aborted) setMore({ busy: false, error: importedHistoryFailure(reason, audience) })
    }).finally(() => { if (moreFlight.current === controller) moreFlight.current = null })
  }, [state, load, audience])

  return { state, more, loadMore, retry: () => setAttempt(value => value + 1) }
}

/** The history and its paging, for either audience. Shows nothing while the feature is not available. */
export function ImportedHistoryView({ load, audience }: { load: ImportedHistoryLoad; audience: ImportedHistoryAudience }) {
  const history = useImportedHistory(load, audience)
  return <ImportedHistoryBody {...history} audience={audience} />
}

type HistoryHook = ReturnType<typeof useImportedHistory>
function ImportedHistoryBody({ state, more, loadMore, retry, audience, query, groupedByDay }: HistoryHook & {
  audience: ImportedHistoryAudience; query?: string; groupedByDay?: boolean
}) {
  if (state.status === 'unavailable') return null
  if (state.status === 'loading') return <LoadingRows rows={2} label="Loading older records" />
  if (state.status === 'error') return <section className="imported-history" aria-label="Older health records"><h2>Older health records</h2>
    <Alert intent="error" size="sm" title="Couldn’t load older records" action={<Button size="sm" onClick={retry}>Try again</Button>}>{state.message}</Alert></section>
  if (audience === 'staff' && state.shared === false) {
    return <section className="imported-history" aria-label="Older health records"><h2>Older health records</h2>
      <p role="status">This patient has not shared their imported medical history, or has none.</p></section>
  }
  return <>
    <ImportedHistory records={state.records} limit={state.limit} paged query={query} groupedByDay={groupedByDay} />
    {state.nextCursor && <div className="imported-history">
      {more.error && <Alert intent="error" size="sm">{more.error}</Alert>}
      <Button size="sm" loading={more.busy} disabled={more.busy} onClick={loadMore}>{more.busy ? 'Loading more…' : 'Show more'}</Button>
    </div>}
  </>
}

/** Why a change of the sharing choice was refused, from Identity's codes. */
function sharingFailure(reason: unknown): string {
  if (isHidApiError(reason)) {
    if (reason.code === 'PATIENT_RECENT_AUTH_REQUIRED') return 'For your safety, sign in again first, then try again.'
    if (reason.code === 'PATIENT_RECENT_RECOVERY_HOLD') return 'You can’t turn on sharing for 24 hours after you recover your account. Try again later.'
    if (reason.code === 'IMPORTED_HISTORY_SHARING_DISABLED') return 'Sharing older records isn’t available right now.'
    if (reason.status === 401) return 'Your session ended. Please sign in again.'
  }
  return 'Couldn’t save your choice. Try again.'
}

export interface SharingApi {
  importedHistorySharing(signal?: AbortSignal): Promise<ImportedHistorySharing>
  setImportedHistorySharing(shared: boolean, signal?: AbortSignal): Promise<ImportedHistorySharingChange>
}

/**
 * The patient's choice to share imported history with the staff who treat them. Off until they choose; turning it
 * on needs a recent sign-in; turning it off is always allowed and takes effect at the staff's next request.
 */
export function ImportedHistorySharingCard({ api }: { api: SharingApi }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'unavailable' } | { status: 'error' } | { status: 'ready'; shared: boolean }>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    api.importedHistorySharing(controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ status: 'ready', shared: value.shared })
    }).catch(reason => {
      if (controller.signal.aborted) return
      const off = isHidApiError(reason) && (reason.status === 404 || (reason.status === 503 && reason.code === 'IMPORTED_HISTORY_SHARING_DISABLED'))
      setState(off ? { status: 'unavailable' } : { status: 'error' })
    })
    return () => controller.abort()
  }, [api, attempt])
  if (state.status === 'unavailable' || state.status === 'loading') return null
  if (state.status === 'error') return <div className="imported-history"><Alert intent="error" size="sm" title="Couldn’t load your sharing choice"
    action={<Button size="sm" onClick={() => setAttempt(value => value + 1)}>Try again</Button>} /></div>
  const change = async (shared: boolean) => {
    setBusy(true); setNotice(''); setError('')
    try {
      const result = await api.setImportedHistorySharing(shared)
      setState({ status: 'ready', shared: result.shared })
      setNotice(result.shared ? 'Health workers who treat you can now see your older records.' : 'Sharing stopped. Health workers can’t load your older records any more.')
    } catch (reason) { setError(sharingFailure(reason)) } finally { setBusy(false) }
  }
  return <section className="imported-history" aria-label="Sharing your older records">
    <h2>Sharing your older records</h2>
    <p>{state.shared
      ? 'Health workers who treat you, at places you gave access to, can see these records.'
      : 'Only you can see these records. You can share them with health workers who treat you, and stop at any time.'}</p>
    <Button className="self-start" variant={state.shared ? 'secondary' : 'soft'} loading={busy} disabled={busy} onClick={() => void change(!state.shared)}>
      {busy ? 'Saving…' : state.shared ? 'Stop sharing' : 'Share with health workers who treat me'}</Button>
    <div role="status" className="empty:hidden">{notice && <Alert intent="success" size="sm" live={false}>{notice}</Alert>}</div>
    {error && <Alert intent="error" size="sm">{error}</Alert>}
  </section>
}

const NONE: readonly ImportedMedicalRecord[] = []

/**
 * The patient's imported history, then the choice to share it. hid-system refuses the sharing switch without the
 * patient's own read, so the choice is asked for only where the history is available.
 */
export function PatientImportedHistory({ api, query = '', onRecords }: {
  api: SharingApi & { importedHistory(cursor?: string | null, signal?: AbortSignal): Promise<ImportedHistoryPage> }
  /** The records page's search, over the pages read so far. */
  query?: string
  /** The records read so far, none while there are none to show: the records page counts those its search matches. */
  onRecords?: (records: readonly ImportedMedicalRecord[]) => void
}) {
  const load = useCallback<ImportedHistoryLoad>((cursor, signal) => api.importedHistory(cursor, signal), [api])
  const history = useImportedHistory(load, 'patient')
  const read = history.state.status === 'ready' ? history.state.records : NONE
  // In the commit that shows them, so the count beside the search never trails the records on screen.
  useLayoutEffect(() => { onRecords?.(read) }, [read, onRecords])
  return <>
    <ImportedHistoryBody {...history} audience="patient" query={query} groupedByDay />
    {history.state.status !== 'unavailable' && history.state.status !== 'loading' && <ImportedHistorySharingCard api={api} />}
  </>
}
