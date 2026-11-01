#!/usr/bin/env node
/**
 * Mock Health ID gateway, for UI work only.
 *
 * Stands in for hid-system on http://localhost:3000 so the portal's patient,
 * provider and admin dashboards open signed in with sample data. Nothing here
 * is real: no auth, no storage beyond memory, no PHI. Never deploy it.
 *
 * Which workspace you get is decided by the page making the request
 * (the Referer): /provider/* gets a staff session, /admin/* an admin session,
 * anything else a patient session. Set MOCK_FACILITY=classic to see the
 * classic provider workspace instead of the blue EHR demo facility.
 *
 * Every request the mock has no answer for is answered 404 (most optional
 * cards hide on 404) and recorded in backend-needs.log next to this file, so
 * UI work that needs a backend change is logged rather than built.
 *
 * The answers themselves live in routes.mjs, shared with the in-page preview.
 */
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CSRF, EXPECTED_404, configure, notServed, respond, workspaceFor } from './routes.mjs'

const PORT = Number(process.env.MOCK_PORT ?? 3000)
const HERE = dirname(fileURLToPath(import.meta.url))
const NEEDS_LOG = join(HERE, 'backend-needs.log')
configure({ facility: process.env.MOCK_FACILITY === 'classic' ? 'classic' : 'blue' })

const seen = new Set()
function logNeed(method, path, workspace) {
  const key = `${method} ${path}`
  if (seen.has(key) || EXPECTED_404.has(key)) return
  seen.add(key)
  appendFileSync(NEEDS_LOG, `${new Date().toISOString()}  ${workspace.padEnd(8)}  ${key}\n`)
  console.log(`  \x1b[33m[not mocked]\x1b[0m ${workspace} ${key}`)
}

function send(res, status, body, extraHeaders = {}) {
  const headers = { 'X-CSRF-Token': CSRF, 'Cache-Control': 'no-store', ...extraHeaders }
  if (status === 204 || body === null) { res.writeHead(status, headers); res.end(); return }
  const problem = status >= 400
  res.writeHead(status, { ...headers, 'Content-Type': problem ? 'application/problem+json' : 'application/json' })
  res.end(JSON.stringify(body))
}

writeFileSync(NEEDS_LOG, `# Endpoints the UI called that the mock gateway does not serve (started ${new Date().toISOString()})\n`)

createServer((req, res) => {
  const url = new URL(req.url, 'http://mock')
  if (!url.pathname.startsWith('/api/v1/')) return send(res, 404, { code: 'NOT_FOUND', detail: 'Not a gateway path' })
  const path = url.pathname.slice('/api/v1'.length).replace(/\/$/, '')
  const method = req.method ?? 'GET'
  req.resume() // bodies are ignored
  req.on('end', () => {
    let pagePath = ''
    try { pagePath = new URL(req.headers.referer ?? '').pathname } catch { /* no referer */ }
    const workspace = workspaceFor(path, pagePath, process.env.MOCK_ROLE)
    const hit = respond(method, path, workspace)
    if (hit) {
      console.log(`  ${workspace.padEnd(8)} ${method} ${path} → ${hit.status}`)
      return send(res, hit.status, hit.body, hit.headers)
    }
    logNeed(method, path, workspace)
    send(res, 404, notServed(method, path))
  })
}).listen(PORT, () => {
  console.log(`Mock Health ID gateway on http://localhost:${PORT} (UI work only, sample data)`)
  console.log(`Unserved endpoints are logged to ${NEEDS_LOG}`)
})
