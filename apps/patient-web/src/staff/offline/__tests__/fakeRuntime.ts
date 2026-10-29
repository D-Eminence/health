import { vi } from 'vitest'
import type {
  CachedResult, CommandOutcome, ConflictClass, GrantState, Json, OfflinePolicy, OfflineRuntime, OpName, PatientIndexEntry, PendingView,
  StaffSessionSnapshot, SyncSummary, UnlockResult,
} from '@hid/offline'

/**
 * A tiny in-memory OfflineRuntime for the EHR screens' tests, until Stream A's `packages/offline/src/testing.ts`
 * lands on offline/base. It implements the frozen interface and nothing more; each test sets what it needs.
 */
export interface FakeOptions {
  policy?: Partial<OfflinePolicy>
  summary?: Partial<SyncSummary>
  /** Reads answer from this map, by method, when `offline` is true. */
  cache?: Record<string, { value: unknown; savedAt: string }>
  offline?: boolean
  saveOutcome?: (op: OpName, input: Json) => Promise<CommandOutcome<unknown>>
  pending?: PendingView[]
  review?: { commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }[]
  patients?: PatientIndexEntry[]
  restored?: StaffSessionSnapshot | null
  unlock?: UnlockResult
  hasVaults?: boolean
}

export const BASE_SUMMARY: SyncSummary = {
  connectivity: 'online', vault: 'unlocked', leaseUntil: '2026-10-29T20:00:00.000Z', clock: 'anchored', pending: 0, sending: 0,
  attention: 0, lastSyncAt: null, escrow: false, storage: { usageBytes: null, quotaBytes: null, persisted: true, low: false },
}

export function fakeRuntime(options: FakeOptions = {}) {
  const listeners = new Set<() => void>()
  let summary: SyncSummary = { ...BASE_SUMMARY, ...options.summary }
  let policy: OfflinePolicy = { mode: 'pilot', enabled: true, ...options.policy }
  const pending: PendingView[] = [...(options.pending ?? [])]
  const grants: GrantState[] = []
  const notify = () => { for (const listener of [...listeners]) listener() }
  const ok: UnlockResult = { ok: true, summary }
  const runtime = {
    policy: vi.fn(() => policy),
    prepareFromSignIn: vi.fn(),
    attachSession: vi.fn(async (_session: StaffSessionSnapshot, _o: { optIn: boolean; online: true }) => summary),
    unlockOffline: vi.fn(async () => options.unlock ?? ok),
    unlockLocked: vi.fn(async () => options.unlock ?? ok),
    restoreSession: vi.fn(() => options.restored ?? null),
    lock: vi.fn(),
    signOut: vi.fn(async () => undefined),
    wipe: vi.fn(async () => undefined),
    hasVaults: vi.fn(async () => options.hasVaults ?? true),
    trustedNow: vi.fn(() => ({ at: new Date('2026-10-29T10:42:00.000Z'), clock: 'anchored' as const })),
    summary: vi.fn(() => summary),
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    reads: {
      read: vi.fn(async <T,>(spec: { method: string; network: () => Promise<T> }): Promise<CachedResult<T>> => {
        const saved = options.cache?.[spec.method]
        if (options.offline && saved) return { value: saved.value as T, source: 'cache', savedAt: saved.savedAt }
        return { value: await spec.network(), source: 'network', savedAt: null }
      }),
      setGrant: vi.fn(async (grant: GrantState) => { grants.push(grant) }),
      dropPatient: vi.fn(async () => undefined),
      keepOffline: vi.fn(async (_patientId: string, fetchers: readonly (() => Promise<unknown>)[]) => { for (const fetch of fetchers) await fetch() }),
    },
    commands: {
      register: vi.fn(),
      save: vi.fn(async (op: OpName, input: Json) => {
        if (options.saveOutcome) return options.saveOutcome(op, input)
        const commandId = `cmd-${pending.length + 1}`
        pending.push({ commandId, op, state: 'queued', capturedAt: '2026-10-29T10:42:00.000Z', label: op, input })
        summary = { ...summary, pending: summary.pending + 1 }
        notify()
        return { kind: 'saved', commandId } as CommandOutcome<unknown>
      }),
      edit: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      pendingFor: vi.fn(async (patientId: string) => pending.filter(item => (item.input as { patientId?: string } | null)?.patientId === patientId)),
      syncNow: vi.fn(),
    },
    audit: { recordOpen: vi.fn() },
    review: { list: vi.fn(async () => options.review ?? []), resolve: vi.fn(async () => undefined) },
    patients: {
      list: vi.fn(async () => options.patients ?? []),
      search: vi.fn(async (q: string) => (options.patients ?? []).filter(item =>
        `${item.displayName} ${item.hidCode}`.toLowerCase().includes(q.trim().toLowerCase()))),
    },
  }
  return Object.assign(runtime as unknown as OfflineRuntime & typeof runtime, {
    grants,
    pendingList: pending,
    setSummary(next: Partial<SyncSummary>) { summary = { ...summary, ...next }; notify() },
    setPolicy(next: Partial<OfflinePolicy>) { policy = { ...policy, ...next }; notify() },
  })
}

export type FakeRuntime = ReturnType<typeof fakeRuntime>
