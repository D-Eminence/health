import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
vi.mock('../../../../staff/api', () => ({ staffApi: {} }))
import {
  daySettingsKey, discardQueuedRegistration, memoryQueueStore, purgeExpiredOutreachQueue, QUEUE_MAX_AGE_MS, queueStationWrite,
  readDaySettings, removeOutreachQueueEntriesFor, saveDaySettings, setOutreachQueueStore, syncOutreachQueue, WRITE_ORPHANED,
  type PendingRegistration, type QueueSenders,
} from '../../../../ehr-blue/departments/outreach/offlineQueue'
import type { OutreachCase } from '../../../../staff/api'

/** Station writes and day settings in the offline queue (Outreach campaigns, owner decisions of 13 November 2026). */
const owner = { accountId: 'account-a', facilityId: 'f' }
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 9, minutes))

function registration(id: string, minutes: number, accountId = 'account-a'): PendingRegistration {
  return { localCommandId: id, temporaryPatientId: `tmp_${id}`, accountId, facilityId: 'f', savedAt: at(minutes).toISOString(), state: 'waiting',
    input: { campaignId: 'camp-1', fullName: 'Kemi Balogun', sex: 'female', ageYears: 30 } }
}

function senders(options: { failRegistration?: Record<string, unknown>; failWrite?: Record<string, unknown> } = {}) {
  const order: string[] = []
  const sent: QueueSenders = {
    registration: vi.fn(async entry => {
      order.push(`registration ${entry.localCommandId}`)
      const failure = options.failRegistration?.[entry.localCommandId]
      if (failure) throw failure
      return { id: `case-for-${entry.localCommandId}`, status: 'identity_resolution_pending', rowVersion: 1 } satisfies OutreachCase
    }),
    write: vi.fn(async entry => {
      order.push(`${entry.command.kind} ${entry.localCommandId} → ${entry.caseId}`)
      const failure = options.failWrite?.[entry.localCommandId]
      if (failure) throw failure
      return { id: entry.caseId, status: 'identity_resolution_pending', rowVersion: 2 }
    }),
  }
  return { sent, order }
}

const vitals = { kind: 'vitals' as const, body: { readings: { bp_systolic: 150, bp_diastolic: 95 }, takenAt: at(5).toISOString() } }
const tests = { kind: 'tests' as const, body: { results: [{ testId: 'hbsag', result: 'negative', attempt: 1 as const, kitLot: 'HB-2291', takenAt: at(6).toISOString() }] } }

describe('the offline queue’s station writes', () => {
  it('sends registrations first, gives waiting writes the real case, then sends the writes oldest first', async () => {
    const store = memoryQueueStore()
    await store.put(registration('reg-1', 1))
    // A write for a person registered offline, saved before a write for a case Outreach already has.
    await queueStationWrite(store, owner, 'camp-1', { registrationCommandId: 'reg-1' }, vitals, 'w-1', at(2))
    await queueStationWrite(store, owner, 'camp-1', { caseId: 'oc-9' }, tests, 'w-2', at(3))
    await queueStationWrite(store, owner, 'camp-1', { registrationCommandId: 'reg-1' }, tests, 'w-3', at(4))
    const { sent, order } = senders()
    const heard: string[] = []
    const report = await syncOutreachQueue(store, owner, sent, { onRegistration: created => heard.push(created.id), onWrite: (_, entry) => heard.push(entry.localCommandId) })
    expect(report).toEqual({ sent: 4, refused: 0, stopped: null })
    expect(order).toEqual(['registration reg-1', 'vitals w-1 → case-for-reg-1', 'tests w-2 → oc-9', 'tests w-3 → case-for-reg-1'])
    expect(heard).toEqual(['case-for-reg-1', 'w-1', 'w-2', 'w-3'])
    expect(await store.list()).toEqual([])
    expect(await store.listWrites()).toEqual([])
  })

  it('keeps everything, in order, when the network is gone, and sends it the next time', async () => {
    const store = memoryQueueStore()
    await store.put(registration('reg-1', 1))
    await queueStationWrite(store, owner, 'camp-1', { registrationCommandId: 'reg-1' }, vitals, 'w-1', at(2))
    const offline = senders({ failRegistration: { 'reg-1': new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }) } })
    expect(await syncOutreachQueue(store, owner, offline.sent)).toEqual({ sent: 0, refused: 0, stopped: 'network' })
    expect(offline.sent.write).not.toHaveBeenCalled()
    expect((await store.listWrites())[0]).toMatchObject({ caseId: null, dependsOn: 'reg-1', state: 'waiting' })
    const online = senders()
    expect(await syncOutreachQueue(store, owner, online.sent)).toMatchObject({ sent: 2, stopped: null })
  })

  it('stops for a sign-in without judging the write, and marks a refused write with what Health ID said', async () => {
    const store = memoryQueueStore()
    await queueStationWrite(store, owner, 'camp-1', { caseId: 'oc-1' }, vitals, 'w-1', at(1))
    await queueStationWrite(store, owner, 'camp-1', { caseId: 'oc-2' }, tests, 'w-2', at(2))
    const signedOut = senders({ failWrite: { 'w-1': new HidApiError(401, 'x', { code: 'AUTHENTICATION_REQUIRED' }) } })
    expect(await syncOutreachQueue(store, owner, signedOut.sent)).toMatchObject({ stopped: 'sign_in', sent: 0 })
    expect((await store.listWrites()).every(entry => entry.state === 'waiting')).toBe(true)

    const refusing = senders({ failWrite: { 'w-1': new HidApiError(422, 'x', { code: 'OUTREACH_KIT_EXPIRED' }) } })
    expect(await syncOutreachQueue(store, owner, refusing.sent)).toEqual({ sent: 1, refused: 1, stopped: null })
    const [left] = await store.listWrites()
    expect(left).toMatchObject({ localCommandId: 'w-1', state: 'refused' })
    expect(left?.refusal).toBeTruthy()
  })

  it('holds the writes of a refused registration, and discarding it takes them with it', async () => {
    const store = memoryQueueStore()
    await store.put(registration('reg-1', 1))
    await queueStationWrite(store, owner, 'camp-1', { registrationCommandId: 'reg-1' }, vitals, 'w-1', at(2))
    const refusing = senders({ failRegistration: { 'reg-1': new HidApiError(422, 'x', { code: 'OUTREACH_CONSENT_REQUIRED' }) } })
    expect(await syncOutreachQueue(store, owner, refusing.sent)).toEqual({ sent: 0, refused: 1, stopped: null })
    expect((await store.listWrites())[0]).toMatchObject({ state: 'waiting', caseId: null })
    await discardQueuedRegistration(store, 'reg-1')
    expect(await store.list()).toEqual([])
    expect(await store.listWrites()).toEqual([])
  })

  it('marks a write whose registration is no longer on this device', async () => {
    const store = memoryQueueStore()
    await queueStationWrite(store, owner, 'camp-1', { registrationCommandId: 'gone' }, vitals, 'w-1', at(2))
    expect(await syncOutreachQueue(store, owner, senders().sent)).toEqual({ sent: 0, refused: 1, stopped: null })
    expect((await store.listWrites())[0]).toMatchObject({ state: 'refused', refusal: WRITE_ORPHANED })
  })

  it('sends only this account’s writes at this facility', async () => {
    const store = memoryQueueStore()
    await queueStationWrite(store, { accountId: 'account-b', facilityId: 'f' }, 'camp-1', { caseId: 'oc-1' }, vitals, 'w-b', at(1))
    await queueStationWrite(store, { accountId: 'account-a', facilityId: 'g' }, 'camp-1', { caseId: 'oc-1' }, vitals, 'w-g', at(1))
    const { sent } = senders()
    expect(await syncOutreachQueue(store, owner, sent)).toEqual({ sent: 0, refused: 0, stopped: null })
    expect(sent.write).not.toHaveBeenCalled()
  })
})

