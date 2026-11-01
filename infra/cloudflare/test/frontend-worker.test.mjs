import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrontendWorker, landingHref } from '../src/frontend-worker.mjs'
import apexWorker from '../src/apex-redirect-worker.mjs'
import legacyOcrDomainRedirectWorker from '../src/legacy-ocr-domain-redirect-worker.mjs'

// Node has no HTMLRewriter: here the page passes through unchanged, so these tests see what the Worker asked the
// public site for and what it answered. What it rewrites is tested in workerd (landing-page.test.mjs).
globalThis.HTMLRewriter ??= class { on() { return this } transform(response) { return response } }

const worker = createFrontendWorker()
const originalFetch = globalThis.fetch
const TEST_ORIGIN_AUTH_TOKEN = 'test-origin-authorization-token-not-a-secret-123456'

const deploymentProfiles = Object.freeze({
  production: Object.freeze({
    apiOrigin: 'https://api.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'app.healthidentitydirectory.com', public: 'healthidentitydirectory.com', ehr: 'ehr.healthidentitydirectory.com',
      lab: 'lab.healthidentitydirectory.com', pharmacy: 'pharmacy.healthidentitydirectory.com',
      ocr: 'migrate.healthidentitydirectory.com', outreach: 'outreach.healthidentitydirectory.com',
      admin: 'admin.healthidentitydirectory.com',
    }),
  }),
  staging: Object.freeze({
    apiOrigin: 'https://api.staging.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'staging.healthidentitydirectory.com', public: 'www.staging.healthidentitydirectory.com',
      ehr: 'ehr.staging.healthidentitydirectory.com',
      lab: 'lab.staging.healthidentitydirectory.com', pharmacy: 'pharmacy.staging.healthidentitydirectory.com',
      ocr: 'migrate.staging.healthidentitydirectory.com', outreach: 'outreach.staging.healthidentitydirectory.com',
      admin: 'admin.staging.healthidentitydirectory.com',
    }),
  }),
})

function environment(overrides = {}) {
  const deployment = overrides.DEPLOYMENT_ENV ?? 'production'
  const app = overrides.APP_NAME ?? 'ehr'
  const profile = deploymentProfiles[deployment]
  return {
    DEPLOYMENT_ENV: deployment,
    API_ORIGIN: profile.apiOrigin,
    EXPECTED_HOST: profile.hosts[app],
    APP_NAME: app,
    ORIGIN_AUTH_TOKEN: TEST_ORIGIN_AUTH_TOKEN,
    ASSETS: { fetch: async request => new Response(`<p>${new URL(request.url).pathname}</p>`, {
      status: 200, headers: { 'content-type': 'text/html' },
    }) },
    ...overrides,
  }
}

test.afterEach(() => { globalThis.fetch = originalFetch })

test('serves the application asset binding with security headers', async () => {
  const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/deep/link'), environment())
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '<p>/deep/link</p>')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
})

test('grants device capabilities only to the application host that needs them', async () => {
  // The workspace, where the camera is used; the front page, a landing page, asks for none (landing tests below).
  const ocr = await worker.fetch(new Request('https://migrate.healthidentitydirectory.com/provider/ocr'), environment({ APP_NAME: 'ocr' }))
  assert.equal(ocr.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=()')
  const outreach = await worker.fetch(new Request('https://outreach.healthidentitydirectory.com/provider/outreach'), environment({ APP_NAME: 'outreach' }))
  assert.equal(outreach.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=(self)')
})

test('serves Migrate from its canonical hostname root and redirects legacy paths without chains', async () => {
  // The root is Migrate's landing page from the public site (landing tests below); every other path is the app's.
  const root = await worker.fetch(new Request('https://migrate.healthidentitydirectory.com/'),
    environment({ APP_NAME: 'ocr', PUBLIC_SITE: publicSite().binding }))
  assert.equal(root.status, 200)
  assert.equal(await root.text(), LANDING_HTML)

  const directDeepLink = await worker.fetch(
    new Request('https://migrate.healthidentitydirectory.com/jobs/123?view=safe'),
    environment({ APP_NAME: 'ocr' }),
  )
  assert.equal(directDeepLink.status, 200)
  assert.equal(await directDeepLink.text(), '<p>/jobs/123</p>')

  const legacyMigrate = await worker.fetch(
    new Request('https://migrate.healthidentitydirectory.com/migrate/jobs?view=safe'),
    environment({ APP_NAME: 'ocr' }),
  )
  assert.equal(legacyMigrate.status, 308)
  assert.equal(legacyMigrate.headers.get('location'), 'https://migrate.healthidentitydirectory.com/jobs?view=safe')

  const legacy = await worker.fetch(new Request('https://migrate.healthidentitydirectory.com/ocr/jobs?view=safe'), environment({ APP_NAME: 'ocr' }))
  assert.equal(legacy.status, 308)
  assert.equal(legacy.headers.get('location'), 'https://migrate.healthidentitydirectory.com/jobs?view=safe')

  const retiredWebRoute = await worker.fetch(
    new Request('https://migrate.healthidentitydirectory.com/migrate/dashboard?view=safe'),
    environment({ APP_NAME: 'ocr' }),
  )
  assert.equal(retiredWebRoute.status, 308)
  assert.equal(retiredWebRoute.headers.get('location'), 'https://migrate.healthidentitydirectory.com/?view=safe')

  const webLegacyRoute = await worker.fetch(
    new Request('https://app.healthidentitydirectory.com/migrate/jobs?view=safe'),
    environment({ APP_NAME: 'web' }),
  )
  assert.equal(webLegacyRoute.status, 308)
  assert.equal(webLegacyRoute.headers.get('location'), 'https://migrate.healthidentitydirectory.com/jobs?view=safe')
})

test('redirects legacy OCR domains directly to the Migrate root application while preserving paths and queries', () => {
  const production = legacyOcrDomainRedirectWorker.fetch(
    new Request('https://ocr.healthidentitydirectory.com/ocr/jobs?view=safe'),
    { DEPLOYMENT_ENV: 'production', EXPECTED_HOST: 'ocr.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.healthidentitydirectory.com' },
  )
  assert.equal(production.status, 308)
  assert.equal(production.headers.get('location'), 'https://migrate.healthidentitydirectory.com/jobs?view=safe')
  const productionDeepLink = legacyOcrDomainRedirectWorker.fetch(
    new Request('https://ocr.healthidentitydirectory.com/jobs/123?view=safe'),
    { DEPLOYMENT_ENV: 'production', EXPECTED_HOST: 'ocr.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.healthidentitydirectory.com' },
  )
  assert.equal(productionDeepLink.status, 308)
  assert.equal(productionDeepLink.headers.get('location'), 'https://migrate.healthidentitydirectory.com/jobs/123?view=safe')
  const api = legacyOcrDomainRedirectWorker.fetch(
    new Request('https://ocr.healthidentitydirectory.com/api/v1/ocr/jobs?view=safe', { method: 'POST' }),
    { DEPLOYMENT_ENV: 'production', EXPECTED_HOST: 'ocr.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.healthidentitydirectory.com' },
  )
  assert.equal(api.status, 308)
  assert.equal(api.headers.get('location'), 'https://migrate.healthidentitydirectory.com/api/v1/ocr/jobs?view=safe')
  const staging = legacyOcrDomainRedirectWorker.fetch(
    new Request('https://ocr.staging.healthidentitydirectory.com/migrate/jobs?view=safe'),
    { DEPLOYMENT_ENV: 'staging', EXPECTED_HOST: 'ocr.staging.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.staging.healthidentitydirectory.com' },
  )
  assert.equal(staging.status, 308)
  assert.equal(staging.headers.get('location'), 'https://migrate.staging.healthidentitydirectory.com/jobs?view=safe')
  const originInjectionAttempt = legacyOcrDomainRedirectWorker.fetch(
    new Request('https://ocr.healthidentitydirectory.com/migrate//attacker.example?view=safe'),
    { DEPLOYMENT_ENV: 'production', EXPECTED_HOST: 'ocr.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.healthidentitydirectory.com' },
  )
  assert.equal(originInjectionAttempt.status, 308)
  assert.equal(originInjectionAttempt.headers.get('location'), 'https://migrate.healthidentitydirectory.com//attacker.example?view=safe')
  assert.equal(legacyOcrDomainRedirectWorker.fetch(
    new Request('https://attacker.example/migrate/'),
    { DEPLOYMENT_ENV: 'production', EXPECTED_HOST: 'ocr.healthidentitydirectory.com', TARGET_ORIGIN: 'https://migrate.healthidentitydirectory.com' },
  ).status, 421)
})

for (const [deployment, profile] of Object.entries(deploymentProfiles)) {
  for (const [app, host] of Object.entries(profile.hosts)) {
    test(`${deployment} ${app} proxies only to its environment API origin`, async () => {
      let received
      globalThis.fetch = async (url, init) => {
        received = { url: String(url), init }
        return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
      }
      const response = await worker.fetch(new Request(`https://${host}/api/v1/auth/session?view=safe`, {
        headers: {
          origin: `https://${host}`, cookie: 'opaque=1', 'x-forwarded-host': 'attacker.example',
          'x-correlation-id': 'safe-correlation-123',
        },
      }), environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app }))
      assert.equal(received.url, `${profile.apiOrigin}/api/v1/auth/session?view=safe`)
      assert.equal(received.init.headers.get('origin'), `https://${host}`)
      assert.equal(received.init.headers.get('cookie'), 'opaque=1')
      assert.equal(received.init.headers.get('x-forwarded-host'), host)
      assert.equal(received.init.headers.get('x-hid-edge-origin'), `https://${host}`)
      assert.equal(received.init.headers.get('x-hid-origin-authorization'), TEST_ORIGIN_AUTH_TOKEN)
      assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
      assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store')
    })
  }
}

