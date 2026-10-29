#!/usr/bin/env node
/**
 * Launch build check for the patient portal.
 *
 * hid-system's staging step (infra/cloudflare/scripts/health-id-artifact.mjs,
 * `inspectHealthIdBuild`) refuses a Health-id build that carries Google
 * sign-in, a service worker, a web app manifest, a source map, or a file
 * outside index.html and content-hashed assets, or whose index.html is not
 * the Vite shell it allow-lists (`inspectIndexHtml`). This runs those rules
 * over apps/patient-web/dist, so a build that staging would refuse fails here
 * first. Google sign-in is off at launch: build without
 * VITE_HID_GOOGLE_CLIENT_ID.
 *
 * Two widenings. First, for the Health ID icon in the browser tab and on a
 * phone's home screen (hid-1.0 parity, 2026-10-28): the files in
 * apps/patient-web/public (PUBLIC_FILES: the web app manifest and its icons,
 * at fixed names) and the shell's links to them and theme-color meta. Second,
 * for "Notifications on this device" (B6, owner approval 2026-10-28): exactly
 * one service worker, /sw.js from apps/patient-web/public, which shows a fixed
 * notification on a push and opens Notifications on a tap and does nothing
 * else (inspectServiceWorker: no fetch handler, Cache API, storage, network,
 * imported script or message data), registered only by the chunk Vite makes
 * of apps/patient-web/src/pushDevice.ts (assets/pushDevice-<hash>.js), which
 * registers that file and nothing else. The production release
 * (scripts/build-production.py, the frontend Worker's ASSETS binding) serves
 * them; hid-system's stager, on its main branch only, must take the same
 * widenings before a Health-id build is staged there again, and its CSP's
 * `worker-src 'none'` would need `'self'` (and `manifest-src 'self'`).
 *
 * Third, for the offline app shell (docs/OFFLINE-CONTRACT.md 2.12 and 2.13,
 * amendment A5, owner decision D1): the same sw.js may also listen for
 * install, activate, fetch and message, and keep the build's own files in
 * health-id-shell- caches. inspectServiceWorker now refuses, instead of any
 * fetch or Cache API: storage, IndexedDB, imported scripts, other
 * connections, a cache by any other name, a listing of caches not kept to that
 * prefix, any mention of an /api/ path but the exclusion guard, work at
 * install, a takeover not asked for by a page, a read of a message's data
 * other than its type, and a shell file list naming a file the build does not
 * have (or a production build with the offline debug panel on). The chunk Vite
 * makes of apps/patient-web/src/offline/shell.ts (assets/shell-<hash>.js) may
 * register /sw.js too, and nothing else.
 * Still refused: any other service worker (service-worker.js, workbox, a
 * worker anywhere but the root), a manifest naming one, any other manifest,
 * file or link.
 *
 * Not checked here: the public environment record, which depends on the
 * environment and host being staged.
 *
 * Run after `npm run build:patient-web`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const dist = join(root, 'apps', 'patient-web', 'dist')

// The same patterns as hid-system's stager.
const HASHED_ASSET = /^assets\/[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.(?:js|css|png|svg|webp|jpe?g|gif|ico|woff2?)$/
// apps/patient-web/public, copied to the build root as they are: the shell links the first three, the manifest names
// the icons, and pushDevice.ts registers the worker; only these.
const PUBLIC_FILES = Object.freeze({
  'health-id.webmanifest': 'manifest',
  'icons/icon-48.png': 'icon',
  'icons/apple-touch-icon.png': 'apple-touch-icon',
  'icons/icon-192.png': 'manifest-icon',
  'icons/icon-512.png': 'manifest-icon',
  'icons/icon-maskable-512.png': 'manifest-icon',
  'sw.js': 'service-worker',
})
const MANIFEST_ICONS = new Set(['icon', 'apple-touch-icon', 'manifest-icon'])
// The chunks Vite makes of apps/patient-web/src/pushDevice.ts and apps/patient-web/src/offline/shell.ts: the only code
// that may use the worker API.
const WORKER_API_CHUNK = /^assets\/(?:pushDevice|shell)-[A-Za-z0-9_-]{8,}\.js$/
// What the worker may never do: use storage or IndexedDB, import code, open other connections, assign handler
// properties, or take control of pages on its own. Matched on the file as served, comments included, so its comments
// may not name them either.
const WORKER_REFUSALS = Object.freeze([
  [/\bonfetch\b/, 'handles requests through onfetch'],
  [/\bimportScripts\b/, 'imports scripts'],
  [/\bindexedDB\b/, 'uses IndexedDB'],
  [/\bXMLHttpRequest\b/, 'uses XMLHttpRequest'],
  [/\bWebSocket\b/, 'opens a WebSocket'],
  [/\blocalStorage\b/, 'uses localStorage'],
  [/\bsessionStorage\b/, 'uses sessionStorage'],
  [/\.on[a-z]+\s*=(?!=)/, 'assigns an event handler property'],
  [/\bclients\s*\.\s*claim\b/, 'takes control of open pages (clients.claim)'],
])
// push and notificationclick (B6), and the offline app shell's install, activate, fetch and message
// (docs/OFFLINE-CONTRACT.md 2.12, amendment A5).
const WORKER_EVENTS = new Set(['push', 'notificationclick', 'install', 'activate', 'fetch', 'message'])
const REQUIRED_WORKER_EVENTS = ['push', 'notificationclick']
const SHELL_PREFIX_DECLARATION = "const SHELL_PREFIX = 'health-id-shell-'"
const API_GUARD = "startsWith('/api/')"
const MESSAGE_TYPE = 'event.data?.type'
// The file list the build writes into sw.js (vite.config.ts, hidShellManifest).
const SHELL_MANIFEST = /self\.__HID_SHELL__ = (.*)$/gm
const SHELL_FILE = /^(?:assets\/[A-Za-z0-9][A-Za-z0-9_.-]*|health-id\.webmanifest|icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png)$/
const TEXT_FILE = /\.(?:html|js|css|svg)$/
const GOOGLE_SIGN_IN = /accounts\.google\.com|\.apps\.googleusercontent\.com|\bgoogle\.accounts\.id\b|\/gsi\/client\b/

// hid-system's index.html allow-list, copied from health-id-artifact.mjs at
// hid-system main 51047e2 (unchanged at 585ef8d). It depends on the HTML and
// the file list only, not on the host or environment. The shell is the one
// Vite writes for Health-id: doctype, html, head with meta charset/viewport/
// robots, title, one module entry script, modulepreload and stylesheet links,
// comments, and a body with the root div, loading code and styles only from
// the build's own /assets/. Anything it cannot parse exactly is refused. A new
// element or meta name (theme-color, for example) needs hid-system to widen
// its SHELL_ELEMENTS first, then this copy.
const SHELL_TOKEN = new RegExp([
  '(?<comment><!--(?:[^<>!-]|-(?!-))*-->)',
  '(?<doctype><!doctype html>)',
  '<\\/(?<close>[a-z][a-z0-9]*)\\s*>',
  '<(?<open>[a-z][a-z0-9]*)(?<attributes>(?:\\s+[^\\s"\'<>\\/=]+(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'=<>`]+))?)*)\\s*(?<selfClosing>\\/?)>',
  '(?<text>[^<]+)',
].join('|'), 'iy')
const SHELL_ATTRIBUTE = /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y
const CROSS_ORIGIN = /^(?:|anonymous)$/
const SHELL_ELEMENTS = Object.freeze({
  html: Object.freeze({ allowed: { lang: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/ }, required: [] }),
  head: Object.freeze({ allowed: {}, required: [] }),
  title: Object.freeze({ allowed: {}, required: [] }),
  body: Object.freeze({ allowed: {}, required: [] }),
  div: Object.freeze({ allowed: { id: /^root$/ }, required: ['id'] }),
  meta: Object.freeze({ allowed: { charset: /^utf-8$/i, name: /^(?:viewport|robots|theme-color)$/, content: /^[^<>]*$/ }, required: [] }),
  script: Object.freeze({ allowed: { type: /^module$/, crossorigin: CROSS_ORIGIN, src: 'asset' }, required: ['type', 'src'] }),
  link: Object.freeze({ allowed: { rel: /^(?:modulepreload|stylesheet|icon|apple-touch-icon|manifest)$/, crossorigin: CROSS_ORIGIN, href: 'asset',
    type: /^image\/png$/, sizes: /^\d{1,4}x\d{1,4}$/ }, required: ['rel', 'href'] }),
})
const VOID_ELEMENTS = new Set(['meta', 'link'])
const CLOSED_ELEMENTS = new Set(['html', 'head', 'title', 'body', 'div', 'script'])
const ASSET_EXTENSION = Object.freeze({ script: '.js', modulepreload: '.js', stylesheet: '.css' })

function parseShellAttributes(source) {
  const attributes = new Map()
  const duplicates = []
  let position = 0
  while (position < source.length) {
    SHELL_ATTRIBUTE.lastIndex = position
    const match = SHELL_ATTRIBUTE.exec(source)
    if (!match) return { attributes, duplicates, unparsed: source.slice(position) }
    const name = match[1].toLowerCase()
    if (attributes.has(name)) duplicates.push(name)
    else attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
    position = SHELL_ATTRIBUTE.lastIndex
  }
  return { attributes, duplicates, unparsed: '' }
}

function checkShellElement(name, attributes, paths, refuse) {
  const rule = SHELL_ELEMENTS[name]
  for (const [attribute, value] of attributes) {
    const allowed = rule.allowed[attribute]
    if (allowed === undefined) {
      refuse(`has <${name} ${attribute}=…>; the ${attribute} attribute is not part of the Vite shell`)
    } else if (allowed !== 'asset' && !allowed.test(value)) {
      refuse(`has <${name} ${attribute}=${JSON.stringify(value)}>, which the Vite shell does not use`)
    }
  }
  for (const attribute of rule.required) {
    if (!attributes.has(attribute)) refuse(`has a <${name}> without ${attribute}`)
  }
  if (name === 'meta') {
    const keys = [...attributes.keys()].sort().join(',')
    if (keys !== 'charset' && keys !== 'content,name') refuse('has a <meta> that is neither a charset nor a viewport, robots or theme-color name')
    if (attributes.get('name') === 'theme-color' && !/^#[0-9a-f]{6}$/i.test(attributes.get('content') ?? '')) {
      refuse('has a theme-color that is not a #rrggbb colour')
    }
  }
  const reference = name === 'script' ? attributes.get('src') : name === 'link' ? attributes.get('href') : undefined
  if (reference === undefined) return
  // The icons and the manifest, each only from its own fixed file in the build (PUBLIC_FILES).
  const rel = name === 'link' ? attributes.get('rel') : undefined
  if (rel === 'icon' || rel === 'apple-touch-icon' || rel === 'manifest') {
    const file = reference.slice(1)
    if (!reference.startsWith('/') || PUBLIC_FILES[file] !== rel || !paths.includes(file)) {
      refuse(`links ${reference} as ${rel}, which is not the build's own ${rel} file`)
    }
    return
  }
  if (name === 'link' && (attributes.has('type') || attributes.has('sizes'))) refuse(`has a ${rel} link with type or sizes, which only an icon link takes`)
  const extension = ASSET_EXTENSION[name === 'script' ? 'script' : attributes.get('rel')]
  if (!reference.startsWith('/assets/') || !paths.includes(reference.slice(1))) {
    refuse(`loads ${reference} from outside its own /assets/ files`)
  } else if (extension !== undefined && !reference.endsWith(extension)) {
    refuse(`loads ${reference} as a ${name === 'script' ? 'script' : attributes.get('rel')}, which must be a ${extension} file`)
  }
}

function inspectIndexHtml(html, paths, failures) {
  const refuse = reason => failures.push(`index.html ${reason}`)
  let doctype = false
  let scripts = 0
  let position = 0
  while (position < html.length) {
    SHELL_TOKEN.lastIndex = position
    const match = SHELL_TOKEN.exec(html)
    if (!match) {
      refuse(`has markup outside the Vite shell at offset ${position} (${JSON.stringify(html.slice(position, position + 40))})`)
      return
    }
    position = SHELL_TOKEN.lastIndex
    const { comment, close, open, attributes: attributeSource, selfClosing, text } = match.groups
    if (match.groups.doctype !== undefined) {
      if (doctype || html.slice(0, match.index).trim() !== '') refuse('has a doctype that is not its first token')
      doctype = true
      continue
    }
    if (text !== undefined) {
      if (text.trim() !== '') refuse(`has text outside <title> (${JSON.stringify(text.trim().slice(0, 40))})`)
      continue
    }
    if (!doctype) {
      refuse('must start with <!doctype html>')
      return
    }
    if (comment !== undefined) continue
    if (close !== undefined) {
      if (!CLOSED_ELEMENTS.has(close.toLowerCase())) refuse(`has an unexpected end tag </${close}>`)
      continue
    }
    const name = open.toLowerCase()
    if (!Object.hasOwn(SHELL_ELEMENTS, name)) {
      refuse(`has a <${name}> element, which is not part of the Vite shell`)
      continue
    }
    const { attributes, duplicates, unparsed } = parseShellAttributes(attributeSource)
    if (unparsed !== '') refuse(`has a <${name}> whose attributes cannot be parsed (${JSON.stringify(unparsed.slice(0, 40))})`)
    for (const duplicate of duplicates) refuse(`has a <${name}> with a duplicate ${duplicate} attribute`)
    if (selfClosing !== '' && !VOID_ELEMENTS.has(name)) refuse(`has a self-closing <${name}/>`)
    checkShellElement(name, attributes, paths, refuse)
    if (name === 'script' || name === 'title') {
      // Raw text (script) or escapable raw text (title) runs to the end tag.
      const end = html.slice(position).search(name === 'script' ? /<\/script[\s/>]/i : /<\/title[\s/>]/i)
      if (end === -1) {
        refuse(`has an unclosed <${name}>`)
        return
      }
      const content = html.slice(position, position + end)
      if (name === 'script') {
        scripts += 1
        if (content.trim() !== '') refuse('has an inline script; the build must load code only from /assets/')
      } else if (content.includes('<')) {
        refuse('has markup inside <title>')
      }
      position += end
    }
  }
  if (!doctype) refuse('must start with <!doctype html>')
  if (scripts !== 1) refuse(`must load exactly one entry script (a module script from its own /assets/); it has ${scripts}`)
}

async function files(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await files(path)))
    else found.push(path)
  }
  return found
}

function classify(path, failures) {
  const name = path.split('/').at(-1)
  if (/\.map$/i.test(path)) failures.push(`${path} is a source map`)
  // A worker-like name is accepted for exactly one file: sw.js at the root, the push worker (inspectServiceWorker).
  else if (/^(?:service-worker|sw|workbox)(?:[-.][^/]*)?\.js$/i.test(name) && path !== 'sw.js') failures.push(`${path} is a service worker`)
  else if ((/\.webmanifest$/i.test(name) || /^manifest(?:[-.][^/]*)?\.json$/i.test(name)) && !Object.hasOwn(PUBLIC_FILES, path)) {
    failures.push(`${path} is a web app manifest other than health-id.webmanifest`)
  } else if (path !== 'index.html' && !HASHED_ASSET.test(path) && !Object.hasOwn(PUBLIC_FILES, path)) {
    failures.push(`${path} is outside the expected set (index.html, content-hashed files under assets/ and the icon files)`)
  }
}

/** The manifest installs the portal and does nothing else: no service worker, and icons only from the build. */
function inspectManifest(source, paths, failures) {
  let manifest
  try { manifest = JSON.parse(source) } catch { failures.push('health-id.webmanifest is not JSON'); return }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) { failures.push('health-id.webmanifest is not a JSON object'); return }
  if (Object.hasOwn(manifest, 'serviceworker')) failures.push('health-id.webmanifest names a service worker')
  for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
    const file = typeof icon?.src === 'string' && icon.src.startsWith('/') ? icon.src.slice(1) : ''
    if (!MANIFEST_ICONS.has(PUBLIC_FILES[file]) || !file.endsWith('.png') || !paths.includes(file)) {
      failures.push(`health-id.webmanifest names an icon (${String(icon?.src)}) that is not one of the build's icon files`)
    }
  }
}

