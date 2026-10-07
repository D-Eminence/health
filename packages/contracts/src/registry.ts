/** Browser routes verified against hid-system c4b5445. Paths include /api/v1. */
export type HidService = 'auth' | 'enrollment' | 'identity' | 'access' | 'ehr' | 'files'
  | 'notifications' | 'lab' | 'pharmacy' | 'ocr' | 'outreach' | 'admin' | 'commercial' | 'platform' | 'support'
export type EndpointMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type EndpointAuth = { readonly kind: 'public' | 'authenticated' }
export type ContractStatus = 'surface-verified'
export interface EndpointDescriptor {
  readonly name: string
  readonly path: string
  readonly service: HidService
  readonly methods: readonly EndpointMethod[]
  readonly auth: EndpointAuth
  /** Per-method backend permissions, all required; absent means session only. */
  readonly permissions?: Partial<Record<EndpointMethod, readonly string[]>>
  /** Query keys required by a method; for example OCR job lookup is scoped to a document. */
  readonly requiredQuery?: Partial<Record<EndpointMethod, readonly string[]>>
  /** The shared JSON client cannot consume a download response. */
  readonly responseKind?: 'json' | 'download'
  readonly status: ContractStatus
  readonly note?: string
}

const G = ['GET'] as const, P = ['POST'] as const, GP = ['GET', 'POST'] as const
const GPA = ['GET', 'PATCH'] as const
const r = (name: string, service: HidService, path: string, methods: readonly EndpointMethod[],
  isPublic = false, permissions?: Partial<Record<EndpointMethod, readonly string[]>>,
  note?: string): EndpointDescriptor => ({ name, service, path, methods,
    auth: { kind: isPublic ? 'public' : 'authenticated' },
    ...(permissions ? { permissions } : {}), status: 'surface-verified',
    ...(note ? { note } : {}) })
const one = (method: EndpointMethod, ...permissions: string[]): Partial<Record<EndpointMethod, readonly string[]>> =>
  ({ [method]: permissions })

