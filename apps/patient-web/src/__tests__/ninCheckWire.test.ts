import { formatTime } from '@hid/ui/display'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient, HidApiError } from '@hid/http'
import { createPatientApi } from '../api'
import { registrationErrorText } from '../staff/registrationFlow'
import {
  NIN_CHECK_TIMEOUT_MS, NIN_DETAILS_CHECK, NIN_HELD_FEW_MINUTES, NIN_IN_PROGRESS, NIN_NOT_VERIFIED_TEXT, NIN_TAKING_LONGER, ninCheckProblem,
  ninHeldText,
} from '../ninCheck'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

/*
 * The three NIN check requests wait at least 15 s for Identity (which waits up to its QoreID timeout, 12 s to 20 s, and a
 * second request for the same NIN that long plus 3 s), and every other request keeps the client's usual 15 s. Every
 * number here is fictional: NIN 12345678901, Patient One.
 */

const NIN = '12345678901'
const FACILITY = 'f0000000-0000-4000-8000-000000000001'

interface Pending { path: string; signal: AbortSignal | null; headers: Headers }

/** A fetch that never answers, and records each request's signal so the test can see when the client gives up. */
function silentFetch() {
  const pending: Pending[] = []
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    pending.push({ path: new URL(String(input)).pathname, signal: init?.signal ?? null, headers: new Headers(init?.headers) })
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  }) as typeof fetch
  return { pending, fetchImpl }
}

function patientApi(fetchImpl: typeof fetch) {
  return createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl, sleep: async () => {},
  }), 'patient-web'))
}

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/** Lets the request reach fetch, then moves the clock on by `ms`. */
async function after(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('how long a NIN check waits', () => {
  it('waits 30 s, never less than 15 s', () => {
    expect(NIN_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000)
    expect(NIN_CHECK_TIMEOUT_MS).toBe(30_000)
  })

  it.each([
    ['the sign-up NIN start', '/api/v1/identity/patient-enrollments',
      (api: ReturnType<typeof createPatientApi>) => api.enrollmentStart(NIN, 'turnstile-token', 'a0000000-0000-4000-8000-00000000000a')],
    ['the profile Verify NIN', '/api/v1/identity/me/verification/nin',
      (api: ReturnType<typeof createPatientApi>) => api.verifyNin(NIN, '1990-01-02', 'a0000000-0000-4000-8000-00000000000b')],
  ])('%s is not given up at 15 s, and is at 30 s as taking too long', async (_name, path, send) => {
    vi.useFakeTimers()
    const { pending, fetchImpl } = silentFetch()
    const answer = send(patientApi(fetchImpl)).catch((caught: unknown) => caught)
    await after(15_001)
    expect(pending.map(request => request.path)).toEqual([path])
    expect(pending[0]!.signal?.aborted).toBe(false)
    await after(14_000)
    expect(pending[0]!.signal?.aborted).toBe(false)
    await after(1_000)
    const caught = await answer
    expect(caught).toBeInstanceOf(HidApiError)
    expect((caught as HidApiError).code).toBe('REQUEST_TIMEOUT')
    // Sent once: a POST is never retried by the client, so the same check is not asked for twice.
    expect(pending).toHaveLength(1)
    expect(ninCheckProblem(caught)?.text).toBe(NIN_TAKING_LONGER)
  })

  it('the profile Verify NIN sends the Idempotency-Key it is given', async () => {
    vi.useFakeTimers()
    const { pending, fetchImpl } = silentFetch()
    void patientApi(fetchImpl).verifyNin(NIN, '1990-01-02', 'a0000000-0000-4000-8000-00000000000c').catch(() => {})
    await after(0)
    expect(pending[0]!.headers.get('Idempotency-Key')).toBe('a0000000-0000-4000-8000-00000000000c')
    await after(NIN_CHECK_TIMEOUT_MS)
  })

  it('another patient request keeps the usual 15 s', async () => {
    vi.useFakeTimers()
    const { pending, fetchImpl } = silentFetch()
    const answer = patientApi(fetchImpl).enrollmentContact('email', 'patient.one@example.test').catch((caught: unknown) => caught)
    await after(15_001)
    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(((await answer) as HidApiError).code).toBe('REQUEST_TIMEOUT')
  })

  it('the desk NIN check is not given up at 15 s, and is at 30 s; the case read keeps 15 s', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const { pending, fetchImpl } = silentFetch()
    // The staff client binds fetch when its module loads, so it is loaded afresh here, before the clock is faked.
    vi.stubGlobal('fetch', fetchImpl)
    const { setStaffSessionReady } = await import('../staff/session')
    setStaffSessionReady(true)
    const { staffApi } = await import('../staff/api')
    vi.useFakeTimers()
    const answer = staffApi.resolveNin(FACILITY, { nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02',
      phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: false, existingHealthId: null },
      'a0000000-0000-4000-8000-00000000000d').catch((caught: unknown) => caught)
    await after(15_001)
    expect(pending.map(request => request.path)).toEqual(['/api/v1/identity/nin/resolve'])
    expect(pending[0]!.signal?.aborted).toBe(false)
    expect(pending[0]!.headers.get('Idempotency-Key')).toBe('a0000000-0000-4000-8000-00000000000d')
    await after(15_000)
    expect(((await answer) as HidApiError).code).toBe('REQUEST_TIMEOUT')
    expect(pending).toHaveLength(1)

    // A read is retried after its wait ends (the client's read policy), so only its first wait is looked at.
    void staffApi.registrationCase(FACILITY, 'c0000000-0000-4000-8000-000000000001').catch(() => {})
    await after(15_001)
    expect(pending[1]!.path).toBe('/api/v1/identity/registration-cases/c0000000-0000-4000-8000-000000000001')
    expect(pending[1]!.signal?.aborted).toBe(true)
  })
})

