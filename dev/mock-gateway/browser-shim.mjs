/**
 * In-page mock gateway for the static preview build (dev/preview). Runs before
 * the portal: answers every /api/v1 request from routes.mjs instead of the
 * network, and adds a small bar to switch between the patient, provider and
 * admin workspaces. Never part of the real build.
 */
import { CSRF, EXPECTED_404, configure, notServed, respond, workspaceFor } from './routes.mjs'

const params = new URLSearchParams(window.location.search)
configure({ facility: params.get('facility') === 'classic' ? 'classic' : 'blue' })

// A static host serves only the page itself: there is no /provider or /admin
// file to load. So the page opens at its own address and the workspace comes
// from ?ws=patient|provider|admin, moved into the portal's route before it starts.
const ENTRY = window.location.pathname
const WORKSPACE_PATHS = { patient: '/', provider: '/provider', admin: '/admin' }
const asked = WORKSPACE_PATHS[params.get('ws') ?? 'patient'] ?? '/'
params.delete('ws')
const rest = params.toString()
window.history.replaceState(null, '', asked + (rest ? `?${rest}` : '') + window.location.hash)

// The CSRF cookies the real gateway would set (Set-Cookie can't come from a synthetic Response).
try {
  document.cookie = `hid_access_csrf=${CSRF}; Path=/; SameSite=Lax`
  document.cookie = `hid_access_admin_csrf=${CSRF}; Path=/; SameSite=Lax`
} catch { /* cookies blocked: the client falls back to the X-CSRF-Token response header */ }

const unserved = new Set()
const realFetch = window.fetch.bind(window)

window.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input, init)
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const path = url.pathname.slice('/api/v1'.length).replace(/\/$/, '')
  const workspace = workspaceFor(path, window.location.pathname)
  await new Promise(resolve => setTimeout(resolve, 120)) // a little latency, so loading states show
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const hit = respond(method, path, workspace)
  const headers = { 'X-CSRF-Token': CSRF }
  if (!hit) {
    const key = `${method} ${path}`
    if (!EXPECTED_404.has(key) && !unserved.has(key)) {
      unserved.add(key)
      console.warn(`[mock gateway] not mocked: ${workspace} ${key}`)
      renderBar()
    }
    return new Response(JSON.stringify(notServed(method, path)), { status: 404, headers: { ...headers, 'Content-Type': 'application/problem+json' } })
  }
  if (hit.status === 204 || hit.body === null) return new Response(null, { status: hit.status, headers })
  return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { ...headers, 'Content-Type': 'application/json' } })
}

// ---- workspace bar ---------------------------------------------------------
const WORKSPACES = [
  { label: 'Patient', key: 'patient', path: '/' },
  { label: 'Provider', key: 'provider', path: '/provider' },
  { label: 'Admin', key: 'admin', path: '/admin' },
]

function go(key) {
  // A full load from the page's own address, so each workspace starts its session as on a real visit.
  const next = new URLSearchParams(rest)
  next.set('ws', key)
  window.location.assign(`${ENTRY}?${next}`)
}

let bar = null
function renderBar() {
  if (!document.body) return
  if (!bar) {
    bar = document.createElement('div')
    bar.setAttribute('data-mock-bar', '')
    bar.setAttribute('role', 'navigation')
    bar.setAttribute('aria-label', 'Preview workspaces')
    const style = document.createElement('style')
    style.textContent = `
      [data-mock-bar]{position:fixed;z-index:2147483647;right:12px;bottom:12px;display:flex;gap:4px;align-items:center;
        padding:4px;border-radius:999px;background:#111827;color:#f9fafb;font:500 12px/1 system-ui,sans-serif;
        box-shadow:0 4px 16px rgba(0,0,0,.25)}
      [data-mock-bar] span{padding:0 8px 0 10px;opacity:.7}
      [data-mock-bar] button{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px}
      [data-mock-bar] button:hover{background:#374151}
      [data-mock-bar] button[aria-current="page"]{background:#f9fafb;color:#111827}
      [data-mock-bar] button:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}
      [data-mock-bar] em{font-style:normal;color:#fbbf24;padding:0 10px 0 4px;cursor:help}
      @media (max-width:900px){[data-mock-bar]{bottom:calc(84px + env(safe-area-inset-bottom,0px));right:8px;font-size:11px}[data-mock-bar] span{display:none}[data-mock-bar] button{padding:6px 10px}}
      @media print{[data-mock-bar]{display:none}}`
    document.head.appendChild(style)
    document.body.appendChild(bar)
  }
  const here = window.location.pathname
  const current = here.startsWith('/admin') ? '/admin' : here.startsWith('/provider') ? '/provider' : '/'
  bar.replaceChildren()
  const tag = document.createElement('span')
  tag.textContent = 'Sample data'
  bar.appendChild(tag)
  for (const ws of WORKSPACES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = ws.label
    if (ws.path === current) b.setAttribute('aria-current', 'page')
    b.addEventListener('click', () => go(ws.key))
    bar.appendChild(b)
  }
  if (unserved.size) {
    const needs = document.createElement('em')
    needs.textContent = `${unserved.size} not mocked`
    needs.title = 'Backend needs (also in the console):\n' + [...unserved].join('\n')
    bar.appendChild(needs)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBar)
else renderBar()
window.addEventListener('popstate', renderBar)
for (const method of ['pushState', 'replaceState']) {
  const original = window.history[method].bind(window.history)
  window.history[method] = (...args) => { const out = original(...args); queueMicrotask(renderBar); return out }
}
