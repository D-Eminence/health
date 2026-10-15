import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../client'
import { parseErrorEnvelope } from '../envelope'
import { HidApiError } from '../errors'

/**
 * hid-system 0094 (D-Eminence/hid-system#85, INTERFACE_CONTRACT.md section 6):
 * a problem may carry `fields`, field names to short result codes and never a
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

  it('keeps only names with a short code, never another shape', () => {
    expect(parseErrorEnvelope({ fields: ['firstName'] }, { status: 422 }).fields).toBeNull()
    expect(parseErrorEnvelope({ fields: 'no_match' }, { status: 422 }).fields).toBeNull()
    expect(parseErrorEnvelope({ fields: { firstName: 'match', lastName: { value: 'OKAFOR' }, dateOfBirth: 7 } },
      { status: 422 }).fields).toEqual({ firstName: 'match' })
    expect(parseErrorEnvelope({ fields: { lastName: { value: 'OKAFOR' } } }, { status: 422 }).fields).toBeNull()
    // A result code is a short machine code; anything longer is not one.
    expect(parseErrorEnvelope({ fields: { firstName: 'x'.repeat(65) } }, { status: 422 }).fields).toBeNull()
  })

  it('leaves the fields out of the log summary', () => {
    const error = new HidApiError(422, 'Not matched', { code: 'ASSISTED_VERIFICATION_NOT_MATCHED',
      fields: { firstName: 'no_match' } })
    expect(error.fields).toEqual({ firstName: 'no_match' })
    expect(error.toLogContext()).not.toHaveProperty('fields')
  })
})
