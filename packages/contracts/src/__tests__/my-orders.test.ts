import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * "Ordered by me" (hid-system 0143, MY-1), as the blue EHR's Ordered by me page calls it. Either read permission opens
 * it, so the registry lists none as required. No patient and no Health ID in the address.
 */
describe('Ordered by me route (hid-system 0143)', () => {
  it('registers the route as served, for the provider portal only', () => {
    const endpoint = findEndpoint('ehr.myOrders')
    expect(endpoint).toMatchObject({ path: '/api/v1/ehr/my-orders', methods: ['GET'], service: 'ehr', status: 'surface-verified' })
    expect(endpoint?.permissions).toBeUndefined()
    expect(endpoint?.note).toContain('ehr.lab-request.read')
    expect(endpoint?.note).toContain('ehr.prescription.read')
    expect(endpoint?.note).toContain('direct-care')
    expect(() => assertEndpointAllowed('staff-web', 'ehr.myOrders')).not.toThrow()
    expect(() => assertEndpointAllowed('patient-web', 'ehr.myOrders')).toThrow(BoundaryViolationError)
  })

  it('takes its filters and cursor in the query, and no other method', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/my-orders').name).toBe('ehr.myOrders')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/my-orders',
      { kind: 'lab', state: 'open', since: '2026-09-01', cursor: 'AbCdEfGhIjKlMnOp' }).name).toBe('ehr.myOrders')
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/ehr/my-orders')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/my-orders/a0000000-0000-4000-8000-000000000001')).toThrow(BrowserRouteError)
  })
})
