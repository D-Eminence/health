import { createApiClient, HidApiError, isHidApiError, NO_RETRY, type DownloadResult, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { environment } from './env'
import { recordServerSessionEnd, recordSessionWindow, reportSessionEnded, serverSessionEnd } from './session-window'
import { announceAdminSessionChange } from './tabs'

export interface AdminActor {
  accountId: string
  subject: string
  displayName: string | null
  email: string | null
  platformRoles: string[]
  platformPermissions: string[]
}
export interface AdminSession { actor: AdminActor }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
/**
 * One page of a cursor-paged list (approvals, demo requests). `nextCursor` is
 * opaque and bound to the list and its filters; null on the last page.
 */
export interface CursorPage<T> { items: T[]; nextCursor: string | null }
export interface Versioned { version: number }
export interface Facility extends Versioned {
  id: string; organizationId: string; organizationName: string; name: string; code: string; status: string
  statusReason: string | null; statusChangedAt: string | null; createdAt: string; membershipCount: number
}
/**
 * A facility's designation for facility-assisted registration (hid-system main
 * f9dbaf0: #85, ADR-063). Version 0, with `designated` false and every other
 * value null, when it has none; that version creates the first one.
 */
export interface AssistedRegistrationDesignation {
  facilityId: string; designated: boolean; status: 'active' | 'suspended' | null; addressLine: string | null
  town: string | null; lga: string | null; state: string | null; hours: string | null; reason: string | null
  version: number; updatedAt: string | null
}
/** `AssistedRegistrationDesignationDto`: the location patients are shown, and the audited reason. */
export interface AssistedRegistrationDesignationInput {
  status: 'active' | 'suspended'; addressLine?: string; town: string; lga: string; state: string; hours?: string; reason: string
}
export interface AssistedRegistrationSaved { facilityId: string; status: 'active' | 'suspended'; version: number; replayed: boolean }
export interface PrincipalMembership { id: string; facilityId: string; facilityName: string; role: string; appRole: string; active: boolean }
export interface Principal extends Versioned {
  id: string; subject: string; email: string | null; displayName: string | null; status: string; createdAt: string
  platformRoles: string[]; activeSessionCount: number; memberships: PrincipalMembership[]
  /**
   * An active authenticator exists. A display hint: the reset command still
   * decides. Absent from an Identity build before hid-system Stage 4A.
   */
  mfaEnrolled?: boolean
}
export interface IdentityReview extends Versioned {
  id: string; facilityId: string; facilityName: string; maskedNin: string; provider: string; status: string
  candidateCount: number; createdAt: string; updatedAt: string
}
export interface AuditEvent {
  sequenceId: string; eventId: string; occurredAt: string; correlationId: string; actorType: string | null
  actorSubject: string | null; facilityId: string | null; action: string; outcome: string; resourceType: string | null
  resourceId: string | null; purposeOfUse: string | null; reason: string | null; sourceSystem: string | null
}
export interface AuditEventPage { items: AuditEvent[]; nextBeforeSequenceId: string | null }
/** Backend filters for the platform audit (exact matches; dates are ISO instants). */
export interface AuditFilters {
  actor?: string; facilityId?: string; action?: string; correlationId?: string
  outcome?: 'success' | 'denied' | 'failure'; from?: string; to?: string
  /** The audited target, for example `facility`; `resourceId` needs it. */
  resourceType?: string; resourceId?: string
}
export interface PlatformControl extends Versioned { controlKey: string; enabled: boolean; reason: string; updatedAt: string }
export interface CommercialProduct extends Versioned { slug: string; name: string; status: 'active' | 'coming_soon' | 'draft' | 'retired' }
export interface CommercialPrice extends Versioned { product_slug: string; context: string; visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote' | 'hidden'; amount_minor: number | null; currency: string; billing_period: string | null; unit: string | null; active: boolean }
export interface PricingCatalog { products: CommercialProduct[]; prices: CommercialPrice[] }
export type DemoStatus = 'new' | 'contacted' | 'qualified' | 'closed'
export interface DemoRequest extends Versioned { id: string; contactName: string; contactEmail: string; organizationName: string | null; productCode: string; status: DemoStatus; createdAt: string }
export type ApplicationStatus = 'pending_verification' | 'ready_for_review' | 'approved' | 'rejected'
export interface OrganizationApplication extends Versioned {
  applicationId: string; productCode: string; organizationName: string | null; organizationType: string | null
  cacHint: string | null; administratorName: string | null; administratorEmail: string; status: ApplicationStatus | string
  verificationResult: string | null; verifiedOrganizationName: string | null; verifiedEntityType: string | null
  verifiedRegistrationDate: string | null; verifiedAddress: string | null; verifiedRegistryStatus: string | null
  profileCompanyName: string | null; profileEntityType: string | null; profileRegistrationDate: string | null
  profileAddress: string | null; profileRegistryStatus: string | null; profileState: string | null
  fieldSources: Record<string, string | null> | null; createdAt: string; verifiedAt: string | null; reviewedAt: string | null
}
export interface IntegrationProvider extends Versioned {
  provider: string; name: string; enabled: boolean; health: string; managementMode: string; availableActions: string[]
  capabilities?: string[]; activeCapabilities?: string[]
  operationGates?: Array<{ operation: string; state: string; detail: string }>
  /** Non-secret settings only; the backend filters the stored configuration. */
  configuration?: Record<string, string>
  /** Credential state only; never a credential value. */
  credential?: { state: string; rotationSupported: boolean }
  lastTestedAt?: string | null; lastSuccessfulTestAt?: string | null; lastFailedTestAt?: string | null
}
export interface IntegrationCapability extends Versioned { capability: string; activeProvider: string | null; fallbackProvider: string | null; eligibleProviders: string[] }
export interface IntegrationCatalog { items: IntegrationProvider[]; capabilities: IntegrationCapability[] }
export interface IntegrationEvent {
  eventId: string; action: string; occurredAt: string; actorAccountId: string | null; correlationId: string
  capability: string | null; reason: string | null; outcome: string
}
/** `GET /admin/overview` (hid-system AdminService.overview). */
export interface PlatformOverview {
  registeredPatients: number; facilities: number; verifiedFacilities: number; suspendedFacilities: number
  activeStaffMemberships: number; pendingIdentityReviews: number
}
export interface DeliveryFailure {
  eventId: string | null; eventType: string | null; producer: string | null; attemptCount: number | null
  errorCode: string | null; errorSummary: string | null; failedAt: string | null
}
export interface ServiceState { service: string; state: string; checkedAt: string; code: string | null }

// Platform security contract: hid-system phase-4-stage-2-backend-security at
// 7cbbf98 (ADR-038), with the Stage 4A contracts (hid-system
// docs/PHASE_4_STAGE_4A_ADMIN_CONTRACTS.md). Field names and values are the backend's.

/** Password accepted: the backend has set an httpOnly MFA challenge cookie. */
export interface PlatformLoginChallenge { status: 'mfa_required' | 'mfa_enrollment_required'; expiresAt: string }
/** An MFA-verified platform session (verify, activate and refresh responses). */
export interface PlatformSessionGrant { actor: AdminActor & { kind?: string; sessionId?: string }; expiresAt: string; idleExpiresAt: string }
/** Returned once, by enrollment start. The secret is never available again. */
export interface MfaEnrollment {
  secret: string; otpauthUri: string; algorithm: 'SHA1'; digits: number; periodSeconds: number; expiresAt: string
}
export interface MfaStatus {
  enrolled: boolean
  factorType: 'totp'
  activatedAt: string | null
  lastUsedAt: string | null
  recoveryCodesRemaining: number
  session: {
    mfaVerifiedAt: string; mfaMethod: 'totp' | 'recovery_code'; stepUpExpiresAt: string | null
    idleExpiresAt: string; absoluteExpiresAt: string
  } | null
}
export interface PlatformSessionInfo {
  sessionId: string; familyId: string; kind: string; authenticationMethod: string; signedInAt: string
  lastRefreshedAt: string; idleExpiresAt: string; absoluteExpiresAt: string; mfaVerifiedAt: string | null
  mfaMethod: string | null; lastStepUpAt: string | null; sourceIp: string | null; current: boolean
}
export interface SessionList { accountId: string; items: PlatformSessionInfo[] }
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
export type ApprovalDecision = 'approve' | 'reject' | 'cancel'
export interface ApprovalRequest extends Versioned {
  id: string; action: 'platform_role.grant' | 'mfa.reset'; roleCode: string | null; targetAccountId: string
  targetEmail: string | null; targetDisplayName: string | null; reason: string; status: ApprovalStatus
  requestedBy: string; requestedAt: string; expiresAt: string; decidedBy: string | null; decidedAt: string | null
  decisionReason: string | null; executedAt: string | null
}
export interface ApprovalRequested extends Versioned { requestId: string; status: ApprovalStatus; expiresAt: string; replayed: boolean }
export interface ApprovalDecided extends Versioned {
  requestId: string; status: ApprovalStatus; action: string; targetAccountId: string; executed: boolean; replayed: boolean
}
// Clinician self sign-up review (hid-system ADR-066, branch claude/clinician-self-signup at fa58e2b, not
// merged): ClinicianApplicationAdminService and identity.admin_get_clinician_application (C18). Field names
// and values are the backend's.

export type ClinicianApplicationState = 'awaiting_authenticator' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'withdrawn' | 'expired'
/** `open` lists the three undecided states (not overdue), oldest first; a named state lists newest first. */
export type ClinicianApplicationFilter = 'open' | ClinicianApplicationState
/** The reason shown to the applicant; `identity_not_confirmed` also stops the account applying again. */
export type ClinicianDecisionCode = 'licence_not_verified' | 'licence_not_current' | 'details_mismatch'
  | 'identity_not_confirmed' | 'employment_not_confirmed' | 'facility_not_available' | 'duplicate' | 'existing_account' | 'other'
export interface ClinicianApplicationSummary extends Versioned {
  applicationId: string; state: ClinicianApplicationState | string; submittedAt: string; expiresAt: string
  applicant: { accountId: string; fullName: string; email: string }
  profession: 'doctor' | 'nurse' | string; regulator: { code: string; name: string }
  licenceNumber: string; licenceValidUntil: string
  facility: { id: string; name: string; organizationName: string }
  authenticatorReady: boolean
  step1: { by: { accountId: string; displayName: string | null }; at: string } | null
}
/** Why the caller may not take a step (a display hint: the command checks again). */
export type ClinicianStepRefusal = 'SELF' | 'WORKS_AT_FACILITY' | 'STATE' | 'STEP1_BY_YOU' | 'AUTHENTICATOR_REQUIRED'
  | 'ACCOUNT_INELIGIBLE'
export interface ClinicianStepHint { allowed: boolean; reason: ClinicianStepRefusal | string | null }
export interface ClinicianAttestationChecklist {
  registerChecked: true; licenceCurrentUntilRecorded: true; identityMethod: 'video_call_photo_id' | 'in_person_photo_id'
  identityConfirmed: true; employmentChannel: 'facility_public_phone' | 'in_person_visit'; employmentConfirmed: true
}
export interface ClinicianApplicationDetail extends Omit<ClinicianApplicationSummary, 'facility' | 'step1'> {
  account: { status: string; createdAt: string | null; emailVerifiedAt: string | null; patientAccount: boolean; identityRejection: boolean }
  staff: { id: string; verificationStatus: string; version: number } | null
  authenticator: { enrolled: boolean; factorId: string | null; activatedAt: string | null; enrolledAfterRecovery: boolean }
  otherMemberships: Array<{ facilityName: string; state: string; roles: string[] }>
  facility: {
    id: string; name: string; organizationName: string; lifecycleStatus: string; active: boolean; cacHint: string | null
    orgAdmins: Array<{ displayName: string | null; email: string }>
  }
  attestation: {
    id: string; reviewerAccountId: string; reviewerName: string | null; validUntil: string; evidenceReference: string
    reason: string; recordedAt: string; checklist: Partial<ClinicianAttestationChecklist> | null; factorConfirmedAt: string | null
  } | null
  approval: { by: string; at: string; membershipId: string | null } | null
  decision: { code: ClinicianDecisionCode | string | null; reason: string | null; by: string | null; at: string } | null
  accessState: 'active' | 'lapsed' | 'ended' | 'account_unavailable' | string | null
  rolePermissions: string[]
  flags: {
    sameLicenceKeyOtherAccounts: number; sameLicenceKeyOtherOpenApplications: number; sameLicenceAttestedElsewhere: boolean
    orgAdminNameMatch: boolean; orgAdminEmailDomainMatch: boolean
  }
  callerHints: { attest: ClinicianStepHint; approve: ClinicianStepHint; reject: ClinicianStepHint }
}
/** A3's body. The applicant's code is checked once and never stored; a replay needs no new code. */
export interface ClinicianAttestation {
  validUntil: string; evidenceReference: string; checklist: ClinicianAttestationChecklist; authenticatorCode: string; reason: string
}
export interface ClinicianAttested extends Versioned {
  applicationId: string; state: 'under_review'; attestationId: string; attestedRoles: string[]
  verificationMethod: 'manual_review'; validUntil: string; replayed: boolean
}
export interface ClinicianApproved extends Versioned {
  applicationId: string; state: 'approved'; accountId: string; facilityId: string; membershipId: string; roleCode: string
  attestationId: string; replayed: boolean
}
export interface ClinicianRejected extends Versioned {
  applicationId: string; state: 'rejected'; decisionCode: ClinicianDecisionCode; replayed: boolean
}
type ClinicianApplicationRef = Pick<ClinicianApplicationSummary, 'applicationId' | 'version'>

/** Principal export. Header values are null when the browser may not read them. */
export interface PrincipalExport { blob: Blob; rowCount: number | null; rowLimit: number | null; truncated: boolean | null }

/** The backend's own rejection of a submitted code: never resend that code. */
const keepCodeRejection = (error: HidApiError) => error.code !== 'MFA_INVALID_CODE'

let client: ReturnType<typeof createApiClient> | null = null
function gateway() {
  client ??= createRegisteredBrowserClient(createApiClient({ baseUrl: environment().apiBaseUrl,
    clientId: 'admin-web', sessionMode: 'cookie', csrfCookieName: 'hid_access_admin_csrf',
    refreshSession: async () => { await adminApi.refresh() } }), 'admin-web')
  return client
}

/** Platform sign-in steps whose 401 is an answer to the submitted credential. */
const SIGN_IN_PATHS = ['/api/v1/auth/admin/login', '/api/v1/auth/admin/mfa/', '/api/v1/auth/admin/refresh']

async function request<T>(path: string, options: Partial<RequestSpec> = {}): Promise<T> {
  if (!path.startsWith('/api/v1/admin/') && !path.startsWith('/api/v1/auth/')) {
    throw new Error('The admin application can call only its own backend routes.')
  }
  // Platform administration is platform-scoped: the backend binds no facility
  // to admin routes, so admin requests never carry a provider facility context.
  if (Object.keys(options.headers ?? {}).some(name => name.toLowerCase() === 'x-facility-id')) {
    throw new Error('Platform administration requests do not carry a facility.')
  }
  try {
    return await gateway().request<T>({ method: options.method ?? 'GET', path,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.responseType ? { responseType: options.responseType } : {}),
      ...(options.refreshOnUnauthorized ? { refreshOnUnauthorized: options.refreshOnUnauthorized } : {}),
      auth: options.auth ?? 'required',
    })
  } catch (error) {
    // A protected request still unauthenticated after the client's one refresh,
    // or refused for lacking an MFA-verified platform session, means the server
    // no longer accepts this platform session. The server says whether it
    // expired or was revoked when it can (Stage 4A).
    if (isHidApiError(error) && options.auth !== 'none' && !SIGN_IN_PATHS.some(prefix => path.startsWith(prefix))
      && ((error.status === 401 && SESSION_END_CODES.has(error.code))
        || (error.status === 403 && error.code === 'PLATFORM_SESSION_REQUIRED'))) {
      reportSessionEnded(serverSessionEnd(error.code))
    }
    throw error
  }
}

/** 401 codes meaning the server no longer accepts this platform session. */
const SESSION_END_CODES = new Set(['AUTHENTICATION_REQUIRED', 'PLATFORM_SESSION_EXPIRED', 'PLATFORM_SESSION_REVOKED'])

/**
 * The administrator whose workspace is open, or null while none is (checking,
 * signing in, signed out, ended). Held in memory only. Every admin tab shares the
 * browser's platform cookies, so a refresh can answer for an administrator who
 * signed in from another tab: that has not restored this workspace's session.
 */
let openAccount: string | null = null
/**
 * A workspace ended and no other is being opened yet (no session check or
 * sign-in since). Requests it sent may still be refused with 401 after the
 * browser's cookies came to hold another administrator's session; a refresh
 * then would answer for them and the client would repeat the request, a command
 * included, as them. So none is made until the next workspace is opened.
 */
let workspaceClosed = false

export function adminSessionAccount(): string | null {
  return openAccount
}

/** Binds the workspace to `accountId`; with null, opens the way for one (a session check or a sign-in). */
export function setAdminSessionAccount(accountId: string | null): void {
  openAccount = accountId
  workspaceClosed = false
}

/** The workspace ended: no session is restored for it, or as anyone, until the next one is opened. */
export function closeAdminSession(): void {
  openAccount = null
  workspaceClosed = true
}

/** The client does not repeat a request whose refresh is refused with this 401. */
function sessionNotRestored(): HidApiError {
  return new HidApiError(401, 'Your platform session has ended. Sign in again to continue.',
    { code: 'AUTHENTICATION_REQUIRED', retryable: false })
}

function grant(value: PlatformSessionGrant): PlatformSessionGrant {
  recordSessionWindow({ idleExpiresAt: value.idleExpiresAt })
  return value
}

/**
 * A sign-in step that answered with a session has set the browser's platform
 * cookies, which every admin tab sends from then on, so the other tabs are told
 * at once rather than when this one opens its workspace.
 */
function signedIn<T extends PlatformSessionGrant>(value: T): T {
  grant(value)
  announceAdminSessionChange()
  return value
}

/** One key per user submission, reused if that submission is retried after step-up. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

const at = (base: string, ...segments: string[]) => [base, ...segments.map(encodeURIComponent)].join('/')

/** Rows per page for paged admin lists (the backend allows up to 100). */
export const PAGE_SIZE = 25
/** Audit events per request (the backend allows up to 200). */
export const AUDIT_PAGE_SIZE = 50
/** Rows per page for the cursor-paged demo-request list (the backend allows up to 100). */
export const CURSOR_PAGE_SIZE = 50

/**
 * An Identity build before hid-system Stage 4A returns `{ items }` without
 * `nextCursor`: its list is the backend's capped first page, with no further page.
 */
async function cursorPage<T>(page: Promise<CursorPage<T>>): Promise<CursorPage<T>> {
  const value = await page
  return { items: value.items, nextCursor: value.nextCursor ?? null }
}

/**
 * An Identity without hid-system ADR-066 has no queue: its 404 names no
 * clinician code (`NOT_FOUND`, with a detail naming the route). It is said as
 * that, never as a missing application or in the router's words.
 */
async function clinicianQueue<T>(read: Promise<T>): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (isHidApiError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      throw new HidApiError(404, 'The clinician queue is not available from this Identity.',
        { code: 'CLINICIAN_QUEUE_UNAVAILABLE', requestId: error.requestId, retryable: false })
    }
    throw error
  }
}

