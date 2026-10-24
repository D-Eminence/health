import { describe, expect, it, vi } from 'vitest'
import { BoundaryViolationError, BrowserRouteError, type HidApp } from '@hid/contracts'
import { createApiClient } from '@hid/http'
import { createRegisteredBrowserClient } from '../browser-client'

function harness(app: HidApp = 'staff-web') {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  const transport = createApiClient({
    baseUrl: 'https://gateway.example', clientId: app, sessionMode: 'cookie',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client: createRegisteredBrowserClient(transport, app), fetchImpl }
}

describe('registered browser client', () => {
  it('admits only the three Novu workforce auth routes for the explicit admin contract', async () => {
    const transport = createApiClient({ baseUrl: 'https://gateway.example', clientId: 'admin-web', sessionMode: 'cookie',
      fetchImpl: vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })) as typeof fetch })
    const client = createRegisteredBrowserClient(transport, 'admin-web', { backendContract: 'novu-v1' })
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout']) await client.post(path, {}, { auth: 'none' })
    await expect(client.post('/api/v1/auth/patient/login', {}, { auth: 'none' })).rejects.toBeInstanceOf(BoundaryViolationError)
    await expect(client.post('/api/v1/auth/staff/login', {}, { auth: 'none' })).rejects.toMatchObject({ code: 'UNKNOWN_ROUTE' })
    await expect(createRegisteredBrowserClient(transport, 'admin-web').post('/api/v1/auth/login', {}, { auth: 'none' })).rejects.toBeInstanceOf(BoundaryViolationError)
  })
  it('passes registered dynamic routes and browser Lab import creation to transport', async () => {
    const { client, fetchImpl } = harness()
    const patientId = '123e4567-e89b-42d3-a456-426614174000'
    await client.get(`/api/v1/ehr/patients/${patientId}/encounters`)
    await client.post('/api/v1/lab/imports', { source: 'external' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://gateway.example/api/v1/ehr/patients/${patientId}/encounters`)
  })

  it('rejects wrong methods and unknown paths before transport', async () => {
    const { client, fetchImpl } = harness()
    await expect(client.post('/api/v1/identity/me')).rejects.toMatchObject({ code: 'WRONG_METHOD' })
    await expect(client.get('/api/v1/identity/migrate-all')).rejects.toMatchObject({ code: 'UNKNOWN_ROUTE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('lets only the staff portal call the accountless provider-enrollment routes', async () => {
    const { client, fetchImpl } = harness('staff-web')
    await client.post('/api/v1/identity/provider-enrollments', { turnstileAction: 'provider-enrollment' }, { auth: 'none' })
    await client.post('/api/v1/identity/provider-enrollments/verify', { challengeId: 'c', code: '123456' }, { auth: 'none' })
    await client.post('/api/v1/identity/provider-enrollments/activate', { password: 'x' }, { auth: 'none' })
    expect(fetchImpl.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual([
      '/api/v1/identity/provider-enrollments',
      '/api/v1/identity/provider-enrollments/verify',
      '/api/v1/identity/provider-enrollments/activate',
    ])
    await expect(client.get('/api/v1/identity/provider-enrollments')).rejects.toMatchObject({ code: 'WRONG_METHOD' })
    // The staff grant is limited to provider enrollment, not patient enrollment.
    await expect(client.post('/api/v1/identity/patient-enrollments', {}, { auth: 'none' }))
      .rejects.toBeInstanceOf(BoundaryViolationError)

    // public-web keeps its existing service-wide public enrollment grant.
    for (const app of ['patient-web', 'admin-web'] as const) {
      const other = harness(app)
      await expect(other.client.post('/api/v1/identity/provider-enrollments', {}, { auth: 'none' }))
        .rejects.toBeInstanceOf(BoundaryViolationError)
      expect(other.fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('rejects workload routes even when a dynamic browser route could match them', async () => {
    const { client, fetchImpl } = harness()
    await expect(client.get('/api/v1/lab/imports/from-ocr')).rejects.toMatchObject({ code: 'INTERNAL_ROUTE' })
    await expect(client.post('/api/v1/lab/work-items/accept-ehr-order')).rejects.toMatchObject({ code: 'INTERNAL_ROUTE' })
    await expect(client.post('/api/v1/admin/integrations/nimc/credential-reference'))
      .rejects.toMatchObject({ code: 'INTERNAL_ROUTE' })
    expect(fetchImpl).not.toHaveBeenCalled()

    const publicSite = harness('public-web')
    await expect(publicSite.client.get('/api/v1/lab/imports/from-ocr'))
      .rejects.toMatchObject({ code: 'INTERNAL_ROUTE' })
    expect(publicSite.fetchImpl).not.toHaveBeenCalled()
  })

  it('requires documentId for OCR lookup rather than allowing a global job list', async () => {
    const { client, fetchImpl } = harness()
    await expect(client.get('/api/v1/ocr/jobs')).rejects.toMatchObject({ code: 'REQUIRED_QUERY' })
    await client.get('/api/v1/ocr/jobs', {
      query: { documentId: '123e4567-e89b-42d3-a456-426614174000' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe paths and non-JSON downloads in the JSON client', async () => {
    const { client, fetchImpl } = harness('admin-web')
    await expect(client.get('/api/v1/ehr/patients/%2E%2E/encounters'))
      .rejects.toBeInstanceOf(BrowserRouteError)
    await expect(client.post('/api/v1/admin/principals/export', { reason: 'Quarterly access review' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_RESPONSE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the principal search and export only as POSTs, so their terms and reason stay out of the URL', async () => {
    const { client, fetchImpl } = harness('admin-web')
    await client.post('/api/v1/admin/principals/search', { query: 'ada@example.test', page: 1, pageSize: 25 })
    await client.request({ method: 'POST', path: '/api/v1/admin/principals/export', responseType: 'download',
      body: { reason: 'Quarterly access review' } })
    expect(fetchImpl.mock.calls.map(call => new URL(String(call[0])).search)).toEqual(['', ''])
    // The deprecated GET forms carried the terms and the reason in the query string (hid-system A24).
    await expect(client.get('/api/v1/admin/principals', { query: { query: 'ada@example.test' } }))
      .rejects.toBeInstanceOf(BrowserRouteError)
    await expect(client.request({ method: 'GET', path: '/api/v1/admin/principals/export', responseType: 'download',
      query: { reason: 'Quarterly access review' } })).rejects.toMatchObject({ code: 'WRONG_METHOD' })
    await expect(client.request({ method: 'GET', path: '/api/v1/admin/overview', responseType: 'download' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_RESPONSE' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives platform administration its own sign-in routes and no staff session routes', async () => {
    const admin = harness('admin-web')
    for (const path of ['/api/v1/auth/admin/login', '/api/v1/auth/admin/mfa/verify', '/api/v1/auth/admin/mfa/enroll/start',
      '/api/v1/auth/admin/mfa/enroll/activate', '/api/v1/auth/admin/refresh', '/api/v1/auth/admin/logout',
      '/api/v1/admin/mfa/step-up', '/api/v1/admin/approvals/7a1c2f8e-58c4-4a51-9bd4-28f0d5f0f7f1/approve']) {
      await admin.client.post(path, {})
    }
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      await expect(admin.client.post(path, {})).rejects.toBeInstanceOf(BoundaryViolationError)
    }
    expect(admin.fetchImpl).toHaveBeenCalledTimes(8)

    const staff = harness('staff-web')
    await expect(staff.client.post('/api/v1/auth/admin/login', {})).rejects.toBeInstanceOf(BoundaryViolationError)
    await expect(staff.client.get('/api/v1/admin/sessions')).rejects.toBeInstanceOf(BoundaryViolationError)
    expect(staff.fetchImpl).not.toHaveBeenCalled()
  })

  it('limits shared service routes to the patient or provider workflow', async () => {
    const patient = harness('patient-web')
    await patient.client.get('/api/v1/identity/me')
    await expect(patient.client.post('/api/v1/identity/patient-lookup', { hid: 'HID-1' }))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    expect(patient.fetchImpl).toHaveBeenCalledTimes(1)

    const staff = harness('staff-web')
    await staff.client.post('/api/v1/identity/patient-lookup', { hid: 'HID-1' })
    await expect(staff.client.get('/api/v1/identity/me'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    expect(staff.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('grants Phase 3 patient-safety routes only to the patient portal', async () => {
    const patient = harness('patient-web')
    const grant = '60000000-0000-4000-8000-000000000001'
    const contact = 'a0000000-0000-4000-8000-000000000001'
    await patient.client.get('/api/v1/identity/me/account-deletion')
    await patient.client.post('/api/v1/identity/me/account-deletion/confirm', {})
    await patient.client.post(`/api/v1/identity/me/emergency-contacts/${contact}/verification/confirm`, {})
    // hid-system #109's availability read, which the card makes first (Novu; main answers 404).
    await patient.client.get('/api/v1/identity/me/emergency-contacts/availability')
    await patient.client.post(`/api/v1/identity/me/consent-grants/${grant}/revoke`, { reason: 'No longer needed' })
    // The staff grant-close command is never reachable from the patient portal.
    await expect(patient.client.post(`/api/v1/identity/consent-grants/${grant}/close`, { reason: 'x' }))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    // Emergency-contact alert delivery is a workload route, not a browser route.
    await expect(patient.client.post('/api/v1/notifications/emergency-contact-alert', {}))
      .rejects.toMatchObject({ code: 'INTERNAL_ROUTE' })
    expect(patient.fetchImpl).toHaveBeenCalledTimes(5)

    const staff = harness('staff-web')
    await expect(staff.client.get('/api/v1/identity/me/emergency-contacts'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    await expect(staff.client.get('/api/v1/identity/me/emergency-contacts/availability'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    await expect(staff.client.post('/api/v1/identity/me/account-deletion', {}))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    expect(staff.fetchImpl).not.toHaveBeenCalled()
  })

  it('grants provider modules while isolating public and admin clients', async () => {
    const staff = harness('staff-web')
    await staff.client.get('/api/v1/lab/work-items')
    await staff.client.get('/api/v1/pharmacy/work-items')
    await staff.client.get('/api/v1/outreach/registration-cases')
    expect(staff.fetchImpl).toHaveBeenCalledTimes(3)

    const publicSite = harness('public-web')
    await publicSite.client.get('/api/v1/commercial/pricing')
    await expect(publicSite.client.get('/api/v1/admin/overview'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    await expect(publicSite.client.post('/api/v1/auth/logout'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    expect(publicSite.fetchImpl).toHaveBeenCalledTimes(1)

    const admin = harness('admin-web')
    await admin.client.get('/api/v1/admin/overview')
    await expect(admin.client.get('/api/v1/ehr/me/records'))
      .rejects.toBeInstanceOf(BoundaryViolationError)
    expect(admin.fetchImpl).toHaveBeenCalledTimes(1)
  })
})
