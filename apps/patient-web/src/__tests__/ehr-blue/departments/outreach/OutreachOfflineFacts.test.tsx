import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type * as ProductHostname from '../../../../productHostname'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { OUTREACH_SNAPSHOT_KEY, outreachSnapshotOf, readOutreachSnapshot, saveOutreachSnapshot } from '../../../../ehr-blue/departments/outreach/offlineStart'

/*
 * Outreach with no signal: the Outreach page of an outreach group, open with a confirmed session on Health ID Outreach's
 * own site, keeps the few facts "No signal" mode opens from (offlineStart.ts): the volunteer, the group, and the
 * campaigns they are a member of. A hospital's outreach team, or any other site, keeps none. Fictional data only.
 */
const where = vi.hoisted(() => ({ outreach: true, roles: ['outreach_volunteer'] as string[] }))
vi.mock('../../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, offlineShellHere: () => where.outreach }
})
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: 'group-1', name: 'Ilorin Health Volunteers', roles: where.roles })),
  }
})
const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(),
  createOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(), outreachInvitations: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const MEMBER = { id: 'c-member', name: 'Ilorin health day', status: 'active', services: ['registration'], startsAt: '2026-11-14T07:00:00.000Z',
  endsAt: '2099-11-14T18:00:00.000Z', rowVersion: 1 }
const NOT_MEMBER = { ...MEMBER, id: 'c-other', name: 'Another group day' }

beforeEach(() => {
  // What Outreach serves is remembered for the session (outreachServed.ts): each test starts knowing nothing.
  forgetOutreachServed()
  vi.clearAllMocks()
  where.outreach = true
  where.roles = ['outreach_volunteer']
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCasesPage.mockResolvedValue({ items: [], nextCursor: null })
  api.outreachCases.mockResolvedValue([])
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  api.outreachCampaigns.mockResolvedValue([MEMBER, NOT_MEMBER])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockImplementation(async (_facility: string, campaignId: string) => campaignId === MEMBER.id
    ? [{ id: 'm-1', campaignId, membershipId: 'membership-demo-1', role: 'enumerator', createdAt: '2026-11-01T00:00:00.000Z' }] : [])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'enumerator', people: [] })
})
afterEach(() => {
  setOutreachQueueStore(null)
  sessionStorage.clear()
  localStorage.clear()
})

describe('the facts "No signal" mode opens from', () => {
  it('are kept at an outreach group on Outreach\'s site: the volunteer, the group and their campaigns, with dates', async () => {
    renderDept(<Outreach />)
    await screen.findByRole('heading', { level: 1, name: 'Outreach' })
    await waitFor(() => expect(readOutreachSnapshot()?.campaigns.map(campaign => campaign.id)).toEqual(['c-member']))
    expect(readOutreachSnapshot()).toMatchObject({ actorId: 'staff-demo-1', displayName: 'Demo Scientist', facilityId: 'group-1',
      facilityName: 'Ilorin Health Volunteers', campaigns: [{ id: 'c-member', name: 'Ilorin health day', startsAt: MEMBER.startsAt, endsAt: MEMBER.endsAt }] })
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).not.toMatch(/@|token/i)
  })

  // Kept an hour ago, from a visit whose members reads all answered: this volunteer is in the "Ilorin health day" campaign.
  const keptEarlier = () => {
    const earlier = Date.now() - 60 * 60 * 1000
    saveOutreachSnapshot(outreachSnapshotOf({ actorId: 'staff-demo-1', displayName: 'Demo Scientist', facilityId: 'group-1',
      facilityName: 'Ilorin Health Volunteers', healthChecksServed: false, campaigns: [MEMBER], now: earlier }))
    return earlier
  }

  it.each([
    ['still on its way (weak signal)', () => new Promise(() => undefined)],
    ['with no signal', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['refused', () => Promise.reject(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))],
  ])('keep the campaigns kept before while a campaign\'s members read is %s, and start their 24 hours again', async (_name, answer) => {
    const earlier = keptEarlier()
    api.outreachCampaignMembers.mockImplementation(answer)
    renderDept(<Outreach />)
    await screen.findByRole('heading', { level: 1, name: 'Outreach' })
    await waitFor(() => expect(readOutreachSnapshot()!.savedAt).toBeGreaterThan(earlier))
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(2))
    expect(readOutreachSnapshot()).toMatchObject({ actorId: 'staff-demo-1', facilityId: 'group-1', campaigns: [{ id: 'c-member', name: 'Ilorin health day' }] })
    expect(readOutreachSnapshot()?.campaignsUnread).toBeUndefined()
  })

  it('with one campaign\'s members read and another\'s not answered, still keep the campaigns kept before', async () => {
    keptEarlier()
    // The volunteer's own campaign answers that they are no longer in it; the other campaign's read never answers.
    api.outreachCampaignMembers.mockImplementation((_facility: string, campaignId: string) => campaignId === MEMBER.id ? Promise.resolve([]) : new Promise(() => undefined))
    renderDept(<Outreach />)
    await screen.findByRole('heading', { level: 1, name: 'Outreach' })
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readOutreachSnapshot()?.campaigns.map(campaign => campaign.id)).toEqual(['c-member'])
  })

  it('with no earlier copy and a members read that failed, say the campaigns are not known, not that there are none', async () => {
    api.outreachCampaignMembers.mockRejectedValue(new TypeError('Failed to fetch'))
    renderDept(<Outreach />)
    await screen.findByRole('heading', { level: 1, name: 'Outreach' })
    await waitFor(() => expect(readOutreachSnapshot()).toMatchObject({ facilityId: 'group-1', campaigns: [], campaignsUnread: true }))
  })

  it('are not kept on any other site', async () => {
    where.outreach = false
    renderDept(<Outreach />)
    await screen.findByText('Ilorin health day')
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
    expect(sessionStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })

  it('are not kept for a hospital\'s outreach team', async () => {
    where.roles = ['nurse']
    renderDept(<Outreach />)
    await screen.findByText('Ilorin health day')
    expect(localStorage.getItem(OUTREACH_SNAPSHOT_KEY)).toBeNull()
  })
})
