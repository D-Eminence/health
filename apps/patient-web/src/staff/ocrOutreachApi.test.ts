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

/** A patient's imports from paper, listed by Lab ({ records }) and Pharmacy ({ items }), a page at a time. */
describe('imported-from-paper lists', () => {
  it.each([
    ['labImports', '/api/v1/lab/imports', { records: [{ id: 'import-2', patientId: 'patient-1', observations: [] }], nextCursor: 'import-2' }],
    ['pharmacyImports', '/api/v1/pharmacy/imports', { items: [{ id: 'import-2', patientId: 'patient-1', medicationText: 'Metformin' }], nextCursor: 'import-2' }],
  ] as const)('%s reads one page for the patient at this facility for direct care', async (method, path, answer) => {
    const requests = recordFetch(answer)
    const { staffApi } = await signedInStaffApi()

    const page = await staffApi[method]('facility-1', 'patient-1', 'import-1')

    expect(page).toEqual({ items: [expect.objectContaining({ id: 'import-2' })], nextCursor: 'import-2' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.url.pathname).toBe(path)
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ patientId: 'patient-1', limit: '20', cursor: 'import-1' })
    expect(requests[0]!.headers.get('x-facility-id')).toBe('facility-1')
    expect(requests[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
  })

  it('sends no cursor for the first page, and reads a missing cursor as the end', async () => {
    const requests = recordFetch({ items: [] })
    const { staffApi } = await signedInStaffApi()
    expect(await staffApi.pharmacyImports('facility-1', 'patient-1')).toEqual({ items: [], nextCursor: null })
    expect(requests[0]!.url.searchParams.has('cursor')).toBe(false)
  })

  it('refuses an answer naming another patient', async () => {
    recordFetch({ records: [{ id: 'import-2', patientId: 'patient-2', observations: [] }], nextCursor: null })
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.labImports('facility-1', 'patient-1')).rejects.toThrow()
  })
})

/**
 * GAP-L93, OUTREACH-01: until hid-system#222 (0111, ADR-045 option B) Identity refused outreach.campaign.write. From it,
 * a campaign's own admins open, close and staff it; the page asks first whether Outreach serves that (governance), and a
 * 404 keeps it read only.
 */
describe('Outreach campaign requests', () => {
  it('reads campaigns, and writes them only through the calls campaign management uses', async () => {
    const { staffApi } = await signedInStaffApi()
    expect(Object.keys(staffApi).filter(name => /campaign/i.test(name)).sort()).toEqual([
      'addOutreachCampaignMember', 'createOutreachCampaign', 'outreachCampaignGovernance', 'outreachCampaignMembers',
      'outreachCampaignStaff', 'outreachCampaigns', 'setOutreachCampaignStatus',
    ])
  })

  it('reads governance and a campaign\'s staff at the facility, for direct care', async () => {
    const requests = recordFetch({ rule: 'campaign_admins' })
    const { staffApi } = await signedInStaffApi()
    await staffApi.outreachCampaignGovernance('facility-1')
    await staffApi.outreachCampaignStaff('facility-1', 'c0a00000-0000-4000-8000-000000000001')
    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'GET /api/v1/outreach/registration-cases/campaigns/governance',
      'GET /api/v1/outreach/registration-cases/campaigns/c0a00000-0000-4000-8000-000000000001/staff',
    ])
    for (const request of requests) {
      expect(request.headers.get('x-facility-id')).toBe('facility-1')
      expect(request.headers.get('x-purpose-of-use')).toBe('direct-care')
    }
  })

  it('opens or closes a campaign against the version it was read at, and sends each write once, with no Idempotency-Key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ id: 'c0a00000-0000-4000-8000-000000000001' })
    const { staffApi } = await signedInStaffApi()
    const campaign = { id: 'c0a00000-0000-4000-8000-000000000001', rowVersion: 4 }
    await staffApi.createOutreachCampaign('facility-1', { name: 'Demo screening week', services: ['registration'], startsAt: '2026-11-19T23:00:00.000Z' })
    await staffApi.setOutreachCampaignStatus('facility-1', campaign, 'closed', 'The work is done.')
    await staffApi.addOutreachCampaignMember('facility-1', campaign.id, { membershipId: 'd0000000-0000-4000-8000-000000000002', role: 'enumerator' })
    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /api/v1/outreach/registration-cases/campaigns',
      'POST /api/v1/outreach/registration-cases/campaigns/c0a00000-0000-4000-8000-000000000001/status',
      'POST /api/v1/outreach/registration-cases/campaigns/c0a00000-0000-4000-8000-000000000001/members',
    ])
    expect(requests[1]!.headers.get('if-match')).toBe('"4"')
    expect(requests[1]!.body).toEqual({ status: 'closed', reason: 'The work is done.' })
    expect(requests[2]!.body).toEqual({ membershipId: 'd0000000-0000-4000-8000-000000000002', role: 'enumerator' })
    for (const request of requests) {
      expect(request.headers.get('idempotency-key')).toBeNull()
      expect(request.headers.get('x-facility-id')).toBe('facility-1')
    }
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

/** Outreach health checks (outreach-api 0118): read, then the whole screening saved with the caller's key and version. */
describe('Outreach health checks requests', () => {
  it('reads the screening, and saves it with the key the caller holds, If-Match only after the first save', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch({ screening: null })
    const { staffApi } = await signedInStaffApi()
    const input = { bpSystolic: 120, bpDiastolic: 80, pulseBpm: null, temperatureC: null, weightKg: null, heightCm: null, glucoseValue: null,
      glucoseUnit: null, glucoseTiming: null, malariaRdt: 'negative' as const, hearingLeft: null, hearingRight: null, mainComplaint: null,
      seenByClinician: null, clinicianName: null, outcome: null, medicinesGiven: null, referred: null, referredTo: null }

    await staffApi.outreachScreening('facility-1', 'case-1')
    await staffApi.saveOutreachScreening('facility-1', 'case-1', input, { idempotencyKey: 'k-1' })
    await staffApi.saveOutreachScreening('facility-1', 'case-1', input, { idempotencyKey: 'k-2', version: 3 })

    expect(requests.map(request => `${request.method} ${request.url.pathname}`)).toEqual([
      'GET /api/v1/outreach/registration-cases/case-1/screening',
      'PUT /api/v1/outreach/registration-cases/case-1/screening',
      'PUT /api/v1/outreach/registration-cases/case-1/screening',
    ])
    expect(requests[1]!.body).toEqual(input)
    expect(requests[1]!.headers.get('idempotency-key')).toBe('k-1')
    expect(requests[1]!.headers.get('if-match')).toBeNull()
    expect(requests[2]!.headers.get('idempotency-key')).toBe('k-2')
    expect(requests[2]!.headers.get('if-match')).toBe('"3"')
    for (const request of requests) expect(request.headers.get('x-facility-id')).toBe('facility-1')
  })
})
