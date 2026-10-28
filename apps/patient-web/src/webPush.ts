/**
 * "Notifications on this device" as Identity serves it (hid-system 0097, B6; contract b6-contract.md §3): the key a
 * browser subscribes with and this patient's subscriptions (R1), the subscribe answer (R2) and the remove answer (R3).
 * An Identity before 0097, or one whose push is not configured, answers 404 to all three: the Notifications page then shows nothing
 * (webPushServed.ts). Each answer is checked here; anything else is refused, never shown.
 *
 * Never sent back by Identity, and never held here: the endpoint (a bearer capability), the browser's keys, session ids.
 */

export type WebPushPushService = 'fcm' | 'mozilla' | 'apple' | 'windows'

export interface WebPushSubscriptionItem {
  readonly id: string
  /** Lowercase hex SHA-256 of the endpoint, which the browser computes to find "this device". */
  readonly endpointDigest: string
  readonly pushService: WebPushPushService
  /** Bound to the caller's sign-in (session family): only then does this device get pushes while signed in here. */
  readonly thisSignIn: boolean
  /** Made with the server key Identity holds now; false after a key rotation. */
  readonly keyCurrent: boolean
  readonly createdAt: string
  readonly boundAt: string
  readonly lastDeliveredAt: string | null
}

export interface WebPushState {
  /** The VAPID public key, 87 base64url characters (65 bytes, uncompressed P-256). */
  readonly applicationServerKey: string
  /** The first 16 hex characters of the key's SHA-256. */
  readonly keyId: string
  /** The most active subscriptions a patient has (10). */
  readonly limit: number
  /** The account's active subscriptions, newest boundAt first. */
  readonly subscriptions: readonly WebPushSubscriptionItem[]
}

/** R2's body: the browser subscription's toJSON() fields and the key id it was made with. About 2.3 KB at most. */
export interface WebPushSubscriptionInput {
  readonly endpoint: string
  readonly expirationTime: number | null
  readonly keys: { readonly p256dh: string; readonly auth: string }
  readonly keyId: string
}

export interface WebPushSubscribed {
  readonly id: string
  /** False when this endpoint was already active for the account: it is now bound to this sign-in. */
  readonly created: boolean
  readonly endpointDigest: string
  readonly pushService: WebPushPushService
}

const PUSH_SERVICES: readonly WebPushPushService[] = ['fcm', 'mozilla', 'apple', 'windows']
const APPLICATION_SERVER_KEY = /^[A-Za-z0-9_-]{87}$/
const KEY_ID = /^[0-9a-f]{16}$/
const DIGEST = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9-]{1,64}$/

const unreadable = () => new Error('Notifications on this device could not be read.')

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable()
  return value as Record<string, unknown>
}

function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw unreadable()
  return value
}

function time(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) throw unreadable()
  return value
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw unreadable()
  return value
}

function pushService(value: unknown): WebPushPushService {
  const found = PUSH_SERVICES.find(service => service === value)
  if (!found) throw unreadable()
  return found
}

/** Whether a base64url key decodes to 65 bytes starting 0x04 (an uncompressed P-256 point). */
function uncompressedPoint(key: string): boolean {
  try {
    const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '=')
    return binary.length === 65 && binary.charCodeAt(0) === 4
  } catch {
    return false
  }
}

function parseItem(value: unknown): WebPushSubscriptionItem {
  const row = record(value)
  return {
    id: matching(row.id, ID), endpointDigest: matching(row.endpointDigest, DIGEST), pushService: pushService(row.pushService),
    thisSignIn: flag(row.thisSignIn), keyCurrent: flag(row.keyCurrent), createdAt: time(row.createdAt), boundAt: time(row.boundAt),
    lastDeliveredAt: row.lastDeliveredAt === null ? null : time(row.lastDeliveredAt),
  }
}

/** R1 (GET identity/me/web-push), checked whole: a key, key id or item that is not as the contract says refuses it. */
export function parseWebPushState(value: unknown): WebPushState {
  const answer = record(value)
  const applicationServerKey = matching(answer.applicationServerKey, APPLICATION_SERVER_KEY)
  if (!uncompressedPoint(applicationServerKey)) throw unreadable()
  const limit = answer.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw unreadable()
  if (!Array.isArray(answer.subscriptions) || answer.subscriptions.length > limit) throw unreadable()
  return { applicationServerKey, keyId: matching(answer.keyId, KEY_ID), limit, subscriptions: answer.subscriptions.map(parseItem) }
}

/** R2 (PUT identity/me/web-push/subscription). */
export function parseWebPushSubscribed(value: unknown): WebPushSubscribed {
  const answer = record(value)
  return { id: matching(answer.id, ID), created: flag(answer.created), endpointDigest: matching(answer.endpointDigest, DIGEST),
    pushService: pushService(answer.pushService) }
}

/** R3 (POST identity/me/web-push/subscription/remove): whether an active subscription of this account had the endpoint. */
export function parseWebPushRemoved(value: unknown): { removed: boolean } {
  return { removed: flag(record(value).removed) }
}

/**
 * The list as it stands after R2 answered `subscribed` for this browser: that endpoint is bound to this sign-in with
 * the current key, and this sign-in holds no other (one per sign-in, contract D11).
 */
export function withSubscribed(state: WebPushState, subscribed: WebPushSubscribed, at: string): WebPushState {
  const earlier = state.subscriptions.find(item => item.endpointDigest === subscribed.endpointDigest)
  const item: WebPushSubscriptionItem = {
    id: subscribed.id, endpointDigest: subscribed.endpointDigest, pushService: subscribed.pushService, thisSignIn: true, keyCurrent: true,
    createdAt: earlier?.createdAt ?? at, boundAt: at, lastDeliveredAt: earlier?.lastDeliveredAt ?? null,
  }
  const others = state.subscriptions.filter(other => other.endpointDigest !== subscribed.endpointDigest && !other.thisSignIn)
  return { ...state, subscriptions: [item, ...others].slice(0, state.limit) }
}

/** The list without the subscription of this endpoint digest (after R3, or a browser that unsubscribed). */
export function withoutSubscription(state: WebPushState, digest: string): WebPushState {
  return { ...state, subscriptions: state.subscriptions.filter(item => item.endpointDigest !== digest) }
}
