import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function stubFetch() {
  const settle: Array<() => void> = []
  const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => {
    settle.push(() => resolve(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  }))
  vi.stubGlobal('fetch', fetch)
  return { fetch, settleAll: () => { for (const done of settle.splice(0)) done() } }
}

const urls = (fetch: ReturnType<typeof stubFetch>['fetch']) => fetch.mock.calls.map(([url]) => new URL(String(url)))

/**
 * EHR's TimelineQueryDto takes `limit` (1-100, default 50) and an opaque `cursor`.
 * A read after a change must be a request of its own: the HTTP client merges
 * identical GETs in flight, and one started before the change answers with the
 * rows as they were.
 */
describe('EHR list pages', () => {
  it('asks for a record page by its cursor', async () => {
    const { fetch, settleAll } = stubFetch()
    const { staffApi } = await import('./api')

    const read = staffApi.records('facility-1', 'patient-1', 'encounter-1', 'diagnoses', { cursor: 'ZGlhZ25vc2VzLXBhZ2UtMg' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    settleAll()
    await read

    const [url] = urls(fetch)
    expect(url!.pathname).toBe('/api/v1/ehr/patients/patient-1/encounters/encounter-1/diagnoses')
    expect(Object.fromEntries(url!.searchParams)).toEqual({ limit: '50', cursor: 'ZGlhZ25vc2VzLXBhZ2UtMg' })
  })

  it('asks for the first encounter page without a cursor', async () => {
    const { fetch, settleAll } = stubFetch()
    const { staffApi } = await import('./api')

    const read = staffApi.encounters('facility-1', 'patient-1')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    settleAll()
    await read

    expect(Object.fromEntries(urls(fetch)[0]!.searchParams)).toEqual({ limit: '50' })
  })

  it('sends a fresh read of its own even while an identical read is in flight', async () => {
    const { fetch, settleAll } = stubFetch()
    const { staffApi } = await import('./api')

    const earlier = staffApi.records('facility-1', 'patient-1', 'encounter-1', 'diagnoses')
    const later = staffApi.records('facility-1', 'patient-1', 'encounter-1', 'diagnoses', { fresh: true })
    const earlierEncounters = staffApi.encounters('facility-1', 'patient-1', { cursor: 'ZW5jb3VudGVyLXBhZ2UtMg' })
    const laterEncounters = staffApi.encounters('facility-1', 'patient-1', { cursor: 'ZW5jb3VudGVyLXBhZ2UtMg', fresh: true })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    settleAll()
    await Promise.all([earlier, later, earlierEncounters, laterEncounters])
  })
})
