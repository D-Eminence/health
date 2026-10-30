import { isHidApiError } from '@hid/http'
import type { OfflineCore, OfflineRuntime, StaffSessionSnapshot } from '@hid/offline'
import type { StaffSession } from '../api'
import { staffSnapshot } from './runtime'
import { loadShell } from './shellLoader'

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
 * After an online session is ready (amendment A5). The runtime says what to do (`offer`, which writes nothing):
 * - `ask`: the facility is in the pilot and this device keeps no copy for it; the one-time question is asked, and
 *   `attachSession` waits for the answer (the key derived at sign-in is kept in memory until then);
 * - `existing`: this account's vault for the facility opens without asking;
 * - `paused`: vaults exist but this tab has no key (an online reload): offline is paused until the person unlocks;
 * - `unavailable`: nothing is shown; `attachSession` drops the key.
 */
export async function attachOnlineSession(runtime: OfflineCore | null, session: StaffSession): Promise<{ result: 'attached' | 'choice' | 'paused' | 'none'; snapshot: StaffSessionSnapshot | null }> {
  const snapshot = staffSnapshot(session)
  if (!runtime || !snapshot) return { result: 'none', snapshot }
  try {
    const offer = await runtime.offer(snapshot)
    if (offer.kind === 'ask') return { result: 'choice', snapshot }
    await runtime.attachSession(snapshot, { optIn: false, online: true })
    syncShell(runtime)
    if (runtime.policy().enabled && runtime.summary().vault === 'unlocked') return { result: 'attached', snapshot }
    return { result: offer.kind === 'paused' ? 'paused' : 'none', snapshot }
  } catch { return { result: 'none', snapshot } }
}

/**
 * After a vault is attached: the shell is registered only once a vault opens for an enabled facility (A5); when the
 * facility has left the pilot and its vault opens send-only, the shell caches are purged (§2.3 kill switch, A8.5).
 * Anything else leaves the shell alone, so a facility that was never in the pilot sees no change.
 */
export function syncShell(runtime: OfflineRuntime): void {
  const policy = runtime.policy()
  if (runtime.summary().vault !== 'unlocked') return
  // The shell module is loaded only now, and only for these two cases (see shellLoader.ts).
  if (policy.enabled) void loadShell().then(shell => shell.enableShell()).catch(() => undefined)
  else if (policy.reason === 'facility-off') void loadShell().then(shell => shell.purgeShell()).catch(() => undefined)
}

/** Whether a session read still lists the facility the vault was opened for; a membership that ended does not. */
export function keepsVaultFacility(session: StaffSession, vaultFacility: string | null): boolean {
  return vaultFacility === null || session.actor.facilities.some(facility => facility.id === vaultFacility)
}
