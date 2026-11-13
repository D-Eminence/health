// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { offlineShellHere } from '../productHostname'

/**
 * Outreach's offline app shell (public/sw-outreach.js), which the portal's worker (public/sw.js) adds on Health ID
 * Outreach's own sites only. Both files run here as a browser runs them, in a sandbox holding only what a worker
 * reaches: a fake Cache API, a fake network and timers the test moves on. What it must do: a page opened is the
 * network's own answer whenever it comes in time (online is unchanged), else the app page kept; a build file is the
 * copy kept, else the network's; an /api/ answer, another site's request or any other file is never touched or kept; a
 * new release replaces the app page kept and its old files go; an old cache goes as a new worker starts.
 */
const pushScript = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const shellScript = readFileSync(fileURLToPath(new URL('../../public/sw-outreach.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://outreach.healthidentitydirectory.com'

const ENTRY = '/assets/index-AbCdEf12.js'
const STYLE = '/assets/index-GhIjKl34.css'
const CHUNK = '/assets/Outreach-MnOpQr56.js'
const shellHtml = (entry = ENTRY, style = STYLE) => '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
  + `<script type="module" crossorigin src="${entry}"></script><link rel="stylesheet" crossorigin href="${style}"></head>`
  + '<body><div id="root"></div></body></html>'
const LANDING = '<!doctype html><html><body><main><h1>Health ID Outreach</h1></main></body></html>'

type Answer = Response | Promise<Response> | Error

/** A response as a browser hands a worker one from its own site: type 'basic', kept through clone(). */
function basic(response: Response): Response {
  const clone = response.clone.bind(response)
  Object.defineProperty(response, 'type', { value: 'basic' })
  Object.defineProperty(response, 'clone', { value: () => basic(clone()) })
  return response
}
const html = (body: string, status = 200) => basic(new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }))
const js = (body = 'export {}') => basic(new Response(body, { headers: { 'content-type': 'text/javascript' } }))

class FakeCache {
  readonly entries = new Map<string, Response>()
  private key(request: string | { url: string }) { return new URL(typeof request === 'string' ? request : request.url, ORIGIN).href }
  async match(request: string | { url: string }) { return this.entries.get(this.key(request))?.clone() }
  async put(request: string | { url: string }, response: Response) { this.entries.set(this.key(request), response) }
  async delete(request: string | { url: string }) { return this.entries.delete(this.key(request)) }
  async keys() { return [...this.entries.keys()].map(url => ({ url })) }
  paths() { return [...this.entries.keys()].map(url => new URL(url).pathname).sort() }
}

interface Run {
  readonly listeners: Map<string, (event: Record<string, unknown>) => void>
  readonly network: ReturnType<typeof vi.fn>
  readonly caches: Map<string, FakeCache>
  readonly self: { skipWaiting: ReturnType<typeof vi.fn>; clients: { claim: ReturnType<typeof vi.fn> } }
  readonly timers: Array<{ ms: number; fire: () => void }>
  readonly cache: () => FakeCache
  readonly context: Record<string, unknown>
}

/** sw.js run on `hostname`, with the network answering each path from `answers` (in order), else a network failure. */
function worker(answers: Record<string, Answer[]> = {}, hostname = new URL(ORIGIN).hostname, existing: Record<string, FakeCache> = {}): Run {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const caches = new Map<string, FakeCache>(Object.entries(existing))
  const timers: Run['timers'] = []
  const network = vi.fn(async (input: string | { url: string }) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN)
    const next = url.origin === ORIGIN ? answers[url.pathname]?.shift() : undefined
    if (next === undefined || next instanceof Error) throw next ?? new TypeError('Failed to fetch')
    return next
  })
  const self = {
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => { listeners.set(type, listener) },
    location: { origin: `https://${hostname}`, hostname },
    registration: { showNotification: vi.fn() },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
  }
  const sandbox: Record<string, unknown> = {
    self, URL, Response, fetch: network,
    setTimeout: (fire: () => void, ms: number) => { timers.push({ ms, fire }); return timers.length },
    clearTimeout: () => undefined,
    caches: {
      open: vi.fn(async (name: string) => { if (!caches.has(name)) caches.set(name, new FakeCache()); return caches.get(name)! }),
      keys: vi.fn(async () => [...caches.keys()]),
      delete: vi.fn(async (name: string) => caches.delete(name)),
    },
  }
  const context = createContext(sandbox)
  sandbox.importScripts = vi.fn((path: string) => {
    expect(path).toBe('/sw-outreach.js')
    runInContext(shellScript, context)
  })
  runInContext(pushScript, context)
  return { listeners, network, caches, self, timers, context, cache: () => { if (!caches.has('hid-outreach-shell-v1')) caches.set('hid-outreach-shell-v1', new FakeCache()); return caches.get('hid-outreach-shell-v1')! } }
}

