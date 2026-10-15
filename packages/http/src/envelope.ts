/**
 * Response envelope handling.
 *
 * hid-system returns RFC 7807 style Problem Details containing `detail`,
 * `code`, `correlationId`, and optional field `errors`; from 0094 a problem
 * may also carry `fields`, field names to short result codes. The historical bearer
 * transport also used a legacy envelope, which remains readable here.
 *
 * This module reads both without guessing at anything else, and is the only
 * place in the frontend that knows the wire shape.
 */

import { fallbackMessageForStatus } from './errors'

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
  readonly message: string
  readonly code: string | null
  readonly requestId: string | null
  readonly retryable: boolean | null
  readonly details: unknown
  /** Field names to short result codes; null when the problem has none. */
  readonly fields: Readonly<Record<string, string>> | null
}

/** A result code is a short machine code such as `no_match`; anything longer is not one. */
const RESULT_CODE = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * The problem's `fields` member (hid-system 0094, INTERFACE_CONTRACT.md
 * section 6): an object of field names to short result codes, never a
 * submitted or stored value. Only names with such a code are kept, so a
 * later or malformed shape cannot carry a value into a page.
 */
function readFields(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null
  const fields: Record<string, string> = {}
  for (const [name, code] of Object.entries(value)) {
    if (typeof code === 'string' && RESULT_CODE.test(code)) fields[name] = code
  }
  return Object.keys(fields).length > 0 ? Object.freeze(fields) : null
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

  const message =
    readNonEmptyString(record?.detail) ??
    readNonEmptyString(record?.message) ??
    readNonEmptyString(nested?.message) ??
    readNonEmptyString(record?.error) ??
    fallbackMessageForStatus(options.status)

  const retryableValue = record?.retryable ?? nested?.retryable

  return {
    status: options.status,
    message,
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
  }
}

/**
 * Rejects messages that are transport noise rather than something a user can
 * act on, so the caller can substitute a status-appropriate fallback.
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
