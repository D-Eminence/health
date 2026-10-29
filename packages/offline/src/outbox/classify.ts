/**
 * Failure classification (§2.8, "status + problem code + content type").
 *
 * Pure: the engine decides what to do with the class. The receipt-check rule
 * (fixes F3) is expressed here as `receiptCheck`: before a non-transient
 * refusal of a command whose earlier attempt had an unknown outcome, the engine
 * asks C1 whether the key already completed.
 */

export type FailureClass =
  | 'applied'
  | 'transient'
  | 'session'
  | 'access'
  | 'edge'
  | 'invalid'
  | 'applied-unreadable'
  | 'missing'
  | 'version'
  | 'state'

export interface Answer {
  /** null for a network error or a timeout with no response. */
  readonly status: number | null
  readonly code?: string | null
  /** Content type started with `application/problem+json`. */
  readonly problem?: boolean
  readonly networkError?: boolean
  /** The request path, to tell the document routes' 409 `CONFLICT` apart. */
  readonly path?: string
}

const ACCESS_CODES = new Set(['CONSENT_REQUIRED', 'ACCESS_DENIED', 'PERMISSION_DENIED'])
const STATE_CODES = new Set(['CLINICAL_CONFLICT', 'INVALID_CLINICAL_REFERENCE'])
const DOCUMENT_PATH = /^\/api\/v1\/ehr\/documents(\/|$)/

export function classify(answer: Answer): FailureClass {
  const { status } = answer
  const code = answer.code ?? null
  if (answer.networkError || status === null || status === 0) return 'transient'
  if (status >= 200 && status < 300) return 'applied'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient'
  if (status === 401) return 'session'
  if (status === 403) {
    if (code === 'STAFF_MFA_REQUIRED') return 'session'
    // The WAF's 8 KB refusal is a 403 that is not problem+json.
    if (!answer.problem) return 'edge'
    // Any other problem 403 is held for access rather than lost.
    return 'access'
  }
  if (status === 413) return 'edge'
  if (status === 412) return 'version'
  if (status === 404) return 'missing'
  if (status === 409) {
    if (code === 'REQUEST_IN_PROGRESS') return 'transient'
    if (code === 'IDEMPOTENCY_RESULT_UNAVAILABLE') return 'applied-unreadable'
    if (code === 'IDEMPOTENCY_KEY_REUSED') return 'invalid'
    // Document upload: in progress, or uploads paused by platform control.
    if (code === 'CONFLICT' && answer.path !== undefined && DOCUMENT_PATH.test(answer.path)) return 'transient'
    if (code !== null && (STATE_CODES.has(code) || /^INVALID_[A-Z_]*_TRANSITION$/.test(code))) return 'state'
    return 'state'
  }
  if (status === 400) return 'invalid'
  return 'invalid'
}

/** Classes that may hide an earlier success, so a sent-before command gets a C1 lookup first. */
export function needsReceiptCheck(cls: FailureClass, sentBefore: boolean): boolean {
  if (!sentBefore) return cls === 'applied-unreadable'
  return cls === 'access' || cls === 'edge' || cls === 'invalid' || cls === 'applied-unreadable'
    || cls === 'missing' || cls === 'version' || cls === 'state'
}

/**
 * A refusal on the very first attempt that proves nothing was applied: DTO
 * validation and authorization run before any write (§2.8 save path, step 3).
 */
export function isDefinitiveFirstRefusal(answer: Answer): boolean {
  const s = answer.status
  if (s === 403) return answer.problem === true && answer.code !== 'STAFF_MFA_REQUIRED'
  return s === 400 || s === 404 || s === 412
    || (s === 409 && classify(answer) !== 'transient' && answer.code !== 'IDEMPOTENCY_RESULT_UNAVAILABLE')
}

export function isAccessCode(code: string | null | undefined): boolean {
  return code != null && ACCESS_CODES.has(code)
}
