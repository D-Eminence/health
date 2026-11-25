import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Provider reports, operations figures first (hid-system REP-1, 0203 and 0204 on claude/sprint-reports-backend, Release
 * D, not live), as the blue EHR's Reports & Analytics page and Home's Activity card call them. Proposed until the backend
 * is live. The only query is the range of days: no patient, Health ID, NIN or facility in any address.
 */
const ROUTES = ['ehr.reportsOperations', 'ehr.reportsOperationsExports']

describe('provider reports routes (hid-system REP-1)', () => {
  it('registers both routes as proposed, with the report codes the backend checks', () => {
    for (const name of ROUTES) expect(findEndpoint(name)?.status, name).toBe('proposed')
    expect(findEndpoint('ehr.reportsOperations')).toMatchObject({ path: '/api/v1/ehr/reports/operations', methods: ['GET'],
      service: 'ehr', auth: { kind: 'authenticated' }, permissions: { GET: ['reports.read'] },
      requiredQuery: { GET: ['from', 'to'] } })
    expect(findEndpoint('ehr.reportsOperationsExports')).toMatchObject({ path: '/api/v1/ehr/reports/operations/exports',
      methods: ['POST'], service: 'ehr', auth: { kind: 'authenticated' }, permissions: { POST: ['reports.read', 'reports.export'] } })
    for (const name of ROUTES) expect(findEndpoint(name)?.note, name).toMatch(/REP-1.*REPORTS_NOT_AVAILABLE/)
  })

  it('lets only the provider portal call them', () => {
    for (const name of ROUTES) {
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name), name).toThrow(BoundaryViolationError)
    }
  })

  it('tells the report from its download, and needs both days for the report', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/reports/operations', { from: '2026-11-01', to: '2026-11-30' }).name)
      .toBe('ehr.reportsOperations')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/reports/operations/exports').name).toBe('ehr.reportsOperationsExports')
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/reports/operations', { from: '2026-11-01' })).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/reports/operations')).toThrow(BrowserRouteError)
  })

  it('has no other method, and no download read by address', () => {
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/ehr/reports/operations')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/reports/operations/exports')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', '/api/v1/ehr/reports/operations/exports')).toThrow(BrowserRouteError)
  })
})
