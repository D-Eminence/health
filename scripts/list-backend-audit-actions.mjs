#!/usr/bin/env node
/**
 * Lists every audit action the Health ID backend (hid-system) writes, for
 * apps/patient-web/src/admin/__tests__/backendAuditActions.ts. Not run in CI: run it by hand against a hid-system
 * checkout at the live commit and paste the output into that file.
 *
 *   git -C ../hid-system archive <commit> services | tar -x -C /tmp/hid-services
 *   node scripts/list-backend-audit-actions.mjs /tmp/hid-services
 *
 * What it reads (services/<service>/src, tests excluded, and services/<service>/database/migrations):
 *   - `action: '<code>'` in TypeScript, also as either side of a `cond ? '<code>' : '<code>'`;
 *   - a code passed straight into an audit writer: the call that encloses the literal is named like
 *     audit / record / event (auditEvent, recordAudit, recordSuccess, this.record, patientAudit, ...), or the
 *     literal is in a `const ..._AUDIT_ACTION = '<code>'` or `const ..._AUDIT_ACTIONS = [...]`;
 *   - every code inside an `insert into audit.events ... ;` statement (SQL migrations, SQL text in TypeScript, and
 *     the one-off services/<service>/scripts/*.mjs that write audit rows), every code passed to an SQL audit helper
 *     (identity.share_audit(...), ...), and every `<something>action<something> := '<code>'` in SQL;
 *   - the codes built from a template, listed in TEMPLATES below with the values the backend allows.
 * Request-log rows (api.<handler name> from the @AuditAction decorators, written by audit.interceptor.ts) are counted
 * apart: the support console shows them as "A request to Health ID" and they are not filterable.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/list-backend-audit-actions.mjs <hid-system checkout or archive with services/>')
  process.exit(2)
}

const CODE = /^(?:admin|audit|auth|commercial|ehr|identity|lab|ocr|outreach|pharmacy|security)\.[a-z0-9][a-z0-9_.-]*[a-z0-9]$/
// A code with one dot is mostly a schema.table name; these are the audit actions with one dot. A new one is warned of.
const TWO_PART_ACTIONS = new Set(['auth.login', 'auth.logout', 'auth.refresh', 'security.authorization'])
const isCode = value => CODE.test(value) && (value.split('.').length > 2 || TWO_PART_ACTIONS.has(value))

/** Codes built from a template; each value is what the backend allows there (its DTO, type or check constraint). */
const TEMPLATES = {
  // identity-api admin.service.ts: AdminFacilityStatusDto, AdminPrincipalStatusDto, AdminPlatformRoleDto.
  'admin.facility.${input.status}': ['verified', 'rejected', 'suspended'],
  'admin.account.${input.status}': ['active', 'disabled'],
  'admin.platform-role.${input.action}': ['grant', 'revoke'],
  // identity-api integration-admin.service.ts: enable | pause | configure, and select | fallback.
  'admin.integration.${action}': ['enable', 'pause', 'configure', 'select', 'fallback'],
  // ehr-api staff-chat-history.service.ts: the run(...) calls.
  'ehr.staff.chat.${action}': ['start', 'context.read', 'history.save', 'history.read', 'history.clear', 'history.bindings.read'],
  // identity-api patient-self.service.ts: read(operation: 'profile' | 'access-history' | 'authorize').
  'identity.patient.self.${operation}': ['profile', 'access-history', 'authorize'],
  // lab-api lab-accessions.service.ts transition(operation: 'collect' | 'receive' | 'reject').
  'lab.specimen.${operation}': ['collect', 'receive', 'reject'],
  // lab-api lab-executions.service.ts: verify | release.
  'lab.result.${operation}': ['verify', 'release'],
  // migrations 0005/0009: 'ehr.document.scan.' || requested_event_type (0004's check constraint), and the replay.
  "'ehr.document.scan.' ||": ['scan_started', 'clean', 'rejected', 'failed'],
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '__tests__', 'test', 'tests'].includes(entry.name)) walk(full, out)
    } else out.push(full)
  }
  return out
}

