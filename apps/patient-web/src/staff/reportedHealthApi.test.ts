import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.test' }) }))

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

/** The staff API with a session in use and ready, as the provider portal sets it once signed in. */
async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

/** What the patient reported about their health (hid-1.0 parity B3, hid-system 0094), read as the chart's other reads are. */
describe('the chart\'s read of what the patient reported', () => {
  it('reads the patient route at the selected facility for direct care, not deduplicated', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ bloodGroup: 'O+', genotype: null,
      allergies: 'Penicillin', currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: '2026-10-28T09:00:00.000Z' }),
    { headers: { 'content-type': 'application/json' } })))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    const patient = '11111111-1111-4111-8111-111111111111'
    await expect(staffApi.reportedHealthProfile('facility-a', patient)).resolves.toMatchObject({ bloodGroup: 'O+', allergies: 'Penicillin' })
    await staffApi.reportedHealthProfile('facility-b', patient)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe(`/api/v1/ehr/patients/${patient}/reported-health-profile`)
    const headers = new Headers(options.headers)
    expect(headers.get('X-Facility-ID')).toBe('facility-a')
    expect(headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(options.credentials).toBe('include')
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('X-Facility-ID')).toBe('facility-b')
  })

  it('answers null for an answer that states nothing, and passes a 404 on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ bloodGroup: null }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404 }), { status: 404, headers: { 'content-type': 'application/json' } })))
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.reportedHealthProfile('facility-a', 'patient-a')).resolves.toBeNull()
    await expect(staffApi.reportedHealthProfile('facility-a', 'patient-a')).rejects.toMatchObject({ status: 404 })
  })
})
