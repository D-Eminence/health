/**
 * Retry policy.
 *
 * Retries are narrow on purpose. A blind retry against a clinical API can
 * duplicate a record or re-run a side effect, so only requests the caller has
 * declared safe are ever repeated, and only for failures the backend itself
 * marked retryable.
 */

import { HidApiError } from './errors'

export interface RetryPolicy {
  /** Attempts after the first. `0` disables retrying. */
  readonly maxRetries: number
  /** First backoff delay in milliseconds; doubles per attempt. */
  readonly baseDelayMs: number
  /** Upper bound on any single backoff delay. */
  readonly maxDelayMs: number
}

export const NO_RETRY: RetryPolicy = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 }

/**
 * Default for reads. Two extra attempts absorb a cold start or a brief network
 * blip without keeping a user waiting for long.
 */
export const DEFAULT_READ_RETRY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
}

/** HTTP methods that may be repeated without changing server state. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase())
}

/**
 * Decides whether another attempt is allowed.
 *
 * A non-idempotent request is never retried here. If a write needs to be
 * retry-safe, the endpoint has to accept an idempotency key and the caller has
 * to pass one; the backend already accepts `x-idempotency-key` on its CORS
 * allow-list, but no endpoint contract for it has been confirmed, so this
 * package does not assume one exists.
 */
export function shouldRetry(options: {
  readonly error: unknown
  readonly method: string
  readonly attempt: number
  readonly policy: RetryPolicy
  readonly idempotent: boolean
}): boolean {
  const { error, attempt, policy, idempotent } = options
  if (attempt >= policy.maxRetries) return false
  if (!idempotent) return false
  if (!(error instanceof HidApiError)) return false
  if (error.isCancellation) return false

  return error.retryable
}

/**
 * Backoff for the next attempt, in milliseconds.
 *
 * A `Retry-After` header always wins: when the backend says how long to wait,
 * ignoring it just adds load to a service that is already struggling.
 * Otherwise the delay grows exponentially with full jitter, which keeps many
 * clients from retrying in lockstep after a shared outage.
 */
export function nextDelayMs(options: {
  readonly attempt: number
  readonly policy: RetryPolicy
  readonly retryAfterSeconds?: number | null
  readonly random?: () => number
}): number {
  const { attempt, policy, retryAfterSeconds } = options
  const random = options.random ?? Math.random

  if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1_000, policy.maxDelayMs)
  }

  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs)
  return Math.round(exponential * random())
}

/** Reads `Retry-After`, which may be seconds or an HTTP date. */
export function parseRetryAfter(headerValue: string | null, now: number = Date.now()): number | null {
  if (headerValue === null) return null

  const trimmed = headerValue.trim()
  if (trimmed === '') return null

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds

  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) return null

  return Math.max(0, (timestamp - now) / 1_000)
}
