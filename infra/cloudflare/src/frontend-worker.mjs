import {
  isLegacyMigratePath,
  migrateRedirectUrl,
} from './migrate-route-redirects.mjs'
import { legacyPatientPath } from './legacy-patient-redirects.mjs'

const API_PATH = /^\/api\/v1(?:\/|$)/
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const ORIGIN_AUTH_TOKEN = /^[A-Za-z0-9._~+/-]{32,256}$/

const DEPLOYMENT_PROFILES = Object.freeze({
  production: Object.freeze({
    apiOrigin: 'https://api.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'app.healthidentitydirectory.com',
      public: 'healthidentitydirectory.com',
      ehr: 'ehr.healthidentitydirectory.com',
      lab: 'lab.healthidentitydirectory.com',
      pharmacy: 'pharmacy.healthidentitydirectory.com',
      ocr: 'migrate.healthidentitydirectory.com',
      outreach: 'outreach.healthidentitydirectory.com',
      admin: 'admin.healthidentitydirectory.com',
    }),
  }),
  staging: Object.freeze({
    apiOrigin: 'https://api.staging.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'staging.healthidentitydirectory.com',
      public: 'www.staging.healthidentitydirectory.com',
      ehr: 'ehr.staging.healthidentitydirectory.com',
      lab: 'lab.staging.healthidentitydirectory.com',
      pharmacy: 'pharmacy.staging.healthidentitydirectory.com',
      ocr: 'migrate.staging.healthidentitydirectory.com',
      outreach: 'outreach.staging.healthidentitydirectory.com',
      admin: 'admin.staging.healthidentitydirectory.com',
    }),
  }),
})

// The Permissions-Policy below governs no push or notification feature, so it stays as it is. The
// Content-Security-Policy is report-only for now (contentSecurityPolicy, below).
const SECURITY_HEADERS = Object.freeze({
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
})

const PERMISSIONS_BY_APP = Object.freeze({
  web: 'camera=(self), microphone=(self), geolocation=()',
  public: 'camera=(), microphone=(), geolocation=()',
  ehr: 'camera=(), microphone=(), geolocation=()',
  lab: 'camera=(), microphone=(), geolocation=()',
  pharmacy: 'camera=(), microphone=(), geolocation=()',
  ocr: 'camera=(self), microphone=(), geolocation=()',
  outreach: 'camera=(self), microphone=(), geolocation=(self)',
  admin: 'camera=(), microphone=(), geolocation=()',
})

/**
 * Content-Security-Policy-Report-Only for HTML responses (docs/OFFLINE-CONTRACT.md 2.12, owner decision D11; hand-off
 * D6): report-only first, enforced after 48 hours without problems. `worker-src 'self'` covers /sw.js (push, B6, and
 * the offline app shell) and `manifest-src 'self'` /health-id.webmanifest. Google Identity Services only on the
 * patient portal (web), the one host with Google sign-in. Two optional origins join connect-src when the Worker is
 * given them: the presigned document storage (DOCUMENT_STORAGE_ORIGIN) and the Sentry ingest of SENTRY_DSN. Neither
 * is set today, so their requests show as report-only violations rather than being guessed here. There is no report
 * endpoint in wave 1: violations are read from the browser console.
 */
const GOOGLE_IDENTITY = Object.freeze({
  script: 'https://accounts.google.com/gsi/client',
  frame: 'https://accounts.google.com/gsi/',
  connect: 'https://accounts.google.com/gsi/',
  style: 'https://accounts.google.com/gsi/style',
})
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const HTML = /^text\/html\s*(?:;|$)/i

function optionalOrigin(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    const origin = new URL(value).origin
    return HTTPS_ORIGIN.test(origin) ? origin : null
  } catch {
    return null
  }
}

export function contentSecurityPolicy(application, environment = {}) {
  const google = application === 'web'
  const connect = ["'self'", 'https://cloudflareinsights.com',
    optionalOrigin(environment.DOCUMENT_STORAGE_ORIGIN), optionalOrigin(environment.SENTRY_DSN),
    google ? GOOGLE_IDENTITY.connect : null]
  return [
    "default-src 'self'",
    ['script-src', "'self'", 'https://static.cloudflareinsights.com', 'https://challenges.cloudflare.com', google ? GOOGLE_IDENTITY.script : null],
    ['connect-src', ...connect],
    ['frame-src', 'https://challenges.cloudflare.com', google ? GOOGLE_IDENTITY.frame : null],
    "img-src 'self' data: blob:",
    ['style-src', "'self'", "'unsafe-inline'", google ? GOOGLE_IDENTITY.style : null],
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].map(directive => Array.isArray(directive) ? directive.filter(Boolean).join(' ') : directive).join('; ')
}

