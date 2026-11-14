/*
 * Health ID Outreach's offline app shell, added to the push worker (sw.js) on Outreach's own sites only. A volunteer
 * on weak signal who reloads, or opens Outreach with no signal, still gets the app, which then opens in "No signal"
 * mode (ehr-blue/departments/outreach/OfflineOutreach.tsx).
 *
 * What it keeps, in one cache (SHELL_CACHE): the app's page (the build's index.html, under SHELL_PATH) and the build's
 * own content-hashed files under /assets/ (code, styles, fonts, images). Nothing else: never an /api/ answer, never
 * another site's page, never a page that is not the app's page, never what a person typed. Registrations waiting to be
 * sent stay where they always were (offlineQueue.ts), not here.
 *
 * - A page opened (a navigation): the network first, as before. Its answer is used whenever it comes within
 *   NAVIGATION_TIMEOUT_MS; only when there is no answer by then, or no connection at all, the last app page kept is
 *   used, and without one the browser's own page shows, as before. A fresh app page replaces the one kept, so a new
 *   release always replaces an old one once there is signal; the files only the old one used are then deleted.
 * - A build file (/assets/<name>-<hash>.<ext>): the copy kept, else the network, kept once it answers. A hashed name
 *   never changes content, so a kept copy is never stale.
 * - Anything else (the API, other files, other sites, anything but GET): not touched; the browser does as it always did.
 *
 * The cache's name carries a version: a worker with another version deletes the old cache as it starts. It takes over
 * at once (skipWaiting, clients.claim): what it serves is either the network's own answer or a file named by its hash,
 * so an open page is never handed anything that does not match it. scripts/check-launch-build.mjs checks the build's
 * copy of this file; outreachShellWorker.test.ts runs it.
 */
const SHELL_CACHE = 'hid-outreach-shell-v1'
const SHELL_CACHE_PREFIX = 'hid-outreach-shell-'
/** Where the app's page is kept, and where it is asked for when the worker starts: Outreach's own page. */
const SHELL_PATH = '/provider/outreach'
const NAVIGATION_TIMEOUT_MS = 4000
/** A file kept less than this long before a new app page arrives may still be used by a page just opened: kept. */
const PRUNE_MARGIN_MS = 10 * 60 * 1000
const KEPT_AT = 'x-hid-kept-at'
/** The build's content-hashed files, as scripts/check-launch-build.mjs names them. */
const HASHED_ASSET = /^\/assets\/[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.(?:js|css|png|svg|webp|jpe?g|gif|ico|woff2?)$/
/** The site's front page: a landing page or a move to the workspace, never the app's page, so never kept. */
const FRONT_PAGES = Object.freeze(['/', '/index.html'])
/** At most this many files are kept from one message from the page. */
const MESSAGE_LIMIT = 300

function ownUrl(value) {
  let url
  try { url = new URL(value, self.location.origin) } catch { return null }
  return url.origin === self.location.origin ? url : null
}

function isHashedAsset(url) {
  return url !== null && url.search === '' && url.hash === '' && HASHED_ASSET.test(url.pathname)
}

/**
 * What the worker does with a request: 'navigate' (the network first, else the app page kept), 'asset' (the copy
 * kept, else the network), or 'network' (nothing: the browser handles it as before).
 */
function shellRoute(request) {
  if (request.method !== 'GET') return 'network'
  const url = ownUrl(request.url)
  if (!url || url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'network'
  if (request.mode === 'navigate') return 'navigate'
  return isHashedAsset(url) ? 'asset' : 'network'
}

/** The app's page as the network gave it, when it is one: the Vite page with its root and a script from /assets/. */
async function shellText(response) {
  if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) return null
  if (!/^text\/html\b/i.test(response.headers.get('content-type') || '')) return null
  const text = await response.clone().text()
  return /<div id="root"><\/div>/.test(text) && /<script type="module"[^>]*\ssrc="\/assets\//.test(text) ? text : null
}

/** The build files the app page names itself (its entry script, preloads and styles). */
function namedAssets(text) {
  return [...text.matchAll(/\s(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]).filter(path => isHashedAsset(ownUrl(path)))
}

function kept(body, type) {
  return new Response(body, { headers: { 'content-type': type, [KEPT_AT]: String(Date.now()) } })
}

/** Keeps a build file the network gave, unless it is not one (an error, a redirect, or a page in its place). */
async function keepAsset(cache, path, response) {
  if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) return
  const type = response.headers.get('content-type') || ''
  if (!type || /^text\/html\b/i.test(type)) return
  await cache.put(path, kept(await response.arrayBuffer(), type))
}

/** Asks the network for a build file not kept yet, and keeps it. Never throws. */
async function keepFromNetwork(cache, path) {
  try {
    if (await cache.match(path)) return
    await keepAsset(cache, path, await fetch(path, { credentials: 'same-origin' }))
  } catch { /* no signal: kept the next time it loads */ }
}

/** Deletes the build files the new app page does not name, unless kept just now (a page just opened may use them). */
async function pruneAssets(cache, text) {
  const named = new Set(namedAssets(text))
  const before = Date.now() - PRUNE_MARGIN_MS
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    if (path === SHELL_PATH || named.has(path)) continue
    const copy = await cache.match(request)
    if (!(Number(copy && copy.headers.get(KEPT_AT)) > before)) await cache.delete(request)
  }
}

