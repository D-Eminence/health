/*
 * Health ID's service worker, registered at /sw.js with scope '/'. It does two separate jobs.
 *
 * Push (B6). Registered when a patient turns on "Notifications on this device" on the Notifications page
 * (apps/patient-web/src/pushDevice.ts). A push carries nothing: whatever arrives, this shows the same fixed
 * notification and never reads the message. Tapping it opens Notifications. The two push listeners below are kept
 * exactly as B6 shipped them.
 *
 * App shell (offline-first wave 1, docs/OFFLINE-CONTRACT.md 2.12 and amendment A5). Only in a build whose offline mode
 * is on for its host does the build write the shell's file list into self.__HID_SHELL__ (vite.config.ts); everywhere
 * else it stays null and this worker handles no request at all, exactly as before. Even then it keeps nothing until
 * the EHR, after opening an offline vault for a pilot facility, posts HID_SHELL_ENABLE (apps/patient-web/src/offline/shell.ts):
 * until a health-id-shell- cache exists every request passes straight through. The shell is index.html and the
 * build's own files, identical for every user; nothing about a person or a patient is ever kept here. It never
 * handles the API or the worker scripts (sw.js, service-worker.js), and it takes over from an older worker only when
 * a page asks with HID_SKIP_WAITING. It fetches only the request it answers (shellResponse) and its own shell files
 * (precacheShell), and writes Cache Storage only in precacheShell. scripts/check-launch-build.mjs refuses a build
 * whose sw.js does more, or whose push and tap listeners differ from B6's; see pushWorker.test.ts and
 * shellWorker.test.ts.
 */
const TITLE = 'Health ID'
const OPTIONS = Object.freeze({
  body: 'You have a new notification.',
  icon: '/icons/icon-192.png',
  tag: 'hid-inbox',
  renotify: true,
  lang: 'en',
})
const TARGET_PATH = '/notifications'

self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification(TITLE, OPTIONS))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL(TARGET_PATH, self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const ours = windows.filter(client => new URL(client.url).origin === self.location.origin)
    const open = ours.find(client => new URL(client.url).pathname === TARGET_PATH)
    if (open) return open.focus()
    for (const client of ours) {
      try {
        const moved = await client.navigate(target)
        if (moved) return moved.focus()
      } catch { /* not controlled by this worker: try the next, then open a window */ }
    }
    return self.clients.openWindow(target)
  })())
})

// --- App shell ------------------------------------------------------------------------------------------------------

// Written by the build (vite.config.ts, hidShellManifest): null, or { build, environment, debug, entry, assets }.
self.__HID_SHELL__ = null
const SHELL = self.__HID_SHELL__
// Never "hid-": /service-worker.js deletes every cache with that prefix.
const SHELL_PREFIX = 'health-id-shell-'
const SHELL_PAGE = '/index.html'
const NETWORK_FIRST_MS = 4000
// The build's own content-hashed files, its web app manifest and its icons: served from the shell first.
const SHELL_FILE = /^\/(?:assets\/[A-Za-z0-9][A-Za-z0-9_.-]*|health-id\.webmanifest|icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png)$/

// Whether a shell cache exists, as last seen; null until this worker has looked. Only this worker's own messages
// and activation create or delete a shell cache, so it is refreshed after each of them.
let shellKept = null
if (SHELL) refreshShellKept().catch(() => { /* looked for again on the next request */ })

async function shellCacheNames() {
  return (await caches.keys()).filter(name => name.startsWith(SHELL_PREFIX))
}

async function refreshShellKept() {
  shellKept = (await shellCacheNames()).length > 0
  return shellKept
}

/**
 * This build's shell, complete or not at all: every file is fetched first, and the page goes in last, so a generation
 * that holds the page holds everything. The page is fetched at '/', which the Worker answers with index.html. Once
 * another build is deployed, Cloudflare answers a file of this build that no longer exists with the new build's page
 * (its single-page fallback): so no file may be a page, and the page must be this build's own (it loads SHELL.entry).
 * Anything else saves nothing, and the next HID_SHELL_ENABLE or activation tries again.
 */
