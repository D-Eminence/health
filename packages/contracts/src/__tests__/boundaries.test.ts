import { describe, expect, it } from 'vitest'
import { APP_BOUNDARIES, APP_ROUTE_GRANTS, BoundaryViolationError,
  assertEndpointAllowed, canUseService } from '../boundaries'
import { HID_ENDPOINTS, NON_FRONTEND_ENDPOINTS, findEndpoint, hasContracts } from '../registry'

describe('c4b5445 route registry', () => {
  it('uses unique names, full gateway paths and declared methods', () => {
    expect(new Set(HID_ENDPOINTS.map(endpoint => endpoint.name)).size).toBe(HID_ENDPOINTS.length)
    for (const endpoint of HID_ENDPOINTS) {
      expect(endpoint.path).toMatch(/^\/(api\/v1|gateway-health)\//)
      expect(endpoint.methods.length).toBeGreaterThan(0)
    }
  })

  it('lists the actual public pricing, demo, enrollment and recovery routes', () => {
    expect(findEndpoint('commercial.pricing')?.path).toBe('/api/v1/commercial/pricing')
    expect(findEndpoint('commercial.demo')?.methods).toEqual(['POST'])
    expect(findEndpoint('enrollment.start')?.path).toBe('/api/v1/identity/patient-enrollments')
    expect(findEndpoint('auth.otpComplete')?.path).toBe('/api/v1/auth/otp/complete')
  })

  it('records distinct RBAC permissions per EHR method', () => {
    const encounters = findEndpoint('ehr.encounters')
    expect(encounters?.permissions?.GET).toEqual(['ehr.encounter.read'])
    expect(encounters?.permissions?.POST).toEqual(['ehr.encounter.write'])
  })

  it('routes provider facility audit to the Identity service', () => {
    expect(findEndpoint('identity.facilityAudit')?.path).toBe('/api/v1/audit/events')
    expect(findEndpoint('identity.facilityAudit')?.permissions?.GET).toEqual(['audit.read'])
    expect(() => assertEndpointAllowed('staff-web','identity.facilityAudit')).not.toThrow()
    expect(() => assertEndpointAllowed('patient-web','identity.facilityAudit')).toThrow(BoundaryViolationError)
  })

  it('keeps workload routes and absent legacy flows out of browser contracts', () => {
    expect(NON_FRONTEND_ENDPOINTS).toContain('/api/v1/lab/work-items/accept-ehr-order')
    expect(findEndpoint('outreach.signup')).toBeUndefined()
    expect(findEndpoint('ocr.projectOperations')).toBeUndefined()
    expect(findEndpoint('admin.billing')).toBeUndefined()
    expect(hasContracts('lab')).toBe(true)
    expect(hasContracts('pharmacy')).toBe(true)
  })
})

describe('application boundaries', () => {
  it('keeps clinical and admin services out of the public site', () => {
    expect(APP_BOUNDARIES['public-web'].services).toContain('commercial')
    expect(canUseService('public-web','ehr')).toBe(false)
    expect(canUseService('public-web','admin')).toBe(false)
    expect(APP_BOUNDARIES['public-web'].handlesPhi).toBe(true)
  })

  it('grants Lab and Pharmacy their implemented service routes', () => {
    expect(canUseService('lab-web','lab')).toBe(true)
    expect(canUseService('pharmacy-web','pharmacy')).toBe(true)
    for (const service of ['lab', 'pharmacy', 'ocr', 'outreach'] as const) {
      expect(canUseService('staff-web', service)).toBe(true)
    }
  })

  it('keeps shared-service grants specific to each portal', () => {
    expect(() => assertEndpointAllowed('patient-web','identity.patientLookup'))
      .toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('staff-web','identity.me'))
      .toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('public-web','auth.logout'))
      .toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('admin-web','auth.patientLogin'))
      .toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('staff-web','lab.workItems')).not.toThrow()
    for (const [app, byService] of Object.entries(APP_ROUTE_GRANTS)) {
      for (const [service, names] of Object.entries(byService)) {
        for (const name of names) {
          expect(findEndpoint(name)?.service, `${app}: ${name}`).toBe(service)
        }
      }
    }
  })

  it('registers the Stage 2A platform security routes with their backend permissions', () => {
    expect(findEndpoint('auth.adminLogin')).toMatchObject({ path: '/api/v1/auth/admin/login', methods: ['POST'], auth: { kind: 'public' } })
    expect(findEndpoint('auth.adminRefresh')?.path).toBe('/api/v1/auth/admin/refresh')
    expect(findEndpoint('admin.mfaStepUp')?.path).toBe('/api/v1/admin/mfa/step-up')
    expect(findEndpoint('admin.principalSessionRevoke')).toMatchObject({
      path: '/api/v1/admin/principals/:accountId/sessions/:sessionId/revoke', permissions: { POST: ['platform.session.revoke'] } })
    expect(findEndpoint('admin.superAdminRequest')?.permissions).toEqual({ POST: ['platform.role.manage'] })
    expect(findEndpoint('admin.mfaResetRequest')?.permissions).toEqual({ POST: ['platform.mfa.reset'] })
    expect(findEndpoint('admin.principalsExport')).toMatchObject({ responseKind: 'download',
      permissions: { GET: ['platform.principal.export'] }, requiredQuery: { GET: ['reason'] } })
    expect(() => assertEndpointAllowed('admin-web', 'auth.adminMfaEnrollActivate')).not.toThrow()
    expect(() => assertEndpointAllowed('admin-web', 'auth.staffLogin')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('patient-web', 'auth.adminLogin')).toThrow(BoundaryViolationError)
  })

  it('refuses an admin endpoint in a patient application', () => {
    expect(() => assertEndpointAllowed('patient-web','admin.overview')).toThrow(BoundaryViolationError)
  })

  it('does not treat a missing route as a backend capability', () => {
    expect(() => assertEndpointAllowed('outreach-web','outreach.signup')).toThrow(/not a known/)
  })
})