export const HID_ENDPOINTS: readonly EndpointDescriptor[] = [
  r('support.chat','support','/api/v1/support/chat',P,true),
  r('ehr.patientChat','ehr','/api/v1/ehr/me/chat',P),
  r('auth.patientLogin','auth','/api/v1/auth/patient/login',P,true),
  r('auth.staffLogin','auth','/api/v1/auth/login',P,true),
  r('auth.googleNonce','auth','/api/v1/auth/google/nonce',G,true),
  r('auth.googleOnboarding','auth','/api/v1/auth/google/onboarding',G,true),
  r('auth.googleExchange','auth','/api/v1/auth/oidc/exchange',P,true),
  r('auth.googleLink','auth','/api/v1/auth/google/link',P),
  r('auth.session','auth','/api/v1/auth/session',G),
  r('auth.refresh','auth','/api/v1/auth/refresh',P,true,undefined,'Requires refresh cookie and CSRF header.'),
  r('auth.logout','auth','/api/v1/auth/logout',P),
  r('auth.facility','auth','/api/v1/auth/facility',P),
  r('auth.otpStart','auth','/api/v1/auth/otp/start',P,true),
  r('auth.otpVerify','auth','/api/v1/auth/otp/verify',P,true),
  r('auth.otpComplete','auth','/api/v1/auth/otp/complete',P,true),

  r('enrollment.start','enrollment','/api/v1/identity/patient-enrollments',P,true),
  r('enrollment.current','enrollment','/api/v1/identity/patient-enrollments/current',G,true),
  r('enrollment.google','enrollment','/api/v1/identity/patient-enrollments/google',P,true),
  r('enrollment.contact','enrollment','/api/v1/identity/patient-enrollments/contact',P,true),
  r('enrollment.verifyContact','enrollment','/api/v1/identity/patient-enrollments/contact/verify',P,true),
  r('enrollment.activate','enrollment','/api/v1/identity/patient-enrollments/activate',P,true,undefined,
    'Returns HIDCode; does not create a login session.'),

  r('identity.me','identity','/api/v1/identity/me',G),
  r('identity.accessHistory','identity','/api/v1/identity/me/access-history',G),
  r('identity.accessPin','identity','/api/v1/identity/me/access-pin',['POST','DELETE']),
  r('identity.verifyNin','identity','/api/v1/identity/me/verification/nin',P),
  r('identity.facilityAudit','identity','/api/v1/audit/events',G,false,one('GET','audit.read'),
    'Gateway routes this path to Identity. Requires healthcare-operations purpose and active facility.'),
  r('identity.patientLookup','identity','/api/v1/identity/patient-lookup',P,false,one('POST','identity.patient.read')),
  r('identity.authorization','identity','/api/v1/identity/authorization/check',P,false,one('POST','identity.authorization.check')),
  r('identity.consentStatus','identity','/api/v1/identity/consent-status',P,false,one('POST','identity.consent.read')),
  r('identity.registrationCapabilities','identity','/api/v1/identity/registration-capabilities',G,false,one('GET','identity.registration.write')),
  r('identity.resolveNin','identity','/api/v1/identity/nin/resolve',P,false,one('POST','identity.registration.write')),
  r('identity.registrationCase','identity','/api/v1/identity/registration-cases/:caseId',G,false,one('GET','identity.registration.write')),
  r('identity.registrationApprove','identity','/api/v1/identity/registration-cases/:caseId/approve-new',P,false,one('POST','identity.registration.approve')),
  r('identity.registrationEnroll','identity','/api/v1/identity/registration-cases/:caseId/enroll',P,false,one('POST','identity.registration.approve')),
  r('identity.registrationLink','identity','/api/v1/identity/registration-cases/:caseId/link-existing',P,false,one('POST','identity.registration.approve')),
  r('identity.organizationApply','enrollment','/api/v1/identity/organization-applications',P,true),
  r('identity.organizationCompletionStart','enrollment','/api/v1/identity/organization-applications/completion/start',P,true),
  r('identity.organizationCompletionVerify','enrollment','/api/v1/identity/organization-applications/completion/verify',P,true),
  r('identity.organizationCompletionProfile','enrollment','/api/v1/identity/organization-applications/completion/profile',GPA,true),
  r('identity.organizationVerifyCac','identity','/api/v1/identity/organizations/verification/cac/:organizationContext',P,false,one('POST','organization.manage')),

  r('access.patientRequests','access','/api/v1/identity/me/access-requests',G),
  r('access.staffRequests','access','/api/v1/identity/access-requests',GP,false,{GET:['identity.consent.write'],POST:['identity.consent.write']}),
  r('access.approve','access','/api/v1/identity/access-requests/:requestId/approve',P),
  r('access.deny','access','/api/v1/identity/access-requests/:requestId/deny',P),
  r('access.breakGlass','access','/api/v1/identity/break-glass',P,false,one('POST','identity.consent.write','identity.break-glass.write')),
  r('access.verifyPin','access','/api/v1/identity/standard-access/pin',P,false,one('POST','identity.patient-access-pin.verify')),
  r('access.closeOwnGrant','access','/api/v1/identity/consent-grants/:grantId/close',P,false,one('POST','identity.consent.write')),
  r('notifications.list','notifications','/api/v1/identity/me/notifications',G),
  r('notifications.read','notifications','/api/v1/identity/me/notifications/:notificationId/read',P),

  r('ehr.myRecords','ehr','/api/v1/ehr/me/records',G),
  r('ehr.emergencyRecords','ehr','/api/v1/ehr/patients/:patientId/emergency-records',G,false,one('GET','ehr.encounter.read','ehr.note.read')),
  r('ehr.encounters','ehr','/api/v1/ehr/patients/:patientId/encounters',GP,false,{GET:['ehr.encounter.read'],POST:['ehr.encounter.write']}),
  r('ehr.encounter','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId',GPA,false,{GET:['ehr.encounter.read'],PATCH:['ehr.encounter.write']}),
  r('ehr.vitals','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals',GP,false,{GET:['ehr.vital.read'],POST:['ehr.vital.write']}),
  r('ehr.vital','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals/:vitalId',G,false,one('GET','ehr.vital.read')),
  r('ehr.vitalCorrections','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals/:vitalId/corrections',GP,false,{GET:['ehr.vital.read'],POST:['ehr.vital.write']}),
  r('ehr.notes','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes',GP,false,{GET:['ehr.note.read'],POST:['ehr.note.write']}),
  r('ehr.note','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes/:noteId',GPA,false,{GET:['ehr.note.read'],PATCH:['ehr.note.write']}),
  r('ehr.noteRevisions','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes/:noteId/revisions',GP,false,{GET:['ehr.note.read'],POST:['ehr.note.write']}),
  r('ehr.diagnoses','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/diagnoses',GP,false,{GET:['ehr.diagnosis.read'],POST:['ehr.diagnosis.write']}),
  r('ehr.diagnosis','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/diagnoses/:diagnosisId',GPA,false,{GET:['ehr.diagnosis.read'],PATCH:['ehr.diagnosis.write']}),
  r('ehr.prescriptions','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions',GP,false,{GET:['ehr.prescription.read'],POST:['ehr.prescription.write']}),
  r('ehr.prescription','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId',GPA,false,{GET:['ehr.prescription.read'],PATCH:['ehr.prescription.write']}),
  r('ehr.prescriptionPharmacy','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId/pharmacy-work-item',P,false,one('POST','pharmacy.work-item.accept')),
  r('ehr.labRequests','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests',GP,false,{GET:['ehr.lab-request.read'],POST:['ehr.lab-request.write']}),
  r('ehr.labRequest','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId',GPA,false,{GET:['ehr.lab-request.read'],PATCH:['ehr.lab-request.write']}),
  r('files.list','files','/api/v1/ehr/documents',G,false,one('GET','ehr.document.read')),
  r('files.uploadIntent','files','/api/v1/ehr/documents/upload-intents',P,false,one('POST','ehr.document.write')),
  r('files.complete','files','/api/v1/ehr/documents/:documentId/complete',P,false,one('POST','ehr.document.write')),
  r('files.download','files','/api/v1/ehr/documents/:documentId/download',G,false,one('GET','ehr.document.read')),

  r('lab.workItems','lab','/api/v1/lab/work-items',G,false,one('GET','lab.work-item.read')),
  r('lab.workItem','lab','/api/v1/lab/work-items/:workItemId',G,false,one('GET','lab.work-item.read')),
  r('lab.imports','lab','/api/v1/lab/imports',P,false,one('POST','lab.import.write')),
  r('lab.import','lab','/api/v1/lab/imports/:importId',G,false,one('GET','lab.import.read')),
  r('lab.createAccession','lab','/api/v1/lab/work-items/:workItemId/accession',P,false,one('POST','lab.accession.create')),
  r('lab.accession','lab','/api/v1/lab/accessions/:accessionId',G,false,one('GET','lab.accession.read')),
  r('lab.specimens','lab','/api/v1/lab/accessions/:accessionId/specimens',G,false,one('GET','lab.accession.read')),
  r('lab.collect','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/collect',P,false,one('POST','lab.specimen.collect')),
  r('lab.receive','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/receive',P,false,one('POST','lab.specimen.receive')),
  r('lab.reject','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/reject',P,false,one('POST','lab.specimen.reject')),
  r('lab.executions','lab','/api/v1/lab/specimens/:specimenId/executions',GP,false,{GET:['lab.execution.read'],POST:['lab.execution.start']}),
  r('lab.execution','lab','/api/v1/lab/executions/:executionId',G,false,one('GET','lab.execution.read')),
  r('lab.completeExecution','lab','/api/v1/lab/executions/:executionId/complete',P,false,one('POST','lab.execution.complete')),
  r('lab.results','lab','/api/v1/lab/executions/:executionId/results',P,false,one('POST','lab.result.enter')),
  r('lab.correctResult','lab','/api/v1/lab/executions/:executionId/results/:resultId/corrections',P,false,one('POST','lab.result.correct')),
  r('lab.verifyResult','lab','/api/v1/lab/results/:resultId/verify',P,false,one('POST','lab.result.verify')),
  r('lab.releaseResult','lab','/api/v1/lab/results/:resultId/release',P,false,one('POST','lab.result.release')),
  r('lab.resultHistory','lab','/api/v1/lab/results/:resultId/history',G,false,one('GET','lab.result.released.read')),
  r('pharmacy.workItems','pharmacy','/api/v1/pharmacy/work-items',G,false,one('GET','pharmacy.work-item.read')),
  r('pharmacy.workItem','pharmacy','/api/v1/pharmacy/work-items/:workItemId',G,false,one('GET','pharmacy.work-item.read')),
  r('pharmacy.dispense','pharmacy','/api/v1/pharmacy/work-items/:workItemId/dispensings',P,false,one('POST','pharmacy.dispensing.create')),
  r('pharmacy.dispensing','pharmacy','/api/v1/pharmacy/dispensings/:dispensingId',G,false,one('GET','pharmacy.dispensing.read')),
  r('pharmacy.reverse','pharmacy','/api/v1/pharmacy/dispensings/:dispensingId/reversals',P,false,one('POST','pharmacy.dispensing.reverse')),
  r('pharmacy.import','pharmacy','/api/v1/pharmacy/imports/:importId',G,false,one('GET','pharmacy.import.read')),

  { ...r('ocr.jobs','ocr','/api/v1/ocr/jobs',GP,false,{GET:['ocr.job.read'],POST:['ocr.job.write']}),
    requiredQuery: { GET: ['documentId'] } },
  r('ocr.job','ocr','/api/v1/ocr/jobs/:jobId',G,false,one('GET','ocr.job.read')),
  r('ocr.retry','ocr','/api/v1/ocr/jobs/:jobId/retry',P,false,one('POST','ocr.job.write')),
  r('ocr.extractions','ocr','/api/v1/ocr/jobs/:jobId/extractions',G,false,one('GET','ocr.job.read')),
  r('ocr.validation','ocr','/api/v1/ocr/jobs/:jobId/validation',P,false,one('POST','ocr.validation.write')),
  r('ocr.validations','ocr','/api/v1/ocr/jobs/:jobId/validations',GP,false,{GET:['ocr.job.read'],POST:['ocr.validation.write']}),
  r('ocr.patientConfirmation','ocr','/api/v1/ocr/jobs/:jobId/patient-confirmation',P,false,one('POST','ocr.patient.confirm')),
  r('ocr.publications','ocr','/api/v1/ocr/validations/:validationId/publications',GP,false,{GET:['ocr.job.read'],POST:['ocr.publication.write']}),

  r('outreach.campaigns','outreach','/api/v1/outreach/registration-cases/campaigns',GP,false,{GET:['outreach.campaign.read'],POST:['outreach.campaign.write']}),
  r('outreach.campaignStatus','outreach','/api/v1/outreach/registration-cases/campaigns/:campaignId/status',P,false,one('POST','outreach.campaign.write')),
  r('outreach.campaignMembers','outreach','/api/v1/outreach/registration-cases/campaigns/:campaignId/members',GP,false,{GET:['outreach.campaign.read'],POST:['outreach.campaign.write']}),
  r('outreach.cases','outreach','/api/v1/outreach/registration-cases',GP,false,{GET:['outreach.registration.read'],POST:['outreach.registration.write']}),
  r('outreach.case','outreach','/api/v1/outreach/registration-cases/:caseId',G,false,one('GET','outreach.registration.read')),
  r('outreach.linkExisting','outreach','/api/v1/outreach/registration-cases/:caseId/link-existing',P,false,one('POST','outreach.registration.write')),

  r('commercial.pricing','commercial','/api/v1/commercial/pricing',G,true),
  r('commercial.demo','commercial','/api/v1/commercial/demo-requests',P,true),

  r('admin.session','admin','/api/v1/admin/session',G,false,one('GET','platform.admin.access')),
  r('admin.overview','admin','/api/v1/admin/overview',G,false,one('GET','platform.admin.access')),
  r('admin.controls','admin','/api/v1/admin/controls',GP,false,{GET:['platform.control.read'],POST:['platform.control.manage']}),
  r('admin.facilities','admin','/api/v1/admin/facilities',G,false,one('GET','platform.facility.read')),
  r('admin.facility','admin','/api/v1/admin/facilities/:facilityId',G,false,one('GET','platform.facility.read')),
  r('admin.facilityStatus','admin','/api/v1/admin/facilities/:facilityId/status',P,false,one('POST','platform.facility.manage')),
  r('admin.principals','admin','/api/v1/admin/principals',G,false,one('GET','platform.principal.read')),
  { ...r('admin.principalsExport','admin','/api/v1/admin/principals/export',G,false,one('GET','platform.principal.read'),
    'CSV response; use a dedicated download transport.'), responseKind: 'download' },
  r('admin.principalStatus','admin','/api/v1/admin/principals/:accountId/status',P,false,one('POST','platform.principal.manage')),
  r('admin.principalRoles','admin','/api/v1/admin/principals/:accountId/platform-roles',P,false,one('POST','platform.role.manage')),
  r('admin.principalRevokeSessions','admin','/api/v1/admin/principals/:accountId/sessions/revoke',P,false,one('POST','platform.session.revoke')),
  r('admin.identityReviews','admin','/api/v1/admin/identity/reviews',G,false,one('GET','platform.identity-review.read')),
  r('admin.audit','admin','/api/v1/admin/audit/events',G,false,one('GET','platform.audit.read')),
  r('admin.services','admin','/api/v1/admin/operations/services',G,false,one('GET','platform.operations.read')),
  r('admin.events','admin','/api/v1/admin/operations/events',G,false,one('GET','platform.operations.read')),
  r('admin.pricing','admin','/api/v1/admin/pricing',G,false,one('GET','platform.pricing.read')),
  r('admin.updateProduct','admin','/api/v1/admin/pricing/products/:productSlug',P,false,one('POST','platform.pricing.manage')),
  r('admin.updatePrice','admin','/api/v1/admin/pricing/products/:productSlug/prices/:context',P,false,one('POST','platform.pricing.manage')),
  r('admin.demoRequests','admin','/api/v1/admin/demo-requests',G,false,one('GET','platform.demo.read')),
  r('admin.demoStatus','admin','/api/v1/admin/demo-requests/:requestId/status',P,false,one('POST','platform.demo.manage')),
  r('admin.organizationApplications','admin','/api/v1/admin/organization-applications',G,false,one('GET','platform.identity-review.read')),
  r('admin.verifyCac','admin','/api/v1/admin/organization-applications/:applicationId/verify-cac',P,false,one('POST','platform.facility.manage')),
  r('admin.approveApplication','admin','/api/v1/admin/organization-applications/:applicationId/approve',P,false,one('POST','platform.facility.manage','platform.principal.manage','platform.role.manage')),
  r('admin.rejectApplication','admin','/api/v1/admin/organization-applications/:applicationId/reject',P,false,one('POST','platform.facility.manage')),
  r('admin.integrations','admin','/api/v1/admin/integrations',G,false,one('GET','platform.integration.read')),
  r('admin.integration','admin','/api/v1/admin/integrations/:provider',G,false,one('GET','platform.integration.read')),
  r('admin.integrationAudit','admin','/api/v1/admin/integrations/:provider/audit',G,false,one('GET','platform.integration.read')),
  r('admin.integrationEnable','admin','/api/v1/admin/integrations/:provider/enable',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationPause','admin','/api/v1/admin/integrations/:provider/pause',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationConfiguration','admin','/api/v1/admin/integrations/:provider/configuration',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationSelection','admin','/api/v1/admin/integrations/capabilities/:capability/selection',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationFallback','admin','/api/v1/admin/integrations/capabilities/:capability/fallback',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationTest','admin','/api/v1/admin/integrations/:provider/test',P,false,one('POST','platform.integration.test')),

  r('platform.live','platform','/gateway-health/live',G,true),
  r('platform.ready','platform','/gateway-health/ready',G,true),
]

export const NON_FRONTEND_ENDPOINTS: readonly string[] = [
  '/api/v1/auth/service-session', '/api/v1/identity/service/*',
  '/api/v1/ehr/internal/ocr/*', '/api/v1/lab/work-items/accept-ehr-order',
  '/api/v1/lab/imports/from-ocr', '/api/v1/pharmacy/work-items/accept-ehr-prescription',
  '/api/v1/pharmacy/imports/from-ocr', '/api/v1/notifications/otp',
  // This admin route exists but always returns INTEGRATION_CREDENTIAL_ROTATION_EXTERNAL.
  '/api/v1/admin/integrations/:provider/credential-reference',
]
const byName = new Map(HID_ENDPOINTS.map(descriptor => [descriptor.name, descriptor]))
export function findEndpoint(name: string): EndpointDescriptor | undefined { return byName.get(name) }
export function endpointsForService(service: HidService): EndpointDescriptor[] {
  return HID_ENDPOINTS.filter(descriptor => descriptor.service === service)
}
export const SERVICES_WITHOUT_CONTRACTS: readonly HidService[] = []
export function hasContracts(service: HidService): boolean {
  return HID_ENDPOINTS.some(descriptor => descriptor.service === service)
}