/** Fires a fetch event; `answer` is what the page gets (undefined when the worker leaves it to the browser). */
function request(run: Run, path: string, { mode = 'cors', method = 'GET', origin = ORIGIN } = {}) {
  const waits: Promise<unknown>[] = []
  let answer: Promise<Response> | undefined
  const event = {
    request: { url: new URL(path, origin).href, method, mode },
    respondWith: (response: Promise<Response>) => { answer = Promise.resolve(response) },
    waitUntil: (work: Promise<unknown>) => { waits.push(work) },
  }
  run.listeners.get('fetch')?.(event)
  const settled = async () => { for (let i = 0; i < 5; i += 1) await Promise.allSettled(waits) }
  return { answer, settled }
}

async function lifecycle(run: Run, type: 'install' | 'activate') {
  const waits: Promise<unknown>[] = []
  run.listeners.get(type)?.({ waitUntil: (work: Promise<unknown>) => { waits.push(work) } })
  await Promise.all(waits)
}

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }

describe('where the offline app shell runs', () => {
  it('names the same hosts as the portal, and only Outreach\'s own sites', () => {
    const hosts = /OFFLINE_SHELL_HOSTS = Object\.freeze\((\[[^\]]*\])\)/.exec(pushScript)?.[1]
    const listed = JSON.parse((hosts ?? '[]').replace(/'/g, '"')) as string[]
    expect(listed).toEqual(['outreach.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com'])
    for (const host of listed) expect(offlineShellHere(host)).toBe(true)
    for (const host of ['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com',
      'app.healthidentitydirectory.com', 'migrate.staging.healthidentitydirectory.com', 'localhost']) expect(offlineShellHere(host)).toBe(false)
  })

  it('handles no request at all on any other site', () => {
    const run = worker({}, 'ehr.healthidentitydirectory.com')
    expect([...run.listeners.keys()].sort()).toEqual(['notificationclick', 'push'])
  })

  it('on Outreach\'s site, listens for the worker\'s start, requests and the page\'s message, besides push', () => {
    const run = worker()
    expect([...run.listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install', 'message', 'notificationclick', 'push'])
  })
})

describe('what it touches', () => {
  const route = (path: string, options: { mode?: string; method?: string; origin?: string } = {}) => {
    const run = worker()
    return (run.context.shellRoute as (request: unknown) => string)({ url: new URL(path, options.origin ?? ORIGIN).href, method: options.method ?? 'GET', mode: options.mode ?? 'cors' })
  }
  it.each([
    ['a page opened', '/provider/outreach', { mode: 'navigate' }, 'navigate'],
    ['the front page opened', '/', { mode: 'navigate' }, 'navigate'],
    ['a build file', ENTRY, {}, 'asset'],
    ['a build font', '/assets/figtree-latin-wght-normal-AbCdEf12.woff2', {}, 'asset'],
    ['an API read', '/api/v1/outreach/registration-cases', {}, 'network'],
    ['an API address opened as a page', '/api/v1/auth/session', { mode: 'navigate' }, 'network'],
    ['a registration sent', '/api/v1/outreach/registration-cases', { method: 'POST' }, 'network'],
    ['a page sent as a form', '/provider/outreach', { mode: 'navigate', method: 'POST' }, 'network'],
    ['another site\'s page', '/provider/outreach', { mode: 'navigate', origin: 'https://ehr.healthidentitydirectory.com' }, 'network'],
    ['another site\'s file', ENTRY, { origin: 'https://cdn.example.test' }, 'network'],
    ['a build file with a query', `${ENTRY}?v=1`, {}, 'network'],
    ['a file not named by its hash', '/assets/index.js', {}, 'network'],
    ['an icon', '/icons/icon-192.png', {}, 'network'],
    ['the worker itself', '/sw.js', {}, 'network'],
    ['the manifest', '/health-id.webmanifest', {}, 'network'],
  ])('%s: %s is %s', (_name, path, options, expected) => {
    expect(route(path, options)).toBe(expected)
  })

  it('leaves an API request to the browser and keeps nothing of it', async () => {
    const run = worker({ '/api/v1/outreach/registration-cases': [js('[]')] })
    const sent = request(run, '/api/v1/outreach/registration-cases')
    expect(sent.answer).toBeUndefined()
    await sent.settled()
    expect(run.network).not.toHaveBeenCalled()
    expect(run.caches.size).toBe(0)
  })
})

describe('a page opened', () => {
  it('online: is the network\'s own answer, unchanged, and the app page is kept from it', async () => {
    const fresh = html(shellHtml())
    const run = worker({ '/provider/outreach': [fresh] })
    const sent = request(run, '/provider/outreach', { mode: 'navigate' })
    expect(await sent.answer).toBe(fresh)
    await sent.settled()
    expect(run.cache().paths()).toEqual(['/provider/outreach'])
    expect(await (await run.cache().match('/provider/outreach'))!.text()).toBe(shellHtml())
  })

  it('online but slow (over 4 seconds): the app page kept, and the network\'s answer kept for next time', async () => {
    const run = worker()
    await run.cache().put('/provider/outreach', new Response(shellHtml('/assets/index-OldOld12.js'), { headers: { 'content-type': 'text/html' } }))
    let answerNetwork: (response: Response) => void = () => undefined
    run.network.mockImplementationOnce(() => new Promise<Response>(resolve => { answerNetwork = resolve }))
    const sent = request(run, '/provider/sign-in', { mode: 'navigate' })
    await flush()
    expect(run.timers.map(timer => timer.ms)).toEqual([4000])
    run.timers[0]!.fire()
    expect(await (await sent.answer)!.text()).toBe(shellHtml('/assets/index-OldOld12.js'))
    answerNetwork(html(shellHtml()))
    await sent.settled()
    expect(await (await run.cache().match('/provider/outreach'))!.text()).toBe(shellHtml())
  })

  it('with no signal: the app page kept, whatever page of the site was opened', async () => {
    const run = worker()
    await run.cache().put('/provider/outreach', new Response(shellHtml(), { headers: { 'content-type': 'text/html' } }))
    for (const path of ['/provider/outreach', '/', '/provider']) {
      const sent = request(run, path, { mode: 'navigate' })
      expect(await (await sent.answer)!.text()).toBe(shellHtml())
      await sent.settled()
    }
  })

  it('with no signal and nothing kept: the browser\'s own page, as before', async () => {
    const run = worker()
    const sent = request(run, '/provider/outreach', { mode: 'navigate' })
    await expect(sent.answer).rejects.toThrow()
    await sent.settled()
  })

  it('never keeps the front page (a landing page or a move to the workspace), another page, or an error', async () => {
    const run = worker({
      '/': [html(shellHtml())],
      '/provider/outreach': [html(LANDING), html(shellHtml(), 500), basic(Response.redirect(`${ORIGIN}/provider`, 302))],
    })
    for (const path of ['/', '/provider/outreach', '/provider/outreach', '/provider/outreach']) {
      const sent = request(run, path, { mode: 'navigate' })
      await sent.answer?.catch(() => undefined)
      await sent.settled()
    }
    expect(run.cache().paths()).toEqual([])
  })

  it('a new release replaces the app page kept, and the files only the old one used go', async () => {
    const oldShell = shellHtml('/assets/index-OldOld12.js', '/assets/index-OldCss12.css')
    const run = worker({ '/provider/outreach': [html(shellHtml())] })
    const cache = run.cache()
    const long = String(Date.now() - 60 * 60 * 1000)
    await cache.put('/provider/outreach', new Response(oldShell, { headers: { 'content-type': 'text/html', 'x-hid-kept-at': long } }))
    for (const path of ['/assets/index-OldOld12.js', '/assets/index-OldCss12.css', '/assets/Outreach-OldChk12.js', ENTRY]) {
      await cache.put(path, new Response('old', { headers: { 'content-type': 'text/javascript', 'x-hid-kept-at': long } }))
    }
    // Kept a moment ago, by a page just opened: kept.
    await cache.put(CHUNK, new Response('new', { headers: { 'content-type': 'text/javascript', 'x-hid-kept-at': String(Date.now()) } }))
    const sent = request(run, '/provider/outreach', { mode: 'navigate' })
    expect(await (await sent.answer)!.text()).toBe(shellHtml())
    await sent.settled()
    expect(cache.paths()).toEqual([ENTRY, CHUNK, '/provider/outreach'].sort())
    expect(await (await cache.match('/provider/outreach'))!.text()).toBe(shellHtml())
  })
})

describe('a build file', () => {
  it('is the network\'s the first time, kept, then the copy kept, with no request', async () => {
    const run = worker({ [ENTRY]: [js('export const a = 1')] })
    const first = request(run, ENTRY)
    expect(await (await first.answer)!.text()).toBe('export const a = 1')
    await first.settled()
    const second = request(run, ENTRY)
    const copy = (await second.answer)!
    expect(await copy.text()).toBe('export const a = 1')
    expect(copy.headers.get('content-type')).toBe('text/javascript')
    expect(run.network).toHaveBeenCalledTimes(1)
  })

  it('is never kept when the network answers a page in its place (the site\'s fallback) or an error', async () => {
    const run = worker({ [ENTRY]: [html(shellHtml()), basic(new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } }))] })
    for (let i = 0; i < 2; i += 1) {
      const sent = request(run, ENTRY)
      await sent.answer
      await sent.settled()
    }
    expect(run.cache().paths()).toEqual([])
  })
})

