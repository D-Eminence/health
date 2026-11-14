import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrontendWorker } from '../src/frontend-worker.mjs'

test('API requests bypass Cloudflare cache and retain origin authentication cookies', async () => {
  const original = globalThis.fetch
  const environment = {
    DEPLOYMENT_ENV: 'production', APP_NAME: 'web',
    EXPECTED_HOST: 'app.healthidentitydirectory.com',
    API_ORIGIN: 'https://api.healthidentitydirectory.com',
    ORIGIN_AUTH_TOKEN: 'a'.repeat(48),
    ASSETS: { fetch() { throw new Error('API requests must not use static assets') } },
  }
  try {
    for (const method of ['GET', 'HEAD', 'POST']) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url.hostname, 'api.healthidentitydirectory.com')
        assert.equal(init.method, method)
        assert.equal(init.cache, 'no-store')
        assert.equal(init.cf?.cacheTtl, undefined)
        assert.equal(init.redirect, 'manual')
        const headers = new Headers({ 'content-type': 'application/json' })
        headers.append('set-cookie', '__Secure-hid_google_nonce=synthetic; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict')
        return new Response(method === 'HEAD' ? null : '{}', { headers })
      }
      const response = await createFrontendWorker().fetch(new Request(
        'https://app.healthidentitydirectory.com/api/v1/auth/google/nonce',
        { method, ...(method === 'POST' ? { body: '{}' } : {}) },
      ), environment)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('set-cookie'), /__Secure-hid_google_nonce=synthetic/)
      assert.match(response.headers.get('cache-control'), /no-store/)
      assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store')
    }
  } finally { globalThis.fetch = original }
})