/**
 * Keeps the app's page the network gave, in place of the one kept. When it is a new release and it is what the page
 * got (`served`), the files only the old one used are deleted. A new release the page did NOT get (it arrived too late,
 * or the worker asked for it itself) replaces the kept page only once every file it names is kept too: otherwise the
 * next reload with no signal would open a page whose files can't be had, a blank screen.
 */
async function keepShell(response, served) {
  const text = await shellText(response)
  if (!text) return false
  const cache = await caches.open(SHELL_CACHE)
  const previous = await cache.match(SHELL_PATH)
  const changed = !previous || (await previous.text()) !== text
  if (changed && !served) {
    const files = namedAssets(text)
    await Promise.all(files.map(path => keepFromNetwork(cache, path)))
    const missing = await Promise.all(files.map(async path => !(await cache.match(path))))
    if (missing.some(Boolean)) return false
  }
  await cache.put(SHELL_PATH, kept(text, 'text/html; charset=utf-8'))
  if (changed && served) await pruneAssets(cache, text)
  return true
}

/** The app's page and the files it names, asked for as the worker starts, so the first visit already works offline. */
async function keepShellNow() {
  try {
    const response = await fetch(SHELL_PATH, { credentials: 'same-origin', cache: 'no-store' })
    const text = await shellText(response)
    if (!text || !(await keepShell(response, false))) return
    const cache = await caches.open(SHELL_CACHE)
    await Promise.all(namedAssets(text).map(path => keepFromNetwork(cache, path)))
  } catch { /* no signal: kept on the next page opened with signal */ }
}

async function keptShell() {
  const cache = await caches.open(SHELL_CACHE)
  return (await cache.match(SHELL_PATH)) || null
}

/** The network's answer when it comes in time; else the app page kept; else the network's answer, whenever it comes. */
async function answerNavigation(network) {
  let timer
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS) })
  const first = await Promise.race([network.then(response => ({ response }), () => ({ failed: true })), late])
  clearTimeout(timer)
  if (first && first.response) return { response: first.response, served: true }
  const copy = await keptShell().catch(() => null)
  if (copy) return { response: copy, served: false }
  return { response: network, served: true }
}

function onNavigate(event) {
  const front = FRONT_PAGES.includes(new URL(event.request.url).pathname)
  const network = fetch(event.request)
  const answer = answerNavigation(network)
  event.respondWith(answer.then(chosen => chosen.response))
  event.waitUntil(Promise.all([network, answer])
    .then(([response, chosen]) => (front ? false : keepShell(response, chosen.served)))
    .catch(() => false))
}

async function answerAsset(event) {
  const cache = await caches.open(SHELL_CACHE)
  const copy = await cache.match(event.request.url)
  if (copy) return copy
  const response = await fetch(event.request)
  const path = new URL(event.request.url).pathname
  event.waitUntil(keepAsset(cache, path, response.clone()).catch(() => undefined))
  return response
}

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(keepShellNow())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const route = shellRoute(event.request)
  if (route === 'navigate') onNavigate(event)
  else if (route === 'asset') event.respondWith(answerAsset(event))
})

/*
 * The page, once it is open, names the build files it has loaded (src/outreachShell.ts): those it loaded before this
 * worker took over are kept too. Only from a page of this site, and only build files: anything else named is ignored.
 */
self.addEventListener('message', event => {
  const source = event.source
  const from = source && typeof source.url === 'string' ? ownUrl(source.url) : null
  const message = event.data
  if (!from || !message || message.type !== 'hid-outreach-keep' || !Array.isArray(message.assets)) return
  const paths = message.assets.slice(0, MESSAGE_LIMIT).filter(value => typeof value === 'string')
    .map(ownUrl).filter(isHashedAsset).map(url => url.pathname)
  event.waitUntil((async () => {
    if (!(await keptShell().catch(() => null))) await keepShellNow()
    const cache = await caches.open(SHELL_CACHE)
    await Promise.all(paths.map(path => keepFromNetwork(cache, path)))
  })().catch(() => undefined))
})
