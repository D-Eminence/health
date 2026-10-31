import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { NotificationsPage, ProfilePage } from '../routes/Portal'
import { forgetWebPushServed, webPushServed } from '../webPushServed'
import type { BrowserPushSubscription, PushSupport, TurnOnResult } from '../pushDevice'
import type { WebPushSubscriptionItem } from '../webPush'
import { described, json, press, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

/**
 * "Notifications on this device", in the profile's Settings since the redesign moved it there from the Notifications
 * page (B6, contract b6-contract.md §11.4): hidden, saying nothing, wherever
 * Identity's GET identity/me/web-push does not answer 200 (today's backend answers 404); otherwise each of the five
 * states with its copy, the permission asked only from the switch, and turning on and off with Identity.
 *
 * This device's side (../pushDevice, the only module allowed the browser's push APIs) is a fake here, recording what
 * the page asks of it; pushDevice.test.ts covers the module itself.
 */
// Production's backend (Novu): the page's other cards say nothing where their routes are not served.
vi.mock('../backendContract', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), usesNovuBackend: () => true }))

const fake = vi.hoisted(() => ({
  support: 'supported' as PushSupport,
  permission: 'default' as NotificationPermission,
  subscription: null as BrowserPushSubscription | null,
  calls: [] as string[],
  turnOn: (async () => ({ outcome: 'dismissed' })) as (options: { applicationServerKey: string; keyId: string }) => Promise<TurnOnResult>,
}))
vi.mock('../pushDevice', () => ({
  support: () => { fake.calls.push('support'); return fake.support },
  permission: () => fake.permission,
  browserSubscription: async () => fake.subscription,
  turnOn: (options: { applicationServerKey: string; keyId: string }) => { fake.calls.push(`turnOn ${options.keyId}`); return fake.turnOn(options) },
  turnOffBrowser: async () => { fake.calls.push('turnOffBrowser'); fake.subscription = null },
}))

const KEY = `B${'A'.repeat(86)}`
const NEW_KEY = `B${'A'.repeat(85)}Q`
const KEY_ID = 'a1b2c3d4e5f60718'
const NEW_KEY_ID = '0f1e2d3c4b5a6978'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-token-1'
const DIGEST = 'ab'.repeat(32)
const OTHER_DIGEST = 'cd'.repeat(32)
const KEYS = { p256dh: `B${'C'.repeat(86)}`, auth: 'D'.repeat(22) }
const HEADING = 'Notifications on this device'
const SIGN_OUT_TEXT = 'Signing out turns this off.'
// Each still says the alert shows nothing but "You have a new notification." (the payload-free promise, contract §11.4).
const OFF_TEXT = 'Get an alert here for each new notification. It only says "You have a new notification."'
const ON_TEXT = 'On. You get an alert here for each new notification. It only says "You have a new notification."'
const TURN_ON_FAILED = 'Couldn’t turn on notifications. Try again.'

const item = (over: Partial<WebPushSubscriptionItem> = {}): WebPushSubscriptionItem => ({
  id: '6a1e0c4e-0000-4000-8000-000000000001', endpointDigest: DIGEST, pushService: 'fcm', thisSignIn: true, keyCurrent: true,
  createdAt: '2026-10-28T10:00:00.000Z', boundAt: '2026-10-28T10:00:00.000Z', lastDeliveredAt: null, ...over,
})
const pushState = (subscriptions: WebPushSubscriptionItem[] = [], key = KEY, keyId = KEY_ID) =>
  ({ applicationServerKey: key, keyId, limit: 10, subscriptions })
const subscribed = (keyId = KEY_ID, created = true): TurnOnResult =>
  ({ outcome: 'subscribed', subscription: { endpoint: ENDPOINT, expirationTime: null, keys: KEYS }, keyId, endpointDigest: DIGEST, created })
const saved = { id: '6a1e0c4e-0000-4000-8000-000000000002', created: true, endpointDigest: DIGEST, pushService: 'fcm' }

const pushRequests = (sent: Sent[]) => sent.filter(request => request.path.startsWith('/identity/me/web-push'))
  .map(request => `${request.method} ${request.path}`)
const settled = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
const theSwitch = () => screen.getByRole('switch', { name: HEADING })