describe('as a new worker starts', () => {
  it('takes over at once, keeps the app page and the files it names, and deletes only its own older caches', async () => {
    const other = new FakeCache()
    const run = worker({ '/provider/outreach': [html(shellHtml())], [ENTRY]: [js()], [STYLE]: [basic(new Response('body{}', { headers: { 'content-type': 'text/css' } }))] },
      new URL(ORIGIN).hostname, { 'hid-outreach-shell-v0': new FakeCache(), 'someone-else': other })
    await lifecycle(run, 'install')
    expect(run.self.skipWaiting).toHaveBeenCalledTimes(1)
    expect(run.cache().paths()).toEqual([ENTRY, STYLE, '/provider/outreach'].sort())
    await lifecycle(run, 'activate')
    expect([...run.caches.keys()].sort()).toEqual(['hid-outreach-shell-v1', 'someone-else'])
    expect(run.self.clients.claim).toHaveBeenCalledTimes(1)
  })

  it('starts with no signal without failing, keeping nothing', async () => {
    const run = worker()
    await lifecycle(run, 'install')
    expect(run.cache().paths()).toEqual([])
  })
})

describe('the page\'s message', () => {
  async function message(run: Run, data: unknown, from = `${ORIGIN}/provider/outreach`) {
    const waits: Promise<unknown>[] = []
    run.listeners.get('message')?.({ data, source: { url: from }, waitUntil: (work: Promise<unknown>) => { waits.push(work) } })
    await Promise.all(waits)
  }

  it('keeps the build files it names, and nothing else it names', async () => {
    const run = worker({ '/provider/outreach': [html(shellHtml())], [ENTRY]: [js()], [STYLE]: [basic(new Response('body{}', { headers: { 'content-type': 'text/css' } }))],
      [CHUNK]: [js()] })
    await message(run, { type: 'hid-outreach-keep', assets: [CHUNK, '/api/v1/auth/session', 'https://cdn.example.test/assets/x-AbCdEf12.js', '/icons/icon-192.png', 42] })
    expect(run.cache().paths()).toEqual([ENTRY, CHUNK, STYLE, '/provider/outreach'].sort())
    expect(run.network.mock.calls.map(([input]) => String(input))).not.toContain('/api/v1/auth/session')
  })

  it('ignores a message from another site or of another kind', async () => {
    const run = worker({ [CHUNK]: [js()] })
    await message(run, { type: 'hid-outreach-keep', assets: [CHUNK] }, 'https://evil.example/')
    await message(run, { type: 'something-else', assets: [CHUNK] })
    expect(run.network).not.toHaveBeenCalled()
  })
})
