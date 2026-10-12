import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from '../Operations'

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(),
  // Campaign writes Identity refuses; the page must never send them.
  createOutreachCampaign: vi.fn(), updateOutreachCampaignStatus: vi.fn(), addOutreachCampaignMember: vi.fn(),
}))
const permissions = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { id: 'staff-1', facility: {
    id: 'facility-1', membershipId: 'member-1', permissions: permissions.value,
  } } } }, lock: null }),
}))
vi.mock('../../api', () => ({ staffApi: api }))

const ALL = ['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read', 'outreach.registration.write']
const campaign = (id: string, name: string, status: string) =>
  ({ id, name, status, services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  permissions.value = ALL
  api.outreachCampaigns.mockResolvedValue([campaign('campaign-1', 'Ikeja screening week', 'active'), campaign('campaign-2', 'Epe follow-up', 'planned')])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) =>
    [{ id: `${campaignId}-membership`, campaignId, membershipId: 'member-1', role: 'health_worker', createdAt: '2026-01-01T00:00:00.000Z' }])
})

/**
 * GAP-L93, OUTREACH-01 and "Reference workflows - Outreach campaign writes".
 * Identity does not authorize outreach.campaign.write until campaign governance
 * is decided (hid-system authorize-outreach.dto.ts, ADR-045), so creating a
 * campaign, changing its status and adding a member always answer
 * 400 VALIDATION_FAILED, though six roles hold the permission. The page offers
 * none of them, and says so; campaigns and their members can still be read.
 */
describe('Outreach campaigns, read only', () => {
  it('offers no campaign create, status or member control, even with outreach.campaign.write, and says why', async () => {
    render(<Outreach />)
    expect(await screen.findByText('Ikeja screening week')).toBeTruthy()
    await screen.findByText('Epe follow-up')
    expect(screen.getByText(/^Campaign management is not yet available\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'New campaign' })).toBeNull()
    for (const name of [/create campaign/i, /activate campaign/i, /close campaign/i, /add member/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByText('Add campaign member')).toBeNull()
    expect(screen.queryByLabelText(/^Activation reason/)).toBeNull()
    expect(screen.queryByLabelText(/^Closure reason/)).toBeNull()
    expect(screen.queryByLabelText(/^Facility membership ID/)).toBeNull()
    // Members are still read.
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledWith('facility-1', 'campaign-2'))
    expect(api.createOutreachCampaign).not.toHaveBeenCalled()
    expect(api.updateOutreachCampaignStatus).not.toHaveBeenCalled()
    expect(api.addOutreachCampaignMember).not.toHaveBeenCalled()
  })

  it('does not say the page manages campaigns', async () => {
    render(<Outreach />)
    await screen.findByText('Ikeja screening week')
    expect(document.body.textContent).not.toMatch(/Manage facility campaigns/)
  })
})

/**
 * NEW-PEHR-REQUIRED-MISMATCH and OCR-A11Y-06 (Outreach): a field marked
 * required with an asterisk must be required to assistive technology too.
 */
describe('Outreach registration case fields', () => {
  it('every field marked required is a required control', async () => {
    render(<Outreach />)
    const form = (await screen.findByRole('heading', { name: 'New registration case' })).closest('.staff-card') as HTMLElement
    const marked = Array.from(form.querySelectorAll('label')).filter(label => label.querySelector('[aria-hidden="true"]')?.textContent === '*')
    expect(marked.map(label => label.textContent)).toEqual(['Full name*', 'Sex*', 'Age (years)*'])
    for (const label of marked) {
      const control = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLSelectElement
      expect({ field: label.textContent, required: control.required }).toEqual({ field: label.textContent, required: true })
    }
    // Sex always holds a value; Unknown is the default.
    expect((within(form).getByLabelText(/^Sex/) as HTMLSelectElement).value).toBe('unknown')
  })
})
