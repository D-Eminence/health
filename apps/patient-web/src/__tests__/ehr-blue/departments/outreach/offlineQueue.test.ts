import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
const api = vi.hoisted(() => ({ createOutreachCase: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))
import {
  claimSend, forgetOutreachSendOrder, healthIdUnavailable, indexedDbQueueStore, memoryQueueStore, noConnection, purgeExpiredOutreachQueue, QUEUE_MAX_AGE_MS, QUEUE_RETRY_MS,
  removeOutreachQueueEntriesFor, removeRefusedOutreachEntriesFor, sendWaitingOutreachEntriesFor, setOutreachQueueStore, useOutreachQueue,
  waitingOutreachEntriesFor, waitsForNetwork, waitsForSignIn, type OutreachQueueStore, type PendingRegistration, type QueueSyncResult,
} from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { STORAGE_LOCK_MS, tabId } from '../../../../ehr-blue/departments/outreach/tabMemory'

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
    expect(await removeRefusedOutreachEntriesFor('account-a')).toBe(0)
    expect(await waitingOutreachEntriesFor('account-a')).toBe(0)
  })

  it('deletes only the registrations Health ID refused for a signing-out account, keeping any still waiting, and never throws', async () => {
    const store = memoryQueueStore()
    setOutreachQueueStore(store)
    try {
      const entry = (id: string, accountId: string, facilityId: string, state: PendingRegistration['state']): PendingRegistration => ({
        localCommandId: id, temporaryPatientId: `tmp_${id}`, accountId, facilityId, savedAt: new Date().toISOString(), state,
        input: { fullName: 'Kemi Balogun', sex: 'female', ageYears: 30 } })
      await store.put(entry('a-1', 'account-a', 'f-1', 'waiting'))
      await store.put(entry('a-2', 'account-a', 'f-1', 'refused'))
      await store.put(entry('a-3', 'account-a', 'f-2', 'refused'))
      await store.put(entry('b-1', 'account-b', 'f-1', 'refused'))
      expect(await removeRefusedOutreachEntriesFor('account-a')).toBe(2)
      expect((await store.list()).map(item => item.localCommandId).sort()).toEqual(['a-1', 'b-1'])
      setOutreachQueueStore({ ...store, list: () => Promise.reject(new Error('IndexedDB request failed')) })
      expect(await removeRefusedOutreachEntriesFor('account-b')).toBe(0)
    } finally {
      setOutreachQueueStore(null)
    }
  })

  it('counts the account’s registrations still waiting, on any facility, and never throws', async () => {
    const store = memoryQueueStore()
    setOutreachQueueStore(store)
    try {
      const entry = (id: string, accountId: string, facilityId: string, state: PendingRegistration['state']): PendingRegistration => ({
        localCommandId: id, temporaryPatientId: `tmp_${id}`, accountId, facilityId, savedAt: new Date().toISOString(), state,
        input: { fullName: 'Kemi Balogun', sex: 'female', ageYears: 30 } })
      await store.put(entry('a-1', 'account-a', 'f-1', 'waiting'))
      await store.put(entry('a-2', 'account-a', 'f-2', 'waiting'))
      await store.put(entry('a-3', 'account-a', 'f-1', 'refused'))
      await store.put(entry('b-1', 'account-b', 'f-1', 'waiting'))
      expect(await waitingOutreachEntriesFor('account-a')).toBe(2)
      expect(await waitingOutreachEntriesFor('account-c')).toBe(0)
      setOutreachQueueStore({ ...store, list: () => Promise.reject(new Error('IndexedDB request failed')) })
      expect(await waitingOutreachEntriesFor('account-a')).toBe(0)
    } finally {
      setOutreachQueueStore(null)
    }
  })

  it.each([
    [new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }), true, false],
    [new HidApiError(408, 'x', { code: 'REQUEST_TIMEOUT' }), true, false],
    [new TypeError('Failed to fetch'), true, false],
    [new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }), false, true],
    [new HidApiError(500, 'x', { code: 'SERVER_ERROR' }), false, true],
    [new HidApiError(429, 'x', { code: 'RATE_LIMITED' }), false, true],
    [new HidApiError(408, 'x', { code: 'UNKNOWN' }), false, true],
    [new HidApiError(0, 'x', { code: 'REQUEST_CANCELLED' }), false, false],
    [new HidApiError(400, 'x', { code: 'VALIDATION_FAILED' }), false, false],
  ])('%s is no connection: %s; Health ID unavailable: %s', (error, connection, unavailable) => {
    expect(noConnection(error)).toBe(connection)
    expect(healthIdUnavailable(error)).toBe(unavailable)
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

/*
 * Sending what waits (the cross-check of 13 November, findings 3, 6 and 7): a send stopped as the session ended is never
 * a refusal; one registration Health ID can't take just now never holds up the others, which go oldest first; and what
 * waits is tried again without an online event. Fictional data only.
 */
describe('sending what waits', () => {
  const ACCOUNT = 'acct-1'
  const FACILITY = 'fac-1'
  const at = (minutes: number) => new Date(Date.parse('2026-11-14T08:00:00.000Z') + minutes * 60_000).toISOString()
  const entry = (n: number, fullName: string, savedAt: string): PendingRegistration => ({
    localCommandId: `c0000000-0000-4000-8000-00000000000${n}`, temporaryPatientId: `tmp_c${n}`, accountId: ACCOUNT, facilityId: FACILITY,
    savedAt, state: 'waiting', input: { campaignId: 'campaign-1', fullName, sex: 'female', ageYears: 30 } })
  const created = (id: string, fullName: string) => ({ id, status: 'identity_resolution_pending', fullName, rowVersion: 1 })
  const sentNames = () => api.createOutreachCase.mock.calls.map(call => (call[1] as { fullName: string }).fullName)
  /** What a round said, with what it left listed by name. */
  const said = (outcome: QueueSyncResult | null) => outcome && { ...outcome, left: outcome.left.map(item => `${item.input.fullName} (${item.state})`) }

  async function queueOf(...entries: PendingRegistration[]): Promise<OutreachQueueStore> {
    const store = memoryQueueStore()
    for (const item of entries) await store.put(item)
    setOutreachQueueStore(store)
    return store
  }
  function useQueue() {
    return renderHook(() => useOutreachQueue(ACCOUNT, FACILITY, () => undefined))
  }
  beforeEach(() => { api.createOutreachCase.mockReset(); forgetOutreachSendOrder() })
  afterEach(() => {
    setOutreachQueueStore(null)
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'onLine')
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('keeps a registration waiting when its send is stopped because the session ended, and sends it on the next try', async () => {
    const store = await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)))
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Stopped', { code: 'REQUEST_CANCELLED' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    // Never judged by Health ID: both still wait, and the round stopped at the first.
    expect((await store.list()).map(item => item.state)).toEqual(['waiting', 'waiting'])
    expect(result.current.entries.map(item => item.state)).toEqual(['waiting', 'waiting'])

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockResolvedValueOnce(created('case-1', 'Amaka Nwosu')).mockResolvedValueOnce(created('case-2', 'Bola Ade'))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(said(outcome)).toEqual({ sent: 2, waiting: 0, refused: 0, reason: undefined, left: [] })
    expect(await store.list()).toEqual([])
  })

  it('says a send stopped as the session ended needs the session, not that Health ID refused it', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)))
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Stopped', { code: 'REQUEST_CANCELLED' }))
    const { result } = useQueue()
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(said(outcome)).toEqual({ sent: 0, waiting: 2, refused: 0, reason: 'session', left: ['Amaka Nwosu (waiting)', 'Bola Ade (waiting)'] })
  })

  it('moves on past a registration Health ID can’t take just now (503, 429, 408), oldest first, and keeps it waiting', async () => {
    // Saved newest first by command id, so the store's own order is not the order they were saved in.
    const store = await queueOf(entry(1, 'Chika Obi', at(2)), entry(2, 'Bola Ade', at(1)), entry(3, 'Amaka Nwosu', at(0)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
      .mockResolvedValueOnce(created('case-2', 'Bola Ade'))
      .mockRejectedValueOnce(new HidApiError(429, 'x', { code: 'RATE_LIMITED' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(3))
    expect(sentNames()).toEqual(['Amaka Nwosu', 'Bola Ade', 'Chika Obi'])
    await waitFor(() => expect(result.current.entries.map(item => item.input.fullName)).toEqual(['Amaka Nwosu', 'Chika Obi']))
    expect((await store.list()).every(item => item.state === 'waiting')).toBe(true)

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(408, 'x', { code: 'UNKNOWN' })).mockResolvedValueOnce(created('case-3', 'Chika Obi'))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(said(outcome)).toEqual({ sent: 1, waiting: 1, refused: 0, reason: 'unavailable', left: ['Amaka Nwosu (waiting)'] })
    expect((await store.list()).map(item => item.input.fullName)).toEqual(['Amaka Nwosu'])
  })

  it('stops the round with no connection or a timeout, keeping the rest waiting untried', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockResolvedValueOnce(created('case-1', 'Amaka Nwosu'))
      .mockRejectedValueOnce(new HidApiError(408, 'x', { code: 'REQUEST_TIMEOUT' }))
    const { result } = useQueue()
    await waitFor(() => expect(result.current.entries.map(item => item.input.fullName)).toEqual(['Bola Ade', 'Chika Obi']))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(api.createOutreachCase).toHaveBeenCalledTimes(1)
    expect(said(outcome)).toEqual({ sent: 0, waiting: 2, refused: 0, reason: 'connection', left: ['Bola Ade (waiting)', 'Chika Obi (waiting)'] })
  })

  /*
   * The review of 13 November: with a send every 30 seconds, a Health ID that is struggling is not sent every waiting
   * registration each time. Too many requests (429), or Health ID unavailable twice in a row, ends the round; one
   * registration it can't take is still passed over, and goes after the others next time, so none holds the rest up.
   */
  it('ends the round when Health ID asks for fewer requests (429), leaving the rest for the next round', async () => {
    const store = await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(429, 'x', { code: 'RATE_LIMITED' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    expect(sentNames()).toEqual(['Amaka Nwosu'])
    expect((await store.list()).map(item => item.state)).toEqual(['waiting', 'waiting', 'waiting'])

    // Next round: the two not tried go first, the one answered 429 last.
    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockResolvedValueOnce(created('case-2', 'Bola Ade')).mockResolvedValueOnce(created('case-3', 'Chika Obi'))
      .mockRejectedValueOnce(new HidApiError(429, 'x', { code: 'RATE_LIMITED' }))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(sentNames()).toEqual(['Bola Ade', 'Chika Obi', 'Amaka Nwosu'])
    expect(said(outcome)).toEqual({ sent: 2, waiting: 1, refused: 0, reason: 'unavailable', left: ['Amaka Nwosu (waiting)'] })
  })

  it('ends the round when Health ID is unavailable twice in a row, and tries the ones it couldn’t take after the others next time', async () => {
    const store = await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)), entry(4, 'Dayo Bello', at(3)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    expect(sentNames()).toEqual(['Amaka Nwosu', 'Bola Ade'])
    expect(await store.list()).toHaveLength(4)

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockResolvedValueOnce(created('case-3', 'Chika Obi')).mockResolvedValueOnce(created('case-4', 'Dayo Bello'))
      .mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' })).mockResolvedValueOnce(created('case-2', 'Bola Ade'))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(sentNames()).toEqual(['Chika Obi', 'Dayo Bello', 'Amaka Nwosu', 'Bola Ade'])
    expect(said(outcome)).toEqual({ sent: 3, waiting: 1, refused: 0, reason: 'unavailable', left: ['Amaka Nwosu (waiting)'] })
  })

  it('the sign-out question’s “Send now” also tries the ones Health ID couldn’t take after the others next time', async () => {
    const store = await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
    expect(await sendWaitingOutreachEntriesFor(ACCOUNT)).toBe(3)
    expect(sentNames()).toEqual(['Amaka Nwosu', 'Bola Ade'])

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockResolvedValueOnce(created('case-3', 'Chika Obi'))
      .mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
    expect(await sendWaitingOutreachEntriesFor(ACCOUNT)).toBe(2)
    expect(sentNames()[0]).toBe('Chika Obi')
    expect((await store.list()).map(item => item.input.fullName).sort()).toEqual(['Amaka Nwosu', 'Bola Ade'])
  })

  it('goes on when Health ID answers between two it couldn’t take (here, a refusal)', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)), entry(4, 'Dayo Bello', at(3)))
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(400, 'x', { code: 'VALIDATION_FAILED' }))
      .mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockResolvedValueOnce(created('case-4', 'Dayo Bello'))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(sentNames()).toEqual(['Amaka Nwosu', 'Bola Ade', 'Chika Obi', 'Dayo Bello'])
    expect(said(outcome)).toEqual({ sent: 1, waiting: 2, refused: 1, reason: 'unavailable',
      left: ['Amaka Nwosu (waiting)', 'Bola Ade (refused)', 'Chika Obi (waiting)'] })
  })

  it('passes over a single registration Health ID can’t take, as often as it happens, so it never holds up the others', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockImplementation((_facility: string, input: { fullName: string }) => input.fullName === 'Amaka Nwosu'
      ? Promise.reject(new HidApiError(500, 'x', { code: 'SERVER_ERROR' })) : Promise.resolve(created(`case-${input.fullName}`, input.fullName)))
    const { result } = useQueue()
    await waitFor(() => expect(result.current.entries.map(item => item.input.fullName)).toEqual(['Amaka Nwosu']))
    expect(sentNames()).toEqual(['Amaka Nwosu', 'Bola Ade', 'Chika Obi'])
  })

  it('goes as easy on a struggling Health ID when the sign-out question’s “Send now” sends what waits', async () => {
    const store = await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(429, 'x', { code: 'RATE_LIMITED' }))
    expect(await sendWaitingOutreachEntriesFor(ACCOUNT)).toBe(3)
    expect(sentNames()).toEqual(['Amaka Nwosu'])

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(500, 'x', { code: 'SERVER_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
    expect(await sendWaitingOutreachEntriesFor(ACCOUNT)).toBe(3)
    // The one Health ID couldn't take last time goes after the others.
    expect(sentNames()).toEqual(['Bola Ade', 'Chika Obi'])
    expect((await store.list()).every(item => item.state === 'waiting')).toBe(true)
  })

  it('names one reason for what still waits only when they share it, and signing in again before any other', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)), entry(2, 'Bola Ade', at(1)), entry(3, 'Chika Obi', at(2)))
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
    let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
    await act(async () => { outcome = await result.current.sync() })
    expect(outcome).toMatchObject({ sent: 0, waiting: 3, reason: undefined })

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(401, 'x', { code: 'AUTHENTICATION_REQUIRED' }))
    await act(async () => { outcome = await result.current.sync() })
    expect(outcome).toMatchObject({ sent: 0, waiting: 3, reason: 'session' })
  })

  it('tries again every 30 seconds while anything waits, never while the browser knows it is offline or the page is hidden, nor once the page is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await queueOf(entry(1, 'Amaka Nwosu', at(0)))
    api.createOutreachCase.mockRejectedValue(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
    const { result, unmount } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))

    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS) })
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.syncing).toBe(false))

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS) })
    Reflect.deleteProperty(navigator, 'onLine')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS) })
    Reflect.deleteProperty(document, 'visibilityState')
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * QUEUE_RETRY_MS) })
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)
  })

  it('stops trying again once nothing waits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await queueOf(entry(1, 'Amaka Nwosu', at(0)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
      .mockResolvedValue(created('case-1', 'Amaka Nwosu'))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))

    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS) })
    await waitFor(() => expect(result.current.entries).toEqual([]))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * QUEUE_RETRY_MS) })
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)
  })

  it('tries again as the page is shown again, with no online event', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)))
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce(created('case-1', 'Amaka Nwosu'))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.syncing).toBe(false))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(result.current.entries).toEqual([]))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)
  })

  it('never runs two rounds at once on a page', async () => {
    await queueOf(entry(1, 'Amaka Nwosu', at(0)))
    let answer: (value: unknown) => void = () => undefined
    api.createOutreachCase.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    const { result } = useQueue()
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    let second: Awaited<ReturnType<typeof result.current.sync>> | undefined
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
      second = await result.current.sync()
    })
    expect(second).toBeNull()
    expect(api.createOutreachCase).toHaveBeenCalledTimes(1)
    await act(async () => { answer(created('case-1', 'Amaka Nwosu')) })
    await waitFor(() => expect(result.current.entries).toEqual([]))
  })

  it('leaves a registration another tab is sending to that tab, and sends it once that tab’s lock has lapsed', async () => {
    const waiting = entry(1, 'Amaka Nwosu', at(0))
    const store = await queueOf(waiting)
    const lock = `hid-outreach:lock:hid-outreach-send:${waiting.localCommandId}`
    localStorage.setItem(lock, JSON.stringify({ tab: 'another-tab', until: Date.now() + STORAGE_LOCK_MS }))
    try {
      api.createOutreachCase.mockResolvedValue(created('case-1', 'Amaka Nwosu'))
      const { result } = useQueue()
      await waitFor(() => expect(result.current.entries).toHaveLength(1))
      await waitFor(() => expect(result.current.syncing).toBe(false))
      expect(api.createOutreachCase).not.toHaveBeenCalled()

      // The other tab was closed while sending: its lock lapses, and this tab sends it.
      localStorage.setItem(lock, JSON.stringify({ tab: 'another-tab', until: Date.now() - 1 }))
      let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
      await act(async () => { outcome = await result.current.sync() })
      expect(said(outcome)).toEqual({ sent: 1, waiting: 0, refused: 0, reason: undefined, left: [] })
      expect(await store.list()).toEqual([])
      // Let go once sent: nothing is left in the browser's storage.
      expect(localStorage.getItem(lock)).toBeNull()
    } finally {
      localStorage.removeItem(lock)
    }
  })

  it('counts one another tab is sending as still waiting, so “Send now” never says nothing was waiting beside it', async () => {
    const waiting = entry(1, 'Amaka Nwosu', at(0))
    await queueOf(waiting)
    const lock = `hid-outreach:lock:hid-outreach-send:${waiting.localCommandId}`
    localStorage.setItem(lock, JSON.stringify({ tab: 'another-tab', until: Date.now() + STORAGE_LOCK_MS }))
    try {
      const { result } = useQueue()
      await waitFor(() => expect(result.current.entries).toHaveLength(1))
      await waitFor(() => expect(result.current.syncing).toBe(false))
      let outcome: Awaited<ReturnType<typeof result.current.sync>> = null
      await act(async () => { outcome = await result.current.sync() })
      expect(api.createOutreachCase).not.toHaveBeenCalled()
      expect(said(outcome)).toMatchObject({ sent: 0, waiting: 1, refused: 0, left: ['Amaka Nwosu (waiting)'] })
    } finally {
      localStorage.removeItem(lock)
    }
  })

  it('sends nothing the round listed that was sent and taken off this device meanwhile', async () => {
    const waiting = entry(1, 'Amaka Nwosu', at(0))
    const store = await queueOf(waiting)
    // The form in this tab sent it and took it off between the round's list and its send.
    const list = store.list
    // The page's first read shows it; the round's own read (the second) still lists it as it is taken off.
    let reads = 0
    setOutreachQueueStore({ ...store, list: async () => {
      const all = await list()
      reads += 1
      if (reads === 2) await store.remove(waiting.localCommandId)
      return all
    } })
    const { result } = useQueue()
    await waitFor(() => expect(result.current.syncing).toBe(false))
    await waitFor(() => expect(result.current.entries).toEqual([]))
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })
})

