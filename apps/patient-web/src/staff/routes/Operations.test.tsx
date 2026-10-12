import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from './Operations'

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(),
  outreachCases: vi.fn(),
  outreachCampaignMembers: vi.fn(),
  createOutreachCase: vi.fn(),
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

describe('Outreach registration case limits (EHR-FORMS-01)', () => {
  // CreateRegistrationCaseDto: operationalNotes is optional, 3-2000 characters (hid-system outreach-api).
  it('lets the browser refuse operational notes shorter than 3 characters', async () => {
    render(<Outreach />)
    const notes = await screen.findByRole('textbox', { name: /Operational notes/ }) as HTMLTextAreaElement
    expect(notes.minLength).toBe(3)
    expect(notes.maxLength).toBe(2000)
  })

  it('refuses notes of fewer than 3 characters before sending, and sends none when left blank', async () => {
    api.createOutreachCase.mockResolvedValue({ id: 'case-1', status: 'identity_resolution_pending', rowVersion: 1 })
    render(<Outreach />)
    const form = (await screen.findByRole('button', { name: 'Create case' })).closest('form')!
    fireEvent.change(within(form).getByRole('textbox', { name: /Full name/ }), { target: { value: 'Ada Example' } })
    fireEvent.change(within(form).getByRole('spinbutton', { name: /Age/ }), { target: { value: '40' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Operational notes/ }), { target: { value: ' ok ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create case' }))
    expect(await screen.findByText(/Operational notes need at least 3 characters/)).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByRole('textbox', { name: /Operational notes/ }), { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledWith('facility-1', expect.objectContaining({ fullName: 'Ada Example', operationalNotes: undefined })))
  })
})
