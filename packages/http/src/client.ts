/**
 * The Health ID API client.
 *
 * Every network call any Health ID frontend makes goes through here. Nothing
 * in a component, hook, page or route calls `fetch` directly, which is what
 * makes base URL, authentication, error shape, cancellation, retry and request
 * correlation changeable in one place when the backend contract moves.
 *
 * What this client deliberately does not do:
 *   - decide whether a user is allowed to do something (the backend does)
 *   - persist tokens (see @hid/auth)
 *   - log request or response bodies (they may carry PHI)
 *   - reach anything but the configured Health ID Gateway base URL
 */

import {
  HidApiError,
  fallbackMessageForStatus,
  isRetryableStatus,
} from './errors'
import { isLowSignalMessage, parseErrorEnvelope, parseJsonBody, unwrapData } from './envelope'
import {
  DEFAULT_READ_RETRY,
  NO_RETRY,
  isIdempotentMethod,
  nextDelayMs,
  parseRetryAfter,
  shouldRetry,
  type RetryPolicy,
} from './retry'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QueryValue = string | number | boolean | null | undefined

/** How a request relates to the caller's session. */
export type AuthRequirement =
  /** Send the token; fail fast with 401 if there is none. */
  | 'required'
  /** Send the token when one exists; proceed without it otherwise. */
  | 'optional'
  /** Never attach a token (public endpoints such as sign-in or availability). */
  | 'none'

export interface RequestSpec {
  readonly method: HttpMethod
  /** Gateway-relative path, e.g. `/patients-me`. Joined onto the configured base URL. */
  readonly path: string
  readonly query?: Readonly<Record<string, QueryValue>>
  readonly body?: unknown
  readonly auth?: AuthRequirement
  /** Caller cancellation, composed with the client's own timeout. */
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly retry?: RetryPolicy
  /**
   * Collapses concurrent identical in-flight reads into one request.
   * Defaults to true for GET, and is never applied to anything else.
   */
  readonly dedupe?: boolean
  /** Extra headers for this call. Must never carry a secret. */
  readonly headers?: Readonly<Record<string, string>>
  /**
   * `download` resolves a successful response as a {@link DownloadResult}
   * instead of parsing JSON. Failures still parse as problem details.
   */
  readonly responseType?: 'json' | 'download'
  /**
   * Whether a 401 should restore the cookie session and repeat the request.
   * Defaults to always. A request that submits a one-time credential (such as
   * an authenticator code) returns false for the backend's own rejection, so
   * the same code is never sent twice.
   */
  readonly refreshOnUnauthorized?: (error: HidApiError) => boolean
  /**
   * Whether this call's final 401 is passed to `onUnauthorized`. Defaults to
   * true. A call that asks about the session itself, and judges its own 401
   * (an expired access token that a refresh may still restore), passes false.
   */
  readonly reportUnauthorized?: boolean
  /**
   * Awaited immediately before every attempt is sent, retries and the repeat
   * after a refresh included. A caller can hold the request (for example while
   * its session is being checked) or end it by rejecting; the rejection is not
   * retried when its error says it is not retryable.
   */
  readonly beforeAttempt?: () => Promise<void>
}

/** A successful `download` response. Headers are those the browser may read. */
export interface DownloadResult {
  readonly blob: Blob
  readonly headers: Headers
}

