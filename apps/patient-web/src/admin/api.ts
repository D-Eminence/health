import { createApiClient, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { environment } from './env'

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
export interface AuditEvent { eventId: string; occurredAt: string; action: string; outcome: string; actorSubject: string | null; correlationId: string }
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

let client: ReturnType<typeof createApiClient> | null = null
function gateway() {
  client ??= createRegisteredBrowserClient(createApiClient({ baseUrl: environment().apiBaseUrl,
    clientId: 'admin-web', sessionMode: 'cookie',
    refreshSession: async () => { await adminApi.refresh() } }), 'admin-web')
  return client
}

function request<T>(path: string, options: Partial<RequestSpec> = {}): Promise<T> {
  if (!path.startsWith('/api/v1/admin/') && !path.startsWith('/api/v1/auth/')) {
    throw new Error('The admin application can call only its own backend routes.')
  }
  return gateway().request<T>({ method: options.method ?? 'GET', path,
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.query ? { query: options.query } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    auth: options.auth ?? 'required',
  })
}

export const adminApi = {
  login(email: string, password: string, token: string) {
    return request<unknown>('/api/v1/auth/login', { method: 'POST', auth: 'none',
      body: { email, password, turnstileAction: 'admin-login', turnstileToken: token } })
  },
  session() { return request<AdminSession>('/api/v1/admin/session') },
  refresh() { return request<unknown>('/api/v1/auth/refresh', { method: 'POST', auth: 'optional' }) },
  logout() { return request<void>('/api/v1/auth/logout', { method: 'POST' }) },
  overview(signal?: AbortSignal) { return request<Record<string, number>>('/api/v1/admin/overview', { signal }) },
  controls(signal?: AbortSignal) { return request<PlatformControl[]>('/api/v1/admin/controls', { signal }) },
  facilities(signal?: AbortSignal) { return request<Page<Facility>>('/api/v1/admin/facilities', { signal, query: { page: 1, pageSize: 50 } }) },
  principals(query: string, signal?: AbortSignal) { return request<Page<Principal>>('/api/v1/admin/principals', { signal, query: { page: 1, pageSize: 50, query } }) },
  reviews(signal?: AbortSignal) { return request<Page<IdentityReview>>('/api/v1/admin/identity/reviews', { signal, query: { page: 1, pageSize: 50 } }) },
  audit(signal?: AbortSignal) { return request<{ items: AuditEvent[] }>('/api/v1/admin/audit/events', { signal, query: { limit: 50 } }) },
  services(signal?: AbortSignal) { return request<{ checkedAt: string; services: ServiceState[] }>('/api/v1/admin/operations/services', { signal }) },
  events(signal?: AbortSignal) { return request<{ state: string; code: string | null; metrics: Record<string, number | boolean> | null; failures: unknown[] }>('/api/v1/admin/operations/events', { signal }) },
  pricing(signal?: AbortSignal) { return request<PricingCatalog>('/api/v1/admin/pricing', { signal }) },
  demos(signal?: AbortSignal) { return request<{ items: DemoRequest[] }>('/api/v1/admin/demo-requests', { signal, query: { limit: 50 } }) },
  applications(signal?: AbortSignal) { return request<{ items: OrganizationApplication[] }>('/api/v1/admin/organization-applications', { signal }) },
  integrations(signal?: AbortSignal) { return request<IntegrationCatalog>('/api/v1/admin/integrations', { signal }) },
  command<T>(path: string, body: unknown, options: { version?: number; idempotent?: boolean } = {}) {
    if (!path.startsWith('/api/v1/admin/')) throw new Error('Admin command route required.')
    if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) {
      throw new Error('Reload this item before changing it.')
    }
    return request<T>(path, { method: 'POST', body, headers: {
      ...(options.version ? { 'If-Match': `"${options.version}"` } : {}),
      ...(options.idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    } })
  },
}
