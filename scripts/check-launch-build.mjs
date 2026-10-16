#!/usr/bin/env node
/**
 * Launch build check for the patient portal.
 *
 * hid-system's staging step (infra/cloudflare/scripts/health-id-artifact.mjs,
 * `inspectHealthIdBuild`) refuses a Health-id build that carries Google
 * sign-in, a service worker, a web app manifest, a source map, or a file
 * outside index.html and content-hashed assets. This runs those rules over
 * apps/patient-web/dist, so a build that staging would refuse fails here
 * first. Google sign-in is off at launch: build without
 * VITE_HID_GOOGLE_CLIENT_ID.
 *
 * Not checked here: the public environment record and the index.html shell,
 * which depend on the environment and host being staged.
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
}

if (failures.length > 0) {
  process.stdout.write(`\nLaunch build check failed (${failures.length}):\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`Launch build check: ${paths.length} files; no Google sign-in, service worker, manifest or source map.\n`)
