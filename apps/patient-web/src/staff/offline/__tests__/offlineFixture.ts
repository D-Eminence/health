import { createFakeOfflineRuntime, DEMO_HOSPITAL_FACILITY_ID } from '@hid/offline/testing'
import { createOfflineRuntime, TransportError, type OfflineEnv, type SendResult, type SendSpec, type StaffSessionSnapshot } from '@hid/offline'
import type { IDBFactory } from 'fake-indexeddb'
import { STAFF_OFFLINE_REGISTRY } from '../registry'

/** Test helpers around Stream A's in-memory fake (`@hid/offline/testing`), for the EHR screens' tests only. */
export const PILOT = DEMO_HOSPITAL_FACILITY_ID
export const PASSWORD = 'a long enough password'

export function snapshotOf(facilityId: string = PILOT, session: unknown = null, permissions: string[] = []): StaffSessionSnapshot {
  return { actorId: 'staff-1', accountId: 'staff-1', membershipId: `member-${facilityId}`, email: 'ada@example.test', displayName: 'Ada Clinician',
    facilityId, facilityName: 'Demo Hospital', permissions, session }
}

/** A fake runtime with this registry, and no vault yet. */
export function fakeOffline(options: Parameters<typeof createFakeOfflineRuntime>[0] = {}) {
  const fake = createFakeOfflineRuntime(options)
  fake.runtime.commands.register(STAFF_OFFLINE_REGISTRY)
  return fake
}

/** A fake runtime with an open vault for `snapshot`, as after an online sign-in with "Keep an offline copy" chosen. */
export async function openVault(snapshot: StaffSessionSnapshot = snapshotOf()) {
  const fake = fakeOffline()
  fake.runtime.prepareFromSignIn(snapshot.email, PASSWORD)
  await fake.runtime.attachSession(snapshot, { optIn: true, online: true })
  return fake
}

/** A stand-in for ehr-api for the real core: writes answer 201 with an id; everything else answers 200. */
export function fakeServer() {
  const sent: SendSpec[] = []
  const state = { offline: false, answer: null as ((spec: SendSpec) => SendResult | null) | null }
  let n = 0
  const transport = async (spec: SendSpec): Promise<SendResult> => {
    if (state.offline) throw new TransportError({ status: null, networkError: true })
    sent.push(spec)
    const scripted = state.answer?.(spec)
    if (scripted) return scripted
    if (spec.method === 'POST' && /\/(encounters|clinical-notes|vitals|diagnoses|prescriptions|lab-requests)$/.test(spec.path)) {
      n += 1
      return { status: 201, body: { id: `server-${n}`, rowVersion: 1 }, date: null }
    }
    return { status: 200, body: {}, date: null }
  }
  return { sent, state, transport }
}

/** The real core on an in-memory IndexedDB (fake-indexeddb), with this registry; timers off. */
/** What a test may add to the real core's options: the safety probe, the clock, and how long a read waits for Health ID. */
export type RealExtra = Partial<Pick<Parameters<typeof createOfflineRuntime>[0], 'safety' | 'wall' | 'mono' | 'networkFirstMs'>>

export function realRuntime(idb: IDBFactory, transport: (spec: SendSpec) => Promise<SendResult>, env: OfflineEnv = { mode: 'pilot', facilities: PILOT, hosts: 'ehr,ocr' }, appHost = 'ehr',
  extra: RealExtra = {}) {
  const runtime = createOfflineRuntime({ appHost, env, transport, idbFactory: idb, calibrate: async () => 1000, timers: false,
    BroadcastChannel: null, locks: null, storage: null, ...extra })
  runtime.commands.register(STAFF_OFFLINE_REGISTRY)
  return runtime
}

/**
 * Tells the real core the session is ready for `accountId`, as the workspace does (A12.3). The core after #39 sends
 * only for the confirmed account; the one before it takes `ready` alone and ignores the account.
 */
export function readyFor(runtime: { setSessionReady(ready: boolean): void }, accountId: string): void {
  (runtime.setSessionReady as (ready: boolean, accountId?: string) => void).call(runtime, true, accountId)
}

/** A real runtime with an open vault for `snapshot` (signed in online, "Keep an offline copy" chosen). */
export async function realVault(idb: IDBFactory, transport: (spec: SendSpec) => Promise<SendResult>, snapshot: StaffSessionSnapshot = snapshotOf(),
  extra: RealExtra = {}) {
  const runtime = realRuntime(idb, transport, undefined, undefined, extra)
  runtime.prepareFromSignIn(snapshot.email, PASSWORD)
  await runtime.attachSession(snapshot, { optIn: true, online: true })
  readyFor(runtime, snapshot.accountId)
  return runtime
}
