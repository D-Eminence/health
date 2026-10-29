import { LIMITS } from '../contracts'

/**
 * Full-jitter backoff (§2.8): `min(300 s, 2 s × 2^(attempts−1)) × random()`.
 * A server hint (`Retry-After`, or the problem's `retryAfter`) wins.
 */
export function backoffMs(attempts: number, random: () => number = Math.random, hintMs?: number | null): number {
  if (hintMs != null && Number.isFinite(hintMs) && hintMs >= 0) return Math.min(hintMs, LIMITS.backoffCapMs)
  const n = Math.max(1, attempts)
  const ceiling = Math.min(LIMITS.backoffCapMs, LIMITS.backoffBaseMs * 2 ** (n - 1))
  return Math.floor(ceiling * random())
}

/** "Still trying" shows once a command has been retrying for 30 minutes. */
export const STILL_TRYING_MS = 30 * 60_000
