#!/usr/bin/env node
/**
 * Live release check: after a website release, reads the live sites as any stranger's browser would and checks that
 * the words each release was meant to ship are in what the sites now serve, and that words a release removed are gone.
 *
 * Read only. It makes plain GET requests to the six sites below and to the JavaScript files they load from their own
 * address, and nothing else: no API host, no sign-in, no cookie, no Authorization header, no request body, no form, no
 * patient data. It follows a redirect only within the same site. It prints one PASS or FAIL line per expectation per
 * site and a summary.
 *
 *   npm run check:live-release                        production (the default)
 *   npm run check:live-release -- --env staging       staging
 *   npm run check:live-release -- --only ehr          one site (repeat, or comma-separate, for more)
 *   npm run check:live-release -- --disable 221-book-a-demo-gone
 *   npm run check:live-release -- --list              the expectations, and which are on
 *   node scripts/check-live-release.mjs --base-url-override ehr=http://127.0.0.1:4173
 *                                                     a local build instead of the live site (only the overridden
 *                                                     sites are checked unless --only names others)
 *
 * Exit codes: 0 when every enabled expectation passed; 1 when any failed; 2 when none failed but a site or one of its
 * files could not be read, so some expectations could not be checked (the output says which).
 *
 * How it finds the code: each site's app page (SITES[site].page) is the patient portal build (apps/patient-web, the
 * same build on every site), so its HTML names the entry script and its modulepreload files. Each JavaScript file is
 * read for the other files it can load: Vite's dynamic imports (`./Name-hash.js`) and its __vite__mapDeps list
 * (`assets/Name-hash.js`). Only files on the site's own address are read, at most MAX_FILES_PER_SITE per site, each
 * once. A site's front page ("/") is, to someone not signed in, the public site's landing page for that product
 * (infra/cloudflare/src/frontend-worker.mjs); an expectation with `where: 'front'` reads only that page's HTML, not
 * the public site's shared scripts, which carry the words of every public page.
 *
 * Updating it for a release: edit EXPECTATIONS below. Each one names the PR, the sites, the exact words as the source
 * writes them (copy them from the code: curly apostrophes stay curly), and whether they should be present or absent.
 * A minified build keeps string literals whole, but a template literal is split around each ${...}, and a constant
 * may be written into it (ACKNOWLEDGE's minutes became "30"), so pick a fixed run of words that has no ${...} in it.
 * Set `enabled: false` for one that is not due yet, and turn it on when its PR is live (or pass --enable <id>).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * The sites, by the names the team uses for them, with each one's key in config/<env>.json `hosts` and the address
 * that serves the patient portal build there to someone not signed in. On the patient portal, /sign-in (its front page
 * is the landing page); on a product site, /provider/sign-in, the staff sign-in, which is the same build.
 */
export const SITES = Object.freeze({
  app: Object.freeze({ host: 'web', page: '/sign-in' }),
  ehr: Object.freeze({ host: 'ehr', page: '/provider/sign-in' }),
  migrate: Object.freeze({ host: 'ocr', page: '/provider/sign-in' }),
  lab: Object.freeze({ host: 'lab', page: '/provider/sign-in' }),
  pharmacy: Object.freeze({ host: 'pharmacy', page: '/provider/sign-in' }),
  outreach: Object.freeze({ host: 'outreach', page: '/provider/sign-in' }),
})

const ALL_SITES = Object.freeze(Object.keys(SITES))

/**
 * What each release should have changed. Fields:
 *   id       a short name for --enable / --disable
 *   label    what the output calls it, starting with the PR
 *   sites    which of SITES to check it on
 *   text     the exact words
 *   expect   'present' or 'absent'
 *   enabled  false for one that is not due yet
 *   where    'app' (default): the app page's HTML and every script it loads; 'front': the front page's HTML only
 *   switch   for words that ship before they are switched on: how to read the switch next to them (see #227): its
 *            name, how many characters after the words to look (within), a pattern whose first group is the value
 *            (a RegExp, or a string in a JSON file), and the values that mean on
 */
