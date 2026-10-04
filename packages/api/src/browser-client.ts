import type { ApiClient, RequestSpec } from '@hid/http'
import { APP_BOUNDARIES, BoundaryViolationError, assertEndpointAllowed,
  assertRegisteredBrowserRequest, type HidApp } from '@hid/contracts'

/** Guard raw and service-module requests before the HTTP client can send them. */
export function createRegisteredBrowserClient(transport: ApiClient, app: HidApp): ApiClient {
  if (!APP_BOUNDARIES[app]) throw new BoundaryViolationError('Unknown frontend application.')
  const client: ApiClient = {
    baseUrl: transport.baseUrl,
    async request<T>(spec: RequestSpec): Promise<T> {
      const endpoint = assertRegisteredBrowserRequest(spec.method, spec.path, spec.query)
      assertEndpointAllowed(app, endpoint.name)
      return transport.request<T>(spec)
    },
    get<T>(path: string, spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>): Promise<T> {
      return client.request<T>({ ...spec, method: 'GET', path })
    },
    post<T>(path: string, body?: unknown,
      spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>): Promise<T> {
      return client.request<T>({ ...spec, method: 'POST', path, body })
    },
  }
  return client
}
