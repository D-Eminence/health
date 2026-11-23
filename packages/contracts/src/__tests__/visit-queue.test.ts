import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Release A on hid-system staging-novu-ci-20261005: the waiting list (0135, EHR-C7), as the blue EHR's Waiting list
 * calls it. No Health ID in any address.
 */
describe('waiting list routes (hid-system 0135)', () => {
  it('registers each route with the backend’s permissions, for the provider portal only', () => {
    expect(findEndpoint('ehr.visitQueue')).toMatchObject({ path: '/api/v1/ehr/visit-queue', methods: ['GET'],
      permissions: { GET: ['ehr.encounter.read', 'ehr.encounter.write'] } })
    expect(findEndpoint('ehr.visitQueueCheckIn')).toMatchObject({ methods: ['POST'],
      permissions: { POST: ['ehr.encounter.read', 'ehr.encounter.write'] } })
    expect(findEndpoint('ehr.visitQueueEntry')).toMatchObject({ methods: ['PATCH'],
      permissions: { PATCH: ['ehr.encounter.read', 'ehr.encounter.write'] } })
    for (const name of ['ehr.visitQueue', 'ehr.visitQueueCheckIn', 'ehr.visitQueueEntry']) {
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(BoundaryViolationError)
    }
  })

  it('tells check-in from a row', () => {
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/visit-queue/check-in').name).toBe('ehr.visitQueueCheckIn')
    expect(assertRegisteredBrowserRequest('PATCH', '/api/v1/ehr/visit-queue/a0000000-0000-4000-8000-0000000000e1').name)
      .toBe('ehr.visitQueueEntry')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/visit-queue', { includeClosedToday: true }).name).toBe('ehr.visitQueue')
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/visit-queue/check-in')).toThrow(BrowserRouteError)
  })
})
