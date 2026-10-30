/**
 * Adapter from the app's @hid/http ApiClient (the staff transport) to the
 * OfflineTransport the core sends through. Every request still goes through
 * the client (NO_RAW_FETCH stays); the per-request onResponseMeta gives the
 * exact status, Date and problem flag of the attempt.
 */

import { HidApiError, NO_RETRY, retryAfterSeconds, type ApiClient, type ResponseMeta } from '@hid/http'
import { TransportError, type OfflineTransport } from './types'

export function transportFromApiClient(client: ApiClient): OfflineTransport {
  return async spec => {
    let meta: ResponseMeta | null = null
    try {
      const body = await client.request<unknown>({
        method: spec.method,
        path: spec.path,
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
        ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        ...(spec.signal ? { signal: spec.signal } : {}),
        auth: spec.auth ?? 'required',
        // The outbox owns retries and backoff; the transport makes exactly one attempt.
        retry: NO_RETRY,
        dedupe: false,
        onResponseMeta: m => { meta = m },
      })
      const m = meta as ResponseMeta | null
      return { status: m?.status ?? 200, body, date: m?.date ?? null }
    } catch (error) {
      const m = meta as ResponseMeta | null
      if (error instanceof HidApiError) {
        const seconds = retryAfterSeconds(error)
        const retryAfterMs = seconds !== null ? seconds * 1000
          : error.retryAt ? Math.max(0, Date.parse(error.retryAt) - Date.now()) : null
        const noAnswer = error.status === 0 || error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_CANCELLED'
        throw new TransportError({
          status: noAnswer ? null : error.status,
          code: m?.code ?? error.code,
          problem: m?.problem ?? false,
          networkError: m?.networkError ?? noAnswer,
          retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null,
          // The refusal's code, field result codes and details (field errors), so a first-attempt 400
          // VALIDATION_FAILED marks the refused fields as the online path does (A11.2).
          body: { code: error.code, fields: error.fields, details: error.details },
          message: error.message,
        })
      }
      throw new TransportError({ status: null, networkError: true })
    }
  }
}
