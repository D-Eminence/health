import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePatientSearchAnswer, patientSearchBody } from './patientSearch'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

const FACILITY = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const MATCH_REF = `psr_${'x'.repeat(40)}_-9`
const CARD = { matchRef: MATCH_REF, matchRefExpiresAt: '2026-11-23T10:10:00.000Z', fullName: 'Ada Fictional', sex: 'female',
  dateOfBirth: '1990-04-12', healthIdLast4: 'AAA2', ninStatus: 'verified' }

/**
 * Staff patient search, emergency search, break-glass by matchRef and opening this facility's own patient, on the wire
 * (hid-system Release A at identity-api 4c843270: patient-search.controller.ts and consent.controller.ts). Keys and
 * Health IDs go only in POST bodies, never in an address; each call names the facility and its purpose of use.
 */
async function withServer(answer: unknown) {
  const requests: { url: URL; headers: Headers; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  const { staffApi } = await import('./api')
  return { requests, staffApi }
}

describe('POST /api/v1/identity/patient-search', () => {
  it('sends only the keys given, in the body, with direct care at the selected facility', async () => {
    const { requests, staffApi } = await withServer({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [CARD] })
    const answer = await staffApi.searchPatients(FACILITY, { firstName: ' Ada ', lastName: 'Fictional', dateOfBirth: '1990-04-12', phone: '', healthId: 'HID-' })
    expect(requests.map(request => [request.method, request.url.pathname, request.url.search])).toEqual([['POST', '/api/v1/identity/patient-search', '']])
    expect(requests[0]!.body).toEqual({ firstName: 'Ada', lastName: 'Fictional', dateOfBirth: '1990-04-12' })
    expect(requests[0]!.headers.get('x-facility-id')).toBe(FACILITY)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
    expect(answer.patients).toEqual([CARD])
  })

  it('sends a Health ID in the body, normalized, never in the address', async () => {
    const { requests, staffApi } = await withServer({ outcome: 'no_such_patient', reach: 'everywhere', message: 'x', patients: [] })
    await staffApi.searchPatients(FACILITY, { lastName: 'Fictional', healthId: ' hid-zdemaaa2 ' })
    expect(requests[0]!.body).toEqual({ lastName: 'Fictional', healthId: 'HID-ZDEMAAA2' })
    expect(requests[0]!.url.href).not.toMatch(/HID-/i)
  })
})

describe('POST /api/v1/identity/patient-search/emergency', () => {
  it('sends exactly the names, the date of birth and the reason, with the emergency purpose', async () => {
    const { requests, staffApi } = await withServer({ mode: 'emergency', outcome: 'found', reach: 'everywhere', message: null, patients: [CARD] })
    const answer = await staffApi.emergencySearchPatients(FACILITY, { firstName: ' Ada', lastName: 'Fictional ', dateOfBirth: '1990-04-12', reason: '  Unconscious on arrival  ' })
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['POST', '/api/v1/identity/patient-search/emergency']])
    expect(requests[0]!.body).toEqual({ firstName: 'Ada', lastName: 'Fictional', dateOfBirth: '1990-04-12', reason: 'Unconscious on arrival' })
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('emergency')
    expect(answer.mode).toBe('emergency')
  })
})

describe('POST /api/v1/identity/break-glass by matchRef', () => {
  it('names the patient by the card’s matchRef alone, with the reason and today’s 30 minutes', async () => {
    const { requests, staffApi } = await withServer({ accessRequestId: 'r', consentGrantId: 'g', patientId: 'p', status: 'active', expiresAt: 'e' })
    await staffApi.breakGlassByMatchRef(FACILITY, MATCH_REF, 'Unconscious on arrival')
    expect(requests.map(request => [request.method, request.url.pathname])).toEqual([['POST', '/api/v1/identity/break-glass']])
    expect(requests[0]!.body).toEqual({ matchRef: MATCH_REF, reason: 'Unconscious on arrival', durationMinutes: 30 })
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('emergency')
  })
})

describe('POST /api/v1/identity/own-facility-access', () => {
  it.each([
    [{ hid: ' hid-zdemaaa2 ' }, { hid: 'HID-ZDEMAAA2' }],
    [{ patientId: 'a0000000-0000-4000-8000-000000000001' }, { patientId: 'a0000000-0000-4000-8000-000000000001' }],
  ])('sends exactly one of the Health ID or the patient id, in direct care (%o)', async (patient, body) => {
    const { requests, staffApi } = await withServer({ consentGrantId: 'g', patientId: 'p', status: 'active', expiresAt: 'e', existingGrant: false,
      authorization: { basis: 'own-facility', scope: 'write_records', purpose: 'direct-care' } })
    const answer = await staffApi.openOwnFacilityPatient(FACILITY, patient)
    expect(requests.map(request => [request.method, request.url.pathname, request.url.search])).toEqual([['POST', '/api/v1/identity/own-facility-access', '']])
    expect(requests[0]!.body).toEqual(body)
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
    expect(answer.authorization.basis).toBe('own-facility')
  })
})

describe('the search answer', () => {
  it('keeps only a card’s own fields: never a Health ID or a patient id, were one sent', () => {
    const answer = parsePatientSearchAnswer({ mode: 'standard', outcome: 'found', reach: 'here', message: null,
      patients: [{ ...CARD, hid: 'HID-ZDEMAAA2', patientId: 'a0000000-0000-4000-8000-000000000001' }] })
    expect(answer.patients[0]).toEqual(CARD)
    expect(JSON.stringify(answer)).not.toMatch(/HID-|a0000000/)
    expect(answer.reach).toBe('here')
  })

  it('leaves out a card without a valid matchRef or a name, and reads an unknown NIN status as not verified', () => {
    const answer = parsePatientSearchAnswer({ outcome: 'found', patients: [
      { ...CARD, matchRef: 'psr_short' }, { ...CARD, fullName: ' ' }, { ...CARD, ninStatus: 'maybe' }] })
    expect(answer.patients).toHaveLength(1)
    expect(answer.patients[0]!.ninStatus).toBe('not_verified')
  })

  it('shows no card for an outcome other than found', () => {
    expect(parsePatientSearchAnswer({ outcome: 'too_many', patients: [CARD] }).patients).toEqual([])
  })

  it('builds no body key from blank values', () => {
    expect(patientSearchBody({ firstName: '  ', lastName: '', dateOfBirth: '', phone: ' ', healthId: 'HID-' })).toEqual({})
  })
})
