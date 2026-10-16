/**
 * Browser routes verified against hid-system c4b5445, and later each where its
 * comment says; the patient enrollment routes against hid-system main f9dbaf0
 * (#82, #84, #85 and #86: ADR-061, ADR-062 and ADR-063). Paths include /api/v1.
 */
export type HidService = 'auth' | 'enrollment' | 'identity' | 'access' | 'ehr' | 'files'
  | 'notifications' | 'lab' | 'pharmacy' | 'ocr' | 'outreach' | 'admin' | 'commercial' | 'platform' | 'support'
export type EndpointMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type EndpointAuth = { readonly kind: 'public' | 'authenticated' }
/**
 * 'surface-verified': hid-system serves the route. 'proposed': specified in
 * docs/BILLING_SPEC.md and built against, not yet served; callers treat a 404
 * as "not available yet".
 */
export type ContractStatus = 'surface-verified' | 'proposed'
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
const proposed = (descriptor: EndpointDescriptor): EndpointDescriptor => ({ ...descriptor, status: 'proposed' })
const one = (method: EndpointMethod, ...permissions: string[]): Partial<Record<EndpointMethod, readonly string[]>> =>
  ({ [method]: permissions })

export const HID_ENDPOINTS: readonly EndpointDescriptor[] = [
  r('support.chat','support','/api/v1/support/chat',P,true),
  r('ehr.patientChat','ehr','/api/v1/ehr/me/chat',P),
  r('ehr.staffPatientChat','ehr','/api/v1/ehr/patients/:patientId/chat',P,false,one('POST','ehr.note.read')),
  r('ehr.staffPatientChatHistory','ehr','/api/v1/ehr/patients/:patientId/chat/history',['GET','DELETE'],false,{GET:['ehr.note.read'],DELETE:['ehr.note.read']}),
  r('ehr.staffPatientChatSource','ehr','/api/v1/ehr/patients/:patientId/chat/sources/:kind/:sourceId',G,false,one('GET','ehr.note.read')),
    r('ehr.patientChatHistory','ehr','/api/v1/ehr/me/chat/history',['GET','DELETE']),
    r('ehr.patientChatSource','ehr','/api/v1/ehr/me/chat/sources/:kind/:sourceId',G),
  r('auth.patientLogin','auth','/api/v1/auth/patient/login',P,true),
  r('auth.staffLogin','auth','/api/v1/auth/login',P,true,undefined,
    'Requires Origin and a workforce Turnstile action. Since hid-system #71 returns an MFA status, not a session.'),
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
  // Phase 4 Stage 2A platform sign-in (hid-system phase-4-stage-2-backend-security
  // at 7cbbf98, ADR-038). A password yields only an MFA challenge cookie.
  r('auth.adminLogin','auth','/api/v1/auth/admin/login',P,true,undefined,
    'Requires Origin and Turnstile action admin-login. Returns mfa_required or mfa_enrollment_required.'),
  r('auth.adminMfaVerify','auth','/api/v1/auth/admin/mfa/verify',P,true,undefined,
    'Uses the challenge cookie; takes a TOTP code or one recovery code. Returns a platform session.'),
  r('auth.adminMfaEnrollStart','auth','/api/v1/auth/admin/mfa/enroll/start',P,true,undefined,
    'Uses the challenge cookie. The only response that contains the TOTP secret.'),
  r('auth.adminMfaEnrollActivate','auth','/api/v1/auth/admin/mfa/enroll/activate',P,true,undefined,
    'Returns a platform session and the recovery codes, once.'),
  r('auth.adminRefresh','auth','/api/v1/auth/admin/refresh',P,true,undefined,
    'Requires the platform refresh cookie and CSRF header.'),
  r('auth.adminLogout','auth','/api/v1/auth/admin/logout',P),
  // Staff sign-in with an authenticator (hid-system #71 at 8f3eff1, ADR-054,
  // migration 0088). Each step needs Origin and the staff challenge cookie
  // (hid_access_mfa, path /api/v1/auth/mfa), and no Turnstile, CSRF or session.
  r('auth.staffMfaVerify','auth','/api/v1/auth/mfa/verify',P,true,undefined,
    'Takes a TOTP code or one recovery code. Returns a staff session.'),
  r('auth.staffMfaEnrollEmailCode','auth','/api/v1/auth/mfa/enroll/email-code',P,true,undefined,
    'No body. Emails a six-digit enrolment code to the account address; a resend replaces it.'),
  r('auth.staffMfaEnrollStart','auth','/api/v1/auth/mfa/enroll/start',P,true,undefined,
    'Takes the emailed code, or none after provider activation. The only response that contains the TOTP secret.'),
  r('auth.staffMfaEnrollActivate','auth','/api/v1/auth/mfa/enroll/activate',P,true,undefined,
    'Takes the first TOTP code. Returns a staff session and the recovery codes, once.'),

  r('enrollment.start','enrollment','/api/v1/identity/patient-enrollments',P,true),
  r('enrollment.availability','enrollment','/api/v1/identity/patient-enrollments/availability',G,true,undefined,
    'hid-system#68 (FE-4); since #84 (ADR-062) 200 { open, online, facility }, each a boolean. only open: true opens a start; '
    + 'online and facility say which route to prove the NIN holder is on. An Identity before #84 sends { open } only.'),
  r('enrollment.current','enrollment','/api/v1/identity/patient-enrollments/current',G,true),
  r('enrollment.google','enrollment','/api/v1/identity/patient-enrollments/google',P,true),
  r('enrollment.contact','enrollment','/api/v1/identity/patient-enrollments/contact',P,true),
  r('enrollment.verifyContact','enrollment','/api/v1/identity/patient-enrollments/contact/verify',P,true),
  r('enrollment.activate','enrollment','/api/v1/identity/patient-enrollments/activate',P,true,undefined,
    'Returns HIDCode; does not create a login session. Takes dateOfBirth and gender only for the requiredProfileFields the NIN record lacks (ADR-061).'),
  // The NIN holder step (#84, ADR-062) and the facility route (#85, ADR-063). Each
  // POST needs Origin and the enrollment cookie, and takes no Turnstile token or Idempotency-Key.
  r('enrollment.holder','enrollment','/api/v1/identity/patient-enrollments/holder',P,true,undefined,
    'No body; texts a six-digit code to the phone on the NIN record. 200 { challengeId, expiresInSeconds, resendAfterSeconds }.'),
  r('enrollment.holderVerify','enrollment','/api/v1/identity/patient-enrollments/holder/verify',P,true,undefined,
    'Body { challengeId, code }; 200 { stage: verify_contact, requiredProfileFields }. 409 NIN_ALREADY_REGISTERED only after a correct code.'),
  r('enrollment.facilityCode','enrollment','/api/v1/identity/patient-enrollments/facility-code',P,true,undefined,
    'No body; answers the verify_holder progress with facility.deskCode. A new code replaces the last; five per enrollment.'),
  r('enrollment.participatingFacilities','enrollment','/api/v1/identity/patient-enrollments/participating-facilities',G,true,undefined,
    'No input; 200 { facilities: [{ name, addressLine?, town, lga, state, hours? }], whatToBring }. Empty while the facility route is off.'),

  r('identity.me','identity','/api/v1/identity/me',G),
  r('identity.accessHistory','identity','/api/v1/identity/me/access-history',G),
  r('identity.accessPin','identity','/api/v1/identity/me/access-pin',['POST','DELETE']),
  r('identity.verifyNin','identity','/api/v1/identity/me/verification/nin',P),
  // Phase 3 patient safety (hid-system phase-3-patient-safety, ADR-036).
  r('identity.accountDeletion','identity','/api/v1/identity/me/account-deletion',GP),
  r('identity.accountDeletionConfirm','identity','/api/v1/identity/me/account-deletion/confirm',P),
  r('identity.accountDeletionCancel','identity','/api/v1/identity/me/account-deletion/cancel',P),
  r('identity.emergencyContacts','identity','/api/v1/identity/me/emergency-contacts',GP),
  r('identity.emergencyContact','identity','/api/v1/identity/me/emergency-contacts/:contactId',P),
  r('identity.emergencyContactDeactivate','identity','/api/v1/identity/me/emergency-contacts/:contactId/deactivate',P),
  r('identity.emergencyContactVerification','identity','/api/v1/identity/me/emergency-contacts/:contactId/verification',P),
  r('identity.emergencyContactVerificationConfirm','identity','/api/v1/identity/me/emergency-contacts/:contactId/verification/confirm',P),
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
  // Facility-assisted registration (hid-system main f9dbaf0: #85, migration 0094, ADR-063). A staff
  // session with MFA, X-Facility-ID, CSRF and an Idempotency-Key; 503 ASSISTED_REGISTRATION_DISABLED while off.
  r('identity.assistedVerifications','identity','/api/v1/identity/assisted-verifications',P,false,
    one('POST','identity.patient.assisted_registration'),
    'Body { deskCode, method, documentType, document, attestations }; 200 { outcome: verified }. The same key replays the stored outcome.'),
  r('enrollment.providerStart','enrollment','/api/v1/identity/provider-enrollments',P,true,undefined,
    'Accountless; refused when signed in. Requires Origin and Turnstile action provider-enrollment.'),
  r('enrollment.providerVerify','enrollment','/api/v1/identity/provider-enrollments/verify',P,true,undefined,
    'Accountless; verifies the emailed code and sets the enrollment cookie.'),
  r('enrollment.providerActivate','enrollment','/api/v1/identity/provider-enrollments/activate',P,true,undefined,
    'Accountless; uses the enrollment cookie. Since hid-system #71 returns an MFA status, not a session.'),
  // Clinician self sign-up and its status page (hid-system ADR-064, branch
  // claude/clinician-self-signup at fa58e2b, re-checked at 9e981e4, and P3's
  // search limit at 1d6ff6f; not merged). Every route needs
  // Origin and no CSRF or session; after the email code the browser holds only
  // the httpOnly capability cookie hid_clinician_application (path
  // /api/v1/identity/clinician-applications). Nothing here issues a session.
  r('enrollment.clinicianAvailability','enrollment','/api/v1/identity/clinician-applications/availability',G,true,undefined,
    'No input; 200 { open: boolean }. Anything but { open: true } means not open.'),
  r('enrollment.clinicianEmailCode','enrollment','/api/v1/identity/clinician-applications/email-code',P,true,undefined,
    'Turnstile action clinician-application (main site only). The same 202 for every address. Refused while signed in.'),
  r('enrollment.clinicianEmailVerify','enrollment','/api/v1/identity/clinician-applications/email-code/verify',P,true,undefined,
    'Sets the draft capability cookie. 409 CLINICIAN_EMAIL_IN_USE only after a correct code.'),
  r('enrollment.clinicianFacilitySearch','enrollment','/api/v1/identity/clinician-applications/facility-search',P,true,undefined,
    'Draft or ready capability; at most 10 verified facilities. 30 searches per capability, then (since 7cd8038) '
    + '429 CLINICIAN_APPLICATION_SEARCH_LIMITED with no Retry-After: only a new capability searches again.'),
  r('enrollment.clinicianSubmit','enrollment','/api/v1/identity/clinician-applications',P,true,undefined,
    'Draft capability and Idempotency-Key. Creates the account and the application; no session, no role. '
    + 'Since 9e981e4 a draft takes at most five hashed submissions (then 401).'),
  r('enrollment.clinicianAuthenticatorEmailCode','enrollment','/api/v1/identity/clinician-applications/authenticator/email-code',P,true,undefined,
    'No body. Emails the enrolment proof code (0088).'),
  r('enrollment.clinicianAuthenticatorStart','enrollment','/api/v1/identity/clinician-applications/authenticator/start',P,true,undefined,
    'Takes the emailed code. The only response that contains the TOTP secret.'),
  r('enrollment.clinicianAuthenticatorActivate','enrollment','/api/v1/identity/clinician-applications/authenticator/activate',P,true,undefined,
    'Takes the first TOTP code. Returns the recovery codes once and the applications; no session.'),
  r('enrollment.clinicianAuthenticatorVerify','enrollment','/api/v1/identity/clinician-applications/authenticator/verify',P,true,undefined,
    'A TOTP code or one recovery code. Returns the applications; no session.'),
  r('enrollment.clinicianAuthenticatorChallenge','enrollment','/api/v1/identity/clinician-applications/authenticator/challenge',P,true,undefined,
    'Opens the authenticator step again after it expired.'),
  r('enrollment.clinicianStatusEmailCode','enrollment','/api/v1/identity/clinician-applications/status/email-code',P,true,undefined,
    'Turnstile action clinician-application-status (main site only). The same 202 for every address.'),
  r('enrollment.clinicianStatusEmailVerify','enrollment','/api/v1/identity/clinician-applications/status/email-code/verify',P,true,undefined,
    'Sets the account capability cookie; answers which authenticator step comes next.'),
  r('enrollment.clinicianCurrent','enrollment','/api/v1/identity/clinician-applications/current',G,true,undefined,
    'The applicant\'s applications, from the capability cookie.'),
  r('enrollment.clinicianWithdraw','enrollment','/api/v1/identity/clinician-applications/:applicationId/withdraw',P,true,undefined,
    'If-Match "<version>".'),
  r('enrollment.clinicianApply','enrollment','/api/v1/identity/clinician-applications/current/applications',P,true,undefined,
    'Ready capability and Idempotency-Key: apply to another facility.'),
  r('enrollment.clinicianSessionEnd','enrollment','/api/v1/identity/clinician-applications/session/end',P,true,undefined,
    'Always 204; ends the capability and clears its cookie.'),
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
  r('access.revokeMyGrant','access','/api/v1/identity/me/consent-grants/:grantId/revoke',P),
  r('notifications.list','notifications','/api/v1/identity/me/notifications',G),
  r('notifications.read','notifications','/api/v1/identity/me/notifications/:notificationId/read',P),

  r('ehr.myRecords','ehr','/api/v1/ehr/me/records',G),
  r('ehr.myImportedAttachment','ehr','/api/v1/ehr/me/imported-attachments/:fileId/download',G),
  r('ehr.importedRecords','ehr','/api/v1/ehr/patients/:patientId/imported-records',G,false,one('GET','ehr.note.read')),
  r('ehr.importedAttachment','ehr','/api/v1/ehr/patients/:patientId/imported-attachments/:fileId/download',G,false,one('GET','ehr.note.read','ehr.document.read')),
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
  // hid-system #56: sends (or sends again) a saved active lab request to Lab.
  r('ehr.labRequestLabWorkItem','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/lab-work-item',P,false,one('POST','ehr.lab-request.write','lab.work-item.accept')),
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
  // hid-system #51: the released results of the Lab work item accepted from one EHR lab request.
  r('lab.releasedResultsForOrder','lab','/api/v1/lab/ehr-orders/:sourceEhrOrderId/released-results',G,false,one('GET','lab.result.released.read')),
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
  // Facility billing (docs/BILLING_SPEC.md): proposed, not yet served by hid-system.
  proposed(r('commercial.subscription','commercial','/api/v1/commercial/subscription',G,false,one('GET','billing.subscription.read'))),
  proposed(r('commercial.subscriptionTrial','commercial','/api/v1/commercial/subscription/trial',P,false,one('POST','billing.subscription.manage'))),
  proposed(r('commercial.subscriptionCheckout','commercial','/api/v1/commercial/subscription/checkout',P,false,one('POST','billing.subscription.manage'),
    'Answers a Paystack authorizationUrl; payment is confirmed only by the server (webhook or verify).')),
  proposed(r('commercial.invoices','commercial','/api/v1/commercial/invoices',G,false,one('GET','billing.subscription.read'))),

  r('admin.session','admin','/api/v1/admin/session',G,false,one('GET','platform.admin.access')),
  r('admin.overview','admin','/api/v1/admin/overview',G,false,one('GET','platform.admin.access')),
  r('admin.controls','admin','/api/v1/admin/controls',GP,false,{GET:['platform.control.read'],POST:['platform.control.manage']}),
  r('admin.facilities','admin','/api/v1/admin/facilities',G,false,one('GET','platform.facility.read')),
  r('admin.facility','admin','/api/v1/admin/facilities/:facilityId',G,false,one('GET','platform.facility.read')),
  r('admin.facilityStatus','admin','/api/v1/admin/facilities/:facilityId/status',P,false,one('POST','platform.facility.manage')),
  // hid-system main f9dbaf0 (#85, ADR-063): a facility's designation for assisted registration.
  r('admin.facilityAssistedRegistration','admin','/api/v1/admin/facilities/:facilityId/assisted-registration',GP,false,
    {GET:['platform.facility.read'],POST:['platform.facility.manage']},
    'GET answers version 0 without a designation. POST needs step-up, a reason, Idempotency-Key and If-Match (0 creates).'),
  // hid-system A24 (ADR-059, #76): the search terms and the export reason go in the JSON body, out of
  // URLs and access logs. The deprecated GET forms (GET /principals and GET /principals/export) are not
  // registered, so the browser cannot put a name, an email address or a reason in a URL.
  r('admin.principalsSearch','admin','/api/v1/admin/principals/search',P,false,one('POST','platform.principal.read'),
    'Body { query, page, pageSize, status? }; answers as GET /principals did. CSRF; no step-up, reason, If-Match or Idempotency-Key.'),
  { ...r('admin.principalsExport','admin','/api/v1/admin/principals/export',P,false,one('POST','platform.principal.export'),
    'Body { reason, query?, status? }. CSV response; use a dedicated download transport. Requires step-up; at most 5,000 rows.'),
    responseKind: 'download' },
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
  // Phase 4 Stage 2A platform security (hid-system 7cbbf98, ADR-038).
  r('admin.mfaStatus','admin','/api/v1/admin/mfa',G,false,one('GET','platform.admin.access')),
  r('admin.mfaStepUp','admin','/api/v1/admin/mfa/step-up',P,false,one('POST','platform.admin.access'),
    'TOTP only; server-side assurance lasts 5 minutes.'),
  r('admin.mfaRecoveryCodes','admin','/api/v1/admin/mfa/recovery-codes/regenerate',P,false,one('POST','platform.admin.access'),
    'Requires step-up. Returns new recovery codes once.'),
  r('admin.sessions','admin','/api/v1/admin/sessions',G,false,one('GET','platform.admin.access')),
  r('admin.sessionRevoke','admin','/api/v1/admin/sessions/:sessionId/revoke',P,false,one('POST','platform.admin.access')),
  r('admin.principalSessions','admin','/api/v1/admin/principals/:accountId/sessions',G,false,one('GET','platform.session.revoke')),
  r('admin.principalSessionRevoke','admin','/api/v1/admin/principals/:accountId/sessions/:sessionId/revoke',P,false,
    one('POST','platform.session.revoke')),
  r('admin.approvals','admin','/api/v1/admin/approvals',G,false,undefined,
    'Requires one of platform.role.manage, platform.mfa.reset or platform.audit.read.'),
  r('admin.superAdminRequest','admin','/api/v1/admin/principals/:accountId/super-admin-requests',P,false,
    one('POST','platform.role.manage')),
  r('admin.mfaResetRequest','admin','/api/v1/admin/principals/:accountId/mfa-reset-requests',P,false,
    one('POST','platform.mfa.reset')),
  r('admin.approvalDecision','admin','/api/v1/admin/approvals/:requestId/:decision',P,false,one('POST','platform.admin.access'),
    'decision is approve, reject or cancel. The backend decides who may decide.'),
  // Clinician self sign-up review (hid-system ADR-064, branch claude/clinician-self-signup at fa58e2b, not
  // merged): the verification queue. Step 1 and step 2 are made by two different Super Admins, neither of
  // whom works at the facility; each command needs step-up, If-Match, an Idempotency-Key and a reason.
  r('admin.clinicianApplications','admin','/api/v1/admin/clinician-applications',G,false,one('GET','platform.workforce.manage'),
    'Query state (open by default: the three undecided states, oldest first), cursor and limit (1-50, default 20).'),
  r('admin.clinicianApplication','admin','/api/v1/admin/clinician-applications/:applicationId',G,false,
    one('GET','platform.workforce.manage')),
  r('admin.clinicianApplicationAttest','admin','/api/v1/admin/clinician-applications/:applicationId/attest',P,false,
    one('POST','platform.workforce.manage'),
    'Step 1: the checklist, evidence reference, validity, a live code from the applicant\'s authenticator and a reason.'),
  r('admin.clinicianApplicationApprove','admin','/api/v1/admin/clinician-applications/:applicationId/approve',P,false,
    one('POST','platform.workforce.manage'), 'Step 2, by a Super Admin other than step 1\'s: attaches and grants the role.'),
  r('admin.clinicianApplicationReject','admin','/api/v1/admin/clinician-applications/:applicationId/reject',P,false,
    one('POST','platform.workforce.manage'), 'A decision code the applicant sees and a reason they never see.'),

  r('platform.live','platform','/gateway-health/live',G,true),
  r('platform.ready','platform','/gateway-health/ready',G,true),
]

export const NON_FRONTEND_ENDPOINTS: readonly string[] = [
  '/api/v1/auth/service-session', '/api/v1/identity/service/*',
  '/api/v1/ehr/internal/ocr/*', '/api/v1/lab/work-items/accept-ehr-order',
  '/api/v1/lab/imports/from-ocr', '/api/v1/pharmacy/work-items/accept-ehr-prescription',
  '/api/v1/pharmacy/imports/from-ocr', '/api/v1/notifications/otp',
  '/api/v1/notifications/emergency-contact-alert',
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
