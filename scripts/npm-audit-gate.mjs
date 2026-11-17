#!/usr/bin/env node
/**
 * Dependency audit gate: `npm audit --audit-level=high` with written, expiring exceptions.
 *
 * Fails on every high or critical advisory npm audit reports, except one listed in
 * security/npm-audit-exceptions.json that still holds. An exception holds only while:
 *   - the file is well formed (a malformed file fails the gate outright);
 *   - today is on or before its expiry date (afterwards it is ignored);
 *   - the advisory's vulnerable range is exactly the range recorded (a changed range
 *     usually means a fix exists, and needs a fresh look);
 *   - no published version of the package lies outside that range above the installed
 *     one (a fix exists: upgrade instead);
 *   - every installed package the advisory reaches is at a path the exception lists
 *     (it has not spread into something new, such as a runtime dependency).
 *
 * Run from the repository root, in CI and locally:  node scripts/npm-audit-gate.mjs
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const EXCEPTIONS_FILE = 'security/npm-audit-exceptions.json'
export const MAX_EXCEPTION_DAYS = 31
const GATED = new Set(['high', 'critical'])
const SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical'])
const ENTRY_KEYS = ['advisory', 'package', 'vulnerable_range', 'allowed_paths', 'justification', 'added', 'approved_by', 'expires']
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/
const PACKAGE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function days(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000)
}

/** Returns a list of problems; an empty list means the exceptions file is well formed. */
export function validateExceptions(data) {
  const problems = []
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return ['the file must hold a JSON object']
  const extra = Object.keys(data).filter(key => key !== 'version' && key !== 'exceptions')
  if (extra.length) problems.push('unknown top-level field(s): ' + extra.join(', '))
  if (data.version !== 1) problems.push('"version" must be 1')
  if (!Array.isArray(data.exceptions)) return [...problems, '"exceptions" must be a list']
  const seen = new Set()
  data.exceptions.forEach((entry, index) => {
    const where = 'exception ' + (index + 1)
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(where + ' must be an object')
      return
    }
    const missing = ENTRY_KEYS.filter(key => !(key in entry))
    const unknown = Object.keys(entry).filter(key => !ENTRY_KEYS.includes(key))
    if (missing.length) problems.push(where + ' is missing: ' + missing.join(', '))
    if (unknown.length) problems.push(where + ' has unknown field(s): ' + unknown.join(', '))
    if (missing.length) return
    if (typeof entry.advisory !== 'string' || !GHSA.test(entry.advisory)) problems.push(where + ': "advisory" must be a GHSA id')
    else if (seen.has(entry.advisory)) problems.push(where + ': ' + entry.advisory + ' is listed more than once')
    else seen.add(entry.advisory)
    if (typeof entry.package !== 'string' || !PACKAGE.test(entry.package)) problems.push(where + ': "package" must be an npm package name')
    if (typeof entry.vulnerable_range !== 'string' || !parseRange(entry.vulnerable_range)) {
      problems.push(where + ': "vulnerable_range" must be a range of simple comparators, as npm audit reports it')
    }
    if (!Array.isArray(entry.allowed_paths) || entry.allowed_paths.length === 0 ||
        !entry.allowed_paths.every(path => typeof path === 'string' && /^(apps\/[^/]+\/|packages\/[^/]+\/)?node_modules\/\S+$/.test(path))) {
      problems.push(where + ': "allowed_paths" must be a non-empty list of package-lock.json node paths (node_modules/...)')
    }
    for (const key of ['justification', 'approved_by']) {
      if (typeof entry[key] !== 'string' || entry[key].trim().length < (key === 'justification' ? 40 : 1)) {
        problems.push(where + ': "' + key + '" must be ' + (key === 'justification' ? 'a written justification' : 'filled in'))
      }
    }
    const datesOk = isDate(entry.added) && isDate(entry.expires)
    if (!datesOk) problems.push(where + ': "added" and "expires" must be real dates written YYYY-MM-DD')
    else if (entry.expires <= entry.added) problems.push(where + ': "expires" must be after "added"')
    else if (days(entry.added, entry.expires) > MAX_EXCEPTION_DAYS) {
      problems.push(where + ': an exception may last at most ' + MAX_EXCEPTION_DAYS + ' days from "added"')
    }
  })
  return problems
}

// --- Versions and ranges: only the comparator ranges GitHub advisories use ---------------

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text)
  return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null } : null
}

export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a
  const y = typeof b === 'string' ? parseVersion(b) : b
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] < y.parts[i] ? -1 : 1
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

