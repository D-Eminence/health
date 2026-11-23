import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

/*
 * POST identity/registration-cases/without-nin (hid-system 0130, docs/INTERFACE_CONTRACT.md ID-2): the path, the
 * facility and purpose headers, the Idempotency-Key, and the body with `purpose`. Every value here is fictional.
 */

const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const KEY = 'a0000000-0000-4000-8000-0000000000e1'

afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('registerWithoutNin', () => {
  it('posts the details for healthcare operations at the facility, with the key it is given, and no Health ID in the address', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const sent: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
    const answer = { caseId: 'c0000000-0000-4000-8000-0000000000e1', status: 'review_required', version: 1, outcome: 'sent_for_review',
      identityEvidence: 'none', ninStatus: 'not_verified', replayed: false }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(answer), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }))
    const { setStaffSessionReady } = await import('../staff/session')
    setStaffSessionReady(true)
    const { staffApi } = await import('../staff/api')
    const result = await staffApi.registerWithoutNin(FACILITY, { firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02',
      noNinReason: 'not_carried', phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: true, existingHealthId: 'HID-ABC234' }, KEY)
    expect(result).toEqual(answer)
    expect(sent).toHaveLength(1)
    const [request] = sent
    expect(new URL(request!.url).pathname).toBe('/api/v1/identity/registration-cases/without-nin')
    expect(new URL(request!.url).search).toBe('')
    expect(request!.url).not.toContain('HID-')
    expect(request!.method).toBe('POST')
    expect(request!.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(request!.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    expect(request!.headers.get('Idempotency-Key')).toBe(KEY)
    expect(request!.body).toEqual({ firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02', noNinReason: 'not_carried',
      phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: true, existingHealthId: 'HID-ABC234', purpose: 'healthcare-operations' })
  })
})
