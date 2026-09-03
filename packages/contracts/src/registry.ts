/**
 * The Health ID API surface, as it actually exists today.
 *
 * Every entry below was read from the backend source at the frozen release.
 * For each endpoint the *surface* is verified — its name, its HTTP methods and
 * whether it requires authentication or a specific role. The *payloads* are
 * not: request and response shapes were not read endpoint by endpoint, so this
 * registry does not claim to know them, and no type in this package pretends to.
 *
 * This file is the frontend's single source of truth for "what can be called".
 * A service module that wants an endpoint not listed here is asking for a
 * contract that does not exist yet, and that is a conversation with the backend
 * team rather than something to invent locally.
 */

import type { HidAppRole } from './domain'

/**
 * Backend service that owns an endpoint. Service ownership is what application
 * boundaries are enforced against — an application is granted services, not
 * individual endpoints, so adding an endpoint to an owned service does not
 * silently widen an application's reach.
 */
export type HidService =
  | 'identity'
  | 'ehr'
  | 'access'
  | 'files'
  | 'notifications'
  | 'outreach'
  | 'ocr'
  | 'admin'
  | 'platform'
  | 'lab'
  | 'pharmacy'

/** What the caller must present. Enforced by the backend; declared here for the client. */
export type EndpointAuth =
  /** No credentials. */
  | { readonly kind: 'public' }
  /** Any authenticated principal. */
  | { readonly kind: 'authenticated' }
  /** An authenticated principal holding one of these roles. */
  | { readonly kind: 'role'; readonly roles: readonly HidAppRole[] }

/** How much of this endpoint's contract the frontend can rely on. */
export type ContractStatus =
  /** Name, methods and auth read from backend source. Payloads unconfirmed. */
  | 'surface-verified'
  /** No backend endpoint exists. The frontend must not call it. */
  | 'missing'

export interface EndpointDescriptor {
  /** Gateway-relative path, without a leading slash. */
  readonly name: string
  readonly service: HidService
  readonly methods: readonly ('GET' | 'POST')[]
  readonly auth: EndpointAuth
  readonly status: ContractStatus
  /** Anything a caller needs to know that the shape does not convey. */
  readonly note?: string
}

const PUBLIC: EndpointAuth = { kind: 'public' }
const AUTHENTICATED: EndpointAuth = { kind: 'authenticated' }
const PLATFORM_ADMIN: EndpointAuth = { kind: 'role', roles: ['platform_admin'] }

function endpoint(
  name: string,
  service: HidService,
  methods: readonly ('GET' | 'POST')[],
  auth: EndpointAuth,
  note?: string,
): EndpointDescriptor {
  return { name, service, methods, auth, status: 'surface-verified', ...(note ? { note } : {}) }
}

/**
 * Endpoints confirmed to exist at the frozen backend release.
 *
 * Ordering follows service ownership so a reader can see the shape of each
 * service at a glance.
 */
