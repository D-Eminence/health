import { useSyncExternalStore } from 'react'
import * as offlinePackage from '@hid/offline'
import type { OfflineRuntime, StaffSessionSnapshot, SyncSummary } from '@hid/offline'
import type { ApiClient } from '@hid/http'
import { staffTransport, type StaffSession } from '../api'
import { staffSessionGeneration, staffSessionReadyFor, untilStaffSessionReady } from '../session'
import { offlineEnvironment, offlineHostAllowed, type OfflineEnvironment } from './environment'
import { STAFF_OFFLINE_REGISTRY } from './registry'
import { provideOfflineRuntime } from './holder'

/**
 * What the staff portal hands @hid/offline to build its runtime: the staff
 * transport (so `NO_RAW_FETCH` holds and every request waits for its session),
 * the build's offline configuration, and the session's readiness, which the
 * engine checks before each send (OFFLINE-CONTRACT §2.8, "Eligible").
 */
export interface StaffOfflineOptions {
  readonly transport: ApiClient
  readonly appHost: string
  readonly environment: OfflineEnvironment
  readonly session: {
    generation(): number
    readyFor(generation: number): boolean
    untilReady(generation: number): Promise<void>
  }
}

export type OfflineRuntimeFactory = (options: StaffOfflineOptions) => OfflineRuntime

// Stream A's public entry exports the factory once its runtime lands; until then there is none, and the portal
// works online exactly as before.
function packagedFactory(): OfflineRuntimeFactory | null {
  const found = (offlinePackage as unknown as Record<string, unknown>).createOfflineRuntime
  return typeof found === 'function' ? found as OfflineRuntimeFactory : null
}

let built: OfflineRuntime | null | undefined
let testRuntime: OfflineRuntime | null | undefined

/** Tests only: the runtime the portal uses (a fake), or null for none. `undefined` goes back to the real one. */
export function setOfflineRuntimeForTests(runtime: OfflineRuntime | null | undefined): void {
  testRuntime = runtime
  if (runtime) runtime.commands.register(STAFF_OFFLINE_REGISTRY)
}

/**
 * The offline runtime for this page, or null when the build's mode is off, the host is not one built for offline,
 * or @hid/offline has no runtime yet. Null means every screen behaves exactly as it does today.
 */
export function offlineRuntime(): OfflineRuntime | null {
  if (testRuntime !== undefined) return testRuntime
  if (!offlineHostAllowed()) return null
  if (built !== undefined) return built
  const create = packagedFactory()
  built = create ? create({
    transport: staffTransport, appHost: window.location.hostname, environment: offlineEnvironment(),
    session: { generation: staffSessionGeneration, readyFor: staffSessionReadyFor, untilReady: untilStaffSessionReady },
  }) : null
  built?.commands.register(STAFF_OFFLINE_REGISTRY)
  return built
}

/**
 * Whether reads and writes go through the device right now: the policy is enabled for this session and its
 * vault is open. A locked vault while online sends writes straight to the server, as today (§2.6).
 */
export function offlineActive(runtime: OfflineRuntime | null = offlineRuntime()): runtime is OfflineRuntime {
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