/**
 * Where each listener for `event` starts and ends in the worker's source (from addEventListener to its closing
 * parenthesis). Strings, template literals and comments are skipped while counting brackets; a listener whose end
 * cannot be found runs to the end of the file.
 */
function listenerSpans(source, event) {
  const spans = []
  for (const found of source.matchAll(new RegExp(`addEventListener\\s*\\(\\s*(['"\`])${event}\\1`, 'g'))) {
    const start = found.index
    let depth = 0
    let end = source.length
    for (let index = source.indexOf('(', start); index >= 0 && index < source.length; index += 1) {
      const character = source[index]
      if (character === '/' && source[index + 1] === '/') index = source.indexOf('\n', index)
      else if (character === '/' && source[index + 1] === '*') index = source.indexOf('*/', index) + 1
      else if (character === "'" || character === '"' || character === '`') {
        for (index += 1; index < source.length && source[index] !== character; index += source[index] === '\\' ? 2 : 1) { /* inside a string */ }
      } else if (character === '(' || character === '{' || character === '[') depth += 1
      else if (character === ')' || character === '}' || character === ']') {
        depth -= 1
        if (depth === 0) {
          end = index + 1
          break
        }
      }
    }
    spans.push({ start, end })
  }
  return spans
}

const within = (spans, index) => spans.some(span => index >= span.start && index < span.end)

