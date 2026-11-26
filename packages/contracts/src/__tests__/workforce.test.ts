import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Duty roster, leave and licence renewals (hid-system ROS-1, 0199-0202 on claude/sprint-hr-backend, Release D, not
 * live), as the blue EHR's Duty roster and HR & Credentials call them. Proposed until the backend is live; the provider
 * portal's alone. Every id here is fictional.
 */
const ID = 'a0000000-0000-4000-8000-0000000000a1'
const ROUTES = ['identity.staffLicences', 'identity.staffLicencesExport', 'identity.staffLicenceMember', 'identity.staffLicenceRenewals',
  'identity.staffLicenceRenewalWithdraw', 'identity.dutyRosterInCharges', 'identity.dutyRosterInChargeEnd', 'identity.dutyRosterOnDuty',
  'identity.myLeaveRequests', 'identity.myLeaveRequestCancel', 'identity.leaveRequests', 'identity.leaveRequestApprove',
  'identity.leaveRequestDecline', 'identity.dutyRosters', 'identity.dutyRoster', 'identity.dutyRosterAssignments',
  'identity.dutyRosterPublish', 'identity.dutyRosterAttendance', 'identity.myDuties']

describe('ROS-1 routes', () => {
  it('registers every route as proposed, in identity-api, with the codes the backend checks', () => {
    for (const name of ROUTES) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'identity', status: 'proposed', auth: { kind: 'authenticated' } })
      expect(findEndpoint(name)?.note, name).toMatch(/hid-system ROS-1/)
    }
    expect(findEndpoint('identity.staffLicences')?.permissions).toEqual({ GET: ['workforce.manage'] })
    expect(findEndpoint('identity.staffLicenceRenewals')?.permissions).toEqual({ POST: ['workforce.manage'] })
    expect(findEndpoint('identity.dutyRosterInCharges')?.permissions).toEqual({ GET: ['workforce.roster.read'], POST: ['workforce.roster.manage'] })
    expect(findEndpoint('identity.myLeaveRequests')?.permissions).toEqual({ GET: ['workforce.leave.request'], POST: ['workforce.leave.request'] })
    // Route 22 needs only an active membership.
    expect(findEndpoint('identity.myDuties')?.permissions).toBeUndefined()
    expect(findEndpoint('identity.staffLicencesExport')?.responseKind).toBe('download')
  })

  it('lets the provider portal call them, and no other application', () => {
    for (const name of ROUTES) {
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(BoundaryViolationError)
    }
  })

  it('tells each address apart, a static one before an id', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/staff-licences').name).toBe('identity.staffLicences')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/staff-licences/export', undefined, 'download').name).toBe('identity.staffLicencesExport')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/identity/staff-licences/${ID}`).name).toBe('identity.staffLicenceMember')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/identity/staff-licences/renewals').name).toBe('identity.staffLicenceRenewals')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/identity/staff-licences/renewals/${ID}/withdraw`).name).toBe('identity.staffLicenceRenewalWithdraw')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/duty-roster/on-duty').name).toBe('identity.dutyRosterOnDuty')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/identity/duty-roster/in-charges/${ID}/end`).name).toBe('identity.dutyRosterInChargeEnd')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/duty-rosters', { weekStart: '2026-12-07' }).name).toBe('identity.dutyRosters')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/identity/duty-rosters/${ID}`).name).toBe('identity.dutyRoster')
    expect(assertRegisteredBrowserRequest('PUT', `/api/v1/identity/duty-rosters/${ID}/assignments`).name).toBe('identity.dutyRosterAssignments')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/identity/duty-rosters/${ID}/assignments/${ID}/attendance`).name)
      .toBe('identity.dutyRosterAttendance')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/identity/leave-requests/${ID}/approve`).name).toBe('identity.leaveRequestApprove')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/identity/me/leave-requests/${ID}/cancel`).name).toBe('identity.myLeaveRequestCancel')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/me/duties').name).toBe('identity.myDuties')
  })

  it('needs a week for the roster list, a download for the export, and has no delete', () => {
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/duty-rosters')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/staff-licences/export')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/identity/duty-rosters/${ID}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('PUT', `/api/v1/identity/duty-rosters/${ID}`)).toThrow(BrowserRouteError)
  })
})
