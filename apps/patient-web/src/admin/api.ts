import { createApiClient, isHidApiError, NO_RETRY, type DownloadResult, type HidApiError, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { environment } from './env'
import { recordSessionWindow, reportSessionEnded } from './session-window'

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
export interface Versioned { version: number }
export interface Facility extends Versioned {
  id: string; organizationId: string; organizationName: string; name: string; code: string; status: string
  statusReason: string | null; statusChangedAt: string | null; createdAt: string; membershipCount: number
}
export interface PrincipalMembership { id: string; facilityId: string; facilityName: string; role: string; appRole: string; active: boolean }
export interface Principal extends Versioned {
  id: string; subject: string; email: string | null; displayName: string | null; status: string; createdAt: string
  platformRoles: string[]; activeSessionCount: number; memberships: PrincipalMembership[]
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
// 7cbbf98 (ADR-038). Field names and values are the backend's.

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
    // no longer accepts this platform session.
    if (isHidApiError(error) && options.auth !== 'none' && !SIGN_IN_PATHS.some(prefix => path.startsWith(prefix))
      && ((error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED')
        || (error.status === 403 && error.code === 'PLATFORM_SESSION_REQUIRED'))) {
      reportSessionEnded()
    }
    throw error
  }
}

function grant(value: PlatformSessionGrant): PlatformSessionGrant {
  recordSessionWindow({ idleExpiresAt: value.idleExpiresAt })
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
/** The demo request list has no paging; the backend returns at most 100 of the newest. */
export const DEMO_REQUEST_LIMIT = 100

export const adminApi = {
  login(email: string, password: string, token: string) {
    return request<PlatformLoginChallenge>('/api/v1/auth/admin/login', { method: 'POST', auth: 'none',
      body: { email, password, turnstileAction: 'admin-login', ...(token ? { turnstileToken: token } : {}) } })
  },
  async verifyMfa(input: { code: string } | { recoveryCode: string }) {
    return grant(await request<PlatformSessionGrant>('/api/v1/auth/admin/mfa/verify', { method: 'POST', auth: 'none', body: input }))
  },
  startEnrollment() {
    return request<MfaEnrollment>('/api/v1/auth/admin/mfa/enroll/start', { method: 'POST', auth: 'none' })
  },
  async activateEnrollment(code: string) {
    const activated = await request<PlatformSessionGrant & { recoveryCodes: string[] }>(
      '/api/v1/auth/admin/mfa/enroll/activate', { method: 'POST', auth: 'none', body: { code } })
    grant(activated)
    return activated
  },
  session() { return request<AdminSession>('/api/v1/admin/session') },
  async refresh() {
    return grant(await request<PlatformSessionGrant>('/api/v1/auth/admin/refresh', { method: 'POST', auth: 'optional' }))
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
  approvals(status: ApprovalStatus | null, signal?: AbortSignal) {
    return request<{ items: ApprovalRequest[] }>('/api/v1/admin/approvals', { signal, ...(status ? { query: { status } } : {}) })
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
    // Every export is audited, so a failed export is never repeated automatically.
    const result = await request<DownloadResult>('/api/v1/admin/principals/export', { responseType: 'download',
      retry: NO_RETRY, signal, query: { reason: input.reason, query: input.query, status: input.status } })
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
  principals(query: string, filters: { page?: number; status?: string } = {}, signal?: AbortSignal) {
    return request<Page<Principal>>('/api/v1/admin/principals', { signal,
      query: { page: filters.page ?? 1, pageSize: PAGE_SIZE, query, status: filters.status } })
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
  demos(filters: { status?: DemoStatus; productCode?: string } = {}, signal?: AbortSignal) {
    return request<{ items: DemoRequest[] }>('/api/v1/admin/demo-requests', { signal,
      query: { limit: DEMO_REQUEST_LIMIT, status: filters.status, productCode: filters.productCode } })
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
   * A governed admin command. Pass the submission's idempotency key so a retry
   * after step-up is the same command, never a second one.
   */
  command<T>(path: string, body: unknown, options: { version?: number; idempotencyKey?: string } = {}) {
    if (!path.startsWith('/api/v1/admin/')) throw new Error('Admin command route required.')
    if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) {
      throw new Error('Reload this item before changing it.')
    }
    return request<T>(path, { method: 'POST', body, headers: {
      ...(options.version ? { 'If-Match': `"${options.version}"` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    } })
  },
}
