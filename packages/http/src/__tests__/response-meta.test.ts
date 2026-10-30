import { describe, expect, it, vi } from 'vitest'
import { createApiClient, type ResponseMeta } from '../client'

const BASE_URL = 'https://gateway.example/api'

function client(responses: (Response | Error)[], extra: { onResponseMeta?: (m: ResponseMeta) => void } = {}) {
  let i = 0
  const fetchImpl = vi.fn(async () => {
    const next = responses[Math.min(i, responses.length - 1)]!
    i += 1
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return createApiClient({ baseUrl: BASE_URL, clientId: 'test-web', sessionMode: 'cookie', getCsrfToken: () => 'csrf', fetchImpl, sleep: async () => {}, random: () => 0, ...extra })
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('onResponseMeta', () => {
  it('reports a success with its status and Date header', async () => {
    const metas: ResponseMeta[] = []
    const c = client([json(201, { id: 'x' }, { Date: 'Thu, 29 Oct 2026 10:42:00 GMT' })], { onResponseMeta: m => metas.push(m) })
    await c.post('/v1/things', { a: 1 })
    expect(metas).toEqual([{ method: 'POST', path: '/v1/things', status: 201, date: 'Thu, 29 Oct 2026 10:42:00 GMT',
      problem: false, code: null, networkError: false, authenticated: true }])
  })

  it('marks application/problem+json failures as problem, with the code', async () => {
    const metas: ResponseMeta[] = []
    const c = client([new Response(JSON.stringify({ code: 'CONSENT_REQUIRED', title: 'x' }), {
      status: 403, headers: { 'Content-Type': 'application/problem+json; charset=utf-8' } })], { onResponseMeta: m => metas.push(m) })
    await expect(c.post('/v1/things', {})).rejects.toMatchObject({ status: 403 })
    expect(metas[0]).toMatchObject({ status: 403, problem: true, code: 'CONSENT_REQUIRED', networkError: false })
  })

  it('a 403 that is not problem+json (the WAF) is not problem', async () => {
    const metas: ResponseMeta[] = []
    const c = client([new Response('<html>blocked</html>', { status: 403, headers: { 'Content-Type': 'text/html' } })],
      { onResponseMeta: m => metas.push(m) })
    await expect(c.post('/v1/things', {})).rejects.toMatchObject({ status: 403 })
    expect(metas[0]).toMatchObject({ status: 403, problem: false })
  })

  it('reports a network error with no status', async () => {
    const metas: ResponseMeta[] = []
    const c = client([new TypeError('Failed to fetch')], { onResponseMeta: m => metas.push(m) })
    await expect(c.post('/v1/things', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(metas).toEqual([{ method: 'POST', path: '/v1/things', status: null, date: null, problem: false, code: null,
      networkError: true, authenticated: true }])
  })

  it('is called once per attempt, retries included, and per request too', async () => {
    const metas: ResponseMeta[] = []
    const perRequest: ResponseMeta[] = []
    const c = client([json(503, { code: 'SERVICE_UNAVAILABLE' }), json(200, { ok: true })], { onResponseMeta: m => metas.push(m) })
    await c.get('/v1/ping', { auth: 'none', onResponseMeta: m => perRequest.push(m) })
    expect(metas.map(m => m.status)).toEqual([503, 200])
    expect(perRequest.map(m => m.status)).toEqual([503, 200])
    expect(metas.every(m => m.authenticated === false)).toBe(true)
  })

  it('a throwing callback never changes the outcome', async () => {
    const c = client([json(200, { ok: true })], { onResponseMeta: () => { throw new Error('boom') } })
    await expect(c.get('/v1/x')).resolves.toEqual({ ok: true })
  })
})
