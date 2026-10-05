import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from './Operations'

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(),
  outreachCases: vi.fn(),
  outreachCampaignMembers: vi.fn(),
}))

vi.mock('../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', membershipId: 'member-1',
    permissions: ['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
  } } } } }),
}))
vi.mock('../api', () => ({ staffApi: api }))

beforeEach(() => {
  vi.clearAllMocks()
  api.outreachCampaigns.mockResolvedValue([
    { id: 'campaign-1', name: 'Enrolled campaign', status: 'active', services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 },
    { id: 'campaign-2', name: 'Other campaign', status: 'active', services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 },
  ])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) =>
    [{ id: campaignId + '-membership', campaignId, membershipId: campaignId === 'campaign-1' ? 'member-1' : 'member-2', role: 'health_worker' }])
})

describe('Outreach campaign assignment', () => {
  it('offers registration only in active campaigns containing the current facility membership', async () => {
    render(<Outreach />)

    const campaign = await screen.findByRole('combobox', { name: 'Campaign' })
    await waitFor(() => expect(within(campaign).getByRole('option', { name: 'Enrolled campaign' })).toBeTruthy())
    expect(within(campaign).queryByRole('option', { name: 'Other campaign' })).toBeNull()
    expect(api.outreachCampaignMembers).toHaveBeenCalledWith('facility-1', 'campaign-1')
    expect(api.outreachCampaignMembers).toHaveBeenCalledWith('facility-1', 'campaign-2')
  })
})
