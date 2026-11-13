import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'

/*
 * "Export" puts every registration's personal and health details in a file: at an outreach group it is offered to the
 * group's organiser only, never to a helper (outreach volunteer). A hospital's outreach team keeps it as before.
 * Fictional data only.
 */

const who = vi.hoisted(() => ({ roles: ['outreach_volunteer'] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: who.roles })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(),
  outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(), outreachInvitations: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const CASE = { id: 'case-1', campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Kemi Balogun', ageYears: 30, sex: 'female',
  createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  forgetOutreachServed()
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN])
  api.outreachCases.mockResolvedValue([CASE])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockResolvedValue([{ id: 'm-1', campaignId: 'campaign-1', membershipId: 'membership-demo-1', role: 'admin', createdAt: '2026-11-01T00:00:00.000Z' }])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [] })
  api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

/** Whether Export is offered on the list, and on the campaign's page. */
async function exportOffered(): Promise<[boolean, boolean]> {
  renderDept(<Outreach />)
  await screen.findByRole('button', { name: /Kemi Balogun/ })
  const onList = screen.queryByRole('button', { name: 'Export' }) !== null
  await press(document.getElementById('outreach-campaign-campaign-1-open')!)
  await screen.findByRole('heading', { level: 1, name: 'Ajegunle health week' })
  await waitFor(() => expect(screen.queryByText('Kemi Balogun')).toBeTruthy())
  return [onList, screen.queryByRole('button', { name: 'Export' }) !== null]
}

describe('Export at an outreach group', () => {
  it('is not offered to a helper (outreach volunteer), on the list or a campaign, even one they admin', async () => {
    who.roles = ['outreach_volunteer']
    expect(await exportOffered()).toEqual([false, false])
  })

  it('is offered to the organiser, on the list and on a campaign', async () => {
    who.roles = ['outreach_organiser']
    expect(await exportOffered()).toEqual([true, true])
  })
})

describe('Export at a hospital', () => {
  it('is offered as before, to a membership that reads registrations', async () => {
    who.roles = ['nurse']
    expect(await exportOffered()).toEqual([true, true])
  })
})
