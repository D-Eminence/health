/**
 * The Health ID service modules.
 *
 * Each function corresponds to one endpoint confirmed to exist at the frozen
 * backend release. What none of them do is claim to know the *shape* of what
 * comes back: return types are `UnverifiedPayload` (`unknown`) until a response
 * has been observed against staging and written down as a contract.
 *
 * That is deliberate, and it is the difference between a frontend that
 * integrates with the existing system and one that quietly invents a second
 * interpretation of it. Narrowing `unknown` is mildly annoying at the call
 * site; shipping a confidently wrong `PatientProfile` interface is worse.
 *
 * The path from here is in `docs/OPEN-QUESTIONS.md`: observe the response in
 * staging, agree the contract with the backend team, add a parser, replace the
 * `UnverifiedPayload` return type.
 */

import type { UnverifiedPayload } from '@hid/contracts'
import { createServiceBinding, type CallOptions, type ServiceContext } from './service'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function createIdentityService(context: ServiceContext) {
  const call = createServiceBinding(context, 'identity')

  return {
    /** Whether a Health ID identifier is free. Public: used during sign-up. */
    checkSignupAvailability(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('signup-availability', 'POST', { body, ...options })
    },
    startSignup(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('signup-start', 'POST', { body, ...options })
    },
    verifySignup(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('signup-verify', 'POST', { body, ...options })
    },
    patientLogin(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('patient-login', 'POST', { body, ...options })
    },
    staffLogin(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('staff-login', 'POST', { body, ...options })
    },
    /**
     * The signed-in patient's own profile.
     * Response is identifying and clinical: hold it in component state only,
     * never in storage, and never log it.
     */
    getMyPatientProfile(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('patients-me', 'GET', options)
    },
    searchStaff(
      query: Readonly<Record<string, string | number>>,
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('staff-search', 'GET', { query, ...options })
    },
    startPasswordReset(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('patient-reset-start', 'POST', { body, ...options })
    },
    verifyPasswordReset(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('patient-reset-verify', 'POST', { body, ...options })
    },
    completePasswordReset(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('patient-reset-complete', 'POST', { body, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// EHR
// ---------------------------------------------------------------------------

export function createEhrService(context: ServiceContext) {
  const call = createServiceBinding(context, 'ehr')

  return {
    /** Clinical content. Never cached to storage, never logged. */
    listRecords(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('patients-records', 'GET', { query, ...options })
    },
    listHistory(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('patient-history-list', 'GET', { query, ...options })
    },
    /** Creates a record. Not idempotent, so it is never retried automatically. */
    createRecord(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('records-create', 'POST', { body, ...options })
    },
    createRecordVersion(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('records-version-create', 'POST', { body, ...options })
    },
    listHealthEvents(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('health-events', 'GET', { query, ...options })
    },
    createHealthEvent(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('health-events', 'POST', { body, ...options })
    },
    updateHealthEvent(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('health-event-update', 'POST', { body, ...options })
    },
    getStaffDashboard(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('staff-dashboard', 'GET', options)
    },
  }
}

// ---------------------------------------------------------------------------
// Access and consent
// ---------------------------------------------------------------------------

export function createAccessService(context: ServiceContext) {
  const call = createServiceBinding(context, 'access')

  return {
    requestAccess(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('access-request-create', 'POST', { body, ...options })
    },
    closeGrant(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('access-grant-close', 'POST', { body, ...options })
    },
    revokeGrant(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('access-grant-revoke', 'POST', { body, ...options })
    },
    /**
     * Emergency access. The backend audits every use; the interface that calls
     * this must tell the clinician so, before they confirm.
     */
    breakGlass(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('break-glass', 'POST', { body, ...options })
    },
    createShare(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('share-create', 'POST', { body, ...options })
    },
    createShareInvite(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('share-invite-create', 'POST', { body, ...options })
    },
    cancelShareInvite(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('share-invite-cancel', 'POST', { body, ...options })
    },
    listAudit(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('audit-list', 'GET', { query, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function createFilesService(context: ServiceContext) {
  const call = createServiceBinding(context, 'files')

  return {
    /** Returns a short-lived signed URL. Use it immediately; never store it. */
    signUpload(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('files-sign-upload', 'POST', { body, ...options })
    },
    registerUpload(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('files-register-upload', 'POST', { body, ...options })
    },
    /** Returns a short-lived signed URL. Use it immediately; never store it. */
    signDownload(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('files-sign-download', 'POST', { body, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function createNotificationsService(context: ServiceContext) {
  const call = createServiceBinding(context, 'notifications')

  return {
    list(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('notifications-list', 'GET', { query, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

export function createOutreachService(context: ServiceContext) {
  const call = createServiceBinding(context, 'outreach')

  return {
    signup(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('outreach-signup', 'POST', { body, ...options })
    },
    verifyOtp(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('outreach-verify-otp', 'POST', { body, ...options })
    },
    resendOtp(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('outreach-resend-otp', 'POST', { body, ...options })
    },
    join(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('outreach-join', 'POST', { body, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// OCR / migration
// ---------------------------------------------------------------------------

export function createOcrService(context: ServiceContext) {
  const call = createServiceBinding(context, 'ocr')

  return {
    getContext(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('migration-context', 'GET', options)
    },
    capture(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('migration-capture', 'POST', { body, ...options })
    },
    listImports(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('migration-imports', 'GET', { query, ...options })
    },
    listProcessing(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('migration-processing', 'GET', { query, ...options })
    },
    submitReview(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('migration-review', 'POST', { body, ...options })
    },
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function createAdminService(context: ServiceContext) {
  const call = createServiceBinding(context, 'admin')

  return {
    getOverview(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('admin-dashboard-overview', 'GET', options)
    },
    listUsers(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('admin-user-management', 'GET', { query, ...options })
    },
    updateUser(body: unknown, options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('admin-user-management', 'POST', { body, ...options })
    },
    getBilling(
      query: Readonly<Record<string, string | number>> = {},
      options: CallOptions = {},
    ): Promise<UnverifiedPayload> {
      return call('admin-billing', 'GET', { query, ...options })
    },
    getPlatformControls(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('admin-platform-controls', 'GET', options)
    },
  }
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export function createPlatformService(context: ServiceContext) {
  const call = createServiceBinding(context, 'platform')

  return {
    /** Liveness probe. The only call the public site is permitted to make. */
    healthCheck(options: CallOptions = {}): Promise<UnverifiedPayload> {
      return call('health-check', 'GET', options)
    },
  }
}