export const adminApi = {
  login(email: string, password: string, token: string) {
    return request<PlatformLoginChallenge>('/api/v1/auth/admin/login', { method: 'POST', auth: 'none',
      body: { email, password, turnstileAction: 'admin-login', ...(token ? { turnstileToken: token } : {}) } })
  },
  async verifyMfa(input: { code: string } | { recoveryCode: string }) {
    return signedIn(await request<PlatformSessionGrant>('/api/v1/auth/admin/mfa/verify', { method: 'POST', auth: 'none', body: input }))
  },
  startEnrollment() {
    return request<MfaEnrollment>('/api/v1/auth/admin/mfa/enroll/start', { method: 'POST', auth: 'none' })
  },
  async activateEnrollment(code: string) {
    return signedIn(await request<PlatformSessionGrant & { recoveryCodes: string[] }>(
      '/api/v1/auth/admin/mfa/enroll/activate', { method: 'POST', auth: 'none', body: { code } }))
  },
  session() { return request<AdminSession>('/api/v1/admin/session') },
  async refresh() {
    if (workspaceClosed) throw sessionNotRestored()
    let refreshed: PlatformSessionGrant
    try {
      refreshed = await request<PlatformSessionGrant>('/api/v1/auth/admin/refresh', { method: 'POST', auth: 'optional' })
    } catch (error) {
      // The shared client reports the original request's 401 after a failed
      // refresh, so keep the refresh's own reason for the session-end notice.
      if (isHidApiError(error) && error.status === 401) recordServerSessionEnd(serverSessionEnd(error.code))
      throw error
    }
    // A session for another administrator ends this workspace. The refusal is a
    // 401, so the client does not repeat the original request as them.
    if (openAccount !== null && refreshed.actor?.accountId !== openAccount) {
      reportSessionEnded('switched')
      throw sessionNotRestored()
    }
    return grant(refreshed)
  },
  logout() { return request<void>('/api/v1/auth/admin/logout', { method: 'POST' }) },
  async mfaStatus(signal?: AbortSignal) {
    const status = await request<MfaStatus>('/api/v1/admin/mfa', { signal })
    if (status.session) {
      recordSessionWindow({ idleExpiresAt: status.session.idleExpiresAt, absoluteExpiresAt: status.session.absoluteExpiresAt })
    }
    return status
  },
  stepUp(code: string) {
    return request<{ stepUpExpiresAt: string }>('/api/v1/admin/mfa/step-up', { method: 'POST', body: { code },
      refreshOnUnauthorized: keepCodeRejection })
  },
  regenerateRecoveryCodes() {
    return request<{ recoveryCodes: string[] }>('/api/v1/admin/mfa/recovery-codes/regenerate', { method: 'POST' })
  },
  sessions(signal?: AbortSignal) { return request<SessionList>('/api/v1/admin/sessions', { signal }) },
  revokeOwnSession(sessionId: string) {
    return request<{ sessionId: string; revokedCount: number }>(at('/api/v1/admin/sessions', sessionId, 'revoke'), { method: 'POST' })
  },
  principalSessions(accountId: string, signal?: AbortSignal) {
    return request<SessionList>(at('/api/v1/admin/principals', accountId, 'sessions'), { signal })
  },
  revokePrincipalSession(accountId: string, sessionId: string, input: { reason: string; compromised: boolean }, idempotencyKey: string) {
    return request<{ accountId: string; revokedCount: number; replayed: boolean }>(
      at('/api/v1/admin/principals', accountId, 'sessions', sessionId, 'revoke'),
      { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  /**
   * Newest first, one page per call (the backend's default of 50 rows unless
   * `limit` is given); pass the previous page's `nextCursor` with the same
   * status. `limit` and `cursor` are sent only when given, because an Identity
   * build before Stage 4A refuses any parameter but `status`.
   */
  approvals(status: ApprovalStatus | null, page: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
    return cursorPage(request<CursorPage<ApprovalRequest>>('/api/v1/admin/approvals', { signal, query: {
      ...(status ? { status } : {}), ...(page.limit ? { limit: page.limit } : {}),
      ...(page.cursor ? { cursor: page.cursor } : {}) } }))
  },
  requestSuperAdmin(accountId: string, reason: string, idempotencyKey: string) {
    return request<ApprovalRequested>(at('/api/v1/admin/principals', accountId, 'super-admin-requests'),
      { method: 'POST', body: { reason }, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  requestMfaReset(accountId: string, reason: string, idempotencyKey: string) {
    return request<ApprovalRequested>(at('/api/v1/admin/principals', accountId, 'mfa-reset-requests'),
      { method: 'POST', body: { reason }, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  decideApproval(approval: Pick<ApprovalRequest, 'id' | 'version'>, decision: ApprovalDecision, reason: string, idempotencyKey: string) {
    return adminApi.command<ApprovalDecided>(at('/api/v1/admin/approvals', approval.id, decision), { reason },
      { version: approval.version, idempotencyKey })
  },
  async exportPrincipals(input: { reason: string; query?: string; status?: string }, signal?: AbortSignal): Promise<PrincipalExport> {
    // Every export is audited, so a failed export is never repeated automatically. Its terms and the
    // audited reason go in the body, out of URLs and access logs (hid-system A24).
    const result = await request<DownloadResult>('/api/v1/admin/principals/export', { method: 'POST', responseType: 'download',
      retry: NO_RETRY, signal, body: { reason: input.reason,
        ...(input.query !== undefined ? { query: input.query } : {}), ...(input.status !== undefined ? { status: input.status } : {}) } })
    const header = (name: string) => result.headers.get(name)
    const count = header('X-HID-Export-Row-Count')
    const limit = header('X-HID-Export-Row-Limit')
    const truncated = header('X-HID-Export-Truncated')
    return { blob: result.blob, rowCount: count === null ? null : Number(count), rowLimit: limit === null ? null : Number(limit),
      truncated: truncated === null ? null : truncated === 'true' }
  },
  overview(signal?: AbortSignal) { return request<PlatformOverview>('/api/v1/admin/overview', { signal }) },
  controls(signal?: AbortSignal) { return request<PlatformControl[]>('/api/v1/admin/controls', { signal }) },
  facilities(filters: { page?: number; pageSize?: number; status?: string; query?: string } = {}, signal?: AbortSignal) {
    return request<Page<Facility>>('/api/v1/admin/facilities', { signal, query: { page: filters.page ?? 1,
      pageSize: filters.pageSize ?? PAGE_SIZE, status: filters.status, query: filters.query } })
  },
  facility(facilityId: string, signal?: AbortSignal) {
    return request<Facility>(at('/api/v1/admin/facilities', facilityId), { signal })
  },
  assistedRegistration(facilityId: string, signal?: AbortSignal) {
    return request<AssistedRegistrationDesignation>(at('/api/v1/admin/facilities', facilityId, 'assisted-registration'), { signal })
  },
  /**
   * Designates or suspends a facility (hid-system #85, ADR-063): a high-risk command needing step-up, a
   * reason, the submission's key and If-Match with the version read, 0 for the first designation.
   */
  setAssistedRegistration(facilityId: string, input: AssistedRegistrationDesignationInput, version: number, idempotencyKey: string) {
    return adminApi.command<AssistedRegistrationSaved>(at('/api/v1/admin/facilities', facilityId, 'assisted-registration'), input,
      { version, idempotencyKey, creates: true })
  },
  /**
   * A search term is a name or an email address, so it goes in a POST body, never in a URL that browser
   * history or an access log keeps (hid-system A24). Being a POST, a failed search is not repeated.
   */
  principals(query: string, filters: { page?: number; status?: string } = {}, signal?: AbortSignal) {
    return request<Page<Principal>>('/api/v1/admin/principals/search', { method: 'POST', signal,
      body: { query, page: filters.page ?? 1, pageSize: PAGE_SIZE, ...(filters.status ? { status: filters.status } : {}) } })
  },
  reviews(filters: { page?: number; status?: string } = {}, signal?: AbortSignal) {
    return request<Page<IdentityReview>>('/api/v1/admin/identity/reviews', { signal,
      query: { page: filters.page ?? 1, pageSize: PAGE_SIZE, status: filters.status } })
  },
  audit(filters: AuditFilters = {}, beforeSequenceId?: string, signal?: AbortSignal) {
    return request<AuditEventPage>('/api/v1/admin/audit/events', { signal,
      query: { limit: AUDIT_PAGE_SIZE, ...filters, ...(beforeSequenceId ? { beforeSequenceId } : {}) } })
  },
  services(signal?: AbortSignal) { return request<{ checkedAt: string; services: ServiceState[] }>('/api/v1/admin/operations/services', { signal }) },
  events(signal?: AbortSignal) { return request<{ state: string; code: string | null; metrics: Record<string, number | boolean> | null; failures: DeliveryFailure[] }>('/api/v1/admin/operations/events', { signal }) },
  pricing(signal?: AbortSignal) { return request<PricingCatalog>('/api/v1/admin/pricing', { signal }) },
  /** Newest first, one page per call; pass the previous page's `nextCursor` with the same filters. */
  demos(filters: { status?: DemoStatus; productCode?: string } = {}, page: { cursor?: string; limit?: number } = {},
    signal?: AbortSignal) {
    return cursorPage(request<CursorPage<DemoRequest>>('/api/v1/admin/demo-requests', { signal,
      query: { limit: page.limit ?? CURSOR_PAGE_SIZE, status: filters.status, productCode: filters.productCode,
        ...(page.cursor ? { cursor: page.cursor } : {}) } }))
  },
  applications(status?: ApplicationStatus, signal?: AbortSignal) {
    return request<{ items: OrganizationApplication[] }>('/api/v1/admin/organization-applications', { signal,
      ...(status ? { query: { status } } : {}) })
  },
  verifyApplicationCac(application: Pick<OrganizationApplication, 'applicationId' | 'version'>) {
    return adminApi.command<{ status: string; version: number; state: string; profileState?: string }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'verify-cac'), {}, { version: application.version })
  },
  approveApplication(application: Pick<OrganizationApplication, 'applicationId' | 'version'>, reason: string,
    existing?: { organizationId: string; facilityId: string }) {
    return adminApi.command<{ organizationId: string; facilityId: string; firstAdminAccountId: string; version: number; organizationReused: boolean }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'approve'),
      { reason, ...(existing ? { existingOrganizationId: existing.organizationId, existingFacilityId: existing.facilityId } : {}) },
      { version: application.version })
  },
  rejectApplication(application: Pick<OrganizationApplication, 'applicationId' | 'version'>, reason: string) {
    return adminApi.command<{ status: string; version: number }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'reject'), { reason }, { version: application.version })
  },
  integrations(signal?: AbortSignal) { return request<IntegrationCatalog>('/api/v1/admin/integrations', { signal }) },
  integrationHistory(provider: string, signal?: AbortSignal) {
    return request<{ items: IntegrationEvent[] }>(at('/api/v1/admin/integrations', provider, 'audit'), { signal })
  },
  configureIntegration(provider: Pick<IntegrationProvider, 'provider' | 'version'>, configuration: Record<string, string>,
    reason: string, idempotencyKey: string) {
    return adminApi.command<{ provider: string; enabled: boolean; configuration: Record<string, string>; version: number; replayed: boolean }>(
      at('/api/v1/admin/integrations', provider.provider, 'configuration'), { configuration, reason },
      { version: provider.version, idempotencyKey })
  },
  /**
   * The clinician verification queue (A1), one page per call: `limit` and
   * `cursor` are sent only when given (the backend's page is 20, at most 50).
   * The query carries no personal data.
   */
  clinicianApplications(state: ClinicianApplicationFilter, page: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
    return clinicianQueue(cursorPage(request<CursorPage<ClinicianApplicationSummary>>('/api/v1/admin/clinician-applications', {
      signal, query: { state, ...(page.limit ? { limit: page.limit } : {}), ...(page.cursor ? { cursor: page.cursor } : {}) } })))
  },
  /** A2: one application with what both steps need, its warnings and the caller's hints. */
  clinicianApplication(applicationId: string, signal?: AbortSignal) {
    return clinicianQueue(request<ClinicianApplicationDetail>(at('/api/v1/admin/clinician-applications', applicationId), { signal }))
  },
  /** A3, step 1: the checklist, the evidence reference, the validity and a live code the applicant reads out. */
  attestClinicianApplication(application: ClinicianApplicationRef, input: ClinicianAttestation, idempotencyKey: string) {
    return adminApi.command<ClinicianAttested>(at('/api/v1/admin/clinician-applications', application.applicationId, 'attest'),
      input, { version: application.version, idempotencyKey })
  },
  /** A4, step 2: only a Super Admin other than step 1's; attaches the account and grants the role step 1 attested. */
  approveClinicianApplication(application: ClinicianApplicationRef, reason: string, idempotencyKey: string) {
    return adminApi.command<ClinicianApproved>(at('/api/v1/admin/clinician-applications', application.applicationId, 'approve'),
      { reason }, { version: application.version, idempotencyKey })
  },
  /** A5: a decision code the applicant sees and a reason they never see. */
  rejectClinicianApplication(application: ClinicianApplicationRef, decisionCode: ClinicianDecisionCode, reason: string,
    idempotencyKey: string) {
    return adminApi.command<ClinicianRejected>(at('/api/v1/admin/clinician-applications', application.applicationId, 'reject'),
      { decisionCode, reason }, { version: application.version, idempotencyKey })
  },
  /**
   * A governed admin command. Pass the submission's idempotency key so a retry
   * after step-up is the same command, never a second one. `version` goes as
   * If-Match; it is at least 1, or 0 for a command that `creates` its resource
   * (the facility designation, hid-system #85), whose If-Match: 0 is sent too.
   */
  command<T>(path: string, body: unknown, options: { version?: number; idempotencyKey?: string; creates?: boolean } = {}) {
    if (!path.startsWith('/api/v1/admin/')) throw new Error('Admin command route required.')
    if (options.version !== undefined
      && (!Number.isSafeInteger(options.version) || options.version < (options.creates ? 0 : 1))) {
      throw new Error('Reload this item before changing it.')
    }
    return request<T>(path, { method: 'POST', body, headers: {
      ...(options.version !== undefined ? { 'If-Match': `"${options.version}"` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    } })
  },
}
