import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.test' }) }))

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

/** The staff API with a session in use and ready, as the provider portal sets it once signed in: protected requests wait for that. */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

const PATIENT = '11111111-1111-4111-8111-111111111111'
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const reply = {
  status: 'answered', answer: 'The last blood pressure was 118 over 76.', conversationId: id(2), messageId: id(3),
  createdAt: '2026-10-17T10:00:00.000Z', idempotentReplay: false,
  blocks: [{ kind: 'record', text: 'The last blood pressure was 118 over 76.', references: [1] }],
  sources: [{ number: 1, kind: 'vital', id: id(4), recordedOn: '2026-10-01', effectiveOn: null, title: 'Vital signs' }],
  coverage: { complete: true, released: ['encounters', 'notes', 'vitals'], withheld: ['labRequests', 'labResults'], truncated: false, selectedCount: 1, recordCount: 1 },
}

/** Staff record chat as hid-system main serves it (ADR-069, 0101): the patient in the path, the facility and direct care in headers. */
describe('staff record chat requests', () => {
  it('reads availability for the patient with the facility and direct-care purpose, naming what is withheld', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ available: true, processor: 'anthropic', inferenceGeo: 'us', noticeVersion: 'ADR-069@2026-10-17',
      historyLimit: 50, maxQuestionLength: 1000, released: ['encounters', 'notes'], withheld: ['vitals', 'labRequests', 'labResults'] }))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    const value = await staffApi.recordChatAvailability('facility-a', PATIENT)
    expect(value).toEqual({ available: true, noticeVersion: 'ADR-069@2026-10-17', historyLimit: 50, maxQuestionLength: 1000,
      released: ['encounters', 'notes'], withheld: ['vitals', 'labRequests', 'labResults'] })
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/chat/availability`)
    const headers = new Headers(options.headers)
    expect([options.method ?? 'GET', headers.get('X-Facility-ID'), headers.get('X-Purpose-Of-Use'), options.credentials]).toEqual(['GET', 'facility-a', 'direct-care', 'include'])
  })

  it('reads an answer that is off as { available: false }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ available: false })))
    const { staffApi } = await signedInStaffApi()
    expect(await staffApi.recordChatAvailability('facility-a', PATIENT)).toEqual({ available: false })
  })

  it('posts a question with the notice version and an Idempotency-Key, and reads the served answer', async () => {
    const fetch = vi.fn().mockResolvedValue(json(reply))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    const key = 'staff-chat-key-0000000001'
    const answer = await staffApi.recordChat('facility-a', PATIENT, '  What was the blood pressure?  ', { noticeVersion: 'ADR-069@2026-10-17', idempotencyKey: key })
    expect(answer).toMatchObject({ status: 'answered', messageId: id(3), sources: [{ number: 1, kind: 'vital' }] })
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/chat`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(String(options.body))).toEqual({ question: 'What was the blood pressure?', noticeVersion: 'ADR-069@2026-10-17' })
    const headers = new Headers(options.headers)
    expect([headers.get('Idempotency-Key'), headers.get('X-Facility-ID'), headers.get('X-Purpose-Of-Use')]).toEqual([key, 'facility-a', 'direct-care'])
  })

  it('refuses a question the service would refuse before sending it, and an answer that is not the served shape', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: 'ready', answer: 'Staging shape', sources: [] }))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    const ask = { noticeVersion: 'n-1', idempotencyKey: 'staff-chat-key-0000000001' }
    await expect(staffApi.recordChat('facility-a', PATIENT, '   ', ask)).rejects.toThrow(/1 to 1000 characters/)
    await expect(staffApi.recordChat('facility-a', PATIENT, 'a\u0000b', ask)).rejects.toThrow(/1 to 1000 characters/)
    await expect(staffApi.recordChat('facility-a', PATIENT, 'x'.repeat(1001), ask)).rejects.toThrow(/1 to 1000 characters/)
    expect(fetch).not.toHaveBeenCalled()
    await expect(staffApi.recordChat('facility-a', PATIENT, 'What was it?', ask)).rejects.toThrow(/invalid/i)
  })

  it('reads and deletes the history of this patient at this facility, without deduplication', async () => {
    const fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => Promise.resolve(options.method === 'DELETE'
      ? json({ cleared: true, deletedCount: 2 }) : json({ conversationId: id(2), limit: 50, exchanges: [
        { messageId: id(3), question: 'Q', createdAt: '2026-10-17T10:00:00.000Z',
          reply: { status: 'answered', answer: 'A', blocks: [{ kind: 'explanation', text: 'A', references: [] }], sources: [] } }] })))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    expect((await staffApi.recordChatHistory('facility-a', PATIENT)).exchanges).toHaveLength(1)
    await staffApi.recordChatHistory('facility-b', PATIENT)
    expect(await staffApi.clearRecordChatHistory('facility-a', PATIENT)).toEqual({ cleared: true, deletedCount: 2 })
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [url, options] of fetch.mock.calls) {
      expect(new URL(String(url)).pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/chat/history`)
      expect(new Headers(options.headers).get('X-Purpose-Of-Use')).toBe('direct-care')
    }
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('X-Facility-ID')).toBe('facility-b')
    expect(fetch.mock.calls[2]![1].method).toBe('DELETE')
  })

  it('leaves the staging chat calls as they were, and never asks for a source it cannot open on main', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    expect(typeof staffApi.patientChat).toBe('function')
    expect(typeof staffApi.patientChatSource).toBe('function')
    expect(fetch).not.toHaveBeenCalled()
  })
})
