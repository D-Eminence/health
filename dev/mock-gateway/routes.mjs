/**
 * The mock gateway's answers, shared by the Node server (server.mjs) and the
 * in-page preview shim (browser-shim.mjs). Sample data only. UI work only.
 */
export const CSRF = 'mock-csrf'
const options = { facility: 'blue' }
/** `facility`: 'blue' (Demo Hospital, blue EHR) or 'classic'. */
export function configure(next) { Object.assign(options, next) }

const now = () => new Date()
const iso = (offsetMs = 0) => new Date(now().getTime() + offsetMs).toISOString()
const DAY = 86_400_000
const MIN = 60_000

// ---------------------------------------------------------------- patient --
const patientSession = () => ({
  actor: { kind: 'patient', subject: 'subject-demo', patientId: 'patient-demo', accountId: 'account-demo', authenticationMethod: 'local' },
  expiresAt: iso(30 * DAY),
})

const patient = {
  me: {
    patientId: 'patient-demo', hid: 'HID-ADA2345', firstName: 'Adaeze', lastName: 'Okafor', fullName: 'Adaeze Okafor',
    dateOfBirth: '1991-03-04', gender: 'female', country: 'NG', state: 'Lagos', assuranceState: 'NIN_VERIFIED',
    accessPinConfigured: false, version: 1, ninVerified: true, email: 'adaeze@example.test', emailVerified: true,
    phone: '+2348031234567', phoneVerified: true, hasPhoto: false,
  },
  profileDetails: { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: 'Hygeia HMO', rowVersion: 1 },
  healthProfile: {
    bloodGroup: 'O+', genotype: 'AA', allergies: 'Penicillin', currentMedications: null, chronicConditions: null,
    medicalNotes: null, rowVersion: 1, updatedAt: '2026-10-20T07:00:00.000Z',
  },
  records: {
    encounters: [
      { id: 'enc-1', facilityId: 'f-1', encounterType: 'outpatient_visit', status: 'completed', startedAt: '2026-10-20T09:00:00Z', endedAt: '2026-10-20T10:00:00Z' },
      { id: 'enc-2', facilityId: 'f-2', encounterType: 'outpatient_visit', status: 'completed', startedAt: '2026-08-02T14:00:00Z', endedAt: '2026-08-02T14:40:00Z' },
    ],
    notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'f-1', noteType: 'consultation', title: 'Malaria review', status: 'signed', revisionNo: 1, content: 'Fever resolving. Continue ACT, review in one week.', signedAt: '2026-10-20T10:05:00Z' }],
    vitals: [{ id: 'v-1', encounterId: 'enc-1', facilityId: 'f-1', recordedAt: '2026-10-20T09:10:00Z', heightCm: 168, weightKg: 64, temperatureC: 37.8, pulseBpm: 88, respiratoryRate: 18, systolicMmhg: 118, diastolicMmhg: 76, oxygenSaturationPercent: 98, source: 'manual' }],
    diagnoses: [{ id: 'd-1', encounterId: 'enc-1', facilityId: 'f-1', codeSystem: 'ICD-10', code: 'B54', display: 'Malaria, unspecified', clinicalStatus: 'active', verificationStatus: 'confirmed', onsetAt: '2026-10-19T00:00:00Z', abatementAt: null, notes: null }],
    prescriptions: [{ id: 'p-1', encounterId: 'enc-1', facilityId: 'f-1', medicationCodeSystem: null, medicationCode: null, medicationDisplay: 'Artemether/Lumefantrine 80/480 mg', doseQuantity: 1, doseUnit: 'tablet', routeCode: 'oral', frequency: 'twice daily', instructions: 'Take with food for 3 days', startsOn: '2026-10-20', endsOn: '2026-10-23', status: 'active' }],
    labRequests: [{ id: 'l-1', encounterId: 'enc-1', facilityId: 'f-1', testCodeSystem: 'LOINC', testCode: '32700-7', testDisplay: 'Malaria smear', priority: 'routine', status: 'completed', specimenTypeCode: 'blood', clinicalInformation: null, externalOrderReference: null, createdAt: '2026-10-20T09:20:00Z' }],
    documents: [{ id: 'doc-1', encounterId: 'enc-1', facilityId: 'f-1', fileName: 'malaria-smear-result.pdf', mediaType: 'application/pdf', sizeBytes: 20480, classification: 'lab_report', status: 'available', createdAt: '2026-10-20T11:00:00Z' }],
    limit: 50,
  },
  accessHistory: () => ({ items: [
    { consentGrantId: 'g-1', scope: 'read', purpose: 'direct-care', status: 'active', startsAt: iso(-2 * DAY), expiresAt: iso(28 * DAY), reason: null, facilityName: 'Lagos General Hospital', patientRevocable: true, shareLevel: 'clinical_review', shareDuration: '30d' },
    { consentGrantId: 'g-2', scope: 'read', purpose: 'direct-care', status: 'expired', startsAt: iso(-90 * DAY), expiresAt: iso(-60 * DAY), reason: null, facilityName: 'Reddington Clinic', patientRevocable: false },
  ] }),
  accessRequests: () => [
    { accessRequestId: 'r-1', facilityId: 'f-3', facilityName: 'Ikeja Medical Centre', scope: 'read', reason: 'Follow-up consultation', status: 'pending', requestedDurationMinutes: 60, requestedAt: iso(-30 * MIN), approvedAt: null, deniedAt: null, deniedReason: null },
  ],
  notifications: () => [
    { id: 'n-1', notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request', resourceId: 'r-1', metadata: {}, readAt: null, createdAt: iso(-30 * MIN) },
    { id: 'n-2', notificationCode: 'RECORDS_OPENED', resourceType: 'record-access', resourceId: null, metadata: { facilityName: 'Lagos General Hospital' }, readAt: null, createdAt: iso(-1 * DAY) },
    { id: 'n-3', notificationCode: 'SECURITY_PASSWORD_CHANGED', resourceType: 'account', resourceId: null, metadata: {}, readAt: iso(-3 * DAY), createdAt: iso(-3 * DAY) },
  ],
  accessLog: () => ({ events: [
    { id: 'e-1', at: iso(-1 * DAY), action: 'viewed', actorKind: 'clinician', actorName: 'Dr Bello', facilityName: 'Lagos General Hospital' },
    { id: 'e-2', at: iso(-2 * DAY), action: 'access_granted', actorKind: 'patient', actorName: 'You', facilityName: 'Lagos General Hospital' },
  ], nextBefore: null }),
}

