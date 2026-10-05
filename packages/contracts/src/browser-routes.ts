import { HID_ENDPOINTS, NON_FRONTEND_ENDPOINTS, type EndpointDescriptor } from './registry'

export type BrowserRouteErrorCode =
  | 'INVALID_PATH'
  | 'INTERNAL_ROUTE'
  | 'UNKNOWN_ROUTE'
  | 'WRONG_METHOD'
  | 'REQUIRED_QUERY'
  | 'UNSUPPORTED_RESPONSE'

/** Route errors omit the requested path because a path segment may be a patient ID. */
export class BrowserRouteError extends Error {
  constructor(readonly code: BrowserRouteErrorCode, message: string) {
    super(message)
    this.name = 'BrowserRouteError'
  }
}

type Query = Readonly<Record<string, string | number | boolean | null | undefined>>

function pathSegments(path: string): string[] {
  if (!path.startsWith('/api/v1/') && !path.startsWith('/gateway-health/')) {
    throw new BrowserRouteError('INVALID_PATH', 'Requests must use a registered gateway-relative path.')
  }
  if (path.includes('?') || path.includes('#') || path.includes('\\')) {
    throw new BrowserRouteError('INVALID_PATH', 'Put query values in the request query object.')
  }

  const segments = path.slice(1).split('/')
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new BrowserRouteError('INVALID_PATH', 'The request path has invalid encoding.')
    }
    // URL and proxy normalization must not turn a checked route into another route.
    const controlCharacter = [...decoded].some(character => character.charCodeAt(0) < 32)
    if (!segment || decoded === '.' || decoded === '..' ||
      /[\\/?#]/.test(decoded) || decoded.includes('%') || controlCharacter) {
      throw new BrowserRouteError('INVALID_PATH', 'The request path has an unsafe segment.')
    }
  }
  return segments
}

function matches(pattern: string, segments: readonly string[]): boolean {
  const expected = pattern.slice(1).split('/')
  const wildcard = expected.at(-1) === '*'
  if (wildcard ? segments.length < expected.length - 1 : segments.length !== expected.length) return false
  const count = wildcard ? expected.length - 1 : expected.length
  for (let index = 0; index < count; index += 1) {
    const part = expected[index]!
    if (!part.startsWith(':') && part !== segments[index]) return false
  }
  return true
}

function specificity(path: string): number {
  return path.split('/').filter(segment => segment && !segment.startsWith(':')).length
}

/**
 * Validate a browser request against the c4b5445 gateway surface before transport.
 * Static routes win over parameter routes, and workload-only routes always lose.
 */
export function assertRegisteredBrowserRequest(
  method: string,
  path: string,
  query?: Query,
): EndpointDescriptor {
  const segments = pathSegments(path)
  if (NON_FRONTEND_ENDPOINTS.some(pattern => matches(pattern, segments))) {
    throw new BrowserRouteError('INTERNAL_ROUTE', 'This route is not available to browser clients.')
  }

  const candidates = HID_ENDPOINTS.filter(endpoint => matches(endpoint.path, segments))
  if (candidates.length === 0) {
    throw new BrowserRouteError('UNKNOWN_ROUTE', 'The request route is not in the browser contract.')
  }
  const mostSpecific = Math.max(...candidates.map(endpoint => specificity(endpoint.path)))
  const endpoint = candidates.find(candidate =>
    specificity(candidate.path) === mostSpecific && candidate.methods.some(allowed => allowed === method))
  if (!endpoint) {
    throw new BrowserRouteError('WRONG_METHOD', 'The request method is not allowed for this route.')
  }
  if (endpoint.responseKind === 'download') {
    throw new BrowserRouteError('UNSUPPORTED_RESPONSE', 'This route needs a download transport.')
  }
  const required = endpoint.requiredQuery?.[method as keyof typeof endpoint.requiredQuery] ?? []
  for (const key of required) {
    const value = query?.[key]
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new BrowserRouteError('REQUIRED_QUERY', 'A required query parameter is missing.')
    }
  }
  return endpoint
}
