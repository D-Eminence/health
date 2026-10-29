// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/**
 * The offline app shell in apps/patient-web/public/sw.js (docs/OFFLINE-CONTRACT.md 2.12, amendment A5), run in a
 * sandbox like pushWorker.test.ts with an in-memory Cache Storage, a recorded network and clock, and the file list a
 * pilot build writes into it (vite.config.ts). It saves nothing at install and handles no request until a page posts
 * HID_SHELL_ENABLE; then navigations are network first for 4 s with the saved index.html behind them, the build's
 * files are served from the shell first, and the API and the worker scripts always pass through.
 */
const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://ehr.healthidentitydirectory.com'
const BUILD = '0123456789abcdef'
const ENTRY = '/assets/index-AbCdEf12.js'
const SHELL = { build: BUILD, environment: 'production', debug: false, entry: ENTRY,
  assets: [ENTRY, '/assets/index-GhIjKl34.css', '/health-id.webmanifest', '/icons/icon-192.png'] }
const OWN = `health-id-shell-${BUILD}`
/** This build's index.html, as the Worker serves it at '/'. */
const PAGE = `<!doctype html><title>Health ID</title><script type="module" crossorigin src="${ENTRY}"></script>`
/** Another build's index.html: what Cloudflare's single-page fallback answers for a file that no longer exists. */
const OTHER_PAGE = '<!doctype html><title>Health ID</title><script type="module" crossorigin src="/assets/index-NeWbUiLd.js"></script>'

interface FakeResponse {
  readonly ok: boolean; readonly status: number; readonly type: string; readonly body: string
  readonly headers: { get(name: string): string | null }
  clone(): { text(): Promise<string> }
}
const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' }
function answer(body: string, status = 200, contentType = 'text/html; charset=utf-8'): FakeResponse {
  return { ok: status >= 200 && status < 300, status, type: 'basic', body,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    clone: () => ({ text: async () => body }) }
}
/** A file of the build, typed by its extension. */
const file = (path: string, body = `network ${path}`) => answer(body, 200, TYPES[path.split('.').at(-1) ?? ''] ?? 'text/html; charset=utf-8')

/** Cache Storage in memory: names in creation order, entries keyed by absolute URL. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, FakeResponse>>()
  private key(path: string) { return new URL(path, ORIGIN).href }
  keys = vi.fn(async () => [...this.stores.keys()])
  open = vi.fn(async (name: string) => {
    if (!this.stores.has(name)) this.stores.set(name, new Map())
    const store = this.stores.get(name)!
    return {
      put: async (path: string, response: FakeResponse) => { store.set(this.key(path), response) },
      match: async (path: string) => store.get(this.key(path)),
    }
  })
  match = vi.fn(async (path: string, options: { cacheName: string }) => this.stores.get(options.cacheName)?.get(this.key(path)))
  delete = vi.fn(async (name: string) => this.stores.delete(name))
  seed(name: string, files: Record<string, string>) {
    this.stores.set(name, new Map(Object.entries(files).map(([path, body]) => [this.key(path), answer(body)])))
  }
  files(name: string) { return [...(this.stores.get(name)?.keys() ?? [])].map(url => new URL(url).pathname).sort() }
}

type Network = (url: string) => Promise<FakeResponse>
/** The Worker as deployed for this build: '/' is its page, its files are themselves, other paths are navigations. */
const served: Network = async url => {
  const path = new URL(url).pathname
  return path === '/' ? answer(PAGE) : SHELL.assets.includes(path) ? file(path) : answer(`network ${path}`)
}
/** The Worker after another build was deployed: '/' and every missing file answer that build's page (SPA fallback). */
const deployedElsewhere: Network = async () => answer(OTHER_PAGE)

