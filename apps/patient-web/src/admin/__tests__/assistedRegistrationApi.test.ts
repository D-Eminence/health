import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ environment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_admin_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(body: unknown, status = 200) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  return requests
}

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const PATH = `/api/v1/admin/facilities/${FACILITY_ID}/assisted-registration`
const DESIGNATION = { status: 'active' as const, addressLine: '12 Marina Road', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos',
  hours: 'Mon to Fri, 9am to 4pm', reason: 'Approved for in-person registration pilot' }

/**
 * A facility's designation for facility-assisted registration (hid-system main
 * f9dbaf0: #85, ADR-063; admin/admin.controller.ts). The command's If-Match
 * carries the designation's version, and 0 creates the first one, which
 * adminApi.command refused and sent without If-Match.
 */
describe('the assisted registration designation requests', () => {
  it('reads a facility’s designation', async () => {
    const answer = { facilityId: FACILITY_ID, designated: false, status: null, addressLine: null, town: null, lga: null,
      state: null, hours: null, reason: null, version: 0, updatedAt: null }
    const requests = recordFetch(answer)
    const { adminApi } = await import('../api')
    await expect(adminApi.assistedRegistration(FACILITY_ID)).resolves.toEqual(answer)
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.pathname).toBe(PATH)
    expect(requests[0]!.headers.has('x-facility-id')).toBe(false)
  })

  it('creates the first designation with If-Match 0, the submission key and the platform CSRF token', async () => {
    document.cookie = 'hid_access_admin_csrf=platform-csrf'
    const requests = recordFetch({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false }, 201)
    const { adminApi } = await import('../api')
    await expect(adminApi.setAssistedRegistration(FACILITY_ID, DESIGNATION, 0, 'submission-key-0001'))
      .resolves.toEqual({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    const [sent] = requests
    expect(sent!.method).toBe('POST')
    expect(sent!.url.pathname).toBe(PATH)
    expect(sent!.body).toEqual(DESIGNATION)
    expect(sent!.headers.get('if-match')).toBe('"0"')
    expect(sent!.headers.get('idempotency-key')).toBe('submission-key-0001')
    expect(sent!.headers.get('x-csrf-token')).toBe('platform-csrf')
    expect(sent!.headers.has('x-facility-id')).toBe(false)
  })

  it('changes a designation with its current version', async () => {
    const requests = recordFetch({ facilityId: FACILITY_ID, status: 'suspended', version: 5, replayed: false }, 201)
    const { adminApi } = await import('../api')
    await adminApi.setAssistedRegistration(FACILITY_ID, { ...DESIGNATION, status: 'suspended' }, 4, 'submission-key-0002')
    expect(requests[0]!.headers.get('if-match')).toBe('"4"')
  })

  it('still refuses version 0, and a version below it, for a command that does not create', async () => {
    const requests = recordFetch({})
    const { adminApi } = await import('../api')
    expect(() => adminApi.command('/api/v1/admin/facilities/f-1/status', { status: 'verified', reason: 'Documents reviewed' },
      { version: 0, idempotencyKey: 'submission-key-0003' })).toThrow('Reload this item before changing it.')
    expect(() => adminApi.command(PATH, DESIGNATION, { version: -1, idempotencyKey: 'submission-key-0004', creates: true }))
      .toThrow('Reload this item before changing it.')
    expect(requests).toHaveLength(0)
  })
})
