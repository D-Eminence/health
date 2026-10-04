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
    await expect(client.get('/api/v1/admin/principals/export'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_RESPONSE' })
    expect(fetchImpl).not.toHaveBeenCalled()
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
