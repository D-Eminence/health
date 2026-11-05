import { afterEach, describe, expect, it, vi } from 'vitest'
import { HID_ENDPOINTS } from '@hid/contracts'

vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

async function signedInApi() {
  const { setStaffSessionReady } = await import('../../../../staff/session')
  setStaffSessionReady(true)
  return (await import('../../../../ehr-blue/departments/outreach/outreachVisitsApi')).outreachVisitsApi
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(...answers: Array<() => Response>) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers.shift()
    if (!answer) throw new Error(`unexpected request ${String(url)}`)
    return answer()
  }))
  return requests
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const FACILITY = '98d00002-0000-4000-8000-000000000001'
const CASE_ID = 'c0a5e000-0000-4000-8000-000000000001'
const BASE = `https://gateway.example.test/api/v1/outreach/registration-cases/${CASE_ID}`

/* The 0115 requests: today's Outreach headers (the facility, direct care, CSRF), a key on each write, the Health ID in the body. */
describe('the Outreach visits requests', () => {
  it('lists a case’s visits for the facility', async () => {
    const requests = recordFetch(json(200, { items: [{ id: 'v1' }] }))
    const api = await signedInApi()
    await expect(api.listCaseVisits(FACILITY, CASE_ID)).resolves.toEqual([{ id: 'v1' }])
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.href).toBe(`${BASE}/visits`)
    expect(requests[0]!.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(requests[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  })

  it('records a visit with the caller’s key and the CSRF token', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch(json(201, { visit: { id: 'v2' } }))
    const api = await signedInApi()
    const input = { kind: 'follow_up' as const, occurredOn: '2025-10-30', followUpOn: null, referredTo: null, notes: null }
    await expect(api.createCaseVisit(FACILITY, CASE_ID, input, 'key-0001')).resolves.toEqual({ id: 'v2' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url.href).toBe(`${BASE}/visits`)
    expect(requests[0]!.body).toEqual(input)
    expect(requests[0]!.headers.get('Idempotency-Key')).toBe('key-0001')
    expect(requests[0]!.headers.get('X-CSRF-Token') ?? requests[0]!.headers.get('X-CSRF-TOKEN')).toBe('csrf-1')
  })

  it('previews and links by Health ID with the Health ID in the body, never the address', async () => {
    const requests = recordFetch(json(200, { patient: { fullName: 'Demo', dateOfBirth: null, healthIdLast4: 'AAA2' }, canLink: true }),
      json(200, { id: CASE_ID, status: 'identity_resolved', rowVersion: 4, visitCount: 0 }))
    const api = await signedInApi()
    await api.previewLink(FACILITY, CASE_ID, 'HID-ZDEMAAA2')
    await api.linkByHealthId(FACILITY, { id: CASE_ID, status: 'identity_resolution_pending', rowVersion: 3 }, 'HID-ZDEMAAA2', 'Same name and phone', 'key-0002')
    expect(requests.map(request => request.url.href)).toEqual([`${BASE}/link-preview`, `${BASE}/link-existing`])
    expect(requests[0]!.body).toEqual({ healthId: 'HID-ZDEMAAA2' })
    expect(requests[1]!.body).toEqual({ healthId: 'HID-ZDEMAAA2', expectedVersion: 3, reason: 'Same name and phone' })
    expect(requests[1]!.headers.get('Idempotency-Key')).toBe('key-0002')
    for (const request of requests) expect(request.url.href).not.toContain('HID-')
  })

  it('stops a request for a facility the session no longer has, before it is sent', async () => {
    const requests = recordFetch()
    const api = await signedInApi()
    const { setStaffSessionFacilities } = await import('../../../../staff/session')
    setStaffSessionFacilities(['98d00002-0000-4000-8000-000000000009'])
    await expect(api.listCaseVisits(FACILITY, CASE_ID)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(requests).toHaveLength(0)
  })

  it('reports the session ended when a request is still refused after the refresh', async () => {
    const requests = recordFetch(json(401, { code: 'AUTHENTICATION_REQUIRED' }), json(401, { code: 'AUTHENTICATION_REQUIRED' }))
    const api = await signedInApi()
    const session = await import('../../../../staff/session')
    session.setStaffSessionActor('staff-demo-1')
    const ended = vi.fn()
    session.onStaffSessionEnded(ended)
    await expect(api.listCaseVisits(FACILITY, CASE_ID)).rejects.toMatchObject({ status: 401 })
    expect(ended).toHaveBeenCalledWith(session.staffSessionGeneration())
    expect(requests.map(request => request.url.pathname)).toEqual([new URL(`${BASE}/visits`).pathname, '/api/v1/auth/refresh'])
  })

  it('never restores and repeats a request while no one is signed in', async () => {
    const requests = recordFetch(json(401, { code: 'AUTHENTICATION_REQUIRED' }))
    const api = await signedInApi()
    const session = await import('../../../../staff/session')
    session.setStaffSessionActor(null)
    const ended = vi.fn()
    session.onStaffSessionEnded(ended)
    await expect(api.listCaseVisits(FACILITY, CASE_ID)).rejects.toMatchObject({ status: 401 })
    expect(requests).toHaveLength(1)
    expect(ended).toHaveBeenCalled()
  })

  it('registers the new routes as proposed, behind the switch', () => {
    for (const name of ['outreach.caseVisits', 'outreach.linkPreview']) {
      const endpoint = HID_ENDPOINTS.find(item => item.name === name)
      expect(endpoint?.status, name).toBe('proposed')
      expect(endpoint?.note, name).toMatch(/OUTREACH_VISITS_ENABLED/)
    }
  })
})