test('preserves mutation bodies and methods', async () => {
  globalThis.fetch = async (_url, init) => new Response(await new Response(init.body).text(), { status: 202 })
  const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/auth/login', {
    method: 'POST', body: '{"opaque":"body"}', headers: { 'content-type': 'application/json' },
  }), environment())
  assert.equal(response.status, 202)
  assert.equal(await response.text(), '{"opaque":"body"}')
})

test('rejects other API namespaces and misdirected hosts', async () => {
  assert.equal((await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/open-proxy'), environment())).status, 404)
  assert.equal((await worker.fetch(new Request('https://attacker.example/api/v1/auth/session'), environment())).status, 421)
})

test('rejects cross-environment and arbitrary upstream overrides', async () => {
  const staging = environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'ehr' })
  const productionOrigin = await worker.fetch(new Request('https://ehr.staging.healthidentitydirectory.com/api/v1/auth/session'), {
    ...staging, API_ORIGIN: deploymentProfiles.production.apiOrigin,
  })
  assert.equal(productionOrigin.status, 502)
  const arbitraryOrigin = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/auth/session?origin=https://attacker.example'), {
    ...environment(), API_ORIGIN: 'https://attacker.example',
  })
  assert.equal(arbitraryOrigin.status, 502)
})

test('fails closed when origin authorization is absent', async () => {
  const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/auth/session'),
    environment({ ORIGIN_AUTH_TOKEN: '' }))
  assert.equal(response.status, 502)
  assert.equal((await response.json()).code, 'EDGE_CONFIGURATION_INVALID')
})

test('replaces a forged client-IP header with the edge-supplied address', async () => {
  let headers
  globalThis.fetch = async (_url, init) => { headers = init.headers; return new Response('{}') }
  await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/support/chat', {
    headers: { 'x-hid-client-ip': '192.0.2.99', 'cf-connecting-ip': '192.0.2.7', 'x-forwarded-for': '192.0.2.88' },
  }), environment())
  assert.equal(headers.get('x-hid-client-ip'), '192.0.2.7')
  assert.equal(headers.get('x-forwarded-for'), null)
})

test('does not preserve a client-IP override without a valid edge address', async () => {
  let headers
  globalThis.fetch = async (_url, init) => { headers = init.headers; return new Response('{}') }
  await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/support/chat', {
    headers: { 'x-hid-client-ip': '192.0.2.99', 'cf-connecting-ip': 'not-an-address' },
  }), environment())
  assert.equal(headers.get('x-hid-client-ip'), null)
})

test('uses a safe correlation identifier when caller evidence is malformed', async () => {
  let value
  globalThis.fetch = async (_url, init) => { value = init.headers.get('x-correlation-id'); return new Response('{}') }
  await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/auth/session', {
    headers: { 'x-correlation-id': 'bad value with spaces' },
  }), environment())
  assert.match(value, /^[0-9a-f-]{36}$/)
})

test('redirects apex path and query to www without trusting a target parameter', async () => {
  const response = apexWorker.fetch(new Request('https://healthidentitydirectory.com/patient?next=https://evil.example'))
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), 'https://www.healthidentitydirectory.com/patient?next=https://evil.example')
})


test('new admin bookmark retains the query and uses the new nested route', async () => {
  const response = await worker.fetch(new Request('https://admin.staging.healthidentitydirectory.com/integrations?tab=qoreid'), environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'admin' }))
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), 'https://admin.staging.healthidentitydirectory.com/admin/integrations?tab=qoreid')
})

test('product recovery cannot use a caller-selected redirect destination', async () => {
  const response = await worker.fetch(new Request('https://lab.staging.healthidentitydirectory.com/provider/recover?returnTo=https://evil.example'), environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'lab' }))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://staging.healthidentitydirectory.com/provider/recover?returnTo=lab')
})

test('the production portal sends staff sign-in to the EHR site, and staging keeps its own', async () => {
  const production = await worker.fetch(new Request('https://app.healthidentitydirectory.com/provider/sign-in?returnTo=https://evil.example'),
    environment({ DEPLOYMENT_ENV: 'production', APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com' }))
  assert.equal(production.status, 302)
  assert.equal(production.headers.get('location'), 'https://ehr.healthidentitydirectory.com/provider/sign-in')
  const staging = await worker.fetch(new Request('https://staging.healthidentitydirectory.com/provider/sign-in'),
    environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'web' }))
  assert.notEqual(staging.status, 302)
})

test('patient popup policy allows Google messaging without relaxing other portals', async () => {
  const patient = await worker.fetch(new Request('https://staging.healthidentitydirectory.com/sign-in'), environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'web' }))
  assert.equal(patient.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups')
  const admin = await worker.fetch(new Request('https://admin.staging.healthidentitydirectory.com/admin/sign-in'), environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'admin' }))
  assert.equal(admin.headers.get('cross-origin-opener-policy'), 'same-origin')
})

