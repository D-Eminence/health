/**
 * The single error type every Health ID API call rejects with.
 *
 * Its shape mirrors the error envelope the Health ID backend already returns
 * (`code`, `message`, `requestId`, `retryable`, `status`), so the frontend
 * surfaces the backend's own vocabulary instead of inventing a second one.
 *
 * `message` is safe to show a user: the backend sanitises it, and nothing in
 * this package ever composes a message out of request or response bodies.
 */

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
  readonly details?: unknown
  /** Field names to result codes from the problem's `fields` member. */
  readonly fields?: Readonly<Record<string, string>> | null
  /** The problem's `attemptsLeft` member: tries left before a lock (P4c order acceptance). */
  readonly attemptsLeft?: number | null
  readonly cause?: unknown
}

export class HidApiError extends Error {
  readonly status: number
  readonly code: string
  /** Correlates a browser failure with a backend log line. Never contains PHI. */
  readonly requestId: string | null
  readonly retryable: boolean
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

  constructor(status: number, message: string, options: HidApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'HidApiError'
    this.status = status
    this.code = options.code ?? defaultCodeForStatus(status)
    this.requestId = options.requestId ?? null
    this.retryable = options.retryable ?? isRetryableStatus(status)
    this.details = options.details ?? null
    this.fields = options.fields ?? null
    this.attemptsLeft = options.attemptsLeft ?? null
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
 * User-facing fallbacks for when the backend sends no usable message.
 * Kept short, non-technical, and free of any request detail.
 */
export function fallbackMessageForStatus(status: number): string {
  if (status === 400) return 'Some of the information sent was not valid. Please check and try again.'
  if (status === 401) return 'Please sign in to continue.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'We could not find what you were looking for.'
  if (status === 408) return 'The request took too long. Please try again.'
  if (status === 409) return 'That action conflicts with the current state. Refresh and try again.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return 'The service is temporarily unavailable. Please try again shortly.'
  return 'Something went wrong. Please try again.'
}
