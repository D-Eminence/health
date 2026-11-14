/**
 * Response envelope handling.
 *
 * hid-system returns RFC 7807 style Problem Details containing `detail`,
 * `code`, `correlationId`, and optional field `errors`; from 0094 a problem
 * may also carry `fields`, field names to result codes. The historical bearer
 * transport also used a legacy envelope, which remains readable here.
 *
 * This module reads both without guessing at anything else, and is the only
 * place in the frontend that knows the wire shape.
 */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function parseJsonBody(rawBody: string): unknown {
  if (rawBody.trim() === '') return null
  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    return null
  }
}

/**
 * Unwraps `{ data: T }` when present, otherwise returns the payload as-is.
 * A bare `null` body becomes `null`, which callers type as they need.
 */
export function unwrapData<T>(payload: unknown): T {
  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data as T
  }
  return payload as T
}

export interface ParsedErrorEnvelope {
  readonly status: number
  /**
   * The server's own words (`detail`, else `message`, else `error.message`, else a plain `error`), or null when it sent
   * none or only transport noise. Never shown: the client keeps it as HidApiError.detail, and the error's message is
   * the frontend's own plain sentence.
   */
  readonly detail: string | null
  readonly code: string | null
  readonly requestId: string | null
  readonly retryable: boolean | null
  readonly details: unknown
  /** Field names to result codes (`match`, `no_match`, `not_in_record`); null when the problem has none. */
  readonly fields: Readonly<Record<string, string>> | null
  /** Tries left before a lock (P4c order acceptance); null when the problem has none. */
  readonly attemptsLeft: number | null
  /** The problem's `retryAfter` member: when a limited command is possible again, an ISO UTC time (D17); else null. */
  readonly retryAt: string | null
  /** The actions a refused review lacks, as their codes (D17); null when the problem has none. */
  readonly required: readonly string[] | null
}

/**
 * The result codes the contract defines (hid-system main f9dbaf0,
 * INTERFACE_CONTRACT.md section 6; `common/problem.ts`). A pattern for short
 * codes is not enough: a surname such as `OKAFOR` or a date such as
 * `1990-04-02` fits one.
 */
const RESULT_CODES: ReadonlySet<string> = new Set(['match', 'no_match', 'not_in_record'])

/**
 * The problem's `fields` member (hid-system 0094, INTERFACE_CONTRACT.md
 * section 6): an object of field names to result codes, never a submitted or
 * stored value. Only names whose code is one of `RESULT_CODES` are kept, so a
 * later or malformed shape cannot carry a value into a page; a new code needs
 * adding here first.
 */
function readFields(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null
  const fields: Record<string, string> = {}
  for (const [name, code] of Object.entries(value)) {
    if (typeof code === 'string' && RESULT_CODES.has(code)) fields[name] = code
  }
  return Object.keys(fields).length > 0 ? Object.freeze(fields) : null
}

/**
 * The problem's `attemptsLeft` member (hid-system P4c: an order's acceptance
 * refused for a patient identifier that does not match): a whole number from 0
 * to 100. Anything else is not one, so no other value can reach a page.
 */
function readAttemptsLeft(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null
}

/**
 * The problem's `retryAfter` member (hid-system 0090: 429 ORDER_ROUTE_CORRECTION_LIMIT): an ISO-8601 UTC time with
 * seconds, and optionally milliseconds, that reads as a time, such as `2026-10-27T09:14:03.218Z`. Anything else is not
 * one, so no other value can reach a page.
 */
function readRetryAfter(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null
}

/**
 * The problem's `required` member (hid-system 0090: 400 WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED): action codes, sent as a
 * comma-separated string (or a list), each lower-case letters and underscores, at most 8 of them. Anything else is not
 * one, so no other value can reach a page.
 */
function readRequired(value: unknown): readonly string[] | null {
  const parts = typeof value === 'string' ? value.split(',').map(part => part.trim())
    : Array.isArray(value) ? value : null
  if (!parts || parts.length === 0 || parts.length > 8) return null
  if (!parts.every(part => typeof part === 'string' && /^[a-z][a-z_]{0,63}$/.test(part))) return null
  return Object.freeze([...parts] as string[])
}

/**
 * Reads the backend's error envelope out of a failed response.
 *
 * Only fields the backend actually documents are trusted. Anything absent
 * comes back null so the caller can apply its own default rather than having
 * one invented here.
 */
export function parseErrorEnvelope(
  payload: unknown,
  options: { readonly status: number; readonly headerRequestId?: string | null },
): ParsedErrorEnvelope {
  const record = isRecord(payload) ? payload : null
  // Some handlers nest the failure under `error`.
  const nested = record && isRecord(record.error) ? record.error : null

  const detail =
    readNonEmptyString(record?.detail) ??
    readNonEmptyString(record?.message) ??
    readNonEmptyString(nested?.message) ??
    readNonEmptyString(record?.error)

  const retryableValue = record?.retryable ?? nested?.retryable

  return {
    status: options.status,
    detail: detail === null || isLowSignalMessage(detail) ? null : detail,
    code: readNonEmptyString(record?.code) ?? readNonEmptyString(nested?.code),
    requestId:
      readNonEmptyString(record?.correlationId) ??
      readNonEmptyString(record?.requestId) ??
      readNonEmptyString(record?.request_id) ??
      readNonEmptyString(options.headerRequestId),
    retryable: typeof retryableValue === 'boolean' ? retryableValue : null,
    details: record && Object.prototype.hasOwnProperty.call(record, 'errors') ? record.errors
      : record && Object.prototype.hasOwnProperty.call(record, 'details') ? record.details : null,
    fields: readFields(record?.fields),
    attemptsLeft: readAttemptsLeft(record?.attemptsLeft),
    retryAt: readRetryAfter(record?.retryAfter),
    required: readRequired(record?.required),
  }
}

/**
 * Messages that are transport noise rather than anything a program could read (an HTML error page, a gateway's
 * generic words), so they are not kept as a HidApiError's detail. Nothing the server sends is shown either way.
 */
export function isLowSignalMessage(message: string): boolean {
  const lower = message.trim().toLowerCase()
  return (
    lower === '' ||
    lower === 'request failed' ||
    lower === 'internal server error' ||
    lower === 'bad gateway' ||
    lower === 'service unavailable' ||
    lower.includes('failed to fetch') ||
    lower.includes('edge function returned') ||
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html')
  )
}