test('public export accepts only its exact staging hostname', async () => {
  const config = environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'public', EXPECTED_HOST: 'www.staging.healthidentitydirectory.com' })
  const response = await worker.fetch(new Request('https://www.staging.healthidentitydirectory.com/about'), config)
  assert.equal(response.status, 200)
  const rejected = await worker.fetch(new Request('https://evil.example/about'), config)
  assert.equal(rejected.status, 421)
})

test('sends hid-1.0\'s patient pages on the public host to the portal page that replaces each', async () => {
  const cases = [
    ['/patient', 'https://app.healthidentitydirectory.com/'],
    ['/patient/profile', 'https://app.healthidentitydirectory.com/profile'],
    ['/patient/biodata', 'https://app.healthidentitydirectory.com/profile'],
    ['/patient/records', 'https://app.healthidentitydirectory.com/records'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
    ['/patient/history', 'https://app.healthidentitydirectory.com/access'],
    ['/logs', 'https://app.healthidentitydirectory.com/access'],
    ['/patient/notifications', 'https://app.healthidentitydirectory.com/notifications'],
    ['/patient/auth', 'https://app.healthidentitydirectory.com/sign-in'],
    ['/login', 'https://app.healthidentitydirectory.com/sign-in'],
    ['/signin', 'https://app.healthidentitydirectory.com/sign-in'],
    ['/signup', 'https://app.healthidentitydirectory.com/enroll'],
    ['/register', 'https://app.healthidentitydirectory.com/enroll'],
    // In any case, with a trailing slash; nothing of the request, its query included, is copied.
    ['/Patient/Records/?next=https://evil.example', 'https://app.healthidentitydirectory.com/records'],
  ]
  const config = environment({ APP_NAME: 'public', EXPECTED_HOST: 'healthidentitydirectory.com' })
  for (const [path, location] of cases) {
    const response = await worker.fetch(new Request(`https://healthidentitydirectory.com${path}`), config)
    assert.equal(response.status, 308, path)
    assert.equal(response.headers.get('location'), location, path)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  }
  const staging = await worker.fetch(new Request('https://www.staging.healthidentitydirectory.com/signup'),
    environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'public', EXPECTED_HOST: 'www.staging.healthidentitydirectory.com' }))
  assert.equal(staging.headers.get('location'), 'https://staging.healthidentitydirectory.com/enroll')
})

