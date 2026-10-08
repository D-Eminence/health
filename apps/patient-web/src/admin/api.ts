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
export interface Facility extends Versioned { id: string; name: string; code: string; organizationName: string; status: string; membershipCount: number }
export interface Principal extends Versioned { id: string; email: string | null; displayName: string | null; status: string; platformRoles: string[]; activeSessionCount: number; memberships: Array<{ facilityName: string; role: string }> }
export interface IdentityReview { id: string; maskedNin: string; facilityName: string; provider: string; status: string; candidateCount: number; updatedAt: string }
export interface AuditEvent { sequenceId: string; eventId: string; occurredAt: string; action: string; outcome: string; actorSubject: string | null; correlationId: string }
export interface AuditEventPage { items: AuditEvent[]; nextBeforeSequenceId: string | null }
export interface PlatformControl extends Versioned { controlKey: string; enabled: boolean; reason: string; updatedAt: string }
export interface CommercialProduct extends Versioned { slug: string; name: string; status: 'active' | 'coming_soon' | 'draft' | 'retired' }
export interface CommercialPrice extends Versioned { product_slug: string; context: string; visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote' | 'hidden'; amount_minor: number | null; currency: string; billing_period: string | null; unit: string | null; active: boolean }
export interface PricingCatalog { products: CommercialProduct[]; prices: CommercialPrice[] }
export interface DemoRequest extends Versioned { id: string; contactName: string; contactEmail: string; organizationName: string | null; productCode: string; status: 'new' | 'contacted' | 'qualified' | 'closed'; createdAt: string }
export interface OrganizationApplication extends Versioned { applicationId: string; productCode: string; organizationName: string | null; administratorEmail: string; status: string; verificationResult: string | null }
export interface IntegrationProvider extends Versioned { provider: string; name: string; enabled: boolean; health: string; managementMode: string; availableActions: string[] }
export interface IntegrationCapability extends Versioned { capability: string; activeProvider: string | null; fallbackProvider: string | null; eligibleProviders: string[] }
export interface IntegrationCatalog { items: IntegrationProvider[]; capabilities: IntegrationCapability[] }
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
  overview(signal?: AbortSignal) { return request<Record<string, number>>('/api/v1/admin/overview', { signal }) },
  controls(signal?: AbortSignal) { return request<PlatformControl[]>('/api/v1/admin/controls', { signal }) },
  facilities(signal?: AbortSignal) { return request<Page<Facility>>('/api/v1/admin/facilities', { signal, query: { page: 1, pageSize: 50 } }) },
  principals(query: string, signal?: AbortSignal) { return request<Page<Principal>>('/api/v1/admin/principals', { signal, query: { page: 1, pageSize: 50, query } }) },
  reviews(signal?: AbortSignal) { return request<Page<IdentityReview>>('/api/v1/admin/identity/reviews', { signal, query: { page: 1, pageSize: 50 } }) },
  audit(signal?: AbortSignal, beforeSequenceId?: string) {
    return request<AuditEventPage>('/api/v1/admin/audit/events', { signal,
      query: { limit: 50, ...(beforeSequenceId ? { beforeSequenceId } : {}) } })
  },
  services(signal?: AbortSignal) { return request<{ checkedAt: string; services: ServiceState[] }>('/api/v1/admin/operations/services', { signal }) },
  events(signal?: AbortSignal) { return request<{ state: string; code: string | null; metrics: Record<string, number | boolean> | null; failures: unknown[] }>('/api/v1/admin/operations/events', { signal }) },
  pricing(signal?: AbortSignal) { return request<PricingCatalog>('/api/v1/admin/pricing', { signal }) },
  demos(signal?: AbortSignal) { return request<{ items: DemoRequest[] }>('/api/v1/admin/demo-requests', { signal, query: { limit: 50 } }) },
  applications(signal?: AbortSignal) { return request<{ items: OrganizationApplication[] }>('/api/v1/admin/organization-applications', { signal }) },
  integrations(signal?: AbortSignal) { return request<IntegrationCatalog>('/api/v1/admin/integrations', { signal }) },
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
