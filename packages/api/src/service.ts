/**
 * Service module foundation.
 *
 * Application code can use typed service calls while the shared client keeps
 * certainly never calls `fetch`. It calls a service method. That indirection is
 * what makes it possible to change a path, add a header, or absorb a backend
 * contract change without touching a single component.
 *
 * Every method defined through here is checked twice at construction time:
 * the endpoint must exist in the verified registry, and the calling application
 * must be granted the service that owns it.
 */

import type { ApiClient, AuthRequirement, QueryValue, RequestSpec } from '@hid/http'
import { assertEndpointAllowed, findEndpoint, type EndpointMethod, type HidApp, type HidService } from '@hid/contracts'

/** Options every service method accepts, so cancellation is never an afterthought. */
export interface CallOptions {
  readonly timeoutMs?: number
  /** Abort the request when the component unmounts or the user navigates away. */
  readonly signal?: AbortSignal
  /** Facility, purpose, If-Match and idempotency headers required by a route. */
  readonly headers?: Readonly<Record<string, string>>
}

export interface ServiceContext {
  readonly app: HidApp
  readonly client: ApiClient
}

export interface EndpointCallOptions extends CallOptions {
  readonly query?: Readonly<Record<string, QueryValue>>
  readonly params?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly auth?: AuthRequirement
}

function pathWithParams(template: string, params: Readonly<Record<string, string>> = {}): string {
  const required = [...template.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map(match => match[1]!)
  for (const key of required) {
    if (!params[key]) throw new Error(`Missing route parameter "${key}"`)
  }
  for (const key of Object.keys(params)) {
    if (!required.includes(key)) throw new Error(`Unknown route parameter "${key}"`)
  }
  return template.replace(/:([A-Za-z][A-Za-z0-9]*)/g,
    (_, key: string) => encodeURIComponent(params[key]!))
}

/**
 * Binds a service's endpoints to a client for one application.
 *
 * `call` is the only way a service reaches the network, so every request
 * inherits the registry check, the boundary check, and the client's transport
 * behaviour.
 */
export function createServiceBinding(context: ServiceContext, service: HidService) {
  return function call<T = unknown>(
    endpointName: string,
    method: EndpointMethod,
    options: EndpointCallOptions = {},
  ): Promise<T> {
    assertEndpointAllowed(context.app, endpointName)

    const descriptor = findEndpoint(endpointName)
    if (!descriptor) {
      // assertEndpointAllowed already threw; this keeps the type narrow.
      throw new Error(`Unknown endpoint "${endpointName}"`)
    }

    if (descriptor.service !== service) {
      throw new Error(
        `Endpoint "${endpointName}" belongs to the "${descriptor.service}" service, ` +
          `not "${service}". Move the method to the correct service module.`,
      )
    }

    if (!descriptor.methods.includes(method)) {
      throw new Error(
        `"${endpointName}" does not accept ${method}. The backend declares: ${descriptor.methods.join(', ')}.`,
      )
    }

    const auth: AuthRequirement =
      options.auth ?? (descriptor.auth.kind === 'public' ? 'none' : 'required')

    const spec: RequestSpec = {
      method,
      path: pathWithParams(descriptor.path, options.params),
      auth,
      ...(options.query ? { query: options.query } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    }

    return context.client.request<T>(spec)
  }
}
