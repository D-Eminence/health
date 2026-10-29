/**
 * React bindings for the offline runtime (`@hid/offline/react`). UI-agnostic:
 * no markup, only state. Works with the real runtime and with the fake from
 * `@hid/offline/testing`.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CachedResult, ConflictClass, OpName, PendingView, Ref, SyncSummary } from './contracts'
import { TransportError, type OfflineCore } from './types'

const OfflineContext = createContext<OfflineCore | null>(null)

/**
 * Provides the runtime and wires the idle lock: keydown, pointerdown,
 * touchstart and wheel count as activity; page visibility is reported.
 */
export function OfflineProvider({ runtime, children }: { runtime: OfflineCore; children?: ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const active = () => runtime.noteActivity()
    const visible = () => runtime.noteVisibility(document.visibilityState === 'hidden')
    const events = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const
    for (const e of events) document.addEventListener(e, active, { passive: true, capture: true })
    document.addEventListener('visibilitychange', visible)
    return () => {
      for (const e of events) document.removeEventListener(e, active, { capture: true })
      document.removeEventListener('visibilitychange', visible)
    }
  }, [runtime])
  return <OfflineContext.Provider value={runtime}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineCore {
  const runtime = useContext(OfflineContext)
  if (!runtime) throw new Error('useOffline must be used inside <OfflineProvider>')
  return runtime
}

/** The live sync summary (connectivity, vault, pending, attention, storage). */
export function useSyncSummary(): SyncSummary {
  const runtime = useOffline()
  return useSyncExternalStore(runtime.subscribe, runtime.summary, runtime.summary)
}

/** Re-render whenever the runtime reports a change; returns a counter to key effects on. */
function useRuntimeVersion(runtime: OfflineCore): number {
  const [version, setVersion] = useState(0)
  useEffect(() => runtime.subscribe(() => setVersion(v => v + 1)), [runtime])
  return version
}

export interface CachedReadState<T> {
  data: T | undefined
  source: CachedResult<T>['source'] | null
  savedAt: string | null
  error: unknown
  loading: boolean
  reload(): void
}

/**
 * Network first, then the saved copy (§2.7). `key` identifies the read for
 * re-running (include the patient and args). When the answer comes from the
 * saved copy, the open is recorded for the offline audit trail under `section`.
 *
 * While the saved copy is on screen the hook follows it: a late network answer
 * replaces it, and when the copy stops being readable (grant expiry, lock,
 * lease, a wipe) the data is cleared.
 */
export function useCachedRead<T>(spec: {
  key: string
  method: string
  args: readonly unknown[]
  patientId: string
  network: () => Promise<T>
  emergency?: boolean
  section?: string
  enabled?: boolean
}): CachedReadState<T> {
  const runtime = useOffline()
  const version = useRuntimeVersion(runtime)
  const [state, setState] = useState<Omit<CachedReadState<T>, 'reload'>>({ data: undefined, source: null, savedAt: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const specRef = useRef(spec)
  specRef.current = spec
  const fromCache = useRef(false)
  const enabled = spec.enabled ?? true

  useEffect(() => {
    if (!enabled) return
    let live = true
    const s = specRef.current
    fromCache.current = false
    // One request per load: the runtime may answer from the saved copy first, and this same request then refreshes it.
    let request: Promise<T>
    try { request = s.network() } catch (error) { request = Promise.reject(error) }
    request.catch(() => undefined)
    setState(prev => ({ ...prev, loading: true, error: null }))
    runtime.reads.read<T>({
      method: s.method, args: s.args, patientId: s.patientId, network: () => request, ...(s.emergency ? { emergency: true } : {}),
    }).then(result => {
      if (!live) return
      setState({ data: result.value, source: result.source, savedAt: result.savedAt, error: null, loading: false })
      if (result.source !== 'cache') return
      fromCache.current = true
      if (s.section) runtime.audit.recordOpen(s.patientId, s.section)
      request.then(value => {
        if (!live) return
        fromCache.current = false
        setState({ data: value, source: 'network', savedAt: null, error: null, loading: false })
      }, () => undefined)
    }, (error: unknown) => {
      if (live) setState(prev => ({ ...prev, error, loading: false }))
    })
    return () => { live = false }
  }, [runtime, spec.key, nonce, enabled])

  // Whenever the runtime changes while the saved copy is shown, check that it is still readable.
  useEffect(() => {
    if (!enabled || !fromCache.current) return
    let live = true
    const s = specRef.current
    runtime.reads.read<T>({
      method: s.method, args: s.args, patientId: s.patientId,
      network: () => Promise.reject(new TransportError({ status: null, networkError: true })),
    }).then(result => {
      if (live && fromCache.current) setState({ data: result.value, source: result.source, savedAt: result.savedAt, error: null, loading: false })
    }, (error: unknown) => {
      if (!live || !fromCache.current) return
      fromCache.current = false
      setState({ data: undefined, source: null, savedAt: null, error, loading: false })
    })
    return () => { live = false }
  }, [runtime, version, spec.key, nonce, enabled])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { ...state, reload }
}

/** Pending commands for a patient (and visit), labelled "Saved on this device, not sent yet" and so on. */
export function usePending(patientId: string, visit?: Ref): PendingView[] {
  const runtime = useOffline()
  const version = useRuntimeVersion(runtime)
  const [items, setItems] = useState<PendingView[]>([])
  const visitKey = visit ? ('local' in visit ? `l:${visit.local}` : `s:${visit.server}`) : ''
  const visitRef = useRef(visit)
  visitRef.current = visit
  useEffect(() => {
    let live = true
    runtime.commands.pendingFor(patientId, visitRef.current).then(next => { if (live) setItems(next) }, () => undefined)
    return () => { live = false }
  }, [runtime, patientId, visitKey, version])
  return items
}

export type ReviewItem = { commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }

/** The author's review queue and its resolve action. */
export function useReview(): { items: ReviewItem[]; resolve: OfflineCore['review']['resolve'] } {
  const runtime = useOffline()
  const version = useRuntimeVersion(runtime)
  const [items, setItems] = useState<ReviewItem[]>([])
  useEffect(() => {
    let live = true
    runtime.review.list().then(next => { if (live) setItems(next) }, () => undefined)
    return () => { live = false }
  }, [runtime, version])
  return { items, resolve: runtime.review.resolve }
}