/** The profile has been read and its sections are shown. */
const ready = () => screen.findByRole('heading', { name: 'About you' })
/** The profile, with Identity's push routes as `push` answers; every other read but the profile is not served. */
function page(push: Handler) {
  return renderPortal(<ProfilePage />, (path, method, body) => path === '/identity/me' ? json(profile)
    : path.startsWith('/identity/me/web-push') ? push(path, method, body) : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`),
  {}, { webPush: true })
}
/** The text of the alert that says `text`. */
const alertSaying = async (text: string) => (await screen.findByText(text)).closest('[role="alert"]')

let consoleSpies: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  forgetWebPushServed()
  Object.assign(fake, { support: 'supported', permission: 'default', subscription: null, calls: [],
    turnOn: async () => ({ outcome: 'dismissed' }) })
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(globalThis.console, method))
})
afterEach(() => {
  for (const spy of consoleSpies) expect(spy, 'nothing is written to the console').not.toHaveBeenCalled()
})

describe('Notifications on this device, where Identity does not offer it', () => {
  it('shows nothing, says nothing and loads nothing where Identity answers 404, as today\'s backend does', async () => {
    const { sent } = page(() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/me/web-push'))
    expect(await ready()).toBeTruthy()
    await waitFor(() => expect(webPushServed()).toBe(false))
    await settled()
    expect(pushRequests(sent)).toEqual(['GET /identity/me/web-push'])
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The module that can register a worker is never asked anything.
    expect(fake.calls).toEqual([])
  })

  it('is hidden, and the profile works as before, with the test gateway of every earlier wave (404 by default)', async () => {
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json(profile) : problem(404, 'NOT_FOUND', 'Not served'))
    expect(await ready()).toBeTruthy()
    await settled()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
    expect(fake.calls).toEqual([])
  })

  it.each([
    ['a refusal', () => problem(403, 'PATIENT_SESSION_REQUIRED', 'Patient session required')],
    ['an answer that is not the contract\'s', () => json({ ...pushState(), applicationServerKey: 'not-a-key' })],
    ['an item that is not the contract\'s', () => json(pushState([{ ...item(), pushService: 'pigeon' } as unknown as WebPushSubscriptionItem]))],
  ])('is hidden, with no error, after %s', async (_name, answer) => {
    page(answer)
    expect(await ready()).toBeTruthy()
    await settled()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fake.calls).toEqual([])
  })
})

describe('Where the device sections are', () => {
  it('are on the profile, under its Settings heading after the profile\'s sections', async () => {
    page(() => json(pushState()))
    const section = (await screen.findByRole('switch', { name: HEADING })).closest('section')
    const settings = screen.getByRole('heading', { level: 2, name: 'Settings' })
    const about = screen.getByRole('heading', { name: 'About you' })
    expect(about.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(settings.compareDocumentPosition(section!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('are not on Notifications, which does not ask Identity about push', async () => {
    const { sent } = renderPortal(<NotificationsPage />, (path, method) => path === '/identity/me/notifications' ? json([])
      : path.startsWith('/identity/me/web-push') ? json(pushState()) : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`), {}, { webPush: true })
    expect(await screen.findByText('No notifications')).toBeTruthy()
    await settled()
    expect(pushRequests(sent)).toEqual([])
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Install the Health ID app' })).toBeNull()
  })
})