/** "<=4.0.7", ">=7.0.0 <11.0.1", "<1.0.0 || >=2.0.0 <2.1.0", "*": a list of comparator sets, or null. */
export function parseRange(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const sets = []
  for (const part of text.split('||')) {
    const tokens = part.trim().split(/\s+/)
    if (tokens.length === 1 && tokens[0] === '*') {
      sets.push([])
      continue
    }
    const set = []
    for (const token of tokens) {
      const match = /^(<=|>=|<|>|=)?(.+)$/.exec(token)
      const version = match && parseVersion(match[2])
      if (!version) return null
      set.push({ op: match[1] ?? '=', version })
    }
    sets.push(set)
  }
  return sets
}

export function satisfies(version, range) {
  const v = parseVersion(version)
  const sets = typeof range === 'string' ? parseRange(range) : range
  if (!v || !sets) return false
  return sets.some(set => set.every(({ op, version: bound }) => {
    const c = compareVersions(v, bound)
    return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : c === 0
  }))
}

// --- Audit report ------------------------------------------------------------------------

function ghsaOf(advisory) {
  const match = /\/advisories\/(GHSA(?:-[0-9a-z]{4}){3})\b/.exec(String(advisory.url ?? ''))
  return match ? match[1] : null
}

/** Each advisory once, by npm's source id, and for each package the advisories its `via` chain reaches. */
export function readReport(report) {
  if (report === null || typeof report !== 'object') throw new Error('npm audit did not return a JSON object')
  if (report.error) throw new Error('npm audit reported an error: ' + (report.error.summary ?? report.error.code ?? 'unknown'))
  if (report.auditReportVersion !== 2 || report.vulnerabilities === null || typeof report.vulnerabilities !== 'object') {
    throw new Error('npm audit returned a report this gate does not understand (expected auditReportVersion 2)')
  }
  const packages = report.vulnerabilities
  const advisories = new Map()
  for (const [name, entry] of Object.entries(packages)) {
    if (!entry || !Array.isArray(entry.via) || !Array.isArray(entry.nodes) || !SEVERITIES.has(entry.severity)) {
      throw new Error('npm audit entry for ' + name + ' is not in the expected form')
    }
    for (const via of entry.via) {
      if (typeof via === 'object' && via !== null) {
        if (!SEVERITIES.has(via.severity) || typeof via.name !== 'string' || typeof via.range !== 'string') {
          throw new Error('an advisory under ' + name + ' is not in the expected form')
        }
        advisories.set(String(via.source), { source: String(via.source), ghsa: ghsaOf(via), package: via.name,
          severity: via.severity, range: via.range, title: String(via.title ?? ''), url: String(via.url ?? '') })
      } else if (typeof via !== 'string') {
        throw new Error('npm audit entry for ' + name + ' has an unexpected "via" item')
      }
    }
  }
  const memo = new Map()
  const rootsOf = (name, trail = new Set()) => {
    if (memo.has(name)) return memo.get(name)
    if (trail.has(name)) return new Set()
    trail.add(name)
    const roots = new Set()
    for (const via of packages[name]?.via ?? []) {
      if (typeof via === 'string') for (const root of rootsOf(via, trail)) roots.add(root)
      else roots.add(String(via.source))
    }
    trail.delete(name)
    memo.set(name, roots)
    return roots
  }
  const reach = new Map()
  for (const name of Object.keys(packages)) reach.set(name, rootsOf(name))
  return { packages, advisories, reach }
}

function installedVersions(lockfile, nodes) {
  return nodes.map(node => {
    const version = lockfile?.packages?.[node]?.version
    if (typeof version !== 'string' || !parseVersion(version)) throw new Error('package-lock.json has no version for ' + node)
    return version
  })
}

/**
 * The whole decision, without input or output, so tests can drive it.
 * publishedVersions(name) returns every version the registry lists, or throws.
 */
