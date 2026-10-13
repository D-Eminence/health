import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.test' }) }))

afterEach(() => vi.unstubAllGlobals())
describe('hospital imported-history requests', () => {
  it('uses the patient endpoint with facility and purpose headers and no encounter identifier', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ importedRecords: [], limit: 50 }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await import('./api')
    await staffApi.importedRecords('facility-a', '11111111-1111-4111-8111-111111111111', 'direct-care')
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe('/api/v1/ehr/patients/11111111-1111-4111-8111-111111111111/imported-records')
    const headers = new Headers(options.headers)
    expect(headers.get('X-Facility-ID')).toBe('facility-a')
    expect(headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(options.credentials).toBe('include')
  })
})
