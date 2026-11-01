import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isApplicationProduct, providerApplicationHref, missingOrganizationProfileFields, saveOrganizationCompletionProfile,
  startOrganizationCompletion, validateOrganizationProfileEntries, verifyOrganizationCompletion,
  type OrganizationCompletionProfile,
} from '@/lib/provider-application'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@hid/api', () => ({ createRegisteredBrowserClient: () => ({ request }) }))
vi.mock('@hid/http', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), createApiClient: () => ({}) }))
vi.mock('@/lib/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'http://localhost:3100' }) }))

beforeEach(() => request.mockReset())

describe('provider application routes and contract', () => {
  it.each([
    ['ehr', '/provider/apply?product=ehr'],
    ['laboratory', '/provider/apply?product=laboratory'],
    ['pharmacy', '/provider/apply?product=pharmacy'],
    ['migrate', '/provider/apply?product=migrate'],
  ] as const)('preserves %s when opening the application page', (product, href) => {
    expect(providerApplicationHref(product)).toBe(href)
  })

  it('keeps the generic provider application route and excludes API from the application products', () => {
    expect(providerApplicationHref()).toBe('/provider/apply')
    expect(isApplicationProduct('api')).toBe(false)
    expect(isApplicationProduct('laboratory')).toBe(true)
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
      .toThrow(/came from the official company record/)
    await saveOrganizationCompletionProfile(profile, { entityType: '  Limited company  ' })
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'PATCH', path: '/api/v1/identity/organization-applications/completion/profile', auth: 'none',
      headers: { 'If-Match': '"4"' }, body: { entityType: 'Limited company' },
    })
  })

  // hid-system CompleteOrganizationProfileDto: companyName 2-200, entityType 2-120 and
  // address 5-1000 characters, each after trimming.
  it('refuses profile details shorter than the backend accepts', () => {
    const profile: OrganizationCompletionProfile = {
      status: 'pending_verification', profileState: 'incomplete', version: 4,
      productCode: 'ehr', registrationNumber: 'RC123456', fields: {
        companyName: { value: null, source: null }, entityType: { value: null, source: null },
        registrationDate: { value: null, source: null }, address: { value: null, source: null },
        registryStatus: { value: null, source: null },
      },
    }
    expect(validateOrganizationProfileEntries({ companyName: 'A', entityType: ' X ', address: 'abcd' })).toEqual({
      companyName: 'Enter the registered organization name in 2 to 200 characters.',
      entityType: 'Enter the legal entity type in 2 to 120 characters.',
      address: 'Enter the registered address in 5 to 1,000 characters.',
    })
    expect(validateOrganizationProfileEntries({ companyName: 'AB', entityType: 'Ltd', address: ' 12 Rd ', registryStatus: '' })).toEqual({})
    expect(() => missingOrganizationProfileFields(profile, { address: 'abc' })).toThrow(/registered address in 5/)
    expect(missingOrganizationProfileFields(profile, { address: '  12 Marina Road  ' })).toEqual({ address: '12 Marina Road' })
  })
})
