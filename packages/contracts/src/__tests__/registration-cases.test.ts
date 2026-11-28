import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/** SX-10: the registration list, as the blue EHR's Patient registration reads it. No Health ID or NIN in its address. */
describe('registration list route (SX-10)', () => {
  it('is registered with the backend’s permission, for the provider portal only', () => {
    expect(findEndpoint('identity.registrationCases')).toMatchObject({ service: 'identity', path: '/api/v1/identity/registration-cases',
      methods: ['GET'], permissions: { GET: ['identity.registration.write'] }, status: 'surface-verified' })
    expect(() => assertEndpointAllowed('staff-web', 'identity.registrationCases')).not.toThrow()
    expect(() => assertEndpointAllowed('patient-web', 'identity.registrationCases')).toThrow(BoundaryViolationError)
  })

  it('tells the list from one case and from registration without a NIN', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/registration-cases', { view: 'facility', cursor: 'next-page_2' }).name)
      .toBe('identity.registrationCases')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/registration-cases/c0000000-0000-4000-8000-000000000001').name)
      .toBe('identity.registrationCase')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/identity/registration-cases/without-nin').name).toBe('identity.registrationWithoutNin')
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/identity/registration-cases')).toThrow(BrowserRouteError)
  })

  it('refuses a Health ID or NIN in its address', () => {
    for (const key of ['hid', 'healthId', 'nin']) {
      expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/registration-cases', { view: 'mine', [key]: 'HID-ZDEMAAA2' }))
        .toThrow(BrowserRouteError)
    }
  })
})
