import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

/*
 * POST identity/patients/:patientId/nin (hid-system 0138, docs/INTERFACE_CONTRACT.md ID-6 "Verify NIN later"): the
 * path, the facility and purpose headers, the Idempotency-Key, the exact body, and the NIN check's longer wait. Every
 * value here is fictional.
 */

const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const PATIENT = 'a0000000-0000-4000-8000-0000000000f1'
const KEY = 'a0000000-0000-4000-8000-0000000000f2'
const NIN = '00000000000'

afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

async function client() {
  document.cookie = 'hid_access_csrf=csrf-1'
  const { setStaffSessionReady } = await import('../staff/session')
  setStaffSessionReady(true)
  return (await import('../staff/api')).staffApi
}

describe('linkPatientNin', () => {
  it('posts exactly the NIN and the purpose for healthcare operations, with the key it is given, and no NIN in the address', async () => {
    const sent: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
    const answer = { patientId: PATIENT, outcome: 'nin_linked', ninStatus: 'verified', message: 'NIN Verified.', replayed: false }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const staffApi = await client()
    expect(await staffApi.linkPatientNin(FACILITY, PATIENT, NIN, KEY)).toEqual(answer)
    expect(sent).toHaveLength(1)
    const [request] = sent
    expect(new URL(request!.url).pathname).toBe(`/api/v1/identity/patients/${PATIENT}/nin`)
    expect(new URL(request!.url).search).toBe('')
    expect(request!.url).not.toContain(NIN)
    expect(request!.method).toBe('POST')
    expect(request!.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(request!.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    expect(request!.headers.get('Idempotency-Key')).toBe(KEY)
    expect(request!.body).toEqual({ nin: NIN, purpose: 'healthcare-operations' })
  })

  it('waits up to 30 seconds for the NIN check, not the usual 15, and does not send it again by itself', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const staffApi = await client()
    const outcome = staffApi.linkPatientNin(FACILITY, PATIENT, NIN, KEY).then(() => 'answered', () => 'failed')
    await vi.advanceTimersByTimeAsync(16_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await outcome).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
