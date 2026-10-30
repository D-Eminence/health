import { useSyncExternalStore } from 'react'
import * as offlinePackage from '@hid/offline'
import { createOfflineRuntime, transportFromApiClient, type MediaUploader, type OfflineCore, type OfflineEnv, type OfflineReport, type OfflineRuntime,
  type StaffSessionSnapshot, type SyncSummary } from '@hid/offline'
import { uploadPresignedObject } from '@hid/http'
import { staffTransport, type StaffSession } from '../api'
import { getEnvironment } from '../env'
import { offlineAppHost, offlineConfig, offlineEnv, offlineHostAllowed } from './environment'
import { STAFF_OFFLINE_REGISTRY } from './registry'
import { provideOfflineRuntime } from './holder'
export { receiptOf } from './holder'
import { staffSafetyProbe } from './safetyProbe'

/**
 * The storage PUT of an offline upload (§2.8 `ehr.document.upload`), as the online upload makes it. The engine sends
 * only while the staff session is ready (setSessionReady), as every other change.
 */
const upload: MediaUploader = ({ url, body, requiredHeaders }) =>
  uploadPresignedObject({ url, body, requiredHeaders, allowLocalHttp: getEnvironment().name === 'local' })

let built: OfflineCore | null | undefined
let testRuntime: OfflineCore | null | undefined

/** Tests only: the runtime the portal uses (a fake), or null for none. `undefined` goes back to the real one. */
export function setOfflineRuntimeForTests(runtime: OfflineCore | null | undefined): void {
  testRuntime = runtime
  if (runtime) runtime.commands.register(STAFF_OFFLINE_REGISTRY)
}

/**
 * How the runtime is made, and how an `off` build learns that this origin already keeps an offline database (A11.1).
 * The app never touches IndexedDB itself (ESLint), so the check is the core's; until @hid/offline exports one
 * (`offlineDatabaseExists`), the answer is "none", which is the safe one: no runtime, and IndexedDB never opened.
 */
export interface OfflineRuntimeDeps {
  exists(): Promise<boolean>
  create(o: { appHost: string; env: OfflineEnv }): OfflineCore
}

function packagedDatabaseExists(): Promise<boolean> {
  const found = (offlinePackage as unknown as Record<string, unknown>).offlineDatabaseExists
  return typeof found === 'function' ? (found as () => Promise<boolean>)() : Promise.resolve(false)
}

/**
 * What the runtime reported (codes and counts only, never content): kept for the sync panel, so offline audit events
 * Health ID refused or rejected reach the person instead of being dropped silently.
 */
let auditProblem = false
const reportListeners = new Set<() => void>()
export function reportOffline(report: OfflineReport): void {
  if (report.kind !== 'audit-rejected' && (report.kind as string) !== 'audit-refused') return
  auditProblem = true
  for (const listener of [...reportListeners]) listener()
}
/** Whether offline audit events were refused or rejected since this page loaded. */
export function useOfflineAuditProblem(): boolean {
  return useSyncExternalStore(listener => { reportListeners.add(listener); return () => { reportListeners.delete(listener) } },
    () => auditProblem, () => auditProblem)
}
/** Tests only. */
export function forgetOfflineReports(): void { auditProblem = false; for (const listener of [...reportListeners]) listener() }

const DEFAULT_DEPS: OfflineRuntimeDeps = {
  exists: packagedDatabaseExists,
  create: ({ appHost, env }) => createOfflineRuntime({ appHost, env, transport: transportFromApiClient(staffTransport), upload,
    safety: staffSafetyProbe, report: reportOffline }),
}
let deps: OfflineRuntimeDeps = DEFAULT_DEPS

/** Tests only: how the runtime is made and the database found. `null` goes back to the real ones, and forgets the runtime made. */
export function setOfflineRuntimeDepsForTests(value: Partial<OfflineRuntimeDeps> | null): void {
  deps = value === null ? DEFAULT_DEPS : { ...DEFAULT_DEPS, ...value }
  built = undefined
}

function build(appHost: string): OfflineCore {
  const runtime = deps.create({ appHost, env: offlineEnv() })
  runtime.commands.register(STAFF_OFFLINE_REGISTRY)
  return runtime
}

/**
 * The offline runtime for this page, or null when the build's mode is off or the host is not one built for offline
 * (config `hosts`, A7). Null means every screen behaves exactly as it does today. The runtime sends through the staff
 * client (`transportFromApiClient`), so `NO_RAW_FETCH` holds and every request waits for its session. In an `off`
 * build it exists only once `resolveOfflineRuntime` has found an offline database here (A11.1).
 */
export function offlineRuntime(): OfflineCore | null {
  if (testRuntime !== undefined) return testRuntime
  if (built) return built
  if (!offlineHostAllowed()) return null
  if (built !== undefined) return built
  const appHost = offlineAppHost()
  return built = appHost ? build(appHost) : null
}

/**
 * Whether this page could still find a runtime after load: an `off` build on the EHR or Migrate host, where one exists
 * only if an offline database does (A11.1). Answered at once, so every other build keeps today's timing.
 */