/**
 * The Cache API, only as the app shell uses it: caches opened by the health-id-shell- prefix, names listed only through
 * that prefix, a saved file read only from one named cache, and caches deleted only by a name from that list.
 */
function inspectCacheUse(source, failures) {
  const uses = [...source.matchAll(/\bcaches\b/g)]
  if (uses.length === 0) return
  if (!source.includes(SHELL_PREFIX_DECLARATION)) failures.push(`sw.js uses the Cache API without ${SHELL_PREFIX_DECLARATION}`)
  for (const use of uses) {
    const rest = source.slice(use.index)
    const call = /^caches\s*\.\s*(open|keys|match|delete)\s*\(\s*/.exec(rest)
    const argument = call ? rest.slice(call[0].length) : ''
    if (!call) failures.push('sw.js uses the Cache API other than to open, list, read or delete a shell cache')
    else if (call[1] === 'open' && !/^SHELL_PREFIX\s*\+/.test(argument)) {
      failures.push(`sw.js opens a cache whose name does not start with health-id-shell- (caches.open(${argument.split(')')[0]}))`)
    } else if (call[1] === 'keys' && !/^\)\)\s*\.filter\(\s*name\s*=>\s*name\.startsWith\(SHELL_PREFIX\)\)/.test(argument)) {
      failures.push('sw.js lists caches without keeping only health-id-shell- ones')
    } else if (call[1] === 'match' && !/^[A-Za-z_$][\w$]*\s*,\s*\{\s*cacheName:\s*[A-Za-z_$][\w$]*\s*\}\s*\)/.test(argument)) {
      failures.push('sw.js reads from the Cache API other than from one named shell cache')
    } else if (call[1] === 'delete' && !/^[A-Za-z_$][\w$]*\s*\)/.test(argument)) {
      failures.push('sw.js deletes a cache other than by a name from the shell list')
    }
  }
}