function worker({ shell = SHELL as typeof SHELL | null, caches = new FakeCaches(), network = served, windows = 0 } = {}) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const timers: (() => void)[] = []
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: Record<string, unknown>) => void) => { listeners.set(type, listener) }),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: vi.fn(async () => Array.from({ length: windows }, () => ({ url: `${ORIGIN}/` }))) },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(async () => undefined),
  }
  const fetch = vi.fn(async (request: { url: string } | string) => network(typeof request === 'string' ? request : request.url))
  function Request(this: unknown, path: string, init: Record<string, unknown>) {
    return { url: new URL(path, ORIGIN).href, init }
  }
  const sandbox = {
    self, URL, Promise, caches, fetch, Request,
    setTimeout: (callback: (value: unknown) => void, _ms: number, value: unknown) => { timers.push(() => callback(value)); return timers.length },
  }
  const script = shell === null ? source : source.replace('self.__HID_SHELL__ = null', `self.__HID_SHELL__ = ${JSON.stringify(shell)}`)
  runInNewContext(script, sandbox)

  /** Fires an extendable event and waits for everything it asked to wait for. */
  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = []
    event.waitUntil = (work: Promise<unknown>) => { waits.push(work) }
    listeners.get(type)?.(event)
    await Promise.allSettled(waits)
    return waits
  }
  /** Fires a fetch event: what the worker answered, or null when it let the request pass through. */
  const request = async (path: string, { method = 'GET', mode = 'no-cors', origin = ORIGIN } = {}) => {
    const responded: Promise<FakeResponse>[] = []
    listeners.get('fetch')?.({ request: { method, mode, url: `${origin}${path}` }, respondWith: (work: Promise<FakeResponse>) => { responded.push(work) } })
    return responded[0] ?? null
  }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return { self, caches, fetch, timers, fire, request, settle }
}

const enable = (run: ReturnType<typeof worker>) => run.fire('message', { data: { type: 'HID_SHELL_ENABLE' } })