function patientRoute(method, path) {
  if (method !== 'GET') {
    if (/^\/identity\/me\/notifications\/[^/]+\/read$/.test(path)) return [200, { id: path.split('/')[4], readAt: iso() }]
    return null
  }
  switch (path) {
    case '/identity/me': return [200, patient.me]
    case '/identity/me/profile-details': return [200, patient.profileDetails]
    case '/ehr/me/health-profile': return [200, patient.healthProfile]
    case '/ehr/me/records': return [200, patient.records]
    case '/identity/me/access-history': return [200, patient.accessHistory()]
    case '/identity/me/access-requests': return [200, patient.accessRequests()]
    case '/identity/me/notifications': return [200, patient.notifications()]
    case '/identity/me/notifications/unread-count': return [200, { unread: 2 }]
    case '/identity/me/access-log': return [200, patient.accessLog()]
    case '/identity/me/share-invitations': return [200, { items: [], limits: { maxOpen: 20, maxNewPerDay: 5, remainingToday: 5 } }]
    case '/identity/me/emergency-contacts/availability': return [200, { delivery: true, channels: ['sms', 'email'] }]
    case '/identity/me/emergency-contacts': return [200, [
      { contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms', destinationHint: '+234•••••567', status: 'verified', verifiedAt: '2026-10-01T00:00:00Z', notifyOnEmergencyAccess: true, eligibleForEmergencyNotification: true, version: 1, pendingVerification: null, lastNotification: null },
    ]]
    case '/identity/me/account-deletion': return [200, { waitingPeriodSeconds: 1209600, confirmationTtlSeconds: 600, request: null }]
    case '/identity/me/imported-notifications': return [200, []]
    default: return null
  }
}

// --------------------------------------------------------------- provider --
const DEMO_FACILITY_ID = '98d00002-0000-4000-8000-000000000001' // blue EHR demo facility
const CLASSIC_FACILITY_ID = 'f0000000-0000-4000-8000-000000000001'
const STAFF_PERMISSIONS = [
  'identity.patient.read', 'identity.registration.write', 'identity.registration.approve', 'identity.patient.assisted_registration',
  'identity.consent.read', 'identity.consent.write', 'identity.break-glass.write', 'identity.patient-access-pin.verify', 'audit.read',
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.vital.read', 'ehr.vital.write',
  'ehr.diagnosis.read', 'ehr.diagnosis.write', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.lab-request.read',
  'ehr.lab-request.write', 'ehr.document.read', 'ehr.document.write', 'ehr.imported-history.read',
  'lab.work-item.read', 'lab.work-item.accept', 'lab.accession.create', 'lab.accession.read', 'lab.specimen.collect',
  'lab.specimen.receive', 'lab.specimen.reject', 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete',
  'lab.result.enter', 'lab.result.verify', 'lab.result.release', 'lab.result.correct', 'lab.result.released.read',
  'pharmacy.work-item.read', 'pharmacy.work-item.accept', 'pharmacy.dispensing.create', 'pharmacy.dispensing.read', 'pharmacy.dispensing.reverse',
  'ocr.job.read', 'ocr.job.write', 'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write',
  'outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read', 'outreach.campaign.write',
  'billing.subscription.read', 'billing.subscription.manage',
]
const staffFacility = () => {
  const classic = options.facility === 'classic'
  return {
    id: classic ? CLASSIC_FACILITY_ID : DEMO_FACILITY_ID,
    membershipId: 'member-demo-1', organizationId: 'org-demo',
    name: classic ? 'Ikeja Clinic' : 'Demo Hospital', code: classic ? 'IKJ' : 'DEMO-H',
    roles: ['doctor'], permissions: STAFF_PERMISSIONS, isPrimary: true,
  }
}
const staffSession = () => {
  const facility = staffFacility()
  return {
    actor: { kind: 'staff', id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Dr Tunde Bello', roles: ['doctor'], permissions: [], facilities: [facility], facility },
    expiresAt: iso(30 * DAY), facilitySelection: 'selected',
  }
}
const DEMO_PATIENT_ID = 'a0000000-0000-4000-8000-000000000001'

function staffRoute(method, path) {
  if (method === 'POST' && path === '/auth/facility') return [200, staffSession()]
  if (method === 'POST' && path === '/identity/patient-lookup') return [200, {
    authorization: { decision: 'allow', consentGrantId: 'grant-1', expiresAt: iso(2 * 60 * MIN), breakGlass: false },
    patient: { patientId: DEMO_PATIENT_ID, hid: 'HID-ZDEMAAA2', fullName: 'Adaeze Okafor', dateOfBirth: '1991-03-04', gender: 'female', version: 1 },
  }]
  if (method !== 'GET') return null
  if (/^\/ehr\/patients\/[^/]+\/encounters(\/[^/]+\/[a-z-]+)?$/.test(path) || path === '/ehr/documents') return [200, { items: [], nextCursor: null }]
  switch (path) {
    case '/identity/access-requests': return [200, [
      { accessRequestId: 'ar-1', patientId: DEMO_PATIENT_ID, scope: 'read_records', purposeOfUse: 'direct-care', reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: iso(-20 * MIN), approvedAt: null, deniedAt: null, deniedReason: null, consentGrantId: null, grantExpiresAt: null, effectiveStatus: 'pending', authorizationMethod: null },
    ]]
    case '/identity/shared-with-me': return [200, { items: [] }]
    case '/identity/share-invitations': return [200, { eligible: false, items: [] }]
    case '/identity/registration-capabilities': return [200, { nin: { enabled: true, state: 'available' }, newPatientRegistrationRequiresNin: false }]
    case '/audit/events': return [200, { items: [
      { sequenceId: '12', occurredAt: iso(-2 * 60 * MIN), correlationId: 'corr-12', actorType: 'staff', action: 'ehr.encounter.create', outcome: 'success', resourceType: 'encounter' },
      { sequenceId: '11', occurredAt: iso(-5 * 60 * MIN), correlationId: 'corr-11', actorType: 'staff', action: 'identity.patient.lookup', outcome: 'success', resourceType: 'patient' },
    ], nextBeforeSequenceId: null }]
    case '/lab/work-items': return [200, { items: [
      { id: 'lw-1', patientId: DEMO_PATIENT_ID, version: 1, status: 'accepted', testName: 'Full blood count', acceptedAt: iso(-40 * MIN), priority: 'routine' },
      { id: 'lw-2', patientId: DEMO_PATIENT_ID, version: 1, status: 'accepted', testName: 'Malaria parasite test', acceptedAt: iso(-15 * MIN), priority: 'urgent' },
    ] }]
    case '/pharmacy/work-items': return [200, { items: [
      { id: 'rx-1', patientId: DEMO_PATIENT_ID, version: 1, acceptedAt: iso(-25 * MIN), medication: { display: 'Amoxicillin 500 mg' }, dispensing: null },
    ] }]
    case '/outreach/registration-cases/campaigns': return [200, []]
    case '/outreach/registration-cases': return [200, []]
    case '/commercial/subscription': return [200, { organizationId: 'org-demo', productCode: 'provider', status: 'active', trialEndsAt: null, currentPeriodEndsAt: iso(32 * DAY), graceEndsAt: null, price: null, selfServePayment: false }]
    case '/commercial/invoices': return [200, { items: [] }]
    case '/ocr/jobs': return [200, { job: null }]
    default: return null
  }
}

// ------------------------------------------------------------------ admin --
const ADMIN_ACTOR = {
  accountId: 'admin-1', subject: 'staff:admin-1', displayName: 'Akorede Admin', email: 'admin@example.test',
  platformRoles: ['platform_super_admin'],
  platformPermissions: [
    'platform.admin.access', 'platform.audit.read', 'platform.control.manage', 'platform.control.read',
    'platform.demo.manage', 'platform.demo.read', 'platform.facility.manage', 'platform.facility.read', 'platform.facility.unlock',
    'platform.identity-review.read', 'platform.integration.manage', 'platform.integration.read', 'platform.integration.test',
    'platform.mfa.reset', 'platform.operations.read', 'platform.pricing.manage', 'platform.pricing.read', 'platform.principal.export',
    'platform.principal.manage', 'platform.principal.read', 'platform.role.manage', 'platform.session.revoke', 'platform.workforce.manage',
  ],
}
const adminGrant = () => ({ actor: { ...ADMIN_ACTOR, kind: 'platform', sessionId: 's1' }, expiresAt: iso(8 * 60 * MIN), idleExpiresAt: iso(15 * MIN) })
const FACILITY_UUID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const adminFacilities = [
  { id: FACILITY_UUID, organizationId: 'org-1', organizationName: 'Lagos Health', name: 'Ikeja Clinic', code: 'IKJ', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z', membershipCount: 4, version: 3 },
  { id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', organizationId: 'org-2', organizationName: 'Reddington Group', name: 'Reddington Lekki', code: 'RDL', status: 'pending', statusReason: null, statusChangedAt: null, createdAt: '2026-10-12T09:00:00.000Z', membershipCount: 1, version: 1 },
]

function adminRoute(method, path) {
  if (method === 'POST' && path === '/auth/admin/refresh') return [200, adminGrant()]
  if (method === 'POST' && path === '/auth/admin/logout') return [204, null]
  if (method === 'POST' && path === '/admin/principals/search') return [200, { items: [], page: 1, pageSize: 25, total: 0 }]
  if (method !== 'GET') return null
  if (/^\/admin\/facilities\/[^/]+\/assisted-registration$/.test(path)) {
    return [200, { facilityId: path.split('/')[3], designated: false, status: null, addressLine: null, town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null }]
  }
  if (/^\/admin\/facilities\/[^/]+$/.test(path)) {
    const found = adminFacilities.find(f => f.id === path.split('/')[3])
    return found ? [200, found] : null
  }
  if (/^\/admin\/integrations\/[^/]+\/audit$/.test(path)) return [200, { items: [] }]
  switch (path) {
    case '/admin/session': return [200, { actor: ADMIN_ACTOR }]
    case '/admin/mfa': return [200, {
      enrolled: true, factorType: 'totp', activatedAt: '2026-10-01T09:00:00.000Z', lastUsedAt: iso(-60 * MIN), recoveryCodesRemaining: 8,
      session: { mfaVerifiedAt: iso(-60 * MIN), mfaMethod: 'totp', stepUpExpiresAt: null, idleExpiresAt: iso(15 * MIN), absoluteExpiresAt: iso(8 * 60 * MIN) },
    }]
    case '/admin/overview': return [200, { registeredPatients: 12480, facilities: 29, verifiedFacilities: 12, suspendedFacilities: 1, activeStaffMemberships: 214, pendingIdentityReviews: 3 }]
    case '/admin/approvals': return [200, { items: [
      { id: 'request-1', action: 'platform_role.grant', roleCode: 'platform_super_admin', targetAccountId: 'account-c', targetEmail: 'c@example.test', targetDisplayName: 'Chidi Operator', reason: 'Second on-call Super Admin', status: 'pending', requestedBy: 'admin-a', requestedAt: iso(-3 * 60 * MIN), expiresAt: iso(21 * 60 * MIN), decidedBy: null, decidedAt: null, decisionReason: null, executedAt: null, version: 1 },
    ], nextCursor: null }]
    case '/admin/organization-applications': return [200, { items: [
      { applicationId: 'app-1', productCode: 'ehr', organizationName: 'Ikeja Care Ltd', organizationType: 'clinic', cacHint: 'RC••••56', administratorName: 'Bola Admin', administratorEmail: 'bola@example.test', status: 'ready_for_review', verificationResult: 'verified', verifiedOrganizationName: 'IKEJA CARE LIMITED', verifiedEntityType: 'Limited company', verifiedRegistrationDate: '2015-04-01', verifiedAddress: '1 Allen Avenue, Ikeja', verifiedRegistryStatus: 'active', profileCompanyName: 'Ikeja Care Ltd', profileEntityType: null, profileRegistrationDate: null, profileAddress: null, profileRegistryStatus: null, profileState: 'complete', fieldSources: { companyName: 'qoreid' }, createdAt: '2026-10-01T09:00:00.000Z', verifiedAt: '2026-10-02T09:00:00.000Z', reviewedAt: null, version: 5 },
    ] }]
    case '/admin/demo-requests': return [200, { items: [
      { id: 'd1', contactName: 'Tolu Adeyemi', contactEmail: 'tolu@example.test', contactPhone: null, contactRole: 'Medical Director', organizationName: 'Surulere Family Clinic', organizationType: 'clinic', productCode: 'ehr', message: null, sourcePage: '/', sourceSection: null, ctaLabel: null, status: 'new', createdAt: iso(-1 * DAY), version: 1 },
    ], nextCursor: null }]
    case '/admin/integrations': return [200, {
      items: [{ provider: 'ses', name: 'AWS SES', enabled: true, health: 'healthy', managementMode: 'dashboard', availableActions: ['pause', 'configure'], capabilities: ['email'], activeCapabilities: ['email'], operationGates: [{ operation: 'send', state: 'available', detail: 'Ready to send' }], configuration: { fromAddress: 'no-reply@example.test' }, credential: { state: 'configured', rotationSupported: false }, lastTestedAt: null, lastSuccessfulTestAt: null, lastFailedTestAt: null, version: 7 }],
      capabilities: [{ capability: 'email', activeProvider: 'ses', fallbackProvider: null, eligibleProviders: ['ses'], version: 1 }],
    }]
    case '/admin/facilities': return [200, { items: adminFacilities, page: 1, pageSize: 25, total: adminFacilities.length }]
    case '/admin/identity/reviews': return [200, { items: [], page: 1, pageSize: 25, total: 0 }]
    case '/admin/clinician-applications': return [200, { items: [], nextCursor: null }]
    case '/admin/audit/events': return [200, { items: [
      { sequenceId: '7', eventId: 'event-7', occurredAt: iso(-4 * 60 * MIN), correlationId: 'corr-7', actorType: 'staff', actorSubject: 'staff:admin-1', facilityId: FACILITY_UUID, action: 'admin.facility.status.request', outcome: 'success', resourceType: 'facility', resourceId: FACILITY_UUID, purposeOfUse: 'operations', reason: 'Licence verified', sourceSystem: 'hid' },
    ], nextBeforeSequenceId: null }]
    case '/admin/sessions': return [200, { accountId: 'admin-1', items: [
      { sessionId: 's1', familyId: 'family-s1', kind: 'platform', authenticationMethod: 'password', signedInAt: iso(-60 * MIN), lastRefreshedAt: iso(-5 * MIN), idleExpiresAt: iso(15 * MIN), absoluteExpiresAt: iso(8 * 60 * MIN), mfaVerifiedAt: iso(-60 * MIN), mfaMethod: 'totp', lastStepUpAt: null, sourceIp: '203.0.113.7', current: true },
    ] }]
    case '/admin/operations/services': return [200, { checkedAt: iso(), services: ['gateway', 'identity', 'ehr', 'lab', 'pharmacy'].map(service => ({ service, state: 'healthy', checkedAt: iso(), code: null })) }]
    case '/admin/operations/events': return [200, { state: 'healthy', code: null, metrics: null, failures: [] }]
    case '/admin/controls': return [200, [{ controlKey: 'maintenance_mode', enabled: false, reason: 'Normal operation', updatedAt: '2026-10-01T09:00:00.000Z', version: 3 }]]
    case '/admin/pricing': return [200, {
      products: [{ slug: 'ehr', name: 'EHR', status: 'active', version: 1 }],
      prices: [{ product_slug: 'ehr', context: 'per_facility', visibility: 'fixed', amount_minor: 5000000, currency: 'NGN', billing_period: 'monthly', unit: null, active: true, version: 1 }],
    }]
    default: return null
  }
}


// Optional features that are off in the default build: the UI hides them on a 404, so they are not backend needs.
export const EXPECTED_404 = new Set(['GET /ehr/me/imported-history', 'GET /identity/me/web-push', 'GET /identity/me/photo'])

/** The workspace a request belongs to, from its path and the path of the page asking. */
export function workspaceFor(path, pagePath, forced) {
  if (path.startsWith('/admin/') || path.startsWith('/auth/admin/')) return 'admin'
  if (forced === 'patient' || forced === 'provider') return forced
  return pagePath.startsWith('/provider') ? 'provider' : 'patient'
}

/**
 * Answers one gateway request. `path` is the part after /api/v1, without query.
 * Returns { status, body, headers } or null when the mock has no answer.
 */
export function respond(method, path, workspace) {
  const csrfCookie = { 'Set-Cookie': `hid_access_csrf=${CSRF}; Path=/; SameSite=Lax` }
  if (path === '/auth/session' && method === 'GET') return { status: 200, body: workspace === 'provider' ? staffSession() : patientSession(), headers: csrfCookie }
  if (path === '/auth/refresh' && method === 'POST') return { status: 200, body: workspace === 'provider' ? staffSession() : patientSession(), headers: csrfCookie }
  if (path === '/auth/logout' && method === 'POST') return { status: 204, body: null, headers: {} }
  if (path === '/admin/session' && method === 'GET') {
    return { status: 200, body: { actor: ADMIN_ACTOR }, headers: { 'Set-Cookie': `hid_access_admin_csrf=${CSRF}; Path=/; SameSite=Lax` } }
  }
  const handler = workspace === 'admin' ? adminRoute : workspace === 'provider' ? staffRoute : patientRoute
  const hit = handler(method, path)
  return hit ? { status: hit[0], body: hit[1], headers: {} } : null
}

export function notServed(method, path) {
  return { type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: `Mock gateway does not serve ${method} ${path}` }
}
