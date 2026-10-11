import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * The staff API with a session in use and ready, as the provider portal sets it
 * once signed in: protected requests wait for that, and these tests have no portal.
 */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(body: unknown) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return requests
}

const ENCOUNTER = '/api/v1/ehr/patients/patient-1/encounters/encounter-1'

/**
 * hid-system EHR (ehr/shared/clinical.dto.ts) validates with forbidNonWhitelisted:
 * UpdateDiagnosisDto has no status, so a diagnosis change carries only the fields
 * that DTO names; a vital is corrected by appending replacement values, never by a
 * PATCH, and that POST needs an Idempotency-Key.
 */
describe('EHR correction requests', () => {
  it('patches a diagnosis with only the fields given, its version and the reason', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'diagnosis-1' })
    const { staffApi } = await signedInStaffApi()

    await staffApi.updateDiagnosis('facility-1', 'patient-1', 'encounter-1', 'diagnosis-1',
      { expectedRowVersion: 3, changeReason: 'Confirmed by culture', verificationStatus: 'confirmed' })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('PATCH')
    expect(requests[0]!.url.pathname).toBe(`${ENCOUNTER}/diagnoses/diagnosis-1`)
    expect(requests[0]!.body).toEqual({ expectedRowVersion: 3, changeReason: 'Confirmed by culture', verificationStatus: 'confirmed' })
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })

  it('appends a vital correction with its replacement values and the submission key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'correction-1', correctionNo: 1 })
    const { staffApi } = await signedInStaffApi()

    await staffApi.correctVital('facility-1', 'patient-1', 'encounter-1', 'vital-1', {
      expectedRowVersion: 1, changeReason: 'Pulse misread', replacementValues: { pulseBpm: 78 },
    }, 'key-1')

    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.url.pathname).toBe(`${ENCOUNTER}/vitals/vital-1/corrections`)
    expect(requests[0]!.body).toEqual({ expectedRowVersion: 1, changeReason: 'Pulse misread', replacementValues: { pulseBpm: 78 } })
    expect(requests[0]!.headers.get('idempotency-key')).toBe('key-1')
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
  })

  it('reads a vital correction history for the facility', async () => {
    const requests = recordFetch([])
    const { staffApi } = await signedInStaffApi()

    await expect(staffApi.vitalCorrections('facility-1', 'patient-1', 'encounter-1', 'vital-1')).resolves.toEqual([])

    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.pathname).toBe(`${ENCOUNTER}/vitals/vital-1/corrections`)
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
  })
})