export interface ApiClientLogger {
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export interface ApiClientOptions {
  /** Absolute Health ID Gateway base URL, from environment configuration. */
  readonly baseUrl: string
  /** hid-system browser sessions use HttpOnly cookies and a readable CSRF cookie. */
  readonly sessionMode?: 'bearer' | 'cookie'
  /** Override only when the backend's AUTH_COOKIE_NAME differs from hid_access. */
  readonly csrfCookieName?: string
  /** Useful in non-browser tests; defaults to reading document.cookie. */
  readonly getCsrfToken?: () => string | null
  /**
   * Supplies the current access token. Returning null means "not signed in".
   * The client never reads or writes storage itself.
   */
  readonly getAccessToken?: () => Promise<string | null> | string | null
  /**
   * Headers the gateway requires on every call (for example a client
   * identifier). Resolved per request so they can rotate without a rebuild.
   * Must contain only values that are safe to ship to a browser.
   */
  readonly getDefaultHeaders?: () => Promise<Record<string, string>> | Record<string, string>
  /** Wall-clock budget per attempt. Defaults to 15s, matching current behaviour. */
  readonly timeoutMs?: number
  /** Injected for tests and for runtimes with a non-global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Receives redacted diagnostics only. */
  readonly logger?: ApiClientLogger
  /**
   * Called once per 401 so the application can clear session state and route
   * the user to sign-in. The rejection still propagates to the caller.
   */
  readonly onUnauthorized?: (error: HidApiError) => void
  /** Restore a cookie session once before rejecting a protected request with 401. */
  readonly refreshSession?: () => Promise<void>
  /** Identifies the calling application in `X-HID-Client`, e.g. `patient-web`. */
  readonly clientId: string
  /** Injected in tests to make backoff deterministic. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly random?: () => number
}

const DEFAULT_TIMEOUT_MS = 15_000

/** The cookie session calls on which Identity reads `X-HID-Client`. */
const NAMED_CLIENT_PATHS: ReadonlySet<string> = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout'])

/** A deduplicated read and the callers still waiting for it. */
interface SharedRead {
  readonly controller: AbortController
  waiting: number
  promise: Promise<unknown>
}

/**
 * Per-error `Retry-After` hints. A WeakMap keeps the value off the public error
 * surface; it is transport bookkeeping, not something a caller should branch on.
 */
const retryAfterByError = new WeakMap<HidApiError, number | null>()

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createRequestId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `hid_web_${random}`
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, QueryValue>> | undefined,
  rootRelative: boolean,
): URL {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = rootRelative
    ? new URL(normalizedPath, baseUrl)
    : new URL(`${baseUrl}${normalizedPath}`)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  return url
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const matches = document.cookie.split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`))
  // Ambiguous duplicate cookies must never be used as CSRF evidence.
  if (matches.length !== 1) return null
  try {
    return decodeURIComponent(matches[0]!.slice(name.length + 1))
  } catch {
    return null
  }
}

function logSafePath(path: string): string {
  // Route identifiers can be patient IDs. Diagnostics need the route shape,
  // never the identifying value.
  return path.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':id')
}

/** Composes the caller's signal with a per-attempt timeout. */
function createAttemptSignal(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, timeoutMs)

  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

export interface ApiClient {
  request<T>(spec: RequestSpec): Promise<T>
  get<T>(path: string, spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>): Promise<T>
  post<T>(path: string, body?: unknown, spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>): Promise<T>
  /** The configured gateway base URL, for diagnostics. */
  readonly baseUrl: string
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('createApiClient requires a fetch implementation')
  }

  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = options.sleep ?? defaultSleep
  const logger = options.logger
  const inflight = new Map<string, SharedRead>()
  const cookieMode = options.sessionMode === 'cookie'
  let responseCsrfToken: string | null = null
  let refreshInFlight: Promise<void> | null = null

  async function resolveHeaders(spec: RequestSpec, url: URL, requestId: string): Promise<Headers> {
    const headers = new Headers(await options.getDefaultHeaders?.())

    for (const [key, value] of Object.entries(spec.headers ?? {})) headers.set(key, value)

    headers.set('Accept', spec.responseType === 'download' ? '*/*' : 'application/json')
    if (cookieMode) {
      // On the hid-system CORS allow-list. X-Request-ID is not, so adding it
      // would block a cross-origin preflight.
      headers.set('X-Correlation-ID', requestId)
      // The staff and patient apps share the session cookies on one origin.
      // Identity reads X-HID-Client on these two calls only (hid-system #39) and
      // refuses the other app's sign-in with 403 SESSION_CLIENT_MISMATCH, so
      // neither app rotates or ends the other's. It names this client and no
      // other, whatever a caller passed. Identity builds before #39 ignore it on
      // the same origin but lack it on their CORS allow-list.
      headers.delete('X-HID-Client')
      if (spec.method === 'POST' && NAMED_CLIENT_PATHS.has(url.pathname)) headers.set('X-HID-Client', options.clientId)
    } else {
      headers.set('X-Request-ID', requestId)
      headers.set('X-HID-Client', options.clientId)
    }

    if (spec.body !== undefined) headers.set('Content-Type', 'application/json')

    const requirement: AuthRequirement = spec.auth ?? 'required'
    if (cookieMode) {
      // HttpOnly authentication cookies cannot be inspected from JavaScript.
      // The backend decides whether the session is present and authorized.
      headers.delete('Authorization')
      if (!['GET', 'HEAD', 'OPTIONS'].includes(spec.method)) {
        const csrf = options.getCsrfToken?.() ?? readCookie(options.csrfCookieName ?? 'hid_access_csrf')
          ?? responseCsrfToken
        if (csrf) headers.set('X-CSRF-Token', csrf)
      }
    } else if (requirement !== 'none') {
      const token = (await options.getAccessToken?.()) ?? null
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      } else if (requirement === 'required') {
        throw new HidApiError(401, fallbackMessageForStatus(401), {
          code: 'UNAUTHENTICATED',
          requestId,
          retryable: false,
        })
      }
    }

    return headers
  }

  async function attempt<T>(spec: RequestSpec, url: URL, requestId: string): Promise<T> {
    // Awaited before every attempt: the first, each retry after a backoff, and
    // the repeat after a refresh. A rejection ends the request. Headers (the CSRF
    // token among them) are read only after it, since a wait can outlast a refresh.
    await spec.beforeAttempt?.()
    const headers = await resolveHeaders(spec, url, requestId)
    const timeoutMs = spec.timeoutMs ?? defaultTimeoutMs
    const attemptSignal = createAttemptSignal(timeoutMs, spec.signal)

    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: attemptSignal.signal,
        // Clinical data is never served from the HTTP cache.
        cache: 'no-store',
        credentials: cookieMode ? 'include' : 'omit',
        mode: 'cors',
        redirect: 'error',
      })
    } catch (error) {
      if (spec.signal?.aborted) {
        throw new HidApiError(0, 'The request was cancelled.', {
          code: 'REQUEST_CANCELLED',
          requestId,
          retryable: false,
          cause: error,
        })
      }
      if (attemptSignal.timedOut()) {
        throw new HidApiError(408, fallbackMessageForStatus(408), {
          code: 'REQUEST_TIMEOUT',
          requestId,
          retryable: true,
          cause: error,
        })
      }
      throw new HidApiError(0, 'We could not reach the service. Check your connection and try again.', {
        code: 'NETWORK_ERROR',
        requestId,
        retryable: true,
        cause: error,
      })
    } finally {
      attemptSignal.dispose()
    }

    const headerRequestId = response.headers.get('X-Correlation-ID')
      ?? response.headers.get('X-Request-ID')
    if (cookieMode) responseCsrfToken = response.headers.get('X-CSRF-Token') ?? responseCsrfToken
    if (response.ok && spec.responseType === 'download') {
      const download: DownloadResult = { blob: await response.blob(), headers: response.headers }
      return download as T
    }
    const rawBody = await response.text()
    const payload = parseJsonBody(rawBody)

    if (!response.ok) {
      const envelope = parseErrorEnvelope(payload, {
        status: response.status,
        headerRequestId,
      })
      const message = isLowSignalMessage(envelope.message)
        ? fallbackMessageForStatus(response.status)
        : envelope.message

      const error = new HidApiError(response.status, message, {
        code: envelope.code,
        requestId: envelope.requestId ?? requestId,
        retryable: envelope.retryable ?? isRetryableStatus(response.status),
        details: envelope.details,
      })

      // Attach transport hints the retry loop needs without widening HidApiError.
      retryAfterByError.set(error, parseRetryAfter(response.headers.get('Retry-After')))

      logger?.warn('api request failed', {
        method: spec.method,
        path: logSafePath(spec.path),
        ...error.toLogContext(),
      })

      throw error
    }

    if (response.status === 204 || rawBody.trim() === '') return undefined as T

    if (payload === null && rawBody.trim() !== '') {
      throw new HidApiError(502, 'The service returned an unreadable response.', {
        code: 'INVALID_RESPONSE',
        requestId: headerRequestId ?? requestId,
        retryable: true,
      })
    }

    // hid-system returns both bare responses and domain objects containing a
    // meaningful `data` property. Do not strip that property in cookie mode.
    return cookieMode ? payload as T : unwrapData<T>(payload)
  }

  async function run<T>(spec: RequestSpec): Promise<T> {
    const requestId = createRequestId()
    const url = buildUrl(baseUrl, spec.path, spec.query, cookieMode)
    const idempotent = isIdempotentMethod(spec.method)
    const policy = spec.retry ?? (idempotent ? DEFAULT_READ_RETRY : NO_RETRY)

    let attemptIndex = 0
    let refreshed = false
    for (;;) {
      try {
        return await attempt<T>(spec, url, requestId)
      } catch (error) {
        if (cookieMode && options.refreshSession && !refreshed
          && spec.auth !== 'none' && !spec.path.startsWith('/api/v1/auth/')
          && error instanceof HidApiError && error.status === 401
          && (spec.refreshOnUnauthorized?.(error) ?? true)) {
          refreshed = true
          try {
            refreshInFlight ??= Promise.resolve().then(options.refreshSession)
              .finally(() => { refreshInFlight = null })
            await refreshInFlight
            continue
          } catch (refreshError) {
            if (!(refreshError instanceof HidApiError) || refreshError.status !== 401) {
              throw refreshError
            }
          }
        }
        if (!shouldRetry({ error, method: spec.method, attempt: attemptIndex, policy, idempotent })) {
          if (error instanceof HidApiError && error.status === 401 && spec.reportUnauthorized !== false) options.onUnauthorized?.(error)
          throw error
        }

        const delay = nextDelayMs({
          attempt: attemptIndex,
          policy,
          retryAfterSeconds: error instanceof HidApiError ? retryAfterByError.get(error) ?? null : null,
          ...(options.random ? { random: options.random } : {}),
        })

        logger?.debug('retrying api request', {
          method: spec.method,
          path: logSafePath(spec.path),
          attempt: attemptIndex + 1,
          delayMs: delay,
        })

        await sleep(delay, spec.signal)
        attemptIndex += 1
      }
    }
  }

  function dedupeKey(spec: RequestSpec): string {
    return JSON.stringify([spec.method, spec.path, spec.query ?? null, spec.auth ?? 'required',
      spec.headers ?? null, spec.responseType ?? 'json', spec.reportUnauthorized ?? true])
  }

  /**
   * One caller's view of a shared read. The caller's own cancellation rejects
   * only its view; the shared request is cancelled when no caller still waits.
   */
  function join<T>(key: string, shared: SharedRead, signal: AbortSignal | undefined, requestId: string): Promise<T> {
    shared.waiting += 1
    let settled = false
    const leave = () => {
      if (settled) return
      settled = true
      shared.waiting -= 1
      if (shared.waiting > 0) return
      // Abandoned: a later caller (for example a remounted component) starts afresh.
      if (inflight.get(key) === shared) inflight.delete(key)
      shared.controller.abort()
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        leave()
        reject(new HidApiError(0, 'The request was cancelled.', {
          code: 'REQUEST_CANCELLED', requestId, retryable: false,
        }))
      }
      if (signal?.aborted) { onAbort(); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      shared.promise.then(
        value => { signal?.removeEventListener('abort', onAbort); settled = true; resolve(value as T) },
        (error: unknown) => { signal?.removeEventListener('abort', onAbort); settled = true; reject(error) },
      )
    })
  }

  const client: ApiClient = {
    baseUrl,

    request<T>(spec: RequestSpec): Promise<T> {
      const canDedupe = spec.method === 'GET' && (spec.dedupe ?? true)
      if (!canDedupe) return run<T>(spec)

      const key = dedupeKey(spec)
      let shared = inflight.get(key)
      if (!shared) {
        const controller = new AbortController()
        const entry: SharedRead = { controller, waiting: 0, promise: Promise.resolve() }
        entry.promise = run<unknown>({ ...spec, signal: controller.signal }).finally(() => {
          if (inflight.get(key) === entry) inflight.delete(key)
        })
        // Each caller observes the outcome through join(); this keeps an
        // abandoned shared read from reporting an unhandled rejection.
        entry.promise.catch(() => undefined)
        inflight.set(key, entry)
        shared = entry
      }
      return join<T>(key, shared, spec.signal, createRequestId())
    },

    get<T>(path: string, spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>): Promise<T> {
      return client.request<T>({ ...spec, method: 'GET', path })
    },

    post<T>(
      path: string,
      body?: unknown,
      spec?: Omit<RequestSpec, 'method' | 'path' | 'body'>,
    ): Promise<T> {
      return client.request<T>({ ...spec, method: 'POST', path, body })
    },
  }

  return client
}