export const EXPECTATIONS = Object.freeze([
  // #216: a scanned source page is deleted after 7 days, not 24 hours (apps/patient-web/src/documentSource.ts).
  { id: '216-source-7-days', label: '#216 source page deleted after 7 days', sites: ['ehr', 'migrate', 'lab'],
    text: 'Source page deleted after 7 days', expect: 'present', enabled: true },
  { id: '216-reading-7-days', label: '#216 reading deleted after 7 days', sites: ['migrate'],
    text: 'Reading deleted after 7 days', expect: 'present', enabled: true },
  // The old words are gone everywhere after #216, including the registry's description of the 410
  // (packages/contracts/src/registry.ts files.download, which #216 also changes and which is bundled).
  { id: '216-source-24-hours-gone', label: '#216 old "source page deleted after 24 hours" gone',
    sites: ['app', 'ehr', 'migrate', 'lab', 'pharmacy', 'outreach'],
    text: 'Source page deleted after 24 hours', expect: 'absent', enabled: true },
  { id: '216-reading-24-hours-gone', label: '#216 old "reading deleted after 24 hours" gone',
    sites: ['app', 'ehr', 'migrate', 'lab', 'pharmacy', 'outreach'],
    text: 'Reading deleted after 24 hours', expect: 'absent', enabled: true },

  // #229: the emergency (break-glass) notice and acknowledgement say only what is true
  // (apps/patient-web/src/ehr-blue/clinical/emergency/access.ts NOTICE_BEFORE, BreakGlass.tsx ACKNOWLEDGE).
  { id: '229-new-notice', label: '#229 new emergency notice', sites: ['ehr'],
    text: 'Emergency access opens part of this patient’s record without their approval. It is recorded with your name, this facility, the time and your reason. The patient can see that it was used, when and why. It ends by itself.',
    expect: 'present', enabled: true },
  { id: '229-new-acknowledgement', label: '#229 new emergency acknowledgement', sites: ['ehr'],
    // Up to the minutes, which come from EMERGENCY_MINUTES.
    text: 'I understand this is recorded with my name and my reason, the patient can see it, and access ends by itself after ',
    expect: 'present', enabled: true },
  { id: '229-old-notice-gone', label: '#229 old emergency notice gone', sites: ALL_SITES,
    text: 'Emergency access lets you see the emergency summary without the patient’s approval.', expect: 'absent', enabled: true },
  { id: '229-old-acknowledgement-gone', label: '#229 old emergency acknowledgement gone', sites: ALL_SITES,
    text: 'I understand the patient is told, every opening is recorded', expect: 'absent', enabled: true },

  // #227: the records-processing approval wording is switched on (apps/patient-web/src/paperRecordsWording.ts). The
  // sentence has been in the build since before #227, switched off, so finding it proves nothing: what #227 changes
  // is RECORDS_PROCESSING_GRANT = { live: false } to { live: true }, which the build writes right after the sentence's
  // function as `{live:!1}` or `{live:!0}`. The check reads that.
  { id: '227-records-processing-on', label: '#227 records-processing wording switched on', sites: ['app'],
    text: 'Each one is saved as a draft, and you will only see it after a clinician checks and signs it.',
    expect: 'present', enabled: true,
    switch: { name: 'RECORDS_PROCESSING_GRANT.live', within: 300, pattern: /\{\s*live\s*:\s*(!0|!1|true|false)\s*\}/,
      on: ['!0', 'true'] } },

  // #223: Reading quality, live since health #237 (2026-11-12).
  { id: '223-finished-weeks', label: '#223 Reading quality "finished weeks" note', sites: ['migrate'],
    text: 'Figures cover finished weeks only.', expect: 'present', enabled: true },

  // #240: Migrate says who can check a reading (apps/patient-web/src/ehr-blue/departments/migrate/Migrate.tsx CHECK_NEEDS_CHECKER).
  { id: '240-who-can-check', label: '#240 Migrate "who can check" note', sites: ['migrate'],
    text: 'A doctor, clinician, nurse or lab scientist at this facility must check and save it.', expect: 'present', enabled: true },

  // #243 (with #245): the new outreach parts on a person's page and the Outreach screen. Sentences, not the bare
  // button words: "Create Health ID" and "Print slip" are also on the pharmacy desk, so those words alone prove nothing.
  // apps/patient-web/src/ehr-blue/departments/outreach/ HealthChecks.tsx, CreateHealthId.tsx, OutreachSlip.tsx, OutreachExport.tsx.
  // Each part also hides itself when its backend route is not served, so a pass proves the code shipped, not that it shows.
  { id: '243-health-checks', label: '#243 outreach "Health checks"', sites: ['outreach'],
    text: 'Record any checks done today.', expect: 'present', enabled: true },
  { id: '243-create-health-id', label: '#243 outreach "Create Health ID"', sites: ['outreach'],
    text: 'Make their Health ID now from this registration.', expect: 'present', enabled: true },
  { id: '243-print-slip', label: '#243 outreach "Print slip"', sites: ['outreach'],
    text: 'Show this slip if you visit a clinic or come back to the outreach.', expect: 'present', enabled: true },
  { id: '243-export', label: '#243 outreach "Export"', sites: ['outreach'],
    text: 'This file contains people’s personal and health information.', expect: 'present', enabled: true },

  // Tonight's no-hassle change (released with #243 and #245): Outreach stays open with no signal. Wording as given by
  // the coordinator on 2026-11-13; re-check it against the shipped code at release.
  { id: 'nohassle-no-signal', label: 'Outreach "No signal" line', sites: ['outreach'],
    text: 'No signal. You can keep registering. Your work stays on this phone.', expect: 'present', enabled: true },

  // #221: outreach.'s front page offers organiser sign-up, not a demo. Live (checked 2026-11-12). Read on the front page's
  // HTML only: the public site's shared scripts still say "Book a demo" for the pages that keep it.
  { id: '221-book-a-demo-gone', label: '#221 "Book a demo" gone from the outreach front page', sites: ['outreach'],
    text: 'Book a demo', expect: 'absent', enabled: true, where: 'front' },
  { id: '221-start-outreach', label: '#221 "Start running outreach" on the outreach front page', sites: ['outreach'],
    text: 'Start running outreach', expect: 'present', enabled: true, where: 'front' },
])

