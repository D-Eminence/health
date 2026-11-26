import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * What the provider portal sends to the emergency department board (hid-system ED-1) and to ID-7's "make an unknown
 * patient's record", through the registered staff client: every request names the working facility and its purpose
 * (direct care; emergency only for an emergency search's matchRef; healthcare operations for ID-7), every write carries
 * the caller's Idempotency-Key and the row version the card showed, and no Health ID goes in an address. Fictional ids.
 */
interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

async function signedIn(answer: unknown = { attendance: {}, replayed: false }) {
  document.cookie = 'hid_access_csrf=csrf-1'
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  const { edBoardApi, unknownPatientApi } = await import('./api')
  return { requests, edBoardApi, unknownPatientApi }
}

const ATTENDANCE = 'e0000000-0000-4000-8000-0000000000e1'
const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'
const ENCOUNTER = 'c0000000-0000-4000-8000-0000000000c1'
const CARD = { attendanceId: ATTENDANCE, rowVersion: 3 }
const MATCH_REF = `psr_${'D'.repeat(43)}`

function headers(request: Recorded, purpose = 'direct-care', key?: string) {
  expect(request.headers.get('x-facility-id')).toBe('facility-1')
  expect(request.headers.get('x-purpose-of-use')).toBe(purpose)
  if (key) expect(request.headers.get('idempotency-key')).toBe(key)
}

describe('emergency board API (ED-1)', () => {
  it('reads the board, with the closed ones only when asked, and one record', async () => {
    const { requests, edBoardApi } = await signedIn({ items: [], counts: { waiting: 0, beingSeen: 0, disposition: 0 }, hasMore: false, limit: 200 })
    await edBoardApi.board('facility-1')
    await edBoardApi.board('facility-1', true)
    await edBoardApi.record('facility-1', ATTENDANCE)
    expect(requests.map(request => `${request.method} ${request.url.pathname}${request.url.search}`)).toEqual([
      'GET /api/v1/ehr/ed-board', 'GET /api/v1/ehr/ed-board?includeClosedToday=true', `GET /api/v1/ehr/ed-attendances/${ATTENDANCE}`])
    for (const request of requests) headers(request)
  })

  it('arrives by matchRef (direct care), by an emergency search’s matchRef (emergency), or by patientId', async () => {
    const { requests, edBoardApi } = await signedIn()
    await edBoardApi.arrive('facility-1', { matchRef: MATCH_REF }, { arrivalMode: 'walk_in', triageLevel: 3 }, 'key-1')
    await edBoardApi.arrive('facility-1', { matchRef: MATCH_REF, emergency: true }, { arrivalMode: 'ambulance' }, 'key-2')
    await edBoardApi.arrive('facility-1', { patientId: PATIENT }, { arrivalMode: 'police', arrivedAt: '2026-12-03T08:10:00.000Z' }, 'key-3')
    expect(requests.map(request => request.body)).toEqual([
      { matchRef: MATCH_REF, arrivalMode: 'walk_in', triageLevel: 3 },
      { matchRef: MATCH_REF, arrivalMode: 'ambulance' },
      { patientId: PATIENT, arrivalMode: 'police', arrivedAt: '2026-12-03T08:10:00.000Z' },
    ])
    headers(requests[0]!, 'direct-care', 'key-1')
    headers(requests[1]!, 'emergency', 'key-2')
    headers(requests[2]!, 'direct-care', 'key-3')
    for (const request of requests) expect(request.url.pathname).toBe('/api/v1/ehr/ed-attendances')
  })

  it('sends each write with the row version the card showed and the caller’s key', async () => {
    const { requests, edBoardApi } = await signedIn()
    await edBoardApi.triage('facility-1', CARD, { triageLevel: 1, presentingComplaint: null }, 'k-triage')
    await edBoardApi.move('facility-1', CARD, { stage: 'with_clinician', assignedMembershipId: 'member-1' }, 'k-move')
    await edBoardApi.linkVisit('facility-1', CARD, ENCOUNTER, 'k-visit')
    await edBoardApi.disposition('facility-1', CARD, { outcome: 'admit_requested', admitToDepartmentCode: 'inpatient' }, 'k-disposition')
    await edBoardApi.leave('facility-1', CARD, 'k-leave')
    await edBoardApi.cancel('facility-1', CARD, 'Added in error', 'k-cancel')
    expect(requests.map(request => [request.method, request.url.pathname.replace(`/api/v1/ehr/ed-attendances/${ATTENDANCE}/`, ''), request.body])).toEqual([
      ['POST', 'triage', { expectedRowVersion: 3, triageLevel: 1, presentingComplaint: null }],
      ['POST', 'move', { expectedRowVersion: 3, stage: 'with_clinician', assignedMembershipId: 'member-1' }],
      ['POST', 'visit', { expectedRowVersion: 3, encounterId: ENCOUNTER }],
      ['POST', 'disposition', { expectedRowVersion: 3, outcome: 'admit_requested', admitToDepartmentCode: 'inpatient' }],
      ['POST', 'leave', { expectedRowVersion: 3 }],
      ['POST', 'cancel', { expectedRowVersion: 3, reason: 'Added in error' }],
    ])
    for (const [index, key] of ['k-triage', 'k-move', 'k-visit', 'k-disposition', 'k-leave', 'k-cancel'].entries()) headers(requests[index]!, 'direct-care', key)
  })

  it('starts or reuses today’s emergency visit (EHR-C1) for the link', async () => {
    const { requests, edBoardApi } = await signedIn({ id: ENCOUNTER })
    await edBoardApi.emergencyVisit('facility-1', PATIENT, '2026-12-03T08:20:00.000Z', 'k-visit')
    expect(requests[0]!.url.pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/encounters`)
    expect(requests[0]!.body).toEqual({ encounterType: 'emergency', status: 'in_progress', startedAt: '2026-12-03T08:20:00.000Z',
      chiefComplaint: 'Emergency department attendance', reuseOpenVisit: true })
    headers(requests[0]!, 'direct-care', 'k-visit')
  })

  it('makes an unknown patient’s record for healthcare operations, with the purpose in the body too', async () => {
    const { requests, unknownPatientApi } = await signedIn({ patientId: PATIENT })
    await unknownPatientApi.create('facility-1', { gender: 'female', unknownReason: 'confused', estimatedAgeYears: 70 }, 'k-unknown')
    expect(requests[0]!.url.pathname).toBe('/api/v1/identity/unknown-patients')
    expect(requests[0]!.body).toEqual({ gender: 'female', unknownReason: 'confused', estimatedAgeYears: 70, purpose: 'healthcare-operations' })
    headers(requests[0]!, 'healthcare-operations', 'k-unknown')
  })
})
