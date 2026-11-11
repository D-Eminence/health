import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
vi.mock('../../../../staff/api', () => ({ staffApi: {} }))
import {
  indexedDbQueueStore, memoryQueueStore, purgeExpiredOutreachQueue, QUEUE_MAX_AGE_MS, removeOutreachQueueEntriesFor, setOutreachQueueStore,
  waitsForNetwork, waitsForSignIn, type PendingRegistration,
} from '../../../../ehr-blue/departments/outreach/offlineQueue'

/** The offline queue's rules (open sign-up on outreach., plan PR-5): what waits for the network, and where it is kept. */
describe('the offline queue', () => {
  it.each([
    [new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }), true],
    [new HidApiError(0, 'x', { code: 'REQUEST_TIMEOUT' }), true],
    [new HidApiError(503, 'x', { code: 'UPSTREAM_UNAVAILABLE' }), true],
    [new HidApiError(429, 'x', { code: 'RATE_LIMITED' }), true],
    [new TypeError('Failed to fetch'), true],
    [new HidApiError(0, 'x', { code: 'REQUEST_CANCELLED' }), false],
    [new HidApiError(422, 'x', { code: 'OUTREACH_CONSENT_GUARDIAN_REQUIRED' }), false],
    [new HidApiError(401, 'x', { code: 'AUTHENTICATION_REQUIRED' }), false],
    [new HidApiError(423, 'x', { code: 'OUTREACH_ORGANISER_SUSPENDED' }), false],
    [new HidApiError(403, 'x', { code: 'PERMISSION_DENIED' }), false],
  ])('%s waits for the network: %s', (error, waits) => {
    expect(waitsForNetwork(error)).toBe(waits)
  })

  it.each([
    [new HidApiError(401, 'x', { code: 'AUTHENTICATION_REQUIRED' }), true],
    [new HidApiError(403, 'x', { code: 'CSRF_VALIDATION_FAILED' }), true],
    [new HidApiError(403, 'x', { code: 'STAFF_MFA_REQUIRED' }), true],
    [new HidApiError(403, 'x', { code: 'PERMISSION_DENIED' }), false],
    [new HidApiError(422, 'x', { code: 'OUTREACH_CONSENT_REQUIRED' }), false],
    [new HidApiError(423, 'x', { code: 'OUTREACH_ORGANISER_SUSPENDED' }), false],
  ])('%s waits for the person to sign in again: %s', (error, waits) => {
    expect(waitsForSignIn(error)).toBe(waits)
  })

  it('deletes entries older than 14 days whoever saved them, and a signed-out account’s own entries, outside any outreach page', async () => {
    const store = memoryQueueStore()
    setOutreachQueueStore(store)
    try {
      const now = Date.now()
      const entry = (id: string, accountId: string, age: number): PendingRegistration => ({ localCommandId: id, temporaryPatientId: `tmp_${id}`,
        accountId, facilityId: 'f', savedAt: new Date(now - age).toISOString(), state: 'waiting', input: { fullName: 'Kemi Balogun', sex: 'female', ageYears: 30 } })
      await store.put(entry('old', 'account-b', QUEUE_MAX_AGE_MS + 1000))
      await store.put(entry('a-1', 'account-a', 1000))
      await store.put(entry('a-2', 'account-a', 2000))
      await store.put(entry('b-1', 'account-b', 1000))
      expect(await purgeExpiredOutreachQueue(now)).toBe(1)
      expect((await store.list()).map(item => item.localCommandId).sort()).toEqual(['a-1', 'a-2', 'b-1'])
      // Signing out account A leaves none of A's registrations on this device.
      expect(await removeOutreachQueueEntriesFor('account-a')).toBe(2)
      expect((await store.list()).map(item => item.localCommandId)).toEqual(['b-1'])
    } finally {
      setOutreachQueueStore(null)
    }
  })

  it('sweeps nothing and throws nothing where the browser has no IndexedDB', async () => {
    setOutreachQueueStore(null)
    expect(await purgeExpiredOutreachQueue()).toBe(0)
    expect(await removeOutreachQueueEntriesFor('account-a')).toBe(0)
  })

  it('keeps entries by their command in memory where the browser has no IndexedDB', async () => {
    expect(await indexedDbQueueStore(undefined)).toBeNull()
    const store = memoryQueueStore()
    expect(store.durable).toBe(false)
    const entry = { localCommandId: 'c-1', temporaryPatientId: 'tmp_1', accountId: 'a', facilityId: 'f', savedAt: new Date().toISOString(),
      state: 'waiting' as const, input: { fullName: 'Kemi Balogun', sex: 'female', ageYears: 30 } }
    await store.put(entry)
    await store.put({ ...entry, state: 'refused', refusal: 'No' })
    expect(await store.list()).toEqual([{ ...entry, state: 'refused', refusal: 'No' }])
    await store.remove('c-1')
    expect(await store.list()).toEqual([])
  })
})
