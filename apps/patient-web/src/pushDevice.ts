import { isAppleMobile, runningInstalled } from './deviceKind'

/**
 * This device's side of "Notifications on this device" (contract b6-contract.md §11.3): the only module allowed the
 * browser's push APIs (ESLint NO_SERVICE_WORKER is off here alone, apart from public/sw.js). The Notifications page and sign-out load
 * it with import('./pushDevice'), so it is a chunk of its own (assets/pushDevice-<hash>.js) that the launch build check
 * finds by name, and a page that never offers push never loads it.
 *
 * Nothing here talks to Health ID: the Notifications page sends what turnOn answers to Identity. The worker it registers, /sw.js, shows
 * a fixed notification and keeps nothing; the subscription's endpoint and keys stay in memory here and in Identity's
 * encrypted store, and are never written to browser storage.
 */

/** Whether this browser can get Health ID notifications here, or would if Health ID ran as the installed app. */
export type PushSupport = 'supported' | 'unsupported' | 'ios-install-needed'

/** The push subscription this browser holds for the portal's origin, with what Identity matches it by. */
export interface BrowserPushSubscription {
  readonly endpoint: string
  /** Lowercase hex SHA-256 of the endpoint's UTF-8 bytes (contract §3.4), as Identity lists it. */
  readonly endpointDigest: string
  /** The key id of the server key it was made with, or null when the browser does not say. */
  readonly keyId: string | null
}

/** What the subscribe request sends (contract §3, R2), from the subscription's own toJSON(). */
export interface PushSubscriptionDetails {
  readonly endpoint: string
  readonly expirationTime: number | null
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

export type TurnOnResult =
  | { readonly outcome: 'denied' }
  | { readonly outcome: 'dismissed' }
  | { readonly outcome: 'subscribed'; readonly subscription: PushSubscriptionDetails; readonly keyId: string
    readonly endpointDigest: string; readonly created: boolean }

export function support(): PushSupport {
  // Safari on iPhone and iPad offers push only to a web app on the Home Screen: in a tab it has none of the APIs.
  if (isAppleMobile() && !runningInstalled()) return 'ios-install-needed'
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  return 'supported'
}

export function permission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default'
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

export function endpointDigest(endpoint: string): Promise<string> {
  return sha256(new TextEncoder().encode(endpoint))
}

/** The first 16 lowercase hex characters of SHA-256 over the key's 65 raw bytes (contract §3.4). */
export async function keyIdOf(key: Uint8Array<ArrayBuffer>): Promise<string> {
  return (await sha256(key)).slice(0, 16)
}

/** The 65 bytes of a base64url P-256 public key, as Identity gives it (R1's applicationServerKey). */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('The notification key is not a P-256 public key.')
  return bytes
}

async function subscriptionKeyId(subscription: PushSubscription): Promise<string | null> {
  const key = subscription.options?.applicationServerKey
  if (!key || key.byteLength !== 65) return null
  return keyIdOf(new Uint8Array(key.slice(0)))
}

async function describe(subscription: PushSubscription): Promise<BrowserPushSubscription> {
  return { endpoint: subscription.endpoint, endpointDigest: await endpointDigest(subscription.endpoint), keyId: await subscriptionKeyId(subscription) }
}

/** The worker registration at scope '/', if one exists; this never registers one. */
async function existingRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  return navigator.serviceWorker.getRegistration('/')
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await existingRegistration()
  return registration?.pushManager ? registration.pushManager.getSubscription() : null
}

/** The subscription this browser holds now, or null (none, or the browser would not say). Never registers a worker. */
export async function browserSubscription(): Promise<BrowserPushSubscription | null> {
  try {
    const subscription = await currentSubscription()
    return subscription ? await describe(subscription) : null
  } catch {
    return null
  }
}

function details(subscription: PushSubscription): PushSubscriptionDetails {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh, auth = json.keys?.auth
  if (typeof json.endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw new Error('The browser gave no usable push subscription.')
  }
  return { endpoint: json.endpoint, expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null, keys: { p256dh, auth } }
}

/**
 * Called only from the Notifications page switch's click (or, with permission already given, to move this sign-in's subscription
 * to a rotated key). Asks for permission unless it was given, registers /sw.js, and subscribes with Identity's key,
 * reusing a subscription made with that key; one made with another key, or with none the browser reports, is
 * unsubscribed first.
 */
export async function turnOn({ applicationServerKey, keyId }: { applicationServerKey: string; keyId: string }): Promise<TurnOnResult> {
  const key = keyBytes(applicationServerKey)
  const asked = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (asked === 'denied') return { outcome: 'denied' }
  if (asked !== 'granted') return { outcome: 'dismissed' }
  // The worker's path is written here, and only here, so the launch build check can see what this chunk registers.
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && (await subscriptionKeyId(subscription)) !== keyId) {
    await subscription.unsubscribe()
    subscription = null
  }
  const created = subscription === null
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  try {
    return { outcome: 'subscribed', subscription: details(subscription), keyId, endpointDigest: await endpointDigest(subscription.endpoint), created }
  } catch (cause) {
    if (created) await subscription.unsubscribe().catch(() => false)
    throw cause
  }
}

/** Unsubscribes this browser's push subscription, if it has one. Never throws; the worker stays, and does nothing. */
export async function turnOffBrowser(): Promise<void> {
  try {
    const subscription = await currentSubscription()
    if (subscription) await subscription.unsubscribe()
  } catch { /* nothing to turn off, or the browser refused: the server stops on its own (contract D5) */ }
}
