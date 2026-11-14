import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Facility-assisted registration (hid-system main f9dbaf0: D-Eminence/hid-system#85,
 * migration 0094, ADR-063): the staff in-person check and the platform
 * designation of a participating facility.
 */
describe('facility-assisted registration routes (hid-system #85)', () => {
  it('registers the staff in-person check with its permission, for the provider portal only', () => {
    expect(findEndpoint('identity.assistedVerifications')).toMatchObject({
      service: 'identity', path: '/api/v1/identity/assisted-verifications', methods: ['POST'],
      auth: { kind: 'authenticated' }, permissions: { POST: ['identity.patient.assisted_registration'] } })
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/identity/assisted-verifications').name)
      .toBe('identity.assistedVerifications')
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/assisted-verifications'))
      .toThrow(BrowserRouteError)
    expect(() => assertEndpointAllowed('staff-web', 'identity.assistedVerifications')).not.toThrow()
    for (const app of ['patient-web', 'public-web', 'admin-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'identity.assistedVerifications'), app).toThrow(BoundaryViolationError)
    }
  })

  it('registers the designation read and command with their platform permissions, for the console only', () => {
    expect(findEndpoint('admin.facilityAssistedRegistration')).toMatchObject({
      service: 'admin', path: '/api/v1/admin/facilities/:facilityId/assisted-registration', methods: ['GET', 'POST'],
      auth: { kind: 'authenticated' },
      permissions: { GET: ['platform.facility.read'], POST: ['platform.facility.manage'] } })
    const path = '/api/v1/admin/facilities/0b0d3c9e-6a1f-4c2b-9d1e-1f2a3b4c5d6e/assisted-registration'
    expect(assertRegisteredBrowserRequest('GET', path).name).toBe('admin.facilityAssistedRegistration')
    expect(assertRegisteredBrowserRequest('POST', path).name).toBe('admin.facilityAssistedRegistration')
    // The facility status command keeps its own route.
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/admin/facilities/f-1/status').name).toBe('admin.facilityStatus')
    expect(() => assertEndpointAllowed('admin-web', 'admin.facilityAssistedRegistration')).not.toThrow()
    for (const app of ['patient-web', 'staff-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'admin.facilityAssistedRegistration'), app).toThrow(BoundaryViolationError)
    }
  })
})