/** At most this many JavaScript files are read from one site. */
export const MAX_FILES_PER_SITE = 200
const TIMEOUT_MS = 20000
const MAX_REDIRECTS = 5
/** A plain name for the client; it names no person. */
const USER_AGENT = 'hid-live-release-check/1 (read-only)'

/** The API's paths on a site's own address (the frontend Worker passes them to the API): never read. */
const API_PATH = /^\/api(?:\/|$)/i

const HERE = dirname(fileURLToPath(import.meta.url))

class Unreadable extends Error {}

function usage() {
  return [
    'Usage: node scripts/check-live-release.mjs [--env production|staging] [--only <site>[,<site>]]',
    '         [--enable <id>] [--disable <id>] [--base-url-override <site>=<url>] [--expectations <file.json>] [--list]',
    `Sites: ${ALL_SITES.join(', ')}`,
  ].join('\n')
}

export function parseArgs(argv) {
  const options = { env: 'production', only: [], enable: [], disable: [], overrides: {}, expectationsFile: null, list: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') && !arg.startsWith('--base-url-override=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : arg.startsWith('--base-url-override=') ? ['--base-url-override', arg.slice('--base-url-override='.length)] : [arg, undefined]
    const value = () => {
      if (inline !== undefined) return inline
      const next = argv[++i]
      if (next === undefined) throw new Error(`${flag} needs a value`)
      return next
    }
    if (flag === '--env') options.env = value()
    else if (flag === '--only') options.only.push(...value().split(',').map(s => s.trim()).filter(Boolean))
    else if (flag === '--enable') options.enable.push(value())
    else if (flag === '--disable') options.disable.push(value())
    else if (flag === '--expectations') options.expectationsFile = value()
    else if (flag === '--base-url-override') {
      const pair = value()
      const at = pair.indexOf('=')
      if (at < 1) throw new Error(`--base-url-override wants <site>=<url>, not "${pair}"`)
      options.overrides[pair.slice(0, at)] = pair.slice(at + 1)
    } else if (flag === '--list') options.list = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`Unknown option "${arg}"`)
  }
  if (options.env !== 'production' && options.env !== 'staging') throw new Error(`--env must be production or staging, not "${options.env}"`)
  for (const site of [...options.only, ...Object.keys(options.overrides)]) {
    if (!Object.hasOwn(SITES, site)) throw new Error(`Unknown site "${site}". Sites: ${ALL_SITES.join(', ')}`)
  }
  return options
}

