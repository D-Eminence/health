/** Domain methods backed by the c4b5445 route registry. */
import type {
  CreateDemoRequest, DemoRequestAccepted, HidAuthSession, PatientEnrollmentProgress,
  PatientRecordSummary, PublicPricingResponse, RecoveryOtpStart, RecoveryOtpVerified,
  UnverifiedPayload,
} from '@hid/contracts'
import { createServiceBinding, type CallOptions, type ServiceContext } from './service'

type Item = Record<string, unknown>

export function createAuthService(context: ServiceContext) {
  const request = createServiceBinding(context, 'auth')
  return {
    request,
    patientLogin(body: { email: string; password: string; turnstileAction: 'patient-login'; turnstileToken?: string },
      options: CallOptions = {}): Promise<HidAuthSession> {
      return request('auth.patientLogin','POST',{ body, ...options })
    },
    staffLogin(body: { email: string; password: string; turnstileAction?: string; turnstileToken?: string },
      options: CallOptions = {}): Promise<HidAuthSession> {
      return request('auth.staffLogin','POST',{ body, ...options })
    },
    session(options: CallOptions = {}): Promise<HidAuthSession> {
      return request('auth.session','GET',options)
    },
    refresh(options: CallOptions = {}): Promise<HidAuthSession> {
      return request('auth.refresh','POST',options)
    },
    logout(options: CallOptions = {}): Promise<void> {
      return request('auth.logout','POST',options)
    },
    selectFacility(facilityId: string, options: CallOptions = {}): Promise<HidAuthSession> {
      return request('auth.facility','POST',{ body: { facilityId }, ...options })
    },
    googleNonce(options: CallOptions = {}): Promise<{ nonce: string }> {
      return request('auth.googleNonce','GET',options)
    },
    googleOnboarding(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('auth.googleOnboarding','GET',options)
    },
    googleExchange(body: unknown, options: CallOptions = {}): Promise<HidAuthSession | UnverifiedPayload> {
      return request('auth.googleExchange','POST',{ body, ...options })
    },
    startRecovery(body: { identifier: string; purpose: 'PASSWORD_RESET' | 'LEGACY_ACCOUNT_RECOVERY' | 'LEGACY_SESSION_FALLBACK';
      turnstileAction: 'patient-reset-start' | 'staff-reset' | 'admin-reset' | 'legacy-recovery'; turnstileToken?: string },
    options: CallOptions = {}): Promise<RecoveryOtpStart> {
      return request('auth.otpStart','POST',{ body, ...options })
    },
    verifyRecovery(body: { challengeId: string; purpose: 'PASSWORD_RESET' | 'LEGACY_ACCOUNT_RECOVERY' | 'LEGACY_SESSION_FALLBACK'; code: string },
      options: CallOptions = {}): Promise<RecoveryOtpVerified> {
      return request('auth.otpVerify','POST',{ body, ...options })
    },
    completeRecovery(body: { challengeId: string; purpose: 'PASSWORD_RESET' | 'LEGACY_ACCOUNT_RECOVERY' | 'LEGACY_SESSION_FALLBACK';
      verificationToken: string; newPassword: string }, options: CallOptions = {}): Promise<{ completed: true }> {
      return request('auth.otpComplete','POST',{ body, ...options })
    },
  }
}

export function createEnrollmentService(context: ServiceContext) {
  const request = createServiceBinding(context, 'enrollment')
  return {
    request,
    start(body: { nin: string; turnstileAction: 'patient-enrollment'; turnstileToken: string },
      idempotencyKey: string, options: CallOptions = {}): Promise<PatientEnrollmentProgress> {
      return request('enrollment.start','POST',{ body, ...options,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey } })
    },
    current(options: CallOptions = {}): Promise<PatientEnrollmentProgress> {
      return request('enrollment.current','GET',options)
    },
    bindGoogle(options: CallOptions = {}): Promise<{ bound: true }> {
      return request('enrollment.google','POST',options)
    },
    contact(body: { channel: 'phone' | 'email'; contact: string },
      options: CallOptions = {}): Promise<{ challengeId: string; expiresInSeconds: number }> {
      return request('enrollment.contact','POST',{ body, ...options })
    },
    verifyContact(body: { challengeId: string; code: string },
      options: CallOptions = {}): Promise<PatientEnrollmentProgress> {
      return request('enrollment.verifyContact','POST',{ body, ...options })
    },
    activate(password: string, options: CallOptions = {}): Promise<{ stage: 'active'; hidCode: string }> {
      return request('enrollment.activate','POST',{ body: { password }, ...options })
    },
    applyOrganization(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('identity.organizationApply','POST',{ body, ...options })
    },
  }
}

