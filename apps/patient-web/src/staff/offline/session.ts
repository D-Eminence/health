import { isHidApiError } from '@hid/http'
import type { OfflineRuntime, StaffSessionSnapshot } from '@hid/offline'
import type { StaffSession } from '../api'
import { offlineFacility } from './environment'
import { staffSnapshot } from './runtime'

/**
 * Whether reading the session failed because Health ID could not be reached at all (OFFLINE-CONTRACT §2.6, "Offline
 * cold start"): a network error or timeout, or the Worker's 502 API_ORIGIN_UNAVAILABLE. Any answer from Identity
 * itself (a 401, a 403, a 5xx it sent) is not this.
 */
export function healthIdUnreachable(error: unknown): boolean {
  if (!isHidApiError(error)) return false
  return error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' || (error.status === 502 && error.code === 'API_ORIGIN_UNAVAILABLE')
}

/** Whether the cold start should offer the offline sign-in: a runtime with a vault on this device. */
export async function offersOfflineSignIn(runtime: OfflineRuntime | null): Promise<boolean> {
  if (!runtime) return false
  try { return await runtime.hasVaults() } catch { return false }
}

/**
 * After an online session is ready (amendment A5): the runtime opens this account's vault for the facility if the
 * person chose to keep one before. Answers 'choice' when the facility is in the pilot and this device keeps no copy
 * for it yet, so the one-time question is asked; 'none' when nothing changes (offline off, or not this facility).
 */
export async function attachOnlineSession(runtime: OfflineRuntime | null, session: StaffSession): Promise<{ result: 'attached' | 'choice' | 'none'; snapshot: StaffSessionSnapshot | null }> {
  const snapshot = staffSnapshot(session)
  if (!runtime || !snapshot) return { result: 'none', snapshot }
  try {
    await runtime.attachSession(snapshot, { optIn: false, online: true })
  } catch { return { result: 'none', snapshot } }
  const policy = runtime.policy()
  if (policy.enabled && runtime.summary().vault === 'unlocked') return { result: 'attached', snapshot }
  if (offlineFacility(snapshot.facilityId) && policy.reason === 'not-opted-in' && runtime.summary().vault === 'none') return { result: 'choice', snapshot }
  return { result: 'none', snapshot }
}

/** Whether a session read still lists the facility the vault was opened for; a membership that ended does not. */
export function keepsVaultFacility(session: StaffSession, vaultFacility: string | null): boolean {
  return vaultFacility === null || session.actor.facilities.some(facility => facility.id === vaultFacility)
}
