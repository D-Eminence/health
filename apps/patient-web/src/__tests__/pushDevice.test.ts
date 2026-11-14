import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserSubscription, endpointDigest, keyBytes, permission, support, turnOffBrowser, turnOn } from '../pushDevice'

/**
 * This device's side of "Notifications on this device" (B6, contract b6-contract.md §11.3), the only module allowed
 * the browser's push APIs: feature detection (iPhone and iPad only in the installed app), the digest and key id
 * Identity matches a subscription by (§3.4), and turning on and off, against a fake of the browser's APIs.
 */
const KEY = `B${'A'.repeat(86)}`
const KEY_BYTES = new Uint8Array(65); KEY_BYTES[0] = 4
const OTHER_KEY_BYTES = new Uint8Array(65); OTHER_KEY_BYTES[0] = 4; OTHER_KEY_BYTES[64] = 1
const keyIdOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const KEY_ID = keyIdOf(KEY_BYTES)
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/existing-device'
const NEW_ENDPOINT = 'https://updates.push.services.mozilla.com/wpush/v2/new-device'
const KEYS = { p256dh: `B${'C'.repeat(86)}`, auth: 'D'.repeat(22) }
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'

interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => PushSubscriptionJSON
  unsubscribe: ReturnType<typeof vi.fn>
}

const defined: Array<[object, string]> = []
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, value })
  defined.push([target, key])
}
afterEach(() => {
  for (const [target, key] of defined.splice(0)) Reflect.deleteProperty(target, key)
  vi.unstubAllGlobals()
})

/** A browser with the push APIs: `existing` is the subscription it holds, `answer` what a permission prompt answers. */
interface BrowserOptions {
  granted?: NotificationPermission
  answer?: NotificationPermission
  existing?: { endpoint: string; key: Uint8Array | null } | null
  registered?: boolean
  agent?: string
  touch?: number
}

function browser({ granted = 'default', answer = 'granted', existing = null, registered = existing !== null, agent = DESKTOP, touch = 0 }: BrowserOptions = {}) {
  let current: FakeSubscription | null = null
  const subscription = (endpoint: string, key: Uint8Array | null): FakeSubscription => {
    const made: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: key ? key.slice().buffer : null },
      toJSON: () => ({ endpoint, expirationTime: null, keys: { ...KEYS } }),
      unsubscribe: vi.fn(async () => { if (current === made) current = null; return true }),
    }
    return made
  }
  if (existing) current = subscription(existing.endpoint, existing.key)
  const first = current
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => (current = subscription(NEW_ENDPOINT, new Uint8Array(options.applicationServerKey)))),
  }
  const registration = { pushManager }
  let hasRegistration = registered
  const serviceWorker = {
    register: vi.fn(async () => { hasRegistration = true; return registration }),
    get ready() { return Promise.resolve(registration) },
    getRegistration: vi.fn(async () => (hasRegistration ? registration : undefined)),
  }
  define(window, 'isSecureContext', true)
  define(navigator, 'serviceWorker', serviceWorker)
  define(navigator, 'userAgent', agent)
  define(navigator, 'maxTouchPoints', touch)
  vi.stubGlobal('PushManager', function PushManager() {})
  const notification = { permission: granted, requestPermission: vi.fn(async () => { notification.permission = answer; return answer }) }
  vi.stubGlobal('Notification', notification)
  return { serviceWorker, pushManager, notification, first, current: () => current }
}

