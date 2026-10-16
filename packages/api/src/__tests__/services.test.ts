import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@hid/http'
import { BoundaryViolationError } from '@hid/contracts'
import { createHidApi } from '../index'
import { createServiceBinding } from '../service'
import type { HidApp } from '@hid/contracts'

function harness<A extends HidApp>(app: A) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  const client = createApiClient({ baseUrl: 'https://api.staging.example', clientId: app,
    sessionMode: 'cookie', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} })
  return { api: createHidApi({ app, client }), calls, client }
}

describe('hid-system service routing', () => {
  it('uses the authoritative patient profile and record paths', async () => {
    const { api, calls } = harness('patient-web')
    await api.identity.getMyPatientProfile()
    await api.ehr.listRecords()
    expect(calls.map(call => call.url)).toEqual([
      'https://api.staging.example/api/v1/identity/me',
      'https://api.staging.example/api/v1/ehr/me/records',
    ])
    expect(calls[0]?.init.credentials).toBe('include')
  })

  it('uses real login, pricing and demo paths with their method and key', async () => {
    const { api, calls } = harness('public-web')
    await api.auth.patientLogin({ email: 'patient@example.org', password: 'long-password',
      turnstileAction: 'patient-login' })
    await api.commercial.pricing()
    await api.commercial.bookDemo({ contactName: 'Ada Example', contactEmail: 'ada@example.org',
      productCode: 'ehr', turnstileAction: 'book-demo', turnstileToken: 'token' },
    'aaaaaaaaaaaaaaaa')
    expect(calls.map(call => call.url)).toEqual([
      'https://api.staging.example/api/v1/auth/patient/login',
      'https://api.staging.example/api/v1/commercial/pricing',
      'https://api.staging.example/api/v1/commercial/demo-requests',
    ])
    expect(new Headers(calls[2]?.init.headers).get('Idempotency-Key')).toBe('aaaaaaaaaaaaaaaa')
  })

  it('expands route parameters and forwards clinical headers', async () => {
    const { api, calls } = harness('staff-web')
    const patientId = '123e4567-e89b-42d3-a456-426614174000'
    await api.ehr.listEncounters(patientId, { headers: { 'X-Facility-ID': 'facility-id',
      'X-Purpose-Of-Use': 'direct-care' } })
    expect(calls[0]?.url).toBe(`https://api.staging.example/api/v1/ehr/patients/${patientId}/encounters`)
    expect(new Headers(calls[0]?.init.headers).get('X-Purpose-Of-Use')).toBe('direct-care')
  })

  it('sends the patient enrollment steps of hid-system main f9dbaf0 to their routes (ADR-061, ADR-062, ADR-063)', async () => {
    const { api, calls } = harness('patient-web')
    await api.enrollment.availability()
    await api.enrollment.participatingFacilities()
    await api.enrollment.sendHolderCode()
    await api.enrollment.verifyHolder({ challengeId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a', code: '123456' })
    await api.enrollment.facilityCode()
    await api.enrollment.activate('a-long-enough-password', { dateOfBirth: '1990-02-03', gender: 'female' })
    await api.enrollment.activate('a-long-enough-password')
    const base = 'https://api.staging.example/api/v1/identity/patient-enrollments'
    expect(calls.map(call => [call.init.method ?? 'GET', call.url, call.init.body ? JSON.parse(String(call.init.body)) as unknown : null])).toEqual([
      ['GET', `${base}/availability`, null],
      ['GET', `${base}/participating-facilities`, null],
      ['POST', `${base}/holder`, null],
      ['POST', `${base}/holder/verify`, { challengeId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a', code: '123456' }],
      ['POST', `${base}/facility-code`, null],
      ['POST', `${base}/activate`, { password: 'a-long-enough-password', dateOfBirth: '1990-02-03', gender: 'female' }],
      ['POST', `${base}/activate`, { password: 'a-long-enough-password' }],
    ])
    // Only the start carries an Idempotency-Key.
    expect(calls.map(call => new Headers(call.init.headers).get('Idempotency-Key'))).toEqual(calls.map(() => null))
  })

  it('does not pretend public Outreach signup or global Migrate operations exist', () => {
    const { client } = harness('outreach-web')
    const outreach = createServiceBinding({ app: 'outreach-web', client }, 'outreach')
    expect(() => outreach('outreach.signup', 'POST')).toThrow(BoundaryViolationError)
    const ocr = createServiceBinding({ app: 'ocr-web', client }, 'ocr')
    expect(() => ocr('ocr.projectOperations', 'GET')).toThrow(BoundaryViolationError)
  })
})

describe('application boundaries', () => {
  it('withholds platform admin and staff workflow services from patients', () => {
    const { api } = harness('patient-web')
    // @ts-expect-error patient application has no admin service
    expect(api.admin).toBeUndefined()
    // @ts-expect-error patient application has no pharmacy service
    expect(api.pharmacy).toBeUndefined()
  })

  it('gives public pages only public route groups', () => {
    const { api } = harness('public-web')
    expect(api.commercial).toBeDefined()
    expect(api.enrollment).toBeDefined()
    // @ts-expect-error public site has no EHR service
    expect(api.ehr).toBeUndefined()
  })

  it('has real Lab and Pharmacy contracts', () => {
    expect(harness('lab-web').api.lab).toBeDefined()
    expect(harness('pharmacy-web').api.pharmacy).toBeDefined()
  })

  it('rejects cross-service and unsupported methods before the network', () => {
    const { client, calls } = harness('patient-web')
    const ehr = createServiceBinding({ app: 'patient-web', client }, 'ehr')
    expect(() => ehr('identity.me', 'GET')).toThrow(/belongs to the "identity" service/)
    expect(() => ehr('ehr.myRecords', 'POST')).toThrow(/does not accept POST/)
    expect(calls).toHaveLength(0)
  })

  it('requires all named route parameters', () => {
    const { client } = harness('staff-web')
    const ehr = createServiceBinding({ app: 'staff-web', client }, 'ehr')
    expect(() => ehr('ehr.encounters', 'GET')).toThrow(/Missing route parameter "patientId"/)
  })
})