export const HID_ENDPOINTS: readonly EndpointDescriptor[] = [
  // --- identity ------------------------------------------------------------
  endpoint('signup-availability', 'identity', ['POST'], PUBLIC),
  endpoint('signup-start', 'identity', ['POST'], PUBLIC),
  endpoint('signup-verify', 'identity', ['POST'], PUBLIC),
  endpoint('patient-login', 'identity', ['POST'], PUBLIC),
  endpoint('patient-register', 'identity', ['POST'], AUTHENTICATED),
  endpoint('patient-reset-start', 'identity', ['POST'], PUBLIC),
  endpoint('patient-reset-verify', 'identity', ['POST'], PUBLIC),
  endpoint('patient-reset-complete', 'identity', ['POST'], PUBLIC),
  endpoint('patient-access-pin', 'identity', ['POST'], AUTHENTICATED),
  endpoint('patients-me', 'identity', ['GET'], AUTHENTICATED, 'Returns patient profile data. Identifying and clinical fields; do not cache to storage.'),
  endpoint('staff-login', 'identity', ['POST'], PUBLIC),
  endpoint('staff-complete-onboarding', 'identity', ['POST'], AUTHENTICATED),
  endpoint('staff-search', 'identity', ['GET'], AUTHENTICATED),
  endpoint('google-signin-eligibility', 'identity', ['POST'], PUBLIC),
  endpoint('google-signin-finalize', 'identity', ['POST'], AUTHENTICATED),
  endpoint('account-delete-start', 'identity', ['POST'], AUTHENTICATED),
  endpoint('account-delete-verify', 'identity', ['POST'], AUTHENTICATED),
  endpoint('delete-my-account', 'identity', ['POST'], AUTHENTICATED),
  endpoint('admin-password-reset-start', 'identity', ['POST'], PUBLIC, 'Public by design: it starts a reset for an account that may not be signed in.'),

  // --- ehr -----------------------------------------------------------------
  endpoint('patients-records', 'ehr', ['GET'], AUTHENTICATED, 'Clinical content.'),
  endpoint('patient-history-list', 'ehr', ['GET'], AUTHENTICATED, 'Clinical content.'),
  endpoint('records-create', 'ehr', ['POST'], AUTHENTICATED, 'Not idempotent; never retried automatically.'),
  endpoint('records-version-create', 'ehr', ['POST'], AUTHENTICATED, 'Not idempotent; never retried automatically.'),
  endpoint('health-events', 'ehr', ['GET', 'POST'], AUTHENTICATED, 'Clinical content.'),
  endpoint('health-event-update', 'ehr', ['POST'], AUTHENTICATED),
  endpoint('staff-dashboard', 'ehr', ['GET'], AUTHENTICATED),

  // --- access control and consent -----------------------------------------
  endpoint('access-request-create', 'access', ['POST'], AUTHENTICATED),
  endpoint('access-grant-close', 'access', ['POST'], AUTHENTICATED),
  endpoint('access-grant-revoke', 'access', ['POST'], AUTHENTICATED),
  endpoint('break-glass', 'access', ['POST'], AUTHENTICATED, 'Emergency access. Audited by the backend; the UI must state that plainly.'),
  endpoint('share-create', 'access', ['POST'], AUTHENTICATED),
  endpoint('share-invite-create', 'access', ['POST'], AUTHENTICATED),
  endpoint('share-invite-cancel', 'access', ['POST'], AUTHENTICATED),
  endpoint('audit-list', 'access', ['GET'], AUTHENTICATED),

  // --- files ---------------------------------------------------------------
  endpoint('files-sign-upload', 'files', ['POST'], AUTHENTICATED, 'Returns a short-lived signed URL. Never persist it.'),
  endpoint('files-register-upload', 'files', ['POST'], AUTHENTICATED),
  endpoint('files-sign-download', 'files', ['POST'], AUTHENTICATED, 'Returns a short-lived signed URL. Never persist it.'),

  // --- notifications -------------------------------------------------------
  endpoint('notifications-list', 'notifications', ['GET'], AUTHENTICATED),

  // --- outreach ------------------------------------------------------------
  endpoint('outreach-signup', 'outreach', ['POST'], PUBLIC),
  endpoint('outreach-verify-otp', 'outreach', ['POST'], PUBLIC),
  endpoint('outreach-resend-otp', 'outreach', ['POST'], PUBLIC),
  endpoint('outreach-join', 'outreach', ['POST'], PUBLIC),

  // --- OCR / migration -----------------------------------------------------
  endpoint('migration-context', 'ocr', ['GET'], AUTHENTICATED),
  endpoint('migration-capture', 'ocr', ['POST'], AUTHENTICATED),
  endpoint('migration-imports', 'ocr', ['GET', 'POST'], AUTHENTICATED),
  endpoint('migration-matching', 'ocr', ['GET', 'POST'], AUTHENTICATED),
  endpoint('migration-processing', 'ocr', ['GET', 'POST'], AUTHENTICATED),
  endpoint('migration-review', 'ocr', ['GET', 'POST'], AUTHENTICATED),
  endpoint('migration-operations', 'ocr', ['GET', 'POST'], AUTHENTICATED),

  // --- admin ---------------------------------------------------------------
  endpoint('admin-dashboard-overview', 'admin', ['GET'], PLATFORM_ADMIN),
  endpoint('admin-user-management', 'admin', ['GET', 'POST'], PLATFORM_ADMIN),
  endpoint('admin-role-management', 'admin', ['GET', 'POST'], PLATFORM_ADMIN),
  endpoint('admin-platform-controls', 'admin', ['GET', 'POST'], PLATFORM_ADMIN),
  endpoint('admin-ai-processing', 'admin', ['GET', 'POST'], PLATFORM_ADMIN),
  endpoint('admin-billing', 'admin', ['GET', 'POST'], PLATFORM_ADMIN),
  endpoint('admin-user-export', 'admin', ['POST'], PLATFORM_ADMIN, 'Bulk export of identifying data. Treat the response as PHI end to end.'),

  // --- platform ------------------------------------------------------------
  endpoint('health-check', 'platform', ['GET'], PUBLIC),
]

/**
 * Backend functions deliberately left out of the registry.
 *
 * The backend exposes 59 functions; 57 are registered above. These two are
 * backend-internal — they exist to be called by other backend components, not
 * by a browser — so giving them a frontend service module would invite exactly
 * the coupling this registry exists to prevent.
 */
export const NON_FRONTEND_ENDPOINTS: readonly string[] = [
  'send-email',
  'migration-worker-jobs',
]

const ENDPOINTS_BY_NAME = new Map(HID_ENDPOINTS.map(descriptor => [descriptor.name, descriptor]))

export function findEndpoint(name: string): EndpointDescriptor | undefined {
  return ENDPOINTS_BY_NAME.get(name)
}

export function endpointsForService(service: HidService): EndpointDescriptor[] {
  return HID_ENDPOINTS.filter(descriptor => descriptor.service === service)
}

/**
 * Services the platform is expected to offer that have no endpoints at the
 * frozen release. Listed so a product conversation about "the Lab app" starts
 * from the fact that there is nothing to call yet, rather than from a mock that
 * quietly became a second interpretation of the system.
 *
 * See `docs/OPEN-QUESTIONS.md`.
 */
export const SERVICES_WITHOUT_CONTRACTS: readonly HidService[] = ['lab', 'pharmacy']

export function hasContracts(service: HidService): boolean {
  return !SERVICES_WITHOUT_CONTRACTS.includes(service)
}
