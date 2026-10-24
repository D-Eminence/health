import { describe, expect, it } from 'vitest'
import { APP_BOUNDARIES, APP_ROUTE_GRANTS, BoundaryViolationError,
  assertEndpointAllowed, canUseService } from '../boundaries'
import { HID_ENDPOINTS, NON_FRONTEND_ENDPOINTS, findEndpoint, hasContracts } from '../registry'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'

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

  it('registers the public enrollment availability read for the patient portal (hid-system#68, FE-4)', () => {
    expect(findEndpoint('enrollment.availability')).toMatchObject({
      path: '/api/v1/identity/patient-enrollments/availability', methods: ['GET'], auth: { kind: 'public' } })
    expect(() => assertEndpointAllowed('patient-web', 'enrollment.availability')).not.toThrow()
  })

  it('says what the availability read answers since the NIN holder step (hid-system main f9dbaf0, ADR-062)', () => {
    const note = findEndpoint('enrollment.availability')?.note ?? ''
    expect(note).toContain('{ open, online, facility }')
    expect(note).toContain('only open: true')
  })

  it('registers the NIN holder step and the facility route for the patient portal (hid-system main f9dbaf0, #84 and #85)', () => {
    const BASE = '/api/v1/identity/patient-enrollments'
    const routes = [
      ['enrollment.holder', `${BASE}/holder`, 'POST'],
      ['enrollment.holderVerify', `${BASE}/holder/verify`, 'POST'],
      ['enrollment.facilityCode', `${BASE}/facility-code`, 'POST'],
      ['enrollment.participatingFacilities', `${BASE}/participating-facilities`, 'GET'],
    ] as const
    for (const [name, path, method] of routes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'enrollment', path, methods: [method], auth: { kind: 'public' } })
      expect(assertRegisteredBrowserRequest(method, path).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest(method === 'GET' ? 'POST' : 'GET', path)).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('patient-web', name), name).not.toThrow()
      for (const app of ['staff-web', 'admin-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    expect(findEndpoint('enrollment.activate')?.note).toContain('dateOfBirth')
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

  it('registers sending a saved lab request to Lab with both permissions EHR requires (hid-system #56)', () => {
    expect(findEndpoint('ehr.labRequestLabWorkItem')).toMatchObject({
      path: '/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/lab-work-item',
      methods: ['POST'], permissions: { POST: ['ehr.lab-request.write', 'lab.work-item.accept'] } })
    expect(() => assertEndpointAllowed('staff-web', 'ehr.labRequestLabWorkItem')).not.toThrow()
    expect(() => assertEndpointAllowed('patient-web', 'ehr.labRequestLabWorkItem')).toThrow(BoundaryViolationError)
    const path = '/api/v1/ehr/patients/a0000000-0000-4000-8000-000000000001/encounters/e0000000-0000-4000-8000-000000000001/lab-requests/0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a/lab-work-item'
    expect(assertRegisteredBrowserRequest('POST', path).name).toBe('ehr.labRequestLabWorkItem')
    expect(() => assertRegisteredBrowserRequest('GET', path)).toThrow(BrowserRouteError)
  })

  it('registers the released Lab results of an EHR lab request (hid-system #51)', () => {
    expect(findEndpoint('lab.releasedResultsForOrder')).toMatchObject({
      path: '/api/v1/lab/ehr-orders/:sourceEhrOrderId/released-results',
      methods: ['GET'], permissions: { GET: ['lab.result.released.read'] } })
    expect(() => assertEndpointAllowed('staff-web', 'lab.releasedResultsForOrder')).not.toThrow()
    const path = '/api/v1/lab/ehr-orders/0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a/released-results'
    expect(assertRegisteredBrowserRequest('GET', path).name).toBe('lab.releasedResultsForOrder')
    expect(() => assertRegisteredBrowserRequest('POST', path)).toThrow(BrowserRouteError)
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
    // hid-system A24: the search terms and the export reason travel in POST bodies; the deprecated GET
    // forms, which put them in the URL, are not browser routes.
    expect(findEndpoint('admin.principalsSearch')).toMatchObject({ path: '/api/v1/admin/principals/search',
      methods: ['POST'], permissions: { POST: ['platform.principal.read'] } })
    expect(findEndpoint('admin.principalsSearch')?.responseKind).toBeUndefined()
    expect(findEndpoint('admin.principalsExport')).toMatchObject({ path: '/api/v1/admin/principals/export',
      methods: ['POST'], responseKind: 'download', permissions: { POST: ['platform.principal.export'] } })
    expect(findEndpoint('admin.principalsExport')?.requiredQuery).toBeUndefined()
    expect(findEndpoint('admin.principals')).toBeUndefined()
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/principals', { query: 'ada' }))
      .toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/principals/export', { reason: 'Quarterly access review' }, 'download'))
      .toThrow(BrowserRouteError)
    expect(() => assertEndpointAllowed('admin-web', 'admin.principalsSearch')).not.toThrow()
    expect(() => assertEndpointAllowed('staff-web', 'admin.principalsSearch')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('admin-web', 'auth.adminMfaEnrollActivate')).not.toThrow()
    expect(() => assertEndpointAllowed('admin-web', 'auth.staffLogin')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('patient-web', 'auth.adminLogin')).toThrow(BoundaryViolationError)
  })

  it('registers staff sign-in with an authenticator (hid-system #71) for the provider portal only', () => {
    const steps = [
      ['auth.staffMfaVerify', '/api/v1/auth/mfa/verify'],
      ['auth.staffMfaEnrollEmailCode', '/api/v1/auth/mfa/enroll/email-code'],
      ['auth.staffMfaEnrollStart', '/api/v1/auth/mfa/enroll/start'],
      ['auth.staffMfaEnrollActivate', '/api/v1/auth/mfa/enroll/activate'],
    ] as const
    for (const [name, path] of steps) {
      expect(findEndpoint(name)).toMatchObject({ service: 'auth', path, methods: ['POST'], auth: { kind: 'public' } })
      expect(assertRegisteredBrowserRequest('POST', path).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest('GET', path)).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    // The platform steps stay the console's, and Identity refuses a staff Google
    // exchange (403 GOOGLE_STAFF_SIGN_IN_DISABLED), so the portal is granted none.
    expect(() => assertEndpointAllowed('staff-web', 'auth.adminMfaVerify')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('staff-web', 'auth.googleExchange')).toThrow(BoundaryViolationError)
  })

  it('registers clinician self sign-up (hid-system ADR-066) for the provider portal only', () => {
    const base = '/api/v1/identity/clinician-applications'
    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const routes = [
      ['enrollment.clinicianAvailability', `${base}/availability`, 'GET', `${base}/availability`],
      ['enrollment.clinicianEmailCode', `${base}/email-code`, 'POST', `${base}/email-code`],
      ['enrollment.clinicianEmailVerify', `${base}/email-code/verify`, 'POST', `${base}/email-code/verify`],
      ['enrollment.clinicianFacilitySearch', `${base}/facility-search`, 'POST', `${base}/facility-search`],
      ['enrollment.clinicianSubmit', base, 'POST', base],
      ['enrollment.clinicianAuthenticatorEmailCode', `${base}/authenticator/email-code`, 'POST', `${base}/authenticator/email-code`],
      ['enrollment.clinicianAuthenticatorStart', `${base}/authenticator/start`, 'POST', `${base}/authenticator/start`],
      ['enrollment.clinicianAuthenticatorActivate', `${base}/authenticator/activate`, 'POST', `${base}/authenticator/activate`],
      ['enrollment.clinicianAuthenticatorVerify', `${base}/authenticator/verify`, 'POST', `${base}/authenticator/verify`],
      ['enrollment.clinicianAuthenticatorChallenge', `${base}/authenticator/challenge`, 'POST', `${base}/authenticator/challenge`],
      ['enrollment.clinicianStatusEmailCode', `${base}/status/email-code`, 'POST', `${base}/status/email-code`],
      ['enrollment.clinicianStatusEmailVerify', `${base}/status/email-code/verify`, 'POST', `${base}/status/email-code/verify`],
      ['enrollment.clinicianCurrent', `${base}/current`, 'GET', `${base}/current`],
      ['enrollment.clinicianWithdraw', `${base}/:applicationId/withdraw`, 'POST', `${base}/${applicationId}/withdraw`],
      ['enrollment.clinicianApply', `${base}/current/applications`, 'POST', `${base}/current/applications`],
      ['enrollment.clinicianSessionEnd', `${base}/session/end`, 'POST', `${base}/session/end`],
    ] as const
    for (const [name, path, method, example] of routes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'enrollment', path, methods: [method], auth: { kind: 'public' } })
      expect(assertRegisteredBrowserRequest(method, example).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest(method === 'GET' ? 'POST' : 'GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      // The pages sit in the portal's provider area: the patient portal, the console and the public site are refused.
      for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    expect(APP_ROUTE_GRANTS['staff-web']?.enrollment?.filter(name => name.startsWith('enrollment.clinician'))).toHaveLength(routes.length)
  })

  it('registers the clinician verification queue (hid-system ADR-066) for the platform console only', () => {
    const base = '/api/v1/admin/clinician-applications'
    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const routes = [
      ['admin.clinicianApplications', base, 'GET', base],
      ['admin.clinicianApplication', `${base}/:applicationId`, 'GET', `${base}/${applicationId}`],
      ['admin.clinicianApplicationAttest', `${base}/:applicationId/attest`, 'POST', `${base}/${applicationId}/attest`],
      ['admin.clinicianApplicationApprove', `${base}/:applicationId/approve`, 'POST', `${base}/${applicationId}/approve`],
      ['admin.clinicianApplicationReject', `${base}/:applicationId/reject`, 'POST', `${base}/${applicationId}/reject`],
    ] as const
    for (const [name, path, method, example] of routes) {
      // Every route needs platform.workforce.manage on an MFA-verified platform session.
      expect(findEndpoint(name), name).toMatchObject({ service: 'admin', path, methods: [method],
        auth: { kind: 'authenticated' }, permissions: { [method]: ['platform.workforce.manage'] } })
      expect(assertRegisteredBrowserRequest(method, example).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest(method === 'GET' ? 'POST' : 'GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('admin-web', name)).not.toThrow()
      for (const app of ['staff-web', 'patient-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    // The applicant's own routes stay the provider portal's: the console reviews, it never applies.
    expect(() => assertEndpointAllowed('admin-web', 'enrollment.clinicianCurrent')).toThrow(BoundaryViolationError)
  })

  it('registers hid-system #109\'s emergency-contact availability for the patient portal and its commands for the console', () => {
    const contacts = '/api/v1/identity/me/emergency-contacts'
    // The static availability path wins over a contact id, which takes POST only.
    expect(assertRegisteredBrowserRequest('GET', `${contacts}/availability`).name).toBe('identity.emergencyContactsAvailability')
    expect(findEndpoint('identity.emergencyContactsAvailability')).toMatchObject({ service: 'identity', methods: ['GET'],
      auth: { kind: 'authenticated' }, status: 'proposed' })
    expect(findEndpoint('identity.emergencyContacts')?.note).toContain('409 EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE')
    expect(() => assertEndpointAllowed('patient-web', 'identity.emergencyContactsAvailability')).not.toThrow()
    for (const app of ['staff-web', 'admin-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'identity.emergencyContactsAvailability'), app).toThrow(BoundaryViolationError)
    }
    const facilityId = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
    const routes = [
      ['admin.facilityAlertPhone', `/api/v1/admin/facilities/${facilityId}/alert-phone`, 'platform.facility.manage'],
      ['admin.emergencyContactOptOut', '/api/v1/admin/emergency-contacts/opt-out', 'platform.emergency-contact.manage'],
    ] as const
    for (const [name, example, permission] of routes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'admin', methods: ['POST'], status: 'proposed',
        permissions: { POST: [permission] } })
      expect(assertRegisteredBrowserRequest('POST', example).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest('GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('admin-web', name)).not.toThrow()
      for (const app of ['staff-web', 'patient-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
  })

  it('registers facility self sign-up\'s availability read for the provider portal and its review for the console (P4)', () => {
    const base = '/api/v1/identity/provider-enrollments'
    // The static availability path is a GET of its own; the start is a POST on the base path.
    expect(assertRegisteredBrowserRequest('GET', `${base}/availability`).name).toBe('enrollment.providerAvailability')
    expect(() => assertRegisteredBrowserRequest('POST', `${base}/availability`)).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('POST', base).name).toBe('enrollment.providerStart')
    expect(findEndpoint('enrollment.providerAvailability')).toMatchObject({ service: 'enrollment', methods: ['GET'],
      auth: { kind: 'public' }, status: 'proposed' })
    expect(findEndpoint('enrollment.providerAvailability')?.note).toContain('{ open: false } on any fault')
    expect(() => assertEndpointAllowed('staff-web', 'enrollment.providerAvailability')).not.toThrow()
    for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'enrollment.providerAvailability'), app).toThrow(BoundaryViolationError)
    }
    // The closed gate is a 423 on Novu, and activation answers a session there.
    for (const name of ['enrollment.providerStart', 'enrollment.providerVerify', 'enrollment.providerActivate']) {
      expect(findEndpoint(name)?.note, name).toContain('423 PROVIDER_ENROLLMENT_UNAVAILABLE')
      expect(findEndpoint(name)?.status, name).toBe('surface-verified')
    }
    expect(findEndpoint('enrollment.providerActivate')?.note).toContain('actor')

    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const routes = [
      ['admin.selfServiceFacilities', '/api/v1/admin/self-service-facilities', 'GET', 'platform.identity-review.read'],
      ['admin.selfServiceFacilityReview', `/api/v1/admin/self-service-facilities/${applicationId}/review`, 'POST',
        'platform.facility.manage'],
    ] as const
    for (const [name, example, method, permission] of routes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'admin', methods: [method], status: 'proposed',
        auth: { kind: 'authenticated' }, permissions: { [method]: [permission] } })
      expect(assertRegisteredBrowserRequest(method, example).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest(method === 'GET' ? 'POST' : 'GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('admin-web', name)).not.toThrow()
      for (const app of ['staff-web', 'patient-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
  })

  it('keeps the public site\'s enrollment routes as they were', () => {
    for (const name of ['enrollment.start', 'enrollment.availability', 'enrollment.current', 'enrollment.google',
      'enrollment.holder', 'enrollment.holderVerify', 'enrollment.facilityCode', 'enrollment.participatingFacilities',
      'enrollment.contact', 'enrollment.verifyContact', 'enrollment.activate', 'enrollment.providerStart',
      'enrollment.providerVerify', 'enrollment.providerActivate', 'identity.organizationApply',
      'identity.organizationCompletionStart', 'identity.organizationCompletionVerify', 'identity.organizationCompletionProfile']) {
      expect(() => assertEndpointAllowed('public-web', name), name).not.toThrow()
    }
  })

  it('refuses an admin endpoint in a patient application', () => {
    expect(() => assertEndpointAllowed('patient-web','admin.overview')).toThrow(BoundaryViolationError)
  })

  it('does not treat a missing route as a backend capability', () => {
    expect(() => assertEndpointAllowed('outreach-web','outreach.signup')).toThrow(/not a known/)
  })

  it('lets the provider portal read and manage facility billing, but not send demo requests', () => {
    for (const name of ['commercial.pricing', 'commercial.subscription', 'commercial.subscriptionTrial',
      'commercial.subscriptionCheckout', 'commercial.invoices']) {
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
    }
    expect(() => assertEndpointAllowed('staff-web', 'commercial.demo')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('patient-web', 'commercial.subscription')).toThrow(BoundaryViolationError)
  })
})
