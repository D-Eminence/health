#!/usr/bin/env node
/**
 * Repository-level architecture checks.
 *
 * ESLint sees source files one at a time. These are the checks that need a view
 * of the whole repository or of build output: what the workspace depends on,
 * what ends up in a bundle, and whether an environment file with real values
 * has been staged for commit.
 *
 * Run in CI before a deploy, and locally before committing.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'coverage'])

async function walk(directory, filter) {
  const found = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      found.push(...(await walk(join(directory, entry.name), filter)))
    } else if (filter(entry.name)) {
      found.push(join(directory, entry.name))
    }
  }

  return found
}

// ---------------------------------------------------------------------------
// 1. The browser must not depend on a database, a cloud SDK, or the backend.
// ---------------------------------------------------------------------------

/**
 * Packages that would let a frontend bypass the Health ID Gateway. Any of these
 * appearing as a dependency means the boundary has moved, not that a build
 * broke, so it fails loudly rather than being warned about.
 */
const FORBIDDEN_DEPENDENCIES = [
  '@supabase/supabase-js',
  'pg',
  'postgres',
  'mysql2',
  'knex',
  'prisma',
  '@prisma/client',
  'aws-sdk',
  '@aws-sdk/client-s3',
  '@aws-sdk/client-dynamodb',
  'mongodb',
  'redis',
  'ioredis',
]

const manifests = (await walk(root, name => name === 'package.json')).filter(
  path => !path.includes(`${sep}node_modules${sep}`),
)

for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  }

  for (const forbidden of FORBIDDEN_DEPENDENCIES) {
    if (forbidden in declared) {
      fail(
        `${relative(root, path)} depends on "${forbidden}". The browser talks to the Health ID Gateway only; ` +
          'direct database, backend or cloud SDK access from a frontend is not part of this architecture.',
      )
    }
  }
}
notes.push(`checked ${manifests.length} package manifests for forbidden dependencies`)

// ---------------------------------------------------------------------------
// 2. No backend source may be vendored into this repository.
// ---------------------------------------------------------------------------

const BACKEND_MARKERS = ['supabase/functions', 'supabase/migrations']
for (const marker of BACKEND_MARKERS) {
  try {
    await stat(join(root, marker))
    fail(
      `"${marker}" exists in this repository. The frontend is a separate project; backend code stays in the backend repository at its frozen release.`,
    )
  } catch {
    // Absent, which is correct.
  }
}

// ---------------------------------------------------------------------------
// 3. Environment files must not carry real values.
// ---------------------------------------------------------------------------

const envFiles = (await walk(root, name => name.startsWith('.env'))).filter(
  path => !path.endsWith('.example') && !path.includes(`${sep}node_modules${sep}`),
)

for (const path of envFiles) {
  notes.push(
    `${relative(root, path)} is present locally; confirm .gitignore excludes it before committing`,
  )
}

// ---------------------------------------------------------------------------
// 4. Nothing credential-shaped may reach a bundle or a source file.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  { label: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'PEM private key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { label: 'Supabase service-role key name', pattern: /SUPABASE_SERVICE_ROLE/ },
  { label: 'Stripe secret key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
]

const scanTargets = [
  ...(await walk(join(root, 'packages'), name => /\.(ts|tsx)$/.test(name))),
  ...(await walk(join(root, 'apps'), name => /\.(ts|tsx|js|css|html)$/.test(name))),
]

for (const path of scanTargets) {
  if (path.includes(`${sep}__tests__${sep}`)) continue
  const source = await readFile(path, 'utf8')

  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(source)) {
      fail(`${relative(root, path)} contains something matching a ${label}.`)
    }
  }
}
notes.push(`scanned ${scanTargets.length} source and build files for credential patterns`)

// ---------------------------------------------------------------------------
// 5. Raw fetch belongs to the transport layer only.
// ---------------------------------------------------------------------------

const TRANSPORT_FILE = join('packages', 'http', 'src', 'client.ts')
const fetchCallers = []

for (const path of scanTargets) {
  if (!/\.(ts|tsx)$/.test(path)) continue
  if (path.endsWith(TRANSPORT_FILE)) continue
  if (path.includes(`${sep}__tests__${sep}`)) continue

  const source = await readFile(path, 'utf8')
  const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let callsFetch = false
  const inspect = node => {
    if (ts.isCallExpression(node) && (
      ts.isIdentifier(node.expression) && node.expression.text === 'fetch'
      || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'fetch'
    )) callsFetch = true
    ts.forEachChild(node, inspect)
  }
  inspect(syntax)
  if (callsFetch) fetchCallers.push(relative(root, path))
}

for (const path of fetchCallers) {
  fail(
    `${path} calls fetch directly. Route the call through a service module in @hid/api so it inherits the gateway boundary.`,
  )
}

// ---------------------------------------------------------------------------

if (notes.length > 0) {
  for (const note of notes) process.stdout.write(`  · ${note}\n`)
}

if (failures.length > 0) {
  process.stdout.write(`\nArchitecture boundary check failed (${failures.length}):\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}

process.stdout.write('\nArchitecture boundaries hold.\n')
