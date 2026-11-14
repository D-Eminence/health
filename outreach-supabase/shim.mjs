/**
 * Runs before the portal (outreach-supabase/vite.config.ts): opens the provider workspace as Outreach on its own and
 * answers every /api/v1 call from Supabase (gateway.mjs) instead of the Health ID gateway.
 */
import { choosePerson, needsPerson, respond, teamPeople } from './gateway.mjs'

window.__HID_PREVIEW_PRODUCT__ = 'outreach'
if (!window.location.pathname.startsWith('/provider')) {
  window.history.replaceState(null, '', `/provider/outreach${window.location.search}${window.location.hash}`)
}
const CSRF = 'outreach-supabase'

// Keep the app on the phone so it opens with no signal (outreach-sw.js, made at build time).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => { navigator.serviceWorker.register('/outreach-sw.js').catch(() => {}) }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}
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
  try {
    hit = await respond(method, path, { body, query: url.searchParams, headers })
    // Signed in with the team code: the person says who they are before the app goes on.
    if (hit?.[0] === 200 && (path === '/auth/login' || path === '/auth/session') && needsPerson()) {
      const picked = await askWhoYouAre()
      hit = picked ? await respond('GET', '/auth/session', { headers }) : await respond('POST', '/auth/logout', { headers }).then(() => [401, { type: 'about:blank', title: 'UNAUTHENTICATED', status: 401, code: 'UNAUTHENTICATED', detail: 'Sign in' }])
    }
  } catch { throw new TypeError('Failed to fetch') }
  const answerHeaders = { 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' }
  if (!hit) {
    return new Response(JSON.stringify({ type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: 'Not available here' }),
      { status: 404, headers: { ...answerHeaders, 'Content-Type': 'application/problem+json' } })
  }
  const [status, payload] = hit
  if (status === 204 || payload === null) return new Response(null, { status: status === 200 ? 204 : status, headers: answerHeaders })
  return new Response(JSON.stringify(payload), { status, headers: status >= 400 ? { ...answerHeaders, 'Content-Type': 'application/problem+json' } : answerHeaders })
}

/**
 * "Who are you?": everyone on the organisation's teams as big buttons (a search box when the list is long). Resolves
 * true once a name is tapped, false for "Use a different team code".
 */
let asking = null
function askWhoYouAre() {
  if (asking) return asking
  asking = new Promise(resolve => {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    const ink = dark ? '#f5f5f5' : '#111111', ink2 = dark ? '#b3b3b3' : '#555555', line = dark ? '#333333' : '#d9d9d9'
    const bg = dark ? '#000000' : '#ffffff', brand = dark ? '#5b9cff' : '#1a5fd6'
    const root = document.createElement('div')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-labelledby', 'outreach-who-title')
    root.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:${bg};color:${ink};overflow:auto;font-family:Inter,system-ui,sans-serif`
    root.innerHTML = `<div style="max-width:32rem;margin:0 auto;padding:32px 16px 48px">
      <h1 id="outreach-who-title" tabindex="-1" style="margin:0 0 4px;font-size:26px;line-height:1.25;font-weight:650;outline:none">Who are you?</h1>
      <p style="margin:0 0 16px;font-size:15px;color:${ink2}">Tap your name. What you capture is recorded against it.</p>
      <label id="outreach-who-search-wrap" style="display:none;margin-bottom:12px"><span style="display:block;font-size:14px;margin-bottom:6px">Find your name</span>
        <input id="outreach-who-search" type="search" autocomplete="off" style="box-sizing:border-box;width:100%;height:48px;border-radius:12px;border:1px solid ${line};padding:0 14px;font-size:16px;background:${bg};color:${ink}"></label>
      <ul id="outreach-who-list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px"><li style="color:${ink2};font-size:15px">Loading the team…</li></ul>
      <button id="outreach-who-back" type="button" style="margin-top:20px;min-height:44px;border:0;background:none;color:${brand};font-size:15px;font-weight:600;padding:0 4px;cursor:pointer">Use a different team code</button>
    </div>`
    document.body.appendChild(root)
    const list = root.querySelector('#outreach-who-list')
    const search = root.querySelector('#outreach-who-search')
    const finish = answer => { root.remove(); asking = null; resolve(answer) }
    root.querySelector('#outreach-who-back').addEventListener('click', () => finish(false))
    root.querySelector('#outreach-who-title').focus()
    let people = []
    const draw = () => {
      const term = search.value.trim().toLowerCase()
      const shown = people.filter(entry => !term || String(entry.name).toLowerCase().includes(term))
      list.replaceChildren()
      if (!shown.length) {
        const empty = document.createElement('li')
        empty.style.cssText = `color:${ink2};font-size:15px`
        empty.textContent = people.length ? 'No name matches. Check the spelling.' : 'No one is on a team yet. Ask your coordinator to add you under Team.'
        list.appendChild(empty)
        return
      }
      for (const entry of shown) {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.style.cssText = `box-sizing:border-box;width:100%;min-height:56px;text-align:left;border:1px solid ${line};border-radius:12px;background:${bg};color:${ink};padding:10px 14px;cursor:pointer;font:inherit`
        const name = document.createElement('span')
        name.style.cssText = 'display:block;font-size:16px;font-weight:600'
        name.textContent = entry.name
        button.appendChild(name)
        if (entry.campaigns.length) {
          const where = document.createElement('span')
          where.style.cssText = `display:block;font-size:13px;color:${ink2};margin-top:2px`
          where.textContent = entry.campaigns.join(' · ')
          button.appendChild(where)
        }
        button.addEventListener('click', () => { choosePerson(entry); finish(true) })
        item.appendChild(button)
        list.appendChild(item)
      }
    }
    search.addEventListener('input', draw)
    teamPeople().then(found => {
      people = found
      if (people.length > 8) root.querySelector('#outreach-who-search-wrap').style.display = 'block'
      draw()
    }, () => { people = []; list.innerHTML = `<li style="color:${ink2};font-size:15px">Couldn’t load the team. Check your connection and sign in again.</li>` })
  })
  return asking
}