test('leaves the public site\'s own pages, and the portal\'s paths on other hosts, to their assets', async () => {
  const config = environment({ APP_NAME: 'public', EXPECTED_HOST: 'healthidentitydirectory.com' })
  for (const path of ['/patients', '/patient-stories', '/patient/unknown', '/about']) {
    const response = await worker.fetch(new Request(`https://healthidentitydirectory.com${path}`), config)
    assert.equal(response.status, 200, path)
  }
  const portal = await worker.fetch(new Request('https://app.healthidentitydirectory.com/patient/records'),
    environment({ APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com' }))
  assert.equal(portal.status, 200)
  assert.equal(await portal.text(), '<p>/patient/records</p>')
})

test('serves the portal\'s icon files and web app manifest from its assets', async () => {
  const config = environment({ APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com' })
  for (const path of ['/health-id.webmanifest', '/icons/icon-48.png', '/icons/apple-touch-icon.png',
    // The installable app's icons (B6), served exactly as the first two.
    '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']) {
    const response = await worker.fetch(new Request(`https://app.healthidentitydirectory.com${path}`), config)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), `<p>${path}</p>`)
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('cache-control'), null, path)
  }
})

/** An asset binding that answers each path as given, and anything else with the single-page fallback's index.html. */
function assets(files) {
  return { fetch: async request => {
    const path = new URL(request.url).pathname
    const file = files[path]
    if (typeof file === 'function') return file(request)
    if (file) return new Response(file.body, { status: 200, headers: { 'content-type': file.type, 'cache-control': 'public, max-age=14400' } })
    return new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  } }
}
const PUSH_WORKER = { body: "self.addEventListener('push', () => {})", type: 'application/javascript; charset=utf-8' }

test('serves the push worker as JavaScript that a browser never keeps a stale copy of (B6)', async () => {
  for (const app of ['web', 'ehr', 'lab', 'pharmacy', 'ocr', 'outreach', 'admin']) {
    const config = environment({ APP_NAME: app, ASSETS: assets({ '/sw.js': PUSH_WORKER }) })
    const host = deploymentProfiles.production.hosts[app]
    const response = await worker.fetch(new Request(`https://${host}/sw.js`), config)
    assert.equal(response.status, 200, app)
    assert.equal(await response.text(), PUSH_WORKER.body)
    assert.equal(response.headers.get('content-type'), 'application/javascript; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate', app)
    assert.equal(response.headers.get('service-worker-allowed'), null)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  }
  // A revalidation the asset binding answers 304 stays a 304, still not to be kept.
  const notModified = await worker.fetch(new Request('https://app.healthidentitydirectory.com/sw.js'), environment({
    APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com',
    ASSETS: assets({ '/sw.js': () => new Response(null, { status: 304 }) }) }))
  assert.equal(notModified.status, 304)
  assert.equal(notModified.headers.get('cache-control'), 'no-cache, no-store, must-revalidate')
})

test('answers 404, never index.html, for a push worker the build does not hold', async () => {
  for (const [app, host] of [['web', 'app.healthidentitydirectory.com'], ['public', 'healthidentitydirectory.com']]) {
    const response = await worker.fetch(new Request(`https://${host}/sw.js`),
      environment({ APP_NAME: app, EXPECTED_HOST: host, ASSETS: assets({}) }))
    assert.equal(response.status, 404, app)
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/)
    assert.equal((await response.json()).code, 'NOT_FOUND')
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  }
  // The same for an asset binding's own 404 page, and for a worker path anywhere but the root, which is just a page.
  const missing = await worker.fetch(new Request('https://healthidentitydirectory.com/sw.js'), environment({
    APP_NAME: 'public', EXPECTED_HOST: 'healthidentitydirectory.com',
    ASSETS: assets({ '/sw.js': () => new Response('<p>Not found</p>', { status: 404, headers: { 'content-type': 'text/html' } }) }) }))
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).code, 'NOT_FOUND')
  const nested = await worker.fetch(new Request('https://app.healthidentitydirectory.com/settings/sw.js'),
    environment({ APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com', ASSETS: assets({}) }))
  assert.equal(nested.status, 200)
  assert.equal(nested.headers.get('cache-control'), null)
})

test('keeps no copy of the retiring /service-worker.js, judged by the request path', async () => {
  // The asset binding's Response has no url (as here), so the path the browser asked for decides.
  const config = environment({ APP_NAME: 'public', EXPECTED_HOST: 'healthidentitydirectory.com',
    ASSETS: assets({ '/service-worker.js': { body: 'self.registration.unregister()', type: 'application/javascript' } }) })
  const response = await worker.fetch(new Request('https://healthidentitydirectory.com/service-worker.js?release=abc'), config)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate')
})

test('serves the web app manifest as application/manifest+json', async () => {
  const config = environment({ APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com',
    ASSETS: assets({ '/health-id.webmanifest': { body: '{"name":"Health ID"}', type: 'application/octet-stream' } }) })
  const response = await worker.fetch(new Request('https://app.healthidentitydirectory.com/health-id.webmanifest'), config)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8')
  assert.deepEqual(await response.json(), { name: 'Health ID' })
  // Only a file the binding has: its own error page keeps its type.
  const failed = await worker.fetch(new Request('https://app.healthidentitydirectory.com/health-id.webmanifest'), environment({
    APP_NAME: 'web', EXPECTED_HOST: 'app.healthidentitydirectory.com',
    ASSETS: assets({ '/health-id.webmanifest': () => new Response('<p>gone</p>', { status: 404, headers: { 'content-type': 'text/html' } }) }) }))
  assert.equal(failed.status, 404)
  assert.equal(failed.headers.get('content-type'), 'text/html')
})

test('keeps the portal\'s table of hid-1.0 addresses and the edge\'s the same, /records apart', async () => {
  const { readFile } = await import('node:fs/promises')
  const { LEGACY_PATIENT_PATHS } = await import('../src/legacy-patient-redirects.mjs')
  const source = await readFile(new URL('../../../apps/patient-web/src/legacyPaths.ts', import.meta.url), 'utf8')
  const portal = Object.fromEntries([...source.matchAll(/^\s*'([^']+)': '([^']+)',$/gm)].map(match => [match[1], match[2]]))
  const { '/records': shortLink, ...edge } = LEGACY_PATIENT_PATHS
  assert.equal(shortLink, '/records')
  assert.deepEqual(portal, edge)
})

const PRODUCT_SITES = Object.freeze({ ehr: 'ehr', lab: 'laboratory', pharmacy: 'pharmacy', ocr: 'migrate', outreach: 'outreach' })
const LANDING_HTML = '<!DOCTYPE html><html lang="en"><head><title>Landing</title></head><body><a href="/pricing">Pricing</a></body></html>'
const PATIENTS_HTML = '<!DOCTYPE html><html lang="en"><head><title>For patients</title></head><body>'
  + '<a href="https://app.healthidentitydirectory.com/sign-in">Sign in</a></body></html>'

/** Each site whose front page depends on a sign-in, by deployment app name, and the public page it shows a stranger. */
const LANDING_SITES = Object.freeze({
  ...Object.fromEntries(Object.entries(PRODUCT_SITES).map(([app, slug]) => [app, `/products/${slug}`])),
  web: '/patients',
})

/** The front page's addresses, a query included (which nothing keeps). */
const FRONT_PATHS = ['/', '/index.html', '/?next=https://evil.example/&utm_source=newsletter']

/**
 * Cookie headers of a browser that holds a sign-in on the site: a non-empty hid_access_csrf (identity-api's
 * session-cookies.ts, AUTH_COOKIE_NAME 'hid_access'), alone or among others, however the header is spaced or joined.
 */
const SIGNED_IN_COOKIES = [
  'hid_access_csrf=4f9c2b',
  'hid_access=eyJhbGciOi; hid_access_csrf=4f9c2b; theme=dark',
  'theme=dark;hid_access_csrf=4f9c2b',
  '  hid_access_csrf = 4f9c2b  ',
  'theme=dark, hid_access_csrf=4f9c2b',
]

/**
 * Cookie headers without one: none, an empty one, only the sign-in's other two cookies (which a browser sends to "/"
 * only for the access cookie's 15 minutes, or never), or names that are not it.
 */
const STRANGER_COOKIES = [
  null, '', 'hid_access_csrf=', 'hid_access_csrf=""', 'hid_access_csrf', 'hid_access_csrf= ; theme=dark',
  'hid_access=eyJhbGciOi', 'hid_access=eyJhbGciOi; hid_access_refresh=r3fr35h', 'hid_access_refresh=r3fr35h',
  'HID_ACCESS_CSRF=4f9c2b', 'Hid_Access_Csrf=4f9c2b', '__Host-hid_access_csrf=4f9c2b', 'hid_access_csrf_old=4f9c2b',
  'xhid_access_csrf=4f9c2b', '__Host-hid_session=secret', 'theme=hid_access_csrf',
]

function withCookie(cookie, headers = {}) {
  return cookie === null ? headers : { ...headers, cookie }
}

/** Every answer at a front page is private, never stored, and varies with the cookie, with the page headers. */
function assertFrontPageHeaders(response, label) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store', label)
  assert.ok(response.headers.get('vary').split(',').some(name => name.trim() === 'Cookie'), label)
  assert.equal(response.headers.get('x-frame-options'), 'DENY', label)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', label)
  assert.equal(response.headers.get('set-cookie'), null, label)
}

/**
 * The public site's Worker as a PUBLIC_SITE binding sees it: each product's page for the product site that names
 * itself, its patient page for anyone, and the static files given. It records every request it is sent.
 */
function publicSite(files = {}, { deployment = 'production' } = {}) {
  const requests = []
  const hosts = deploymentProfiles[deployment].hosts
  const binding = { fetch: async request => {
    requests.push(request)
    const url = new URL(request.url)
    const slug = /^\/products\/([a-z]+)$/.exec(url.pathname)?.[1]
    const app = Object.keys(PRODUCT_SITES).find(key => PRODUCT_SITES[key] === slug)
    const patients = url.pathname === '/patients'
    if (patients || (app && request.headers.get('x-hid-landing-site') === hosts[app])) {
      return new Response(request.method === 'HEAD' ? null : patients ? PATIENTS_HTML : LANDING_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8', etag: '"public-page"', 'set-cookie': 'public=1; Secure',
        'cache-control': 'public, max-age=0, must-revalidate',
      } })
    }
    const file = files[url.pathname]
    if (typeof file === 'function') return file(request)
    if (file) return new Response(file.body, { headers: { 'content-type': file.type, etag: '"file"', 'set-cookie': 'public=1' } })
    return new Response('<p>Not found</p>', { status: 404, headers: { 'content-type': 'text/html' } })
  } }
  return { binding, requests }
}

/** A binding that must not be used. */
const UNUSED_BINDING = { fetch: async () => { throw new Error('The public site must not be asked') } }

const VISITOR_HEADERS = {
  cookie: '__Host-hid_session=secret', authorization: 'Bearer secret', 'cf-connecting-ip': '192.0.2.7',
  'x-forwarded-for': '192.0.2.8', 'x-hid-landing-site': 'attacker.example', origin: 'https://attacker.example',
  accept: 'text/html,application/xhtml+xml', 'if-none-match': '"earlier"',
}