/** Each site's origin: from config/<env>.json, or the override given for it. */
async function siteOrigins(options) {
  const config = JSON.parse(await readFile(join(HERE, '..', 'config', `${options.env}.json`), 'utf8'))
  const api = new URL(config.api_origin).origin
  const origins = {}
  for (const [site, { host }] of Object.entries(SITES)) {
    const override = options.overrides[site]
    const origin = override ? new URL(override).origin : `https://${config.hosts[host]}`
    if (!override && !/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new Error(`config/${options.env}.json has no usable host for ${site}`)
    if (origin === api) throw new Error(`${site} resolves to the API origin, which this check never reads`)
    origins[site] = origin
  }
  return origins
}

/** Which expectations run: the list, with --enable and --disable applied. */
export function chosenExpectations(list, options) {
  const ids = new Set(list.map(e => e.id))
  for (const id of [...options.enable, ...options.disable]) if (!ids.has(id)) throw new Error(`No expectation with id "${id}"`)
  return list.map(e => ({ ...e,
    enabled: options.disable.includes(e.id) ? false : options.enable.includes(e.id) ? true : e.enabled !== false }))
}

/** A GET with no cookie, no credentials and no body; redirects followed only within `origin`. */
async function fetchText(url, origin) {
  let current = new URL(url)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.origin !== origin) throw new Unreadable(`${url} redirects to another site (${current.origin}), not followed`)
    let response
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new Unreadable(`${current.href} could not be read (${error.cause?.code ?? error.name ?? 'network error'})`)
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel()
      current = new URL(response.headers.get('location'), current)
      continue
    }
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Unreadable(`${current.href} answered ${response.status}`)
    }
    return { url: current.href, text: await response.text() }
  }
  throw new Unreadable(`${url} redirects more than ${MAX_REDIRECTS} times`)
}

