import { describe, expect, it } from 'vitest'
import { LIMITS } from '../contracts'
import { backoffMs } from '../outbox/backoff'
import { classify, isDefinitiveFirstRefusal, needsReceiptCheck } from '../outbox/classify'
import { nextState, sampleOf } from '../connectivity'

const E = '/api/v1/ehr/patients/p/encounters'

describe('failure classification (§2.8 table, every row)', () => {
  const rows: [string, Parameters<typeof classify>[0], ReturnType<typeof classify>][] = [
    ['2xx', { status: 201 }, 'applied'],
    ['200', { status: 200 }, 'applied'],
    ['network error', { status: null, networkError: true }, 'transient'],
    ['timeout 408', { status: 408 }, 'transient'],
    ['425', { status: 425 }, 'transient'],
    ['429', { status: 429 }, 'transient'],
    ['500', { status: 500 }, 'transient'],
    ['Worker 502 API_ORIGIN_UNAVAILABLE', { status: 502, code: 'API_ORIGIN_UNAVAILABLE', problem: true }, 'transient'],
    ['503 audit unavailable', { status: 503, code: 'AUDIT_UNAVAILABLE', problem: true }, 'transient'],
    ['409 REQUEST_IN_PROGRESS', { status: 409, code: 'REQUEST_IN_PROGRESS', problem: true }, 'transient'],
    ['document 409 CONFLICT', { status: 409, code: 'CONFLICT', problem: true, path: '/api/v1/ehr/documents/upload-intents' }, 'transient'],
    ['401', { status: 401, problem: true }, 'session'],
    ['403 STAFF_MFA_REQUIRED', { status: 403, code: 'STAFF_MFA_REQUIRED', problem: true }, 'session'],
    ['403 CONSENT_REQUIRED', { status: 403, code: 'CONSENT_REQUIRED', problem: true }, 'access'],
    ['403 ACCESS_DENIED', { status: 403, code: 'ACCESS_DENIED', problem: true }, 'access'],
    ['403 PERMISSION_DENIED', { status: 403, code: 'PERMISSION_DENIED', problem: true }, 'access'],
    ['403 not problem+json (WAF)', { status: 403, problem: false }, 'edge'],
    ['413', { status: 413 }, 'edge'],
    ['400 BAD_REQUEST', { status: 400, code: 'BAD_REQUEST', problem: true }, 'invalid'],
    ['400 INVALID_CLINICAL_DATA', { status: 400, code: 'INVALID_CLINICAL_DATA', problem: true }, 'invalid'],
    ['400 IDEMPOTENCY_KEY_REQUIRED', { status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED', problem: true }, 'invalid'],
    ['409 IDEMPOTENCY_KEY_REUSED', { status: 409, code: 'IDEMPOTENCY_KEY_REUSED', problem: true }, 'invalid'],
    ['409 IDEMPOTENCY_RESULT_UNAVAILABLE', { status: 409, code: 'IDEMPOTENCY_RESULT_UNAVAILABLE', problem: true }, 'applied-unreadable'],
    ['404 ENCOUNTER_NOT_FOUND', { status: 404, code: 'ENCOUNTER_NOT_FOUND', problem: true }, 'missing'],
    ['412 VERSION_CONFLICT', { status: 412, code: 'VERSION_CONFLICT', problem: true }, 'version'],
    ['409 INVALID_ENCOUNTER_TRANSITION', { status: 409, code: 'INVALID_ENCOUNTER_TRANSITION', problem: true }, 'state'],
    ['409 CLINICAL_CONFLICT', { status: 409, code: 'CLINICAL_CONFLICT', problem: true }, 'state'],
    ['409 INVALID_CLINICAL_REFERENCE', { status: 409, code: 'INVALID_CLINICAL_REFERENCE', problem: true }, 'state'],
    ['409 CONFLICT on a clinical path is not transient', { status: 409, code: 'CONFLICT', problem: true, path: E }, 'state'],
  ]
  for (const [name, answer, cls] of rows) {
    it(name, () => expect(classify(answer)).toBe(cls))
  }

  it('asks for a receipt before a non-transient refusal of a command sent before', () => {
    for (const cls of ['access', 'edge', 'invalid', 'missing', 'version', 'state', 'applied-unreadable'] as const) {
      expect(needsReceiptCheck(cls, true)).toBe(true)
    }
    expect(needsReceiptCheck('transient', true)).toBe(false)
    expect(needsReceiptCheck('session', true)).toBe(false)
    expect(needsReceiptCheck('access', false)).toBe(false)
  })

  it('knows which first refusals prove nothing was applied', () => {
    expect(isDefinitiveFirstRefusal({ status: 400 })).toBe(true)
    expect(isDefinitiveFirstRefusal({ status: 403, code: 'CONSENT_REQUIRED', problem: true })).toBe(true)
    expect(isDefinitiveFirstRefusal({ status: 404 })).toBe(true)
    expect(isDefinitiveFirstRefusal({ status: 409, code: 'CLINICAL_CONFLICT' })).toBe(true)
    expect(isDefinitiveFirstRefusal({ status: 412 })).toBe(true)
    expect(isDefinitiveFirstRefusal({ status: 409, code: 'REQUEST_IN_PROGRESS' })).toBe(false)
    expect(isDefinitiveFirstRefusal({ status: 403, code: 'STAFF_MFA_REQUIRED', problem: true })).toBe(false)
    expect(isDefinitiveFirstRefusal({ status: 503 })).toBe(false)
  })
})

describe('backoff', () => {
  it('is full jitter of min(300 s, 2 s × 2^(attempts−1))', () => {
    expect(backoffMs(1, () => 1)).toBe(2000)
    expect(backoffMs(3, () => 1)).toBe(8000)
    expect(backoffMs(20, () => 1)).toBe(LIMITS.backoffCapMs)
    expect(backoffMs(5, () => 0)).toBe(0)
    expect(backoffMs(5, () => 0.5)).toBe(16000)
  })
  it('a server hint wins', () => {
    expect(backoffMs(1, () => 1, 45_000)).toBe(45_000)
  })
})

describe('connectivity debounce', () => {
  it('needs three failures to go offline and three successes to come back', () => {
    expect(nextState('online', ['fail'])).toBe('reconnecting')
    expect(nextState('reconnecting', ['fail', 'fail'])).toBe('reconnecting')
    expect(nextState('reconnecting', ['fail', 'fail', 'fail'])).toBe('offline')
    expect(nextState('offline', ['fail', 'fail', 'ok'])).toBe('reconnecting')
    expect(nextState('reconnecting', ['fail', 'ok', 'ok'])).toBe('reconnecting')
    expect(nextState('reconnecting', ['ok', 'ok', 'ok'])).toBe('online')
    expect(nextState('online', ['slow', 'slow', 'slow'])).toBe('slow')
    expect(nextState('slow', ['slow', 'slow', 'ok'])).toBe('online')
  })
  it('reads a 502 from the Worker and a network error as unreachable', () => {
    const base = { method: 'GET', path: '/x', date: null, problem: true, code: null, networkError: false, authenticated: true }
    expect(sampleOf({ ...base, status: null, networkError: true })).toBe('fail')
    expect(sampleOf({ ...base, status: 502, code: 'API_ORIGIN_UNAVAILABLE' })).toBe('fail')
    expect(sampleOf({ ...base, status: 404 })).toBe('ok')
  })
})