for (const [deployment, profile] of Object.entries(deploymentProfiles)) {
  const publicHost = deployment === 'production' ? 'healthidentitydirectory.com' : 'www.staging.healthidentitydirectory.com'
  for (const [app, slug] of Object.entries(PRODUCT_SITES)) {
    const host = profile.hosts[app]
    test(`${deployment} ${app} answers its front page with its landing page from the public site`, async () => {
      for (const path of ['/', '/index.html', '/?utm_source=newsletter']) {
        const site = publicSite({}, { deployment })
        const response = await worker.fetch(new Request(`https://${host}${path}`, { headers: VISITOR_HEADERS }),
          environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app, PUBLIC_SITE: site.binding, ASSETS: UNUSED_BINDING }))
        assert.equal(response.status, 200, path)
        assert.equal(await response.text(), LANDING_HTML)
        assert.equal(site.requests.length, 1)
        const [sent] = site.requests
        // One fixed address: the product's own page, nothing of the visitor's address or query.
        assert.equal(sent.url, `https://${publicHost}/products/${slug}`)
        assert.equal(sent.method, 'GET')
        assert.equal(sent.redirect, 'manual')
        assert.equal(sent.headers.get('x-hid-landing-site'), host)
        assert.equal(sent.headers.get('accept'), 'text/html')
        // Never the visitor's cookie, credentials or address, nor validators for a page this site rewrites.
        assert.deepEqual([...sent.headers.keys()].sort(), ['accept', 'x-hid-landing-site'])
        // The public site's page headers, as every other page; none of the public site's cookies or validators.
        assert.match(response.headers.get('content-type'), /^text\/html/)
        assert.equal(response.headers.get('x-frame-options'), 'DENY')
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
        assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
        assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
        assert.equal(response.headers.get('set-cookie'), null)
        assert.equal(response.headers.get('etag'), null)
        assertFrontPageHeaders(response, path)
        assert.equal(response.headers.get('vary'), 'Cookie')
      }
      const site = publicSite({}, { deployment })
      const head = await worker.fetch(new Request(`https://${host}/`, { method: 'HEAD' }),
        environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app, PUBLIC_SITE: site.binding }))
      assert.equal(head.status, 200)
      assert.equal(site.requests[0].method, 'HEAD')
    })
  }

  for (const app of Object.keys(PRODUCT_SITES)) {
    const host = profile.hosts[app]
    test(`${deployment} ${app} sends someone signed in there from its front page to the workspace, and shows anyone else its landing page`, async () => {
      for (const path of FRONT_PATHS) {
        for (const method of ['GET', 'HEAD']) {
          for (const cookie of SIGNED_IN_COOKIES) {
            const label = `${method} ${path} ${cookie}`
            const response = await worker.fetch(new Request(`https://${host}${path}`, { method, headers: withCookie(cookie) }),
              environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING, ASSETS: UNUSED_BINDING }))
            // The workspace's entrance on this site: one fixed address, nothing kept from the request.
            assert.equal(response.status, 302, label)
            assert.equal(response.headers.get('location'), `https://${host}/provider`, label)
            assertFrontPageHeaders(response, label)
            assert.equal(response.headers.get('vary'), 'Cookie', label)
          }
          for (const cookie of STRANGER_COOKIES) {
            const label = `${method} ${path} ${cookie}`
            const site = publicSite({}, { deployment })
            const response = await worker.fetch(new Request(`https://${host}${path}`, { method, headers: withCookie(cookie) }),
              environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app, PUBLIC_SITE: site.binding, ASSETS: UNUSED_BINDING }))
            assert.equal(response.status, 200, label)
            assert.equal(site.requests.length, 1, label)
            assert.equal(site.requests[0].url, `https://${publicHost}${LANDING_SITES[app]}`, label)
            assert.equal(site.requests[0].method, method, label)
            assert.equal(site.requests[0].headers.get('cookie'), null, label)
            assert.equal(await response.text(), method === 'HEAD' ? '' : LANDING_HTML, label)
            assertFrontPageHeaders(response, label)
          }
        }
      }
    })
  }

  const portalHost = profile.hosts.web
  test(`${deployment} patient portal answers its front page with the portal to someone signed in, and the Health ID page to anyone else`, async () => {
    for (const path of FRONT_PATHS) {
      for (const method of ['GET', 'HEAD']) {
        for (const cookie of SIGNED_IN_COOKIES) {
          const label = `${method} ${path} ${cookie}`
          const seen = []
          const portal = { fetch: async request => {
            seen.push(request)
            return new Response(method === 'HEAD' ? null : '<div id="root"></div>', { headers: {
              'content-type': 'text/html; charset=utf-8', etag: '"portal"', vary: 'Accept-Encoding',
              'cache-control': 'public, max-age=0, must-revalidate' } })
          } }
          const response = await worker.fetch(new Request(`https://${portalHost}${path}`, { method, headers: withCookie(cookie) }),
            environment({ DEPLOYMENT_ENV: deployment, APP_NAME: 'web', PUBLIC_SITE: UNUSED_BINDING, ASSETS: portal }))
          // The portal exactly as before: its own index.html, its own headers (Google's sign-in popup included).
          assert.equal(response.status, 200, label)
          assert.equal(await response.text(), method === 'HEAD' ? '' : '<div id="root"></div>', label)
          assert.equal(seen.length, 1, label)
          assert.equal(seen[0].url, `https://${portalHost}${path}`, label)
          // The visitor's own request, cookie included, as before: the portal's assets see what they always saw.
          assert.equal(seen[0].headers.get('cookie'), cookie.trim(), label)
          assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups', label)
          assert.equal(response.headers.get('permissions-policy'), 'camera=(self), microphone=(self), geolocation=()', label)
          assertFrontPageHeaders(response, label)
          assert.equal(response.headers.get('vary'), 'Accept-Encoding, Cookie', label)
        }
        for (const cookie of STRANGER_COOKIES) {
          const label = `${method} ${path} ${cookie}`
          const site = publicSite({}, { deployment })
          const response = await worker.fetch(new Request(`https://${portalHost}${path}`,
            { method, headers: withCookie(cookie, VISITOR_HEADERS) }),
          environment({ DEPLOYMENT_ENV: deployment, APP_NAME: 'web', PUBLIC_SITE: site.binding, ASSETS: UNUSED_BINDING }))
          assert.equal(response.status, 200, label)
          assert.equal(await response.text(), method === 'HEAD' ? '' : PATIENTS_HTML, label)
          // The public site's patient page, at one fixed address, asked for with none of the visitor's headers.
          assert.equal(site.requests.length, 1, label)
          const [sent] = site.requests
          assert.equal(sent.url, `https://${publicHost}/patients`, label)
          assert.equal(sent.method, method, label)
          assert.equal(sent.redirect, 'manual', label)
          assert.deepEqual([...sent.headers.keys()].sort(), ['accept', 'x-hid-landing-site'], label)
          // The public site's page headers, as on a product site's landing page.
          assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin', label)
          assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()', label)
          assert.equal(response.headers.get('etag'), null, label)
          assertFrontPageHeaders(response, label)
          assert.equal(response.headers.get('vary'), 'Cookie', label)
        }
      }
    }
  })

  test(`${deployment} public site sends each product's page to that product's site, and keeps its others`, async () => {
    const config = environment({ DEPLOYMENT_ENV: deployment, APP_NAME: 'public', EXPECTED_HOST: publicHost })
    for (const [app, slug] of Object.entries(PRODUCT_SITES)) {
      for (const path of [`/products/${slug}`, `/products/${slug}/`, `/products/${slug}.html`, `/products/${slug}?ref=nav`]) {
        const response = await worker.fetch(new Request(`https://${publicHost}${path}`), config)
        assert.equal(response.status, 308, path)
        assert.equal(response.headers.get('location'), `https://${profile.hosts[app]}/`, path)
        assert.equal(response.headers.get('cache-control'), 'max-age=3600')
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      }
      // Only the product site that owns the page, asking for its exact address, is answered the page.
      const own = await worker.fetch(new Request(`https://${publicHost}/products/${slug}`,
        { headers: { 'x-hid-landing-site': profile.hosts[app] } }), config)
      assert.equal(own.status, 200)
      assert.equal(await own.text(), `<p>/products/${slug}</p>`)
      for (const [headers, path] of [
        [{ 'x-hid-landing-site': profile.hosts[app === 'lab' ? 'pharmacy' : 'lab'] }, `/products/${slug}`],
        [{ 'x-hid-landing-site': 'attacker.example' }, `/products/${slug}`],
        [{ 'x-hid-landing-site': profile.hosts[app] }, `/products/${slug}/`],
      ]) {
        const other = await worker.fetch(new Request(`https://${publicHost}${path}`, { headers }), config)
        assert.equal(other.status, 308)
        assert.equal(other.headers.get('location'), `https://${profile.hosts[app]}/`)
      }
    }
    for (const path of ['/products', '/products/api', '/products/unknown', '/pricing']) {
      const response = await worker.fetch(new Request(`https://${publicHost}${path}`), config)
      assert.equal(response.status, 200, path)
    }
    const identity = await worker.fetch(new Request(`https://${publicHost}/products/identity`), config)
    assert.equal(identity.status, 308)
    assert.equal(identity.headers.get('location'), `https://${publicHost}/patients`)
    // A form posted to a product's old address is not redirected (as before, the asset binding answers it).
    const post = await worker.fetch(new Request(`https://${publicHost}/products/laboratory`, { method: 'POST' }), config)
    assert.equal(post.status, 200)
  })
}