describe('day settings', () => {
  it('remembers the site, station and kit lots per account, facility and campaign, merging kit lots', async () => {
    const store = memoryQueueStore()
    const now = at(0)
    await saveDaySettings(store, owner, 'camp-1', { siteId: 'site-1', station: 'tests', kitLots: { hbsag: 'HB-2291' } }, now)
    const saved = await saveDaySettings(store, owner, 'camp-1', { kitLots: { hiv_rapid: 'HV-118' } }, now)
    expect(saved).toMatchObject({ siteId: 'site-1', station: 'tests', kitLots: { hbsag: 'HB-2291', hiv_rapid: 'HV-118' } })
    expect(await readDaySettings(store, owner, 'camp-2', now.getTime())).toBeNull()
    expect(await readDaySettings(store, { accountId: 'account-b', facilityId: 'f' }, 'camp-1', now.getTime())).toBeNull()
    expect(saved.key).toBe(daySettingsKey('account-a', 'f', 'camp-1'))
    // Forgotten after 14 days.
    expect(await readDaySettings(store, owner, 'camp-1', now.getTime() + QUEUE_MAX_AGE_MS + 1)).toBeNull()
    expect(await store.listDaySettings()).toEqual([])
  })

  it('goes with the queue at sign-out and after 14 days, writes included', async () => {
    const store = memoryQueueStore()
    setOutreachQueueStore(store)
    try {
      const now = Date.now()
      await saveDaySettings(store, owner, 'camp-1', { siteId: 'site-1' }, new Date(now))
      await saveDaySettings(store, { accountId: 'account-b', facilityId: 'f' }, 'camp-1', { siteId: 'site-2' }, new Date(now - QUEUE_MAX_AGE_MS - 1000))
      await queueStationWrite(store, owner, 'camp-1', { caseId: 'oc-1' }, vitals, 'w-1', new Date(now))
      await queueStationWrite(store, { accountId: 'account-b', facilityId: 'f' }, 'camp-1', { caseId: 'oc-1' }, vitals, 'w-old', new Date(now - QUEUE_MAX_AGE_MS - 1000))
      expect(await purgeExpiredOutreachQueue(now)).toBe(2)
      expect((await store.listWrites()).map(entry => entry.localCommandId)).toEqual(['w-1'])
      expect(await removeOutreachQueueEntriesFor('account-a')).toBe(2)
      expect(await store.listWrites()).toEqual([])
      expect(await store.listDaySettings()).toEqual([])
    } finally {
      setOutreachQueueStore(null)
    }
  })
})
