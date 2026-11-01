import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrontendWorker } from '../src/frontend-worker.mjs'
import www from '../src/www-redirect-worker.mjs'

const worker = createFrontendWorker()
function env(app, host) {
  return { DEPLOYMENT_ENV: 'production', APP_NAME: app, EXPECTED_HOST: host,
    API_ORIGIN: 'https://api.healthidentitydirectory.com',
    ORIGIN_AUTH_TOKEN: 'test-origin-authorization-token-not-a-secret-123456',
    ASSETS: { fetch: async () => new Response('page') } }
}

test('production serves public apex and patient app separately', async () => {
  // The portal's front page is the portal to a signed-in patient (a stranger's is below).
  const signedIn = { headers: { cookie: 'hid_access_csrf=4f9c2b' } }
  for (const [app, host] of [['public', 'healthidentitydirectory.com'], ['web', 'app.healthidentitydirectory.com']]) {
    const response = await worker.fetch(new Request(`https://${host}/`, signedIn), env(app, host))
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'page')
  }
  assert.equal((await worker.fetch(new Request('https://healthidentitydirectory.com/'),
    env('web', 'app.healthidentitydirectory.com'))).status, 421)
  assert.equal((await worker.fetch(new Request('https://www.healthidentitydirectory.com/'),
    env('web', 'www.healthidentitydirectory.com'))).status, 502)
})

test('www redirect preserves path query and apex authority', () => {
  const response = www.fetch(new Request('https://www.healthidentitydirectory.com//evil.example/path?next=https://other.example'))
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), 'https://healthidentitydirectory.com//evil.example/path?next=https://other.example')
  assert.equal(www.fetch(new Request('https://app.healthidentitydirectory.com/')).status, 421)
})

test('provider recovery goes to patient app, not the public website', async () => {
  const response = await worker.fetch(new Request('https://ehr.healthidentitydirectory.com/provider/recover'),
    env('ehr', 'ehr.healthidentitydirectory.com'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://app.healthidentitydirectory.com/provider/recover?returnTo=ehr')
})

test('production product sites open their own landing page; the public site sends its product pages there', async () => {
  globalThis.HTMLRewriter ??= class { on() { return this } transform(response) { return response } }
  const signedIn = { headers: { cookie: 'theme=dark; hid_access_csrf=4f9c2b' } }
  const products = { ehr: ['ehr', 'ehr'], lab: ['lab', 'laboratory'], pharmacy: ['pharmacy', 'pharmacy'],
    ocr: ['migrate', 'migrate'], outreach: ['outreach', 'outreach'] }
  for (const [app, [subdomain, slug]] of Object.entries(products)) {
    const host = `${subdomain}.healthidentitydirectory.com`
    let asked
    const config = { ...env(app, host), PUBLIC_SITE: { fetch: async request => {
      asked = request.url
      return new Response('<html><head></head><body>landing</body></html>', { headers: { 'content-type': 'text/html' } })
    } } }
    const root = await worker.fetch(new Request(`https://${host}/`), config)
    assert.equal(root.status, 200)
    assert.equal(asked, `https://healthidentitydirectory.com/products/${slug}`)
    // Staff signed in there go to the workspace's entrance instead.
    const workspace = await worker.fetch(new Request(`https://${host}/?next=https://evil.example`, signedIn), config)
    assert.equal(workspace.status, 302)
    assert.equal(workspace.headers.get('location'), `https://${host}/provider`)
    const moved = await worker.fetch(new Request(`https://healthidentitydirectory.com/products/${slug}`),
      env('public', 'healthidentitydirectory.com'))
    assert.equal(moved.status, 308)
    assert.equal(moved.headers.get('location'), `https://${host}/`)
  }
  // The patient portal's front page is the portal to a signed-in patient, and the public site's patient page, the
  // Health ID Identity landing page, to anyone else; the public site keeps that page at its own address.
  let asked
  const portalConfig = { ...env('web', 'app.healthidentitydirectory.com'), PUBLIC_SITE: { fetch: async request => {
    asked = request.url
    return new Response('<html><head></head><body>For patients</body></html>', { headers: { 'content-type': 'text/html' } })
  } } }
  const portal = await worker.fetch(new Request('https://app.healthidentitydirectory.com/', signedIn), portalConfig)
  assert.equal(await portal.text(), 'page')
  assert.equal(asked, undefined)
  const stranger = await worker.fetch(new Request('https://app.healthidentitydirectory.com/'), portalConfig)
  assert.equal(await stranger.text(), '<html><head></head><body>For patients</body></html>')
  assert.equal(asked, 'https://healthidentitydirectory.com/patients')
  const patients = await worker.fetch(new Request('https://healthidentitydirectory.com/patients'),
    env('public', 'healthidentitydirectory.com'))
  assert.equal(patients.status, 200)
})
