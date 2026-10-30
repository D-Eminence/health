import { useSyncExternalStore } from 'react'
import { createOfflineRuntime, transportFromApiClient, type MediaUploader, type OfflineCore, type OfflineRuntime, type StaffSessionSnapshot,
  type SyncSummary } from '@hid/offline'
import { uploadPresignedObject } from '@hid/http'
import { staffTransport, type StaffSession } from '../api'
import { getEnvironment } from '../env'
import { offlineAppHost, offlineEnv, offlineHostAllowed } from './environment'
import { STAFF_OFFLINE_REGISTRY } from './registry'
import { provideOfflineRuntime } from './holder'

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
 * The offline runtime for this page, or null when the build's mode is off or the host is not one built for offline
 * (config `hosts`, A7). Null means every screen behaves exactly as it does today. The runtime sends through the staff
 * client (`transportFromApiClient`), so `NO_RAW_FETCH` holds and every request waits for its session.
 */
export function offlineRuntime(): OfflineCore | null {
  if (testRuntime !== undefined) return testRuntime
  if (!offlineHostAllowed()) return null
  if (built !== undefined) return built
  const appHost = offlineAppHost()
  if (!appHost) return built = null
  built = createOfflineRuntime({ appHost, env: offlineEnv(), transport: transportFromApiClient(staffTransport), upload })
  built.commands.register(STAFF_OFFLINE_REGISTRY)
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