/** The shell's file list the build wrote: null, or this build's own files (vite.config.ts, hidShellManifest). */
function inspectShellManifest(source, paths, failures) {
  const written = [...source.matchAll(SHELL_MANIFEST)]
  if (written.length !== 1) {
    failures.push(`sw.js must set self.__HID_SHELL__ exactly once; it does ${written.length} times`)
    return
  }
  let shell
  try { shell = JSON.parse(written[0][1]) } catch { failures.push('sw.js sets self.__HID_SHELL__ to something other than JSON'); return }
  if (shell === null) return
  const keys = shell && typeof shell === 'object' && !Array.isArray(shell) ? Object.keys(shell).sort().join(',') : ''
  if (keys !== 'assets,build,debug,environment' || !/^[0-9a-f]{16}$/.test(shell.build) || typeof shell.environment !== 'string'
    || typeof shell.debug !== 'boolean' || !Array.isArray(shell.assets)) {
    failures.push('sw.js has a shell file list that is not { build, environment, debug, assets }')
    return
  }
  if (shell.debug && shell.environment === 'production') failures.push('sw.js is a production build with the offline debug panel on')
  for (const asset of shell.assets) {
    const file = typeof asset === 'string' && asset.startsWith('/') ? asset.slice(1) : ''
    if (!SHELL_FILE.test(file) || !paths.includes(file)) failures.push(`sw.js would keep ${String(asset)}, which is not one of the build's own files`)
  }
}

