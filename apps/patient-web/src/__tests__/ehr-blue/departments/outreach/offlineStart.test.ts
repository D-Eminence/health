import { afterEach, describe, expect, it } from 'vitest'
import {
  clearOutreachSnapshot, clearOutreachSnapshotUnlessFor, offlineCampaigns, OUTREACH_SNAPSHOT_KEY, outreachSnapshotOf, readOutreachSnapshot,
  saveOutreachSnapshot, SNAPSHOT_MAX_AGE_MS,
} from '../../../../ehr-blue/departments/outreach/offlineStart'

/*
 * The last confirmed session's few facts that open Outreach in "No signal" mode, on Health ID Outreach's own site only,
 * for 24 hours: who the volunteer is, their outreach group and the campaigns they may register into, with their dates.
 * Never a token, an email address or anyone registered. Fictional data only.
 */
const OUTREACH = 'outreach.healthidentitydirectory.com'
const NOW = Date.parse('2026-11-13T20:00:00.000Z')
const campaign = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Campaign ${id}`, status: 'active', services: ['registration'],
  startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-14T18:00:00.000Z', rowVersion: 3, ...extra })
const facts = (now = NOW) => outreachSnapshotOf({ actorId: 'staff-demo-1', displayName: 'Demo Volunteer', facilityId: 'group-1', facilityName: 'Ilorin Health Volunteers',
  healthChecksServed: true, campaigns: [campaign('c-1'), campaign('c-ended', { endsAt: '2026-11-12T18:00:00.000Z' }), campaign('c-closed', { status: 'closed' }),
    campaign('c-checks', { services: ['screening'] }), campaign('c-open-ended', { endsAt: null })], now })

afterEach(() => { sessionStorage.clear(); localStorage.clear() })

describe('the facts kept', () => {
  it('are only who, where and which campaigns: running or coming registration campaigns, with their dates', () => {
    const snapshot = facts()
    expect(snapshot).toEqual({ version: 1, savedAt: NOW, actorId: 'staff-demo-1', displayName: 'Demo Volunteer', facilityId: 'group-1',
      facilityName: 'Ilorin Health Volunteers', healthChecksServed: true, campaigns: [
        { id: 'c-1', name: 'Campaign c-1', startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-14T18:00:00.000Z' },
        { id: 'c-open-ended', name: 'Campaign c-open-ended', startsAt: '2026-11-14T07:00:00.000Z', endsAt: null },
      ] })
    expect(JSON.stringify(snapshot)).not.toMatch(/token|email|@|permission|rowVersion/i)
  })

  it('are kept in sessionStorage and localStorage on Outreach\'s site, and read back', () => {
    saveOutreachSnapshot(facts(), OUTREACH)
    expect(sessionStorage.getItem(OUTREACH_SNAPSHOT_KEY)).not.toBeNull()
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).not.toBeNull()
    expect(readOutreachSnapshot(NOW + 1000, OUTREACH)).toEqual(facts())
    expect(readOutreachSnapshot(NOW + 1000, 'outreach.staging.healthidentitydirectory.com')).toEqual(facts())
  })

  it('outlive a closed tab (localStorage alone)', () => {
    saveOutreachSnapshot(facts(), OUTREACH)
    sessionStorage.clear()
    expect(readOutreachSnapshot(NOW + 1000, OUTREACH)?.actorId).toBe('staff-demo-1')
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com', 'app.healthidentitydirectory.com', 'localhost'])(
    'are never kept or read on %s', hostname => {
      saveOutreachSnapshot(facts(), hostname)
      expect(sessionStorage.length + localStorage.length).toBe(0)
      localStorage.setItem(OUTREACH_SNAPSHOT_KEY, JSON.stringify(facts()))
      expect(readOutreachSnapshot(NOW + 1000, hostname)).toBeNull()
    })

  it('expire after 24 hours, and are then deleted', () => {
    saveOutreachSnapshot(facts(), OUTREACH)
    expect(readOutreachSnapshot(NOW + SNAPSHOT_MAX_AGE_MS - 1, OUTREACH)).not.toBeNull()
    expect(readOutreachSnapshot(NOW + SNAPSHOT_MAX_AGE_MS, OUTREACH)).toBeNull()
    expect(sessionStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ ...facts(), version: 2 })],
    ['no account', JSON.stringify({ ...facts(), actorId: '' })],
    ['a campaign without dates', JSON.stringify({ ...facts(), campaigns: [{ id: 'c', name: 'C' }] })],
    ['from the future', JSON.stringify({ ...facts(), savedAt: NOW + 60 * 60 * 1000 })],
  ])('open nothing when %s', (_name, raw) => {
    localStorage.setItem(OUTREACH_SNAPSHOT_KEY, raw)
    expect(readOutreachSnapshot(NOW, OUTREACH)).toBeNull()
  })

  it('are deleted on a sign-out, and when another account\'s session is confirmed, not the same one\'s', () => {
    saveOutreachSnapshot(facts(), OUTREACH)
    clearOutreachSnapshotUnlessFor('staff-demo-1', OUTREACH)
    expect(readOutreachSnapshot(NOW, OUTREACH)).not.toBeNull()
    clearOutreachSnapshotUnlessFor('staff-someone-else', OUTREACH)
    expect(readOutreachSnapshot(NOW, OUTREACH)).toBeNull()
    saveOutreachSnapshot(facts(), OUTREACH)
    clearOutreachSnapshot(OUTREACH)
    expect(sessionStorage.length + localStorage.length).toBe(0)
  })

  it('give the registration form its campaigns', () => {
    expect(offlineCampaigns(facts()).map(item => [item.id, item.status, item.services])).toEqual([
      ['c-1', 'active', ['registration']], ['c-open-ended', 'active', ['registration']]])
  })
})
