import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrontendWorker } from '../src/frontend-worker.mjs'
import apexWorker from '../src/apex-redirect-worker.mjs'
import legacyOcrDomainRedirectWorker from '../src/legacy-ocr-domain-redirect-worker.mjs'

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
      web: 'staging.healthidentitydirectory.com', ehr: 'ehr.staging.healthidentitydirectory.com',
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
  const ocr = await worker.fetch(new Request('https://migrate.healthidentitydirectory.com/'), environment({ APP_NAME: 'ocr' }))
  assert.equal(ocr.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=()')
  const outreach = await worker.fetch(new Request('https://outreach.healthidentitydirectory.com/'), environment({ APP_NAME: 'outreach' }))
  assert.equal(outreach.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=(self)')
})

test('serves Migrate from its canonical hostname root and redirects legacy paths without chains', async () => {
  const root = await worker.fetch(new Request('https://migrate.healthidentitydirectory.com/'), environment({ APP_NAME: 'ocr' }))
  assert.equal(root.status, 200)
  assert.equal(await root.text(), '<p>/</p>')

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

// Content-Security-Policy-Report-Only (docs/OFFLINE-CONTRACT.md 2.12, D11): HTML responses only, never the API.
const CSP = 'content-security-policy-report-only'

test('adds the report-only CSP to every HTML response, with worker-src and manifest-src for /sw.js and the manifest', async () => {
  for (const app of ['ehr', 'ocr', 'admin', 'lab', 'pharmacy', 'outreach', 'web', 'public']) {
    const host = deploymentProfiles.production.hosts[app]
    const response = await worker.fetch(new Request(`https://${host}/patients/1`), environment({ APP_NAME: app }))
    const policy = response.headers.get(CSP)
    assert.ok(policy, app)
    for (const directive of ["default-src 'self'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'",
      "frame-ancestors 'none'", "form-action 'self'", "img-src 'self' data: blob:",
      'frame-src https://challenges.cloudflare.com']) {
      assert.ok(policy.split('; ').some(part => part.startsWith(directive)), `${app}: ${directive}`)
    }
    assert.match(policy, /script-src 'self' https:\/\/static\.cloudflareinsights\.com https:\/\/challenges\.cloudflare\.com/)
    assert.match(policy, /connect-src 'self' https:\/\/cloudflareinsights\.com/)
    assert.equal(response.headers.get('content-security-policy'), null, 'report-only first: nothing is enforced yet')
  }
})

test('allows Google Identity Services on the patient portal only', async () => {
  const web = await worker.fetch(new Request('https://app.healthidentitydirectory.com/'), environment({ APP_NAME: 'web' }))
  const policy = web.headers.get(CSP)
  assert.match(policy, /script-src [^;]*https:\/\/accounts\.google\.com\/gsi\/client/)
  assert.match(policy, /frame-src [^;]*https:\/\/accounts\.google\.com\/gsi\//)
  assert.match(policy, /connect-src [^;]*https:\/\/accounts\.google\.com\/gsi\//)
  for (const app of ['ehr', 'ocr', 'admin', 'public']) {
    const host = deploymentProfiles.production.hosts[app]
    const response = await worker.fetch(new Request(`https://${host}/`), environment({ APP_NAME: app }))
    assert.doesNotMatch(response.headers.get(CSP), /google/, app)
  }
})

test('adds the Sentry ingest and document storage origins only when the Worker is given them', async () => {
  const plain = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/'), environment())
  assert.doesNotMatch(plain.headers.get(CSP), /sentry|storage/)
  const given = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/'), environment({
    SENTRY_DSN: 'https://publickey@o123.ingest.sentry.io/456', DOCUMENT_STORAGE_ORIGIN: 'https://documents.example-storage.test/bucket',
  }))
  assert.match(given.headers.get(CSP), /connect-src 'self' https:\/\/cloudflareinsights\.com https:\/\/documents\.example-storage\.test https:\/\/o123\.ingest\.sentry\.io;/)
  for (const bad of ['http://o123.ingest.sentry.io/1', 'not a url', "https://x.test; script-src 'unsafe-eval'"]) {
    const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/'), environment({ SENTRY_DSN: bad, DOCUMENT_STORAGE_ORIGIN: bad }))
    assert.doesNotMatch(response.headers.get(CSP), /sentry|unsafe-eval|x\.test|not a url/, bad)
  }
})

test('never adds the CSP to API responses, API refusals, or files that are not HTML', async () => {
  globalThis.fetch = async () => new Response('<html>api</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  const api = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/v1/ehr/offline/ping'), environment())
  assert.equal(api.status, 200)
  assert.equal(api.headers.get(CSP), null)
  const missing = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/api/other'), environment())
  assert.equal(missing.status, 404)
  assert.equal(missing.headers.get(CSP), null)
  const script = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/assets/index-AbCdEf12.js'), environment({
    ASSETS: { fetch: async () => new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } }) },
  }))
  assert.equal(script.headers.get(CSP), null)
  const sw = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/sw.js'), environment({
    ASSETS: { fetch: async () => new Response('self.x = 1', { status: 200, headers: { 'content-type': 'application/javascript' } }) },
  }))
  assert.equal(sw.headers.get(CSP), null)
})

// A file under /assets/ that the build lacks is never answered with the single-page fallback's index.html: the
// offline app shell would otherwise save a page as a script (docs/OFFLINE-CONTRACT.md 2.12).
test('answers 404, never the single-page fallback page, for a missing file under /assets/', async () => {
  const fallback = { ASSETS: { fetch: async () => new Response('<!doctype html><title>Health ID</title>', {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) } }
  for (const method of ['GET', 'HEAD']) {
    const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/assets/index-OldBuild1.js', { method }), environment(fallback))
    assert.equal(response.status, 404, method)
    assert.match(response.headers.get('content-type'), /problem\+json/)
  }
  const page = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/patients/1'), environment(fallback))
  assert.equal(page.status, 200)
  const script = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/assets/index-AbCdEf12.js'), environment({
    ASSETS: { fetch: async () => new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } }) },
  }))
  assert.equal(script.status, 200)
})