function problem(status, code, detail, correlationId) {
  return new Response(JSON.stringify({
    type: 'about:blank',
    title: status === 502 ? 'Service unavailable' : 'Request rejected',
    status,
    detail,
    code,
    correlationId,
  }), {
    status,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'cloudflare-cdn-cache-control': 'no-store',
      'x-correlation-id': correlationId,
      ...SECURITY_HEADERS,
    },
  })
}

function correlationId(request) {
  const supplied = request.headers.get('x-correlation-id')?.trim()
  return supplied && CORRELATION_ID.test(supplied) ? supplied : crypto.randomUUID()
}

function configuredDeployment(environment) {
  const profile = DEPLOYMENT_PROFILES[environment.DEPLOYMENT_ENV]
  const application = typeof environment.APP_NAME === 'string' ? environment.APP_NAME : ''
  const expectedHost = profile?.hosts[application]
  if (!profile || !expectedHost
    || environment.API_ORIGIN !== profile.apiOrigin
    || environment.EXPECTED_HOST !== expectedHost
    || !ORIGIN_AUTH_TOKEN.test(environment.ORIGIN_AUTH_TOKEN ?? '')) {
    throw new Error('Worker deployment configuration is incomplete or inconsistent')
  }
  return {
    application,
    expectedHost,
    migrateOrigin: `https://${profile.hosts.ocr}`,
    portalOrigin: `https://${profile.hosts.web}`,
    origin: new URL(profile.apiOrigin),
    originAuthToken: environment.ORIGIN_AUTH_TOKEN,
    contentSecurityPolicy: contentSecurityPolicy(application, environment),
  }
}

// The portal's push worker (B6, apps/patient-web/public/sw.js) and the earlier HID worker the public site retires
// (/service-worker.js): a browser checks either for an update, and must never be handed a stale copy.
const WORKER_PATHS = /^\/sw\.js$|\/service-worker\.js$/
const JAVASCRIPT = /^(?:text|application)\/(?:x-)?javascript\s*(?:;|$)/i

