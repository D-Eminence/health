import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * The emergency department board (hid-system ED-1, 0168 and 0169 on claude/sprint-emergency-backend, Release D, not
 * live), as the blue EHR's Emergency department page calls it, and ID-7's "make an unknown patient's record" that its New
 * arrival uses. Proposed until the backend is live. No Health ID or NIN in any address. Every id here is fictional.
 */
const ATTENDANCE = 'e0000000-0000-4000-8000-00000000e001'

const ED_ROUTES = ['ehr.edBoard', 'ehr.edAttendances', 'ehr.edAttendance', 'ehr.edAttendanceTriage', 'ehr.edAttendanceMove',
  'ehr.edAttendanceVisit', 'ehr.edAttendanceDisposition', 'ehr.edAttendanceLeave', 'ehr.edAttendanceCancel']
const PAIR = ['ehr.encounter.read', 'ehr.encounter.write']

describe('emergency department board routes (hid-system ED-1)', () => {
  it('registers every route as proposed, each with its ED code and the waiting list’s pair', () => {
    for (const name of [...ED_ROUTES, 'identity.unknownPatients']) expect(findEndpoint(name)?.status, name).toBe('proposed')
    expect(findEndpoint('ehr.edBoard')).toMatchObject({ path: '/api/v1/ehr/ed-board', methods: ['GET'],
      permissions: { GET: ['ehr.ed.read', ...PAIR] } })
    expect(findEndpoint('ehr.edAttendances')).toMatchObject({ path: '/api/v1/ehr/ed-attendances', methods: ['POST'],
      permissions: { POST: ['ehr.ed.arrive', ...PAIR] } })
    expect(findEndpoint('ehr.edAttendance')?.permissions).toEqual({ GET: ['ehr.ed.read', ...PAIR] })
    for (const name of ['ehr.edAttendanceTriage', 'ehr.edAttendanceMove', 'ehr.edAttendanceVisit', 'ehr.edAttendanceLeave']) {
      expect(findEndpoint(name)?.permissions, name).toEqual({ POST: ['ehr.ed.triage', ...PAIR] })
    }
    expect(findEndpoint('ehr.edAttendanceDisposition')?.permissions).toEqual({ POST: ['ehr.ed.disposition', ...PAIR] })
    expect(findEndpoint('ehr.edAttendanceCancel')?.permissions).toEqual({ POST: ['ehr.ed.arrive', ...PAIR] })
    expect(findEndpoint('identity.unknownPatients')).toMatchObject({ path: '/api/v1/identity/unknown-patients', methods: ['POST'],
      permissions: { POST: ['identity.registration.write'] } })
  })

  it('lets only the provider portal call them', () => {
    for (const name of [...ED_ROUTES, 'identity.unknownPatients']) {
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name), name).toThrow(BoundaryViolationError)
    }
  })

  it('tells each address apart, the board before a record and each action by its own name', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/ed-board').name).toBe('ehr.edBoard')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/ed-board', { includeClosedToday: 'true' }).name).toBe('ehr.edBoard')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/ed-attendances').name).toBe('ehr.edAttendances')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/ed-attendances/${ATTENDANCE}`).name).toBe('ehr.edAttendance')
    for (const [action, name] of [['triage', 'ehr.edAttendanceTriage'], ['move', 'ehr.edAttendanceMove'], ['visit', 'ehr.edAttendanceVisit'],
      ['disposition', 'ehr.edAttendanceDisposition'], ['leave', 'ehr.edAttendanceLeave'], ['cancel', 'ehr.edAttendanceCancel']] as const) {
      expect(assertRegisteredBrowserRequest('POST', `/api/v1/ehr/ed-attendances/${ATTENDANCE}/${action}`).name).toBe(name)
    }
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/identity/unknown-patients').name).toBe('identity.unknownPatients')
  })

  it('has no route that deletes a record, lists every attendance, or reads an unknown patient by address', () => {
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/ed-attendances/${ATTENDANCE}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/ed-attendances')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('PATCH', `/api/v1/ehr/ed-attendances/${ATTENDANCE}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/unknown-patients')).toThrow(BrowserRouteError)
  })
})