describe('Notifications on this device, where Identity offers it', () => {
  it('starts off, even with a permission another app left, and asks for none until the switch is pressed', async () => {
    fake.permission = 'granted'
    page(() => json(pushState()))
    const control = await screen.findByRole('switch', { name: HEADING })
    expect(webPushServed()).toBe(true)
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(OFF_TEXT)).toBeTruthy()
    expect(screen.getByText(SIGN_OUT_TEXT)).toBeTruthy()
    expect(described(control)).toBe(`${OFF_TEXT} | ${SIGN_OUT_TEXT}`)
    await settled()
    expect(fake.calls.filter(call => call.startsWith('turnOn'))).toEqual([])
  })

  it.each([
    ['unsupported', 'This browser can\'t show Health ID notifications.'],
    ['ios-install-needed', 'On iPhone or iPad, first add Health ID to your Home Screen (tap Share, then Add to Home Screen). Then turn this on there.'],
  ] as const)('says what to do, with no switch, where this browser is %s', async (support, text) => {
    fake.support = support
    page(() => json(pushState([item()])))
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy()
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(SIGN_OUT_TEXT)).toBeNull()
  })

  it('says how to allow notifications when this browser blocks them, with the switch off and disabled', async () => {
    fake.permission = 'denied'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    page(() => json(pushState([item()])))
    const control = await screen.findByRole('switch', { name: HEADING })
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect((control as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(`Notifications are blocked. To allow them, open this browser's settings for ${location.host}.`)).toBeTruthy()
  })

  it('is on only for this browser\'s subscription, bound to this sign-in with the current key', async () => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    page(() => json(pushState([item({ endpointDigest: OTHER_DIGEST, id: '6a1e0c4e-0000-4000-8000-00000000000a' }), item()])))
    const control = await screen.findByRole('switch', { name: HEADING })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(ON_TEXT)).toBeTruthy()
  })

  it.each([
    ['another device\'s subscription only', [item({ endpointDigest: OTHER_DIGEST })]],
    ['this browser\'s, bound to another sign-in', [item({ thisSignIn: false })]],
  ])('is off for %s', async (_name, subscriptions) => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    page(() => json(pushState(subscriptions)))
    expect((await screen.findByRole('switch', { name: HEADING })).getAttribute('aria-checked')).toBe('false')
    await settled()
    expect(fake.calls.filter(call => call.startsWith('turnOn'))).toEqual([])
  })

  it('turns on from the switch: asks this browser, then saves exactly its subscription with Identity', async () => {
    fake.turnOn = async () => { fake.permission = 'granted'; fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }; return subscribed() }
    const { sent } = page((path, method) => method === 'PUT' ? json(saved) : json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
    expect(fake.calls).toContain(`turnOn ${KEY_ID}`)
    const put = sent.find(request => request.method === 'PUT')
    expect(put).toEqual({ path: '/identity/me/web-push/subscription', method: 'PUT',
      body: { endpoint: ENDPOINT, expirationTime: null, keys: KEYS, keyId: KEY_ID } })
    expect(JSON.stringify(put?.body).length).toBeLessThan(8_000)
    expect(screen.getByText('Notifications are on for this device.')).toBeTruthy()
    expect(screen.getByText(ON_TEXT)).toBeTruthy()
    expect(document.activeElement).toBe(theSwitch())
    expect(fake.calls).not.toContain('turnOffBrowser')
  })

  it('shows the blocked state when the patient refuses permission, and sends nothing', async () => {
    fake.turnOn = async () => { fake.permission = 'denied'; return { outcome: 'denied' } }
    const { sent } = page(() => json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await screen.findByText(/^Notifications are blocked\. To allow them/)).toBeTruthy()
    expect((theSwitch() as HTMLButtonElement).disabled).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: HEADING }))
    expect(pushRequests(sent)).toEqual(['GET /identity/me/web-push'])
  })

  it('stays off when the patient dismisses the question, and says so', async () => {
    const { sent } = page(() => json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await screen.findByText('Notifications were not turned on.')).toBeTruthy()
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
    expect(pushRequests(sent)).toEqual(['GET /identity/me/web-push'])
  })

  it('reads the key again once when Identity says it changed (409), and subscribes with the new one', async () => {
    let key = { key: KEY, id: KEY_ID }
    fake.turnOn = async ({ keyId }) => {
      fake.permission = 'granted'; fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId }; return subscribed(keyId)
    }
    const { sent } = page((path, method, body) => {
      if (method === 'GET') return json(pushState([], key.key, key.id))
      if ((body as { keyId: string }).keyId === KEY_ID) { key = { key: NEW_KEY, id: NEW_KEY_ID }; return problem(409, 'WEB_PUSH_KEY_CHANGED', 'Key changed') }
      return json(saved)
    })
    await press(await screen.findByRole('switch', { name: HEADING }))
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
    expect(fake.calls.filter(call => call.startsWith('turnOn'))).toEqual([`turnOn ${KEY_ID}`, `turnOn ${NEW_KEY_ID}`])
    expect(pushRequests(sent)).toEqual(['GET /identity/me/web-push', 'PUT /identity/me/web-push/subscription',
      'GET /identity/me/web-push', 'PUT /identity/me/web-push/subscription'])
    expect(fake.calls).not.toContain('turnOffBrowser')
  })

  it.each([
    ['a refusal', () => problem(400, 'WEB_PUSH_SERVICE_UNSUPPORTED', 'Unsupported push service')],
    ['too many changes', () => problem(429, 'WEB_PUSH_RATE_LIMITED', 'Too many changes')],
    ['a second key change', () => problem(409, 'WEB_PUSH_KEY_CHANGED', 'Key changed')],
  ])('undoes a subscription it made when Identity does not save it (%s), and says to try again', async (_name, refusal) => {
    fake.turnOn = async ({ keyId }) => { fake.permission = 'granted'; fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId }; return subscribed(keyId) }
    page((path, method) => method === 'PUT' ? refusal() : json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await alertSaying(TURN_ON_FAILED)).not.toBeNull()
    expect(fake.calls).toContain('turnOffBrowser')
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
    expect(document.activeElement).toBe(theSwitch())
  })

  it('keeps a subscription it did not make when Identity does not save it', async () => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    fake.turnOn = async () => subscribed(KEY_ID, false)
    page((path, method) => method === 'PUT' ? problem(400, 'WEB_PUSH_SUBSCRIPTION_INVALID', 'Invalid') : json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await screen.findByText(TURN_ON_FAILED)).toBeTruthy()
    expect(fake.calls).not.toContain('turnOffBrowser')
  })

  it('says to try again when this browser cannot subscribe', async () => {
    fake.turnOn = async () => { throw new DOMException('Registration failed - push service error', 'AbortError') }
    const { sent } = page(() => json(pushState()))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await alertSaying(TURN_ON_FAILED)).not.toBeNull()
    expect(pushRequests(sent)).toEqual(['GET /identity/me/web-push'])
  })

  it('turns off: tells Identity which endpoint, then unsubscribes this browser', async () => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    const { sent } = page((path, method) => method === 'POST' ? json({ removed: true }) : json(pushState([item()])))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await screen.findByText('Notifications are off for this device.')).toBeTruthy()
    expect(sent.find(request => request.method === 'POST')).toEqual({ path: '/identity/me/web-push/subscription/remove', method: 'POST',
      body: { endpoint: ENDPOINT } })
    expect(fake.calls).toContain('turnOffBrowser')
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(OFF_TEXT)).toBeTruthy()
    expect(document.activeElement).toBe(theSwitch())
  })

  // The redesign says the same as a turn-off Identity was told of (owner's plain wording): this browser stops either way.
  it('still turns this browser off when Identity cannot be told, and says it is off', async () => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    page((path, method) => method === 'POST' ? problem(403, 'PATIENT_SESSION_REQUIRED', 'Patient session required') : json(pushState([item()])))
    await press(await screen.findByRole('switch', { name: HEADING }))
    expect(await screen.findByText('Notifications are off for this device.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fake.calls).toContain('turnOffBrowser')
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('moves this sign-in\'s subscription to a rotated key without asking, and shows it on', async () => {
    fake.permission = 'granted'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    fake.turnOn = async ({ keyId }) => { fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId }; return subscribed(keyId) }
    const { sent } = page((path, method) => method === 'PUT' ? json({ ...saved, created: false })
      : json(pushState([item({ keyCurrent: false })], NEW_KEY, NEW_KEY_ID)))
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
    expect(fake.calls.filter(call => call.startsWith('turnOn'))).toEqual([`turnOn ${NEW_KEY_ID}`])
    expect(sent.filter(request => request.method === 'PUT').map(request => (request.body as { keyId: string }).keyId)).toEqual([NEW_KEY_ID])
    // Nothing to announce: the patient did nothing.
    expect(screen.queryByText('Notifications are on for this device.')).toBeNull()
  })

  it('does not move it without permission, nor one bound to another sign-in', async () => {
    fake.permission = 'default'
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: DIGEST, keyId: KEY_ID }
    page(() => json(pushState([item({ keyCurrent: false })], NEW_KEY, NEW_KEY_ID)))
    expect((await screen.findByRole('switch', { name: HEADING })).getAttribute('aria-checked')).toBe('false')
    await settled()
    expect(fake.calls.filter(call => call.startsWith('turnOn'))).toEqual([])
  })
})