test('a site without its public-site binding, or whose public site fails, says so in plain words', async () => {
  const failures = {
    missing: undefined,
    'not a binding': {},
    unreachable: { fetch: async () => { throw new Error('connection refused by hid-public-production') } },
    redirected: { fetch: async () => Response.redirect('https://lab.healthidentitydirectory.com/', 308) },
    'not found': { fetch: async () => new Response('<p>Not found</p>', { status: 404, headers: { 'content-type': 'text/html' } }) },
    'server error': { fetch: async () => new Response('worker threw', { status: 500, headers: { 'content-type': 'text/plain' } }) },
    'not a page': { fetch: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }) },
  }
  // Staff sign in at the workspace's entrance; patients at the portal's sign-in, as "/" is this page to them.
  const sites = [['lab', 'lab.healthidentitydirectory.com', '/provider', 'Health ID Laboratory'],
    ['web', 'app.healthidentitydirectory.com', '/sign-in', 'Health ID']]
  for (const [app, host, signIn, name] of sites) {
    for (const [failure, binding] of Object.entries(failures)) {
      const label = `${app} ${failure}`
      const response = await worker.fetch(new Request(`https://${host}/`), environment({ APP_NAME: app, PUBLIC_SITE: binding }))
      assert.equal(response.status, 503, label)
      assert.match(response.headers.get('content-type'), /^text\/html/)
      assert.equal(response.headers.get('retry-after'), '60')
      assertFrontPageHeaders(response, label)
      const page = await response.text()
      assert.match(page, /This page is not available right now/)
      assert.match(page, /Please try again in a few minutes\./)
      assert.ok(page.includes(`<title>${name}</title>`), label)
      assert.ok(page.includes(`<a href="${signIn}">Sign in to ${name}</a>`), label)
      assert.match(page, /<a href="https:\/\/healthidentitydirectory\.com\/">Go to the Health ID website<\/a>/)
      // No internal detail: no binding, Worker, host or error names, no status codes.
      assert.doesNotMatch(page, /PUBLIC_SITE|binding|worker|hid-public|refused|threw|50[0-9]|404|error/i)
    }
    // Someone signed in never needs the public site, so never sees this page.
    const signedIn = await worker.fetch(new Request(`https://${host}/`, { headers: { cookie: 'hid_access_csrf=4f9c2b' } }),
      environment({ APP_NAME: app, PUBLIC_SITE: undefined }))
    assert.notEqual(signedIn.status, 503, app)
  }
  const staging = await worker.fetch(new Request('https://migrate.staging.healthidentitydirectory.com/'),
    environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'ocr' }))
  assert.equal(staging.status, 503)
  assert.match(await staging.text(), /Sign in to Health ID Migrate<\/a>.*https:\/\/www\.staging\.healthidentitydirectory\.com\//s)
  const portal = await worker.fetch(new Request('https://staging.healthidentitydirectory.com/'),
    environment({ DEPLOYMENT_ENV: 'staging', APP_NAME: 'web' }))
  assert.equal(portal.status, 503)
  assert.match(await portal.text(), /<a href="\/sign-in">Sign in to Health ID<\/a>.*https:\/\/www\.staging\.healthidentitydirectory\.com\//s)
})

test('a product site and the patient portal load the public site\'s static files they do not have, and only those', async () => {
  const files = {
    '/_next/static/chunks/main-app.js': { body: 'console.log("public")', type: 'application/javascript' },
    '/_next/static/css/site.css': { body: 'body{}', type: 'text/css' },
    '/_next/static/media/inter.woff2': { body: 'font', type: 'font/woff2' },
    '/brand/logo.png': { body: 'png', type: 'image/png' },
    '/brand/solutions/hospital.jpg': { body: 'jpg', type: 'image/jpeg' },
    '/icon.png': { body: 'icon', type: 'image/png' },
    '/apple-icon.png': { body: 'apple', type: 'image/png' },
  }
  for (const [app, [path, file]] of ['lab', 'web'].flatMap(app => Object.entries(files).map(entry => [app, entry]))) {
    const site = publicSite(files)
    const host = deploymentProfiles.production.hosts[app]
    const response = await worker.fetch(new Request(`https://${host}${path}?v=1`, { headers: VISITOR_HEADERS }),
      environment({ APP_NAME: app, PUBLIC_SITE: site.binding, ASSETS: assets({}) }))
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), file.body)
    assert.equal(response.headers.get('content-type'), file.type)
    assert.equal(response.headers.get('etag'), '"file"')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(site.requests.length, 1)
    assert.equal(site.requests[0].url, `https://healthidentitydirectory.com${path}`)
    assert.equal(site.requests[0].redirect, 'manual')
    assert.deepEqual([...site.requests[0].headers.keys()].sort(), ['accept', 'if-none-match'])
  }
  // A revalidation the public site answers 304 stays a 304.
  const notModified = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/_next/static/css/site.css',
    { headers: { 'if-none-match': '"file"' } }), environment({ APP_NAME: 'ehr', ASSETS: assets({}),
    PUBLIC_SITE: publicSite({ '/_next/static/css/site.css': () => new Response(null, { status: 304, headers: { etag: '"file"' } }) }).binding }))
  assert.equal(notModified.status, 304)
  // A file the public site does not have either is a 404, never its page or the portal's index.html.
  for (const binding of [publicSite().binding, undefined, { fetch: async () => { throw new Error('down') } }]) {
    const missing = await worker.fetch(new Request('https://lab.healthidentitydirectory.com/_next/static/chunks/gone.js'),
      environment({ APP_NAME: 'lab', PUBLIC_SITE: binding, ASSETS: assets({}) }))
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).code, 'NOT_FOUND')
  }
})

test('a product site\'s own files always win over the public site\'s', async () => {
  const own = { '/brand/logo.png': { body: 'product logo', type: 'image/png' },
    '/_next/static/chunks/own.js': { body: 'own', type: 'application/javascript' },
    '/icon.png': () => new Response(null, { status: 304 }) }
  for (const path of Object.keys(own)) {
    const response = await worker.fetch(new Request(`https://pharmacy.healthidentitydirectory.com${path}`),
      environment({ APP_NAME: 'pharmacy', PUBLIC_SITE: UNUSED_BINDING, ASSETS: assets(own) }))
    assert.ok([200, 304].includes(response.status), path)
  }
})

