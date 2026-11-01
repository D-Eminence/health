/**
 * The single error type every Health ID API call rejects with.
 *
 * Its shape mirrors the error envelope the Health ID backend already returns
 * (`code`, `requestId`, `retryable`, `status`), so pages can tell failures
 * apart by the backend's own codes.
 *
 * `message` is always the frontend's own plain sentence for the status
 * (plainStatusText), never the server's text: the server's words are kept in
 * `detail` for code that reads them and are never shown. A page shows
 * plainErrorText(caught, fallback) (./plain.ts), which also keeps codes,
 * status numbers, correlation ids and JavaScript messages off the screen.
 */

import { plainStatusText } from './plainWords'

export type HidErrorCode =
  // Produced locally, before or instead of a response.
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_CANCELLED'
  | 'INVALID_RESPONSE'
  // Mirrored from the transport when the backend sends no code of its own.
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN'

export interface HidApiErrorOptions {
  readonly code?: string | null
  readonly requestId?: string | null
  readonly retryable?: boolean
  /** The server's own words (the problem's `detail`), for code that reads them. Never shown. */
  readonly detail?: string | null
  readonly details?: unknown
  /** Field names to result codes from the problem's `fields` member. */
  readonly fields?: Readonly<Record<string, string>> | null
  /** The problem's `attemptsLeft` member: tries left before a lock (P4c order acceptance). */
  readonly attemptsLeft?: number | null
  /** The problem's `retryAfter` member: an ISO UTC time from which a limited command is possible again (D17). */
  readonly retryAt?: string | null
  /** The problem's `required` member: the actions a refused review lacks (D17, support's review). */
  readonly required?: readonly string[] | null
  readonly cause?: unknown
}

export class HidApiError extends Error {
  readonly status: number
  readonly code: string
  /** Correlates a browser failure with a backend log line. Never contains PHI. */
  readonly requestId: string | null
  readonly retryable: boolean
  /**
   * The server's own words for the failure (the problem's `detail` or `message`), kept only for code that must read
   * them (a request id a refusal names, say). Never shown to a person: it can carry API paths, internal names and
   * field names. Pages show plainErrorText instead. Null when the server sent none.
   */
  readonly detail: string | null
  readonly details: unknown
  /**
   * The problem's `fields` member: field names to the result codes `match`,
   * `no_match` or `not_in_record`, never a submitted or stored value
   * (hid-system 0094); the client drops any other value. Null when the problem
   * has none.
   */
  readonly fields: Readonly<Record<string, string>> | null
  /**
   * The problem's `attemptsLeft` member: how many more tries a refused
   * identifier check allows before it locks (hid-system P4c, 409
   * ORDER_ROUTE_PATIENT_MISMATCH and ORDER_ROUTE_ACCEPT_LOCKED). A count, never
   * a submitted value; null when the problem has none.
   */
  readonly attemptsLeft: number | null
  /**
   * The problem's `retryAfter` member: an ISO UTC time from which a limited command is possible again (hid-system 0090,
   * 429 ORDER_ROUTE_CORRECTION_LIMIT). A time, never a submitted value; null when the problem has none. Not the
   * `Retry-After` header, which the retry loop reads (retryAfterSeconds), so it is named for what it is: a time.
   */
  readonly retryAt: string | null
  /**
   * The problem's `required` member: the actions a refused review lacks, as their codes (hid-system 0090, 400
   * WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED, for example `referred_to_dpo` and `ordering_facility_told`). Codes only; null
   * when the problem has none.
   */
  readonly required: readonly string[] | null

  constructor(status: number, message: string, options: HidApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'HidApiError'
    this.status = status
    this.code = options.code ?? defaultCodeForStatus(status)
    this.requestId = options.requestId ?? null
    this.retryable = options.retryable ?? isRetryableStatus(status)
    this.detail = options.detail ?? null
    this.details = options.details ?? null
    this.fields = options.fields ?? null
    this.attemptsLeft = options.attemptsLeft ?? null
    this.retryAt = options.retryAt ?? null
    this.required = options.required ?? null
  }

  /** True when the caller should send the user back through authentication. */
  get isAuthenticationFailure(): boolean {
    return this.status === 401
  }

  /** True when the user is signed in but not permitted. Never widen this in the UI. */
  get isAuthorizationFailure(): boolean {
    return this.status === 403
  }

  get isCancellation(): boolean {
    return this.code === 'REQUEST_CANCELLED'
  }

  /** A log-safe summary. Deliberately excludes `details`, which may echo input, and `fields`. */
  toLogContext(): Record<string, unknown> {
    return {
      status: this.status,
      code: this.code,
      requestId: this.requestId,
      retryable: this.retryable,
    }
  }
}

export function isHidApiError(value: unknown): value is HidApiError {
  return value instanceof HidApiError
}

export function defaultCodeForStatus(status: number): HidErrorCode {
  if (status === 400) return 'BAD_REQUEST'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 503) return 'SERVICE_UNAVAILABLE'
  if (status >= 500) return 'SERVER_ERROR'
  return 'UNKNOWN'
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/**
 * The plain sentence for a status, used as every HidApiError's message: short, non-technical, and free of any request
 * or server detail. The same words as plainStatusText (./plain.ts), kept under this name for its callers.
 */
export function fallbackMessageForStatus(status: number): string {
  return plainStatusText(status)
}
