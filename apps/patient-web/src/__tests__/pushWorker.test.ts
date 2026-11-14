// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/**
 * The portal's push worker (B6, contract b6-contract.md §11.2 and D14): apps/patient-web/public/sw.js, served at /sw.js
 * and registered at scope '/' only when a patient turns on "Notifications on this device". A push carries nothing:
 * whatever arrives, it shows the same fixed notification and never reads the message, and a tap opens Notifications.
 * It handles no request, keeps nothing (no Cache API, storage or IndexedDB) and reaches no network of its own. Run here
 * in a sandbox that holds only what a worker could reach, each of them recorded.
 */
const script = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://app.healthidentitydirectory.com'

const OPTIONS = { body: 'You have a new notification.', icon: '/icons/icon-192.png', tag: 'hid-inbox', renotify: true, lang: 'en' }

interface FakeWindow { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }

function window(url: string, { controlled = true } = {}): FakeWindow {
  const client: FakeWindow = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async (target: string) => {
      if (!controlled) throw new TypeError('This client is not controlled by the worker')
      client.url = target
      return client
    }),
  }
  return client
}

type Listener = (event: Record<string, unknown>) => void

function worker(windows: FakeWindow[] = []) {
  const listeners = new Map<string, Listener>()
  const added: string[] = []
  const waits: Promise<unknown>[] = []
  const self = {
    addEventListener: vi.fn((type: string, listener: Listener) => { added.push(type); listeners.set(type, listener) }),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async (url: string) => window(url)) },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
  }
  const sandbox = {
    self, URL,
    fetch: vi.fn(), caches: { open: vi.fn(), match: vi.fn(), keys: vi.fn() }, importScripts: vi.fn(),
    indexedDB: { open: vi.fn() }, XMLHttpRequest: vi.fn(), WebSocket: vi.fn(),
  }
  runInNewContext(script, sandbox)
  const fire = async (type: string, event: Record<string, unknown>) => {
    // Added to the event itself: copying it would read every property, a push's data among them.
    event.waitUntil = (work: Promise<unknown>) => { waits.push(work) }
    listeners.get(type)?.(event)
    await Promise.all(waits)
  }
  return { self, sandbox, added, fire }
}

/** A push whose message must never be read: any read of its data throws. */
function push() {
  return Object.defineProperty({}, 'data', { get() { throw new Error('the worker read the push\'s data') }, enumerable: true })
}

function tap() {
  return { notification: { close: vi.fn(), data: undefined } }
}

describe('the push worker', () => {
  it('listens for a push and a tap, and for nothing else', () => {
    const run = worker()
    expect([...run.added].sort()).toEqual(['notificationclick', 'push'])
    expect(run.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('shows the same fixed notification for any push, without reading what it carries', async () => {
    const run = worker()
    await run.fire('push', push())
    await run.fire('push', push())
    expect(run.self.registration.showNotification).toHaveBeenCalledTimes(2)
    for (const call of run.self.registration.showNotification.mock.calls as unknown[][]) {
      expect(call).toEqual(['Health ID', OPTIONS])
    }
    // The options cannot be changed by anything that runs later in the worker.
    const options = (run.self.registration.showNotification.mock.calls[0] as unknown[])[1]
    expect(Object.isFrozen(options)).toBe(true)
  })

  it('on a tap, closes the notification and focuses a Notifications window already open', async () => {
    const notifications = window(`${ORIGIN}/notifications`)
    const other = window(`${ORIGIN}/records`)
    const run = worker([other, notifications])
    const event = tap()
    await run.fire('notificationclick', event)
    expect(event.notification.close).toHaveBeenCalledTimes(1)
    expect(run.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(notifications.focus).toHaveBeenCalledTimes(1)
    expect(other.navigate).not.toHaveBeenCalled()
    expect(run.self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('else moves another window of the portal to Notifications', async () => {
    const other = window(`${ORIGIN}/records?tab=labs`)
    const run = worker([other])
    await run.fire('notificationclick', tap())
    expect(other.navigate).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
    expect(other.focus).toHaveBeenCalledTimes(1)
    expect(run.self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('tries the next window when one is not its own to move, then opens one', async () => {
    const uncontrolled = window(`${ORIGIN}/`, { controlled: false })
    const run = worker([uncontrolled])
    await run.fire('notificationclick', tap())
    expect(uncontrolled.navigate).toHaveBeenCalledTimes(1)
    expect(run.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
  })

  it('never moves or focuses a window of another site, whatever its path', async () => {
    const elsewhere = window('https://evil.example/notifications')
    const run = worker([elsewhere])
    await run.fire('notificationclick', tap())
    expect(elsewhere.focus).not.toHaveBeenCalled()
    expect(elsewhere.navigate).not.toHaveBeenCalled()
    expect(run.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
  })

  it('opens Notifications when no window is open', async () => {
    const run = worker([])
    await run.fire('notificationclick', tap())
    expect(run.self.clients.openWindow).toHaveBeenCalledTimes(1)
    expect(run.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
  })

  it('never reaches the network, the Cache API, storage or another script, on a push or a tap', async () => {
    const run = worker([window(`${ORIGIN}/`)])
    await run.fire('push', push())
    await run.fire('notificationclick', tap())
    const { fetch, caches, importScripts, indexedDB, XMLHttpRequest, WebSocket } = run.sandbox
    expect(fetch).not.toHaveBeenCalled()
    expect(caches.open).not.toHaveBeenCalled()
    expect(caches.match).not.toHaveBeenCalled()
    expect(caches.keys).not.toHaveBeenCalled()
    expect(importScripts).not.toHaveBeenCalled()
    expect(indexedDB.open).not.toHaveBeenCalled()
    expect(XMLHttpRequest).not.toHaveBeenCalled()
    expect(WebSocket).not.toHaveBeenCalled()
  })

  it('names none of them in its source, and has no request handler', () => {
    expect(script).not.toMatch(/addEventListener\s*\(\s*['"`](?:fetch|install|activate|message|sync|periodicsync)['"`]/)
    expect(script).not.toMatch(/\bonfetch\b|\bcaches\b|\bimportScripts\b|\bindexedDB\b|\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\.data\b/)
    expect(script).not.toMatch(/skipWaiting|clients\.claim/)
  })
})