test('nothing but the listed static files is ever asked of the public site', async () => {
  const paths = ['/assets/index.js', '/sw.js', '/service-worker.js', '/health-id.webmanifest', '/icons/icon-48.png',
    '/favicon.ico', '/_next/image', '/_next/data/build/page.json', '/brand', '/products/laboratory', '/pricing',
    '/about.html', '/provider/sign-in', '/provider/laboratory', '/records', '/index.txt', '/__next._tree.txt']
  for (const app of Object.keys(LANDING_SITES)) {
    const host = deploymentProfiles.production.hosts[app]
    for (const path of paths) {
      for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
        const site = publicSite()
        const response = await worker.fetch(new Request(`https://${host}${path}`, { headers: withCookie(cookie) }),
          environment({ APP_NAME: app, PUBLIC_SITE: site.binding, ASSETS: assets({ '/sw.js': PUSH_WORKER }) }))
        assert.notEqual(response.status, 503, `${app} ${path}`)
        assert.equal(site.requests.length, 0, `${app} ${path} ${cookie}`)
      }
    }
    // Writes are never sent there, nor read from there.
    const post = await worker.fetch(new Request(`https://${host}/_next/static/chunks/main.js`, { method: 'POST' }),
      environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
    assert.equal(post.status, 200)
  }
})

test('the admin site and the public site keep their own front page, signed in or not', async () => {
  for (const deployment of Object.keys(deploymentProfiles)) {
    for (const app of ['admin', 'public']) {
      const host = deploymentProfiles[deployment].hosts[app]
      for (const path of ['/', '/index.html', '/_next/static/chunks/main.js', '/brand/logo.png']) {
        for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
          const label = `${deployment} ${app} ${path} ${cookie}`
          const response = await worker.fetch(new Request(`https://${host}${path}`, { headers: withCookie(cookie) }),
            environment({ DEPLOYMENT_ENV: deployment, APP_NAME: app, EXPECTED_HOST: host, PUBLIC_SITE: UNUSED_BINDING }))
          assert.equal(response.status, 200, label)
          assert.equal(await response.text(), `<p>${path}</p>`, label)
          // As before: none of a front page's private headers.
          assert.equal(response.headers.get('cache-control'), null, label)
          assert.equal(response.headers.get('vary'), null, label)
        }
      }
    }
  }
})

test('the patient page keeps its own address on the public site, and every other portal address is the portal\'s', async () => {
  for (const [deployment, profile] of Object.entries(deploymentProfiles)) {
    // Not redirected, for anyone: the public site's /patients is its primary address (the portal shows it at "/").
    for (const headers of [{}, { cookie: 'hid_access_csrf=4f9c2b' }, { 'x-hid-landing-site': profile.hosts.web }]) {
      const page = await worker.fetch(new Request(`https://${profile.hosts.public}/patients`, { headers }),
        environment({ DEPLOYMENT_ENV: deployment, APP_NAME: 'public', EXPECTED_HOST: profile.hosts.public, PUBLIC_SITE: UNUSED_BINDING }))
      assert.equal(page.status, 200)
      assert.equal(await page.text(), '<p>/patients</p>')
    }
    // On the portal, only its front page depends on a sign-in.
    for (const path of ['/sign-in', '/enroll', '/records', '/notifications', '/patients', '/provider/enroll', '/admin/sign-in']) {
      for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
        const response = await worker.fetch(new Request(`https://${profile.hosts.web}${path}`, { headers: withCookie(cookie) }),
          environment({ DEPLOYMENT_ENV: deployment, APP_NAME: 'web', PUBLIC_SITE: UNUSED_BINDING }))
        assert.equal(response.status, 200, `${deployment} ${path} ${cookie}`)
        assert.equal(await response.text(), `<p>${path}</p>`)
        assert.equal(response.headers.get('vary'), null)
      }
    }
  }
  // A write to the portal's front page is the portal's, as before.
  const post = await worker.fetch(new Request('https://app.healthidentitydirectory.com/', { method: 'POST' }),
    environment({ APP_NAME: 'web', PUBLIC_SITE: UNUSED_BINDING }))
  assert.equal(await post.text(), '<p>/</p>')
})

