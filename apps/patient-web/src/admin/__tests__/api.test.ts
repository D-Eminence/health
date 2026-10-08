import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ environment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function recordFetch() {
  const requests: Array<{ url: URL; headers: Headers; method: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method) })
    return new Response(JSON.stringify({ items: [], nextBeforeSequenceId: null, actor: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return requests
}

describe('platform admin API', () => {
  it('sends platform administration requests without a facility context', async () => {
    const requests = recordFetch()
    const { adminApi } = await import('../api')

    await adminApi.session()
    await adminApi.overview()
    await adminApi.principals('admin')
    await adminApi.audit()
    await adminApi.audit(undefined, '41')

    expect(requests.map(request => request.url.pathname)).toEqual([
      '/api/v1/admin/session', '/api/v1/admin/overview', '/api/v1/admin/principals',
      '/api/v1/admin/audit/events', '/api/v1/admin/audit/events',
    ])
    for (const request of requests) expect(request.headers.has('x-facility-id')).toBe(false)
    expect(Object.fromEntries(requests[3]!.url.searchParams)).toEqual({ limit: '50' })
    expect(Object.fromEntries(requests[4]!.url.searchParams)).toEqual({ limit: '50', beforeSequenceId: '41' })
  })

  it('sends account commands with version and idempotency headers and no facility', async () => {
    const requests = recordFetch()
    const { adminApi } = await import('../api')
    await adminApi.command('/api/v1/admin/principals/account-1/status',
      { status: 'disabled', reason: 'Governed suspension' }, { version: 3, idempotent: true })
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('if-match')).toBe('"3"')
    expect(requests[0]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(requests[0]!.headers.has('x-facility-id')).toBe(false)
  })

  it('keeps sending facility context for provider workflows', async () => {
    const requests = recordFetch()
    const { staffApi } = await import('../../staff/api')
    await staffApi.facilityAudit('facility-1')
    expect(requests[0]!.url.pathname).toBe('/api/v1/audit/events')
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
  })
})