describe('support', () => {
  it('is unsupported without the push APIs or a secure page (as in this test browser)', () => {
    expect(support()).toBe('unsupported')
    browser()
    define(window, 'isSecureContext', false)
    expect(support()).toBe('unsupported')
  })

  it('is supported with a service worker, the Push API and notifications on a secure page', () => {
    browser()
    expect(support()).toBe('supported')
  })

  it.each([['an iPhone', IPHONE, 0], ['an iPad, which says Macintosh', IPAD, 5]])('on %s in a browser tab, needs the Home Screen app', (_name, agent, touch) => {
    browser({ agent, touch })
    expect(support()).toBe('ios-install-needed')
  })

  it('on an iPhone in the Home Screen app, is supported where the browser has the APIs', () => {
    browser({ agent: IPHONE })
    define(navigator, 'standalone', true)
    expect(support()).toBe('supported')
  })

  it('on a Mac without a touch screen, is the browser\'s own answer', () => {
    browser({ agent: IPAD, touch: 0 })
    expect(support()).toBe('supported')
  })

  it('reads the permission without asking for it', () => {
    const { notification } = browser({ granted: 'denied' })
    expect(permission()).toBe('denied')
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('digest and key id (contract §3.4)', () => {
  it('digests the endpoint\'s UTF-8 bytes as lowercase hex SHA-256', async () => {
    expect(await endpointDigest(ENDPOINT)).toBe(createHash('sha256').update(ENDPOINT, 'utf8').digest('hex'))
  })

  it('decodes Identity\'s key to its 65 bytes, and refuses anything else', () => {
    expect([...keyBytes(KEY)]).toEqual([...KEY_BYTES])
    expect(() => keyBytes(KEY.slice(1))).toThrow()
    expect(() => keyBytes(`C${'A'.repeat(86)}`)).toThrow()
  })
})

describe('browserSubscription', () => {
  it('finds no subscription, and registers nothing, where no worker is registered', async () => {
    const { serviceWorker } = browser()
    expect(await browserSubscription()).toBeNull()
    expect(serviceWorker.getRegistration).toHaveBeenCalledWith('/')
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('describes the subscription the browser holds by its digest and key id', async () => {
    const { serviceWorker } = browser({ existing: { endpoint: ENDPOINT, key: KEY_BYTES } })
    expect(await browserSubscription()).toEqual({
      endpoint: ENDPOINT, endpointDigest: createHash('sha256').update(ENDPOINT).digest('hex'), keyId: KEY_ID })
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('gives no key id when the browser does not say which key a subscription was made with', async () => {
    browser({ existing: { endpoint: ENDPOINT, key: null } })
    expect((await browserSubscription())?.keyId).toBeNull()
  })

  it('answers null, never an error, when the browser refuses to say', async () => {
    const { serviceWorker } = browser()
    serviceWorker.getRegistration.mockRejectedValueOnce(new DOMException('denied', 'SecurityError'))
    expect(await browserSubscription()).toBeNull()
    expect(await browserSubscription()).toBeNull()
  })

  it('answers null in a browser without the APIs', async () => {
    expect(await browserSubscription()).toBeNull()
  })
})

describe('turnOn', () => {
  it('stops when the patient blocks notifications, registering nothing', async () => {
    const { serviceWorker, notification, pushManager } = browser({ answer: 'denied' })
    expect(await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })).toEqual({ outcome: 'denied' })
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('stops when the patient dismisses the question', async () => {
    const { serviceWorker } = browser({ answer: 'default' })
    expect(await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })).toEqual({ outcome: 'dismissed' })
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('registers /sw.js at the root and subscribes for visible notifications with Identity\'s key', async () => {
    const { serviceWorker, pushManager } = browser()
    const result = await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    const options = pushManager.subscribe.mock.calls[0]![0]
    expect(options.userVisibleOnly).toBe(true)
    expect([...options.applicationServerKey]).toEqual([...KEY_BYTES])
    expect(result).toEqual({ outcome: 'subscribed', created: true, keyId: KEY_ID,
      endpointDigest: createHash('sha256').update(NEW_ENDPOINT).digest('hex'),
      subscription: { endpoint: NEW_ENDPOINT, expirationTime: null, keys: KEYS } })
  })

  it('asks nothing when permission was already given', async () => {
    const { notification } = browser({ granted: 'granted' })
    expect((await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })).outcome).toBe('subscribed')
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })

  it('reuses this browser\'s subscription made with the same key', async () => {
    const { pushManager, first } = browser({ granted: 'granted', existing: { endpoint: ENDPOINT, key: KEY_BYTES } })
    const result = await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(first?.unsubscribe).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: 'subscribed', created: false, subscription: { endpoint: ENDPOINT } })
  })

  it.each([['another key', OTHER_KEY_BYTES], ['a key the browser does not report', null]])(
    'replaces a subscription made with %s', async (_name, key) => {
      const { pushManager, first } = browser({ granted: 'granted', existing: { endpoint: ENDPOINT, key } })
      const result = await turnOn({ applicationServerKey: KEY, keyId: KEY_ID })
      expect(first?.unsubscribe).toHaveBeenCalledTimes(1)
      expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ outcome: 'subscribed', created: true, subscription: { endpoint: NEW_ENDPOINT } })
    })

  it('refuses a key that is not a P-256 public key before asking anything', async () => {
    const { notification } = browser()
    await expect(turnOn({ applicationServerKey: 'AAAA', keyId: KEY_ID })).rejects.toThrow()
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })

  it('passes on the browser\'s refusal to subscribe', async () => {
    const { pushManager } = browser({ granted: 'granted' })
    pushManager.subscribe.mockRejectedValueOnce(new DOMException('push service error', 'AbortError'))
    await expect(turnOn({ applicationServerKey: KEY, keyId: KEY_ID })).rejects.toThrow('push service error')
  })
})

describe('turnOffBrowser', () => {
  it('unsubscribes this browser and keeps the worker', async () => {
    const { first, serviceWorker, current } = browser({ granted: 'granted', existing: { endpoint: ENDPOINT, key: KEY_BYTES } })
    await turnOffBrowser()
    expect(first?.unsubscribe).toHaveBeenCalledTimes(1)
    expect(current()).toBeNull()
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('never throws: with no worker, no subscription, a refusal, or no APIs', async () => {
    await expect(turnOffBrowser()).resolves.toBeUndefined()
    const { serviceWorker } = browser()
    await expect(turnOffBrowser()).resolves.toBeUndefined()
    serviceWorker.getRegistration.mockRejectedValueOnce(new Error('refused'))
    await expect(turnOffBrowser()).resolves.toBeUndefined()
  })
})