function withSecurityHeaders(response, apiResponse = false, application, path = '', policy = null) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  if (application === 'web') headers.set('cross-origin-opener-policy', 'same-origin-allow-popups')
  headers.set('permissions-policy', PERMISSIONS_BY_APP[application]
    ?? 'camera=(), microphone=(), geolocation=()')
  if (apiResponse) {
    headers.set('cache-control', 'private, no-store, max-age=0')
    headers.set('cloudflare-cdn-cache-control', 'no-store')
    headers.set('pragma', 'no-cache')
    headers.delete('age')
    headers.delete('cf-cache-status')
  } else if (WORKER_PATHS.test(path) || new URL(response.url || 'https://static.invalid/').pathname.endsWith('/service-worker.js')) {
    headers.set('cache-control', 'no-cache, no-store, must-revalidate')
  } else if (path === '/health-id.webmanifest' && response.status >= 200 && response.status < 300) {
    headers.set('content-type', 'application/manifest+json; charset=utf-8')
  }
  if (!apiResponse && policy && HTML.test(headers.get('content-type') ?? '')) headers.set('content-security-policy-report-only', policy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * /sw.js must be the portal's push worker or nothing: where a build has none (the public site, or a build before B6),
 * the single-page fallback would answer index.html with 200, which a browser must never be offered as a worker.
 */
function servesWorker(path, response) {
  return path !== '/sw.js' || response.status === 304
    || (response.status >= 200 && response.status < 300 && JAVASCRIPT.test(response.headers.get('content-type') ?? ''))
}

/**
 * A file under /assets/ that the build lacks must not be answered with index.html by the single-page fallback: the
 * offline app shell (apps/patient-web/public/sw.js) would save that page as a script or stylesheet. The build's own
 * files there are never HTML.
 */
function servesPageAsFile(path, response) {
  return path.startsWith('/assets/') && HTML.test(response.headers.get('content-type') ?? '')
}

function applicationRouteRedirect(request, requestUrl, deployment) {
  if (!['GET', 'HEAD'].includes(request.method)) return null
  const adminPaths = new Set(['integrations', 'overview', 'facilities', 'principals', 'applications',
    'reviews', 'audit', 'operations', 'pricing', 'demos', 'controls', 'sign-in', 'recover'])
  const first = requestUrl.pathname.split('/')[1]
  if (deployment.application === 'admin' && adminPaths.has(first)) {
    const target = new URL(requestUrl)
    target.pathname = `/admin${requestUrl.pathname}`
    return Response.redirect(target, 308)
  }
  const products = { ehr: 'ehr', lab: 'lab', pharmacy: 'pharmacy', ocr: 'migrate', outreach: 'outreach' }
  if (products[deployment.application] && requestUrl.pathname === '/provider/recover') {
    const staging = deployment.expectedHost.includes('.staging.')
    const target = new URL(`https://${staging ? 'staging' : 'app'}.healthidentitydirectory.com/provider/recover`)
    target.searchParams.set('returnTo', products[deployment.application])
    return Response.redirect(target, 302)
  }
  // hid-system refuses staff-login on the production portal, so its staff
  // sign-in page sends staff to the EHR site's (owner decision, 2026-10-22).
  // One fixed address: nothing from the request is copied into it.
  if (deployment.application === 'web' && deployment.expectedHost === 'app.healthidentitydirectory.com'
    && requestUrl.pathname === '/provider/sign-in') {
    return Response.redirect('https://ehr.healthidentitydirectory.com/provider/sign-in', 302)
  }
  if (deployment.application === 'public' && requestUrl.pathname === '/products/identity') {
    return Response.redirect(new URL('/patients', requestUrl), 308)
  }
  // hid-1.0's patient pages were on this host: each opens its portal page. Only the deployment's portal origin and
  // a fixed path: nothing from the request, its query included, is copied into the address.
  const portalPath = deployment.application === 'public' ? legacyPatientPath(requestUrl.pathname) : null
  if (portalPath) return Response.redirect(new URL(portalPath, deployment.portalOrigin), 308)
  if (!['GET', 'HEAD'].includes(request.method) || !isLegacyMigratePath(requestUrl.pathname)) return null
  if (deployment.application !== 'ocr' && deployment.application !== 'web') return null

  const destinationOrigin = deployment.application === 'ocr'
    ? requestUrl.origin
    : deployment.migrateOrigin
  return Response.redirect(
    migrateRedirectUrl(destinationOrigin, requestUrl.pathname, requestUrl.search),
    308,
  )
}

async function proxyApi(request, deployment, requestUrl) {
  const requestCorrelationId = correlationId(request)
  const upstream = new URL(requestUrl.pathname + requestUrl.search, deployment.origin)
  const headers = new Headers(request.headers)
  for (const name of [
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'forwarded', 'host', 'x-forwarded-for',
    'x-forwarded-host', 'x-forwarded-proto', 'x-hid-edge-origin', 'x-real-ip', 'x-hid-client-ip',
  ]) headers.delete(name)
  // Cloudflare supplies this value on deployed Workers. Never preserve a
  // caller's x-hid-client-ip or forwarding chain. Local requests without an
  // edge-supplied address use the gateway's peer address instead.
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp && clientIp.length <= 45 &&
      (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(clientIp) || /^[a-fA-F0-9:]+$/.test(clientIp) && clientIp.includes(':'))) {
    headers.set('x-hid-client-ip', clientIp)
  }
  headers.set('x-correlation-id', requestCorrelationId)
  headers.set('x-forwarded-host', requestUrl.host)
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-hid-edge-origin', requestUrl.origin)
  headers.set('x-hid-origin-authorization', deployment.originAuthToken)

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
    // cacheTtl: 0 still forces cache eligibility and can strip Set-Cookie.
    // Authentication and patient API responses must bypass the cache entirely.
    cache: 'no-store',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body

  try {
    const response = await fetch(upstream, init)
    const secured = withSecurityHeaders(response, true, deployment.application)
    secured.headers.set('x-correlation-id', response.headers.get('x-correlation-id') ?? requestCorrelationId)
    return secured
  } catch {
    return problem(502, 'API_ORIGIN_UNAVAILABLE', 'A required platform service is temporarily unavailable.', requestCorrelationId)
  }
}

export function createFrontendWorker() {
  return {
    async fetch(request, environment) {
      const url = new URL(request.url)
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
        return problem(400, 'HTTPS_REQUIRED', 'HTTPS is required.', correlationId(request))
      }
      let deployment
      try {
        deployment = configuredDeployment(environment)
      } catch {
        return problem(502, 'EDGE_CONFIGURATION_INVALID', 'The API edge route is unavailable.', correlationId(request))
      }
      if (url.hostname !== deployment.expectedHost) {
        return problem(421, 'HOST_DENIED', 'This host is not configured for the requested application.', correlationId(request))
      }
      if (API_PATH.test(url.pathname)) return proxyApi(request, deployment, url)
      if (url.pathname.startsWith('/api/')) {
        return problem(404, 'API_ROUTE_NOT_FOUND', 'The requested API route is not available.', correlationId(request))
      }
      const redirect = applicationRouteRedirect(request, url, deployment)
      if (redirect) return withSecurityHeaders(redirect, false, deployment.application, url.pathname, deployment.contentSecurityPolicy)
      const assetResponse = await environment.ASSETS.fetch(request)
      if (!servesWorker(url.pathname, assetResponse) || servesPageAsFile(url.pathname, assetResponse)) {
        return problem(404, 'NOT_FOUND', 'The requested file is not available.', correlationId(request))
      }
      return withSecurityHeaders(assetResponse, false, deployment.application, url.pathname, deployment.contentSecurityPolicy)
    },
  }
}

export default createFrontendWorker()
