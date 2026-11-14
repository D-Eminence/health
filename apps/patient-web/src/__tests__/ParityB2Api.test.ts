import { describe, expect, it, vi } from 'vitest'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { assertEndpointAllowed, assertRegisteredBrowserRequest } from '@hid/contracts'
import { createPatientApi } from '../api'

/**
 * The patient routes of hid-1.0 parity B2 as the portal calls them (hid-system 0093 on staging-novu-ci-20261005: the
 * bell's count and the access log; and 0062's hid-1.0 notifications), through the registered browser client.
 */
function client(answer: (url: URL, init: RequestInit) => Response) {
  const calls: URL[] = []
  const refreshSession = vi.fn(async () => undefined)
  const onUnauthorized = vi.fn()
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url)
    return answer(url, init ?? {})
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl, refreshSession, onUnauthorized,
    sleep: async () => undefined,
  }), 'patient-web'))
  return { api, calls, refreshSession, onUnauthorized }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, detail: code }, status)

describe('the unread count', () => {
  it('reads GET /identity/me/notifications/unread-count and answers the number', async () => {
    const { api, calls } = client(() => json({ unread: 7 }))
    await expect(api.unreadNotificationCount({ refresh: true })).resolves.toBe(7)
    expect(calls.map(url => url.pathname)).toEqual(['/api/v1/identity/me/notifications/unread-count'])
  })

  it('on the minute, neither refreshes an expired access token nor reports the 401, and is not retried', async () => {
    const { api, calls, refreshSession, onUnauthorized } = client(() => problem(401, 'AUTHENTICATION_REQUIRED'))
    await expect(api.unreadNotificationCount({ refresh: false })).rejects.toMatchObject({ status: 401 })
    expect(refreshSession).not.toHaveBeenCalled()
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it('as the page comes into view, refreshes once as any read does, still without reporting a 401', async () => {
    let first = true
    const { api, calls, refreshSession, onUnauthorized } = client(() => {
      if (first) { first = false; return problem(401, 'AUTHENTICATION_REQUIRED') }
      return json({ unread: 2 })
    })
    await expect(api.unreadNotificationCount({ refresh: true })).resolves.toBe(2)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)

    const refused = client(() => problem(401, 'AUTHENTICATION_REQUIRED'))
    await expect(refused.api.unreadNotificationCount({ refresh: true })).rejects.toMatchObject({ status: 401 })
    expect(refused.onUnauthorized).not.toHaveBeenCalled()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('is not retried after an outage, and refuses an answer that is not a count', async () => {
    const down = client(() => problem(503, 'UPSTREAM_UNAVAILABLE'))
    await expect(down.api.unreadNotificationCount({ refresh: true })).rejects.toMatchObject({ status: 503 })
    expect(down.calls).toHaveLength(1)
    for (const answer of [{}, { unread: -1 }, { unread: '3' }, { unread: null }]) {
      const odd = client(() => json(answer))
      await expect(odd.api.unreadNotificationCount({ refresh: true })).rejects.toThrow('The unread count could not be read.')
    }
    await expect(client(() => json({ unread: 2.7 })).api.unreadNotificationCount({ refresh: true })).resolves.toBe(2)
  })
})

describe('the access log', () => {
  it('asks for 50 events, and for the page before a cursor', async () => {
    const { api, calls } = client(() => json({ events: [], nextBefore: null }))
    await api.accessLog(null)
    await api.accessLog('opaque-cursor')
    expect(calls.map(url => [url.pathname, Object.fromEntries(url.searchParams)])).toEqual([
      ['/api/v1/identity/me/access-log', { limit: '50' }],
      ['/api/v1/identity/me/access-log', { limit: '50', before: 'opaque-cursor' }],
    ])
  })
})

describe('the hid-1.0 notifications', () => {
  it('lists 100 from an offset, and marks one read through its own route', async () => {
    const { api, calls } = client((url, init) => init.method === 'POST' ? json({ id: 'n-1', readAt: '2026-10-28T10:00:00Z' })
      : json([{ id: 'n-1', title: 'Title', message: 'Message', type: 'info', readAt: null, createdAt: '2026-03-02T09:30:00Z' },
        { title: 'no id' }]))
    await expect(api.importedNotifications(100)).resolves.toEqual([
      { id: 'n-1', title: 'Title', message: 'Message', type: 'info', readAt: null, createdAt: '2026-03-02T09:30:00Z' },
    ])
    await api.markImportedNotificationRead('n-1')
    expect(calls.map(url => [url.pathname, Object.fromEntries(url.searchParams)])).toEqual([
      ['/api/v1/identity/me/imported-notifications', { limit: '100', offset: '100' }],
      ['/api/v1/identity/me/imported-notifications/n-1/read', {}],
    ])
  })
})

describe('the registry', () => {
  it('names each route, for the patient portal only', () => {
    const names = [
      ['GET', '/api/v1/identity/me/notifications/unread-count', 'notifications.unreadCount'],
      ['GET', '/api/v1/identity/me/access-log', 'identity.accessLog'],
      ['GET', '/api/v1/identity/me/imported-notifications', 'notifications.imported'],
      ['POST', '/api/v1/identity/me/imported-notifications/n-1/read', 'notifications.importedRead'],
    ] as const
    for (const [method, path, name] of names) {
      const endpoint = assertRegisteredBrowserRequest(method, path)
      expect(endpoint.name).toBe(name)
      expect(endpoint.status).toBe('proposed')
      expect(() => assertEndpointAllowed('patient-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('staff-web', name)).toThrow()
    }
  })
})
