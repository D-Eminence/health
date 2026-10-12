import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OcrValidation } from './api'

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

const validation: OcrValidation = { id: 'validation-1', jobId: 'job-1', extractionId: 'extraction-1', version: 2, disposition: 'validated',
  targetDomain: 'EHR', candidateType: 'clinical_note', acceptedFields: {}, rejectedFields: [], corrections: [],
  reason: 'Matches the source document', reviewedAt: '2026-10-12T09:30:00.000Z' }

/**
 * OCR resumes a publication that failed for want of its owning service only when
 * the request that started it is sent again with the same Idempotency-Key
 * (hid-system ocr.service.ts createPublication), so the caller names the key.
 */
describe('OCR publication requests', () => {
  it('sends the key the caller holds, each time', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'publication-1', status: 'published' })
    const { staffApi } = await signedInStaffApi()

    await staffApi.publishOcrValidation('facility-1', validation, 'confirmation-1', 'create_imported_clinical_note', 'publication-key-1')
    await staffApi.publishOcrValidation('facility-1', validation, 'confirmation-1', 'create_imported_clinical_note', 'publication-key-1')

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.method).toBe('POST')
      expect(request.url.pathname).toBe('/api/v1/ocr/validations/validation-1/publications')
      expect(request.headers.get('idempotency-key')).toBe('publication-key-1')
      expect(request.headers.get('x-facility-id')).toBe('facility-1')
      expect(request.body).toEqual({ validationVersion: 2, patientConfirmationId: 'confirmation-1',
        targetOperation: 'create_imported_clinical_note', purpose: 'direct-care' })
    }
  })
})

/** OCR-04: what a Lab or Pharmacy publication made is read from the domain that owns it. */
describe('imported evidence reads', () => {
  it.each([
    ['labImport', '/api/v1/lab/imports/import-1'],
    ['pharmacyImport', '/api/v1/pharmacy/imports/import-1'],
  ] as const)('%s reads the import at this facility for direct care', async (method, path) => {
    const requests = recordFetch({ id: 'import-1' })
    const { staffApi } = await signedInStaffApi()

    await staffApi[method]('facility-1', 'import-1')

    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.pathname).toBe(path)
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })
})

/**
 * GAP-L93, OUTREACH-01: Identity does not authorize outreach.campaign.write
 * (hid-system authorize-outreach.dto.ts, ADR-045), so the staff API reads
 * campaigns and their members and has no call that writes them.
 */
describe('Outreach campaign requests', () => {
  it('only read campaigns', async () => {
    const { staffApi } = await signedInStaffApi()
    expect(Object.keys(staffApi).filter(name => /campaign/i.test(name)).sort()).toEqual(['outreachCampaignMembers', 'outreachCampaigns'])
  })
})

/**
 * OUTREACH-02: Outreach answers a registration sent again with the same
 * Idempotency-Key and body with the case it made, so the caller names the
 * command (its localCommandId, also the key, and temporary patient ID) and
 * sends the same one when it retries the same case.
 */
describe('Outreach registration case requests', () => {
  it('sends the command the caller holds: its localCommandId as the Idempotency-Key, and its temporary patient ID', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'case-1' })
    const { staffApi } = await signedInStaffApi()
    const command = { localCommandId: 'c0000000-0000-4000-8000-000000000001', temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000002' }

    await staffApi.createOutreachCase('facility-1', { fullName: 'Amaka Obi', sex: 'female', ageYears: 34 }, command)
    await staffApi.createOutreachCase('facility-1', { fullName: 'Amaka Obi', sex: 'female', ageYears: 34 }, command)

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.method).toBe('POST')
      expect(request.url.pathname).toBe('/api/v1/outreach/registration-cases')
      expect(request.headers.get('idempotency-key')).toBe(command.localCommandId)
      expect(request.headers.get('x-facility-id')).toBe('facility-1')
      expect(request.body).toEqual({ fullName: 'Amaka Obi', sex: 'female', ageYears: 34, ...command })
    }
  })
})
