import { createFakeOfflineRuntime, DEMO_HOSPITAL_FACILITY_ID } from '@hid/offline/testing'
import type { StaffSessionSnapshot } from '@hid/offline'
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
