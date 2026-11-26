import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * The dental clinic (hid-system DEN-1, 0194-0196, Release D; claude/sprint-dental-backend, not live), as the blue EHR's
 * Dental page calls it. Proposed, for the provider portal only, with the backend's codes. No Health ID in any address.
 */
const PATIENT = 'a0000000-0000-4000-8000-0000000000d1'
const VISIT = 'e0000000-0000-4000-8000-0000000000d1'
const VERSION = 'c0000000-0000-4000-8000-0000000000d1'
const PROCEDURE = 'd0000000-0000-4000-8000-0000000000d1'

const ROUTES = [
  ['ehr.dentalLists', 'GET', '/api/v1/ehr/dental/lists', 'ehr.dental.read'],
  ['ehr.dentalVisit', 'GET', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-visit`, 'ehr.dental.read'],
  ['ehr.dentalVisit', 'POST', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-visit`, 'ehr.dental.write'],
  ['ehr.dentalVisit', 'PATCH', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-visit`, 'ehr.dental.write'],
  ['ehr.dentalVisits', 'GET', '/api/v1/ehr/dental-visits', 'ehr.dental.read'],
  ['ehr.dentalChart', 'GET', `/api/v1/ehr/patients/${PATIENT}/dental-chart`, 'ehr.dental.read'],
  ['ehr.dentalChartSave', 'POST', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-chart`, 'ehr.dental.write'],
  ['ehr.dentalChartEnteredInError', 'POST', `/api/v1/ehr/patients/${PATIENT}/dental-chart/${VERSION}/entered-in-error`, 'ehr.dental.write'],
  ['ehr.dentalProcedureRecord', 'POST', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-procedures`, 'ehr.dental.write'],
  ['ehr.dentalProcedureDone', 'POST', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-procedures/${PROCEDURE}/done`, 'ehr.dental.write'],
  ['ehr.dentalProcedureCancel', 'POST', `/api/v1/ehr/patients/${PATIENT}/dental-procedures/${PROCEDURE}/cancel`, 'ehr.dental.write'],
  ['ehr.dentalProcedureEnteredInError', 'POST', `/api/v1/ehr/patients/${PATIENT}/dental-procedures/${PROCEDURE}/entered-in-error`, 'ehr.dental.write'],
  ['ehr.dentalProcedures', 'GET', `/api/v1/ehr/patients/${PATIENT}/dental-procedures`, 'ehr.dental.read'],
  ['ehr.dentalSummary', 'GET', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-summary`, 'ehr.dental.read'],
] as const

describe('dental clinic routes (hid-system DEN-1)', () => {
  it('registers each route as proposed with the backend’s code, for the provider portal only', () => {
    for (const [name, method, , code] of ROUTES) {
      const endpoint = findEndpoint(name)
      expect(endpoint?.status, name).toBe('proposed')
      expect(endpoint?.permissions?.[method], `${method} ${name}`).toEqual([code])
      expect(endpoint?.note, name).toMatch(/DENTAL_NOT_AVAILABLE/)
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(BoundaryViolationError)
    }
  })

  it('tells every dental address apart, and from the visit and its records', () => {
    for (const [name, method, path] of ROUTES) expect(assertRegisteredBrowserRequest(method, path).name, `${method} ${path}`).toBe(name)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/dental-visits', { days: 7 }).name).toBe('ehr.dentalVisits')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/patients/${PATIENT}/dental-chart`, { versionId: VERSION }).name).toBe('ehr.dentalChart')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}`).name).toBe('ehr.encounter')
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/patients/${PATIENT}/encounters/${VISIT}/dental-visit`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/ehr/dental/lists')).toThrow(BrowserRouteError)
  })
})