export function createIdentityService(context: ServiceContext) {
  const request = createServiceBinding(context, 'identity')
  return {
    request,
    getMyPatientProfile(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('identity.me','GET',options)
    },
    getMyAccessHistory(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('identity.accessHistory','GET',options)
    },
    setAccessPin(pin: string, options: CallOptions = {}): Promise<{ configured: true }> {
      return request('identity.accessPin','POST',{ body: { pin }, ...options })
    },
    revokeAccessPin(options: CallOptions = {}): Promise<{ revoked: true }> {
      return request('identity.accessPin','DELETE',options)
    },
    patientLookup(body: { hid: string; purpose: 'direct-care' | 'emergency' | 'healthcare-operations' },
      options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('identity.patientLookup','POST',{ body, ...options })
    },
  }
}

export function createAccessService(context: ServiceContext) {
  const request = createServiceBinding(context, 'access')
  return {
    request,
    listMyRequests(options: CallOptions = {}): Promise<readonly Item[]> {
      return request('access.patientRequests','GET',options)
    },
    approve(requestId: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.approve','POST',{ params: { requestId }, ...options })
    },
    deny(requestId: string, reason: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.deny','POST',{ params: { requestId }, body: { reason }, ...options })
    },
    listStaffRequests(options: CallOptions = {}): Promise<readonly Item[]> {
      return request('access.staffRequests','GET',options)
    },
    requestAccess(body: { hid: string; scope: 'read_records' | 'write_records'; reason: string; durationMinutes: number },
      options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.staffRequests','POST',{ body, ...options })
    },
    breakGlass(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.breakGlass','POST',{ body, ...options })
    },
    verifyPin(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.verifyPin','POST',{ body, ...options })
    },
    closeOwnGrant(grantId: string, reason: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('access.closeOwnGrant','POST',{ params: { grantId }, body: { reason }, ...options })
    },
  }
}

export function createEhrService(context: ServiceContext) {
  const request = createServiceBinding(context, 'ehr')
  return {
    request,
    listRecords(options: CallOptions = {}): Promise<PatientRecordSummary> {
      return request('ehr.myRecords','GET',options)
    },
    emergencyRecords(patientId: string, options: CallOptions = {}): Promise<PatientRecordSummary> {
      return request('ehr.emergencyRecords','GET',{ params: { patientId }, ...options })
    },
    listEncounters(patientId: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('ehr.encounters','GET',{ params: { patientId }, ...options })
    },
    createEncounter(patientId: string, body: unknown, idempotencyKey: string,
      options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('ehr.encounters','POST',{ params: { patientId }, body, ...options,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey } })
    },
  }
}

export function createFilesService(context: ServiceContext) {
  const request = createServiceBinding(context, 'files')
  return {
    request,
    list(patientId: string, encounterId: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('files.list','GET',{ query: { patientId, encounterId }, ...options })
    },
    createUploadIntent(body: unknown, idempotencyKey: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('files.uploadIntent','POST',{ body, ...options,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey } })
    },
    complete(documentId: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('files.complete','POST',{ params: { documentId }, ...options })
    },
    download(documentId: string, options: CallOptions = {}): Promise<{ url: string; expiresInSeconds: number }> {
      return request('files.download','GET',{ params: { documentId }, ...options })
    },
  }
}

export function createNotificationsService(context: ServiceContext) {
  const request = createServiceBinding(context, 'notifications')
  return {
    request,
    list(limit?: number, options: CallOptions = {}): Promise<readonly Item[]> {
      return request('notifications.list','GET',{ query: { limit }, ...options })
    },
    markRead(notificationId: string, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('notifications.read','POST',{ params: { notificationId }, ...options })
    },
  }
}

export function createCommercialService(context: ServiceContext) {
  const request = createServiceBinding(context, 'commercial')
  return {
    request,
    pricing(options: CallOptions = {}): Promise<PublicPricingResponse> {
      return request('commercial.pricing','GET',options)
    },
    bookDemo(body: CreateDemoRequest, idempotencyKey: string,
      options: CallOptions = {}): Promise<DemoRequestAccepted> {
      return request('commercial.demo','POST',{ body, ...options,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey } })
    },
  }
}

export function createAdminService(context: ServiceContext) {
  const request = createServiceBinding(context, 'admin')
  return {
    request,
    session(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('admin.session','GET',options)
    },
    getOverview(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('admin.overview','GET',options)
    },
    getPlatformControls(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('admin.controls','GET',options)
    },
    getPricing(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return request('admin.pricing','GET',options)
    },
  }
}

export function createLabService(context: ServiceContext) {
  return { request: createServiceBinding(context, 'lab') }
}
export function createPharmacyService(context: ServiceContext) {
  return { request: createServiceBinding(context, 'pharmacy') }
}
export function createOcrService(context: ServiceContext) {
  return { request: createServiceBinding(context, 'ocr') }
}
export function createOutreachService(context: ServiceContext) {
  return { request: createServiceBinding(context, 'outreach') }
}

export function createPlatformService(context: ServiceContext) {
  const request = createServiceBinding(context, 'platform')
  return {
    request,
    healthCheck(options: CallOptions = {}): Promise<{ status: 'ok' }> {
      return request('platform.live','GET',options)
    },
  }
}