export function offlineRuntimeMayFollow(): boolean {
  if (testRuntime !== undefined || built !== undefined) return false
  const appHost = offlineAppHost()
  return offlineConfig().mode === 'off' && (appHost === 'ehr' || appHost === 'ocr')
}

/**
 * The runtime, after the kill-switch check (§2.3, A8.5, A11.1). In an `off` build on the EHR or Migrate host (the app's
 * own identity, never VITE_HID_OFFLINE_HOSTS), the runtime is made only when this origin already keeps an offline
 * database: it then runs send-only, sending pending work after the next sign-in and deleting each vault once empty.
 * With no database it is not made, and IndexedDB is never opened.
 */
export async function resolveOfflineRuntime(): Promise<OfflineCore | null> {
  const now = offlineRuntime()
  if (now || testRuntime !== undefined) return now
  if (offlineConfig().mode !== 'off') return null
  const appHost = offlineAppHost()
  if (appHost !== 'ehr' && appHost !== 'ocr') return null
  if (!(await deps.exists().catch(() => false))) return null
  built ??= build(appHost)
  return built
}

/**
 * Whether reads and writes go through the device right now: the policy is enabled for this session and its
 * vault is open. A locked vault while online sends writes straight to the server, as today (§2.6).
 */
export function offlineActive<R extends OfflineRuntime = OfflineCore>(runtime: R | null = offlineRuntime() as R | null): runtime is R {
  if (!runtime) return false
  return runtime.policy().enabled && runtime.summary().vault === 'unlocked'
}

/**
 * Tells the runtime whether the session is ready, and for which account Health ID confirmed it (A12.3): it sends,
 * audits and extends the lease only while the open vault belongs to that account. The account is passed to the
 * runtime's `setSessionReady(ready, accountId)` (#39); a runtime that takes only `ready` ignores it.
 */
export function markSessionReady(runtime: OfflineCore | null, ready: boolean, accountId: string | null | undefined): void {
  if (!runtime) return
  const setReady = runtime.setSessionReady as (ready: boolean, accountId?: string) => void
  setReady.call(runtime, ready, ready && accountId ? accountId : undefined)
}

/** Locks the open vault when it belongs to another account than `accountId` (A12.3): a different account signed in. */
export function lockOtherAccount(runtime: OfflineRuntime | null, accountId: string): void {
  const open = runtime?.restoreSession()
  if (runtime && open && open.accountId !== accountId) runtime.lock('session')
}

// Whether the workspace runs on a session restored from the vault that Health ID has not confirmed yet (A12.3).
let restoredOnly = false
/** True while the session was restored offline and not yet confirmed: chart reads then answer from the device only. */
export function sessionRestoredOnly(): boolean { return restoredOnly }
export function setSessionRestoredOnly(value: boolean): void { restoredOnly = value }

/** The session as the vault keeps it (sealed in its header). */
export function staffSnapshot(session: StaffSession): StaffSessionSnapshot | null {
  const { actor } = session
  const facility = actor.facility
  if (!facility) return null
  return { actorId: actor.id, accountId: actor.id, membershipId: facility.membershipId, email: actor.email ?? '',
    displayName: actor.displayName ?? actor.email ?? '', facilityId: facility.id, facilityName: facility.name,
    permissions: [...facility.permissions], session }
}

/** The staff session a vault restored, when its sealed copy reads as one. */
export function restoredStaffSession(snapshot: StaffSessionSnapshot | null): StaffSession | null {
  const session = snapshot?.session as Partial<StaffSession> | null | undefined
  return session && typeof session.actor?.id === 'string' && session.actor.id === snapshot?.actorId ? session as StaffSession : null
}

const NO_RUNTIME = () => () => undefined

/** Summaries compared by value, so a runtime answering a fresh object each time does not re-render forever. */
const lastSummary = new WeakMap<OfflineRuntime, { text: string; value: SyncSummary }>()
function stableSummary(runtime: OfflineRuntime): SyncSummary {
  const value = runtime.summary()
  const text = JSON.stringify(value)
  const last = lastSummary.get(runtime)
  if (last?.text === text) return last.value
  lastSummary.set(runtime, { text, value })
  return value
}

/** The runtime's summary, kept current; null without a runtime. */
export function useOfflineSummary(runtime: OfflineRuntime | null = offlineRuntime()): SyncSummary | null {
  return useSyncExternalStore(runtime ? listener => runtime.subscribe(listener) : NO_RUNTIME,
    () => runtime ? stableSummary(runtime) : null, () => null)
}

/** Whether offline is in use for this session, kept current. */
export function useOfflineActive(runtime: OfflineRuntime | null = offlineRuntime()): boolean {
  const summary = useOfflineSummary(runtime)
  return summary !== null && summary.vault === 'unlocked' && runtime !== null && runtime.policy().enabled
}

/** Whether this tab has no connection to Health ID right now, by the runtime's probe. */
export function useOffline(runtime: OfflineRuntime | null = offlineRuntime()): boolean {
  const summary = useOfflineSummary(runtime)
  return summary !== null && summary.connectivity === 'offline'
}

provideOfflineRuntime(offlineRuntime)
