import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Quality and safety reporting (hid-system QUAL-1, 0197 and 0198 on claude/sprint-quality-backend, Release D, not live),
 * as the blue EHR's Quality & Safety page calls it. Proposed until the backend is live. No Health ID or NIN in any
 * address: incidents, actions and leads by UUID. Every id here is fictional.
 */
const INCIDENT = 'e0000000-0000-4000-8000-00000000a001'
const ACTION = 'e0000000-0000-4000-8000-00000000b001'
const LEAD = 'e0000000-0000-4000-8000-00000000c001'
const BASE = '/api/v1/ehr/quality'

const ROUTES = ['ehr.qualityMe', 'ehr.qualityIncidents', 'ehr.qualityIncident', 'ehr.qualityIncidentAssign', 'ehr.qualityIncidentInvestigation',
  'ehr.qualityIncidentActions', 'ehr.qualityIncidentAction', 'ehr.qualityIncidentResolve', 'ehr.qualityIncidentReopen',
  'ehr.qualityIncidentCorrection', 'ehr.qualityIncidentCounts', 'ehr.qualityIncidentCountsCsv', 'ehr.qualityLeads', 'ehr.qualityLeadEnd']
const REPORT = 'quality.incident.report'
const MANAGE = 'quality.incident.manage'

describe('quality and safety reporting routes (hid-system QUAL-1)', () => {
  it('registers every route as proposed, each needing quality.incident.report, and leads needing manage to change', () => {
    for (const name of ROUTES) expect(findEndpoint(name)?.status, name).toBe('proposed')
    expect(findEndpoint('ehr.qualityMe')).toMatchObject({ path: `${BASE}/me`, methods: ['GET'], permissions: { GET: [REPORT] } })
    expect(findEndpoint('ehr.qualityIncidents')).toMatchObject({ path: `${BASE}/incidents`, methods: ['GET', 'POST'],
      permissions: { GET: [REPORT], POST: [REPORT] } })
    expect(findEndpoint('ehr.qualityLeads')?.permissions).toEqual({ GET: [REPORT], POST: [REPORT, MANAGE] })
    expect(findEndpoint('ehr.qualityLeadEnd')?.permissions).toEqual({ POST: [REPORT, MANAGE] })
    expect(findEndpoint('ehr.qualityIncidentCounts')?.responseKind).toBeUndefined()
    expect(findEndpoint('ehr.qualityIncidentCountsCsv')).toMatchObject({ path: `${BASE}/incident-counts`, responseKind: 'download',
      requiredQuery: { GET: ['month', 'format'] } })
  })

  it('lets only the provider portal call them', () => {
    for (const name of ROUTES) {
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name), name).toThrow(BoundaryViolationError)
    }
  })

  it('tells each address apart: the list before an incident, each step by its own name, and an action below its incident', () => {
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/me`).name).toBe('ehr.qualityMe')
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/incidents`, { status: 'open', mine: 'reported' }).name).toBe('ehr.qualityIncidents')
    expect(assertRegisteredBrowserRequest('POST', `${BASE}/incidents`).name).toBe('ehr.qualityIncidents')
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/incidents/${INCIDENT}`).name).toBe('ehr.qualityIncident')
    for (const [step, name] of [['assign', 'ehr.qualityIncidentAssign'], ['investigation', 'ehr.qualityIncidentInvestigation'],
      ['actions', 'ehr.qualityIncidentActions'], ['resolve', 'ehr.qualityIncidentResolve'], ['reopen', 'ehr.qualityIncidentReopen'],
      ['correction', 'ehr.qualityIncidentCorrection']] as const) {
      expect(assertRegisteredBrowserRequest('POST', `${BASE}/incidents/${INCIDENT}/${step}`).name).toBe(name)
    }
    expect(assertRegisteredBrowserRequest('POST', `${BASE}/incidents/${INCIDENT}/actions/${ACTION}`).name).toBe('ehr.qualityIncidentAction')
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/leads`).name).toBe('ehr.qualityLeads')
    expect(assertRegisteredBrowserRequest('POST', `${BASE}/leads/${LEAD}/end`).name).toBe('ehr.qualityLeadEnd')
  })

  it('answers the counts as JSON, and as a CSV file only through the download transport', () => {
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/incident-counts`, { month: '2026-12' }).name).toBe('ehr.qualityIncidentCounts')
    expect(assertRegisteredBrowserRequest('GET', `${BASE}/incident-counts`, { month: '2026-12', format: 'csv' }, 'download').name)
      .toBe('ehr.qualityIncidentCountsCsv')
    // The file needs its month and its format.
    expect(() => assertRegisteredBrowserRequest('GET', `${BASE}/incident-counts`, { month: '2026-12' }, 'download')).toThrow(BrowserRouteError)
  })

  it('leaves every other address with one entry as it was: a download of a JSON route is still refused', () => {
    expect(() => assertRegisteredBrowserRequest('GET', `${BASE}/me`, undefined, 'download')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/me/photo')).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/me/photo', undefined, 'download').name).toBe('identity.myPhoto')
  })

  it('has no route that deletes or edits an incident in place, or reads one by anything but its UUID path', () => {
    expect(() => assertRegisteredBrowserRequest('DELETE', `${BASE}/incidents/${INCIDENT}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('PATCH', `${BASE}/incidents/${INCIDENT}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('POST', `${BASE}/incidents/${INCIDENT}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', `${BASE}/leads/${LEAD}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('POST', `${BASE}/me`)).toThrow(BrowserRouteError)
  })
})
