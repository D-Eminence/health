// @vitest-environment node
import { spawnSync } from 'node:child_process'
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
 * and a sw.js that does more, is still refused.
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
function launchBuildCheck(html: string, files: Record<string, string> = {}): { status: number | null; output: string } {
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
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
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
    ['a theme-color that is not a colour', built.replace('content="#1570ef"', 'content="url(https://evil.example/)"'), /theme-color/],
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

describe('the push worker (B6)', () => {
  it('accepts the real public files with pushDevice\'s chunk, the only code that registers it', () => {
    const result = launchBuildCheck(built, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE })
    expect(result.output).not.toMatch(/failed/)
    expect(result.status).toBe(0)
  })

  it.each([
    ['a fetch listener', { 'sw.js': workerWith("self.addEventListener('fetch', event => event.respondWith(fetch(event.request)))") },
      /sw\.js handles requests/],
    ['a fetch listener in double quotes', { 'sw.js': workerWith('self.addEventListener("fetch", () => {})') }, /sw\.js handles requests/],
    ['an onfetch handler', { 'sw.js': workerWith('self.onfetch = () => {}') }, /sw\.js handles requests \(onfetch\)/],
    ['the Cache API', { 'sw.js': workerWith("self.addEventListener('push', () => caches.open('hid-pages'))") }, /sw\.js uses the Cache API/],
    ['an imported script', { 'sw.js': workerWith("importScripts('/assets/firebase-messaging.js')") }, /sw\.js imports scripts/],
    ['a read of the push\'s data', { 'sw.js': PUSH_WORKER.replace('self.registration.showNotification(TITLE, OPTIONS)',
      'self.registration.showNotification(event.data.json().title, OPTIONS)') }, /sw\.js reads a message's data/],
    ['a network request', { 'sw.js': workerWith("self.addEventListener('push', () => self.fetch('/api/v1/identity/me'))") }, /sw\.js calls fetch/],
    ['IndexedDB', { 'sw.js': workerWith("self.addEventListener('push', () => self.indexedDB.open('hid'))") }, /sw\.js uses IndexedDB/],
    ['another listener', { 'sw.js': workerWith("self.addEventListener('message', () => {})") }, /sw\.js listens for message/],
    ['an install listener that takes over at once', { 'sw.js': workerWith("self.addEventListener('install', () => self.skipWaiting())") },
      /sw\.js listens for install/],
    ['no push listener', { 'sw.js': PUSH_WORKER.replace("addEventListener('push'", "addEventListener('notificationclose'") },
      /sw\.js does not listen for push/],
    ['a tap that opens somewhere else', { 'sw.js': PUSH_WORKER.replace("'/notifications'", "'/records'") },
      /does not open '\/notifications'/],
    ['a worker anywhere but the root', { 'icons/sw.js': PUSH_WORKER }, /icons\/sw\.js is a service worker/],
    ['the worker API outside pushDevice\'s chunk', { [ENTRY]: 'navigator.serviceWorker.register("/sw.js")\n' },
      /index-AbCdEf12\.js registers a service worker/],
    ['a chunk that registers another script', { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE.replace('"/sw.js"', '"/firebase-messaging-sw.js"') },
      /registers \/firebase-messaging-sw\.js; only \/sw\.js may be registered/],
    ['a chunk that registers a script it names at run time', { [PUSH_DEVICE_CHUNK]: `${PUSH_DEVICE}navigator.serviceWorker.register(e.url)\n` },
      /registers \(e\.url\); only \/sw\.js may be registered/],
  ])('refuses %s', (_name, files, reason) => {
    const result = launchBuildCheck(built, { [PUSH_DEVICE_CHUNK]: PUSH_DEVICE, ...files })
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
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