describe('claiming a registration to send', () => {
  afterEach(() => { Reflect.deleteProperty(navigator, 'locks') })

  it('is one sender at a time in a tab, and the same tab reloaded takes its own lock back', async () => {
    const release = await claimSend('c-1')
    expect(release).toBeTypeOf('function')
    expect(await claimSend('c-1')).toBeNull()
    const other = await claimSend('c-2')
    expect(other).toBeTypeOf('function')
    other!()
    release!()
    const again = await claimSend('c-1')
    expect(again).toBeTypeOf('function')
    again!()
    // A lock this same tab left (a reload while sending) is this tab's own: it is taken back at once.
    localStorage.setItem('hid-outreach:lock:hid-outreach-send:c-3', JSON.stringify({ tab: tabId(), until: Date.now() + STORAGE_LOCK_MS }))
    const mine = await claimSend('c-3')
    expect(mine).toBeTypeOf('function')
    mine!()
    expect(localStorage.getItem('hid-outreach:lock:hid-outreach-send:c-3')).toBeNull()
  })

  it('uses the browser’s Web Locks where it has them: another tab holding one means no send here', async () => {
    const held = new Set<string>()
    const request = vi.fn((name: string, _options: { ifAvailable: boolean }, callback: (lock: { name: string } | null) => unknown) => {
      if (held.has(name)) return Promise.resolve(callback(null))
      held.add(name)
      return Promise.resolve(callback({ name })).finally(() => held.delete(name))
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    held.add('hid-outreach-send:c-9')
    expect(await claimSend('c-9')).toBeNull()
    held.delete('hid-outreach-send:c-9')
    const release = await claimSend('c-9')
    expect(release).toBeTypeOf('function')
    expect(held.has('hid-outreach-send:c-9')).toBe(true)
    release!()
    await waitFor(() => expect(held.has('hid-outreach-send:c-9')).toBe(false))
    expect(request).toHaveBeenCalledWith('hid-outreach-send:c-9', { ifAvailable: true }, expect.any(Function))
    expect(localStorage.getItem('hid-outreach:lock:hid-outreach-send:c-9')).toBeNull()
  })
})