function attributes(tag) {
  const found = {}
  for (const match of tag.matchAll(/([a-zA-Z:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return found
}

/** The scripts an HTML page loads: <script src> and <link rel="modulepreload" href>. */
export function scriptsInHtml(html) {
  const refs = []
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const { src } = attributes(tag.slice(7, -1))
    if (src) refs.push(src)
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag.slice(5, -1))
    if (attrs.href && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('modulepreload')) refs.push(attrs.href)
  }
  return refs
}

/**
 * The other scripts a built script can load, as Vite writes them: `./Name-hash.js` or `../x/Name-hash.js` (relative
 * to the script), `/assets/Name-hash.js` (the site's root) and `assets/Name-hash.js` in __vite__mapDeps (relative to
 * the site's root, Vite's base). Anything else that merely ends in .js is not taken for a file.
 */
export function scriptsInScript(code) {
  const refs = []
  for (const match of code.matchAll(/["'`]((?:\.{1,2}\/|\/|assets\/)[A-Za-z0-9_@~./-]*\.m?js)["'`]/g)) refs.push(match[1])
  return refs
}

function resolveScript(ref, from, origin) {
  if (/^assets\//.test(ref)) return new URL(`/${ref}`, origin)
  return new URL(ref, from)
}

/** Reads a site's app page and every script it can load from its own address. */
async function readApp(site, origin) {
  const page = await fetchText(new URL(SITES[site].page, origin).href, origin)
  const files = [{ name: new URL(page.url).pathname, text: page.text }]
  const queue = scriptsInHtml(page.text).map(ref => new URL(ref, page.url))
  const seen = new Set()
  let otherSites = 0
  let truncated = false
  while (queue.length) {
    const url = queue.shift()
    url.hash = ''
    if (url.origin !== origin) { otherSites++; continue }
    if (API_PATH.test(url.pathname)) continue
    if (seen.has(url.href)) continue
    if (seen.size >= MAX_FILES_PER_SITE) { truncated = true; break }
    seen.add(url.href)
    const script = await fetchText(url.href, origin)
    files.push({ name: url.pathname, text: script.text })
    for (const ref of scriptsInScript(script.text)) queue.push(resolveScript(ref, url.href, origin))
  }
  return { files, scripts: seen.size, otherSites, truncated }
}

async function readFront(origin) {
  const page = await fetchText(new URL('/', origin).href, origin)
  return { files: [{ name: `${new URL(page.url).pathname} (front page HTML)`, text: page.text }], scripts: 0, otherSites: 0, truncated: false }
}

/** The ways a build or an HTML page may write the same words. */
export function spellings(text) {
  const forms = new Set([text])
  const escaped = (upper) => text.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')[upper ? 'toUpperCase' : 'toLowerCase']()}`)
  forms.add(escaped(false))
  forms.add(escaped(true))
  forms.add(text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;'))
  forms.add(text.replace(/'/g, '&#39;'))
  forms.add(text.replace(/"/g, '\\"'))
  return [...forms]
}

function findIn(files, text) {
  for (const file of files) {
    for (const form of spellings(text)) {
      const at = file.text.indexOf(form)
      if (at !== -1) return { file, at, length: form.length }
    }
  }
  return null
}

/** One expectation on one site's files: { ok, reason }. */
export function judge(expectation, files) {
  const found = findIn(files, expectation.text)
  if (expectation.expect === 'absent') {
    return found ? { ok: false, reason: `still there, in ${found.file.name}` } : { ok: true, reason: `not found in ${files.length} file(s)` }
  }
  if (!found) return { ok: false, reason: `not found in ${files.length} file(s)` }
  if (!expectation.switch) return { ok: true, reason: `found in ${found.file.name}` }
  const rule = expectation.switch
  const after = found.file.text.slice(found.at + found.length, found.at + found.length + rule.within)
  const match = (rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern)).exec(after)
  if (!match) {
    return { ok: false, reason: `the words are in ${found.file.name}, but ${rule.name} could not be read next to them, `
      + 'so this proves only that the code shipped, not that it is switched on' }
  }
  return rule.on.includes(match[1])
    ? { ok: true, reason: `found in ${found.file.name}, and ${rule.name} is on (${match[0].replace(/\s+/g, '')})` }
    : { ok: false, reason: `found in ${found.file.name}, but ${rule.name} is off (${match[0].replace(/\s+/g, '')}): the code shipped, switched off` }
}

export async function main(argv, out = line => process.stdout.write(`${line}\n`)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    out(`${error.message}\n${usage()}`)
    return 2
  }
  if (options.help) { out(usage()); return 0 }

  let list = EXPECTATIONS
  if (options.expectationsFile) list = JSON.parse(await readFile(options.expectationsFile, 'utf8'))
  let expectations
  try {
    expectations = chosenExpectations(list, options)
  } catch (error) {
    out(error.message)
    return 2
  }
  if (options.list) {
    for (const e of expectations) out(`${e.enabled ? 'on ' : 'off'}  ${e.id}  ${e.label}  [${e.expect}, ${e.sites.join(' ')}${e.where === 'front' ? ', front page' : ''}]`)
    return 0
  }

  const origins = await siteOrigins(options)
  const overridden = Object.keys(options.overrides)
  const sites = options.only.length ? options.only : overridden.length ? overridden : ALL_SITES
  out(`Live release check, ${overridden.length ? 'local override' : options.env}: ${sites.map(s => `${s} (${origins[s]})`).join(', ')}`)

  let passed = 0
  let failed = 0
  let unchecked = 0
  const unreadable = []
  for (const site of sites) {
    const mine = expectations.filter(e => e.enabled && e.sites.includes(site))
    if (!mine.length) continue
    const reads = {}
    for (const where of new Set(mine.map(e => e.where ?? 'app'))) {
      try {
        reads[where] = where === 'front' ? await readFront(origins[site]) : await readApp(site, origins[site])
        const r = reads[where]
        if (where === 'app') {
          out(`read  ${site.padEnd(9)} ${r.scripts} script(s) from ${origins[site]}${r.otherSites ? `, ${r.otherSites} on other sites not read` : ''}`)
        }
        if (where === 'app' && r.scripts === 0) {
          // A page with none of its own scripts is not the app page (a maintenance or challenge page, say).
          // Without this, every absent check on it would pass while checking nothing.
          unreadable.push(`${site}: ${SITES[site].page} served no script of its own, so it is not the app page`)
          reads[where] = null
          continue
        }
        if (r.truncated) {
          unreadable.push(`${site}: stopped after ${MAX_FILES_PER_SITE} scripts, so words may be in a script not read`)
          reads[where] = { ...r, partial: true }
        }
      } catch (error) {
        if (!(error instanceof Unreadable)) throw error
        unreadable.push(`${site}: ${error.message}`)
        reads[where] = null
      }
    }
    for (const e of mine) {
      const read = reads[e.where ?? 'app']
      if (!read) {
        unchecked++
        out(`SKIP  ${site.padEnd(9)} ${e.label}: not checked, the site could not be read`)
        continue
      }
      const verdict = judge(e, read.files)
      if (verdict.ok && read.partial && e.expect === 'absent') {
        unchecked++
        out(`SKIP  ${site.padEnd(9)} ${e.label}: not proven absent, not every script was read`)
        continue
      }
      if (verdict.ok) passed++
      else failed++
      out(`${verdict.ok ? 'PASS' : 'FAIL'}  ${site.padEnd(9)} ${e.label}: ${verdict.reason}`)
    }
  }
  const off = expectations.filter(e => !e.enabled).map(e => e.id)
  out('')
  for (const problem of unreadable) out(`Could not read ${problem}`)
  out(`Summary: ${passed} passed, ${failed} failed, ${unchecked} not checked.${off.length ? ` Off: ${off.join(', ')}.` : ''}`)
  if (failed) return 1
  if (unreadable.length) return 2
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    process.stdout.write(`Check stopped: ${error.message}\n`)
    process.exitCode = 2
  })
}
