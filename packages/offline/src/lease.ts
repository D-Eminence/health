/**
 * The offline lease (§2.6, D2): `leaseUntil = min(lastServerContactAt + 8 h,
 * signedInAt + 24 h)`. `lastServerContactAt` moves forward on every
 * authenticated 2xx. Offline unlock is refused when trustedNow ≥ leaseUntil or
 * the clock is suspect.
 */

import { LIMITS, type ClockState } from './contracts'

export function leaseUntil(lastServerContactAt: number, signedInAt: number): number {
  return Math.min(lastServerContactAt + LIMITS.leaseMs, signedInAt + LIMITS.absoluteMs)
}

export type LeaseVerdict = 'ok' | 'lease-expired' | 'clock-suspect'

export function leaseVerdict(until: number, trustedNow: number, clock: ClockState): LeaseVerdict {
  if (clock === 'suspect') return 'clock-suspect'
  if (trustedNow >= until) return 'lease-expired'
  return 'ok'
}

/** Move the lease forward after an authenticated 2xx. `serverMs` is trusted time; it never moves backwards. */
export function touchLease<L extends { signedInAt: number; lastServerContactAt: number; leaseUntil: number }>(lease: L, serverMs: number): L {
  const last = Math.max(lease.lastServerContactAt, serverMs)
  return { ...lease, lastServerContactAt: last, leaseUntil: leaseUntil(last, lease.signedInAt) }
}
