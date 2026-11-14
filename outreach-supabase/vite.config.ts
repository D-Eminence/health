/**
 * Health ID Outreach on Vercel + Supabase (temporary): the portal built as Outreach on its own, its /api/v1 calls
 * answered from Supabase in the page (shim.mjs). Build: npm run build:outreach → outreach-supabase/dist.
 * Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public "anon" key; never the service key).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import portalConfig from '../apps/patient-web/vite.config'

const SHIM = fileURLToPath(new URL('./shim.mjs', import.meta.url))
const SHIM_ID = '/__outreach-supabase-shim.mjs'

/**
 * Offline (owner, 14 Nov 2026: 100% offline): a service worker that keeps the whole app on the phone after the first
 * visit, so it opens with no signal. The page and its files are listed at build time; a new deploy brings a new list.
 */
function offlineWorker(): Plugin {
  return {
    name: 'hid-outreach-offline-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = ['/', '/index.html', ...Object.keys(bundle).filter(name => !name.endsWith('.map')).map(name => `/${name}`)]
      const version = Object.keys(bundle).filter(name => name.startsWith('assets/')).sort().join('|')
      let hash = 0
      for (const char of version) hash = (hash * 31 + char.charCodeAt(0)) | 0
      this.emitFile({ type: 'asset', fileName: 'outreach-sw.js', source: `/* Health ID Outreach: keeps the app on the phone so it opens offline. */
const CACHE = 'hid-outreach-${(hash >>> 0).toString(16)}'
const FILES = ${JSON.stringify([...new Set(files)])}
self.addEventListener('install', event => {
  // Each file on its own: one missing file never stops the rest being kept.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(FILES.map(file => cache.add(file)))).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hid-outreach-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    // The page: the newest when there is signal (within 4 seconds), else the one kept on the phone.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const fresh = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))])
        if (fresh.ok) cache.put('/index.html', fresh.clone())
        return fresh
      } catch {
        return (await cache.match('/index.html')) ?? Response.error()
      }
    })())
    return
  }
  event.respondWith(caches.match(request).then(kept => kept ?? fetch(request).then(response => {
    if (response.ok && url.pathname.startsWith('/assets/')) caches.open(CACHE).then(cache => cache.put(request, response.clone()))
    return response
  })))
})
` })
    },
  }
}

function supabaseShim(): Plugin {
  return {
    name: 'hid-outreach-supabase',
    resolveId: id => (id === SHIM_ID ? SHIM : null),
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<head>/i, `<head>\n    <script type="module" src="${SHIM_ID}"></script>`)
        .replace(/<title>[^<]*<\/title>/i, '<title>Health ID Outreach</title>'),
    },
  }
}

// The portal's public settings for this copy (values from the host's environment win). The API address is never
// reached: the shim answers every /api/v1 call.
const PUBLIC_DEFAULTS: Record<string, string> = {
  VITE_HID_ENVIRONMENT: 'local',
  VITE_HID_API_BASE_URL: 'http://localhost:3200',
  VITE_HID_APP_ORIGIN: 'http://localhost:3200',
  VITE_HID_SUPPORT_CHAT_ENABLED: 'false',
  VITE_HID_PATIENT_CHAT_ENABLED: 'false',
  VITE_HID_STAFF_PATIENT_CHAT_ENABLED: 'false',
  VITE_HID_SUPPORT_CONTACT: 'mailto:support@healthidentitydirectory.com',
}
for (const [key, value] of Object.entries(PUBLIC_DEFAULTS)) process.env[key] ??= value

export default defineConfig(env => {
  const base = typeof portalConfig === 'function' ? portalConfig(env) : portalConfig
  const merged = mergeConfig(base, {
    root: fileURLToPath(new URL('../apps/patient-web', import.meta.url)),
    base: '/',
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [supabaseShim(), offlineWorker()],
    build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  })
  // The Supabase values are public by design (the anon key works only through the database's row rules).
  merged.envPrefix = ['VITE_HID_', 'VITE_SUPABASE_']
  return merged
})
