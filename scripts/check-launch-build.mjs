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
  meta: Object.freeze({ allowed: { charset: /^utf-8$/i, name: /^(?:viewport|robots)$/, content: /^[^<>]*$/ }, required: [] }),
  script: Object.freeze({ allowed: { type: /^module$/, crossorigin: CROSS_ORIGIN, src: 'asset' }, required: ['type', 'src'] }),
  link: Object.freeze({ allowed: { rel: /^(?:modulepreload|stylesheet)$/, crossorigin: CROSS_ORIGIN, href: 'asset' }, required: ['rel', 'href'] }),
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
    if (keys !== 'charset' && keys !== 'content,name') refuse('has a <meta> that is neither a charset nor a viewport or robots name')
  }
  const reference = name === 'script' ? attributes.get('src') : name === 'link' ? attributes.get('href') : undefined
  if (reference === undefined) return
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
    if (name === 'link' && /^manifest$/i.test(attributes.get('rel') ?? '')) {
      refuse('links a web app manifest; the Health-id portal is not installable')
      continue
    }
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
  else if (/^(?:service-worker|sw|workbox)(?:[-.][^/]*)?\.js$/i.test(name)) failures.push(`${path} is a service worker`)
  else if (/\.webmanifest$/i.test(name) || /^manifest(?:[-.][^/]*)?\.json$/i.test(name)) {
    failures.push(`${path} is a web app manifest`)
  } else if (path !== 'index.html' && !HASHED_ASSET.test(path)) {
    failures.push(`${path} is outside the expected set (index.html and content-hashed files under assets/)`)
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
if (!paths.includes('index.html')) failures.push('index.html is missing at the build root')
for (const path of paths) {
  classify(path, failures)
  if (!TEXT_FILE.test(path)) continue
  const source = await readFile(join(dist, path), 'utf8')
  if (/sourceMappingURL\s*=/.test(source)) failures.push(`${path} references a source map`)
  if (path.endsWith('.js') && /\bserviceWorker\b/.test(source)) failures.push(`${path} registers a service worker`)
  if (GOOGLE_SIGN_IN.test(source)) {
    failures.push(`${path} carries Google sign-in (Google Identity Services or a Google OAuth client id)`)
  }
  if (path === 'index.html') inspectIndexHtml(source, paths, failures)
}

if (failures.length > 0) {
  process.stdout.write(`\nLaunch build check failed (${failures.length}):\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`Launch build check: ${paths.length} files; no Google sign-in, service worker, manifest or source map; index.html is the Vite shell staging accepts.\n`)
