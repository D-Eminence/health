import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/**
 * The HTTP client merges identical GETs that are in flight together. Lab result
 * reads must not: after the Laboratory page hides results it re-reads them to
 * confirm access, and that confirmation has to be a request of its own, never
 * an answer to one sent before the results were hidden.
 */
describe('Lab result reads', () => {
  function stubFetch(body: unknown) {
    const settle: Array<() => void> = []
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => {
      settle.push(() => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    }))
    vi.stubGlobal('fetch', fetch)
    return { fetch, settleAll: () => { for (const done of settle.splice(0)) done() } }
  }

  it('sends a new request for each specimen execution-list read, even while an identical one is in flight', async () => {
    const { fetch, settleAll } = stubFetch({ items: [] })
    const { staffApi } = await import('./api')

    const earlier = staffApi.labExecutions('facility-1', 'specimen-1')
    const later = staffApi.labExecutions('facility-1', 'specimen-1')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    settleAll()

    await expect(Promise.all([earlier, later])).resolves.toEqual([{ items: [] }, { items: [] }])
    for (const [url] of fetch.mock.calls) expect(new URL(String(url)).pathname).toBe('/api/v1/lab/specimens/specimen-1/executions')
  })

  it('sends a new request for each result-history read, even while an identical one is in flight', async () => {
    const { fetch, settleAll } = stubFetch({ id: 'result-1', revisions: [] })
    const { staffApi } = await import('./api')

    const earlier = staffApi.labResultHistory('facility-1', 'result-1')
    const later = staffApi.labResultHistory('facility-1', 'result-1')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    settleAll()

    await Promise.all([earlier, later])
    for (const [url] of fetch.mock.calls) expect(new URL(String(url)).pathname).toBe('/api/v1/lab/results/result-1/history')
  })
})
