import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../client'
import { parseErrorEnvelope } from '../envelope'
import { HidApiError } from '../errors'

/**
 * hid-system 0094 (D-Eminence/hid-system#85, INTERFACE_CONTRACT.md section 6):
 * a problem may carry `fields`, field names to result codes and never a
 * submitted or stored value. `422 ASSISTED_VERIFICATION_NOT_MATCHED` sends
 * `{ firstName, lastName, dateOfBirth }`, each `match`, `no_match` or
 * `not_in_record`; staff need it to see which field differed.
 */
const NOT_MATCHED = {
  type: 'about:blank', title: 'Unprocessable Entity', status: 422,
  detail: 'The details on the document do not match the NIN record.',
  code: 'ASSISTED_VERIFICATION_NOT_MATCHED', correlationId: 'corr-422',
  fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' },
}

function client(response: Response) {
  const fetchImpl = vi.fn(async () => response)
  return createApiClient({ baseUrl: 'https://api.example.org', clientId: 'staff-web', sessionMode: 'cookie',
    fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} })
}

describe('problem fields', () => {
  it('reads the fields member of a problem', () => {
    expect(parseErrorEnvelope(NOT_MATCHED, { status: 422 }).fields)
      .toEqual({ firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' })
  })

  it('keeps the fields member on the error the client throws', async () => {
    const problem = new Response(JSON.stringify(NOT_MATCHED), { status: 422,
      headers: { 'Content-Type': 'application/problem+json' } })
    const error = await client(problem).post('/api/v1/identity/assisted-verifications', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HidApiError)
    expect(error).toMatchObject({ status: 422, code: 'ASSISTED_VERIFICATION_NOT_MATCHED',
      requestId: 'corr-422', fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' } })
  })

  it('is null when the problem has none', async () => {
    const problem = new Response(JSON.stringify({ status: 404, code: 'DESK_CODE_NOT_FOUND', detail: 'No registration.' }),
      { status: 404 })
    const error = await client(problem).post('/api/v1/identity/assisted-verifications', {}).catch((e: unknown) => e)
    expect((error as HidApiError).fields).toBeNull()
    expect(new HidApiError(503, 'Unavailable').fields).toBeNull()
  })

  it('keeps only names with a result code, never another shape', () => {
    expect(parseErrorEnvelope({ fields: ['firstName'] }, { status: 422 }).fields).toBeNull()
    expect(parseErrorEnvelope({ fields: 'no_match' }, { status: 422 }).fields).toBeNull()
    expect(parseErrorEnvelope({ fields: { firstName: 'match', lastName: { value: 'OKAFOR' }, dateOfBirth: 7 } },
      { status: 422 }).fields).toEqual({ firstName: 'match' })
    expect(parseErrorEnvelope({ fields: { lastName: { value: 'OKAFOR' } } }, { status: 422 }).fields).toBeNull()
    // A long code is not one either.
    expect(parseErrorEnvelope({ fields: { firstName: 'x'.repeat(65) } }, { status: 422 }).fields).toBeNull()
  })

  it('keeps only the contract\'s result codes, so a value shaped like a code never reaches a page', () => {
    // A registry surname, a date of birth or a first name fits a short-code pattern; none is a result code.
    expect(parseErrorEnvelope({ fields: { firstName: 'Chukwuemeka', lastName: 'OKAFOR', dateOfBirth: '1990-04-02' } },
      { status: 422 }).fields).toBeNull()
    expect(parseErrorEnvelope({ fields: { firstName: 'match', lastName: 'OKAFOR', dateOfBirth: 'not_in_record' } },
      { status: 422 }).fields).toEqual({ firstName: 'match', dateOfBirth: 'not_in_record' })
    // The words are exact: another case or a near word is not one of them.
    expect(parseErrorEnvelope({ fields: { firstName: 'MATCH', lastName: 'no-match', dateOfBirth: 'matched' } },
      { status: 422 }).fields).toBeNull()
  })

  it('leaves the fields out of the log summary', () => {
    const error = new HidApiError(422, 'Not matched', { code: 'ASSISTED_VERIFICATION_NOT_MATCHED',
      fields: { firstName: 'no_match' } })
    expect(error.fields).toEqual({ firstName: 'no_match' })
    expect(error.toLogContext()).not.toHaveProperty('fields')
  })
})

/**
 * Novu P4c: a receiving laboratory or pharmacy that enters the wrong Health ID or date of birth gets
 * `409 ORDER_ROUTE_PATIENT_MISMATCH` with `attemptsLeft`, the tries left before the order locks (5 in all).
 */
describe('problem attemptsLeft', () => {
  const MISMATCH = { type: 'about:blank', title: 'Conflict', status: 409, detail: 'The patient does not match.',
    code: 'ORDER_ROUTE_PATIENT_MISMATCH', correlationId: 'corr-409', attemptsLeft: 2 }

  it('keeps the tries left on the error the client throws', async () => {
    const problem = new Response(JSON.stringify(MISMATCH), { status: 409, headers: { 'Content-Type': 'application/problem+json' } })
    const error = await client(problem).post('/api/v1/lab/order-routes/9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e/accept', {})
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HidApiError)
    expect(error).toMatchObject({ status: 409, code: 'ORDER_ROUTE_PATIENT_MISMATCH', attemptsLeft: 2 })
  })

  it('is null when absent or not a small whole number', () => {
    expect(parseErrorEnvelope({ code: 'X' }, { status: 409 }).attemptsLeft).toBeNull()
    expect(parseErrorEnvelope({ attemptsLeft: 0 }, { status: 409 }).attemptsLeft).toBe(0)
    for (const value of [-1, 1.5, '2', 101, null, Number.NaN]) {
      expect(parseErrorEnvelope({ attemptsLeft: value }, { status: 409 }).attemptsLeft, String(value)).toBeNull()
    }
    expect(new HidApiError(409, 'Conflict').attemptsLeft).toBeNull()
  })
})

/**
 * D17 (hid-system 0090): `429 ORDER_ROUTE_CORRECTION_LIMIT` carries `retryAfter`, the ISO UTC time from which another late
 * withdrawal is possible (kept as `retryAt`: the `Retry-After` header stays the retry loop's), and support's review
 * refused with `400 WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED` carries `required`, the missing actions, comma-separated.
 */
describe('problem retryAfter and required', () => {
  const LIMIT = { type: 'about:blank', title: 'Too Many Requests', status: 429, detail: 'Limit reached.',
    code: 'ORDER_ROUTE_CORRECTION_LIMIT', correlationId: 'corr-429', retryAfter: '2026-10-27T09:14:03.218Z' }
  const REFERRAL = { status: 400, detail: 'Referral required.', code: 'WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED',
    required: 'referred_to_dpo,ordering_facility_told' }

  it('keeps the time on the error the client throws, beside the header the retry loop reads', async () => {
    const problem = new Response(JSON.stringify(LIMIT), { status: 429, headers: { 'Content-Type': 'application/problem+json' } })
    const error = await client(problem).post('/api/v1/lab/order-routes/9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e/wrong-patient-correction', {})
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HidApiError)
    expect(error).toMatchObject({ status: 429, code: 'ORDER_ROUTE_CORRECTION_LIMIT', retryAt: '2026-10-27T09:14:03.218Z' })
    expect(Object.keys(error as object)).not.toContain('retryAfter')
  })

  it('keeps the missing actions on the error, as codes', async () => {
    const problem = new Response(JSON.stringify(REFERRAL), { status: 400, headers: { 'Content-Type': 'application/problem+json' } })
    const error = await client(problem).post('/api/v1/admin/wrong-patient-reports/x/review', {}).catch((e: unknown) => e)
    expect((error as HidApiError).required).toEqual(['referred_to_dpo', 'ordering_facility_told'])
  })

  it('is null when absent, or not a time or codes', () => {
    expect(parseErrorEnvelope({ code: 'X' }, { status: 429 }).retryAt).toBeNull()
    expect(parseErrorEnvelope({ retryAfter: '2026-10-27T09:14:03Z' }, { status: 429 }).retryAt).toBe('2026-10-27T09:14:03Z')
    for (const value of ['2026-10-27', '2026-10-27T09:14:03+01:00', '2026-13-45T99:99:99Z', 'tomorrow', 42, null, ['x']]) {
      expect(parseErrorEnvelope({ retryAfter: value }, { status: 429 }).retryAt, String(value)).toBeNull()
    }
    expect(parseErrorEnvelope({ required: ['referred_to_dpo'] }, { status: 400 }).required).toEqual(['referred_to_dpo'])
    for (const value of ['', 'Referred to DPO', 'referred_to_dpo,', 'a,b,c,d,e,f,g,h,i', 7, { referred_to_dpo: true }, ['x', 3]]) {
      expect(parseErrorEnvelope({ required: value }, { status: 400 }).required, JSON.stringify(value)).toBeNull()
    }
    const error = new HidApiError(429, 'Limited')
    expect(error.retryAt).toBeNull()
    expect(error.required).toBeNull()
    expect(error.toLogContext()).not.toHaveProperty('required')
  })
})
