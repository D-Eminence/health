import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ environment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(body: unknown) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return requests
}

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'

/**
 * hid-system #109's admin commands on the novu-v1 console (admin.controller.ts): each passes the registered browser
 * boundary, carries the submission's Idempotency-Key and the workforce CSRF token, and keeps its values in the body.
 */
describe('the emergency-contact admin requests', () => {
  it('sets a facility\'s alert phone with If-Match on the facility version', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    document.cookie = 'hid_access_csrf=workforce-csrf'
    const requests = recordFetch({ facilityId: FACILITY_ID, alertPhoneE164: '+2348030000000', version: 4, replayed: false })
    const { adminApi } = await import('../api')
    await expect(adminApi.setFacilityAlertPhone({ id: FACILITY_ID, version: 3 }, '0803 000 0000', 'Front desk line confirmed',
      'submission-key-0001')).resolves.toMatchObject({ alertPhoneE164: '+2348030000000', version: 4 })
    const [sent] = requests
    expect(sent!.method).toBe('POST')
    expect(sent!.url.pathname).toBe(`/api/v1/admin/facilities/${FACILITY_ID}/alert-phone`)
    expect(sent!.body).toEqual({ phone: '0803 000 0000', reason: 'Front desk line confirmed' })
    expect(sent!.headers.get('if-match')).toBe('"3"')
    expect(sent!.headers.get('idempotency-key')).toBe('submission-key-0001')
    expect(sent!.headers.get('x-csrf-token')).toBe('workforce-csrf')
    expect(sent!.headers.has('x-facility-id')).toBe(false)
  })

  it('clears it with a null phone', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const requests = recordFetch({ facilityId: FACILITY_ID, alertPhoneE164: null, version: 5, replayed: false })
    const { adminApi } = await import('../api')
    await adminApi.setFacilityAlertPhone({ id: FACILITY_ID, version: 4 }, null, 'Facility line disconnected', 'submission-key-0002')
    expect(requests[0]!.body).toEqual({ phone: null, reason: 'Facility line disconnected' })
  })

  it('stops alerts to a destination in the body only, never in the URL, without If-Match', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const requests = recordFetch({ contacts: 2, patients: 2, replayed: false })
    const { adminApi } = await import('../api')
    await expect(adminApi.optOutEmergencyContact({ channel: 'email', destination: 'ada@example.com', reason: 'Recipient called support' },
      'submission-key-0003')).resolves.toEqual({ contacts: 2, patients: 2, replayed: false })
    const [sent] = requests
    expect(sent!.method).toBe('POST')
    expect(sent!.url.toString()).toBe('https://gateway.example.test/api/v1/admin/emergency-contacts/opt-out')
    expect(sent!.body).toEqual({ channel: 'email', destination: 'ada@example.com', reason: 'Recipient called support' })
    expect(sent!.headers.get('idempotency-key')).toBe('submission-key-0003')
    expect(sent!.headers.has('if-match')).toBe(false)
  })
})
