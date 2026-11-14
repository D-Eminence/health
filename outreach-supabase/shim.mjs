/**
 * Runs before the portal (outreach-supabase/vite.config.ts): opens the provider workspace as Outreach on its own and
 * answers every /api/v1 call from Supabase (gateway.mjs) instead of the Health ID gateway.
 */
import { respond } from './gateway.mjs'

window.__HID_PREVIEW_PRODUCT__ = 'outreach'
if (!window.location.pathname.startsWith('/provider')) {
  window.history.replaceState(null, '', `/provider/outreach${window.location.search}${window.location.hash}`)
}
const CSRF = 'outreach-supabase'
try { document.cookie = `hid_access_csrf=${CSRF}; Path=/; SameSite=Lax` } catch { /* the client falls back to the response header */ }

const realFetch = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input, init)
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const path = url.pathname.slice('/api/v1'.length).replace(/\/$/, '')
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let body
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const text = typeof init.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : ''
      body = text ? JSON.parse(text) : undefined
    } catch { body = undefined }
  }
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
  let hit
  // Offline (or the database unreachable): a network error, so the screens keep the work on the phone and send it later.
  try { hit = await respond(method, path, { body, query: url.searchParams, headers }) } catch { throw new TypeError('Failed to fetch') }
  const answerHeaders = { 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' }
  if (!hit) {
    return new Response(JSON.stringify({ type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: 'Not available here' }),
      { status: 404, headers: { ...answerHeaders, 'Content-Type': 'application/problem+json' } })
  }
  const [status, payload] = hit
  if (status === 204 || payload === null) return new Response(null, { status: status === 200 ? 204 : status, headers: answerHeaders })
  return new Response(JSON.stringify(payload), { status, headers: status >= 400 ? { ...answerHeaders, 'Content-Type': 'application/problem+json' } : answerHeaders })
}
