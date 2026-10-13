// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/**
 * Health ID registers no service worker. hid-system's earlier apps did
 * (/service-worker.js at scope '/', with caches named hid-…; one is live on
 * the apex today, hid-static-v2026-04-29-1), and a registered worker keeps
 * controlling its host until the browser's update check finds a new script.
 * Each Health ID app therefore serves /service-worker.js as a script that only
 * retires such a worker: it deletes the hid-… caches and unregisters itself.
 * It has no fetch handler, so it never serves or stores a response, and it does
 * not reload the pages it controlled (a form half filled in would be lost).
 */
const scripts = {
  portal: fileURLToPath(new URL('../../public/service-worker.js', import.meta.url)),
  site: fileURLToPath(new URL('../../../public-web/public/service-worker.js', import.meta.url)),
}

function worker(path: string, cacheNames: string[]) {
  const listeners = new Map<string, (event: { waitUntil(work: Promise<unknown>): void }) => void>()
  const waits: Promise<unknown>[] = []
  const deleted: string[] = []
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: { waitUntil(work: Promise<unknown>): void }) => void) => { listeners.set(type, listener) }),
    skipWaiting: vi.fn(async () => undefined),
    registration: { unregister: vi.fn(async () => true) },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []) },
  }
  const sandbox = {
    self,
    caches: { keys: vi.fn(async () => cacheNames), delete: vi.fn(async (name: string) => { deleted.push(name); return true }), open: vi.fn(), match: vi.fn() },
    fetch: vi.fn(),
  }
  runInNewContext(readFileSync(path, 'utf8'), sandbox)
  const fire = async (type: string) => {
    listeners.get(type)?.({ waitUntil: work => { waits.push(work) } })
    await Promise.all(waits)
  }
  return { self, sandbox, listeners, deleted, fire }
}

describe('the script that retires an earlier HID service worker', () => {
  it('takes over at once, deletes the hid- caches only, and unregisters', async () => {
    const run = worker(scripts.portal, ['hid-static-v2026-04-29-1', 'hid-web-static-v4', 'hid-ehr-shell-abc123', 'hid-admin-shell-v2', 'someone-else'])
    await run.fire('install')
    expect(run.self.skipWaiting).toHaveBeenCalledTimes(1)
    await run.fire('activate')
    expect(run.deleted.sort()).toEqual(['hid-admin-shell-v2', 'hid-ehr-shell-abc123', 'hid-static-v2026-04-29-1', 'hid-web-static-v4'])
    expect(run.self.registration.unregister).toHaveBeenCalledTimes(1)
  })

  it('serves, stores and shows nothing, and reloads no page', async () => {
    const run = worker(scripts.portal, ['hid-static-v2026-04-29-1'])
    await run.fire('install'); await run.fire('activate')
    expect([...run.listeners.keys()].sort()).toEqual(['activate', 'install'])
    expect(run.sandbox.fetch).not.toHaveBeenCalled()
    expect(run.sandbox.caches.open).not.toHaveBeenCalled()
    expect(run.self.clients.matchAll).not.toHaveBeenCalled()
  })

  it('is the same script on the public site', () => {
    expect(readFileSync(scripts.site, 'utf8')).toBe(readFileSync(scripts.portal, 'utf8'))
  })
})
