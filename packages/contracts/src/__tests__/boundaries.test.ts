import { describe, expect, it } from 'vitest'
import { APP_BOUNDARIES, APP_ROUTE_GRANTS, BoundaryViolationError,
  assertEndpointAllowed, canUseService } from '../boundaries'
import { HID_ENDPOINTS, NON_FRONTEND_ENDPOINTS, ORDER_ROUTE_CANNOT_COMPLETE_REASONS, findEndpoint, hasContracts } from '../registry'
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

  it('registers facility self sign-up\'s reads for the provider portal and its review, release and open applications for the console (P4)', () => {
    const base = '/api/v1/identity/provider-enrollments'
    // The static availability path is a GET of its own; the start is a POST on the base path.
    expect(assertRegisteredBrowserRequest('GET', `${base}/availability`).name).toBe('enrollment.providerAvailability')
    expect(() => assertRegisteredBrowserRequest('POST', `${base}/availability`)).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('POST', base).name).toBe('enrollment.providerStart')
    expect(findEndpoint('enrollment.providerAvailability')).toMatchObject({ service: 'enrollment', methods: ['GET'],
      auth: { kind: 'public' }, status: 'proposed' })
    // The reason says closed or unavailable (P4 round 2): a fault is never shown as closed.
    expect(findEndpoint('enrollment.providerAvailability')?.note).toContain("{ open: false, reason: 'closed' }")
    expect(findEndpoint('enrollment.providerAvailability')?.note).toContain("{ open: false, reason: 'unavailable' }")
    expect(() => assertEndpointAllowed('staff-web', 'enrollment.providerAvailability')).not.toThrow()
    for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'enrollment.providerAvailability'), app).toThrow(BoundaryViolationError)
    }
    // What a confirmed sign-up registers (P4 round 2): Novu's, read with the enrollment cookie.
    expect(assertRegisteredBrowserRequest('GET', `${base}/profile`).name).toBe('enrollment.providerProfile')
    expect(() => assertRegisteredBrowserRequest('POST', `${base}/profile`)).toThrow(BrowserRouteError)
    expect(findEndpoint('enrollment.providerProfile')).toMatchObject({ service: 'enrollment', methods: ['GET'],
      auth: { kind: 'public' }, status: 'proposed' })
    for (const field of ['organizationName', 'registrationNumber', 'productCode', 'organizationType', 'administratorName',
      'administratorEmail']) expect(findEndpoint('enrollment.providerProfile')?.note).toContain(field)
    expect(findEndpoint('enrollment.providerProfile')?.note).toContain('not served by hid-system main')
    expect(findEndpoint('enrollment.providerProfile')?.note).toContain('423 PROVIDER_ENROLLMENT_UNAVAILABLE')
    expect(() => assertEndpointAllowed('staff-web', 'enrollment.providerProfile')).not.toThrow()
    for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'enrollment.providerProfile'), app).toThrow(BoundaryViolationError)
    }
    // The closed gate is a 423 on Novu, and activation answers a session there.
    for (const name of ['enrollment.providerStart', 'enrollment.providerVerify', 'enrollment.providerActivate']) {
      expect(findEndpoint(name)?.note, name).toContain('423 PROVIDER_ENROLLMENT_UNAVAILABLE')
      expect(findEndpoint(name)?.status, name).toBe('surface-verified')
    }
    expect(findEndpoint('enrollment.providerActivate')?.note).toContain('actor')
    // A start that sent no code says so on Novu (P4 round 2).
    expect(findEndpoint('enrollment.providerStart')?.note).toContain('codeSent: false')

    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const routes = [
      ['admin.selfServiceFacilities', '/api/v1/admin/self-service-facilities', 'GET', ['platform.identity-review.read']],
      // P4b: a review gives clinical access, so it also needs platform.facility.unlock (hid-system S13).
      ['admin.selfServiceFacilityReview', `/api/v1/admin/self-service-facilities/${applicationId}/review`, 'POST',
        ['platform.facility.manage', 'platform.facility.unlock']],
      ['admin.selfServiceFacilityRelease', `/api/v1/admin/self-service-facilities/${applicationId}/release`, 'POST',
        ['platform.facility.manage']],
      ['admin.selfServiceApplications', '/api/v1/admin/self-service-applications', 'GET', ['platform.identity-review.read']],
      ['admin.selfServiceApplicationReject', `/api/v1/admin/self-service-applications/${applicationId}/reject`, 'POST',
        ['platform.facility.manage']],
      // hid-system R16 and R15: the open applications' search by CAC number, and the waiver of a 7-day refusal.
      ['admin.selfServiceApplicationSearch', '/api/v1/admin/self-service-applications/search', 'POST',
        ['platform.identity-review.read']],
      ['admin.selfServiceApplicationWaiveRefusal', '/api/v1/admin/self-service-applications/waive-refusal', 'POST',
        ['platform.facility.manage']],
    ] as const
    for (const [name, example, method, permission] of routes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'admin', methods: [method], status: 'proposed',
        auth: { kind: 'authenticated' }, permissions: { [method]: permission } })
      expect(assertRegisteredBrowserRequest(method, example).name).toBe(name)
      expect(() => assertRegisteredBrowserRequest(method === 'GET' ? 'POST' : 'GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('admin-web', name)).not.toThrow()
      for (const app of ['staff-web', 'patient-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    // What the second backend review changed (R15, R16): the list's total and holdsCac, and allowRetry.
    expect(findEndpoint('admin.selfServiceApplications')?.note).toContain('{ total, items }')
    expect(findEndpoint('admin.selfServiceApplications')?.note).toContain('holdsCac')
    for (const name of ['admin.selfServiceApplicationReject', 'admin.selfServiceFacilityRelease']) {
      expect(findEndpoint(name)?.note, name).toContain('allowRetry')
    }
    expect(findEndpoint('admin.selfServiceApplicationWaiveRefusal')?.note).toContain('404 SELF_SERVICE_REFUSAL_NOT_FOUND')
  })

  it('registers P4b\'s staff routes for the provider portal, its public join routes and the withdrawal for the provider '
    + 'portal only, and support\'s new commands and reads for the console', () => {
    const invitationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const membershipId = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'
    const staff = [
      ['identity.facilityStaff', 'GET', '/api/v1/identity/facility-staff', ['workforce.manage']],
      ['identity.facilityAdministratorLicence', 'POST', '/api/v1/identity/facility-staff/administrator-licence', ['workforce.manage']],
      ['identity.staffInvitationCreate', 'POST', '/api/v1/identity/staff-invitations', ['workforce.manage']],
      ['identity.staffInvitationResend', 'POST', `/api/v1/identity/staff-invitations/${invitationId}/resend`, ['workforce.manage']],
      ['identity.staffInvitationRevoke', 'POST', `/api/v1/identity/staff-invitations/${invitationId}/revoke`, ['workforce.manage']],
      ['identity.facilityStaffEnd', 'POST', `/api/v1/identity/facility-staff/${membershipId}/end`, ['workforce.manage']],
      ['identity.facilityStaffRole', 'POST', `/api/v1/identity/facility-staff/${membershipId}/role`, ['workforce.manage']],
      // Signed in, with no facility and no permission (Identity's @FacilityOptional, @NoAudit).
      ['identity.staffInvitationSignedInPreview', 'POST', '/api/v1/identity/staff-invitations/signed-in/preview', undefined],
      ['identity.staffInvitationSignedInAccept', 'POST', '/api/v1/identity/staff-invitations/signed-in/accept', undefined],
    ] as const
    for (const [name, method, example, permissions] of staff) {
      const endpoint = findEndpoint(name)
      expect(endpoint, name).toMatchObject({ service: 'identity', methods: [method], status: 'proposed', auth: { kind: 'authenticated' } })
      expect(endpoint?.permissions, name).toEqual(permissions ? { [method]: permissions } : undefined)
      expect(endpoint?.note, name).toContain('not served by hid-system main')
      // The static segments (signed-in, administrator-licence) win over the id routes.
      expect(assertRegisteredBrowserRequest(method, example).name, name).toBe(name)
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    const publicRoutes = [
      ['enrollment.staffInvitationOpen', '/api/v1/identity/staff-invitations/open'],
      ['enrollment.staffInvitationAccept', '/api/v1/identity/staff-invitations/accept'],
      ['enrollment.providerWithdraw', '/api/v1/identity/provider-enrollments/withdraw'],
    ] as const
    for (const [name, example] of publicRoutes) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'enrollment', methods: ['POST'], status: 'proposed',
        auth: { kind: 'public' } })
      expect(assertRegisteredBrowserRequest('POST', example).name, name).toBe(name)
      expect(() => assertRegisteredBrowserRequest('GET', example), name).toThrow(BrowserRouteError)
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    expect(findEndpoint('enrollment.staffInvitationOpen')?.note).toContain('Turnstile action staff-invitation')
    expect(findEndpoint('enrollment.providerWithdraw')?.note).toContain('no 7-day refusal')
    // The invitation route the email is sent through is the workload's only.
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/notifications/staff-invitation')).toThrow(BrowserRouteError)

    const applicationId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    const facilityId = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
    const admin = [
      ['admin.selfServiceFacilityAdministratorRole', 'POST',
        `/api/v1/admin/self-service-facilities/${applicationId}/administrator-role`, ['platform.facility.manage', 'platform.facility.unlock']],
      ['admin.selfServiceFacilityEndProbation', 'POST', `/api/v1/admin/self-service-facilities/${applicationId}/end-probation`,
        ['platform.facility.manage', 'platform.facility.unlock']],
      ['admin.facilityStaff', 'GET', `/api/v1/admin/facilities/${facilityId}/staff`, ['platform.principal.read']],
      ['admin.staffInvitationFind', 'GET', '/api/v1/admin/staff-invitations', ['platform.principal.read']],
    ] as const
    for (const [name, method, example, permissions] of admin) {
      expect(findEndpoint(name), name).toMatchObject({ service: 'admin', methods: [method], status: 'proposed',
        auth: { kind: 'authenticated' }, permissions: { [method]: permissions } })
      expect(assertRegisteredBrowserRequest(method, example, name === 'admin.staffInvitationFind' ? { reference: '3F2A9C1B' } : undefined)
        .name, name).toBe(name)
      expect(() => assertEndpointAllowed('admin-web', name), name).not.toThrow()
      for (const app of ['staff-web', 'patient-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    // The facility's status command keeps its own route beside the staff read.
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/admin/facilities/${facilityId}/status`).name).toBe('admin.facilityStatus')
    // The lookup needs its reference.
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/staff-invitations')).toThrow(BrowserRouteError)
    // The session answers and break-glass say what P4b adds.
    for (const name of ['auth.session', 'auth.refresh', 'auth.facility', 'enrollment.providerActivate']) {
      expect(findEndpoint(name)?.note, name).toContain('selfService')
    }
    expect(findEndpoint('access.breakGlass')?.note).toContain('EMERGENCY_PROBATION_LIMITED')
  })

  it('registers P4c\'s orders between facilities: sending and the directory for the provider portal, receiving for Lab and '
    + 'Pharmacy, the patient\'s list and Stop for the patient portal, and support\'s tools for the console', () => {
    const patientId = 'a0000000-0000-4000-8000-0000004f9c2e'
    const encounterId = 'b0000000-0000-4000-8000-000000000001'
    const orderId = 'c0000000-0000-4000-8000-000000000002'
    const routeId = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
    const facilityId = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
    const lab = `/api/v1/ehr/patients/${patientId}/encounters/${encounterId}/lab-requests/${orderId}`
    const prescription = `/api/v1/ehr/patients/${patientId}/encounters/${encounterId}/prescriptions/${orderId}`
    type Case = readonly [string, string, string, Record<string, string> | undefined, readonly string[] | undefined]
    const staff: readonly Case[] = [
      ['identity.orderDestinations', 'GET', '/api/v1/identity/order-destinations', { kind: 'laboratory', query: 'Yaba' }, ['ehr.order-route.send']],
      ['ehr.labRequestOrderRoutes', 'GET', `${lab}/order-routes`, undefined, ['ehr.lab-request.read']],
      ['ehr.labRequestOrderRoutes', 'POST', `${lab}/order-routes`, undefined, ['ehr.lab-request.write', 'ehr.order-route.send']],
      ['ehr.labRequestOrderRouteWithdraw', 'POST', `${lab}/order-routes/${routeId}/withdraw`, undefined, ['ehr.order-route.send']],
      ['ehr.prescriptionOrderRoutes', 'GET', `${prescription}/order-routes`, undefined, ['ehr.prescription.read']],
      ['ehr.prescriptionOrderRoutes', 'POST', `${prescription}/order-routes`, undefined, ['ehr.prescription.write', 'ehr.order-route.send']],
      ['ehr.prescriptionOrderRouteWithdraw', 'POST', `${prescription}/order-routes/${routeId}/withdraw`, undefined, ['ehr.order-route.send']],
      ['ehr.orderRouteAttestation', 'GET', '/api/v1/ehr/order-route-attestation', { kind: 'lab_request' }, ['ehr.order-route.send']],
      ['lab.orderRoutes', 'GET', '/api/v1/lab/order-routes', { view: 'incoming' }, ['lab.order-route.receive']],
      ['lab.orderRouteSearch', 'POST', '/api/v1/lab/order-routes/search', undefined, ['lab.order-route.receive']],
      ['lab.orderRoute', 'GET', `/api/v1/lab/order-routes/${routeId}`, undefined, ['lab.order-route.receive']],
      ['lab.orderRouteAccept', 'POST', `/api/v1/lab/order-routes/${routeId}/accept`, undefined, ['lab.order-route.receive']],
      ['lab.orderRouteDecline', 'POST', `/api/v1/lab/order-routes/${routeId}/decline`, undefined, ['lab.order-route.receive']],
      ['pharmacy.orderRoutes', 'GET', '/api/v1/pharmacy/order-routes', { view: 'incoming' }, ['pharmacy.order-route.receive']],
      ['pharmacy.orderRouteSearch', 'POST', '/api/v1/pharmacy/order-routes/search', undefined, ['pharmacy.order-route.receive']],
      ['pharmacy.orderRoute', 'GET', `/api/v1/pharmacy/order-routes/${routeId}`, undefined, ['pharmacy.order-route.receive']],
      ['pharmacy.orderRouteAccept', 'POST', `/api/v1/pharmacy/order-routes/${routeId}/accept`, undefined, ['pharmacy.order-route.receive']],
      ['pharmacy.orderRouteDecline', 'POST', `/api/v1/pharmacy/order-routes/${routeId}/decline`, undefined, ['pharmacy.order-route.receive']],
    ]
    const patient: readonly Case[] = [
      ['ehr.myOrderRoutes', 'GET', '/api/v1/ehr/me/order-routes', undefined, undefined],
      ['ehr.myOrderRouteWithdraw', 'POST', `/api/v1/ehr/me/order-routes/${routeId}/withdraw`, undefined, undefined],
    ]
    const admin: readonly Case[] = [
      ['admin.facilityOrderRouteSummary', 'GET', `/api/v1/admin/facilities/${facilityId}/order-route-summary`, undefined, ['platform.facility.read']],
      ['admin.facilityOrderDestination', 'POST', `/api/v1/admin/facilities/${facilityId}/order-destination`, undefined,
        ['platform.facility.manage', 'platform.facility.unlock']],
      ['admin.orderRoutesFind', 'GET', '/api/v1/admin/order-routes', { reference: '9C1B2D3E' }, ['platform.principal.read']],
      ['admin.orderRoutesSearch', 'POST', '/api/v1/admin/order-routes/search', undefined, ['platform.principal.read']],
      ['admin.orderRouteClose', 'POST', `/api/v1/admin/order-routes/${routeId}/close`, undefined, ['platform.facility.manage']],
    ]
    const apps = ['staff-web', 'patient-web', 'admin-web', 'public-web'] as const
    for (const [cases, app] of [[staff, 'staff-web'], [patient, 'patient-web'], [admin, 'admin-web']] as const) {
      for (const [name, method, example, query, permissions] of cases) {
        const endpoint = findEndpoint(name)
        expect(endpoint, name).toMatchObject({ status: 'proposed', auth: { kind: 'authenticated' } })
        expect(endpoint?.permissions?.[method as 'GET' | 'POST'], `${method} ${name}`).toEqual(permissions)
        expect(endpoint?.note, name).toContain('not served by hid-system main')
        expect(assertRegisteredBrowserRequest(method, example, query).name, `${method} ${name}`).toBe(name)
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).not.toThrow()
        for (const other of apps.filter(candidate => candidate !== app)) {
          expect(() => assertEndpointAllowed(other, name), `${other}: ${name}`).toThrow(BoundaryViolationError)
        }
      }
    }
    // The directory needs its kind and words, the attestation its kind; support's GET finds an order by its reference.
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/order-destinations', { kind: 'laboratory' })).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/order-route-attestation')).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/admin/order-routes', { reference: '9C1B2D3E' }).name).toBe('admin.orderRoutesFind')
    // The static attestation path is not a lab request, and a route's own read is not its accept.
    expect(() => assertRegisteredBrowserRequest('POST', `/api/v1/lab/order-routes/${routeId}`)).toThrow(BrowserRouteError)
    // The searches (P4c review) are POSTs: support's is never read with a GET.
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/order-routes/search')).toThrow(BrowserRouteError)
    // Since hid-system #116 the GETs refuse a healthId query: a Health ID goes in the searches' bodies.
    for (const name of ['lab.orderRoutes', 'pharmacy.orderRoutes', 'admin.orderRoutesFind']) {
      expect(findEndpoint(name)?.note, name).toContain('HEALTH_ID_NOT_ACCEPTED_IN_URL')
      expect(findEndpoint(name)?.note, name).not.toContain('deprecated')
    }
    expect(findEndpoint('admin.orderRoutesFind')?.note).not.toContain('20 by Health ID')
    expect(findEndpoint('admin.orderRoutesSearch')?.note).toContain('20 by Health ID')
    for (const name of ['lab.orderRouteAccept', 'pharmacy.orderRouteAccept']) {
      expect(findEndpoint(name)?.note, name).toContain('_REFERENCE_MISMATCH')
    }
    expect(findEndpoint('ehr.myOrderRoutes')?.note).toContain('enteredInError')
    // What P4c adds to routes the website already calls.
    for (const name of ['ehr.labRequests', 'ehr.prescriptions']) expect(findEndpoint(name)?.note, name).toContain('crossFacilityOrders')
    for (const name of ['lab.workItems', 'pharmacy.workItems']) expect(findEndpoint(name)?.note, name).toContain('crossFacilityWork')
    expect(findEndpoint('ehr.labRequest')?.note).toContain('ORDER_ROUTED')
    expect(findEndpoint('ehr.labRequestLabWorkItem')?.note).toContain('LAB_REQUEST_ROUTED')
    expect(findEndpoint('ehr.prescriptionPharmacy')?.note).toContain('PRESCRIPTION_ROUTED')
    expect(findEndpoint('admin.controls')?.note).toContain('cross_facility_orders_enabled')
    expect(findEndpoint('admin.controls')?.note).toContain('cross_facility_route_access_enabled')
    expect(findEndpoint('enrollment.providerAvailability')?.note).toContain('crossFacilityOrders')
  })

  it('registers item 3\'s wrong-patient report: the receiver\'s command for Lab and Pharmacy, the ordering facility\'s '
    + 'Overview read for the provider portal, and support\'s list and review for the console, served since bd8676e', () => {
    const routeId = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
    const reportId = '3b5e7a90-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
    type Case = readonly [string, 'GET' | 'POST', string, Record<string, string> | undefined, readonly string[], 'staff-web' | 'admin-web']
    const cases: readonly Case[] = [
      ['lab.orderRouteWrongPatient', 'POST', `/api/v1/lab/order-routes/${routeId}/wrong-patient`, undefined, ['lab.order-route.receive'], 'staff-web'],
      ['pharmacy.orderRouteWrongPatient', 'POST', `/api/v1/pharmacy/order-routes/${routeId}/wrong-patient`, undefined,
        ['pharmacy.order-route.receive'], 'staff-web'],
      ['ehr.orderRoutesWrongPatient', 'GET', '/api/v1/ehr/order-routes/wrong-patient', undefined, ['ehr.order-route.send'], 'staff-web'],
      ['admin.wrongPatientReports', 'GET', '/api/v1/admin/wrong-patient-reports', { status: 'unreviewed' }, ['platform.facility.read'], 'admin-web'],
      ['admin.wrongPatientReportReview', 'POST', `/api/v1/admin/wrong-patient-reports/${reportId}/review`, undefined,
        ['platform.facility.manage'], 'admin-web'],
    ]
    for (const [name, method, example, query, permissions, app] of cases) {
      const endpoint = findEndpoint(name)
      expect(endpoint, name).toMatchObject({ status: 'proposed', auth: { kind: 'authenticated' }, methods: [method] })
      expect(endpoint?.permissions?.[method], name).toEqual(permissions)
      // Item 3 is live since hid-system bd8676e (D17's registry correction, SPEC-FINAL §9.5).
      expect(endpoint?.note, name).toContain('Served by staging-novu-ci-20261005 since hid-system bd8676e')
      expect(endpoint?.note, name).toContain('not served by hid-system main')
      expect(endpoint?.note, name).not.toContain('before that release')
      expect(endpoint?.note, name).toContain('0088')
      expect(assertRegisteredBrowserRequest(method, example, query).name, `${method} ${name}`).toBe(name)
      expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).not.toThrow()
      for (const other of (['staff-web', 'patient-web', 'admin-web', 'public-web'] as const).filter(candidate => candidate !== app)) {
        expect(() => assertEndpointAllowed(other, name), `${other}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
    // The report's own path is not the route's read, nor its accept; the Overview read is not a patient's list.
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/lab/order-routes/${routeId}/wrong-patient`)).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/lab/order-routes/${routeId}`).name).toBe('lab.orderRoute')
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/ehr/order-routes/wrong-patient')).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/me/order-routes').name).toBe('ehr.myOrderRoutes')
    // Support's list needs its status; the review is a POST.
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/wrong-patient-reports')).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/admin/wrong-patient-reports',
      { status: 'recent', facilityId: '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f' }).name).toBe('admin.wrongPatientReports')
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/admin/wrong-patient-reports/${reportId}/review`)).toThrow(BrowserRouteError)
    // What the command answers and refuses, and what it adds to the reads the website already makes.
    for (const name of ['lab.orderRouteWrongPatient', 'pharmacy.orderRouteWrongPatient']) {
      const note = findEndpoint(name)?.note ?? ''
      for (const word of ['Idempotency-Key', 'expectedVersion', 'wrong_order_chosen', 'someone_elses_details', 'suspected_misuse',
        'resultsVoided', 'resultReportsMarked', 'dispensingReversed', 'replayed', 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED',
        'ORDER_ROUTE_NOT_ACCEPTED', 'ORDER_ROUTE_ALREADY_ENDED', 'ORDER_ROUTE_CHANGED_CONCURRENTLY', 'VERSION_CONFLICT',
        'CROSS_FACILITY_ORDERS_UNAVAILABLE', 'VALIDATION_FAILED', 'ORDER_ROUTE_INVALID', 'IDEMPOTENCY_KEY_REQUIRED',
        'problem member permission']) expect(note, `${name}: ${word}`).toContain(word)
      // The services answer a body refused by validation as VALIDATION_FAILED (as accept and decline), and put the
      // missing permission in a top-level problem member, not under `extensions` (item 3 integration).
      expect(note, name).not.toContain('extensions.permission')
    }
    for (const name of ['lab.workItems', 'pharmacy.workItems']) {
      expect(findEndpoint(name)?.note, name).toContain('version')
      expect(findEndpoint(name)?.note, name).toContain('endedKind')
    }
    for (const name of ['ehr.labRequestOrderRoutes', 'ehr.prescriptionOrderRoutes', 'ehr.myOrderRoutes', 'admin.orderRoutesFind']) {
      expect(findEndpoint(name)?.note, name).toContain('wrong_patient')
    }
    expect(findEndpoint('ehr.myOrderRoutes')?.note).toContain('ORDER_ROUTE_WRONG_PATIENT')
    expect(findEndpoint('admin.wrongPatientReports')?.note).toContain('404 ADMIN_FACILITY_NOT_FOUND')
    expect(findEndpoint('admin.wrongPatientReports')?.note).toContain('no patient and no order content')
    expect(findEndpoint('ehr.orderRoutesWrongPatient')?.note).toContain('never a patient\'s name')
    expect(findEndpoint('admin.wrongPatientReportReview')?.note).toContain('If-Match')
  })

  it('registers D17\'s late correction for Lab and Pharmacy (hid-system 0090): the lookup by reference and the withdrawal, '
    + 'served since D17\'s release, with the services\' codes and problem members', () => {
    const routeId = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
    type Case = readonly [string, string, string]
    const cases: readonly Case[] = [
      ['lab.orderRouteCorrectable', '/api/v1/lab/order-routes/correctable', 'lab.order-route.receive'],
      ['lab.orderRouteWrongPatientCorrection', `/api/v1/lab/order-routes/${routeId}/wrong-patient-correction`, 'lab.order-route.receive'],
      ['pharmacy.orderRouteCorrectable', '/api/v1/pharmacy/order-routes/correctable', 'pharmacy.order-route.receive'],
      ['pharmacy.orderRouteWrongPatientCorrection', `/api/v1/pharmacy/order-routes/${routeId}/wrong-patient-correction`,
        'pharmacy.order-route.receive'],
    ]
    for (const [name, example, permission] of cases) {
      const endpoint = findEndpoint(name)
      expect(endpoint, name).toMatchObject({ status: 'proposed', auth: { kind: 'authenticated' }, methods: ['POST'] })
      expect(endpoint?.permissions?.POST, name).toEqual([permission])
      // Served since D17's release (hid-system a3b1822, live): no longer "before that release".
      expect(endpoint?.note, name).toContain('Served by staging-novu-ci-20261005 since hid-system a3b1822')
      expect(endpoint?.note, name).toContain('not served by hid-system main (404)')
      expect(endpoint?.note, name).not.toContain('before that release')
      expect(endpoint?.note, name).toContain('0090')
      expect(assertRegisteredBrowserRequest('POST', example).name, name).toBe(name)
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      for (const other of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(other, name), `${other}: ${name}`).toThrow(BoundaryViolationError)
      }
      // Both answer a body refused by validation as VALIDATION_FAILED and a bad reference or note as ORDER_ROUTE_INVALID;
      // neither sends support's ORDER_ROUTE_LOOKUP_INVALID, and the permission is a top-level problem member (CT1).
      const note = endpoint?.note ?? ''
      for (const word of ['VALIDATION_FAILED', 'ORDER_ROUTE_INVALID', 'PERMISSION_DENIED', 'CROSS_FACILITY_ORDERS_UNAVAILABLE',
        'ORDER_ROUTE_UNAVAILABLE', 'direct-care']) expect(note, `${name}: ${word}`).toContain(word)
      expect(note, name).not.toContain('extensions.permission')
    }
    // The lookup is a POST beside the route's GET: an id-shaped path is still the route's read, and its own path takes no GET.
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/lab/order-routes/${routeId}`).name).toBe('lab.orderRoute')
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/lab/order-routes/correctable')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/pharmacy/order-routes/${routeId}/wrong-patient-correction`))
      .toThrow(BrowserRouteError)
    for (const name of ['lab.orderRouteCorrectable', 'pharmacy.orderRouteCorrectable']) {
      const note = findEndpoint(name)?.note ?? ''
      for (const word of ['{ reference }', 'correction: open | correctable | reported | receiver_released | too_late', 'correctableUntil',
        'wrongPatient { reportedAt, late } | null', 'details', 'acceptedWith', 'returned [{ at, withdrawn }]',
        'items: [] when none was accepted here', 'never 404', 'no patient', 'lateCorrection: true']) {
        expect(note, `${name}: ${word}`).toContain(word)
      }
      expect(note, name).toContain('never answer ORDER_ROUTE_LOOKUP_INVALID')
    }
    // Support's find names the state of an order whose receiving facility was released (no deadline then).
    expect(findEndpoint('admin.orderRoutesFind')?.note)
      .toContain('correction (not_accepted | open | correctable | reported | receiver_released | too_late;')
    expect(findEndpoint('admin.orderRoutesFind')?.note).toContain('null for not_accepted, reported and receiver_released')
    for (const name of ['lab.orderRouteWrongPatientCorrection', 'pharmacy.orderRouteWrongPatientCorrection']) {
      const note = findEndpoint(name)?.note ?? ''
      for (const word of ['Idempotency-Key', 'expectedVersion', 'discoveredBy', 'own_check', 'discoveredOn', 'YYYY-MM-DD',
        'endedKindBefore', 'resultsVoided', 'resultReportsMarked', 'dispensingReversed', 'replayed',
        'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED', 'problem member permission', 'ORDER_ROUTE_NOT_ACCEPTED',
        'ORDER_ROUTE_STILL_OPEN', 'ORDER_ROUTE_ALREADY_REPORTED', 'ORDER_ROUTE_CORRECTION_TOO_LATE', 'IDEMPOTENCY_KEY_REUSED',
        'ORDER_ROUTE_CHANGED_CONCURRENTLY', 'VERSION_CONFLICT', 'ORDER_ROUTE_CORRECTION_LIMIT', 'problem member retryAfter',
        'IDEMPOTENCY_KEY_REQUIRED']) expect(note, `${name}: ${word}`).toContain(word)
      // As the services answer (the D17 integration's runtime answers): a body without discoveredBy is VALIDATION_FAILED,
      // and a discoveredOn in the right form that is no calendar date (2026-02-30) is ORDER_ROUTE_INVALID.
      expect(note, name).toContain('VALIDATION_FAILED (the body: a missing or unknown field')
      expect(note, name).toContain('ORDER_ROUTE_INVALID (a note under 8 once trimmed, discoveredOn not a calendar date, in the '
        + 'future or before the acceptance')
    }
    // What D17 adds to the reads the website already makes, each optional ("an earlier backend sends ...").
    for (const name of ['lab.workItems', 'pharmacy.workItems', 'ehr.labRequests', 'ehr.prescriptions',
      'ehr.orderRoutesWrongPatient', 'admin.orderRoutesFind', 'admin.wrongPatientReports']) {
      expect(findEndpoint(name)?.note, name).toContain('lateCorrection: true')
    }
    for (const name of ['ehr.labRequestOrderRoutes', 'ehr.prescriptionOrderRoutes', 'ehr.myOrderRoutes', 'admin.orderRoutesFind']) {
      expect(findEndpoint(name)?.note, name).toContain('correctableUntil')
      expect(findEndpoint(name)?.note, name).toContain('wrongPatient { reportedAt, late } | null')
    }
    expect(findEndpoint('ehr.myOrderRoutes')?.note).toContain('ORDER_ROUTE_WRONG_PATIENT_CORRECTED')
    expect(findEndpoint('ehr.orderRoutesWrongPatient')?.note).toContain('reportedAt, late and endedKindBefore')
    for (const word of ['late_correction', 'patient_prompted', 'patient_reported_before', 'requiredActions',
      'orderingSenderActive', 'reporterLateReportsLast30Days', 'discoveredOn']) {
      expect(findEndpoint('admin.wrongPatientReports')?.note, word).toContain(word)
    }
    expect(findEndpoint('admin.wrongPatientReportReview')?.note).toContain('400 WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED')
    expect(findEndpoint('admin.wrongPatientReportReview')?.note).toContain('problem member required')
  })

  it('registers D18\'s "We can\'t complete this order" for Lab and Pharmacy (hid-system 0091), not served yet, with the '
    + 'services\' body, answer, reasons, codes and problem members', () => {
    const routeId = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
    const cases = [['lab.orderRouteCannotComplete', 'lab'], ['pharmacy.orderRouteCannotComplete', 'pharmacy']] as const
    for (const [name, service] of cases) {
      const endpoint = findEndpoint(name)
      expect(endpoint, name).toMatchObject({ status: 'proposed', auth: { kind: 'authenticated' }, methods: ['POST'],
        path: `/api/v1/${service}/order-routes/:routeId/cannot-complete` })
      expect(endpoint?.permissions?.POST, name).toEqual([`${service}.order-route.receive`])
      expect(assertRegisteredBrowserRequest('POST', `/api/v1/${service}/order-routes/${routeId}/cannot-complete`).name, name).toBe(name)
      expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/${service}/order-routes/${routeId}/cannot-complete`), name)
        .toThrow(BrowserRouteError)
      // The route's own read is unchanged beside it.
      expect(assertRegisteredBrowserRequest('GET', `/api/v1/${service}/order-routes/${routeId}`).name).toBe(`${service}.orderRoute`)
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      for (const other of ['patient-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(other, name), `${other}: ${name}`).toThrow(BoundaryViolationError)
      }
      const note = endpoint?.note ?? ''
      expect(note, name).toContain('not served by hid-system main, nor by staging-novu-ci-20261005 before that release')
      expect(note, name).toContain('hid-system 0091 (staging-novu-ci-20261005)')
      for (const word of ['Idempotency-Key', 'IDEMPOTENCY_KEY_REQUIRED', 'direct-care', 'expectedVersion', 'confirmedPatient: true',
        'criticalValueTold?', 'Pharmacy refuses the field', 'receiving_unable', 'readUntil', 'specimensCollected', 'resultsRecorded',
        'criticalCandidates', 'replayed', 'never the patient', 'VALIDATION_FAILED', 'ORDER_ROUTE_INVALID', 'PERMISSION_DENIED',
        'ORDER_ROUTE_NOT_FOUND', 'ORDER_ROUTE_NOT_ACCEPTED', 'ORDER_ROUTE_ALREADY_ENDED', 'ORDER_ROUTE_ALREADY_RETURNED',
        'ORDER_ROUTE_RESULT_READY', 'ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD', 'IDEMPOTENCY_KEY_REUSED', 'ORDER_ROUTE_CHANGED_CONCURRENTLY',
        '412 VERSION_CONFLICT', 'CROSS_FACILITY_ORDERS_UNAVAILABLE', '429 ORDER_ROUTE_CANNOT_COMPLETE_LIMIT',
        'problem member retryAfter', '20 per staff member (counted by account, at every facility it belongs to) and 50 per facility',
        'up to 7 more days (never past its 30 days of work) only when a laboratory had opened an accession',
        'ORDER_ROUTE_UNAVAILABLE', 'ORDER_ROUTE_NOT_COMPLETED']) {
        expect(note, `${name}: ${word}`).toContain(word)
      }
      expect(note, name).not.toContain('extensions.')
    }
    // D18-5's lists, exactly as the services' DTOs, 0091's command and its endings table hold them (the backend's shared
    // fixture services/ehr-api/test/fixtures/order-route-cannot-complete-reasons.sql), each in the note.
    expect(ORDER_ROUTE_CANNOT_COMPLETE_REASONS).toEqual({
      lab_request: ['test_not_offered', 'supplies_unavailable', 'equipment_unavailable', 'sample_unusable', 'sample_not_obtained',
        'cannot_meet_priority', 'patient_declined', 'patient_did_not_return', 'other'],
      prescription: ['out_of_stock', 'medicine_unavailable', 'needs_prescriber_review', 'controlled_requirements',
        'cannot_meet_priority', 'patient_declined', 'patient_did_not_return', 'other'],
    })
    const note = findEndpoint('lab.orderRouteCannotComplete')?.note ?? ''
    expect(note).toContain(`Lab reason: ${ORDER_ROUTE_CANNOT_COMPLETE_REASONS.lab_request.join(' | ')};`)
    expect(note).toContain(`Pharmacy reason: ${ORDER_ROUTE_CANNOT_COMPLETE_REASONS.prescription.join(' | ')}.`)
    // What D18 adds to the reads the website already makes, each optional ("an earlier backend sends no such field").
    for (const name of ['lab.workItems', 'pharmacy.workItems', 'admin.orderRoutesFind', 'admin.facilityOrderRouteSummary']) {
      expect(findEndpoint(name)?.note, name).toContain('cannotComplete: true')
    }
    for (const name of ['ehr.labRequests', 'ehr.prescriptions', 'ehr.labRequestOrderRoutes', 'ehr.prescriptionOrderRoutes']) {
      expect(findEndpoint(name)?.note, name).toContain('notCompleted { reason, sampleTaken, resultRecorded } | null')
    }
    for (const name of ['lab.workItems', 'ehr.labRequestOrderRoutes', 'ehr.myOrderRoutes', 'admin.orderRoutesFind']) {
      expect(findEndpoint(name)?.note, name).toContain('receiving_unable')
    }
    // After the ending the services answer a Lab write 409 only under the patient's consent; while only the order lets
    // the laboratory read it (the 7 days after an accession), the row to write is not found: 404 (INTERFACE_CONTRACT §24,
    // the runtime verifier's answers). A dispensing is 409 ORDER_ROUTE_CLOSED.
    for (const name of ['lab.workItems', 'pharmacy.workItems']) {
      const note = findEndpoint(name)?.note ?? ''
      expect(note, name).toContain('a Lab write answers 409 ORDER_ROUTE_CLOSED under the patient\'s own consent and 404 while '
        + 'only the order lets this facility read it')
      expect(note, name).toContain('a dispensing 409 ORDER_ROUTE_CLOSED')
      expect(note, name).toContain('up to 7 days (never past the order\'s 30 days) only when a laboratory had opened an accession')
      expect(note, name).not.toContain('receiving_unable (access read while this facility may still read it, every write 409')
    }
    expect(findEndpoint('ehr.myOrderRoutes')?.note).toContain('ORDER_ROUTE_NOT_COMPLETED')
    expect(findEndpoint('admin.facilityOrderRouteSummary')?.note).toContain('notCompleted { last30Days, soonAfterAcceptance, '
      + 'afterSevenDays, laterReportedWrongPatient, byReason { <reason>: count } }')
  })

  it('names what item 4 (hid-system 0089) adds to the answers the website already reads, as the services answer them', () => {
    for (const name of ['lab.workItems', 'pharmacy.workItems']) {
      const note = findEndpoint(name)?.note ?? ''
      for (const word of ['receives', 'routesHere { waiting, held }', 'receive permission', 'an earlier backend sends neither']) {
        expect(note, `${name}: ${word}`).toContain(word)
      }
    }
    for (const name of ['lab.orderRoutes', 'pharmacy.orderRoutes', 'lab.orderRouteSearch', 'pharmacy.orderRouteSearch']) {
      const note = findEndpoint(name)?.note ?? ''
      expect(note, name).toContain('receives?, routesHere?, crossFacilityOrders, crossFacilityWork }')
      // The list's 423 while route access is off is a problem without either field, and the work list says them then
      // (item 4 integration: the services' answer, not an empty body).
      expect(note, name).toContain('423 is a problem without receives or routesHere')
      expect(note, name).not.toContain('has no body')
    }
    // Routes that answer no such field say nothing of it.
    for (const name of ['ehr.labRequestOrderRoutes', 'identity.orderDestinations']) {
      expect(findEndpoint(name)?.note, name).not.toMatch(/receives|routesHere/)
    }
    expect(findEndpoint('admin.orderRoutesFind')?.note).toContain('accessEndsAt?, closable?')
    expect(findEndpoint('admin.orderRoutesFind')?.note).toContain('an earlier Identity, or a schema before 0089, omits both')
    const summary = findEndpoint('admin.facilityOrderRouteSummary')?.note ?? ''
    expect(summary).toContain('destination? { receivingTypes: (laboratory | pharmacy)[], review: pending | reviewed | released | '
      + 'governed | legacy }')
    // The summary is the database's, passed through by every Identity (item 4 integration: 22cd47f's and aba7c16's
    // Identity answer destination on the 0089 schema), so the schema decides whether it is sent, not the Identity.
    expect(summary).toContain('any Identity sends it once 0089 is applied and none before')
    expect(summary).not.toContain('an earlier Identity sends none')
  })

  it('never sends a Health ID in the address of an order-route lookup (hid-system #116)', () => {
    const refusal = (run: () => unknown): unknown => {
      try { run() } catch (error) { return error }
      return undefined
    }
    const lookups = { '/api/v1/lab/order-routes': 'lab.orderRoutes', '/api/v1/pharmacy/order-routes': 'pharmacy.orderRoutes',
      '/api/v1/admin/order-routes': 'admin.orderRoutesFind' } as const
    expect(HID_ENDPOINTS.filter(endpoint => endpoint.forbiddenQuery).map(endpoint => endpoint.name).sort())
      .toEqual(Object.values(lookups).sort())
    for (const [path, name] of Object.entries(lookups)) {
      expect(findEndpoint(name)?.forbiddenQuery, name).toEqual({ GET: ['healthId'] })
      // Refused before transport in every form the backend refuses, alone or beside an allowed key, with a message
      // that never repeats the value.
      for (const query of [{ healthId: 'HID-7KQ2M9' }, { view: 'incoming', healthId: 'HID-7KQ2M9' },
        { reference: '9C1B2D3E', healthId: 'HID-7KQ2M9' }, { 'healthId[]': 'HID-7KQ2M9' }, { healthId: ' ' }]) {
        const error = refusal(() => assertRegisteredBrowserRequest('GET', path, query))
        expect(error, `${name} ${Object.keys(query).join(',')}`).toBeInstanceOf(BrowserRouteError)
        expect(error, `${name} ${Object.keys(query).join(',')}`).toMatchObject({ code: 'FORBIDDEN_QUERY' })
        expect((error as Error).message).not.toContain('HID-7KQ2M9')
      }
    }
    // A value the HTTP client leaves out of the URL is not sent, so it is not refused.
    for (const healthId of [undefined, null, '']) {
      expect(assertRegisteredBrowserRequest('GET', '/api/v1/lab/order-routes', { view: 'recent', healthId }).name).toBe('lab.orderRoutes')
      expect(assertRegisteredBrowserRequest('GET', '/api/v1/admin/order-routes', { reference: '9C1B2D3E', healthId }).name)
        .toBe('admin.orderRoutesFind')
    }
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/pharmacy/order-routes').name).toBe('pharmacy.orderRoutes')
    // Support's GET finds by reference only; the searches take the Health ID in their bodies, and a route's own read
    // is not a lookup.
    expect(refusal(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/order-routes'))).toMatchObject({ code: 'REQUIRED_QUERY' })
    expect(refusal(() => assertRegisteredBrowserRequest('GET', '/api/v1/admin/order-routes', { reference: ' ' })))
      .toMatchObject({ code: 'REQUIRED_QUERY' })
    for (const path of ['/api/v1/lab/order-routes/search', '/api/v1/pharmacy/order-routes/search', '/api/v1/admin/order-routes/search']) {
      expect(() => assertRegisteredBrowserRequest('POST', path), path).not.toThrow()
    }
    expect(findEndpoint('lab.orderRoute')?.forbiddenQuery).toBeUndefined()
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