export function evaluate({ report, exceptions, lockfile, today, publishedVersions }) {
  const failures = []
  const notes = []
  const problems = validateExceptions(exceptions)
  if (problems.length) {
    return { failures: problems.map(problem => EXCEPTIONS_FILE + ' is malformed: ' + problem), notes }
  }
  let audit
  try {
    audit = readReport(report)
  } catch (error) {
    return { failures: [error.message], notes }
  }
  const byId = new Map(exceptions.exceptions.map(entry => [entry.advisory, entry]))
  const used = new Set()

  for (const [name, entry] of Object.entries(audit.packages)) {
    if (!GATED.has(entry.severity)) continue
    const gatedRoots = [...audit.reach.get(name)].filter(source => GATED.has(audit.advisories.get(source).severity))
    if (gatedRoots.length === 0) failures.push(name + ' is reported ' + entry.severity + ' but no high or critical advisory explains it')
  }

  for (const advisory of audit.advisories.values()) {
    if (!GATED.has(advisory.severity)) continue
    const label = (advisory.ghsa ?? 'npm advisory ' + advisory.source) + ' (' + advisory.severity + ', ' + advisory.package + ' ' + advisory.range + ': ' + advisory.title + ')'
    const exception = advisory.ghsa ? byId.get(advisory.ghsa) : undefined
    if (!exception) {
      failures.push(label + ' has no exception')
      continue
    }
    used.add(exception.advisory)
    if (today > exception.expires) {
      failures.push(label + ': its exception expired on ' + exception.expires + ' and is ignored')
      continue
    }
    const before = failures.length
    if (exception.package !== advisory.package) {
      failures.push(label + ': the exception names package ' + exception.package + ', the advisory is for ' + advisory.package)
    }
    if (exception.vulnerable_range !== advisory.range) {
      failures.push(label + ': the vulnerable range is now "' + advisory.range + '", the exception recorded "' +
        exception.vulnerable_range + '"; review it, a fixed version may exist')
    }
    const reached = [...audit.reach].filter(([, roots]) => roots.has(advisory.source)).map(([pkg]) => pkg)
    const outside = reached.flatMap(pkg => audit.packages[pkg].nodes).filter(node => !exception.allowed_paths.includes(node))
    if (outside.length) {
      failures.push(label + ': it now reaches path(s) the exception does not list: ' + [...new Set(outside)].sort().join(', '))
    }
    try {
      const vulnerableNodes = audit.packages[advisory.package]?.nodes ?? []
      if (vulnerableNodes.length === 0) throw new Error('npm audit lists no installed copy of ' + advisory.package)
      const installed = installedVersions(lockfile, vulnerableNodes).sort(compareVersions).at(-1)
      const fixed = publishedVersions(advisory.package)
        .filter(version => parseVersion(version)?.pre === null)
        .filter(version => !satisfies(version, advisory.range) && compareVersions(version, installed) > 0)
        .sort(compareVersions)
      if (fixed.length) {
        failures.push(label + ': ' + advisory.package + ' ' + fixed[0] + ' is published outside the vulnerable range; upgrade from ' +
          installed + ' instead of keeping the exception')
      }
    } catch (error) {
      failures.push(label + ': could not check for a fixed version (' + error.message + ')')
    }
    if (failures.length === before) {
      notes.push(label + ': excepted until ' + exception.expires + ' (approved by: ' + exception.approved_by + '; reaches ' +
        reached.sort().join(', ') + ')')
    }
  }

  for (const entry of exceptions.exceptions) {
    if (!used.has(entry.advisory)) notes.push(entry.advisory + ' is no longer reported by npm audit; remove its exception')
  }
  return { failures, notes }
}

// --- Command line ------------------------------------------------------------------------

function npm(args) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
}

function registryVersions(name) {
  if (!PACKAGE.test(name)) throw new Error('unexpected package name ' + name)
  const result = npm(['view', name, 'versions', '--json'])
  if (result.status !== 0) throw new Error('npm view ' + name + ' failed: ' + (result.stderr || '').trim().split('\n')[0])
  const versions = JSON.parse(result.stdout)
  const list = Array.isArray(versions) ? versions : [versions]
  if (!list.length || !list.every(version => typeof version === 'string')) throw new Error('npm view ' + name + ' returned no versions')
  return list
}

export function main(root = process.cwd(), today = new Date().toISOString().slice(0, 10)) {
  const out = line => process.stdout.write(line + '\n')
  let exceptions
  try {
    exceptions = JSON.parse(readFileSync(join(root, EXCEPTIONS_FILE), 'utf8'))
  } catch (error) {
    out('FAIL ' + EXCEPTIONS_FILE + ' could not be read as JSON: ' + error.message)
    return 1
  }
  let lockfile
  try {
    lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  } catch (error) {
    out('FAIL package-lock.json could not be read: ' + error.message)
    return 1
  }
  const audit = npm(['audit', '--json'])
  let report
  try {
    report = JSON.parse(audit.stdout)
  } catch {
    out('FAIL npm audit did not return JSON (exit ' + audit.status + '): ' + (audit.stderr || '').trim().split('\n')[0])
    return 1
  }
  const { failures, notes } = evaluate({ report, exceptions, lockfile, today, publishedVersions: registryVersions })
  const counts = report?.metadata?.vulnerabilities
  if (counts) out('npm audit: ' + ['critical', 'high', 'moderate', 'low'].map(level => counts[level] + ' ' + level).join(', '))
  for (const note of notes) out('NOTE ' + note)
  for (const failure of failures) out('FAIL ' + failure)
  out(failures.length ? 'Dependency audit gate failed: ' + failures.length + ' problem(s).'
    : 'Dependency audit gate passed: no high or critical advisory without a valid exception.')
  return failures.length ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main()
}