const services = path.join(root, 'services')
const tsFiles = walk(services).filter(file => /\/src\//.test(file) && file.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(file))
const sqlFiles = walk(services).filter(file => /\/database\/migrations\/[^/]+\.sql$/.test(file))
const scriptFiles = walk(services).filter(file => /\/scripts\/[^/]+\.mjs$/.test(file) && !/\/(?:test|check)-[^/]*$/.test(file))

const actions = new Set()
const requestLog = new Set()
const LITERAL = /(['"`])([a-z][a-z0-9_.-]*)\1/g

/** Every code literal inside each `insert into audit.events ... ;` statement of this text. */
function fromAuditInserts(text, inCode = false) {
  // In TypeScript or JavaScript the SQL is a template string: the statement also ends at its closing backtick.
  for (const match of text.matchAll(inCode ? /insert\s+into\s+audit\.events\b[^;`]*/gi : /insert\s+into\s+audit\.events\b[\s\S]*?;/gi)) {
    for (const literal of match[0].matchAll(/'([a-z][a-z0-9_.-]*)'/g)) if (isCode(literal[1])) actions.add(literal[1])
  }
}

/** The name of the call whose argument list holds position `at`, or '' when none. */
function enclosingCall(text, at) {
  let depth = 0
  for (let i = at - 1; i >= 0 && i > at - 2000; i -= 1) {
    const char = text[i]
    if (char === ')') depth += 1
    else if (char === '(') {
      if (depth === 0) return /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(text.slice(Math.max(0, i - 80), i))?.[1] ?? ''
      depth -= 1
    } else if (char === ';' || char === '{' || char === '}') if (depth === 0) return ''
  }
  return ''
}

const WRITER = /(?:^|\.)(?:\w*audit\w*|record\w*|event)$/i

for (const file of tsFiles) {
  const text = fs.readFileSync(file, 'utf8')
  fromAuditInserts(text, true)
  for (const match of text.matchAll(/@AuditAction\(\s*'([^']+)'\s*\)/g)) requestLog.add(`api.${match[1]}`)
  for (const match of text.matchAll(/\baction\s*:\s*'([a-z]+\.[a-z-]+)'/g)) {
    if (CODE.test(match[1]) && !TWO_PART_ACTIONS.has(match[1])) console.error(`warning: one-dot action ${match[1]} in ${file}`)
  }
  for (const match of text.matchAll(LITERAL)) {
    const code = match[2]
    if (!isCode(code)) continue
    const before = text.slice(Math.max(0, match.index - 80), match.index)
    const callee = enclosingCall(text, match.index)
    const inList = /_AUDIT_ACTIONS\s*=\s*\[[^\]]*$/.test(text.slice(Math.max(0, match.index - 400), match.index))
    if (/\baction\s*:[^,{}()]*$/.test(before) || /_AUDIT_ACTION\s*=\s*$/.test(before) || inList
      || (callee && callee !== 'AuditAction' && WRITER.test(callee))) actions.add(code)
  }
}

for (const file of sqlFiles) {
  const text = fs.readFileSync(file, 'utf8').replace(/--[^\n]*/g, '')
  fromAuditInserts(text)
  // A code passed to an SQL audit helper (identity.share_audit(...), identity.outreach_support_audit(...), ...).
  for (const match of text.matchAll(/\b[a-z_]+\.[a-z_]*audit[a-z_]*\s*\(([\s\S]*?)\)\s*;/g)) {
    for (const literal of match[1].matchAll(/'([a-z][a-z0-9_.-]*)'/g)) if (isCode(literal[1])) actions.add(literal[1])
  }
  for (const match of text.matchAll(/\b\w*action\w*(?:\s+text)?\s*:=\s*'([a-z][a-z0-9_.-]*)'/g)) if (isCode(match[1])) actions.add(match[1])
}

for (const file of scriptFiles) fromAuditInserts(fs.readFileSync(file, 'utf8'), true)

for (const [template, values] of Object.entries(TEMPLATES)) {
  const prefix = template.startsWith("'") ? template.slice(1, template.indexOf("'", 1)) : template.slice(0, template.indexOf('${'))
  for (const value of values) actions.add(`${prefix}${value}`)
}

const sorted = [...actions].sort()
console.log(`// ${sorted.length} actions; ${requestLog.size} request-log names (api.*) not listed.`)
for (const code of sorted) console.log(`  '${code}',`)