/**
 * The worker (B6 push, and the offline app shell). Push shows a fixed notification and opens Notifications. The
 * shell keeps only the build's own files in health-id-shell- caches, never handles the API, saves nothing at install,
 * reads only a message's type, and takes over only when a page asks. Neither uses storage, IndexedDB or other
 * connections, or imports a script.
 */
function inspectServiceWorker(source, paths, failures) {
  for (const [pattern, reason] of WORKER_REFUSALS) {
    if (pattern.test(source)) failures.push(`sw.js ${reason}`)
  }
  const listened = [...source.matchAll(/addEventListener\s*\(\s*(?:(['"`])([^'"`]*)\1|([^,)]*))/g)].map(match => match[2] ?? `(${match[3].trim()})`)
  for (const event of listened) {
    if (!WORKER_EVENTS.has(event)) failures.push(`sw.js listens for ${event}; only ${[...WORKER_EVENTS].join(', ')} are allowed`)
  }
  for (const event of REQUIRED_WORKER_EVENTS) {
    if (!listened.includes(event)) failures.push(`sw.js does not listen for ${event}`)
  }
  if (!source.includes("'/notifications'")) failures.push("sw.js does not open '/notifications'")

  // The API is never handled or kept: the one mention of it is the guard that lets its requests pass.
  if (!source.includes(API_GUARD)) failures.push(`sw.js lacks the ${API_GUARD} guard that keeps API requests out of the worker`)
  const code = source.replace(SHELL_MANIFEST, '')
  if (/\/api\b/.test(code.replaceAll(API_GUARD, '').replaceAll("path === '/api'", ''))) {
    failures.push('sw.js names an /api/ path other than in its exclusion guard')
  }

  const message = listenerSpans(source, 'message')
  for (const read of source.matchAll(/\.data\b/g)) {
    const typeRead = source.startsWith(MESSAGE_TYPE, read.index - 'event'.length)
    if (!typeRead || !within(message, read.index)) failures.push(`sw.js reads a message's or push's data other than ${MESSAGE_TYPE} in its message listener`)
  }
  for (const call of source.matchAll(/\bskipWaiting\b/g)) {
    if (!within(message, call.index)) failures.push('sw.js takes over from the running worker other than when a page asks (HID_SKIP_WAITING)')
  }
  for (const span of listenerSpans(source, 'install')) {
    if (/\bcaches\b|\bfetch\s*\(|\bskipWaiting\b|waitUntil/.test(source.slice(span.start, span.end))) {
      failures.push('sw.js does work at install; the shell is saved only when a page asks (HID_SHELL_ENABLE)')
    }
  }
  for (const event of ['push', 'notificationclick']) {
    for (const span of listenerSpans(source, event)) {
      if (/\bcaches\b|\bfetch\s*\(/.test(source.slice(span.start, span.end))) failures.push(`sw.js uses the network or the Cache API on ${event}`)
    }
  }
  inspectCacheUse(source, failures)
  inspectShellManifest(source, paths, failures)
}

/**
 * A chunk allowed the worker API registers /sw.js and nothing else: pushDevice's always registers it; the shell's
 * may not, where the build has offline off and only its purge is kept.
 */
function inspectWorkerApiChunk(path, source, failures) {
  const registered = [...source.matchAll(/\.register\s*\(\s*(?:(['"`])([^'"`]*)\1|([^,)]*))/g)].map(match => match[2] ?? `(${match[3].trim()})`)
  if (path.startsWith('assets/pushDevice-') && !registered.includes('/sw.js')) failures.push(`${path} does not register /sw.js`)
  for (const script of registered) {
    if (script !== '/sw.js') failures.push(`${path} registers ${script}; only /sw.js may be registered`)
  }
}

let paths
try {
  paths = (await files(dist)).map(path => relative(dist, path).split(sep).join('/')).sort()
} catch {
  process.stdout.write(`No build at ${relative(root, dist)}: run npm run build:patient-web first.\n`)
  process.exit(1)
}

const failures = []
// The offline debug panel (VITE_HID_OFFLINE_DEBUG) is for staging builds only (docs/OFFLINE-CONTRACT.md 2.3).
if (process.env.VITE_HID_OFFLINE_DEBUG === 'true' && process.env.VITE_HID_ENVIRONMENT === 'production') {
  failures.push('the build environment turns the offline debug panel on for production')
}
if (!paths.includes('index.html')) failures.push('index.html is missing at the build root')
for (const path of paths) {
  classify(path, failures)
  if (!TEXT_FILE.test(path)) continue
  const source = await readFile(join(dist, path), 'utf8')
  if (/sourceMappingURL\s*=/.test(source)) failures.push(`${path} references a source map`)
  if (path.endsWith('.js') && /\bserviceWorker\b/.test(source)) {
    if (WORKER_API_CHUNK.test(path)) inspectWorkerApiChunk(path, source, failures)
    else failures.push(`${path} registers a service worker`)
  }
  if (path === 'sw.js') inspectServiceWorker(source, paths, failures)
  if (GOOGLE_SIGN_IN.test(source)) {
    failures.push(`${path} carries Google sign-in (Google Identity Services or a Google OAuth client id)`)
  }
  if (path === 'index.html') inspectIndexHtml(source, paths, failures)
}
if (paths.includes('health-id.webmanifest')) inspectManifest(await readFile(join(dist, 'health-id.webmanifest'), 'utf8'), paths, failures)

if (failures.length > 0) {
  process.stdout.write(`\nLaunch build check failed (${failures.length}):\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`Launch build check: ${paths.length} files; no Google sign-in, source map, or file outside assets/ but the icon files, their manifest and the push worker; no service worker but sw.js, which shows a fixed notification and keeps only the build's own app shell, registered only by pushDevice's and the shell's chunks; index.html is the Vite shell with its icon links.\n`)