describe('before HID_SHELL_ENABLE', () => {
  it('saves nothing at install and does not take over', async () => {
    const run = worker()
    await run.fire('install')
    expect(run.caches.stores.size).toBe(0)
    expect(run.caches.open).not.toHaveBeenCalled()
    expect(run.fetch).not.toHaveBeenCalled()
    expect(run.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('passes every request through, the worker making none of its own', async () => {
    const run = worker()
    await run.settle()
    for (const [path, mode] of [['/patients', 'navigate'], ['/assets/index-AbCdEf12.js', 'no-cors'], ['/health-id.webmanifest', 'no-cors']] as const) {
      expect(await run.request(path, { mode })).toBeNull()
    }
    expect(run.fetch).not.toHaveBeenCalled()
  })

  it('answers through the network, saving nothing, if a request comes before it has looked for a shell', async () => {
    const run = worker()
    const response = await run.request('/patients', { mode: 'navigate' })
    expect((await response!).body).toBe('network /patients')
    expect(run.caches.stores.size).toBe(0)
  })

  it('stays a pass-through worker when activated on a device that never turned the shell on', async () => {
    const run = worker()
    await run.fire('activate')
    expect(run.caches.stores.size).toBe(0)
    expect(run.fetch).not.toHaveBeenCalled()
  })
})

describe('HID_SHELL_ENABLE', () => {
  it('saves index.html (fetched fresh at /) and every file of this build in its own health-id-shell- cache', async () => {
    const run = worker()
    await enable(run)
    expect([...run.caches.stores.keys()]).toEqual([OWN])
    expect(run.caches.files(OWN)).toEqual([...SHELL.assets, '/index.html'].sort())
    const requested = run.fetch.mock.calls.map(([request]) => request as unknown as { url: string; init: Record<string, unknown> })
    expect(requested.map(request => new URL(request.url).pathname).sort()).toEqual(['/', ...SHELL.assets].sort())
    for (const request of requested) expect(request.init).toMatchObject({ cache: 'reload', redirect: 'error' })
  })

  it('saves nothing at all when any file fails, so a half-saved shell is never served', async () => {
    const run = worker({ network: async url => url.endsWith('.css') ? answer('missing', 404) : answer('ok') })
    await enable(run)
    expect(run.caches.stores.size).toBe(0)
    expect(await run.request('/patients', { mode: 'navigate' })).toBeNull()
  })

  it('saves nothing when the files answer another build\'s page (a deploy since this build), and tries again next time', async () => {
    let network = deployedElsewhere
    const run = worker({ network: url => network(url) })
    await enable(run)
    expect(run.caches.stores.size).toBe(0)
    run.fetch.mockClear()
    network = served
    await enable(run)
    expect(run.fetch).toHaveBeenCalled()
    expect(run.caches.files(OWN)).toContain('/index.html')
  })

  it('saves nothing when only the page is another build\'s, its files still answering', async () => {
    const run = worker({ network: async url => new URL(url).pathname === '/' ? answer(OTHER_PAGE) : served(url) })
    await enable(run)
    expect(run.caches.stores.size).toBe(0)
  })

  it('saves nothing when a file of the build answers with a page', async () => {
    const run = worker({ network: async url => new URL(url).pathname.endsWith('.css') ? answer(PAGE) : served(url) })
    await enable(run)
    expect(run.caches.stores.size).toBe(0)
  })

  it('is ignored by a build without the app shell', async () => {
    const run = worker({ shell: null })
    await enable(run)
    expect(run.caches.stores.size).toBe(0)
    expect(run.fetch).not.toHaveBeenCalled()
  })

  it('reads nothing of a message but its type', async () => {
    const run = worker()
    const data = new Proxy({ type: 'HID_SHELL_ENABLE' }, { get(target, key) {
      if (key !== 'type') throw new Error(`the worker read ${String(key)}`)
      return target.type
    } })
    await run.fire('message', { data })
    await run.fire('message', { data: null })
    await run.fire('message', {})
    expect(run.caches.files(OWN)).toContain('/index.html')
  })
})

describe('once the shell is kept', () => {
  async function enabled(network: Network = served) {
    let current = served
    const run = worker({ network: url => current(url) })
    await enable(run)
    run.fetch.mockClear()
    current = network
    return run
  }

  it('answers a navigation from the network when it answers within 4 s', async () => {
    const run = await enabled()
    expect((await (await run.request('/patients/1', { mode: 'navigate' }))!).body).toBe('network /patients/1')
  })

  it('answers a navigation with the saved index.html when the network fails', async () => {
    const run = await enabled(async () => { throw new TypeError('Failed to fetch') })
    expect((await (await run.request('/patients/1', { mode: 'navigate' }))!).body).toBe(PAGE)
  })

  it('answers a navigation with the saved index.html after 4 s without an answer', async () => {
    const run = await enabled(() => new Promise(() => undefined))
    const response = run.request('/patients/1', { mode: 'navigate' })
    await run.settle()
    expect(run.timers).toHaveLength(1)
    run.timers[0]?.()
    expect((await (await response)!).body).toBe(PAGE)
  })

  it('serves the build\'s files, its manifest and icons from the shell without the network', async () => {
    const run = await enabled(async () => { throw new TypeError('Failed to fetch') })
    for (const path of SHELL.assets) expect((await (await run.request(path))!).body).toBe(`network ${path}`)
    expect(run.fetch).not.toHaveBeenCalled()
  })

  it('never handles the API, the worker scripts, another site, or anything but GET', async () => {
    const run = await enabled()
    for (const path of ['/api/v1/ehr/offline/ping', '/api/v1/identity/me', '/api', '/sw.js', '/service-worker.js']) {
      expect(await run.request(path, { mode: 'navigate' })).toBeNull()
      expect(await run.request(path)).toBeNull()
    }
    expect(await run.request('/assets/index-AbCdEf12.js', { origin: 'https://evil.example' })).toBeNull()
    expect(await run.request('/patients', { method: 'POST', mode: 'navigate' })).toBeNull()
    expect(await run.request('/assets/index-AbCdEf12.js', { method: 'HEAD' })).toBeNull()
    expect(await run.request('/robots.txt')).toBeNull()
    expect(run.fetch).not.toHaveBeenCalled()
  })

  it('never saves what the network answers after enabling: only the build\'s files are kept', async () => {
    const run = await enabled()
    await run.request('/patients/1', { mode: 'navigate' })
    await run.request('/assets/other-ZzZzZz99.js')
    expect(run.caches.files(OWN)).toEqual([...SHELL.assets, '/index.html'].sort())
  })
})

describe('a new build activating', () => {
  const OLDER = 'health-id-shell-aaaaaaaaaaaaaaaa'
  const OLDEST = 'health-id-shell-bbbbbbbbbbbbbbbb'

  it('saves its own shell before deleting the older one when no window is open', async () => {
    const caches = new FakeCaches()
    caches.seed(OLDER, { '/index.html': 'old shell' })
    caches.seed('another-cache', { '/x': 'not ours' })
    const run = worker({ caches })
    await run.fire('activate')
    expect([...caches.stores.keys()].sort()).toEqual(['another-cache', OWN])
    expect(caches.files(OWN)).toContain('/index.html')
  })

  it('keeps the newest older generation while a window may still be on it, and only that one', async () => {
    const caches = new FakeCaches()
    caches.seed(OLDEST, { '/index.html': 'oldest' })
    caches.seed(OLDER, { '/index.html': 'older', '/assets/old-OoOoOo11.js': 'old code' })
    const run = worker({ caches, windows: 1 })
    await run.fire('activate')
    expect([...caches.stores.keys()].sort()).toEqual([OWN, OLDER].sort())
    // A page still running the older build can load its files.
    expect((await (await run.request('/assets/old-OoOoOo11.js'))!).body).toBe('old code')
  })

  it('keeps the older shell when it cannot save its own (offline), and still serves it', async () => {
    const caches = new FakeCaches()
    caches.seed(OLDER, { '/index.html': 'older' })
    const run = worker({ caches, network: async () => { throw new TypeError('Failed to fetch') } })
    await run.fire('activate')
    expect([...caches.stores.keys()]).toEqual([OLDER])
    const response = await run.request('/patients', { mode: 'navigate' })
    expect((await response!).body).toBe('older')
  })

  it('keeps the older shell, and saves none of its own, when the site already serves another build', async () => {
    const caches = new FakeCaches()
    caches.seed(OLDER, { '/index.html': 'older' })
    const run = worker({ caches, network: deployedElsewhere })
    await run.fire('activate')
    expect([...caches.stores.keys()]).toEqual([OLDER])
  })

  it('deletes every shell when its build has the shell off (the kill switch)', async () => {
    const caches = new FakeCaches()
    caches.seed(OLDER, { '/index.html': 'older' })
    caches.seed('another-cache', { '/x': 'not ours' })
    const run = worker({ caches, shell: null, windows: 1 })
    await run.fire('activate')
    expect([...caches.stores.keys()]).toEqual(['another-cache'])
  })

  it('never takes over on its own', async () => {
    const run = worker()
    await run.fire('install')
    await run.fire('activate')
    await enable(run)
    expect(run.self.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('messages', () => {
  it('HID_SKIP_WAITING takes over', async () => {
    const run = worker()
    await run.fire('message', { data: { type: 'HID_SKIP_WAITING' } })
    expect(run.self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('HID_PURGE_SHELL deletes every shell cache and nothing else, and requests then pass through', async () => {
    const caches = new FakeCaches()
    caches.seed('another-cache', { '/x': 'not ours' })
    const run = worker({ caches })
    await enable(run)
    caches.seed('health-id-shell-aaaaaaaaaaaaaaaa', { '/index.html': 'older' })
    await run.fire('message', { data: { type: 'HID_PURGE_SHELL' } })
    expect([...caches.stores.keys()]).toEqual(['another-cache'])
    expect(await run.request('/patients', { mode: 'navigate' })).toBeNull()
  })

  it('HID_PURGE_SHELL works in a build without the shell too', async () => {
    const caches = new FakeCaches()
    caches.seed(OWN, { '/index.html': 'shell' })
    const run = worker({ caches, shell: null })
    await run.fire('message', { data: { type: 'HID_PURGE_SHELL' } })
    expect(caches.stores.size).toBe(0)
  })

  it('ignores any other message', async () => {
    const run = worker()
    await run.fire('message', { data: { type: 'SKIP_WAITING' } })
    await run.fire('message', { data: 'HID_SKIP_WAITING' })
    expect(run.self.skipWaiting).not.toHaveBeenCalled()
    expect(run.caches.stores.size).toBe(0)
  })
})

describe('push stays as it was', () => {
  it('shows the fixed notification on a push without touching the shell or the network', async () => {
    const run = worker()
    await enable(run)
    run.fetch.mockClear()
    run.caches.open.mockClear()
    await run.fire('push', {})
    expect(run.self.registration.showNotification).toHaveBeenCalledWith('Health ID', expect.objectContaining({ body: 'You have a new notification.' }))
    expect(run.fetch).not.toHaveBeenCalled()
    expect(run.caches.open).not.toHaveBeenCalled()
  })
})
