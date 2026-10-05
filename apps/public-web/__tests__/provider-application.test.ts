import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initialApplicationSelection, organizationApplicationBody, providerApplicationHref,
  missingOrganizationProfileFields, saveOrganizationCompletionProfile,
  startOrganizationCompletion, submitOrganizationApplication, verifyOrganizationCompletion,
  type OrganizationCompletionProfile,
} from '@/lib/provider-application'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@hid/api', () => ({ createRegisteredBrowserClient: () => ({ request }) }))
vi.mock('@hid/http', () => ({ createApiClient: () => ({}) }))
vi.mock('@/lib/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'http://localhost:3100' }) }))

beforeEach(() => request.mockReset())

describe('provider application routes and contract', () => {
  it.each([
    ['ehr', 'hospital', 'ehr', '/provider/apply?product=ehr'],
    ['laboratory', 'laboratory', 'laboratory', '/provider/apply?product=laboratory'],
    ['pharmacy', 'pharmacy', 'pharmacy', '/provider/apply?product=pharmacy'],
    ['migrate', 'hospital', 'migrate', '/provider/apply?product=migrate'],
  ] as const)('preserves %s when opening the existing application flow', (product, organizationType, productCode, href) => {
    expect(providerApplicationHref(product)).toBe(href)
    expect(initialApplicationSelection(product)).toEqual({ organizationType, productCode })
  })

  it('keeps the generic provider application route selectable and excludes API from its product choices', () => {
    expect(providerApplicationHref()).toBe('/provider/apply')
    expect(initialApplicationSelection(undefined)).toEqual({ organizationType: 'hospital', productCode: 'ehr' })
    expect(initialApplicationSelection('api')).toEqual({ organizationType: 'hospital', productCode: 'ehr' })
  })

  it('submits the existing public organization application contract, including provider type', async () => {
    const body = organizationApplicationBody({
      organizationType: 'laboratory', productCode: 'laboratory',
      cacRegistrationNumber: ' rc 123456 ', administratorName: '  Ada Example  ',
      administratorEmail: ' ADA@EXAMPLE.ORG ',
    }, 'widget-token')
    expect(body).toEqual({
      productCode: 'laboratory', organizationType: 'laboratory',
      cacRegistrationNumber: 'RC123456', administratorName: 'Ada Example',
      administratorEmail: 'ada@example.org', turnstileAction: 'organization-application',
      turnstileToken: 'widget-token',
    })
    request.mockResolvedValue({ accepted: true })
    await submitOrganizationApplication(body)
    expect(request).toHaveBeenCalledWith({
      method: 'POST', path: '/api/v1/identity/organization-applications', auth: 'none', body,
    })
  })

  it('rejects product and facility combinations the existing application does not offer', () => {
    expect(() => organizationApplicationBody({
      organizationType: 'laboratory', productCode: 'pharmacy',
      cacRegistrationNumber: 'RC123456', administratorName: 'Ada Example',
      administratorEmail: 'ada@example.org',
    }, 'widget-token')).toThrow(/Choose a product/)
  })

  it('accepts the backend-supported other provider type without inventing a new product code', () => {
    expect(organizationApplicationBody({
      organizationType: 'other', productCode: 'ehr',
      cacRegistrationNumber: 'BN123456', administratorName: 'Ada Example',
      administratorEmail: 'ada@example.org',
    }, 'widget-token')).toMatchObject({ organizationType: 'other', productCode: 'ehr' })
  })

  it('uses the existing completion endpoints and preserves the required If-Match version', async () => {
    request.mockResolvedValueOnce({ accepted: true, challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ status: 'ready_for_review' })
    await startOrganizationCompletion({ productCode: 'ehr', cacRegistrationNumber: ' rc 123456 ',
      administratorEmail: ' ADA@EXAMPLE.ORG ', turnstileToken: 'widget-token' })
    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'POST', path: '/api/v1/identity/organization-applications/completion/start', auth: 'none',
      body: { productCode: 'ehr', cacRegistrationNumber: 'RC123456', administratorEmail: 'ada@example.org',
        turnstileAction: 'organization-completion', turnstileToken: 'widget-token' },
    })
    await verifyOrganizationCompletion('challenge-1', '123456')
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'POST', path: '/api/v1/identity/organization-applications/completion/verify', auth: 'none',
      body: { challengeId: 'challenge-1', code: '123456' },
    })

    const profile: OrganizationCompletionProfile = {
      status: 'pending_verification', profileState: 'incomplete', version: 4,
      productCode: 'ehr', registrationNumber: 'RC123456', fields: {
        companyName: { value: 'Verified Hospital', source: 'qoreid' },
        entityType: { value: null, source: null }, registrationDate: { value: null, source: null },
        address: { value: null, source: null }, registryStatus: { value: null, source: null },
      },
    }
    expect(missingOrganizationProfileFields(profile, { entityType: '  Limited company  ' }))
      .toEqual({ entityType: 'Limited company' })
    expect(() => missingOrganizationProfileFields(profile, { companyName: 'Changed name' }))
      .toThrow(/QoreID-provided/)
    await saveOrganizationCompletionProfile(profile, { entityType: '  Limited company  ' })
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'PATCH', path: '/api/v1/identity/organization-applications/completion/profile', auth: 'none',
      headers: { 'If-Match': '"4"' }, body: { entityType: 'Limited company' },
    })
  })
})
