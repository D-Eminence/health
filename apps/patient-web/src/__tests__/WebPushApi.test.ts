import { describe, expect, it } from 'vitest'
import { withSubscribed, withoutSubscription, type WebPushState, type WebPushSubscriptionItem } from '../webPush'
import { json, patientApi, problem } from './portalHarness'

/**
 * Identity's "Notifications on this device" routes as api.ts reads them (B6, contract b6-contract.md §3): R1 checked
 * whole, R2's body exactly the subscription's fields and far under production's 8 KB edge limit, R3's endpoint in a
 * body. An answer that is not the contract's is refused, never shown.
 */
const KEY = `B${'A'.repeat(86)}`
const KEY_ID = 'a1b2c3d4e5f60718'
const DIGEST = 'ab'.repeat(32)
const item: WebPushSubscriptionItem = {
  id: '6a1e0c4e-0000-4000-8000-000000000001', endpointDigest: DIGEST, pushService: 'apple', thisSignIn: true, keyCurrent: true,
  createdAt: '2026-10-28T10:00:00.000Z', boundAt: '2026-10-28T10:05:00.000Z', lastDeliveredAt: '2026-10-28T11:00:00.000Z',
}
const state: WebPushState = { applicationServerKey: KEY, keyId: KEY_ID, limit: 10, subscriptions: [item] }

describe('GET identity/me/web-push', () => {
  it('reads the key, its id, the limit and this patient\'s subscriptions', async () => {
    const { api, sent } = patientApi(() => json(state), { webPush: true })
    expect(await api.webPush()).toEqual(state)
    expect(sent).toEqual([{ path: '/identity/me/web-push', method: 'GET', body: null }])
  })

  it.each([
    ['a key of the wrong length', { ...state, applicationServerKey: KEY.slice(1) }],
    ['a key that is not an uncompressed point', { ...state, applicationServerKey: `C${'A'.repeat(86)}` }],
    ['a key id that is not 16 hex', { ...state, keyId: 'A1B2C3D4E5F60718' }],
    ['no limit', { ...state, limit: undefined }],
    ['more subscriptions than the limit', { ...state, limit: 1, subscriptions: [item, { ...item, id: 'other' }] }],
    ['a digest that is not 64 hex', { ...state, subscriptions: [{ ...item, endpointDigest: 'x' }] }],
    ['an unknown push service', { ...state, subscriptions: [{ ...item, pushService: 'pigeon' }] }],
    ['a flag that is not a boolean', { ...state, subscriptions: [{ ...item, thisSignIn: 'yes' }] }],
    ['a time that is not one', { ...state, subscriptions: [{ ...item, boundAt: 'soon' }] }],
    ['a list that is not one', { ...state, subscriptions: {} }],
    ['no object at all', [state]],
  ])('refuses %s', async (_name, answer) => {
    const { api } = patientApi(() => json(answer), { webPush: true })
    await expect(api.webPush()).rejects.toThrow('Notifications on this device could not be read.')
  })

  it('passes on Identity\'s 404, the answer before 0097 and while push is not configured', async () => {
    const { api } = patientApi(() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/me/web-push'), { webPush: true })
    await expect(api.webPush()).rejects.toMatchObject({ status: 404 })
  })
})

describe('PUT identity/me/web-push/subscription', () => {
  it('sends the subscription\'s own fields and the key id, nothing else, and reads the answer', async () => {
    const answer = { id: '6a1e0c4e-0000-4000-8000-000000000002', created: false, endpointDigest: DIGEST, pushService: 'fcm' }
    const { api, sent } = patientApi(() => json(answer), { webPush: true })
    const input = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: { p256dh: 'p', auth: 'a', extra: 'no' }, keyId: KEY_ID,
      options: { userVisibleOnly: true } }
    expect(await api.saveWebPushSubscription(input)).toEqual(answer)
    expect(sent).toEqual([{ path: '/identity/me/web-push/subscription', method: 'PUT',
      body: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: { p256dh: 'p', auth: 'a' }, keyId: KEY_ID } }])
  })

  it('stays far under production\'s 8 KB edge limit with the longest endpoint Identity takes', async () => {
    const { api, sent } = patientApi(() => json({ id: 'a', created: true, endpointDigest: DIGEST, pushService: 'windows' }), { webPush: true })
    const prefix = 'https://wns2-par02p.notify.windows.com/w/?token='
    const endpoint = `${prefix}${'A'.repeat(2048 - prefix.length)}`
    expect(endpoint).toHaveLength(2048)
    await api.saveWebPushSubscription({ endpoint, expirationTime: 1_799_999_999_999, keys: { p256dh: `B${'C'.repeat(86)}`, auth: 'D'.repeat(22) }, keyId: KEY_ID })
    const bytes = new TextEncoder().encode(JSON.stringify(sent[0]?.body)).length
    expect(bytes).toBeLessThan(2_400)
  })

  it('refuses an answer that is not the contract\'s', async () => {
    const { api } = patientApi(() => json({ id: 'a', created: 'yes', endpointDigest: DIGEST, pushService: 'fcm' }), { webPush: true })
    await expect(api.saveWebPushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' }, keyId: KEY_ID })).rejects.toThrow()
  })
})

describe('POST identity/me/web-push/subscription/remove', () => {
  it('sends the endpoint in the body, never the address, and reads whether a subscription was removed', async () => {
    const { api, sent } = patientApi(() => json({ removed: false }), { webPush: true })
    expect(await api.removeWebPushSubscription('https://fcm.googleapis.com/fcm/send/x')).toEqual({ removed: false })
    expect(sent).toEqual([{ path: '/identity/me/web-push/subscription/remove', method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/x' } }])
  })
})

describe('the list after an action', () => {
  it('binds the saved subscription to this sign-in with the current key, one per sign-in', () => {
    const other = { ...item, id: 'other-device', endpointDigest: 'cd'.repeat(32), thisSignIn: false }
    const old = { ...item, id: 'old-key', endpointDigest: 'ef'.repeat(32), keyCurrent: false }
    const next = withSubscribed({ ...state, subscriptions: [old, other] }, { id: 'new', created: true, endpointDigest: DIGEST, pushService: 'fcm' },
      '2026-10-28T12:00:00.000Z')
    expect(next.subscriptions.map(entry => entry.id)).toEqual(['new', 'other-device'])
    expect(next.subscriptions[0]).toMatchObject({ thisSignIn: true, keyCurrent: true, boundAt: '2026-10-28T12:00:00.000Z' })
  })

  it('keeps what Identity said of an endpoint already listed', () => {
    const next = withSubscribed({ ...state, subscriptions: [{ ...item, thisSignIn: false }] },
      { id: item.id, created: false, endpointDigest: DIGEST, pushService: 'apple' }, '2026-10-28T12:00:00.000Z')
    expect(next.subscriptions).toEqual([{ ...item, thisSignIn: true, boundAt: '2026-10-28T12:00:00.000Z' }])
  })

  it('drops the removed endpoint only', () => {
    const other = { ...item, id: 'other-device', endpointDigest: 'cd'.repeat(32) }
    expect(withoutSubscription({ ...state, subscriptions: [item, other] }, DIGEST).subscriptions).toEqual([other])
  })
})