async function precacheShell() {
  const ownName = SHELL_PREFIX + SHELL.build
  if (await caches.match(SHELL_PAGE, { cacheName: ownName })) return
  const responses = await Promise.all(['/', ...SHELL.assets].map(async path => {
    const response = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin', redirect: 'error' }))
    if (!response.ok || response.type !== 'basic') throw new Error('The app shell could not be saved on this device.')
    if (path !== '/' && /^text\/html/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('The app shell could not be saved on this device.')
    }
    return [path, response]
  }))
  if (!(await responses[0][1].clone().text()).includes('src="' + SHELL.entry + '"')) {
    throw new Error('The app shell could not be saved on this device.')
  }
  const cache = await caches.open(SHELL_PREFIX + SHELL.build)
  for (const [path, response] of responses.slice(1)) await cache.put(path, response)
  await cache.put(SHELL_PAGE, responses[0][1])
}

/**
 * Deletes older shell generations. While any window of this site is open it may still be running an older build and
 * load that build's files later, so the newest older generation is kept; the rest go.
 */
async function pruneShell() {
  const ownName = SHELL ? SHELL_PREFIX + SHELL.build : null
  const older = (await shellCacheNames()).filter(name => name !== ownName)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const keep = windows.length > 0 ? older.slice(-1) : []
  await Promise.all(older.filter(name => !keep.includes(name)).map(name => caches.delete(name)))
}

async function purgeShell() {
  await Promise.all((await shellCacheNames()).map(name => caches.delete(name)))
  shellKept = false
}

/** The saved copy of `path`: this build's generation first, then the newest older one still kept. */
async function savedShellFile(path, names) {
  const ownName = SHELL_PREFIX + SHELL.build
  const order = [...names.filter(name => name === ownName), ...names.filter(name => name !== ownName).reverse()]
  for (const name of order) {
    const saved = await caches.match(path, { cacheName: name })
    if (saved) return saved
  }
  return undefined
}

async function shellResponse(request, path, navigation) {
  const names = await shellCacheNames()
  shellKept = names.length > 0
  // Never turned on for this device: answer as the network would without a worker.
  if (!shellKept) return fetch(request)
  if (!navigation) return (await savedShellFile(path, names)) ?? fetch(request)
  const network = fetch(request)
  network.catch(() => { /* answered from the saved shell below */ })
  try {
    const answer = await Promise.race([network, new Promise(resolve => setTimeout(resolve, NETWORK_FIRST_MS, null))])
    if (answer) return answer
  } catch { /* no connection: use the saved shell */ }
  return (await savedShellFile(SHELL_PAGE, names)) ?? network
}

// Amendment A5: nothing is saved at install, so a worker installed for push alone keeps nothing; and it does not take
// over from the running worker until a page asks (HID_SKIP_WAITING).
self.addEventListener('install', () => {})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (!SHELL) {
      // A build with offline off for this host (or the kill switch): no shell is served, so none is kept.
      await purgeShell()
      return
    }
    // Never turned on for this device: stay a pass-through worker.
    if (!(await refreshShellKept())) return
    // Older generations go only once this one is complete: offline now, the older shell keeps working.
    await precacheShell()
    await pruneShell()
    await refreshShellKept()
  })())
})

self.addEventListener('fetch', event => {
  if (!SHELL || shellKept === false) return
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (path === '/api' || path.startsWith('/api/') || path === '/sw.js' || path === '/service-worker.js') return
  const navigation = request.mode === 'navigate'
  if (!navigation && !SHELL_FILE.test(path)) return
  event.respondWith(shellResponse(request, path, navigation))
})

self.addEventListener('message', event => {
  const type = event.data?.type
  if (type === 'HID_SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  } else if (type === 'HID_SHELL_ENABLE' && SHELL) {
    event.waitUntil((async () => {
      try {
        await precacheShell()
        await pruneShell()
      } finally {
        await refreshShellKept()
      }
    })())
  } else if (type === 'HID_PURGE_SHELL') {
    event.waitUntil(purgeShell())
  }
})