test('every /provider address on a product site is the portal\'s, as before', async () => {
  for (const app of Object.keys(PRODUCT_SITES)) {
    const host = deploymentProfiles.production.hosts[app]
    for (const path of ['/provider', '/provider/', '/provider/sign-in', '/provider/laboratory', '/provider/clinical',
      '/provider/enroll', '/provider/apply', '/provider/join', '/provider?next=/']) {
      for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
        const response = await worker.fetch(new Request(`https://${host}${path}`, { headers: withCookie(cookie) }),
          environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
        assert.equal(response.status, 200, `${app} ${path} ${cookie}`)
        assert.equal(await response.text(), `<p>${new URL(path, 'https://x.invalid').pathname}</p>`)
        assert.equal(response.headers.get('vary'), null)
      }
    }
    const recover = await worker.fetch(new Request(`https://${host}/provider/recover`),
      environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
    assert.equal(recover.status, 302)
    // The API proxy is untouched: the binding is never asked, and the API origin is.
    let proxied
    globalThis.fetch = async url => { proxied = String(url); return new Response('{}') }
    for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
      proxied = null
      const api = await worker.fetch(new Request(`https://${host}/api/v1/auth/session`, { headers: withCookie(cookie) }),
        environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
      assert.equal(api.status, 200)
      assert.equal(proxied, 'https://api.healthidentitydirectory.com/api/v1/auth/session')
      assert.equal(api.headers.get('cache-control'), 'private, no-store, max-age=0')
    }
    // A write to the front page is the app's, as before.
    const post = await worker.fetch(new Request(`https://${host}/`, { method: 'POST' }),
      environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
    assert.equal(await post.text(), '<p>/</p>')
  }
  // The admin site's addresses, the API proxy on the portal and the admin site: as before, signed in or not.
  for (const cookie of [null, 'hid_access_csrf=4f9c2b']) {
    const admin = await worker.fetch(new Request('https://admin.healthidentitydirectory.com/overview', { headers: withCookie(cookie) }),
      environment({ APP_NAME: 'admin', PUBLIC_SITE: UNUSED_BINDING }))
    assert.equal(admin.status, 308)
    assert.equal(admin.headers.get('location'), 'https://admin.healthidentitydirectory.com/admin/overview')
    for (const app of ['web', 'admin']) {
      let proxied
      globalThis.fetch = async url => { proxied = String(url); return new Response('{}') }
      const api = await worker.fetch(new Request(`https://${deploymentProfiles.production.hosts[app]}/api/v1/identity/me`,
        { headers: withCookie(cookie) }), environment({ APP_NAME: app, PUBLIC_SITE: UNUSED_BINDING }))
      assert.equal(api.status, 200)
      assert.equal(proxied, 'https://api.healthidentitydirectory.com/api/v1/identity/me')
    }
  }
})

const LAB_LANDING_SITE = Object.freeze({
  page: 'https://healthidentitydirectory.com/products/laboratory',
  publicOrigin: 'https://healthidentitydirectory.com',
  portalOrigin: 'https://app.healthidentitydirectory.com',
  products: { ehr: 'https://ehr.healthidentitydirectory.com/', laboratory: 'https://lab.healthidentitydirectory.com/',
    pharmacy: 'https://pharmacy.healthidentitydirectory.com/', migrate: 'https://migrate.healthidentitydirectory.com/',
    outreach: 'https://outreach.healthidentitydirectory.com/' },
  staffSignIn: 'https://lab.healthidentitydirectory.com/provider',
  patientSignIn: '',
  enroll: 'https://app.healthidentitydirectory.com/provider/enroll',
  applicationProducts: ['ehr', 'migrate', 'laboratory', 'pharmacy'],
})

/** Asserts each link's address on a landing page, and that each address it gives is final. */
function assertLandingLinks(site, cases) {
  for (const [href, expected] of cases) {
    const result = landingHref(href, site)
    assert.equal(result, expected, href)
    // Every result is final: the page script may apply it again to a link already rewritten.
    assert.equal(landingHref(result, site), result, `again: ${href}`)
  }
}

test('rewrites each landing page link for the product site that shows it', () => {
  assertLandingLinks(LAB_LANDING_SITE, [
    // Other public pages open on the public site.
    ['/', 'https://healthidentitydirectory.com/'],
    ['/pricing', 'https://healthidentitydirectory.com/pricing'],
    ['/providers#products', 'https://healthidentitydirectory.com/providers#products'],
    ['/solutions#hospitals', 'https://healthidentitydirectory.com/solutions#hospitals'],
    ['/products', 'https://healthidentitydirectory.com/products'],
    ['/products/api', 'https://healthidentitydirectory.com/products/api'],
    ['/patients', 'https://healthidentitydirectory.com/patients'],
    ['/resources/security', 'https://healthidentitydirectory.com/resources/security'],
    ['https://healthidentitydirectory.com/about', 'https://healthidentitydirectory.com/about'],
    // Each product's page is its own site's front page, this one's included.
    ['/products/laboratory', 'https://lab.healthidentitydirectory.com/'],
    ['/products/ehr', 'https://ehr.healthidentitydirectory.com/'],
    ['/products/migrate/', 'https://migrate.healthidentitydirectory.com/'],
    ['https://healthidentitydirectory.com/products/pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
    ['/products/outreach', 'https://outreach.healthidentitydirectory.com/'],
    // The product's own calls to action: sign up where Identity accepts it, sign in at this site's workspace entrance.
    ['/provider/apply?product=laboratory', 'https://app.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['/provider/apply?product=ehr', 'https://app.healthidentitydirectory.com/provider/enroll?product=ehr'],
    ['/provider/apply', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['/provider/apply?product=https://evil.example', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['/provider/apply?product=outreach', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['https://app.healthidentitydirectory.com/provider/sign-in', 'https://lab.healthidentitydirectory.com/provider'],
    ['https://app.healthidentitydirectory.com/provider/sign-in?returnTo=/provider/laboratory', 'https://lab.healthidentitydirectory.com/provider'],
    // Left as they are: the patient portal, mail, links within the page, other sites.
    ['https://app.healthidentitydirectory.com/sign-in', 'https://app.healthidentitydirectory.com/sign-in'],
    ['https://app.healthidentitydirectory.com/', 'https://app.healthidentitydirectory.com/'],
    ['https://lab.healthidentitydirectory.com/provider', 'https://lab.healthidentitydirectory.com/provider'],
    ['https://app.healthidentitydirectory.com/provider/enroll', 'https://app.healthidentitydirectory.com/provider/enroll'],
    ['mailto:support@healthidentitydirectory.com', 'mailto:support@healthidentitydirectory.com'],
    ['tel:+2348000000000', 'tel:+2348000000000'],
    ['#main', '#main'],
    ['#demo', '#demo'],
    ['', ''],
    ['https://www.linkedin.com/company/health-id', 'https://www.linkedin.com/company/health-id'],
    ['https://lab.healthidentitydirectory.com/', 'https://lab.healthidentitydirectory.com/'],
    ['javascript:alert(1)', 'javascript:alert(1)'],
  ])
})

test('rewrites each link of the Health ID page for the patient portal that shows it', () => {
  const site = { ...LAB_LANDING_SITE, page: 'https://healthidentitydirectory.com/patients', staffSignIn: '',
    patientSignIn: 'https://app.healthidentitydirectory.com/sign-in' }
  assertLandingLinks(site, [
    // Its own buttons: sign in and get a Health ID on the portal, at pages that exist there (App.tsx).
    ['https://app.healthidentitydirectory.com/sign-in', 'https://app.healthidentitydirectory.com/sign-in'],
    ['https://app.healthidentitydirectory.com/enroll', 'https://app.healthidentitydirectory.com/enroll'],
    // The portal's front page is this page to a stranger: a link there signs in instead, never back here.
    ['https://app.healthidentitydirectory.com/', 'https://app.healthidentitydirectory.com/sign-in'],
    ['https://app.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com/sign-in'],
    ['https://app.healthidentitydirectory.com/?from=nav#top', 'https://app.healthidentitydirectory.com/sign-in'],
    // Staff sign-in on the portal is left as it is (the portal sends it to the EHR site's).
    ['https://app.healthidentitydirectory.com/provider/sign-in', 'https://app.healthidentitydirectory.com/provider/sign-in'],
    // Its sections and the public site's other pages open on the public site, the page's own address.
    ['/patients#steps', 'https://healthidentitydirectory.com/patients#steps'],
    ['/patients', 'https://healthidentitydirectory.com/patients'],
    ['/', 'https://healthidentitydirectory.com/'],
    ['/providers', 'https://healthidentitydirectory.com/providers'],
    ['/privacy', 'https://healthidentitydirectory.com/privacy'],
    // Products open their own sites; facility sign-up the portal's.
    ['/products/laboratory', 'https://lab.healthidentitydirectory.com/'],
    ['/provider/apply?product=ehr', 'https://app.healthidentitydirectory.com/provider/enroll?product=ehr'],
    ['#main', '#main'],
    ['mailto:support@healthidentitydirectory.com', 'mailto:support@healthidentitydirectory.com'],
  ])
})

test('the landing link rewrite is self-contained, so the page can run its source text', () => {
  const source = landingHref.toString()
  assert.equal(source.match(/\bfunction\b/g).length, 1)
  assert.doesNotMatch(source, /=>|\bthis\b|\bimport\b|\bawait\b|<\/script/i)
})

test('keeps the edge\'s product sites and the public site\'s product links the same', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../../../apps/public-web/content/site.ts', import.meta.url), 'utf8')
  const table = /PRODUCT_SITE_SUBDOMAINS[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  const subdomains = Object.fromEntries([...table.matchAll(/(\w+): '([a-z]+)'/g)].map(match => [match[1], match[2]]))
  const edge = Object.fromEntries(Object.entries(PRODUCT_SITES).map(([app, slug]) =>
    [slug, deploymentProfiles.production.hosts[app].split('.')[0]]))
  assert.deepEqual(subdomains, edge)
  // Each is a product page the public site builds.
  const details = await readFile(new URL('../../../apps/public-web/content/product-details.ts', import.meta.url), 'utf8')
  for (const slug of Object.values(PRODUCT_SITES)) assert.match(details, new RegExp(`slug: "${slug}"`))
})

test('the public site\'s static files a product site serves are none of the portal\'s', async () => {
  const { readdir } = await import('node:fs/promises')
  const { join, relative, sep } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../../../apps/patient-web/public/', import.meta.url))
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => `/${relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')}`)
  assert.ok(files.includes('/sw.js') && files.includes('/health-id.webmanifest'))
  for (const path of files) {
    const site = publicSite({ [path]: { body: 'public', type: 'application/octet-stream' } })
    const response = await worker.fetch(new Request(`https://lab.healthidentitydirectory.com${path}`),
      environment({ APP_NAME: 'lab', PUBLIC_SITE: site.binding, ASSETS: assets({}) }))
    assert.equal(site.requests.length, 0, path)
    assert.notEqual(await response.text(), 'public', path)
  }
})
