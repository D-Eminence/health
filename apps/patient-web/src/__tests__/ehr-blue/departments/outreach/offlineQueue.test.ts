import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
vi.mock('../../../../staff/api', () => ({ staffApi: {} }))
import { indexedDbQueueStore, memoryQueueStore, waitsForNetwork } from '../../../../ehr-blue/departments/outreach/offlineQueue'

/** The offline queue's rules (open sign-up on outreach., plan PR-5): what waits for the network, and where it is kept. */
describe('the offline queue', () => {
  it.each([
    [new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }), true],
    [new HidApiError(0, 'x', { code: 'REQUEST_TIMEOUT' }), true],
    [new HidApiError(503, 'x', { code: 'UPSTREAM_UNAVAILABLE' }), true],
    [new HidApiError(429, 'x', { code: 'RATE_LIMITED' }), true],
    [new TypeError('Failed to fetch'), true],
    [new HidApiError(0, 'x', { code: 'REQUEST_CANCELLED' }), false],
    [new HidApiError(422, 'x', { code: 'OUTREACH_GUARDIAN_REQUIRED' }), false],
    [new HidApiError(409, 'x', { code: 'OUTREACH_ORGANISER_AWAITING_REVIEW' }), false],
    [new HidApiError(403, 'x', { code: 'PERMISSION_DENIED' }), false],
  ])('%s waits for the network: %s', (error, waits) => {
    expect(waitsForNetwork(error)).toBe(waits)
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
