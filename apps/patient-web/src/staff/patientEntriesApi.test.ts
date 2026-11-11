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

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const PATIENT = '11111111-1111-4111-8111-111111111111'
const ENTRY = { id: '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', source: 'patient', kind: 'medicine', title: 'Amoxicillin 500 mg', facilityName: null,
  occurredOn: '2026-10-01', notes: 'Twice a day.', createdAt: '2026-10-02T09:00:00.000Z', documents: [] }

/** The records the patient added themselves (hid-system 0116), read on the chart as its other reads are. */
describe('the chart’s read of the records the patient added', () => {
  it('reads the patient route at the selected facility for direct care, a page at a time, not deduplicated', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply({ items: [ENTRY, { id: 'half' }], more: true, nextBefore: 'abcdefghijklmnopqrst' })))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.patientEntries('facility-a', PATIENT, null)).resolves.toEqual({ items: [ENTRY], nextBefore: 'abcdefghijklmnopqrst' })
    await staffApi.patientEntries('facility-a', PATIENT, 'abcdefghijklmnopqrst')
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/patient-entries`)
    expect(new URL(String(url)).search).toBe('')
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('before')).toBe('abcdefghijklmnopqrst')
    const headers = new Headers(options.headers)
    expect(headers.get('X-Facility-ID')).toBe('facility-a')
    expect(headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(options.credentials).toBe('include')
  })

  it('reads no next page without more, and refuses an answer that is not a page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ items: [], more: false, nextBefore: 'abcdefghijklmnopqrst' }))
      .mockResolvedValueOnce(reply({ entries: [] })))
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.patientEntries('facility-a', PATIENT, null)).resolves.toEqual({ items: [], nextBefore: null })
    await expect(staffApi.patientEntries('facility-a', PATIENT, null)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('passes a refusal on as it is', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ code: 'NOT_FOUND', status: 404 }, 404)))
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.patientEntries('facility-a', PATIENT, null)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})