describe('Identity’s answers for a NIN check it could not finish, in plain words', () => {
  const NOW = new Date(2026, 10, 18, 14, 20, 0).getTime()

  it.each([
    [new HidApiError(409, 'x', { code: 'NIN_CHECK_IN_PROGRESS', retryInSeconds: 60 }), 'in_progress', NIN_IN_PROGRESS],
    [new HidApiError(504, 'x', { code: 'QOREID_TIMEOUT', retryInSeconds: 60 }), 'taking_longer', NIN_TAKING_LONGER],
    // A gateway's own 504, and this client's own wait ending, say the same.
    [new HidApiError(504, 'x'), 'taking_longer', NIN_TAKING_LONGER],
    [new HidApiError(0, 'x', { code: 'REQUEST_TIMEOUT' }), 'taking_longer', NIN_TAKING_LONGER],
    [new HidApiError(400, 'x', { code: 'NIN_DETAILS_INVALID' }), 'details', NIN_DETAILS_CHECK],
    [new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD' }), 'held', NIN_HELD_FEW_MINUTES],
    // Owner Q117: a NIN QoreID has no record of, on sign-up, the profile and the desk.
    [new HidApiError(422, 'x', { code: 'NIN_NOT_VERIFIED' }), 'not_verified', 'This NIN could not be verified. Check the number and try again.'],
  ])('%s', (caught, outcome, text) => {
    expect(ninCheckProblem(caught, NOW)).toMatchObject({ outcome, text })
  })

  it('a held NIN says the time to try again, in the person’s time zone, rounded up to the minute', () => {
    const problem = ninCheckProblem(new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD', retryInSeconds: 290 }), NOW)
    expect(problem?.heldUntil).toBe(NOW + 290_000)
    const clock = formatTime(new Date(2026, 10, 18, 14, 25, 0))
    expect(problem?.text).toBe(`This NIN check is on hold. Try again after ${clock}.`)
    // Six hours on, past midnight: said as tomorrow.
    expect(ninHeldText(new Date(2026, 10, 19, 2, 0, 0).getTime(), new Date(2026, 10, 18, 20, 0, 0).getTime())).toMatch(/ tomorrow\.$/)
  })

  it('leaves every other refusal to the screen, and no text has a code, a status or a dash', () => {
    expect(ninCheckProblem(new HidApiError(409, 'x', { code: 'NIN_ALREADY_REGISTERED' }), NOW)).toBeNull()
    expect(ninCheckProblem(new Error('x'), NOW)).toBeNull()
    // Only that exact code: the desk's "does not match", and the same code at another status, are left to the screen.
    expect(ninCheckProblem(new HidApiError(422, 'x', { code: 'NIN_VERIFICATION_FAILED' }), NOW)).toBeNull()
    expect(ninCheckProblem(new HidApiError(400, 'x', { code: 'NIN_NOT_VERIFIED' }), NOW)).toBeNull()
    expect(ninCheckProblem(new HidApiError(502, 'x', { code: 'QOREID_PROVIDER_REJECTED' }), NOW)).toBeNull()
    for (const text of [NIN_IN_PROGRESS, NIN_TAKING_LONGER, NIN_HELD_FEW_MINUTES, NIN_DETAILS_CHECK, NIN_NOT_VERIFIED_TEXT, ninHeldText(NOW, NOW)]) {
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]+|\b\d{3}\b|[\u2013\u2014]|unverified/)
    }
  })
})

describe('the other desk screens that check a NIN (today’s Registration page, a walk-in’s New Health ID)', () => {
  it.each([
    ['NIN_CHECK_IN_PROGRESS', 409, NIN_IN_PROGRESS], ['NIN_CHECK_HELD', 409, NIN_HELD_FEW_MINUTES],
    ['QOREID_TIMEOUT', 504, NIN_TAKING_LONGER], ['NIN_DETAILS_INVALID', 400, NIN_DETAILS_CHECK],
    ['NIN_NOT_VERIFIED', 422, NIN_NOT_VERIFIED_TEXT],
  ])('say %s in the same plain words', (code, status, text) => {
    expect(registrationErrorText(new HidApiError(status, 'x', { code }), 'NIN verification could not be completed.')).toBe(text)
  })

  it('keep their own words for a name or date of birth that does not match (422 NIN_VERIFICATION_FAILED)', () => {
    expect(registrationErrorText(new HidApiError(422, 'x', { code: 'NIN_VERIFICATION_FAILED' }), 'NIN verification could not be completed.'))
      .toBe('NIN verification could not be completed.')
  })
})
