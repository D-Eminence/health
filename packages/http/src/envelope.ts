/**
 * Response envelope handling.
 *
 * The Health ID backend's shared HTTP layer returns errors as a JSON object
 * carrying `code`, `message`, `requestId`, `retryable` and `status`, and sets
 * `X-Request-ID` on every response. Successful payloads are sometimes wrapped
 * in `{ data: ... }` and sometimes returned bare.
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
      readNonEmptyString(record?.requestId) ??
      readNonEmptyString(record?.request_id) ??
      readNonEmptyString(options.headerRequestId),
    retryable: typeof retryableValue === 'boolean' ? retryableValue : null,
    details: record && Object.prototype.hasOwnProperty.call(record, 'details') ? record.details : null,
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
