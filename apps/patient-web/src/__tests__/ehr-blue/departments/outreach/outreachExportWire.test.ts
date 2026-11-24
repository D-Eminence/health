import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/*
 * What an Outreach export sends and reads, through the real staff client with only the network stubbed (on
 * example.test): the pages of registrations (hid-system#247: limit, campaignId and before; X-Next-Cursor names the next
 * page) and the export's audit record (204). Fictional ids.
 */
interface Sent { url: URL; method: string; body: unknown; headers: Headers }

async function staffClient(answers: Array<{ body?: unknown; status?: number; headers?: Record<string, string> }>) {
  document.cookie = 'hid_access_csrf=csrf-1'
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    sent.push({ url: new URL(String(url)), method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers.shift() ?? { status: 204 }
    const status = answer.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(answer.body),
      { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...answer.headers } })
  }))
  const { setStaffSessionReady } = await import('../../../../staff/session')
  setStaffSessionReady(true)
  const { staffApi } = await import('../../../../staff/api')
  return { sent, staffApi }
}

const FACILITY = 'facility-demo-hospital'
const CAMPAIGN = 'a0000000-0000-4000-8000-0000000000c1'
const row = (n: number) => ({ id: `case-${n}`, status: 'identity_resolution_pending', fullName: `Patient ${n}`, rowVersion: 1 })

describe('Outreach export on the wire', () => {
  it('asks for a page with its limit, campaign and cursor, and reads the next cursor from the header', async () => {
    const { sent, staffApi } = await staffClient([{ body: [row(1), row(2)], headers: { 'X-Next-Cursor': 'cursor-2' } }, { body: [row(3)] }])
    const first = await staffApi.outreachCasesPage(FACILITY, { limit: 500, campaignId: CAMPAIGN })
    const last = await staffApi.outreachCasesPage(FACILITY, { limit: 500, campaignId: CAMPAIGN, before: 'cursor-2' })
    expect(first).toEqual({ items: [row(1), row(2)], nextCursor: 'cursor-2' })
    expect(last).toEqual({ items: [row(3)], nextCursor: null })
    expect(sent.map(request => [request.method, request.url.pathname, Object.fromEntries(request.url.searchParams)])).toEqual([
      ['GET', '/api/v1/outreach/registration-cases', { limit: '500', campaignId: CAMPAIGN }],
      ['GET', '/api/v1/outreach/registration-cases', { limit: '500', campaignId: CAMPAIGN, before: 'cursor-2' }],
    ])
  })

  it('refuses an answer that is not a list of registrations', async () => {
    const { staffApi } = await staffClient([{ body: { items: [] } }])
    await expect(staffApi.outreachCasesPage(FACILITY, { limit: 500 })).rejects.toThrow(/shape/)
  })

  it('records an export with its format, count and campaign, and reads the 204', async () => {
    const { sent, staffApi } = await staffClient([{ status: 204 }])
    await expect(staffApi.recordOutreachExport(FACILITY, { format: 'pdf', count: 12, campaignId: CAMPAIGN })).resolves.toBeUndefined()
    expect(sent[0]!.method).toBe('POST')
    expect(sent[0]!.url.pathname).toBe('/api/v1/outreach/registration-cases/exports')
    expect(sent[0]!.body).toEqual({ format: 'pdf', count: 12, campaignId: CAMPAIGN })
    expect(sent[0]!.headers.get('X-CSRF-Token')).toBe('csrf-1')
  })
})
