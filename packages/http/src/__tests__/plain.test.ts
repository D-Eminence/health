import { describe, expect, it } from 'vitest'
import { HidApiError } from '../errors'
import { PLAIN, PlainError, isConnectionFailure, plainErrorText, plainStatusText } from '../plain'

const FALLBACK = 'We couldn’t save this note. Try again.'

/** Server free text, codes, ids and JavaScript messages that must never reach a screen. */
const INTERNAL = /Cannot GET|\/api\/v1|identity-api|staff-web|patient-web|workforce|CSRF|VALIDATION_FAILED|FORBIDDEN|hid_web_|abc-123|TypeError|Failed to fetch|undefined|\b4\d\d\b|\b5\d\d\b|UUID|row version|token|payload/i

function apiError(status: number, code?: string, detail = 'Cannot GET /api/v1/identity/me (identity-api, staff-web, CSRF)') {
  return new HidApiError(status, detail, { code, detail, requestId: 'hid_web_3f2a', details: [{ field: 'expectedRowVersion', messages: ['must be a UUID'] }] })
}

describe('plainErrorText', () => {
  it('uses the page’s own words for a code it knows, then for a status', () => {
    expect(plainErrorText(apiError(409, 'NIN_ALREADY_REGISTERED'), FALLBACK, { codes: { NIN_ALREADY_REGISTERED: 'This person already has a Health ID.' } }))
      .toBe('This person already has a Health ID.')
    expect(plainErrorText(apiError(401, 'UNAUTHENTICATED'), FALLBACK, { statuses: { 401: 'That email or password isn’t right. Try again.' } }))
      .toBe('That email or password isn’t right. Try again.')
  })

  it('says the failures every page shares in the same plain words', () => {
    expect(plainErrorText(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }), FALLBACK)).toBe(PLAIN.network)
    expect(plainErrorText(new HidApiError(408, 'x', { code: 'REQUEST_TIMEOUT' }), FALLBACK)).toBe(PLAIN.timeout)
    expect(plainErrorText(apiError(401, 'AUTHENTICATION_REQUIRED'), FALLBACK)).toBe(PLAIN.signedOut)
    expect(plainErrorText(apiError(403, 'FORBIDDEN'), FALLBACK)).toBe(PLAIN.noAccess)
    expect(plainErrorText(apiError(403, 'FORBIDDEN'), FALLBACK, { audience: 'facility' })).toBe(PLAIN.noAccessFacility)
    expect(plainErrorText(apiError(404, 'API_ROUTE_NOT_FOUND'), FALLBACK)).toBe(PLAIN.notFound)
    expect(plainErrorText(apiError(429, 'RATE_LIMITED'), FALLBACK)).toBe(PLAIN.tooMany)
    expect(plainErrorText(apiError(413, 'DOCUMENT_TOO_LARGE'), FALLBACK)).toBe(PLAIN.tooLarge)
    expect(plainErrorText(apiError(412, 'PRECONDITION_FAILED'), FALLBACK)).toBe(PLAIN.changed)
    expect(plainErrorText(apiError(409, 'ENCOUNTER_VERSION_CONFLICT'), FALLBACK)).toBe(PLAIN.changed)
    expect(plainErrorText(apiError(503, 'SERVICE_UNAVAILABLE'), FALLBACK)).toBe(PLAIN.unavailable)
    expect(plainErrorText(new HidApiError(0, 'x', { code: 'REQUEST_CANCELLED' }), FALLBACK)).toBe(PLAIN.stopped)
    expect(plainErrorText(apiError(403, 'TURNSTILE_EXPIRED_OR_REPLAYED'), FALLBACK)).toBe(PLAIN.securityCheck)
  })

  it('keeps the page’s fallback for a refusal it has no words for', () => {
    expect(plainErrorText(apiError(400, 'VALIDATION_FAILED'), FALLBACK)).toBe(FALLBACK)
    expect(plainErrorText(apiError(422, 'SOMETHING_NEW'), FALLBACK)).toBe(FALLBACK)
    expect(plainErrorText(apiError(409, 'LAB_ORDER_PATIENT_MISMATCH'), FALLBACK)).toBe(FALLBACK)
  })

  it('never shows server text, a code, a status, a correlation id or a JavaScript message', () => {
    const caught: unknown[] = [
      ...[0, 400, 401, 403, 404, 408, 409, 410, 412, 422, 429, 500, 502, 503, 504].map(status => apiError(status, 'FORBIDDEN')),
      new TypeError('Failed to fetch'),
      new TypeError('Cannot read properties of undefined (reading \'id\')'),
      new SyntaxError('Unexpected token < in JSON at position 0'),
      new Error('"staff-web" may not call the "ocr" service (endpoint "ocr.jobs").'),
      new DOMException('Aborted', 'AbortError'),
      'TypeError: undefined', null, undefined, { message: 'Cannot GET /api/v1/x' },
    ]
    for (const error of caught) {
      const text = plainErrorText(error, FALLBACK)
      expect(text, String(error)).not.toMatch(INTERNAL)
    }
  })

  it('recognises a browser’s own words for a request that never left as no connection', () => {
    expect(plainErrorText(new TypeError('Failed to fetch'), FALLBACK)).toBe(PLAIN.network)
    expect(plainErrorText(new TypeError('NetworkError when attempting to fetch resource.'), FALLBACK)).toBe(PLAIN.network)
    expect(plainErrorText(new TypeError('Load failed'), FALLBACK)).toBe(PLAIN.network)
    expect(isConnectionFailure(new TypeError('Cannot read properties of undefined'))).toBe(false)
    expect(plainErrorText(new TypeError('Cannot read properties of undefined'), FALLBACK)).toBe(FALLBACK)
  })

  it('shows a PlainError’s words, written for people on purpose, and no other error’s message', () => {
    expect(plainErrorText(new PlainError('Select a facility first.'), FALLBACK)).toBe('Select a facility first.')
    expect(plainErrorText(new Error('Select a facility first.'), FALLBACK)).toBe(FALLBACK)
    expect(plainErrorText(new PlainError(''), FALLBACK)).toBe(FALLBACK)
  })
})

describe('plainStatusText', () => {
  it('has a plain sentence for every status, with no number, code or technical word in it', () => {
    for (const status of [0, 400, 401, 403, 404, 408, 409, 410, 412, 413, 418, 422, 429, 500, 502, 503, 504]) {
      const text = plainStatusText(status)
      expect(text, String(status)).not.toMatch(INTERNAL)
      expect(text, String(status)).not.toMatch(/request|service|response|state|conflict|permission|invalid/i)
    }
    expect(plainStatusText(403, 'facility')).toBe(PLAIN.noAccessFacility)
  })
})
